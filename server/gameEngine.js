// ═══════════════════════════════════════════════════════════════
// GAME ENGINE — Server-side orchestration of the simulation.
// Imports the pure-JS simulation modules (no DOM dependencies)
// and drives the turn cycle: detection → movement → adjudication
// → state application → turn advance.
//
// This is the server-authoritative version of what SimGame.jsx
// does on the client. All randomness and LLM calls happen here.
// ═══════════════════════════════════════════════════════════════

import { callLLM } from "./llmProxy.js";
import {
  getGame, getGameConfig, updateGameState, getOrdersForTurn, saveTurnResults,
  getPlayersForGame, appendGameLog, setTurnDeadline, clearTurnDeadline,
} from "./db.js";

// Simulation modules — pure JS, no browser APIs
import { createGame as createGameState, adjudicate, adjudicateRebuttal, applyStateUpdates, advanceTurn } from "../src/simulation/orchestrator.js";
import { computeDetection, serializeVisibility } from "../src/simulation/detectionEngine.js";
import { simulateMovement } from "../src/simulation/movementSimulator.js";
import { filterAdjudicationForActor } from "../src/simulation/adjudicationFilter.js";
import { buildActorBriefing } from "../src/simulation/briefingExport.js";
import { auditAllNarratives } from "../src/simulation/narrativeAuditor.js";
import { PHASES } from "../src/simulation/turnPhases.js";

// ── Per-game API keys ────────────────────────────────────────
// Set before processTurn(), cleared after. Single-threaded Node
// means this is safe — only one turn processes at a time.
let _activeGameApiKeys = null;

/** Set game-specific API keys for the current turn processing. */
export function setGameApiKeys(keys) { _activeGameApiKeys = keys; }

/** Clear game-specific API keys after turn processing. */
export function clearGameApiKeys() { _activeGameApiKeys = null; }

// ── Monkey-patch fetch for server-side adjudication ─────────
// The orchestrator's adjudicate() calls fetch("/api/llm/adjudicate")
// which only works in the browser. On the server we intercept that
// and route directly to callLLM().
//
// WHY: The orchestrator is shared code used by both client and server.
// Rather than forking it, we override the fetch target so the same
// adjudicate() function works in both environments.

const originalFetch = globalThis.fetch;

function patchedFetch(url, options = {}) {
  // Intercept only the LLM adjudication calls
  if (typeof url === "string" && url.includes("/api/llm/adjudicate")) {
    return handleServerLLMCall(options);
  }
  // Everything else (external APIs etc.) uses real fetch
  return originalFetch(url, options);
}

async function handleServerLLMCall(options) {
  const body = JSON.parse(options.body);
  const result = await callLLM(body.provider, body.model, body.messages, {
    temperature: body.temperature,
    maxTokens: body.max_tokens,
    apiKeys: _activeGameApiKeys, // game-specific keys, if set
  });
  // Return a Response-like object that adjudicate() can .json()
  return {
    ok: true,
    json: async () => result,
  };
}

// Apply the patch
globalThis.fetch = patchedFetch;

// Also patch the netlog save call (fire-and-forget in orchestrator, noop on server)
// The orchestrator calls fetch("/api/netlog/save") — just swallow it silently.

// ── Turn Processing ─────────────────────────────────────────

/**
 * Check if all players have submitted orders for the current turn.
 * Returns { ready: boolean, submitted: string[], missing: string[] }
 */
export function checkOrdersReady(db, gameId) {
  const game = getGame(db, gameId);
  if (!game) return { ready: false, error: "Game not found" };

  const gameState = JSON.parse(game.state_json);
  const turn = gameState.game.turn;
  const players = getPlayersForGame(db, gameId);
  const orders = getOrdersForTurn(db, gameId, turn);

  const submittedActors = new Set(orders.map(o => o.actor_id));
  const humanPlayers = players.filter(p => !p.is_ai);
  const submitted = humanPlayers.filter(p => submittedActors.has(p.actor_id)).map(p => p.actor_id);
  const missing = humanPlayers.filter(p => !submittedActors.has(p.actor_id)).map(p => p.actor_id);

  return { ready: missing.length === 0, submitted, missing, turn };
}

/**
 * Run the full turn cycle: detection → movement → adjudication → apply → advance.
 * Called when all orders are in.
 *
 * Returns { success, newState, error }
 */
