import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { Agent, setGlobalDispatcher } from 'undici'
import { callLLM } from './server/llmProxy.js'

// Node's native fetch uses undici with a default bodyTimeout of 300s.
// Override globally so ALL fetches (including to LLM APIs) get 15min timeouts.
// The per-fetch `dispatcher` option doesn't work reliably in all Node versions.
setGlobalDispatcher(new Agent({ bodyTimeout: 900_000, headersTimeout: 900_000 }));

// Plugin: raise Node's default HTTP server timeout (300s) to match our fetch timeouts
function serverTimeoutPlugin() {
  return {
    name: 'server-timeout',
    configureServer(server) {
      server.httpServer?.on('listening', () => {
        server.httpServer.requestTimeout = 900_000;
        server.httpServer.headersTimeout = 900_000;
        server.httpServer.timeout = 900_000;
      });
    }
  };
}

// Plugin: save terrain JSON to ./saves/ via POST /api/save
function savePlugin() {
  return {
    name: 'terrain-save',
    configureServer(server) {
      server.middlewares.use('/api/save', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const { filename, data } = JSON.parse(body);
            const savesDir = path.resolve(process.cwd(), 'saves');
            if (!fs.existsSync(savesDir)) fs.mkdirSync(savesDir, { recursive: true });
            // Sanitize filename — strip non-alphanumeric, strip leading dots (prevents .env etc)
            const safe = filename.replace(/[^a-zA-Z0-9_\-\.]/g, '_').replace(/^\.+/, '').slice(0, 200);
            if (!safe) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: 'Invalid filename' })); return; }
            const filepath = path.join(savesDir, safe);
            // Verify resolved path is inside saves/ (prevent path traversal)
            if (!filepath.startsWith(savesDir)) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: 'Invalid filename' })); return; }
            fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, path: `saves/${safe}` }));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: e.message }));
          }
        });
      });

      // List saved files
      server.middlewares.use('/api/saves', (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end('GET only'); return; }
        const savesDir = path.resolve(process.cwd(), 'saves');
        if (!fs.existsSync(savesDir)) { res.setHeader('Content-Type', 'application/json'); res.end('[]'); return; }
        const files = fs.readdirSync(savesDir)
          .filter(f => f.endsWith('.json'))
          .map(f => {
            const stat = fs.statSync(path.join(savesDir, f));
            return { name: f, size: stat.size, modified: stat.mtime.toISOString() };
          })
          .sort((a, b) => b.modified.localeCompare(a.modified));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(files));
      });

      // Load a saved file
      server.middlewares.use('/api/load', (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end('GET only'); return; }
        const url = new URL(req.url, 'http://localhost');
        const file = url.searchParams.get('file');
        if (!file) { res.statusCode = 400; res.end('Missing file param'); return; }
        const safe = file.replace(/[^a-zA-Z0-9_\-\.]/g, '_').replace(/^\.+/, '');
        const savesDir = path.resolve(process.cwd(), 'saves');
        const filepath = path.join(savesDir, safe);
        if (!filepath.startsWith(savesDir) || !fs.existsSync(filepath)) { res.statusCode = 404; res.end('Not found'); return; }
        res.setHeader('Content-Type', 'application/json');
        res.end(fs.readFileSync(filepath, 'utf8'));
      });
    }
  };
}

