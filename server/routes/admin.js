// ═══════════════════════════════════════════════════════════════
// ADMIN ROUTES — Moderator/game-creator API endpoints.
// Moderator-authed routes require the game's moderator_token.
// Some routes (create game, join game, list games) are open.
// ═══════════════════════════════════════════════════════════════

import { Router } from "express";
import { randomBytes } from "crypto";
import { authenticateModerator } from "../auth.js";
import {
  createGame, getGame, updateGameState, updateGameStatus,
  listGames, addPlayer, joinGame, getPlayersForGame,
  getOrdersForTurn, getTurnResults, getDecisionsForTurn,
  getGameLog, setTurnDeadline,
} from "../db.js";
import { checkOrdersReady, processTurn, finalizeTurn } from "../gameEngine.js";
import { createGame as createGameState } from "../../src/simulation/orchestrator.js";
import { notifyInvite, notifyTurnResults, notifyYourTurn } from "../email.js";

const router = Router();

// ── Create Game (no auth — returns moderator token) ──────────

router.post("/games", (req, res) => {
  const db = req.app.locals.db;
  const { name, scenario, terrainData, config, turnDeadlineHours, apiKeys } = req.body;

  if (!name || !scenario) {
    return res.status(400).json({ error: "Missing required fields: name, scenario" });
  }

  const llmConfig = config?.llm || {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    temperature: 0.4,
  };
  const gameState = createGameState({
    scenario,
    terrainRef: null,
    terrainData: terrainData || null,
    llmConfig,
  });

  const gameId = randomBytes(4).toString("hex");

  // Merge API keys into config so gameEngine can load them per-game.
  // Keys are stored in config_json — never returned to players.
  const fullConfig = { ...(config || {}) };
  if (apiKeys) {
    fullConfig.apiKeys = {};
    if (apiKeys.anthropicKey) fullConfig.apiKeys.anthropicKey = apiKeys.anthropicKey;
    if (apiKeys.openaiKey) fullConfig.apiKeys.openaiKey = apiKeys.openaiKey;
  }

  const { moderatorToken } = createGame(db, {
    id: gameId,
    name,
    stateJson: JSON.stringify(gameState),
    terrainJson: terrainData ? JSON.stringify(terrainData) : null,
    configJson: JSON.stringify(fullConfig),
    turnDeadlineHours: turnDeadlineHours || 24,
  });

  // Set initial turn deadline
  const deadlineHours = turnDeadlineHours || 24;
  setTurnDeadline(db, gameId, deadlineHours);

  // Auto-create player slots for each actor in the scenario
  const inviteTokens = {};
  for (const actor of scenario.actors || []) {
    const { inviteToken } = addPlayer(db, {
      gameId,
      actorId: actor.id,
      actorName: actor.name,
      email: actor.email || null,
      isAi: actor.isAi || false,
      aiConfigJson: actor.aiConfig ? JSON.stringify(actor.aiConfig) : null,
    });
    inviteTokens[actor.id] = inviteToken;
  }

  // Fire-and-forget invite emails for actors that have email addresses
  for (const actor of scenario.actors || []) {
    if (actor.email && inviteTokens[actor.id]) {
      notifyInvite({
        email: actor.email,
        actorName: actor.name,
        gameName: name,
        inviteToken: inviteTokens[actor.id],
      }).catch(() => {}); // non-blocking
    }
  }

  res.status(201).json({
    gameId,
    moderatorToken,
    inviteTokens,
  });
});

// ── Join Game (no auth — consumes invite token) ──────────────

router.post("/join", (req, res) => {
  const db = req.app.locals.db;
  const { inviteToken } = req.body;

  if (!inviteToken) {
    return res.status(400).json({ error: "Missing inviteToken" });
  }

  const result = joinGame(db, inviteToken);
  if (!result) {
    return res.status(404).json({ error: "Invalid or expired invite token" });
  }

  if (result.alreadyJoined) {
    return res.json({
      sessionToken: result.sessionToken,
      alreadyJoined: true,
    });
  }

  res.json({
    sessionToken: result.sessionToken,
    gameId: result.gameId,
    actorId: result.actorId,
    actorName: result.actorName,
  });
});

