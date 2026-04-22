// ============================================================================
// GAME ENGINE - Server-side orchestration of the simulation.
// Imports the pure-JS simulation modules (no DOM dependencies)
// and drives the turn cycle: detection -> movement -> adjudication
// -> state application -> turn advance.
//
// This is the server-authoritative version of what SimGame.jsx
// does on the client. All randomness and LLM calls happen here.
// ============================================================================

import { AsyncLocalStorage } from "async_hooks";
import { callLLM } from "./llmProxy.js";
import {
  getGame, getGameConfig, updateGameState, getOrdersForTurn, saveTurnResults,
  getPlayersForGame, appendGameLog, setTurnDeadline, clearTurnDeadline,
  getPlayerOrders, submitOrders, getTurnResults,
} from "./db.js";

// Simulation modules - pure JS, no browser APIs
import { adjudicate, adjudicateRebuttal, applyStateUpdates, advanceTurn } from "../src/simulation/orchestrator.js";
import { computeDetection, serializeVisibility, deserializeVisibility } from "../src/simulation/detectionEngine.js";
import { simulateMovement } from "../src/simulation/movementSimulator.js";
import { filterAdjudicationForActor } from "../src/simulation/adjudicationFilter.js";
import { auditAllNarratives } from "../src/simulation/narrativeAuditor.js";
import { PHASES } from "../src/simulation/turnPhases.js";
import { buildEffectiveTerrain } from "../src/simulation/terrainMerge.js";
import { generateAIOrders } from "./aiPlayer.js";

const serverRequestContext = new AsyncLocalStorage();

function runWithServerRequestContext(apiKeys, fn) {
  return serverRequestContext.run({ apiKeys: apiKeys || null }, fn);
}

function getServerRequestContext() {
  return serverRequestContext.getStore() || {};
}

// Monkey-patch fetch for server-side adjudication.
// The shared orchestrator calls fetch("/api/llm/adjudicate") which only exists in the browser.
const originalFetch = globalThis.fetch;

function okResponse(body = { ok: true }) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function patchedFetch(url, options = {}) {
  if (typeof url === "string" && url.includes("/api/llm/adjudicate")) {
    return handleServerLLMCall(options);
  }
  if (typeof url === "string" && (url.includes("/api/netlog/save") || url.includes("/api/auditlog/save"))) {
    return Promise.resolve(okResponse());
  }
  return originalFetch(url, options);
}

async function handleServerLLMCall(options = {}) {
  const body = JSON.parse(options.body || "{}");
  const { apiKeys } = getServerRequestContext();
  const result = await callLLM(body.provider, body.model, body.messages, {
    temperature: body.temperature,
    maxTokens: body.max_tokens,
    apiKeys,
    budgetKey: body.budget_key,
  });
  return {
    ok: true,
    json: async () => result,
  };
}

if (!globalThis.__openConflictServerFetchPatched) {
  globalThis.fetch = patchedFetch;
  globalThis.__openConflictServerFetchPatched = true;
}

// Per-game locks to avoid duplicate work from polling + moderator actions.
const _aiGenerationInProgress = new Set();
const _turnProcessingInProgress = new Set();

export function isTurnProcessing(gameId) {
  return _turnProcessingInProgress.has(gameId);
}

function setGamePhase(db, gameId, gameState, phase) {
  updateGameState(db, gameId, JSON.stringify({
    ...gameState,
    game: {
      ...gameState.game,
      phase,
    },
  }));
}

function parseStoredTurnResults(turnResults, turn) {
  return {
    success: true,
    adjudication: turnResults?.master_adjudication_json ? JSON.parse(turnResults.master_adjudication_json) : null,
    actorResults: JSON.parse(turnResults?.actor_results_json || "{}"),
    turn,
    alreadyProcessed: true,
  };
}

