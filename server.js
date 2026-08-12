// Bat Melech — static server with basic auth + Postgres-backed state sync.
// Serves the orders app (repo root) and the marketing site (/site) unchanged;
// a sync script is injected into HTML at serve time so app files stay untouched.
const express = require('express');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { Pool } = require('pg');
const { createOrderIntakeRouter } = require('./server/ai/order-intake-route');
const { createReactAppRouter } = require('./server/react-app-route');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const REACT_ROOT = path.join(ROOT, 'web', 'dist');

function requireServerCredential(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} must be configured.`);
  }
  return value;
}

const AUTH_USER = requireServerCredential('BM_USER');
const AUTH_PASS = requireServerCredential('BM_PASS');

// --- self-updating content: pull latest main from GitHub (public repo, no token) ---
// Build sessions push app HTML to claude/* branches; the automerge workflow lands
// them on main; this picks them up within REFRESH_MS without redeploying.
const REPO = process.env.BM_REPO || 'KBRglobal/batmelech';
const BRANCH = process.env.BM_BRANCH || 'main';
const REFRESH_MS = Number(process.env.BM_REFRESH_MS || 5 * 60 * 1000);
const CACHE = '/tmp/bm-content';
let contentRoot = ROOT; // fallback: files baked into the image
let currentSha = null;
let previousDir = null;

async function refreshContent() {
  try {
    const head = await fetch(
      `https://api.github.com/repos/${REPO}/commits/${BRANCH}`,
      { headers: { Accept: 'application/vnd.github.sha', 'User-Agent': 'bm-server' } }
    );
    if (!head.ok) return;
    const sha = (await head.text()).trim();
    if (!sha || sha === currentSha) return;
    const res = await fetch(`https://codeload.github.com/${REPO}/tar.gz/${sha}`);
    if (!res.ok) return;
    fs.mkdirSync(CACHE, { recursive: true });
    const tgz = path.join(CACHE, 'content.tgz');
    fs.writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
    const dest = path.join(CACHE, sha.slice(0, 12));
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    await new Promise((ok, no) =>
      execFile('tar', ['xzf', tgz, '-C', dest, '--strip-components=1'], (e) =>
        e ? no(e) : ok()
      )
    );
    const old = previousDir;
    previousDir = contentRoot !== ROOT ? contentRoot : null;
    contentRoot = dest;
    currentSha = sha;
    console.log(`content refreshed to ${sha.slice(0, 12)}`);
    if (old) fs.rm(old, { recursive: true, force: true }, () => {});
  } catch (e) {
    console.error('content refresh failed:', e.message);
  }
}
refreshContent();
setInterval(refreshContent, REFRESH_MS).unref();

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

// --- AI-assisted order interpretation (review-only; never persists state) ---
app.use('/api/ai/order-intake', createOrderIntakeRouter());

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

// --- React operator application: authenticated, isolated below /app/ ---
app.get(/^\/app$/, (req, res) => res.redirect(308, '/app/'));
app.use('/app', createReactAppRouter({ reactRoot: REACT_ROOT }));

// --- HTML: inject the sync script at serve time, files on disk stay untouched ---
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  let p = decodeURIComponent(req.path);
  if (p.endsWith('/')) p += 'index.html';
  if (!p.endsWith('.html')) return next();
  const base = contentRoot;
  const file = path.normalize(path.join(base, p));
  if (!file.startsWith(base + path.sep)) return res.status(400).end();
  fs.readFile(file, 'utf8', (err, html) => {
    if (err) return next();
    const tag = '<script src="/bm-sync.js"></script>';
    const out = html.includes('<head>')
      ? html.replace('<head>', '<head>' + tag)
      : tag + html;
    res.type('html').send(out);
  });
});

// bm-sync.js always comes from the server image (server-owned, not repo content)
app.get('/bm-sync.js', (req, res) => res.sendFile(path.join(ROOT, 'bm-sync.js')));
app.use((req, res, next) => express.static(contentRoot)(req, res, next));

app.listen(PORT, () => console.log(`batmelech listening on :${PORT}, db: ${pool ? 'on' : 'off'}`));