// ── List Games (no auth — dashboard) ─────────────────────────

router.get("/games", (req, res) => {
  const db = req.app.locals.db;
  const games = listGames(db);
  res.json(games);
});

// ── All routes below require moderator auth ──────────────────

router.use("/games/:gameId", authenticateModerator);

// ── Game State (full god-view) ───────────────────────────────

router.get("/games/:gameId/state", (req, res) => {
  const gameState = JSON.parse(req.game.state_json);
  res.json(gameState);
});

// ── Players List ─────────────────────────────────────────────

router.get("/games/:gameId/players", (req, res) => {
  const db = req.app.locals.db;
  const players = getPlayersForGame(db, req.gameId);
  // Redact tokens from response
  const safe = players.map(p => ({
    actorId: p.actor_id,
    actorName: p.actor_name,
    email: p.email,
    isAi: !!p.is_ai,
    joined: !!p.joined_at,
    joinedAt: p.joined_at,
  }));
  res.json(safe);
});

// ── Order Status ─────────────────────────────────────────────

router.get("/games/:gameId/orders-status", (req, res) => {
  const db = req.app.locals.db;
  const readiness = checkOrdersReady(db, req.gameId);
  res.json(readiness);
});

// ── Trigger Turn Processing ──────────────────────────────────

router.post("/games/:gameId/process-turn", async (req, res) => {
  const db = req.app.locals.db;

  try {
    const result = await processTurn(db, req.gameId);
    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    // Notify all players that results are ready
    const players = getPlayersForGame(db, req.gameId);
    const game = getGame(db, req.gameId);
    for (const p of players) {
      if (p.email && !p.is_ai) {
        notifyTurnResults({
          email: p.email,
          actorName: p.actor_name,
          gameName: game.name,
          turn: result.turn,
        }).catch(() => {});
      }
    }

    res.json({ ok: true, turn: result.turn });
  } catch (e) {
    res.status(500).json({ error: "Turn processing failed" });
  }
});

// ── Finalize Turn (after review) ─────────────────────────────

router.post("/games/:gameId/finalize-turn", (req, res) => {
  const db = req.app.locals.db;
  const game = getGame(db, req.gameId);
  if (!game) return res.status(404).json({ error: "Game not found" });

  const turn = JSON.parse(game.state_json).game.turn;
  const turnResults = getTurnResults(db, req.gameId, turn);

  if (!turnResults) {
    return res.status(400).json({ error: "No turn results to finalize" });
  }

  const adjudication = JSON.parse(turnResults.master_adjudication_json);

  // Reconstruct playerActions from sealed orders
  const orderRows = getOrdersForTurn(db, req.gameId, turn);
  const playerActions = {};
  for (const row of orderRows) {
    const orders = JSON.parse(row.orders_json);
    playerActions[row.actor_id] = orders.actorIntent || "";
  }

  const result = finalizeTurn(db, req.gameId, adjudication, playerActions);

  if (!result.success) {
    return res.status(500).json({ error: result.error });
  }

  // Notify all players it's their turn to submit orders for the new turn
  const players = getPlayersForGame(db, req.gameId);
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

  res.json({ ok: true, newTurn: result.newState.game.turn });
});

// ── Pause / Resume / End ─────────────────────────────────────

router.post("/games/:gameId/pause", (req, res) => {
  const db = req.app.locals.db;
  updateGameStatus(db, req.gameId, "paused");
  res.json({ ok: true });
});

router.post("/games/:gameId/resume", (req, res) => {
  const db = req.app.locals.db;
  updateGameStatus(db, req.gameId, "active");
  res.json({ ok: true });
});

router.post("/games/:gameId/end", (req, res) => {
  const db = req.app.locals.db;
  updateGameStatus(db, req.gameId, "ended");
  res.json({ ok: true });
});

// ── Game Log (full) ──────────────────────────────────────────

router.get("/games/:gameId/log", (req, res) => {
  const db = req.app.locals.db;
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const log = getGameLog(db, req.gameId, { limit });
  res.json(log);
});

export default router;