function ensureAiState(gameState) {
  if (gameState.aiState?.operationalState && gameState.aiState?.reasoningLog) return gameState;
  return {
    ...gameState,
    aiState: {
      unitOrderHistory: gameState.aiState?.unitOrderHistory || {},
      callLog: gameState.aiState?.callLog || [],
      commanderThoughts: gameState.aiState?.commanderThoughts || {},
      operationalState: gameState.aiState?.operationalState || {},
      reasoningLog: gameState.aiState?.reasoningLog || [],
    },
  };
}

function normalizeAiConfig(aiConfig = {}) {
  return {
    engine: aiConfig.engine || "llm",
    profile: aiConfig.profile || "balanced",
    thinkBudget: aiConfig.thinkBudget || "standard",
    ...aiConfig,
  };
}

function parseVisibilityState(turnResults) {
  if (!turnResults?.visibility_json) return null;
  try {
    return deserializeVisibility(JSON.parse(turnResults.visibility_json));
  } catch {
    return null;
  }
}

function updateAIOperationalState(gameState, players, orderRows = []) {
  const nextState = ensureAiState(gameState);
  const orderByActor = Object.fromEntries(orderRows.map((row) => [row.actor_id, JSON.parse(row.orders_json)]));
  const updatedOperationalState = { ...(nextState.aiState?.operationalState || {}) };
  const priorReasoning = nextState.aiState?.reasoningLog || [];
  const reasoningLog = [...priorReasoning];

  for (const player of players.filter((entry) => entry.is_ai)) {
    const sealed = orderByActor[player.actor_id];
    const reasoning = sealed?.reasoning || null;
    const selectedHypothesis = reasoning?.hypotheses?.find((hypothesis) => hypothesis.selected) || null;
    const primaryObjectiveHex = selectedHypothesis?.primaryObjective?.hex || reasoning?.selectedHypothesis?.coordination?.mainEffortHex || null;
    const previous = updatedOperationalState[player.actor_id] || { objectiveCooldowns: {} };
    const objectiveCooldowns = { ...(previous.objectiveCooldowns || {}) };
    for (const key of Object.keys(objectiveCooldowns)) {
      objectiveCooldowns[key] = Math.max(0, objectiveCooldowns[key] - 1);
    }

    const currentlyHeld = primaryObjectiveHex ? nextState.game?.vpControl?.[primaryObjectiveHex] === player.actor_id : false;
    if (primaryObjectiveHex) {
      if (currentlyHeld) objectiveCooldowns[primaryObjectiveHex] = 0;
      else if (previous.lastPrimaryObjective === primaryObjectiveHex) objectiveCooldowns[primaryObjectiveHex] = Math.min(3, (objectiveCooldowns[primaryObjectiveHex] || 0) + 1);
      else objectiveCooldowns[primaryObjectiveHex] = objectiveCooldowns[primaryObjectiveHex] || 0;
    }

    const reserveCommitted = !!(reasoning?.unitDecisions || []).some((decision) =>
      decision.reserveUnit
      && ["ATTACK", "SUPPORT_FIRE"].includes(decision.subsequentOrders?.actionOrder?.id)
    );
    updatedOperationalState[player.actor_id] = {
      ...previous,
      lastTurn: nextState.game.turn,
      lastHypothesisId: reasoning?.selectedHypothesis?.id || selectedHypothesis?.id || null,
      lastPrimaryObjective: primaryObjectiveHex,
      reserveCommitted,
      objectiveCooldowns,
      lastTurnSummary: {
        primaryObjectiveHex,
        primaryObjectiveName: selectedHypothesis?.primaryObjective?.name || null,
        objectiveHeld: currentlyHeld,
        myVp: nextState.game?.vpStatus?.vp?.[player.actor_id] || 0,
      },
    };

    if (reasoning) {
      reasoningLog.push({
        actorId: player.actor_id,
        turn: nextState.game.turn,
        reasoning,
      });
    }
  }

  return {
    ...nextState,
    aiState: {
      ...nextState.aiState,
      operationalState: updatedOperationalState,
      reasoningLog: reasoningLog.slice(-20),
    },
  };
}

