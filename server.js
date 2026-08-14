// Bat Melech — static server with a disguised staff gate + Postgres-backed
// state sync. Serves the orders app (repo root) and the marketing site
// (/site) unchanged; a sync script is injected into HTML at serve time so
// app files stay untouched.
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
const { createSiteOrderRouter } = require('./server/site-order-route');
const { createSiteStatusRouter } = require('./server/site-status-route');
const { createTelegramWebhookRouter } = require('./server/telegram/webhook-route');
const { createMeyAgent } = require('./server/telegram/mey-agent');
const { createDecoyGate, hasValidSession, clearSessionCookie, createGlobal404Handler } = require('./server/auth/decoy-auth');
const { createDecoyLoginRouter } = require('./server/auth/decoy-login-route');
const { createGenericContactRouter } = require('./server/auth/generic-contact-route');
const businessDataRepository = require('./server/business-data/repository');
const { wrapRepositoryWithInvoiceTrigger } = require('./server/business-data/invoice-trigger');
const { createZiinaKeyRouter } = require('./server/business-data/ziina-key-route');
const { createStaffCredentialsRouter } = require('./server/auth/staff-credentials-route');
const { createInvoiceDownloadRouter } = require('./server/business-data/invoice-download-route');
const { createStateRepository } = require('./server/state/state-repository');
const { createStateRouter } = require('./server/state/state-route');
const { createStateSafetyService } = require('./server/state/state-service');
const { startAfterStateInitialization } = require('./server/state/state-startup');

const app = express();
// Railway sits as a single reverse-proxy hop in front of this service — trust
// its X-Forwarded-For so req.ip is the real visitor, not Railway's edge IP.
// The decoy login's per-IP lockout is meaningless without this.
app.set('trust proxy', 1);
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

// Repurposed from Basic Auth: still the staff username/password, now checked
// through the hidden two-step "contact form" flow instead of a browser prompt.
const AUTH_USER = requireServerCredential('BM_USER');
const AUTH_PASS = requireServerCredential('BM_PASS');
const SESSION_SECRET = requireServerCredential('BM_SESSION_SECRET');

// Production serves only the exact source tree baked into the deployed image.
// Releases therefore stay attributable to one reviewed Git commit.
const contentRoot = ROOT;

// Created early (before the public routes below) so the public site-order
// intake route can use the same repository instance as /api/state.
let pool = null;
let stateRepository = null;
if (process.env.DATABASE_URL) {
  // Uses Railway private networking (railway.internal) — plain TCP inside the
  // private network, no TLS needed. External URLs should carry ?sslmode=require.
  const commandSecret = requireServerCredential('BM_STATE_COMMAND_SECRET');
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const rawStateRepository = createStateRepository({ pool, commandSecret });
  // payment_credentials/invoices/invoice_number_seq are plain tables outside
  // the schema-drift-validated bm_state system (see business-data/repository.js).
  const combinedRepository = {
    ...rawStateRepository,
    async initialize() {
      await rawStateRepository.initialize();
      await businessDataRepository.initializeBusinessData(pool);
    },
  };
  // Any successful state save (admin editor, site checkout, backup restore)
  // can trigger a VAT invoice email when an order flips to paid with an email
  // on file — wrapping here covers every save path with no change to the
  // tested state-repository/service/route files.
  stateRepository = wrapRepositoryWithInvoiceTrigger(combinedRepository, {
    pool,
    resendApiKey: process.env.RESEND_API_KEY,
  });
}

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
// Public order intake from the customer site's checkout — persists straight
// into the same orders[] the admin app reads, no admin auth, no state sync.
if (stateRepository) {
  app.use('/api/site/orders', createSiteOrderRouter({ repository: stateRepository }));
  app.use('/api/site/status', createSiteStatusRouter({ repository: stateRepository }));
} else {
  app.use('/api/site/orders', (_request, response) => {
    response.set('Cache-Control', 'no-store');
    response.status(503).json({ error: 'order intake unavailable' });
  });
  app.use('/api/site/status', (_request, response) => {
    response.set('Cache-Control', 'no-store');
    response.status(503).json({ error: 'status unavailable' });
  });
}
// מיי — Lin's Telegram assistant. Publicly reachable (Telegram must be able
// to POST to it) but only acts on messages from the known staff chat, and
// only via the bounded tool set in server/business-actions.js.
if (stateRepository && process.env.TELEGRAM_WEBHOOK_SECRET && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_ORDERS_CHAT_ID) {
  app.use(
    '/api/telegram/webhook',
    createTelegramWebhookRouter({
      webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      ordersChatId: process.env.TELEGRAM_ORDERS_CHAT_ID,
      agent: createMeyAgent({ repository: stateRepository }),
    })
  );
}
// Disguised staff login: only decoy-gate-page.html (served for /admin and
// its aliases) ever posts here. No admin auth of its own — it IS the auth,
// checked message by message.
app.use('/api/site/access', createDecoyLoginRouter({
  authUser: AUTH_USER,
  authPass: AUTH_PASS,
  sessionSecret: SESSION_SECRET,
  pool,
  encryptionKey: process.env.BM_SECRETS_KEY,
}));
// Generic "contact us" form on every OTHER 404 site-wide — never grants
// access, only emails the message. See generic-contact-route.js.
app.use('/api/site/contact', createGenericContactRouter({ resendApiKey: process.env.RESEND_API_KEY }));
// Public invoice-download link referenced from invoice emails — token-gated,
// not just invoice number (numbers are sequential/guessable).
if (pool) {
  app.use('/invoices', createInvoiceDownloadRouter({ pool }));
} else {
  app.use('/invoices', (_request, response) => {
    response.set('Cache-Control', 'no-store');
    response.status(503).send('Not available');
  });
}
// Root goes to the public site for customers; staff with an active session
// land straight in the admin app instead.
app.get(/^\/$/, (request, response) => {
  response.set('Cache-Control', 'no-store');
  response.redirect(302, hasValidSession(request, SESSION_SECRET) ? '/admin/today' : '/site/');
});

