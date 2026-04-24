import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import {
  getDb,
  getGamesWithExpiredDeadlines,
  getOrdersForTurn,
  getPlayersForGame,
  submitOrders,
  appendGameLog,
  clearTurnDeadline,
  getGameConfig,
} from "./db.js";
import { initEmail, notifyTurnResults } from "./email.js";
import { checkOrdersReady, processTurn } from "./gameEngine.js";
import { callLLM } from "./llmProxy.js";

import gameRoutes from "./routes/game.js";
import adminRoutes from "./routes/admin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const IS_PROD = process.env.NODE_ENV === "production";
const MAX_JSON_BODY = "50mb";

const app = express();

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function gamesRoot() {
  return ensureDir(path.resolve(process.cwd(), "games"));
}

function legacyGamesDir() {
  return ensureDir(path.resolve(process.cwd(), "saves", "games"));
}

function presetsDir() {
  return ensureDir(path.join(gamesRoot(), "presets"));
}

function isInsideDir(baseDir, targetPath) {
  const base = path.resolve(baseDir);
  const target = path.resolve(targetPath);
  return target === base || target.startsWith(`${base}${path.sep}`);
}

function sanitizeFolderName(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_\-]/g, "_");
}

function sanitizeFilename(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_\-\.]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 200);
}

function slugifyGameName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s\-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100) || "unnamed-game";
}

function uniqueFolderName(baseName) {
  const root = gamesRoot();
  let folder = baseName;
  let index = 2;
  while (fs.existsSync(path.join(root, folder))) {
    folder = `${baseName}-${index++}`;
  }
  return folder;
}

function buildConfiguredProviders() {
  const providers = [];

  if (process.env.ANTHROPIC_API_KEY) {
    providers.push({
      id: "anthropic",
      name: "Anthropic",
      models: [
        { id: "claude-sonnet-4-6", temperature: null },
        { id: "claude-haiku-4-5-20251001", temperature: null },
      ],
    });
  }

  if (process.env.OPENAI_API_KEY) {
    providers.push({
      id: "openai",
      name: "OpenAI",
      models: [
        { id: "gpt-4o", temperature: null },
        { id: "gpt-4o-mini", temperature: null },
        { id: "gpt-5.2", temperature: null },
        { id: "gpt-5.3-chat-latest", temperature: 1 },
        { id: "gpt-5.4", temperature: null },
        { id: "gpt-5.4-pro", temperature: null },
      ],
    });
  }

  return providers;
}

const PROXY_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "cache-control",
  "etag",
  "last-modified",
  "accept-ranges",
  "content-range",
  "content-encoding",
];

async function readRequestBody(req, maxSize = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxSize) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function proxyFixedHost(req, res, targetOrigin) {
  try {
    const method = (req.method || "GET").toUpperCase();
    const headers = {};
    for (const [name, value] of Object.entries(req.headers || {})) {
      const lower = name.toLowerCase();
      if (lower === "host" || lower === "connection" || lower === "content-length") continue;
      if (value !== undefined) headers[lower] = value;
    }

    const init = { method, headers };
    if (method !== "GET" && method !== "HEAD") {
      init.body = await readRequestBody(req);
    }

    const upstream = await fetch(`${targetOrigin}${req.url}`, init);
    res.status(upstream.status);
    for (const headerName of PROXY_RESPONSE_HEADERS) {
      const headerValue = upstream.headers.get(headerName);
      if (headerValue) res.setHeader(headerName, headerValue);
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    return res.end(body);
  } catch (error) {
    return res.status(502).json({ ok: false, error: `Proxy request failed: ${error.message}` });
  }
}
const corsOrigin = process.env.CORS_ORIGIN || (IS_PROD ? false : "http://localhost:5173");
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: MAX_JSON_BODY }));

const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, slow down" },
});
app.use(globalLimiter);

const configuredLlmLimit = Number.parseInt(process.env.LLM_RATE_LIMIT_MAX || "", 10);
const llmRequestsPerMinute = Number.isFinite(configuredLlmLimit) && configuredLlmLimit > 0
  ? configuredLlmLimit
  : (IS_PROD ? 60 : 300);

const llmLimiter = rateLimit({
  windowMs: 60_000,
  max: llmRequestsPerMinute,
  message: { error: "Too many LLM requests, please wait" },
});

const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  message: { error: "Too many auth requests" },
});

const db = getDb();
app.locals.db = db;