// ============================================================================
// AI Order Generation (PBEM)
// ============================================================================

export async function generateAndSubmitAIOrders(db, gameId) {
  const game = getGame(db, gameId);
  if (!game) return { submitted: [], errors: [{ actorId: "system", error: "Game not found" }] };

  const gameState = ensureAiState(JSON.parse(game.state_json));
  const terrainData = game.terrain_json ? JSON.parse(game.terrain_json) : null;
  const turn = gameState.game.turn;
  const players = getPlayersForGame(db, gameId);
  const aiPlayers = players.filter(p => p.is_ai);

  if (aiPlayers.length === 0) return { submitted: [], errors: [] };

  if (_aiGenerationInProgress.has(gameId)) {
    return { submitted: [], errors: [{ actorId: "system", error: "AI generation already in progress" }] };
  }
  _aiGenerationInProgress.add(gameId);

  const config = getGameConfig(db, gameId);
  const gameApiKeys = config.apiKeys || null;
  const submitted = [];
  const errors = [];

  try {
    for (const player of aiPlayers) {
      try {
        const existing = getPlayerOrders(db, gameId, player.actor_id, turn);
        if (existing) {
          submitted.push(player.actor_id);
          continue;
        }

        const aiConfig = normalizeAiConfig(player.ai_config_json ? JSON.parse(player.ai_config_json) : {});
        const provider = aiConfig.provider || "anthropic";
        const mergedAiConfig = {
          ...aiConfig,
          ...(aiConfig.apiKey ? {} : {
            apiKey: provider === "openai"
              ? gameApiKeys?.openaiKey
              : gameApiKeys?.anthropicKey,
          }),
        };

        let previousTurnContext = null;
        let previousVisibilityState = null;
        if (turn > 1) {
          const prevTurn = turn - 1;
          const prevResults = getTurnResults(db, gameId, prevTurn);
          const prevOrders = getPlayerOrders(db, gameId, player.actor_id, prevTurn);
          previousVisibilityState = parseVisibilityState(prevResults);
          if (prevResults || prevOrders) {
            previousTurnContext = { history: [] };
            if (prevResults?.actor_results_json) {
              const actorResults = JSON.parse(prevResults.actor_results_json);
              const actorResult = actorResults[player.actor_id];
              previousTurnContext.narrative = actorResult?.adjudication?.actor_perspectives?.[player.actor_id]?.narrative
                || actorResult?.adjudication?.situation_assessment || null;
            }
            if (prevOrders) {
              const prevOrderData = JSON.parse(prevOrders.orders_json);
              previousTurnContext.intent = prevOrderData.actorIntent || null;
              previousTurnContext.commanderThoughts = prevOrderData.commanderThoughts || null;
            }

            const historyStart = Math.max(1, prevTurn - 4);
            for (let t = historyStart; t < prevTurn; t++) {
              const hResults = getTurnResults(db, gameId, t);
              const hOrders = getPlayerOrders(db, gameId, player.actor_id, t);
              const entry = { turn: t, intent: null, narrative: null };
              if (hResults?.actor_results_json) {
                const ar = JSON.parse(hResults.actor_results_json);
                const ap = ar[player.actor_id];
                entry.narrative = ap?.adjudication?.actor_perspectives?.[player.actor_id]?.narrative
                  || ap?.adjudication?.situation_assessment || null;
              }
              if (hOrders) {
                const od = JSON.parse(hOrders.orders_json);
                entry.intent = od.actorIntent || null;
              }
              if (entry.intent || entry.narrative) previousTurnContext.history.push(entry);
            }
          }
        }

        const effectiveTerrain = terrainData ? buildEffectiveTerrain(terrainData, gameState.terrainMods) : null;
        const visibilityState = effectiveTerrain
          ? computeDetection(gameState, effectiveTerrain, null, previousVisibilityState)
          : previousVisibilityState;

        const result = await generateAIOrders(gameState, player.actor_id, terrainData, mergedAiConfig, {
          visibilityState,
          previousTurnContext,
          operationalState: gameState.aiState?.operationalState?.[player.actor_id] || null,
        });

        if (result.error) {
          errors.push({ actorId: player.actor_id, error: result.error });
          appendGameLog(db, { gameId, turn, type: "ai_order_error", dataJson: JSON.stringify({ actorId: player.actor_id, error: result.error }) });
        }

        const ordersJson = JSON.stringify({
          unitOrders: result.unitOrders || {},
          actorIntent: result.actorIntent || "",
          commanderThoughts: result.commanderThoughts || "",
          reasoning: result.reasoning || null,
          aiEngine: mergedAiConfig.engine || "llm",
        });

        submitOrders(db, { gameId, actorId: player.actor_id, turn, ordersJson });
        submitted.push(player.actor_id);

        appendGameLog(db, {
          gameId,
          turn,
          type: "ai_orders_submitted",
          dataJson: JSON.stringify({
            actorId: player.actor_id,
            engine: mergedAiConfig.engine || "llm",
            usage: result.usage || null,
            retryCount: result.retryCount || 0,
            selectedHypothesis: result.reasoning?.selectedHypothesis?.id || null,
          }),
        });
      } catch (e) {
        errors.push({ actorId: player.actor_id, error: e.message });
        appendGameLog(db, { gameId, turn, type: "ai_order_error", dataJson: JSON.stringify({ actorId: player.actor_id, error: e.message }) });
      }
    }
  } finally {
    _aiGenerationInProgress.delete(gameId);
  }

  return { submitted, errors };
}

