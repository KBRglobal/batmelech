'use strict';

// מצב מטבח — a wall-tablet surface with its OWN login (kitchen user/pass),
// fully separate from the staff session. A kitchen session can do exactly
// two things: read a whitelisted projection of the prep data, and toggle a
// prepDone mark. Nothing else — no customers, no payments, no admin API.
//
// The kitchen cookie is signed with a secret DERIVED from the staff session
// secret (HMAC-scoped), so a kitchen token can never be replayed as a staff
// session token or vice versa.

const crypto = require('node:crypto');
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { rateLimit } = require('express-rate-limit');
const { hasValidSession } = require('./decoy-auth');
const { setOrderStatus, KNOWN_ORDER_STATUSES } = require('../business-actions');

const KITCHEN_COOKIE = 'bm_kitchen';
const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000; // a wall tablet logs in once
const MAX_ATTEMPTS = 5;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const PREP_CATEGORIES = ['salads', 'firsts', 'mains', 'sides', 'desserts', 'extras', 'custom', 'lunch'];

// Order fields the kitchen board actually needs. Everything else — phones,
// addresses, payments, notes — never leaves the server on this surface.
const KITCHEN_ORDER_FIELDS = [
  'id',
  'date',
  'status',
  'name',
  'time',
  'hotelName',
  'place',
  'pickup',
  'meals',
  'aricha',
  'challot',
  'salads',
  'firsts',
  'heat',
  'mains',
  'sides',
  'desserts',
  'extras',
  'custom',
  'lunch',
];

