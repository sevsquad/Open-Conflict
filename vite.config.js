import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { Agent, setGlobalDispatcher } from 'undici'

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
            // Sanitize filename
            const safe = filename.replace(/[^a-zA-Z0-9_\-\.]/g, '_').slice(0, 200);
            const filepath = path.join(savesDir, safe);
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
        const safe = file.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
        const filepath = path.resolve(process.cwd(), 'saves', safe);
        if (!fs.existsSync(filepath)) { res.statusCode = 404; res.end('Not found'); return; }
        res.setHeader('Content-Type', 'application/json');
        res.end(fs.readFileSync(filepath, 'utf8'));
      });
    }
  };
}

// Helper: read request body as text
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// Plugin: LLM API proxy — routes adjudication calls to Anthropic or OpenAI
function llmPlugin() {
  return {
    name: 'llm-proxy',
    configureServer(server) {

      // POST /api/llm/adjudicate — proxy LLM API calls
      server.middlewares.use('/api/llm/adjudicate', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
        try {
          const body = JSON.parse(await readBody(req));
          const { provider, model, temperature, messages, max_tokens: clientMaxTokens } = body;

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
          const heartbeat = setInterval(() => {
            try { res.write(' '); } catch (_) { /* connection already gone */ }
          }, 15_000);

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
          fs.writeFileSync(path.join(dir, filename), JSON.stringify(data, null, 2));

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
function gamePlugin() {
  return {
    name: 'game-state',
    configureServer(server) {
      const gamesDir = () => {
        const d = path.resolve(process.cwd(), 'saves', 'games');
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
        return d;
      };

      // POST /api/game/save — save game state
      server.middlewares.use('/api/game/save', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
        try {
          const { filename, data } = JSON.parse(await readBody(req));
          const safe = filename.replace(/[^a-zA-Z0-9_\-\.]/g, '_').slice(0, 200);
          const filepath = path.join(gamesDir(), safe);
          fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, path: `saves/games/${safe}` }));
        } catch (e) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });

      // GET /api/game/list — list saved games with metadata
      server.middlewares.use('/api/game/list', (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end('GET only'); return; }
        const dir = gamesDir();
        const files = fs.readdirSync(dir)
          .filter(f => f.endsWith('.json') && !f.endsWith('_log.json'))
          .map(f => {
            const stat = fs.statSync(path.join(dir, f));
            let name = f, turn = null, status = null, terrainRef = null, actorCount = 0, unitCount = 0, gameId = null;
            const isAutosave = /_autosave_t\d+\.json$/.test(f);
            try {
              const content = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
              name = content.game?.name || f;
              turn = content.game?.turn || null;
              status = content.game?.status || null;
              terrainRef = content.terrain?._ref || null;
              actorCount = content.scenario?.actors?.length || 0;
              unitCount = content.units?.length || 0;
              gameId = content.game?.id || null;
            } catch {}
            return { file: f, name, size: stat.size, modified: stat.mtime.toISOString(), turn, status, terrainRef, actorCount, unitCount, isAutosave, gameId };
          })
          .sort((a, b) => b.modified.localeCompare(a.modified));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(files));
      });

      // GET /api/game/load?file=xxx — load a game state
      server.middlewares.use('/api/game/load', (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end('GET only'); return; }
        const url = new URL(req.url, 'http://localhost');
        const file = url.searchParams.get('file');
        if (!file) { res.statusCode = 400; res.end('Missing file param'); return; }
        const safe = file.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
        const filepath = path.join(gamesDir(), safe);
        if (!fs.existsSync(filepath)) { res.statusCode = 404; res.end('Not found'); return; }
        res.setHeader('Content-Type', 'application/json');
        res.end(fs.readFileSync(filepath, 'utf8'));
      });

      // POST /api/game/log — append log entries
      server.middlewares.use('/api/game/log', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
        try {
          const { gameId, entries } = JSON.parse(await readBody(req));
          const safe = gameId.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
          const logPath = path.join(gamesDir(), `${safe}_log.json`);
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

      // DELETE /api/game/delete?file=xxx — delete a game save (autosaves only for safety)
      server.middlewares.use('/api/game/delete', (req, res) => {
        if (req.method !== 'DELETE') { res.statusCode = 405; res.end('DELETE only'); return; }
        const url = new URL(req.url, 'http://localhost');
        const file = url.searchParams.get('file');
        if (!file) { res.statusCode = 400; res.end('Missing file param'); return; }
        const safe = file.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
        // Safety: only allow deletion of autosave files
        if (!/_autosave_t\d+\.json$/.test(safe)) {
          res.statusCode = 403;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: 'Only autosave files can be deleted' }));
          return;
        }
        const filepath = path.join(gamesDir(), safe);
        try {
          if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
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
  plugins: [react(), serverTimeoutPlugin(), savePlugin(), llmPlugin(), netlogPlugin(), parserNetlogPlugin(), gamePlugin()],
  server: {
    watch: {
      ignored: ['**/saves/**'],
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
    },
  },
};})