// ============================================================================
// Turn Processing
// ============================================================================

export async function checkOrdersReady(db, gameId) {
  const game = getGame(db, gameId);
  if (!game) return { ready: false, error: "Game not found" };

  const gameState = JSON.parse(game.state_json);
  const turn = gameState.game.turn;
  const players = getPlayersForGame(db, gameId);
  const orders = getOrdersForTurn(db, gameId, turn);

  const submittedActors = new Set(orders.map(o => o.actor_id));
  const aiPlayers = players.filter(p => p.is_ai);
  const aiMissing = aiPlayers.filter(p => !submittedActors.has(p.actor_id));
  if (aiMissing.length > 0) {
    await generateAndSubmitAIOrders(db, gameId);
    const updatedOrders = getOrdersForTurn(db, gameId, turn);
    const updatedSubmitted = new Set(updatedOrders.map(o => o.actor_id));
    for (const p of aiMissing) {
      if (updatedSubmitted.has(p.actor_id)) submittedActors.add(p.actor_id);
    }
  }

  const humanPlayers = players.filter(p => !p.is_ai);
  const submitted = humanPlayers.filter(p => submittedActors.has(p.actor_id)).map(p => p.actor_id);
  const missing = humanPlayers.filter(p => !submittedActors.has(p.actor_id)).map(p => p.actor_id);

  return { ready: missing.length === 0, submitted, missing, turn };
}