// Helper: read request body as text
function readBody(req, maxSize = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxSize) { reject(new Error('Request body too large')); req.destroy(); return; }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// Plugin: LLM API proxy — routes adjudication calls to Anthropic or OpenAI
function llmPlugin({ isProd }) {
  // In local dev, all-AI turns can legitimately burst many requests at once.
  // Keep protection in prod, but disable the local cap unless explicitly set.
  const llmRequestTimes = [];
  const configuredLlmLimit = Number.parseInt(process.env.LLM_RATE_LIMIT_MAX || '', 10);
  const llmRateLimit = Number.isFinite(configuredLlmLimit) && configuredLlmLimit > 0
    ? configuredLlmLimit
    : (isProd ? 60 : 0);
  const LLM_RATE_WINDOW = 60_000;

  return {
    name: 'llm-proxy',
    configureServer(server) {

      // POST /api/llm/adjudicate — proxy LLM API calls
      server.middlewares.use('/api/llm/adjudicate', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }

        // Rate limit check
        const now = Date.now();
        if (llmRateLimit > 0) {
          while (llmRequestTimes.length > 0 && llmRequestTimes[0] < now - LLM_RATE_WINDOW) llmRequestTimes.shift();
          llmRequestTimes.push(now);
          if (llmRequestTimes.length > llmRateLimit) {
            res.statusCode = 429;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'Rate limited: too many LLM requests' }));
            return;
          }
        }
        let heartbeat;
        try {
          const body = JSON.parse(await readBody(req));
          const { provider, model, temperature, messages, max_tokens: clientMaxTokens, budget_key: budgetKey } = body;

          if (!provider || !model || !messages) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'Missing required fields: provider, model, messages' }));
            return;
          }

          // Send response headers immediately and start a heartbeat to keep
          // the browser↔Vite TCP connection alive during long API calls.
          // Without this, idle-connection timeouts (browser, OS, router) kill
          // the socket after ~100-300s of silence.  JSON.parse ignores
          // leading whitespace, so the heartbeat spaces are harmless.
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
          heartbeat = setInterval(() => {
            try { res.write(' '); } catch (_) { /* connection already gone */ }
          }, 15_000);

          const proxyResult = await callLLM(
            provider,
            model,
            messages,
            {
              temperature: temperature ?? 0.4,
              maxTokens: clientMaxTokens || 8192,
              budgetKey,
            }
          );
          clearInterval(heartbeat);
          res.end(JSON.stringify(proxyResult));
          return;

          let result;
          try {

          if (provider === 'anthropic') {
            const apiKey = process.env.ANTHROPIC_API_KEY;
            if (!apiKey) {
              clearInterval(heartbeat);
              res.end(JSON.stringify({ ok: false, error: 'ANTHROPIC_API_KEY not configured' }));
              return;
            }
            // Anthropic Messages API
            const systemMsg = messages.find(m => m.role === 'system');
            const userMsgs = messages.filter(m => m.role !== 'system');
            // Client sends dynamic max_tokens based on scenario complexity;
            // Respect client's budget; floor at 4096, ceiling at 64000 (Sonnet max)
            const maxTokens = Math.min(Math.max(clientMaxTokens || 8192, 4096), 64000);
            const apiBody = {
              model,
              max_tokens: maxTokens,
              temperature: temperature ?? 0.4,
              messages: userMsgs
            };
            // Use block format with cache_control so the system prompt is cached
            // across turns within a game (saves ~90% input cost on cache hits)
            if (systemMsg) {
              apiBody.system = [{
                type: "text",
                text: systemMsg.content,
                cache_control: { type: "ephemeral" }
              }];
            }

            // 15 min timeout — cancel button is the user-facing escape
            const apiController = new AbortController();
            const apiTimeout = setTimeout(() => apiController.abort(), 900_000);

            let resp, data;
            try {
              resp = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-key': apiKey,
                  'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify(apiBody),
                signal: apiController.signal
              });
              data = await resp.json();
            } finally {
              clearTimeout(apiTimeout);
            }
            if (!resp.ok) {
              clearInterval(heartbeat);
              res.end(JSON.stringify({ ok: false, error: data.error?.message || JSON.stringify(data) }));
              return;
            }
            // Extract text content from Anthropic response
            const textContent = data.content?.find(c => c.type === 'text')?.text || '';
            result = {
              ok: true,
              content: textContent,
              usage: {
                input: data.usage?.input_tokens,
                output: data.usage?.output_tokens,
                cache_read: data.usage?.cache_read_input_tokens || 0,
                cache_creation: data.usage?.cache_creation_input_tokens || 0,
              },
              model: data.model,
              stop_reason: data.stop_reason
            };

          } else if (provider === 'openai') {
            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) {
              clearInterval(heartbeat);
              res.end(JSON.stringify({ ok: false, error: 'OPENAI_API_KEY not configured' }));
              return;
            }
            // OpenAI Chat Completions API
            const apiBody = {
              model,
              temperature: temperature ?? 0.4,
              messages,
              response_format: { type: 'json_object' }
            };

            const oaiController = new AbortController();
            const oaiTimeout = setTimeout(() => oaiController.abort(), 900_000);

            let resp, data;
            try {
              resp = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify(apiBody),
                signal: oaiController.signal
              });
              data = await resp.json();
            } finally {
              clearTimeout(oaiTimeout);
            }
            if (!resp.ok) {
              clearInterval(heartbeat);
              res.end(JSON.stringify({ ok: false, error: data.error?.message || JSON.stringify(data) }));
              return;
            }
            result = {
              ok: true,
              content: data.choices?.[0]?.message?.content || '',
              usage: {
                input: data.usage?.prompt_tokens,
                output: data.usage?.completion_tokens
              },
              model: data.model,
              stop_reason: data.choices?.[0]?.finish_reason
            };

          } else {
            clearInterval(heartbeat);
            res.end(JSON.stringify({ ok: false, error: `Unknown provider: ${provider}. Use 'anthropic' or 'openai'.` }));
            return;
          }

          } finally {
            clearInterval(heartbeat);
          }

          res.end(JSON.stringify(result));

        } catch (e) {
          if (heartbeat) clearInterval(heartbeat);
          // Headers already sent (writeHead 200 + heartbeat), so we can't
          // change status code.  Client checks data.ok, not HTTP status.
          if (e.name === 'AbortError') {
            res.end(JSON.stringify({ ok: false, error: 'Upstream API request timed out' }));
          } else {
            res.end(JSON.stringify({ ok: false, error: e.message }));
          }
        }
      });

      // GET /api/llm/providers — which providers have API keys configured
      server.middlewares.use('/api/llm/providers', (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end('GET only'); return; }
        const providers = [];
        // Per-model temperature overrides: null = user-configurable, number = forced value
        if (process.env.ANTHROPIC_API_KEY) providers.push({
          id: 'anthropic', name: 'Anthropic',
          models: [
            { id: 'claude-sonnet-4-6', temperature: null },
            { id: 'claude-haiku-4-5-20251001', temperature: null },
          ]
        });
        if (process.env.OPENAI_API_KEY) providers.push({
          id: 'openai', name: 'OpenAI',
          models: [
            { id: 'gpt-4o', temperature: null },
            { id: 'gpt-4o-mini', temperature: null },
            { id: 'gpt-5.2', temperature: null },
            { id: 'gpt-5.3-chat-latest', temperature: 1 },
            { id: 'gpt-5.4', temperature: null },
            { id: 'gpt-5.4-pro', temperature: null },
          ]
        });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ providers }));
      });
    }
  };
}