app.get('/robots.txt', (_request, response) => {
  response.type('text/plain').send([
    'User-agent: *',
    'Disallow: /orders/admin',
    'Disallow: /app',
    'Disallow: /api',
    'Disallow: /legacy',
    'Sitemap: https://www.batmelech.ae/site/sitemap.xml',
  ].join('\n') + '\n');
});

// --- Public customer form: no manager sync, state API, or admin authentication ---
app.use('/order-form.html', createCustomerOrderRouter({ getContentRoot: () => contentRoot }));

// --- staff gate on everything else: no valid session -> looks like a 404 ---
app.use(createDecoyGate(SESSION_SECRET));

// Only reachable with a valid session already (the gate above ran first).
app.post('/api/auth/logout', (_request, response) => {
  clearSessionCookie(response);
  response.set('Cache-Control', 'no-store');
  response.status(204).end();
});

app.use(express.json({ limit: '15mb' }));

// --- AI-assisted order interpretation (review-only; never persists state) ---
app.use('/api/ai/order-intake', createOrderIntakeRouter());

// --- AI-assisted operations analysis (sanitized advisory; never persists state) ---
app.use('/api/ai/operations-review', createOperationsReviewRouter());

// --- Explicit staff-triggered hotel search; no customer or order state ---
app.use('/api/hotels/search', createHotelSearchRouter());

// --- Admin-only, write-only payment provider key. Never echoed back. ---
if (pool && process.env.BM_SECRETS_KEY) {
  app.use('/api/settings/ziina-key', createZiinaKeyRouter({ pool, encryptionKey: process.env.BM_SECRETS_KEY }));
} else {
  app.use('/api/settings/ziina-key', (_request, response) => {
    response.set('Cache-Control', 'no-store');
    response.status(503).json({ error: 'not configured' });
  });
}

// --- Admin-only, write-only staff login (username/password). Encrypted at
// rest, never echoed back; decoy-login-route.js reads it on every attempt. ---
if (pool && process.env.BM_SECRETS_KEY) {
  app.use('/api/settings/staff-credentials', createStaffCredentialsRouter({ pool, encryptionKey: process.env.BM_SECRETS_KEY }));
} else {
  app.use('/api/settings/staff-credentials', (_request, response) => {
    response.set('Cache-Control', 'no-store');
    response.status(503).json({ error: 'not configured' });
  });
}

// --- Versioned Postgres-backed app state with merge, history, and idempotency ---
if (stateRepository) {
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

// /admin is the real entry point Lin actually uses day to day. /app and
// /orders/admin stay alive underneath the same decoy gate purely so old
// bookmarks don't break — neither is easier to reach than the other without
// a valid session, and search engines get told to ignore both.
app.get(/^\/admin$/, (req, res) => res.redirect(308, '/admin/'));
app.use('/admin', (request, response, next) => {
  response.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  response.set('Cache-Control', 'no-store');
  next();
}, createReactAppRouter({ reactRoot: REACT_ROOT }));

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
// contentRoot is the WHOLE repo checkout, not a curated public/ folder — this
// must stay session-gated or every source file (server.js, STATE.md, client
// requirement docs, ...) becomes a public static file. The decoy gate above
// only covers its known protected prefixes, so this needs its own check.
app.use((req, res, next) => {
  if (!hasValidSession(req, SESSION_SECRET)) return next();
  express.static(contentRoot)(req, res, next);
});

// Last resort: any path nothing above matched (bot probes, typos, dead
// links) gets the same decoy 404 as everywhere else — never Express's
// default error page, which would be the one inconsistent tell on the site.
app.use(createGlobal404Handler());

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