export async function processTurn(db, gameId) {
  const game = getGame(db, gameId);
  if (!game) return { success: false, error: "Game not found" };

  const persistedState = JSON.parse(game.state_json);
  const turn = persistedState.game.turn;
  const existingResults = getTurnResults(db, gameId, turn);
  if (existingResults) {
    return parseStoredTurnResults(existingResults, turn);
  }

  if (isTurnProcessing(gameId)) {
    return { success: false, error: "Turn processing already in progress" };
  }

  const readiness = await checkOrdersReady(db, gameId);
  if (!readiness.ready) {
    return { success: false, error: `Orders still missing for: ${readiness.missing.join(", ")}` };
  }

  const config = getGameConfig(db, gameId);
  const terrainData = game.terrain_json ? JSON.parse(game.terrain_json) : null;
  let resultsStored = false;

  _turnProcessingInProgress.add(gameId);
  setGamePhase(db, gameId, persistedState, PHASES.ADJUDICATING);
  clearTurnDeadline(db, gameId);

  try {
    return await runWithServerRequestContext(config.apiKeys, async () => {
      let gameState = persistedState;

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

      const effectiveTerrain = buildEffectiveTerrain(terrainData, gameState.terrainMods);
      const previousVisibilityState = turn > 1 ? parseVisibilityState(getTurnResults(db, gameId, turn - 1)) : null;
      const detectionResult = computeDetection(gameState, effectiveTerrain, sealedOrders, previousVisibilityState);
      const movementResult = simulateMovement(gameState, effectiveTerrain, sealedOrders, previousVisibilityState);
      const visibilityState = movementResult?.finalVisibility || detectionResult;

      if (movementResult?.finalPositions) {
        gameState = {
          ...gameState,
          units: gameState.units.map(u => {
            const pos = movementResult.finalPositions[u.id];
            return pos ? { ...u, position: pos } : u;
          }),
        };
      }

      const logEntries = [];
      const serverLogger = {
        log: (loggedTurn, type, data) => logEntries.push({ turn: loggedTurn, type, data, timestamp: new Date().toISOString() }),
      };

      const adjResult = await adjudicate(
        gameState,
        playerActions,
        terrainData,
        serverLogger,
        structuredOrders,
        { visibilityState },
        null
      );

      if (adjResult.error && !adjResult.adjudication) {
        appendGameLog(db, { gameId, turn, type: "adjudication_failed", dataJson: JSON.stringify({ error: adjResult.error }) });
        setGamePhase(db, gameId, persistedState, PHASES.PLANNING);
        return { success: false, error: adjResult.error };
      }

      if (config.moderationMode === "player") {
        const llmConfig = config.llm || { provider: "anthropic", model: "claude-sonnet-4-20250514" };
        try {
          const auditResults = await auditAllNarratives(
            adjResult.adjudication,
            visibilityState,
            gameState,
            llmConfig,
            null
          );
          if (auditResults.length > 0) {
            appendGameLog(db, {
              gameId,
              turn,
              type: "narrative_audit",
              dataJson: JSON.stringify({ corrected: auditResults }),
            });
          }
        } catch (auditErr) {
          appendGameLog(db, {
            gameId,
            turn,
            type: "narrative_audit_error",
            dataJson: JSON.stringify({ error: auditErr.message }),
          });
        }
      }

      const actorResults = {};
      const players = getPlayersForGame(db, gameId);
      for (const player of players) {
        actorResults[player.actor_id] = filterAdjudicationForActor(
          adjResult.adjudication,
          player.actor_id,
          visibilityState,
          gameState
        );
      }

      saveTurnResults(db, {
        gameId,
        turn,
        masterJson: JSON.stringify(adjResult.adjudication),
        actorResultsJson: JSON.stringify(actorResults),
        visibilityJson: JSON.stringify(serializeVisibility(visibilityState)),
      });
      resultsStored = true;

      for (const entry of logEntries) {
        appendGameLog(db, { gameId, turn: entry.turn, type: entry.type, dataJson: JSON.stringify(entry.data) });
      }

      setGamePhase(db, gameId, persistedState, PHASES.REVIEW);
      return {
        success: true,
        adjudication: adjResult.adjudication,
        actorResults,
        turn,
      };
    });
  } catch (err) {
    setGamePhase(db, gameId, persistedState, resultsStored ? PHASES.REVIEW : PHASES.PLANNING);
    return { success: false, error: err.message };
  } finally {
    _turnProcessingInProgress.delete(gameId);
  }
}

// ============================================================================
// Finalization and Rebuttals
// ============================================================================

