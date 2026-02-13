import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

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
          const { provider, model, temperature, messages } = body;

          if (!provider || !model || !messages) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'Missing required fields: provider, model, messages' }));
            return;
          }

          let result;
          if (provider === 'anthropic') {
            const apiKey = process.env.ANTHROPIC_API_KEY;
            if (!apiKey) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: false, error: 'ANTHROPIC_API_KEY not configured' }));
              return;
            }
            // Anthropic Messages API
            const systemMsg = messages.find(m => m.role === 'system');
            const userMsgs = messages.filter(m => m.role !== 'system');
            const apiBody = {
              model,
              max_tokens: 8192,
              temperature: temperature ?? 0.4,
              messages: userMsgs
            };
            if (systemMsg) apiBody.system = systemMsg.content;

            const resp = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
              },
              body: JSON.stringify(apiBody)
            });
            const data = await resp.json();
            if (!resp.ok) {
              res.statusCode = resp.status;
              res.setHeader('Content-Type', 'application/json');
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
                output: data.usage?.output_tokens
              },
              model: data.model,
              stop_reason: data.stop_reason
            };

          } else if (provider === 'openai') {
            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
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

            const resp = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
              },
              body: JSON.stringify(apiBody)
            });
            const data = await resp.json();
            if (!resp.ok) {
              res.statusCode = resp.status;
              res.setHeader('Content-Type', 'application/json');
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
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: `Unknown provider: ${provider}. Use 'anthropic' or 'openai'.` }));
            return;
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));

        } catch (e) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });

      // GET /api/llm/providers — which providers have API keys configured
      server.middlewares.use('/api/llm/providers', (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end('GET only'); return; }
        const providers = [];
        if (process.env.ANTHROPIC_API_KEY) providers.push({ id: 'anthropic', name: 'Anthropic', models: ['claude-sonnet-4-20250514', 'claude-haiku-4-20250414'] });
        if (process.env.OPENAI_API_KEY) providers.push({ id: 'openai', name: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini'] });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ providers }));
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

      // GET /api/game/list — list saved games
      server.middlewares.use('/api/game/list', (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end('GET only'); return; }
        const dir = gamesDir();
        const files = fs.readdirSync(dir)
          .filter(f => f.endsWith('.json') && !f.endsWith('_log.json'))
          .map(f => {
            const stat = fs.statSync(path.join(dir, f));
            let name = f;
            try {
              const content = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
              name = content.game?.name || f;
            } catch {}
            return { file: f, name, size: stat.size, modified: stat.mtime.toISOString() };
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
    }
  };
}

export default defineConfig({
  plugins: [react(), savePlugin(), llmPlugin(), gamePlugin()],
  server: {
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
    },
  },
})
