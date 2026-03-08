// ═══════════════════════════════════════════════════════════════
// GAME ROUTES — Player-facing API endpoints.
// All routes require authenticatePlayer middleware (Bearer token).
// Players can only see data for their own actor within their game.
// ═══════════════════════════════════════════════════════════════

import { Router } from "express";
import { authenticatePlayer } from "../auth.js";
import {
  getGame, getGameConfig, getPlayersForGame, submitOrders, getPlayerOrders,
  getTurnResults, getOrdersForTurn, setActorDecision, getDecisionsForTurn,
  appendGameLog, getGameLog, hashOrders,
  saveDraftOrders, getDraftOrders, deleteDraftOrders,
} from "../db.js";
import { checkOrdersReady, processTurn, finalizeTurn, processRebuttal } from "../gameEngine.js";
import { filterAdjudicationForActor } from "../../src/simulation/adjudicationFilter.js";
import { buildActorBriefing } from "../../src/simulation/briefingExport.js";
import { notifyAllOrdersIn, notifyChallengeRaised, notifyTurnResults, notifyYourTurn } from "../email.js";

const router = Router();

// All game routes require player authentication
router.use(authenticatePlayer);

// ── Game State (filtered for this actor) ─────────────────────

router.get("/state", (req, res) => {
  const db = req.app.locals.db;
  const game = getGame(db, req.gameId);
  if (!game) return res.status(404).json({ error: "Game not found" });

  const gameState = JSON.parse(game.state_json);
  const terrainData = game.terrain_json ? JSON.parse(game.terrain_json) : null;

  // Filter game state for this actor's visibility.
  // In planning phase: show only own units + last known enemy positions.
  // In review phase: show filtered adjudication.
  const actorUnits = gameState.units.filter(u => u.actor === req.actorId);

  // Get visibility state from most recent turn results (if any)
  const prevTurn = gameState.game.turn - 1;
  const prevResults = prevTurn >= 1 ? getTurnResults(db, req.gameId, prevTurn) : null;
  let knownEnemyUnits = [];

  if (prevResults?.visibility_json) {
    const vis = JSON.parse(prevResults.visibility_json);
    const actorVis = vis?.actorVisibility?.[req.actorId];
    if (actorVis) {
      // Show detected and contact-tier enemy units at last known positions
      const detectedIds = new Set([
        ...(actorVis.detectedUnits || []),
        ...(actorVis.contactUnits || []),
      ]);
      knownEnemyUnits = gameState.units
        .filter(u => u.actor !== req.actorId && detectedIds.has(u.id))
        .map(u => ({
          id: u.id,
          name: u.name,
          type: u.type,
          position: u.position,
          // Contact-tier units get limited info
          ...(actorVis.contactUnits?.includes(u.id) ? { detectionTier: "contact" } : { detectionTier: "identified" }),
        }));
    }
  }

  // Game metadata visible to all players
  const gameMeta = {
    id: game.id,
    name: game.name,
    status: game.status,
    turn: gameState.game.turn,
    phase: gameState.game.phase,
    currentDate: gameState.game.currentDate,
    scale: gameState.game.scale,
  };

  // Scenario info (minus actor details for other players)
  const scenarioInfo = {
    name: gameState.scenario?.name,
    era: gameState.scenario?.era,
    turnDuration: gameState.scenario?.turnDuration,
    actors: gameState.scenario?.actors?.map(a => ({
      id: a.id,
      name: a.name,
      affiliation: a.affiliation,
    })),
  };

  // Check if this player has submitted orders for current turn
  const currentOrders = getPlayerOrders(db, req.gameId, req.actorId, gameState.game.turn);

  // Expose moderation mode so client knows processing flow
  const config = getGameConfig(db, req.gameId);

  res.json({
    game: gameMeta,
    scenario: scenarioInfo,
    myUnits: actorUnits,
    knownEnemyUnits,
    environment: gameState.environment,
    ordersSubmitted: !!currentOrders,
    ordersHash: currentOrders?.orders_hash || null,
    moderationMode: config.moderationMode || "human",
  });
});

// ── Terrain Data ─────────────────────────────────────────────
// Terrain is shared — all players see the same map

router.get("/terrain", (req, res) => {
  const db = req.app.locals.db;
  const game = getGame(db, req.gameId);
  if (!game) return res.status(404).json({ error: "Game not found" });

  if (!game.terrain_json) {
    return res.status(404).json({ error: "No terrain data for this game" });
  }

  res.json(JSON.parse(game.terrain_json));
});

// ── Submit Orders ────────────────────────────────────────────

