// ═══════════════════════════════════════════════════════════════
// SERVER — Standalone Express server for PBEM multiplayer.
// Replaces the Vite dev server plugins with a production-ready
// server that handles auth, game state, and LLM proxying.
//
// Usage:
//   Development: node server/index.js
//   Production:  NODE_ENV=production node server/index.js
//
// Environment variables:
//   PORT               - Server port (default: 3001)
//   ANTHROPIC_API_KEY  - For LLM adjudication
//   OPENAI_API_KEY     - Alternative LLM provider
//   DB_PATH            - SQLite database path (default: ./data/open-conflict.db)
//   CORS_ORIGIN        - Allowed CORS origin (default: http://localhost:5173)
// ═══════════════════════════════════════════════════════════════

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { getDb, getGamesWithExpiredDeadlines, getOrdersForTurn, getPlayersForGame, submitOrders, appendGameLog, clearTurnDeadline, getGameConfig } from "./db.js";
import { initEmail, notifyTurnResults } from "./email.js";
import { checkOrdersReady, processTurn } from "./gameEngine.js";

// Route modules
import gameRoutes from "./routes/game.js";
import adminRoutes from "./routes/admin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const IS_PROD = process.env.NODE_ENV === "production";

const app = express();

// ── Middleware ────────────────────────────────────────────────

// CORS — restrict in production, permissive in development
const corsOrigin = process.env.CORS_ORIGIN || (IS_PROD ? false : "http://localhost:5173");
app.use(cors({ origin: corsOrigin, credentials: true }));

// Body parsing with size limit (security: prevent huge payloads)
app.use(express.json({ limit: "10mb" }));

// Rate limiting — global baseline
const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 120, // 120 requests/minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, slow down" },
});
app.use(globalLimiter);

// Stricter rate limit for LLM-touching endpoints
const llmLimiter = rateLimit({
  windowMs: 60_000,
  max: 10, // 10 LLM calls/minute per IP
  message: { error: "Too many LLM requests, please wait" },
});

// Stricter rate limit for auth-related endpoints (join, create)
const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  message: { error: "Too many auth requests" },
});

// ── Database ─────────────────────────────────────────────────

const db = getDb();
app.locals.db = db;

// ── Request timeout ──────────────────────────────────────────
// LLM calls can take up to 15 minutes. Set server-wide timeout
// high, but most endpoints will respond much faster.

app.use((req, res, next) => {
  // 15 min timeout for turn processing, 30s for everything else
  const isLongRunning = req.path.includes("process-turn") || req.path.includes("adjudicate");
  req.setTimeout(isLongRunning ? 900_000 : 30_000);
  next();
});

// ── Health Check ─────────────────────────────────────────────

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    env: IS_PROD ? "production" : "development",
  });
});

// ── API Routes ───────────────────────────────────────────────

// Rate limiters must be registered BEFORE route handlers so they
// actually execute. Express processes middleware in registration order.
app.use("/api/admin/games/:gameId/process-turn", llmLimiter);
app.use("/api/admin/join", authLimiter);
app.use("/api/admin/games", authLimiter);

// Player-facing game API (requires session token)
app.use("/api/game", gameRoutes);

// Admin/moderator API
app.use("/api/admin", adminRoutes);

// ── Legacy Dev Endpoints ─────────────────────────────────────
// These mirror the Vite plugin endpoints so the existing client
// code works during the transition period. They should be removed
// once the client is fully updated to use the new API.

// Save/load terrain files (used by Parser)
app.post("/api/save", (req, res) => {
  const { filename, data } = req.body;
  if (!filename || !data) return res.status(400).json({ ok: false, error: "Missing filename or data" });

  const savesDir = path.resolve(process.cwd(), "saves");
  if (!fs.existsSync(savesDir)) fs.mkdirSync(savesDir, { recursive: true });

  // Sanitize filename — no path traversal, no leading dots
  const safe = filename.replace(/[^a-zA-Z0-9_\-\.]/g, "_").replace(/^\.+/, "").slice(0, 200);
  const filepath = path.join(savesDir, safe);

  // Verify resolved path is still inside saves/ (prevent traversal)
  if (!filepath.startsWith(savesDir)) {
    return res.status(400).json({ ok: false, error: "Invalid filename" });
  }

  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  res.json({ ok: true, path: `saves/${safe}` });
});