// Plugin: narrative audit logging — rolling log of last 6 audit exchanges
function auditlogPlugin() {
  return {
    name: 'auditlog',
    configureServer(server) {
      const logDir = () => {
        const d = path.resolve(process.cwd(), 'auditlogs');
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
        return d;
      };

      server.middlewares.use('/api/auditlog/save', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
        try {
          const body = JSON.parse(await readBody(req));
          const { filename, data } = body;
          if (!filename || !data) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'Missing filename or data' }));
            return;
          }
          const dir = logDir();
          const safeFilename = filename.replace(/[^a-zA-Z0-9_\-\.]/g, '_').replace(/^\.+/, '');
          const filepath = path.join(dir, safeFilename);
          if (!filepath.startsWith(dir)) { res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: false, error: 'Invalid filename' })); return; }
          fs.writeFileSync(filepath, JSON.stringify(data, null, 2));

          // Prune: keep only the 6 most recent log files
          const files = fs.readdirSync(dir)
            .filter(f => f.endsWith('.json'))
            .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
          for (const old of files.slice(6)) {
            fs.unlinkSync(path.join(dir, old.name));
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
    }
  };
}

// Plugin: network traffic logging for adjudication debugging
function netlogPlugin() {
  return {
    name: 'netlog',
    configureServer(server) {
      const logDir = () => {
        const d = path.resolve(process.cwd(), 'netlogs');
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
        return d;
      };

      // POST /api/netlog/save — save a network log entry, prune to last 5
      server.middlewares.use('/api/netlog/save', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
        try {
          const body = JSON.parse(await readBody(req));
          const { filename, data } = body;
          if (!filename || !data) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'Missing filename or data' }));
            return;
          }
          const dir = logDir();
          const safeFilename = filename.replace(/[^a-zA-Z0-9_\-\.]/g, '_').replace(/^\.+/, '');
          const filepath = path.join(dir, safeFilename);
          if (!filepath.startsWith(dir)) { res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: false, error: 'Invalid filename' })); return; }
          fs.writeFileSync(filepath, JSON.stringify(data, null, 2));

          // Prune: keep only the 5 most recent log files
          const files = fs.readdirSync(dir)
            .filter(f => f.endsWith('.json'))
            .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
          for (const old of files.slice(5)) {
            fs.unlinkSync(path.join(dir, old.name));
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
    }
  };
}