function kitchenSecret(sessionSecret) {
  return crypto.createHmac('sha256', sessionSecret).update('kitchen-scope').digest('hex');
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function makeToken(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

function readToken(token, secret) {
  if (typeof token !== 'string' || !token) return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = sign(body, secret);
  const macBuffer = Buffer.from(mac);
  const expectedBuffer = Buffer.from(expected);
  if (macBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(macBuffer, expectedBuffer)) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  if (typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      // malformed cookie value — ignore
    }
  }
  return out;
}

function hasValidKitchenSession(request, sessionSecret) {
  const cookies = parseCookies(request.headers.cookie);
  const payload = readToken(cookies[KITCHEN_COOKIE], kitchenSecret(sessionSecret));
  return Boolean(
    payload &&
    payload.scope === 'kitchen' &&
    typeof payload.exp === 'number' &&
    payload.exp > Date.now()
  );
}

function issueKitchenCookie(response, sessionSecret) {
  const token = makeToken({ scope: 'kitchen', exp: Date.now() + SESSION_TTL_MS }, kitchenSecret(sessionSecret));
  response.cookie(KITCHEN_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

function timingSafeStringEqual(a, b) {
  const aBuffer = Buffer.from(String(a));
  const bBuffer = Buffer.from(String(b));
  const length = Math.max(aBuffer.length, bBuffer.length, 1);
  const aPadded = Buffer.concat([aBuffer], length);
  const bPadded = Buffer.concat([bBuffer], length);
  return crypto.timingSafeEqual(aPadded, bPadded) && aBuffer.length === bBuffer.length;
}

// Minimal, self-contained login page — served inline so the tablet needs no
// authenticated assets before logging in.
const LOGIN_PAGE = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>מצב מטבח</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #3B151A; color: #F7ECE6; font-family: system-ui, sans-serif; }
  form { width: min(90vw, 22rem); display: flex; flex-direction: column; gap: 1rem; }
  h1 { font-size: 2rem; margin: 0 0 .5rem; text-align: center; }
  input { min-height: 3.25rem; border-radius: 1rem; border: 2px solid rgba(255,255,255,.25);
          background: rgba(255,255,255,.08); color: inherit; font-size: 1.125rem; font-weight: 700;
          padding: 0 1rem; outline: none; }
  input:focus { border-color: rgba(255,255,255,.6); }
  button { min-height: 3.25rem; border-radius: 1rem; border: 0; background: #F7ECE6; color: #3B151A;
           font-size: 1.125rem; font-weight: 900; cursor: pointer; }
  p[role=alert] { background: rgba(255,80,80,.2); border-radius: 1rem; padding: .75rem 1rem;
                  font-weight: 700; margin: 0; display: none; }
</style>
</head>
<body>
<form id="f">
  <h1>מצב מטבח</h1>
  <p role="alert" id="e">שם המשתמש או הסיסמה שגויים</p>
  <input name="user" placeholder="שם משתמש" autocomplete="username" required>
  <input name="pass" type="password" placeholder="סיסמה" autocomplete="current-password" required>
  <button type="submit">כניסה</button>
</form>
<script>
document.getElementById('f').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  const response = await fetch('/api/kitchen/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: data.get('user'), pass: data.get('pass') }),
  }).catch(() => null);
  if (response && response.ok) location.reload();
  else document.getElementById('e').style.display = 'block';
});
</script>
</body>
</html>`;

function createKitchenLoginRouter({ kitchenUser, kitchenPass, sessionSecret }) {
  if (typeof sessionSecret !== 'string' || sessionSecret === '') throw new TypeError('sessionSecret required');
  const router = express.Router();
  router.use(express.json({ limit: '4kb' }));
  router.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 20,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    })
  );
  router.post('/', (request, response) => {
    response.set('Cache-Control', 'no-store');
    const user = typeof request.body?.user === 'string' ? request.body.user.trim() : '';
    const pass = typeof request.body?.pass === 'string' ? request.body.pass : '';
    const userOk = timingSafeStringEqual(user, kitchenUser);
    const passOk = timingSafeStringEqual(pass, kitchenPass);
    if (!userOk || !passOk) {
      return response.status(401).json({ error: 'invalid credentials' });
    }
    issueKitchenCookie(response, sessionSecret);
    return response.status(200).json({ ok: true });
  });
  return router;
}

function projectKitchenOrder(order) {
  const projected = {};
  for (const field of KITCHEN_ORDER_FIELDS) {
    if (order[field] !== undefined) projected[field] = order[field];
  }
  return projected;
}

function createKitchenApiRouter({ repository, sessionSecret, logger = console }) {
  if (!repository || typeof repository.loadState !== 'function') {
    throw new TypeError('A state repository is required');
  }
  const router = express.Router();
  router.use(express.json({ limit: '16kb' }));
  // The admin variant of the board (/admin/kitchen) calls the same API with
  // a staff session — both credentials are accepted here.
  router.use((request, response, next) => {
    response.set('Cache-Control', 'no-store');
    if (
      !hasValidKitchenSession(request, sessionSecret) &&
      !hasValidSession(request, sessionSecret)
    ) {
      return response.status(401).json({ error: 'kitchen login required' });
    }
    next();
  });

  router.get('/state', async (_request, response) => {
    try {
      const current = await repository.loadState();
      const orders = Array.isArray(current.data.orders) ? current.data.orders : [];
      const settings = current.data.settings && typeof current.data.settings === 'object' ? current.data.settings : {};
      return response.status(200).json({
        revision: current.revision,
        data: {
          orders: orders.map(projectKitchenOrder),
          prepDone: current.data.prepDone && typeof current.data.prepDone === 'object' ? current.data.prepDone : {},
          settings: {
            preparationCatalog: settings.preparationCatalog,
          },
          menu: current.data.menu && typeof current.data.menu === 'object' ? current.data.menu : {},
        },
      });
    } catch (error) {
      logger.error('kitchen state read failed', error);
      return response.status(503).json({ error: 'state unavailable' });
    }
  });

  // One-tap order status from the kitchen board (Moshe: "סטטוסים, הכל
  // בהקשה"). Bounded to the five known statuses; nothing else is writable.
  router.post('/order-status', async (request, response) => {
    const orderId = typeof request.body?.orderId === 'string' ? request.body.orderId.trim() : '';
    const status = request.body?.status;
    if (orderId === '' || orderId.length > 128 || !KNOWN_ORDER_STATUSES.includes(status)) {
      return response.status(400).json({ error: 'invalid status change' });
    }
    try {
      const result = await setOrderStatus(repository, orderId, status);
      if (!result.ok) return response.status(409).json({ error: result.error || 'status change failed' });
      return response.status(200).json({ ok: true });
    } catch (error) {
      logger.error('kitchen order status failed', error);
      return response.status(503).json({ error: 'status change failed' });
    }
  });

  // The kitchen board's per-dish stages (Moshe: started → ready → packed,
  // one tap advances). 'packed' is stored as boolean true so the admin
  // preparation screen keeps seeing it as completed; the intermediate stages
  // are strings in the same prepDone map.
  router.post('/prep-stage', async (request, response) => {
    const serviceDate = typeof request.body?.serviceDate === 'string' ? request.body.serviceDate.trim() : '';
    const category = request.body?.category;
    const itemName = typeof request.body?.itemName === 'string' ? request.body.itemName.trim() : '';
    const stage = request.body?.stage;
    if (
      !DATE_PATTERN.test(serviceDate) ||
      !PREP_CATEGORIES.includes(category) ||
      itemName === '' ||
      itemName.length > 300 ||
      !['none', 'started', 'ready', 'packed'].includes(stage)
    ) {
      return response.status(400).json({ error: 'invalid prep stage' });
    }
    const itemKey = `${category}|${itemName}`;
    try {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        const current = await repository.loadState();
        const root = current.data.prepDone && typeof current.data.prepDone === 'object' && !Array.isArray(current.data.prepDone)
          ? current.data.prepDone
          : {};
        const scope = root[serviceDate] && typeof root[serviceDate] === 'object' && !Array.isArray(root[serviceDate])
          ? { ...root[serviceDate] }
          : {};
        if (stage === 'none') delete scope[itemKey];
        else if (stage === 'packed') scope[itemKey] = true;
        else scope[itemKey] = stage;
        const localState = { ...current.data, prepDone: { ...root, [serviceDate]: scope } };
        const saved = await repository.saveState({
          baseState: current.data,
          localState,
          baseRevision: current.revision,
          baseHash: current.hash,
          requestId: crypto.randomUUID(),
        });
        if (saved.ok) return response.status(200).json({ ok: true });
      }
      return response.status(503).json({ error: 'save failed' });
    } catch (error) {
      logger.error('kitchen prep stage failed', error);
      return response.status(503).json({ error: 'save failed' });
    }
  });

  router.post('/prep-toggle', async (request, response) => {
    const serviceDate = typeof request.body?.serviceDate === 'string' ? request.body.serviceDate.trim() : '';
    const category = request.body?.category;
    const itemName = typeof request.body?.itemName === 'string' ? request.body.itemName.trim() : '';
    const completed = request.body?.completed;
    if (
      !DATE_PATTERN.test(serviceDate) ||
      !PREP_CATEGORIES.includes(category) ||
      itemName === '' ||
      itemName.length > 300 ||
      typeof completed !== 'boolean'
    ) {
      return response.status(400).json({ error: 'invalid prep toggle' });
    }
    const itemKey = `${category}|${itemName}`;
    try {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        const current = await repository.loadState();
        const root = current.data.prepDone && typeof current.data.prepDone === 'object' && !Array.isArray(current.data.prepDone)
          ? current.data.prepDone
          : {};
        const scope = root[serviceDate] && typeof root[serviceDate] === 'object' && !Array.isArray(root[serviceDate])
          ? { ...root[serviceDate] }
          : {};
        if (completed) scope[itemKey] = true;
        else delete scope[itemKey];
        const localState = { ...current.data, prepDone: { ...root, [serviceDate]: scope } };
        const saved = await repository.saveState({
          baseState: current.data,
          localState,
          baseRevision: current.revision,
          baseHash: current.hash,
          requestId: crypto.randomUUID(),
        });
        if (saved.ok) return response.status(200).json({ ok: true });
      }
      return response.status(503).json({ error: 'save failed' });
    } catch (error) {
      logger.error('kitchen prep toggle failed', error);
      return response.status(503).json({ error: 'save failed' });
    }
  });

  return router;
}

// Serves the kitchen SPA behind the kitchen login: the React bundle for a
// valid session, the inline login page otherwise.
function createKitchenAppRouter({ reactRoot, sessionSecret }) {
  if (typeof reactRoot !== 'string' || !path.isAbsolute(reactRoot)) {
    throw new TypeError('reactRoot must be an absolute path');
  }
  const indexPath = path.join(reactRoot, 'index.html');
  const router = express.Router();
  router.use((request, response, next) => {
    response.set('Cache-Control', 'no-store');
    response.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
    if (!hasValidKitchenSession(request, sessionSecret)) {
      return response.status(200).type('html').send(LOGIN_PAGE);
    }
    if (!fs.existsSync(indexPath)) {
      return response.status(503).type('text').send('Kitchen board is unavailable.');
    }
    return response.sendFile(indexPath, (error) => {
      if (error) next(error);
    });
  });
  return router;
}

// Lets a kitchen session load the admin bundle's static assets (JS/CSS/
// icons) that index.html references under /app/. Extension-bearing GET
// requests only; everything else falls through to the decoy gate untouched.
function createKitchenAssetBridge({ reactRoot, sessionSecret }) {
  const serveStatic = express.static(reactRoot, { fallthrough: true, index: false });
  return (request, response, next) => {
    if (
      request.method === 'GET' &&
      path.extname(request.path) !== '' &&
      hasValidKitchenSession(request, sessionSecret)
    ) {
      return serveStatic(request, response, next);
    }
    return next();
  };
}

module.exports = {
  KITCHEN_COOKIE,
  createKitchenApiRouter,
  createKitchenAppRouter,
  createKitchenAssetBridge,
  createKitchenLoginRouter,
  hasValidKitchenSession,
};
