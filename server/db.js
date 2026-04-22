// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DATABASE â€” SQLite persistence layer for PBEM game state.
// Uses better-sqlite3 (synchronous, zero-config, single file).
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

import Database from "better-sqlite3";
import { randomBytes, createHash } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "open-conflict.db");

let _db = null;

/** Get or create the database connection. Auto-creates tables on first call. */
export function getDb() {
  if (_db) return _db;

  // Ensure data directory exists
  const dir = path.dirname(DB_PATH);
  fs.mkdirSync(dir, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL"); // better concurrency
  _db.pragma("foreign_keys = ON");
  initSchema(_db);
  return _db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'setup',
      moderator_token TEXT NOT NULL,
      state_json TEXT NOT NULL DEFAULT '{}',
      terrain_json TEXT,
      config_json TEXT NOT NULL DEFAULT '{}',
      turn_deadline_hours INTEGER DEFAULT 24
    );

    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      actor_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      email TEXT,
      session_token TEXT UNIQUE,
      invite_token TEXT UNIQUE,
      joined_at TEXT,
      is_ai INTEGER NOT NULL DEFAULT 0,
      ai_config_json TEXT,
      UNIQUE(game_id, actor_id)
    );

    CREATE TABLE IF NOT EXISTS sealed_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      actor_id TEXT NOT NULL,
      turn INTEGER NOT NULL,
      orders_json TEXT NOT NULL,
      orders_hash TEXT NOT NULL,
      submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(game_id, actor_id, turn)
    );

    CREATE TABLE IF NOT EXISTS turn_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      turn INTEGER NOT NULL,
      master_adjudication_json TEXT,
      actor_results_json TEXT,
      visibility_json TEXT,
      processed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(game_id, turn)
    );

    CREATE TABLE IF NOT EXISTS actor_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      actor_id TEXT NOT NULL,
      turn INTEGER NOT NULL,
      decision TEXT NOT NULL DEFAULT 'pending',
      challenge_text TEXT,
      rebuttal_text TEXT,
      decided_at TEXT,
      UNIQUE(game_id, actor_id, turn)
    );

    CREATE TABLE IF NOT EXISTS game_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      turn INTEGER,
      type TEXT NOT NULL,
      data_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS draft_orders (
      game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      actor_id TEXT NOT NULL,
      draft_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (game_id, actor_id)
    );

    CREATE INDEX IF NOT EXISTS idx_players_session ON players(session_token);
    CREATE INDEX IF NOT EXISTS idx_players_invite ON players(invite_token);
    CREATE INDEX IF NOT EXISTS idx_sealed_orders_game_turn ON sealed_orders(game_id, turn);
    CREATE INDEX IF NOT EXISTS idx_game_log_game ON game_log(game_id);
  `);

  // Migration: add challenged_unit_ids to actor_decisions (safe if already exists)
  try {
    db.prepare("ALTER TABLE actor_decisions ADD COLUMN challenged_unit_ids TEXT").run();
  } catch { /* column already exists */ }

  // Migration: add turn_deadline_at to games for timeout tracking
  try {
    db.prepare("ALTER TABLE games ADD COLUMN turn_deadline_at TEXT").run();
  } catch { /* column already exists */ }
}

// â”€â”€ Token generation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function generateToken() {
  return randomBytes(32).toString("hex");
}

export function hashOrders(orders) {
  const canonical = JSON.stringify(orders, Object.keys(orders).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

// â”€â”€ Game CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function createGame(db, { id, name, stateJson, terrainJson, configJson, turnDeadlineHours }) {
  const moderatorToken = generateToken();
  db.prepare(`
    INSERT INTO games (id, name, status, moderator_token, state_json, terrain_json, config_json, turn_deadline_hours)
    VALUES (?, ?, 'active', ?, ?, ?, ?, ?)
  `).run(id, name, moderatorToken, stateJson, terrainJson || null, configJson, turnDeadlineHours || 48);
  return { moderatorToken };
}

export function getGame(db, gameId) {
  // Deliberately excludes config_json â€” it contains API keys that should
  // never leak into request context or API responses. Use getGameConfig()
  // when you specifically need the config (e.g., loading per-game API keys).
  return db.prepare(
    "SELECT id, name, created_at, status, moderator_token, state_json, terrain_json, turn_deadline_hours, turn_deadline_at FROM games WHERE id = ?"
  ).get(gameId);
}

/** Load only the config_json for a game. Used by gameEngine to retrieve per-game API keys. */
export function getGameConfig(db, gameId) {
  const row = db.prepare("SELECT config_json FROM games WHERE id = ?").get(gameId);
  return row?.config_json ? JSON.parse(row.config_json) : {};
}

export function updateGameState(db, gameId, stateJson) {
  db.prepare("UPDATE games SET state_json = ? WHERE id = ?").run(stateJson, gameId);
}

export function updateGameStatus(db, gameId, status) {
  db.prepare("UPDATE games SET status = ? WHERE id = ?").run(status, gameId);
}

export function listGames(db) {
  return db.prepare("SELECT id, name, status, created_at, turn_deadline_hours FROM games ORDER BY created_at DESC").all();
}

// â”€â”€ Player CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function addPlayer(db, { gameId, actorId, actorName, email, isAi, aiConfigJson }) {
  const inviteToken = generateToken();
  db.prepare(`
    INSERT INTO players (game_id, actor_id, actor_name, email, invite_token, is_ai, ai_config_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(gameId, actorId, actorName, email || null, inviteToken, isAi ? 1 : 0, aiConfigJson || null);
  return { inviteToken };
}