// Plugin: parser network traffic logging for debugging OSM/elevation/WC failures
function parserNetlogPlugin() {
  return {
    name: 'parser-netlog',
    configureServer(server) {
      const logDir = () => {
        const d = path.resolve(process.cwd(), 'parsernetlog');
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
        return d;
      };

      // POST /api/parsernetlog/save — save all entries for a parse session, prune to last 5
      server.middlewares.use('/api/parsernetlog/save', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
        try {
          const body = JSON.parse(await readBody(req));
          const { sessionId, entries } = body;
          if (!sessionId || !entries) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'Missing sessionId or entries' }));
            return;
          }
          const dir = logDir();
          const ts = new Date().toISOString().replace(/[:.]/g, '-');
          const filename = `parse_${sessionId}_${ts}.json`;
          fs.writeFileSync(path.join(dir, filename), JSON.stringify({
            sessionId,
            timestamp: new Date().toISOString(),
            totalRequests: entries.length,
            failures: entries.filter(e => !e.ok).length,
            entries,
          }, null, 2));

          // Prune: keep only the 5 most recent log files
          const files = fs.readdirSync(dir)
            .filter(f => f.endsWith('.json'))
            .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
          for (const old of files.slice(5)) {
            fs.unlinkSync(path.join(dir, old.name));
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, filename }));
        } catch (e) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
    }
  };
}

