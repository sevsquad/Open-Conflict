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

export default defineConfig({
  plugins: [react(), savePlugin()],
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