export function finalizeTurn(db, gameId, adjudication, playerActions = {}) {
  const game = getGame(db, gameId);
  if (!game) return { success: false, error: "Game not found" };

  let gameState = ensureAiState(JSON.parse(game.state_json));
  const currentTurn = gameState.game.turn;
  const orderRows = getOrdersForTurn(db, gameId, currentTurn);
  const structuredPlayerActions = Object.fromEntries(orderRows.map((row) => [row.actor_id, JSON.parse(row.orders_json)]));
  gameState = applyStateUpdates(
    gameState,
    adjudication,
    Object.keys(structuredPlayerActions).length > 0 ? structuredPlayerActions : playerActions
  );
  const players = getPlayersForGame(db, gameId);
  gameState = updateAIOperationalState(gameState, players, orderRows);
  gameState = advanceTurn(gameState);

  updateGameState(db, gameId, JSON.stringify(gameState));

  const deadlineHours = game.turn_deadline_hours || 24;
  setTurnDeadline(db, gameId, deadlineHours);

  appendGameLog(db, {
    gameId,
    turn: gameState.game.turn - 1,
    type: "turn_finalized",
    dataJson: JSON.stringify({ newTurn: gameState.game.turn }),
  });

  generateAndSubmitAIOrders(db, gameId).catch(e => {
    appendGameLog(db, { gameId, turn: gameState.game.turn, type: "ai_order_error", dataJson: JSON.stringify({ error: e.message }) });
  });

  return { success: true, newState: gameState };
}

export async function processRebuttal(db, gameId, challenges, counterRebuttals, originalResult) {
  const game = getGame(db, gameId);
  if (!game) return { success: false, error: "Game not found" };
  if (isTurnProcessing(gameId)) {
    return { success: false, error: "Turn processing already in progress" };
  }

  const persistedState = JSON.parse(game.state_json);
  const turn = persistedState.game.turn;
  const storedTurnResults = getTurnResults(db, gameId, turn);
  const storedVisibilityJson = storedTurnResults?.visibility_json || null;
  const visibilityState = storedVisibilityJson ? deserializeVisibility(JSON.parse(storedVisibilityJson)) : null;
  const config = getGameConfig(db, gameId);

  _turnProcessingInProgress.add(gameId);
  setGamePhase(db, gameId, persistedState, PHASES.RE_ADJUDICATING);

  try {
    return await runWithServerRequestContext(config.apiKeys, async () => {
      const gameState = persistedState;
      const terrainData = game.terrain_json ? JSON.parse(game.terrain_json) : null;

      const orderRows = getOrdersForTurn(db, gameId, turn);
      const playerActions = {};
      const structuredOrders = { unitOrders: {}, actorIntents: {} };
      for (const row of orderRows) {
        const orders = JSON.parse(row.orders_json);
        playerActions[row.actor_id] = orders.actorIntent || "";
        structuredOrders.unitOrders[row.actor_id] = orders.unitOrders || {};
        structuredOrders.actorIntents[row.actor_id] = orders.actorIntent || "";
      }

      const serverLogger = { log: () => {} };
      const rebuttalResult = await adjudicateRebuttal(
        gameState,
        playerActions,
        terrainData,
        originalResult,
        challenges,
        serverLogger,
        counterRebuttals,
        null,
        structuredOrders,
        null
      );

      if (rebuttalResult.error && !rebuttalResult.adjudication) {
        setGamePhase(db, gameId, persistedState, PHASES.REVIEW);
        return { success: false, error: rebuttalResult.error };
      }

      const players = getPlayersForGame(db, gameId);
      const actorResults = {};
      for (const player of players) {
        actorResults[player.actor_id] = filterAdjudicationForActor(
          rebuttalResult.adjudication,
          player.actor_id,
          visibilityState,
          gameState
        );
      }

      saveTurnResults(db, {
        gameId,
        turn,
        masterJson: JSON.stringify(rebuttalResult.adjudication),
        actorResultsJson: JSON.stringify(actorResults),
        visibilityJson: storedVisibilityJson,
      });

      setGamePhase(db, gameId, persistedState, PHASES.REVIEW);
      return {
        success: true,
        adjudication: rebuttalResult.adjudication,
        actorResults,
      };
    });
  } catch (err) {
    setGamePhase(db, gameId, persistedState, PHASES.REVIEW);
    return { success: false, error: err.message };
  } finally {
    _turnProcessingInProgress.delete(gameId);
  }
}