// Plugin: game state save/load
// Games are stored in per-game folders under ./games/<name>/
// Each folder contains: terrain.json, state.json, autosave_t*.json, log.json
// Preset terrain maps live in ./games/presets/
function gamePlugin() {
  return {
    name: 'game-state',
    configureServer(server) {
      // New folder-based root: ./games/
      const gamesRoot = () => {
        const d = path.resolve(process.cwd(), 'games');
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
        return d;
      };

      // Legacy flat-file dir for backwards compat with old saves
      const legacyDir = () => {
        const d = path.resolve(process.cwd(), 'saves', 'games');
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
        return d;
      };

      // Preset terrain folder
      const presetsDir = () => {
        const d = path.join(gamesRoot(), 'presets');
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
        return d;
      };

      // Slugify a game name for use as folder name
      function slugify(name) {
        return name.trim()
          .toLowerCase()
          .replace(/[^a-z0-9\s\-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 100) || 'unnamed-game';
      }

      // Get a unique folder name (append -2, -3, etc. if taken)
      function uniqueFolder(baseName) {
        const root = gamesRoot();
        let folder = baseName;
        let i = 2;
        while (fs.existsSync(path.join(root, folder))) {
          folder = `${baseName}-${i++}`;
        }
        return folder;
      }

      // POST /api/game/create — create a named game folder with terrain
      // Body: { name: "My Campaign", terrainData: {...} }
      // Returns: { ok, folder } — the folder name to store in game.folder
      server.middlewares.use('/api/game/create', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
        try {
          const body = JSON.parse(await readBody(req, 50 * 1024 * 1024)); // 50MB for large terrain
          const { name, terrainData } = body;
          if (!name || !terrainData) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'Missing name or terrainData' }));
            return;
          }
          const slug = slugify(name);
          const folder = uniqueFolder(slug);
          const folderPath = path.join(gamesRoot(), folder);
          fs.mkdirSync(folderPath, { recursive: true });
          // Write terrain copy — this is the game's own copy, independent of saves/
          fs.writeFileSync(path.join(folderPath, 'terrain.json'), JSON.stringify(terrainData));
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, folder }));
        } catch (e) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });

      // POST /api/game/save — save game state
      // If data.game.folder exists, save to games/<folder>/state.json
      // Otherwise fall back to legacy saves/games/<filename>.json
      server.middlewares.use('/api/game/save', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
        try {
          const { filename, data } = JSON.parse(await readBody(req));
          const folder = data?.game?.folder;

          if (folder) {
            // Folder-based save
            const safe = folder.replace(/[^a-zA-Z0-9_\-]/g, '_');
            const folderPath = path.join(gamesRoot(), safe);
            if (!folderPath.startsWith(gamesRoot()) || !fs.existsSync(folderPath)) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: false, error: 'Invalid game folder' }));
              return;
            }
            // Determine filename: autosave or main state
            const isAutosave = filename && /_autosave_t\d+/.test(filename);
            const saveName = isAutosave
              ? `autosave_t${data.game?.turn || 0}.json`
              : 'state.json';
            fs.writeFileSync(path.join(folderPath, saveName), JSON.stringify(data, null, 2));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, path: `games/${safe}/${saveName}` }));
          } else {
            // Legacy flat-file save (backwards compat)
            const safe = filename.replace(/[^a-zA-Z0-9_\-\.]/g, '_').replace(/^\.+/, '').slice(0, 200);
            const dir = legacyDir();
            const filepath = path.join(dir, safe);
            if (!filepath.startsWith(dir)) { res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: false, error: 'Invalid filename' })); return; }
            fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, path: `saves/games/${safe}` }));
          }
        } catch (e) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });

      // GET /api/game/list — list saved games from both folder-based and legacy
      server.middlewares.use('/api/game/list', (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end('GET only'); return; }
        const results = [];

        // Scan folder-based games in ./games/
        const root = gamesRoot();
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
          if (!entry.isDirectory() || entry.name === 'presets') continue;
          const folderPath = path.join(root, entry.name);
          const statePath = path.join(folderPath, 'state.json');
          if (!fs.existsSync(statePath)) continue;

          try {
            const stat = fs.statSync(statePath);
            const content = JSON.parse(fs.readFileSync(statePath, 'utf8'));
            results.push({
              file: entry.name, // folder name doubles as identifier
              folder: entry.name,
              name: content.game?.name || entry.name,
              size: stat.size,
              modified: stat.mtime.toISOString(),
              turn: content.game?.turn || null,
              status: content.game?.status || null,
              terrainRef: content.terrain?._ref || null,
              actorCount: content.scenario?.actors?.length || 0,
              unitCount: content.units?.length || 0,
              isAutosave: false,
              gameId: content.game?.id || null,
            });

            // Also list autosaves from this folder
            for (const f of fs.readdirSync(folderPath)) {
              if (!f.startsWith('autosave_t') || !f.endsWith('.json')) continue;
              const autoStat = fs.statSync(path.join(folderPath, f));
              let autoContent;
              try { autoContent = JSON.parse(fs.readFileSync(path.join(folderPath, f), 'utf8')); } catch { continue; }
              results.push({
                file: `${entry.name}/${f}`,
                folder: entry.name,
                name: autoContent.game?.name || entry.name,
                size: autoStat.size,
                modified: autoStat.mtime.toISOString(),
                turn: autoContent.game?.turn || null,
                status: autoContent.game?.status || null,
                terrainRef: autoContent.terrain?._ref || null,
                actorCount: autoContent.scenario?.actors?.length || 0,
                unitCount: autoContent.units?.length || 0,
                isAutosave: true,
                gameId: autoContent.game?.id || null,
              });
            }
          } catch { /* skip unreadable folders */ }
        }

        // Scan legacy flat-file saves in saves/games/ (backwards compat)
        const legDir = legacyDir();
        for (const f of fs.readdirSync(legDir)) {
          if (!f.endsWith('.json') || f.endsWith('_log.json')) continue;
          try {
            const stat = fs.statSync(path.join(legDir, f));
            const content = JSON.parse(fs.readFileSync(path.join(legDir, f), 'utf8'));
            // Skip if this game already exists in folder-based storage
            if (content.game?.folder) continue;
            const isAutosave = /_autosave_t\d+\.json$/.test(f);
            results.push({
              file: f,
              folder: null, // legacy — no folder
              name: content.game?.name || f,
              size: stat.size,
              modified: stat.mtime.toISOString(),
              turn: content.game?.turn || null,
              status: content.game?.status || null,
              terrainRef: content.terrain?._ref || null,
              actorCount: content.scenario?.actors?.length || 0,
              unitCount: content.units?.length || 0,
              isAutosave,
              gameId: content.game?.id || null,
            });
          } catch { /* skip unreadable files */ }
        }

        results.sort((a, b) => b.modified.localeCompare(a.modified));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(results));
      });

      // GET /api/game/load — load game state
      // ?folder=<name> — load from games/<name>/state.json (new)
      // ?folder=<name>&autosave=<turn> — load autosave from folder
      // ?file=<filename> — load from saves/games/<filename> (legacy)
      server.middlewares.use('/api/game/load', (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end('GET only'); return; }
        const url = new URL(req.url, 'http://localhost');
        const folder = url.searchParams.get('folder');
        const file = url.searchParams.get('file');
        const autosaveTurn = url.searchParams.get('autosave');

        if (folder) {
          const safe = folder.replace(/[^a-zA-Z0-9_\-]/g, '_');
          const folderPath = path.join(gamesRoot(), safe);
          if (!folderPath.startsWith(gamesRoot()) || !fs.existsSync(folderPath)) {
            res.statusCode = 404; res.end('Game folder not found'); return;
          }
          const filename = autosaveTurn ? `autosave_t${autosaveTurn}.json` : 'state.json';
          const filepath = path.join(folderPath, filename);
          if (!fs.existsSync(filepath)) { res.statusCode = 404; res.end('State file not found'); return; }
          res.setHeader('Content-Type', 'application/json');
          res.end(fs.readFileSync(filepath, 'utf8'));
        } else if (file) {
          // Legacy load from saves/games/
          const safe = file.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
          const filepath = path.join(legacyDir(), safe);
          if (!fs.existsSync(filepath)) { res.statusCode = 404; res.end('Not found'); return; }
          res.setHeader('Content-Type', 'application/json');
          res.end(fs.readFileSync(filepath, 'utf8'));
        } else {
          res.statusCode = 400; res.end('Missing folder or file param'); return;
        }
      });

      // GET /api/game/load-terrain?folder=<name> — load terrain from game folder
      // This is the game's own terrain copy, independent of saves/
      server.middlewares.use('/api/game/load-terrain', (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end('GET only'); return; }
        const url = new URL(req.url, 'http://localhost');
        const folder = url.searchParams.get('folder');
        if (!folder) { res.statusCode = 400; res.end('Missing folder param'); return; }
        const safe = folder.replace(/[^a-zA-Z0-9_\-]/g, '_');
        const filepath = path.join(gamesRoot(), safe, 'terrain.json');
        if (!filepath.startsWith(gamesRoot()) || !fs.existsSync(filepath)) {
          res.statusCode = 404; res.end('Terrain not found'); return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(fs.readFileSync(filepath, 'utf8'));
      });

      // GET /api/game/preset-terrain?preset=<id> — load or generate preset terrain
      server.middlewares.use('/api/game/preset-terrain', (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end('GET only'); return; }
        const url = new URL(req.url, 'http://localhost');
        const preset = url.searchParams.get('preset');
        if (!preset) { res.statusCode = 400; res.end('Missing preset param'); return; }
        const safe = preset.replace(/[^a-zA-Z0-9_\-]/g, '_');
        const filepath = path.join(presetsDir(), `${safe}.json`);
        if (!fs.existsSync(filepath)) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: 'Preset terrain not found. Generate it first.' }));
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(fs.readFileSync(filepath, 'utf8'));
      });

      // POST /api/game/save-preset-terrain — save preset terrain map
      // Body: { presetId, terrainData }
      server.middlewares.use('/api/game/save-preset-terrain', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
        try {
          const body = JSON.parse(await readBody(req, 50 * 1024 * 1024));
          const { presetId, terrainData } = body;
          if (!presetId || !terrainData) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'Missing presetId or terrainData' }));
            return;
          }
          const safe = presetId.replace(/[^a-zA-Z0-9_\-]/g, '_');
          const filepath = path.join(presetsDir(), `${safe}.json`);
          fs.writeFileSync(filepath, JSON.stringify(terrainData));
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });

      // POST /api/game/log — append log entries (supports folder-based and legacy)
      server.middlewares.use('/api/game/log', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
        try {
          const { gameId, folder, entries } = JSON.parse(await readBody(req));
          if (!entries || (!gameId && !folder)) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'Missing gameId/folder or entries' }));
            return;
          }

          let logPath;
          if (folder) {
            const safe = folder.replace(/[^a-zA-Z0-9_\-]/g, '_');
            const folderPath = path.join(gamesRoot(), safe);
            if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
            logPath = path.join(folderPath, 'log.json');
          } else {
            const safe = gameId.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
            logPath = path.join(legacyDir(), `${safe}_log.json`);
          }

          let existing = [];
          if (fs.existsSync(logPath)) {
            try { existing = JSON.parse(fs.readFileSync(logPath, 'utf8')); } catch {}
          }
          existing.push(...entries);
          fs.writeFileSync(logPath, JSON.stringify(existing, null, 2));
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, count: existing.length }));
        } catch (e) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });

      // POST /api/game/save-artifact — save an arbitrary file into a game folder
      // Body: { folder, filename, data }
      // Writes to games/<folder>/<filename> — used for AI call logs, order logs, etc.
      server.middlewares.use('/api/game/save-artifact', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
        try {
          const { folder, filename, data } = JSON.parse(await readBody(req));
          if (!folder || !filename || data === undefined) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'Missing folder, filename, or data' }));
            return;
          }
          const safeFolder = folder.replace(/[^a-zA-Z0-9_\-]/g, '_');
          const safeFile = filename.replace(/[^a-zA-Z0-9_\-\.]/g, '_').replace(/^\.+/, '').slice(0, 200);
          const folderPath = path.join(gamesRoot(), safeFolder);
          if (!folderPath.startsWith(gamesRoot())) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'Invalid folder' }));
            return;
          }
          if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
          const filepath = path.join(folderPath, safeFile);
          fs.writeFileSync(filepath, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, path: `games/${safeFolder}/${safeFile}` }));
        } catch (e) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });

      // DELETE /api/game/delete — delete a game save (autosaves only for safety)
      // ?folder=<name>&autosave=<turn> — delete autosave from folder
      // ?file=<filename> — legacy delete from saves/games/
      server.middlewares.use('/api/game/delete', (req, res) => {
        if (req.method !== 'DELETE') { res.statusCode = 405; res.end('DELETE only'); return; }
        const url = new URL(req.url, 'http://localhost');
        const folder = url.searchParams.get('folder');
        const autosaveTurn = url.searchParams.get('autosave');
        const file = url.searchParams.get('file');

        try {
          if (folder && autosaveTurn) {
            const safe = folder.replace(/[^a-zA-Z0-9_\-]/g, '_');
            const filepath = path.join(gamesRoot(), safe, `autosave_t${parseInt(autosaveTurn)}.json`);
            if (!filepath.startsWith(gamesRoot())) { res.statusCode = 400; res.end('Invalid path'); return; }
            if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } else if (file) {
            // Legacy delete
            const safe = file.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
            if (!/_autosave_t\d+\.json$/.test(safe)) {
              res.statusCode = 403;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: false, error: 'Only autosave files can be deleted' }));
              return;
            }
            const filepath = path.join(legacyDir(), safe);
            if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } else {
            res.statusCode = 400; res.end('Missing folder+autosave or file param');
          }
        } catch (e) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  // Load ALL .env vars into process.env so server plugins can read API keys.
  // loadEnv won't override existing process.env values (even empty ones),
  // so we parse .env directly and force-set any non-empty values.
  const envFile = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (val) process.env[key] = val;
    }
  }

  return {
  // Compile-time constant: true in dev, false in production builds.
  // Wrap debug-only UI (raw JSON tabs, export buttons, moderator panel,
  // FOW toggle, prompt viewer) in `if (__DEV_TOOLS__)` blocks so they
  // are tree-shaken from production bundles.
  define: {
    __DEV_TOOLS__: mode !== 'production',
  },
  plugins: [react(), serverTimeoutPlugin(), savePlugin(), llmPlugin({ isProd: mode === 'production' }), netlogPlugin(), parserNetlogPlugin(), gamePlugin(), auditlogPlugin()],
  server: {
    watch: {
      ignored: ['**/saves/**', '**/games/**'],
    },
    proxy: {
      '/api/topo': {
        target: 'https://api.opentopodata.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/topo/, ''),
      },
      '/api/wc': {
        target: 'https://esa-worldcover.s3.eu-central-1.amazonaws.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/wc/, ''),
      },
      '/api/srtm': {
        target: 'https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/srtm/, ''),
      },
      // ── PBEM server proxy (Express on port 3001) ──────────
      // Admin routes — no conflict with Vite middleware
      '/api/admin': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // Player game routes that DON'T collide with Vite's gamePlugin.
      // Vite middleware handles: /api/game/save, /api/game/list,
      // /api/game/load, /api/game/log, /api/game/delete
      // PBEM uses: /api/game/state, /api/game/terrain, /api/game/orders,
      // /api/game/results, /api/game/decision, /api/game/briefing,
      // /api/game/events, /api/game/status
      // Non-conflicting paths fall through Vite middleware to this proxy.
      '/api/game/state': { target: 'http://localhost:3001', changeOrigin: true },
      '/api/game/terrain': { target: 'http://localhost:3001', changeOrigin: true },
      '/api/game/orders': { target: 'http://localhost:3001', changeOrigin: true },
      '/api/game/results': { target: 'http://localhost:3001', changeOrigin: true },
      '/api/game/decision': { target: 'http://localhost:3001', changeOrigin: true },
      '/api/game/briefing': { target: 'http://localhost:3001', changeOrigin: true },
      '/api/game/events': { target: 'http://localhost:3001', changeOrigin: true },
      '/api/game/status': { target: 'http://localhost:3001', changeOrigin: true },
      '/api/game/draft-orders': { target: 'http://localhost:3001', changeOrigin: true },
      '/api/game/challenges': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
};})
