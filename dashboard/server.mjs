import express from 'express';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 7842;
const RUNS_DIR = join(homedir(), '.tokentrace', 'runs');
const DIST_DIR = join(__dirname, 'dist');

const app = express();

// --- API ---

app.get('/api/sessions', async (req, res) => {
  let names;
  try {
    names = await readdir(RUNS_DIR);
  } catch {
    return res.json([]);
  }

  const sessions = [];
  for (const name of names.sort().reverse()) {
    try {
      const raw = await readFile(join(RUNS_DIR, name, 'run.json'), 'utf8');
      sessions.push(JSON.parse(raw));
    } catch {
      // Skip incomplete or unreadable sessions
    }
  }

  res.json(sessions);
});

app.put('/api/sessions/:id/label', express.json(), async (req, res) => {
  const runPath = join(RUNS_DIR, req.params.id, 'run.json');
  try {
    const run = JSON.parse(await readFile(runPath, 'utf8'));
    run.label = typeof req.body.label === 'string' ? req.body.label.trim() || null : null;
    await writeFile(runPath, JSON.stringify(run, null, 2) + '\n');
    res.json({ ok: true, label: run.label });
  } catch {
    res.status(404).json({ error: 'Session not found' });
  }
});

app.get('/api/sessions/:id/transcript', async (req, res) => {
  const sessionPath = join(RUNS_DIR, req.params.id, 'transcript.txt');
  try {
    const content = await readFile(sessionPath, 'utf8');
    res.type('text/plain').send(content);
  } catch {
    res.status(404).json({ error: 'Transcript not found' });
  }
});

app.get('/api/sessions/:id/diff', async (req, res) => {
  const diffPath = join(RUNS_DIR, req.params.id, 'diff.patch');
  try {
    const content = await readFile(diffPath, 'utf8');
    res.type('text/plain').send(content);
  } catch {
    res.status(404).json({ error: 'Diff not found' });
  }
});

app.get('/api/pricing', async (req, res) => {
  try {
    const { loadPricingDb } = await import('../src/pricing-db.mjs');
    const db = await loadPricingDb();
    res.json(db);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load pricing data', detail: err.message });
  }
});

// --- Static serving ---

if (existsSync(DIST_DIR)) {
  // Production: serve built assets
  app.use(express.static(DIST_DIR));
  app.get('*', (req, res) => {
    res.sendFile(join(DIST_DIR, 'index.html'));
  });
} else {
  // Dev mode: proxy to Vite dev server on port 5173
  const { createProxyMiddleware } = await import('http-proxy-middleware').catch(() => {
    return { createProxyMiddleware: null };
  });

  if (createProxyMiddleware) {
    app.use(
      '/',
      createProxyMiddleware({
        target: 'http://localhost:5173',
        changeOrigin: true,
        ws: true,
      })
    );
  } else {
    app.get('/', (req, res) => {
      res.send(
        '<!doctype html><html><body>' +
        '<p style="font-family:sans-serif;padding:2rem">' +
        'Dashboard not built. Run <code>cd dashboard && npm install && npm run build</code> first, ' +
        'or run <code>npm run dev</code> inside the dashboard directory for development.' +
        '</p></body></html>'
      );
    });
  }
}

const server = createServer(app);
server.listen(PORT, () => {
  process.stdout.write(`tokentrace dashboard running at http://localhost:${PORT}\n`);
});

export { app };