app.use((req, res, next) => {
  const isLongRunning = req.path.includes("process-turn") || req.path.includes("adjudicate");
  req.setTimeout(isLongRunning ? 900_000 : 30_000);
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    env: IS_PROD ? "production" : "development",
  });
});

app.use("/api/topo", (req, res) => proxyFixedHost(req, res, "https://api.opentopodata.org"));
app.use("/api/wc", (req, res) => proxyFixedHost(req, res, "https://esa-worldcover.s3.eu-central-1.amazonaws.com"));
app.use("/api/srtm", (req, res) => proxyFixedHost(req, res, "https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com"));
app.use("/api/llm/adjudicate", llmLimiter);
app.use("/api/admin/games/:gameId/process-turn", llmLimiter);
app.use("/api/admin/join", authLimiter);
app.use("/api/admin/games", authLimiter);

app.get("/api/llm/providers", (_req, res) => {
  res.json({ providers: buildConfiguredProviders() });
});

app.post("/api/llm/adjudicate", async (req, res) => {
  const { provider, model, temperature, messages, max_tokens: maxTokens, budget_key: budgetKey } = req.body || {};
  if (!provider || !model || !Array.isArray(messages)) {
    return res.status(400).json({ ok: false, error: "Missing required fields: provider, model, messages" });
  }

  let heartbeat;
  try {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
    });

    heartbeat = setInterval(() => {
      try {
        res.write(" ");
      } catch {
        // Connection already closed.
      }
    }, 15_000);

    const result = await callLLM(provider, model, messages, {
      temperature,
      maxTokens,
      budgetKey,
    });

    return res.end(JSON.stringify(result));
  } catch (error) {
    return res.end(JSON.stringify({ ok: false, error: error.message }));
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat);
    }
  }
});