app.get("/api/saves", (req, res) => {
  const savesDir = path.resolve(process.cwd(), "saves");
  if (!fs.existsSync(savesDir)) return res.json([]);

  const files = fs.readdirSync(savesDir)
    .filter(f => f.endsWith(".json"))
    .map(f => {
      const stat = fs.statSync(path.join(savesDir, f));
      return { name: f, size: stat.size, modified: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.modified.localeCompare(a.modified));

  res.json(files);
});

app.get("/api/load", (req, res) => {
  const file = req.query.file;
  if (!file) return res.status(400).json({ error: "Missing file param" });

  const safe = file.replace(/[^a-zA-Z0-9_\-\.]/g, "_").replace(/^\.+/, "");
  const savesDir = path.resolve(process.cwd(), "saves");
  const filepath = path.join(savesDir, safe);

  if (!filepath.startsWith(savesDir) || !fs.existsSync(filepath)) {
    return res.status(404).json({ error: "Not found" });
  }

  res.setHeader("Content-Type", "application/json");
  res.send(fs.readFileSync(filepath, "utf8"));
});

// ── Static Files (production) ────────────────────────────────
// In production, serve the Vite build output

if (IS_PROD) {
  const distPath = path.resolve(__dirname, "..", "dist");
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    // SPA fallback — serve index.html for all non-API routes
    app.get("*", (req, res) => {
      if (!req.path.startsWith("/api")) {
        res.sendFile(path.join(distPath, "index.html"));
      }
    });
  }
}

// ── Error Handler ────────────────────────────────────────────
// Generic error handler — don't leak internal paths or stack traces

app.use((err, req, res, _next) => {
  console.error(`[${new Date().toISOString()}] Error:`, err.message);
  // In production, hide error details
  const message = IS_PROD ? "Internal server error" : err.message;
  res.status(err.status || 500).json({ error: message });
});

// ── Turn Deadline Checker ─────────────────────────────────────
// Runs every 5 minutes. For Player Moderator games with expired
// deadlines, auto-submits HOLD orders for missing players, then
// triggers turn processing. For Human Moderator games, just logs.

const DEADLINE_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function checkDeadlines() {
  try {
    const expired = getGamesWithExpiredDeadlines(db);
    for (const game of expired) {
      const gameState = JSON.parse(game.state_json);
      const turn = gameState.game.turn;
      const config = getGameConfig(db, game.id);

      appendGameLog(db, {
        gameId: game.id, turn,
        type: "deadline_expired",
        dataJson: JSON.stringify({ deadline: game.turn_deadline_at }),
      });

      if (config.moderationMode === "player") {
        // Auto-submit empty (HOLD) orders for missing players
        const readiness = checkOrdersReady(db, game.id);
        for (const actorId of readiness.missing) {
          submitOrders(db, {
            gameId: game.id, actorId, turn,
            ordersJson: JSON.stringify({ unitOrders: {}, actorIntent: "[Auto-hold: deadline expired]" }),
          });
          appendGameLog(db, {
            gameId: game.id, turn,
            type: "auto_hold",
            dataJson: JSON.stringify({ actorId, reason: "deadline_expired" }),
          });
        }

        // Now process the turn
        const result = await processTurn(db, game.id);
        if (result.success) {
          const players = getPlayersForGame(db, game.id);
          for (const p of players) {
            if (p.email && !p.is_ai) {
              notifyTurnResults({ email: p.email, actorName: p.actor_name, gameName: game.name, turn: result.turn }).catch(() => {});
            }
          }
        }
      } else {
        // Human Moderator mode — just clear the deadline and log
        clearTurnDeadline(db, game.id);
        console.log(`[Deadline] Game ${game.id} ("${game.name}") turn ${turn} deadline expired. Awaiting moderator action.`);
      }
    }
  } catch (err) {
    console.error("[Deadline checker error]", err.message);
  }
}

// ── Start ────────────────────────────────────────────────────

// Initialize email service (non-blocking — logs to console if SMTP not configured)
initEmail();

const server = app.listen(PORT, () => {
  console.log(`Open Conflict server running on port ${PORT} (${IS_PROD ? "production" : "development"})`);
  console.log(`Database: ${process.env.DB_PATH || "data/open-conflict.db"}`);

  // Start periodic deadline checker
  setInterval(checkDeadlines, DEADLINE_CHECK_INTERVAL_MS);
  console.log(`Turn deadline checker running (every ${DEADLINE_CHECK_INTERVAL_MS / 60000}min)`);
});

// Match Vite's timeouts for LLM calls
server.requestTimeout = 900_000;
server.headersTimeout = 900_000;
server.timeout = 900_000;

export default app;