export async function processTurn(db, gameId) {
  const game = getGame(db, gameId);
  if (!game) return { success: false, error: "Game not found" };

  // Load game-specific API keys if provided during game creation.
  // These override the server's env vars for this game's LLM calls.
  // Uses separate getGameConfig() to avoid loading keys into general game context.
  const config = getGameConfig(db, gameId);
  if (config.apiKeys) {
    setGameApiKeys(config.apiKeys);
  }

  try {
    let gameState = JSON.parse(game.state_json);
    const terrainData = game.terrain_json ? JSON.parse(game.terrain_json) : null;
    const turn = gameState.game.turn;

    // All orders are in — clear the deadline for this turn
    clearTurnDeadline(db, gameId);

    // Gather all sealed orders for this turn
    const orderRows = getOrdersForTurn(db, gameId, turn);
    const sealedOrders = {};
    const playerActions = {};
    const structuredOrders = { unitOrders: {}, actorIntents: {} };

    for (const row of orderRows) {
      const orders = JSON.parse(row.orders_json);
      sealedOrders[row.actor_id] = orders;
      playerActions[row.actor_id] = orders.actorIntent || "";
      structuredOrders.unitOrders[row.actor_id] = orders.unitOrders || {};
      structuredOrders.actorIntents[row.actor_id] = orders.actorIntent || "";
    }

    // Phase 1: Detection
    const detectionResult = computeDetection(gameState, terrainData, sealedOrders);

    // Phase 2: Movement simulation
    const movementResult = simulateMovement(gameState, terrainData, sealedOrders, detectionResult?.visibilityState);

    // Apply movement positions to game state
    if (movementResult?.finalPositions) {
      gameState = {
        ...gameState,
        units: gameState.units.map(u => {
          const pos = movementResult.finalPositions[u.id];
          return pos ? { ...u, position: pos } : u;
        }),
      };
    }

    // Phase 3: Adjudication (LLM call)
    // Create a minimal logger for server-side use
    const logEntries = [];
    const serverLogger = {
      log: (turn, type, data) => logEntries.push({ turn, type, data, timestamp: new Date().toISOString() }),
    };

    const adjResult = await adjudicate(
      gameState, playerActions, terrainData, serverLogger,
      structuredOrders, { visibilityState: detectionResult?.visibilityState },
      null // no abort signal on server
    );

    if (adjResult.error && !adjResult.adjudication) {
      appendGameLog(db, { gameId, turn, type: "adjudication_failed", dataJson: JSON.stringify({ error: adjResult.error }) });
      return { success: false, error: adjResult.error };
    }

    // Run narrative auditor in Player Moderator mode to catch FOW leaks
    // in free-text fields. Human Moderator mode skips this — the moderator
    // reviews narratives manually before finalizing.
    const gameConfig = getGameConfig(db, gameId);
    if (gameConfig.moderationMode === "player") {
      const llmConfig = gameConfig.llm || { provider: "anthropic", model: "claude-sonnet-4-20250514" };
      try {
        const auditResults = await auditAllNarratives(
          adjResult.adjudication, detectionResult?.visibilityState,
          gameState, llmConfig, null
        );
        if (auditResults.length > 0) {
          appendGameLog(db, {
            gameId, turn,
            type: "narrative_audit",
            dataJson: JSON.stringify({ corrected: auditResults }),
          });
        }
      } catch (auditErr) {
        // Audit failure is non-fatal — deterministic scrub fallback runs inside the auditor.
        // Log it but don't block turn processing.
        appendGameLog(db, {
          gameId, turn,
          type: "narrative_audit_error",
          dataJson: JSON.stringify({ error: auditErr.message }),
        });
      }
    }

    // Build per-actor filtered views before applying state updates
    const actorResults = {};
    const players = getPlayersForGame(db, gameId);
    for (const player of players) {
      actorResults[player.actor_id] = filterAdjudicationForActor(
        adjResult.adjudication,
        player.actor_id,
        detectionResult?.visibilityState,
        gameState
      );
    }

    // Save turn results (master + per-actor views) before state application.
    // Players retrieve their filtered view; master is for moderator only.
    saveTurnResults(db, {
      gameId,
      turn,
      masterJson: JSON.stringify(adjResult.adjudication),
      actorResultsJson: JSON.stringify(actorResults),
      visibilityJson: JSON.stringify(serializeVisibility(detectionResult?.visibilityState)),
    });

    // Log server-side events
    for (const entry of logEntries) {
      appendGameLog(db, { gameId, turn: entry.turn, type: entry.type, dataJson: JSON.stringify(entry.data) });
    }

    // Return results — state is NOT applied yet.
    // Players must review and accept/challenge before state is finalized.
    // The moderator (or auto-advance logic) calls finalizeTurn() after review.
    return {
      success: true,
      adjudication: adjResult.adjudication,
      actorResults,
      turn,
    };
  } finally {
    clearGameApiKeys();
  }
}

