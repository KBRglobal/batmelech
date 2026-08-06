// Bat Melech — static server with basic auth + Postgres-backed state sync.
// Serves the orders app (repo root) and the marketing site (/site) unchanged;
// a sync script is injected into HTML at serve time so app files stay untouched.
const express = require('express');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const AUTH_USER = process.env.BM_USER || 'lin';
const AUTH_PASS = process.env.BM_PASS || 'lin123';

// --- health check (no auth, used by Railway) ---
app.get('/healthz', (req, res) => res.send('ok'));

// --- basic auth on everything else ---
app.use((req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, b64] = header.split(' ');
  if (scheme === 'Basic' && b64) {
    const [user, ...rest] = Buffer.from(b64, 'base64').toString().split(':');
    if (user === AUTH_USER && rest.join(':') === AUTH_PASS) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Bat Melech"');
  res.status(401).send('Authentication required');
});

app.use(express.json({ limit: '15mb' }));

// --- Postgres-backed app state (single-row store for the app's localStorage blob) ---
let pool = null;
if (process.env.DATABASE_URL) {
  // Uses Railway private networking (railway.internal) — plain TCP inside the
  // private network, no TLS needed. External URLs should carry ?sslmode=require.
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  pool
    .query(
      'CREATE TABLE IF NOT EXISTS bm_state (id INT PRIMARY KEY, data JSONB NOT NULL, updated_at BIGINT NOT NULL)'
    )
    .catch((e) => console.error('db init failed:', e.message));
}

app.get('/api/state', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'no database configured' });
  try {
    const r = await pool.query('SELECT data, updated_at FROM bm_state WHERE id = 1');
    if (!r.rows.length) return res.json({ ts: 0, data: null });
    res.json({ ts: Number(r.rows[0].updated_at), data: r.rows[0].data });
  } catch (e) {
    console.error('GET /api/state:', e.message);
    res.status(500).json({ error: 'db error' });
  }
});

app.post('/api/state', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'no database configured' });
  if (!req.body || typeof req.body.data === 'undefined' || req.body.data === null) {
    return res.status(400).json({ error: 'missing data' });
  }
  const ts = Date.now();
  try {
    await pool.query(
      'INSERT INTO bm_state (id, data, updated_at) VALUES (1, $1, $2) ' +
        'ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = $2',
      [JSON.stringify(req.body.data), ts]
    );
    res.json({ ts });
  } catch (e) {
    console.error('POST /api/state:', e.message);
    res.status(500).json({ error: 'db error' });
  }
});

// --- HTML: inject the sync script at serve time, files on disk stay untouched ---
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  let p = decodeURIComponent(req.path);
  if (p.endsWith('/')) p += 'index.html';
  if (!p.endsWith('.html')) return next();
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT + path.sep)) return res.status(400).end();
  fs.readFile(file, 'utf8', (err, html) => {
    if (err) return next();
    const tag = '<script src="/bm-sync.js"></script>';
    const out = html.includes('<head>')
      ? html.replace('<head>', '<head>' + tag)
      : tag + html;
    res.type('html').send(out);
  });
});

app.use(express.static(ROOT));

app.listen(PORT, () => console.log(`batmelech listening on :${PORT}, db: ${pool ? 'on' : 'off'}`));