router.post("/orders", (req, res) => {
  const db = req.app.locals.db;
  const game = getGame(db, req.gameId);
  if (!game) return res.status(404).json({ error: "Game not found" });

  const gameState = JSON.parse(game.state_json);

  // Only accept orders during planning phase
  if (gameState.game.phase !== "planning") {
    return res.status(400).json({ error: `Cannot submit orders during ${gameState.game.phase} phase` });
  }

  const { unitOrders, actorIntent } = req.body;
  if (!unitOrders || typeof unitOrders !== "object") {
    return res.status(400).json({ error: "Missing or invalid unitOrders" });
  }

  // Validate that all ordered units belong to this actor
  const actorUnitIds = new Set(
    gameState.units.filter(u => u.actor === req.actorId).map(u => u.id)
  );
  for (const unitId of Object.keys(unitOrders)) {
    if (!actorUnitIds.has(unitId)) {
      return res.status(403).json({ error: `Unit ${unitId} does not belong to you` });
    }
  }

  // Sanitize actor intent text (prevent prompt injection)
  const sanitizedIntent = sanitizePlayerText(actorIntent || "");

  const ordersJson = JSON.stringify({
    unitOrders,
    actorIntent: sanitizedIntent,
  });

  const { hash } = submitOrders(db, {
    gameId: req.gameId,
    actorId: req.actorId,
    turn: gameState.game.turn,
    ordersJson,
  });

  appendGameLog(db, {
    gameId: req.gameId,
    turn: gameState.game.turn,
    type: "orders_submitted",
    dataJson: JSON.stringify({ actorId: req.actorId, hash }),
  });

  // Clear draft since orders are now sealed
  deleteDraftOrders(db, req.gameId, req.actorId);

  // Check if all players have submitted — if so, notify moderator
  const readiness = checkOrdersReady(db, req.gameId);

  if (readiness.ready) {
    notifyAllOrdersIn({
      email: null,
      gameName: game.name,
      turn: gameState.game.turn,
    }).catch(() => {});

    // Player Moderator mode: auto-process turn when all orders are in.
    // No human moderator needed — server runs adjudication immediately.
    const config = getGameConfig(db, req.gameId);
    if (config.moderationMode === "player") {
      // Fire-and-forget — don't block the response
      processTurn(db, req.gameId).then(result => {
        if (result.success) {
          const players = getPlayersForGame(db, req.gameId);
          for (const p of players) {
            if (p.email && !p.is_ai) {
              notifyTurnResults({ email: p.email, actorName: p.actor_name, gameName: game.name, turn: result.turn }).catch(() => {});
            }
          }
          appendGameLog(db, { gameId: req.gameId, turn: result.turn, type: "auto_processed", dataJson: JSON.stringify({ mode: "player" }) });
        }
      }).catch(() => {});
    }
  }

  res.json({
    ok: true,
    hash,
    allReady: readiness.ready,
    submitted: readiness.submitted,
    missing: readiness.missing,
  });
});

// ── Draft Orders (Google Docs-style auto-save) ─────────────

router.post("/draft-orders", (req, res) => {
  const db = req.app.locals.db;
  const { unitOrders, actorIntent } = req.body;

  saveDraftOrders(db, {
    gameId: req.gameId,
    actorId: req.actorId,
    draftJson: JSON.stringify({ unitOrders: unitOrders || {}, actorIntent: actorIntent || "" }),
  });

  res.json({ ok: true });
});

router.get("/draft-orders", (req, res) => {
  const db = req.app.locals.db;
  const draft = getDraftOrders(db, req.gameId, req.actorId);

  if (!draft) return res.json({ draft: null });

  res.json({
    draft: JSON.parse(draft.draft_json),
    updatedAt: draft.updated_at,
  });
});

// ── Turn Results (filtered for this actor) ───────────────────

router.get("/results/:turn", (req, res) => {
  const db = req.app.locals.db;
  const turn = parseInt(req.params.turn, 10);
  if (isNaN(turn)) return res.status(400).json({ error: "Invalid turn number" });

  const results = getTurnResults(db, req.gameId, turn);
  if (!results) return res.status(404).json({ error: "No results for this turn" });

  // Return only this actor's filtered view
  const actorResults = JSON.parse(results.actor_results_json || "{}");
  const myResults = actorResults[req.actorId] || null;

  res.json({
    turn,
    adjudication: myResults,
    processedAt: results.processed_at,
  });
});

// ── Accept / Challenge ───────────────────────────────────────

