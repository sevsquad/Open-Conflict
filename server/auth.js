// ═══════════════════════════════════════════════════════════════
// AUTH — Token-based authentication middleware for PBEM routes.
// Two token types:
//   - session_token: per-player, grants access to their game/actor
//   - moderator_token: per-game, grants god-view admin access
// Tokens are 64-char hex strings from crypto.randomBytes(32).
// ═══════════════════════════════════════════════════════════════

import { timingSafeEqual } from "crypto";
import { getPlayerByToken, getGame } from "./db.js";

/**
 * Express middleware: extract Bearer token from Authorization header,
 * look up player row, attach { player, gameId, actorId } to req.
 *
 * Usage: router.get("/state", authenticatePlayer, handler)
 */
export function authenticatePlayer(req, res, next) {
  const db = req.app.locals.db;
  const token = extractBearerToken(req);

  if (!token) {
    return res.status(401).json({ error: "Missing Authorization header" });
  }

  const player = getPlayerByToken(db, token);
  if (!player) {
    return res.status(401).json({ error: "Invalid or expired session token" });
  }

  // Attach player context for downstream handlers
  req.player = player;
  req.gameId = player.game_id;
  req.actorId = player.actor_id;
  next();
}

/**
 * Express middleware: extract Bearer token, verify it matches
 * the moderator_token for the game specified in :gameId param.
 *
 * Usage: router.post("/games/:gameId/advance", authenticateModerator, handler)
 */
export function authenticateModerator(req, res, next) {
  const db = req.app.locals.db;
  const token = extractBearerToken(req);
  const gameId = req.params.gameId;

  if (!token) {
    return res.status(401).json({ error: "Missing Authorization header" });
  }
  if (!gameId) {
    return res.status(400).json({ error: "Missing gameId parameter" });
  }

  const game = getGame(db, gameId);
  if (!game) {
    return res.status(404).json({ error: "Game not found" });
  }

  // Constant-time comparison to prevent timing attacks
  const storedBuf = Buffer.from(game.moderator_token);
  const givenBuf = Buffer.from(token);
  if (storedBuf.length !== givenBuf.length || !timingSafeEqual(storedBuf, givenBuf)) {
    return res.status(403).json({ error: "Invalid moderator token" });
  }

  req.game = game;
  req.gameId = gameId;
  next();
}

/**
 * Extract Bearer token from Authorization header.
 * Accepts: "Bearer <token>" or raw "<token>"
 */
function extractBearerToken(req) {
  const header = req.headers.authorization;
  if (!header) return null;
  // Support both "Bearer xxx" and raw "xxx"
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  return header.trim();
}