/**
 * Finalize the turn: apply state updates and advance to next turn.
 * Called after all actors have reviewed (accepted or challenges resolved).
 */
export function finalizeTurn(db, gameId, adjudication, playerActions = {}) {
  const game = getGame(db, gameId);
  if (!game) return { success: false, error: "Game not found" };

  let gameState = JSON.parse(game.state_json);

  // Apply state updates from adjudication
  gameState = applyStateUpdates(gameState, adjudication, playerActions);

  // Advance turn counter, date, supply, weather
  gameState = advanceTurn(gameState);

  // Persist
  updateGameState(db, gameId, JSON.stringify(gameState));

  // Set deadline for the new turn (default 24h, overridden by per-game config)
  const deadlineHours = game.turn_deadline_hours || 24;
  setTurnDeadline(db, gameId, deadlineHours);

  appendGameLog(db, {
    gameId,
    turn: gameState.game.turn - 1, // log under the turn we just finished
    type: "turn_finalized",
    dataJson: JSON.stringify({ newTurn: gameState.game.turn }),
  });

  return { success: true, newState: gameState };
}

/**
 * Re-adjudicate after challenges. Same flow as adjudicate but with
 * challenge/rebuttal context appended.
 */
export async function processRebuttal(db, gameId, challenges, counterRebuttals, originalResult) {
  const game = getGame(db, gameId);
  if (!game) return { success: false, error: "Game not found" };

  // Load game-specific API keys (same as processTurn)
  const config = getGameConfig(db, gameId);
  if (config.apiKeys) {
    setGameApiKeys(config.apiKeys);
  }

  try {
    const gameState = JSON.parse(game.state_json);
    const terrainData = game.terrain_json ? JSON.parse(game.terrain_json) : null;
    const turn = gameState.game.turn;

    // Reconstruct playerActions and structuredOrders from sealed orders
    const orderRows = getOrdersForTurn(db, gameId, turn);
    const playerActions = {};
    const structuredOrders = { unitOrders: {}, actorIntents: {} };
    for (const row of orderRows) {
      const orders = JSON.parse(row.orders_json);
      playerActions[row.actor_id] = orders.actorIntent || "";
      structuredOrders.unitOrders[row.actor_id] = orders.unitOrders || {};
      structuredOrders.actorIntents[row.actor_id] = orders.actorIntent || "";
    }

    const serverLogger = {
      log: () => {}, // silent for rebuttals
    };

    const rebuttalResult = await adjudicateRebuttal(
      gameState, playerActions, terrainData, originalResult,
      challenges, serverLogger, counterRebuttals, null,
      structuredOrders, null
    );

    if (rebuttalResult.error && !rebuttalResult.adjudication) {
      return { success: false, error: rebuttalResult.error };
    }

    // Update stored turn results with rebuttal outcome
    const players = getPlayersForGame(db, gameId);
    const actorResults = {};
    for (const player of players) {
      actorResults[player.actor_id] = filterAdjudicationForActor(
        rebuttalResult.adjudication,
        player.actor_id,
        null, // visibility doesn't change during rebuttal
        gameState
      );
    }

    saveTurnResults(db, {
      gameId,
      turn,
      masterJson: JSON.stringify(rebuttalResult.adjudication),
      actorResultsJson: JSON.stringify(actorResults),
      visibilityJson: null, // keep original visibility
    });

    return {
      success: true,
      adjudication: rebuttalResult.adjudication,
      actorResults,
    };
  } finally {
    clearGameApiKeys();
  }
}