app.post("/api/netlog/save", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/auditlog/save", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/game/create", (req, res) => {
  try {
    const { name, terrainData } = req.body || {};
    if (!name || !terrainData) {
      return res.status(400).json({ ok: false, error: "Missing name or terrainData" });
    }

    const folder = uniqueFolderName(slugifyGameName(name));
    const folderPath = path.join(gamesRoot(), folder);
    fs.mkdirSync(folderPath, { recursive: true });
    fs.writeFileSync(path.join(folderPath, "terrain.json"), JSON.stringify(terrainData));

    return res.json({ ok: true, folder });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/game/save", (req, res) => {
  try {
    const { filename, data } = req.body || {};
    if (!filename || !data) {
      return res.status(400).json({ ok: false, error: "Missing filename or data" });
    }

    const folder = data?.game?.folder;
    if (folder) {
      const safeFolder = sanitizeFolderName(folder);
      const folderPath = path.join(gamesRoot(), safeFolder);
      if (!isInsideDir(gamesRoot(), folderPath) || !fs.existsSync(folderPath)) {
        return res.status(400).json({ ok: false, error: "Invalid game folder" });
      }

      const mode = String(data?.game?.mode || "turn");
      const autosaveToken = String(filename);
      const isTurnAutosave = /_autosave_t\d+/.test(autosaveToken);
      const isRtsAutosave = /autosave_rts_\d+/.test(autosaveToken);
      const saveName = isTurnAutosave
        ? `autosave_t${data.game?.turn || 0}.json`
        : isRtsAutosave
          ? autosaveToken.match(/autosave_rts_\d+/)?.[0] + ".json"
          : "state.json";
      fs.writeFileSync(path.join(folderPath, saveName), JSON.stringify(data, null, 2));
      return res.json({ ok: true, path: `games/${safeFolder}/${saveName}` });
    }

    const safeFilename = sanitizeFilename(filename);
    const filePath = path.join(legacyGamesDir(), safeFilename);
    if (!isInsideDir(legacyGamesDir(), filePath)) {
      return res.status(400).json({ ok: false, error: "Invalid filename" });
    }

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return res.json({ ok: true, path: `saves/games/${safeFilename}` });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

function buildGameListEntry({ content, stat, file, folder, isAutosave }) {
  const mode = content.game?.mode || "turn";
  return {
    file,
    folder,
    name: content.game?.name || file,
    size: stat.size,
    modified: stat.mtime.toISOString(),
    mode,
    turn: mode === "turn" ? (content.game?.turn || null) : null,
    elapsedMs: mode === "rts" ? (content.game?.elapsedMs || 0) : null,
    paused: mode === "rts" ? Boolean(content.game?.paused) : null,
    speed: mode === "rts" ? (content.game?.speed || 1) : null,
    winner: mode === "rts" ? (content.game?.winner || null) : null,
    status: content.game?.status || null,
    terrainRef: content.terrain?._ref || null,
    actorCount: content.scenario?.actors?.length || 0,
    unitCount: content.units?.length || 0,
    isAutosave,
    autosaveLabel: mode === "rts"
      ? (String(file).match(/autosave_rts_(\d+)\.json$/)?.[1] || null)
      : (String(file).match(/autosave_t(\d+)\.json$/)?.[1] || null),
    gameId: content.game?.id || null,
  };
}

app.get("/api/game/list", (_req, res) => {
  const results = [];

  for (const entry of fs.readdirSync(gamesRoot(), { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "presets") {
      continue;
    }

    const folderPath = path.join(gamesRoot(), entry.name);
    const statePath = path.join(folderPath, "state.json");
    let autosaveFiles = [];
    try {
      autosaveFiles = fs.readdirSync(folderPath).filter((file) =>
        (file.startsWith("autosave_t") || file.startsWith("autosave_rts_")) && file.endsWith(".json")
      );
    } catch {
      autosaveFiles = [];
    }
    if (!fs.existsSync(statePath) && autosaveFiles.length === 0) {
      continue;
    }

    try {
      if (fs.existsSync(statePath)) {
        const stat = fs.statSync(statePath);
        const content = JSON.parse(fs.readFileSync(statePath, "utf8"));
        results.push(buildGameListEntry({ content, stat, file: entry.name, folder: entry.name, isAutosave: false }));
      }

      for (const file of autosaveFiles) {
        const autoPath = path.join(folderPath, file);
        const autoStat = fs.statSync(autoPath);
        let autoContent;
        try {
          autoContent = JSON.parse(fs.readFileSync(autoPath, "utf8"));
        } catch {
          continue;
        }
        results.push(buildGameListEntry({
          content: autoContent,
          stat: autoStat,
          file: `${entry.name}/${file}`,
          folder: entry.name,
          isAutosave: true,
        }));
      }
    } catch {
      // Skip unreadable folders.
    }
  }

  for (const file of fs.readdirSync(legacyGamesDir())) {
    if (!file.endsWith(".json") || file.endsWith("_log.json")) {
      continue;
    }
    try {
      const filePath = path.join(legacyGamesDir(), file);
      const stat = fs.statSync(filePath);
      const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (content.game?.folder) {
        continue;
      }
      results.push(buildGameListEntry({
        content,
        stat,
        file,
        folder: null,
        isAutosave: /(_autosave_t\d+|autosave_rts_\d+)\.json$/.test(file),
      }));
    } catch {
      // Skip unreadable files.
    }
  }

  results.sort((a, b) => b.modified.localeCompare(a.modified));
  res.json(results);
});

app.get("/api/game/load", (req, res) => {
  const folder = req.query.folder;
  const file = req.query.file;
  const autosaveTurn = req.query.autosave;
  const autosaveFile = req.query.autosaveFile;

  if (folder) {
    const safeFolder = sanitizeFolderName(folder);
    const folderPath = path.join(gamesRoot(), safeFolder);
    if (!isInsideDir(gamesRoot(), folderPath) || !fs.existsSync(folderPath)) {
      return res.status(404).send("Game folder not found");
    }

    const filename = autosaveFile
      ? sanitizeFilename(String(autosaveFile))
      : autosaveTurn
        ? `autosave_t${autosaveTurn}.json`
        : "state.json";
    let filePath = path.join(folderPath, filename);
    if (!fs.existsSync(filePath) && filename === "state.json") {
      const autosaves = fs.readdirSync(folderPath)
        .filter((name) => (name.startsWith("autosave_t") || name.startsWith("autosave_rts_")) && name.endsWith(".json"))
        .map((name) => ({
          name,
          modified: fs.statSync(path.join(folderPath, name)).mtimeMs,
        }))
        .sort((left, right) => right.modified - left.modified);
      if (autosaves.length > 0) {
        filePath = path.join(folderPath, autosaves[0].name);
      }
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).send("State file not found");
    }

    return res.type("application/json").send(fs.readFileSync(filePath, "utf8"));
  }

  if (file) {
    const safeFile = sanitizeFilename(file);
    const filePath = path.join(legacyGamesDir(), safeFile);
    if (!isInsideDir(legacyGamesDir(), filePath) || !fs.existsSync(filePath)) {
      return res.status(404).send("Not found");
    }

    return res.type("application/json").send(fs.readFileSync(filePath, "utf8"));
  }

  return res.status(400).send("Missing folder or file param");
});

app.get("/api/game/load-terrain", (req, res) => {
  const folder = req.query.folder;
  if (!folder) {
    return res.status(400).send("Missing folder param");
  }

  const safeFolder = sanitizeFolderName(folder);
  const filePath = path.join(gamesRoot(), safeFolder, "terrain.json");
  if (!isInsideDir(gamesRoot(), filePath) || !fs.existsSync(filePath)) {
    return res.status(404).send("Terrain not found");
  }

  return res.type("application/json").send(fs.readFileSync(filePath, "utf8"));
});

app.get("/api/game/preset-terrain", (req, res) => {
  const preset = req.query.preset;
  if (!preset) {
    return res.status(400).json({ ok: false, error: "Missing preset param" });
  }

  const safePreset = sanitizeFolderName(preset);
  const filePath = path.join(presetsDir(), `${safePreset}.json`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ ok: false, error: "Preset terrain not found. Generate it first." });
  }

  return res.type("application/json").send(fs.readFileSync(filePath, "utf8"));
});

app.post("/api/game/save-preset-terrain", (req, res) => {
  try {
    const { presetId, terrainData } = req.body || {};
    if (!presetId || !terrainData) {
      return res.status(400).json({ ok: false, error: "Missing presetId or terrainData" });
    }

    const safePreset = sanitizeFolderName(presetId);
    fs.writeFileSync(path.join(presetsDir(), `${safePreset}.json`), JSON.stringify(terrainData));
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/game/log", (req, res) => {
  try {
    const { gameId, folder, entries } = req.body || {};
    if (!Array.isArray(entries) || (!gameId && !folder)) {
      return res.status(400).json({ ok: false, error: "Missing gameId/folder or entries" });
    }

    let logPath;
    if (folder) {
      const safeFolder = sanitizeFolderName(folder);
      const folderPath = path.join(gamesRoot(), safeFolder);
      ensureDir(folderPath);
      logPath = path.join(folderPath, "log.json");
    } else {
      const safeGameId = sanitizeFilename(gameId);
      logPath = path.join(legacyGamesDir(), `${safeGameId}_log.json`);
    }

    let existing = [];
    if (fs.existsSync(logPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(logPath, "utf8"));
      } catch {
        existing = [];
      }
    }

    existing.push(...entries);
    fs.writeFileSync(logPath, JSON.stringify(existing, null, 2));
    return res.json({ ok: true, count: existing.length });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/game/save-artifact", (req, res) => {
  try {
    const { folder, filename, data } = req.body || {};
    if (!folder || !filename || data === undefined) {
      return res.status(400).json({ ok: false, error: "Missing folder, filename, or data" });
    }

    const safeFolder = sanitizeFolderName(folder);
    const safeFilename = sanitizeFilename(filename);
    const folderPath = path.join(gamesRoot(), safeFolder);
    ensureDir(folderPath);
    if (!isInsideDir(gamesRoot(), folderPath)) {
      return res.status(400).json({ ok: false, error: "Invalid folder" });
    }

    const filePath = path.join(folderPath, safeFilename);
    fs.writeFileSync(filePath, typeof data === "string" ? data : JSON.stringify(data, null, 2));
    return res.json({ ok: true, path: `games/${safeFolder}/${safeFilename}` });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.delete("/api/game/delete", (req, res) => {
  try {
    const folder = req.query.folder;
    const autosaveTurn = req.query.autosave;
    const autosaveFile = req.query.autosaveFile;
    const file = req.query.file;

    if (folder && (autosaveTurn != null || autosaveFile)) {
      const safeFolder = sanitizeFolderName(folder);
      const targetFile = autosaveFile
        ? sanitizeFilename(String(autosaveFile))
        : `autosave_t${Number.parseInt(String(autosaveTurn), 10)}.json`;
      if (!/^autosave_(t\d+|rts_\d+)\.json$/.test(targetFile)) {
        return res.status(400).json({ ok: false, error: "Invalid autosave filename" });
      }
      const filePath = path.join(gamesRoot(), safeFolder, targetFile);
      if (!isInsideDir(gamesRoot(), filePath)) {
        return res.status(400).json({ ok: false, error: "Invalid path" });
      }
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return res.json({ ok: true });
    }

    if (file) {
      const safeFile = sanitizeFilename(file);
      if (!/(_autosave_t\d+|autosave_rts_\d+)\.json$/.test(safeFile)) {
        return res.status(403).json({ ok: false, error: "Only autosave files can be deleted" });
      }

      const filePath = path.join(legacyGamesDir(), safeFile);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return res.json({ ok: true });
    }

    return res.status(400).send("Missing folder+autosave or file param");
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.use("/api/game", gameRoutes);
app.use("/api/admin", adminRoutes);

app.post("/api/save", (req, res) => {
  const { filename, data } = req.body || {};
  if (!filename || !data) {
    return res.status(400).json({ ok: false, error: "Missing filename or data" });
  }

  const savesDir = ensureDir(path.resolve(process.cwd(), "saves"));
  const safeFilename = sanitizeFilename(filename);
  const filePath = path.join(savesDir, safeFilename);
  if (!isInsideDir(savesDir, filePath)) {
    return res.status(400).json({ ok: false, error: "Invalid filename" });
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return res.json({ ok: true, path: `saves/${safeFilename}` });
});

app.get("/api/saves", (_req, res) => {
  const savesDir = path.resolve(process.cwd(), "saves");
  if (!fs.existsSync(savesDir)) {
    return res.json([]);
  }

  const files = fs.readdirSync(savesDir)
    .filter(file => file.endsWith(".json"))
    .map(file => {
      const stat = fs.statSync(path.join(savesDir, file));
      return { name: file, size: stat.size, modified: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.modified.localeCompare(a.modified));

  return res.json(files);
});

app.get("/api/load", (req, res) => {
  const file = req.query.file;
  if (!file) {
    return res.status(400).json({ error: "Missing file param" });
  }

  const safeFile = sanitizeFilename(file);
  const savesDir = path.resolve(process.cwd(), "saves");
  const filePath = path.join(savesDir, safeFile);
  if (!isInsideDir(savesDir, filePath) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Not found" });
  }

  return res.type("application/json").send(fs.readFileSync(filePath, "utf8"));
});

if (IS_PROD) {
  const distPath = path.resolve(__dirname, "..", "dist");
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      if (!req.path.startsWith("/api")) {
        res.sendFile(path.join(distPath, "index.html"));
      }
    });
  }
}

app.use((err, _req, res, _next) => {
  console.error(`[${new Date().toISOString()}] Error:`, err.message);
  const message = IS_PROD ? "Internal server error" : err.message;
  res.status(err.status || 500).json({ error: message });
});

const DEADLINE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

async function checkDeadlines() {
  try {
    const expired = getGamesWithExpiredDeadlines(db);
    for (const game of expired) {
      const gameState = JSON.parse(game.state_json);
      const turn = gameState.game.turn;
      const config = getGameConfig(db, game.id);

      appendGameLog(db, {
        gameId: game.id,
        turn,
        type: "deadline_expired",
        dataJson: JSON.stringify({ deadline: game.turn_deadline_at }),
      });

      if (config.moderationMode === "player") {
        const readiness = await checkOrdersReady(db, game.id);
        for (const actorId of readiness.missing) {
          submitOrders(db, {
            gameId: game.id,
            actorId,
            turn,
            ordersJson: JSON.stringify({ unitOrders: {}, actorIntent: "[Auto-hold: deadline expired]" }),
          });
          appendGameLog(db, {
            gameId: game.id,
            turn,
            type: "auto_hold",
            dataJson: JSON.stringify({ actorId, reason: "deadline_expired" }),
          });
        }

        const result = await processTurn(db, game.id);
        if (result.success) {
          const players = getPlayersForGame(db, game.id);
          for (const player of players) {
            if (player.email && !player.is_ai) {
              notifyTurnResults({
                email: player.email,
                actorName: player.actor_name,
                gameName: game.name,
                turn: result.turn,
              }).catch(() => {});
            }
          }
        }
      } else {
        clearTurnDeadline(db, game.id);
        console.log(`[Deadline] Game ${game.id} ("${game.name}") turn ${turn} deadline expired. Awaiting moderator action.`);
      }
    }
  } catch (error) {
    console.error("[Deadline checker error]", error.message);
  }
}

initEmail();

const server = app.listen(PORT, () => {
  console.log(`Open Conflict server running on port ${PORT} (${IS_PROD ? "production" : "development"})`);
  console.log(`Database: ${process.env.DB_PATH || "data/open-conflict.db"}`);
  setInterval(checkDeadlines, DEADLINE_CHECK_INTERVAL_MS);
  console.log(`Turn deadline checker running (every ${DEADLINE_CHECK_INTERVAL_MS / 60000}min)`);
});

server.requestTimeout = 900_000;
server.headersTimeout = 900_000;
server.timeout = 900_000;

export default app;
