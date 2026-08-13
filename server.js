// Bat Melech — static server with basic auth + Postgres-backed state sync.
// Serves the orders app (repo root) and the marketing site (/site) unchanged;
// a sync script is injected into HTML at serve time so app files stay untouched.
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const { createOrderIntakeRouter } = require('./server/ai/order-intake-route');
const { createOperationsReviewRouter } = require('./server/ai/operations-review-route');
const { createCustomerOrderRouter } = require('./server/customer-order-route');
const { createPublicLandingRouter } = require('./server/public-landing-route');
const { createLegacyManagerRouter } = require('./server/legacy-manager-route');
const { createHotelSearchRouter } = require('./server/hotels/hotel-search-route');
const { createReactAppRouter } = require('./server/react-app-route');
const { createStateRepository } = require('./server/state/state-repository');
const { createStateRouter } = require('./server/state/state-route');
const { createStateSafetyService } = require('./server/state/state-service');
const { startAfterStateInitialization } = require('./server/state/state-startup');

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

function hasValidBasicAuth(request) {
  const header = request.headers.authorization || '';
  const [scheme, b64] = header.split(' ');
  if (scheme !== 'Basic' || !b64) return false;
  const [user, ...rest] = Buffer.from(b64, 'base64').toString().split(':');
  return user === AUTH_USER && rest.join(':') === AUTH_PASS;
}

// Production serves only the exact source tree baked into the deployed image.
// Releases therefore stay attributable to one reviewed Git commit.
const contentRoot = ROOT;

// --- health check (no auth, used by Railway) ---
app.get('/healthz', (req, res) => res.send('ok'));

// Public marketing entry point and public order form. Neither route receives
// Basic Auth, the state sync script, or any administrative state.
app.use('/coming-soon', createPublicLandingRouter({ contentRoot }));
app.use('/new-order', createCustomerOrderRouter({ getContentRoot: () => contentRoot }));
// The landing page references only this curated, non-sensitive asset directory.
// Keep it public so browsers can load the brand image and icons without exposing
// the authenticated operator application or its data.
app.use('/assets', express.static(path.join(contentRoot, 'public', 'assets'), {
  dotfiles: 'deny',
  index: false,
}));

// --- Public customer-facing site: no Basic Auth, no admin state. Same
// static-plus-SPA-fallback shape as the authenticated React app so deep
// links like /site/checkout resolve to the client router instead of 404. ---
app.use('/site', createReactAppRouter({ reactRoot: path.join(contentRoot, 'site') }));
// Root goes to the public site for customers; staff with saved credentials
// (browser already sent Basic Auth) land straight in the admin app instead.
app.get(/^\/$/, (request, response) => {
  response.set('Cache-Control', 'no-store');
  response.redirect(302, hasValidBasicAuth(request) ? '/app/today' : '/site/');
});

app.get('/robots.txt', (_request, response) => {
  response.type('text/plain').send([
    'User-agent: *',
    'Disallow: /orders/admin',
    'Disallow: /app',
    'Disallow: /api',
    'Disallow: /legacy',
  ].join('\n') + '\n');
});

// --- Public customer form: no manager sync, state API, or admin authentication ---
app.use('/order-form.html', createCustomerOrderRouter({ getContentRoot: () => contentRoot }));

// --- basic auth on everything else ---
app.use((req, res, next) => {
  if (hasValidBasicAuth(req)) return next();
  res.set('WWW-Authenticate', 'Basic realm="Bat Melech"');
  res.status(401).send('Authentication required');
});

app.use(express.json({ limit: '15mb' }));

// --- AI-assisted order interpretation (review-only; never persists state) ---
app.use('/api/ai/order-intake', createOrderIntakeRouter());

// --- AI-assisted operations analysis (sanitized advisory; never persists state) ---
app.use('/api/ai/operations-review', createOperationsReviewRouter());

// --- Explicit staff-triggered hotel search; no customer or order state ---
app.use('/api/hotels/search', createHotelSearchRouter());

// --- Versioned Postgres-backed app state with merge, history, and idempotency ---
let pool = null;
let stateRepository = null;
if (process.env.DATABASE_URL) {
  // Uses Railway private networking (railway.internal) — plain TCP inside the
  // private network, no TLS needed. External URLs should carry ?sslmode=require.
  const commandSecret = requireServerCredential('BM_STATE_COMMAND_SECRET');
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  stateRepository = createStateRepository({ pool, commandSecret });
  app.use('/api/state', createStateRouter({
    service: createStateSafetyService({ repository: stateRepository }),
  }));
} else {
  app.use('/api/state', (_request, response) => {
    response.set('Cache-Control', 'no-store');
    response.set('Pragma', 'no-cache');
    response.status(503).json({ error: 'state unavailable' });
  });
}

// --- Permanent legacy manager backup: authenticated, same versioned state ---
app.get(/^\/legacy$/, (req, res) => res.redirect(308, '/legacy/'));
app.use('/legacy', createLegacyManagerRouter({ getContentRoot: () => contentRoot }));

// Retire stale HTML entry points before the generic legacy file handler. Old
// bookmarks must never execute obsolete pricing or whole-state persistence.
app.get('/app.html', (_request, response) => {
  response.set('Cache-Control', 'no-store');
  response.redirect(302, '/app/today');
});
app.get('/order.html', (_request, response) => {
  response.set('Cache-Control', 'no-store');
  response.redirect(302, '/order-form.html');
});

// React's asset-safe history fallback rejects extension-looking paths. Retire
// old customer-form bookmarks explicitly before the /app router sees them.
app.get(['/app/order-form.html', '/app/order.html'], (_request, response) => {
  response.set('Cache-Control', 'no-store');
  response.redirect(302, '/order-form.html');
});

// --- React operator application: authenticated, isolated below /app/ ---
app.get(/^\/app$/, (req, res) => res.redirect(308, '/app/'));
app.use('/app', createReactAppRouter({ reactRoot: REACT_ROOT }));

// The operator application has a deliberately non-obvious, authenticated
// entry path. Keep the old /app path working for existing bookmarks while
// preventing search engines from indexing either operator surface.
app.use('/orders/admin', (request, response, next) => {
  response.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  response.set('Cache-Control', 'no-store');
  next();
}, createReactAppRouter({ reactRoot: REACT_ROOT }));


// --- Explicit emergency legacy entry; unrelated HTML never receives app state ---
app.use('/index.html', createLegacyManagerRouter({ getContentRoot: () => contentRoot }));

// bm-sync.js always comes from the server image (server-owned, not repo content)
app.get('/bm-sync.js', (req, res) => res.sendFile(path.join(ROOT, 'bm-sync.js')));
app.use((req, res, next) => express.static(contentRoot)(req, res, next));

startAfterStateInitialization({
  repository: stateRepository,
  listen: () => app.listen(
    PORT,
    () => console.log(`batmelech listening on :${PORT}, db: ${pool ? 'on' : 'off'}`)
  ),
  closePool: pool ? () => pool.end() : undefined,
}).catch((error) => {
  console.error('startup failed:', error.message);
  process.exitCode = 1;
});