export function joinGame(db, inviteToken) {
  const player = db.prepare("SELECT * FROM players WHERE invite_token = ?").get(inviteToken);
  if (!player) return null;
  if (player.session_token) return { sessionToken: player.session_token, alreadyJoined: true };

  const sessionToken = generateToken();
  db.prepare(`
    UPDATE players SET session_token = ?, joined_at = datetime('now'), invite_token = NULL
    WHERE id = ?
  `).run(sessionToken, player.id);

  return { sessionToken, gameId: player.game_id, actorId: player.actor_id, actorName: player.actor_name };
}

export function getPlayerByToken(db, sessionToken) {
  return db.prepare("SELECT * FROM players WHERE session_token = ?").get(sessionToken);
}

export function getPlayersForGame(db, gameId) {
  return db.prepare("SELECT * FROM players WHERE game_id = ? ORDER BY actor_id").all(gameId);
}

// â”€â”€ Sealed Orders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function submitOrders(db, { gameId, actorId, turn, ordersJson }) {
  const hash = hashOrders(JSON.parse(ordersJson));
  db.prepare(`
    INSERT OR REPLACE INTO sealed_orders (game_id, actor_id, turn, orders_json, orders_hash, submitted_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(gameId, actorId, turn, ordersJson, hash);
  return { hash };
}

export function getOrdersForTurn(db, gameId, turn) {
  return db.prepare("SELECT * FROM sealed_orders WHERE game_id = ? AND turn = ?").all(gameId, turn);
}

export function getPlayerOrders(db, gameId, actorId, turn) {
  return db.prepare("SELECT * FROM sealed_orders WHERE game_id = ? AND actor_id = ? AND turn = ?").get(gameId, actorId, turn);
}

// â”€â”€ Turn Results â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function saveTurnResults(db, { gameId, turn, masterJson, actorResultsJson, visibilityJson }) {
  db.prepare(`
    INSERT OR REPLACE INTO turn_results (game_id, turn, master_adjudication_json, actor_results_json, visibility_json, processed_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(gameId, turn, masterJson, actorResultsJson, visibilityJson);
}

export function getTurnResults(db, gameId, turn) {
  return db.prepare("SELECT * FROM turn_results WHERE game_id = ? AND turn = ?").get(gameId, turn);
}

// â”€â”€ Actor Decisions (accept/challenge/rebuttal) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function setActorDecision(db, { gameId, actorId, turn, decision, challengeText, rebuttalText, challengedUnitIds }) {
  db.prepare(`
    INSERT OR REPLACE INTO actor_decisions (game_id, actor_id, turn, decision, challenge_text, rebuttal_text, challenged_unit_ids, decided_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(gameId, actorId, turn, decision, challengeText || null, rebuttalText || null, challengedUnitIds ? JSON.stringify(challengedUnitIds) : null);
}

export function getDecisionsForTurn(db, gameId, turn) {
  return db.prepare("SELECT * FROM actor_decisions WHERE game_id = ? AND turn = ?").all(gameId, turn);
}

// â”€â”€ Game Log â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function appendGameLog(db, { gameId, turn, type, dataJson }) {
  db.prepare(`
    INSERT INTO game_log (game_id, turn, type, data_json, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(gameId, turn || null, type, dataJson || null);
}

export function getGameLog(db, gameId, { limit = 100, offset = 0 } = {}) {
  return db.prepare("SELECT * FROM game_log WHERE game_id = ? ORDER BY id DESC LIMIT ? OFFSET ?").all(gameId, limit, offset);
}

// â”€â”€ Draft Orders (auto-saved, Google Docs style) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function saveDraftOrders(db, { gameId, actorId, draftJson }) {
  db.prepare(`
    INSERT OR REPLACE INTO draft_orders (game_id, actor_id, draft_json, updated_at)
    VALUES (?, ?, ?, datetime('now'))
  `).run(gameId, actorId, draftJson);
}

export function getDraftOrders(db, gameId, actorId) {
  return db.prepare("SELECT * FROM draft_orders WHERE game_id = ? AND actor_id = ?").get(gameId, actorId);
}

export function deleteDraftOrders(db, gameId, actorId) {
  db.prepare("DELETE FROM draft_orders WHERE game_id = ? AND actor_id = ?").run(gameId, actorId);
}

// â”€â”€ Turn Deadline â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Set the deadline for the current turn. Called when a turn starts. */
export function setTurnDeadline(db, gameId, hoursFromNow) {
  const deadline = new Date(Date.now() + hoursFromNow * 3600000).toISOString();
  db.prepare("UPDATE games SET turn_deadline_at = ? WHERE id = ?").run(deadline, gameId);
  return deadline;
}

/** Clear the turn deadline (e.g., when all orders are in). */
export function clearTurnDeadline(db, gameId) {
  db.prepare("UPDATE games SET turn_deadline_at = NULL WHERE id = ?").run(gameId);
}

/**
 * Get all active games with expired turn deadlines.
 * Used by the timeout checker to find games that need auto-hold.
 */
export function getGamesWithExpiredDeadlines(db) {
  return db.prepare(`
    SELECT id, name, turn_deadline_hours, turn_deadline_at, state_json
    FROM games
    WHERE status = 'active'
      AND turn_deadline_at IS NOT NULL
      AND julianday(turn_deadline_at) < julianday('now')
  `).all();
}