router.post("/decision", (req, res) => {
  const db = req.app.locals.db;
  const game = getGame(db, req.gameId);
  if (!game) return res.status(404).json({ error: "Game not found" });

  const gameState = JSON.parse(game.state_json);
  const { decision, challengeText, rebuttalText, challengedUnitIds } = req.body;

  if (!["accept", "challenge"].includes(decision)) {
    return res.status(400).json({ error: "Decision must be 'accept' or 'challenge'" });
  }

  const sanitizedChallenge = sanitizePlayerText(challengeText || "");
  const sanitizedRebuttal = sanitizePlayerText(rebuttalText || "");

  setActorDecision(db, {
    gameId: req.gameId,
    actorId: req.actorId,
    turn: gameState.game.turn,
    decision,
    challengeText: sanitizedChallenge,
    rebuttalText: sanitizedRebuttal,
    challengedUnitIds: challengedUnitIds || null,
  });

  appendGameLog(db, {
    gameId: req.gameId,
    turn: gameState.game.turn,
    type: "actor_decision",
    dataJson: JSON.stringify({ actorId: req.actorId, decision }),
  });

  const decisions = getDecisionsForTurn(db, req.gameId, gameState.game.turn);
  const players = getPlayersForGame(db, req.gameId);
  const allDecided = players.every(p => decisions.find(d => d.actor_id === p.actor_id));

  if (decision === "challenge") {
    for (const p of players) {
      if (p.actor_id !== req.actorId && p.email && !p.is_ai) {
        notifyChallengeRaised({
          email: p.email,
          actorName: p.actor_name,
          gameName: game.name,
          turn: gameState.game.turn,
        }).catch(() => {});
      }
    }
  }

  // Player Moderator mode: auto-finalize or auto-rebuttal when all decided
  if (allDecided) {
    const config = getGameConfig(db, req.gameId);
    if (config.moderationMode === "player") {
      const hasChallenges = decisions.some(d => d.decision === "challenge");

      if (hasChallenges) {
        // Collect challenge/rebuttal data and re-adjudicate
        const turnResults = getTurnResults(db, req.gameId, gameState.game.turn);
        if (turnResults) {
          const originalResult = JSON.parse(turnResults.master_adjudication_json);
          const challengeData = decisions.filter(d => d.decision === "challenge").map(d => ({
            actorId: d.actor_id,
            text: d.challenge_text || "",
          }));
          const rebuttalData = decisions.filter(d => d.rebuttal_text).map(d => ({
            actorId: d.actor_id,
            text: d.rebuttal_text,
          }));

          // Fire-and-forget rebuttal processing
          processRebuttal(db, req.gameId, challengeData, rebuttalData, originalResult).then(result => {
            if (result.success) {
              // Auto-finalize after successful rebuttal
              autoFinalize(db, req.gameId, game);
            }
          }).catch(() => {});
        }
      } else {
        // All accepted — auto-finalize immediately
        autoFinalize(db, req.gameId, game);
      }
    }
  }

  res.json({
    ok: true,
    allDecided,
    decisions: decisions.map(d => ({ actorId: d.actor_id, decision: d.decision })),
  });
});

// ── Challenge Details (FOW-aware routing) ──────────────────
// Returns challenges from other actors, filtered by FOW.
// Visible challenged units → full text. Hidden → vague notification.

router.get("/challenges", (req, res) => {
  const db = req.app.locals.db;
  const game = getGame(db, req.gameId);
  if (!game) return res.status(404).json({ error: "Game not found" });

  const gameState = JSON.parse(game.state_json);
  const turn = gameState.game.turn;

  const decisions = getDecisionsForTurn(db, req.gameId, turn);
  const challenges = decisions.filter(d => d.decision === "challenge" && d.actor_id !== req.actorId);

  if (challenges.length === 0) return res.json({ challenges: [] });

  // Load visibility state for FOW check
  const turnResults = getTurnResults(db, req.gameId, turn);
  const visibility = turnResults?.visibility_json ? JSON.parse(turnResults.visibility_json) : null;
  const myVisibility = visibility?.actorVisibility?.[req.actorId];
  const myVisibleUnits = new Set([
    ...(myVisibility?.detectedUnits || []),
    ...(myVisibility?.contactUnits || []),
    // Own units are always "visible" to self
    ...gameState.units.filter(u => u.actor === req.actorId).map(u => u.id),
  ]);

  const filtered = challenges.map(c => {
    const challengedIds = c.challenged_unit_ids ? JSON.parse(c.challenged_unit_ids) : [];
    const challengerActor = gameState.scenario?.actors?.find(a => a.id === c.actor_id);
    const challengerName = challengerActor?.name || c.actor_id;

    // Check if ANY of the challenged units are visible to this player
    const visibleChallengedUnits = challengedIds.filter(uid => myVisibleUnits.has(uid));
    const hasVisibleUnits = visibleChallengedUnits.length > 0;

    if (hasVisibleUnits) {
      // Player can see the challenged units → show full challenge text
      return {
        actorId: c.actor_id,
        actorName: challengerName,
        challengeText: c.challenge_text,
        challengedUnitIds: challengedIds,
        visible: true,
      };
    }
    // Player cannot see the challenged units → vague notification
    return {
      actorId: c.actor_id,
      actorName: challengerName,
      challengeText: null,
      challengedUnitIds: [],
      visible: false,
      blindMessage: `${challengerName} challenges a ruling about unit(s) you cannot see.`,
    };
  });

  res.json({ challenges: filtered });
});

// ── Briefing (FOW-filtered markdown) ─────────────────────────

router.get("/briefing", (req, res) => {
  const db = req.app.locals.db;
  const game = getGame(db, req.gameId);
  if (!game) return res.status(404).json({ error: "Game not found" });

  const gameState = JSON.parse(game.state_json);
  const terrainData = game.terrain_json ? JSON.parse(game.terrain_json) : null;

  const briefing = buildActorBriefing(gameState, req.actorId, terrainData);

  res.type("text/markdown").send(briefing);
});

// ── Game Events (own events only) ────────────────────────────
// Named "events" instead of "log" to avoid collision with Vite's
// /api/game/log middleware (used for hotseat game logging).

router.get("/events", (req, res) => {
  const db = req.app.locals.db;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

  const log = getGameLog(db, req.gameId, { limit });

  // Filter log entries to only show non-sensitive ones
  // (e.g., don't show other players' order hashes, internal errors with paths)
  const filtered = log
    .map(entry => {
      const data = entry.data_json ? JSON.parse(entry.data_json) : {};
      // Redact other actors' data
      if (data.actorId && data.actorId !== req.actorId) {
        return { ...entry, data_json: JSON.stringify({ actorId: data.actorId, type: entry.type }) };
      }
      return entry;
    });

  res.json(filtered);
});

// ── Player Status (who's submitted orders) ───────────────────

router.get("/status", (req, res) => {
  const db = req.app.locals.db;
  const readiness = checkOrdersReady(db, req.gameId);

  // Include turn deadline so client can show countdown
  const game = getGame(db, req.gameId);

  // Don't reveal which specific actors submitted — just counts
  res.json({
    turn: readiness.turn,
    totalPlayers: readiness.submitted.length + readiness.missing.length,
    submittedCount: readiness.submitted.length,
    iSubmitted: readiness.submitted.includes(req.actorId),
    allReady: readiness.ready,
    deadlineAt: game?.turn_deadline_at || null,
  });
});


// ── Helpers ──────────────────────────────────────────────────

/**
 * Auto-finalize turn in Player Moderator mode.
 * Applies state updates, advances turn, notifies players.
 */
function autoFinalize(db, gameId, game) {
  const gameState = JSON.parse(game.state_json);
  const turn = gameState.game.turn;
  const turnResults = getTurnResults(db, gameId, turn);
  if (!turnResults) return;

  const adjudication = JSON.parse(turnResults.master_adjudication_json);

  // Reconstruct playerActions from sealed orders
  const orderRows = getOrdersForTurn(db, gameId, turn);
  const playerActions = {};
  for (const row of orderRows) {
    const orders = JSON.parse(row.orders_json);
    playerActions[row.actor_id] = orders.actorIntent || "";
  }

  const result = finalizeTurn(db, gameId, adjudication, playerActions);
  if (result.success) {
    const players = getPlayersForGame(db, gameId);
    for (const p of players) {
      if (p.email && !p.is_ai) {
        notifyYourTurn({
          email: p.email,
          actorName: p.actor_name,
          gameName: game.name,
          turn: result.newState.game.turn,
          deadlineHours: game.turn_deadline_hours,
        }).catch(() => {});
      }
    }
    appendGameLog(db, { gameId, turn, type: "auto_finalized", dataJson: JSON.stringify({ mode: "player" }) });
  }
}

/**
 * Sanitize player-provided text to prevent prompt injection.
 * Strips obvious injection patterns but preserves normal game text.
 */
function sanitizePlayerText(text) {
  if (typeof text !== "string") return "";
  return text
    .slice(0, 2000) // hard length cap
    .replace(/```/g, "") // no code fences
    .replace(/<[^>]+>/g, "") // no HTML tags
    .replace(/\{[^}]*\}/g, "") // no JSON-like blocks
    .trim();
}

export default router;
