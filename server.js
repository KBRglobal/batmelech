// Bat Melech — static server with a disguised staff gate + Postgres-backed
// state sync. Serves the orders app (repo root) and the marketing site
// (/site) unchanged; a sync script is injected into HTML at serve time so
// app files stay untouched.
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const { createOrderIntakeRouter } = require('./server/ai/order-intake-route');
const { createOrderReplyRouter } = require('./server/ai/order-reply-route');
const { createOperationsReviewRouter } = require('./server/ai/operations-review-route');
const { createCustomerOrderRouter } = require('./server/customer-order-route');
const { createPublicLandingRouter } = require('./server/public-landing-route');
const { createHotelSearchRouter } = require('./server/hotels/hotel-search-route');
const { PUBLIC_SITE_SECURITY_HEADERS, createReactAppRouter } = require('./server/react-app-route');
const { transformSiteIndexHtml } = require('./server/site-meta');
const { createSiteOrderRouter } = require('./server/site-order-route');
const { createSiteStatusRouter } = require('./server/site-status-route');
const { createSiteCatalogRouter } = require('./server/site-catalog-route');
const { createPublicWindowsRouter, createWindowsAdminRouter } = require('./server/delivery-windows');
const { createPublicHolidaysRouter, createHolidaysAdminRouter } = require('./server/holidays/holidays-route');
const { createConciergeRouter } = require('./server/ai/concierge-route');
const { createStateHistoryRouter } = require('./server/state-history-route');
const { createTelegramWebhookRouter } = require('./server/telegram/webhook-route');
const { createMeyAgent } = require('./server/telegram/mey-agent');
const { createWhatsAppIntake } = require('./server/telegram/whatsapp-intake');
const { createMeyAuditRouter } = require('./server/telegram/mey-audit-route');
const { createOpenAIOrderIntake } = require('./server/ai/openai-order-intake');
const { createOpenAIOrderReply } = require('./server/ai/openai-order-reply');
const { createR2Storage } = require('./server/telegram/r2-storage');
const { createVoiceTranscriber } = require('./server/telegram/transcribe-voice');
const { createProofHandler } = require('./server/telegram/proof-of-delivery');
const { createCallbackHandler } = require('./server/telegram/callback-handler');
const { createDeliveryScheduler } = require('./server/telegram/delivery-scheduler');
const { createBusinessClock } = require('./server/telegram/business-clock');
const { getFilePath, downloadFile } = require('./server/telegram/telegram-files');
const { createDecoyGate, createSiteOnlyHostGate, hasValidSession, clearSessionCookie, createGlobal404Handler } = require('./server/auth/decoy-auth');
const {
  createKitchenApiRouter,
  createKitchenAppRouter,
  createKitchenAssetBridge,
  createKitchenLoginRouter,
} = require('./server/auth/kitchen-route');
const { createDecoyLoginRouter } = require('./server/auth/decoy-login-route');
const { createGenericContactRouter } = require('./server/auth/generic-contact-route');
const businessDataRepository = require('./server/business-data/repository');
const { wrapRepositoryWithInvoiceTrigger } = require('./server/business-data/invoice-trigger');
const { createZiinaKeyRouter } = require('./server/business-data/ziina-key-route');
const { createStaffCredentialsRouter } = require('./server/auth/staff-credentials-route');
const { createInvoiceDownloadRouter } = require('./server/business-data/invoice-download-route');
const { createInvoiceBrowseRouter } = require('./server/business-data/invoice-browse-route');
const { createDeliveryPhotosRouter } = require('./server/business-data/delivery-photos-route');
const { createMenuImageRouter } = require('./server/menu-image-route');
const { createSupplierInvoicesRouter } = require('./server/expenses/supplier-invoices-route');
const { createInvoiceScanner } = require('./server/expenses/invoice-scan');
const supplierInvoicesRepository = require('./server/expenses/repository');
const { createStoragePlan } = require('./server/storage-plan');
const { createStateRepository } = require('./server/state/state-repository');
const { createStateRouter } = require('./server/state/state-route');
const { createStateSafetyService } = require('./server/state/state-service');
const { startAfterStateInitialization } = require('./server/state/state-startup');
const { createTrackingRouter } = require('./server/track/tracking-route');
const { createTrackingAdminRouter } = require('./server/track/tracking-admin-route');
const { createCalendarRouter } = require('./server/calendar/ics-route');

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
      await supplierInvoicesRepository.initializeSupplierInvoices(pool);
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

// Origin split: hosts listed in BM_SITE_ONLY_HOSTS carry ONLY the public
// site (+ kitchen/tracking); every staff surface, including the hidden
// login, answers with the generic decoy 404 there. No-op until the env is
// set — activation is a config decision, not a deploy.
app.use(createSiteOnlyHostGate(process.env.BM_SITE_ONLY_HOSTS));

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

// --- Public customer-facing site. Canonical home is the CLEAN ROOT domain
// (batmelech.ae/...); the historical /site page URLs 301 there so old links
// and search results consolidate. Files (assets, sitemap.xml, llms.txt) keep
// their extensions and keep serving under /site — the built bundle's base
// path needs no change. ---
app.get(/^\/site(?:\/|$)/, (request, response, next) => {
  const rest = request.path.slice('/site'.length) || '/';
  if (path.extname(rest) !== '') return next();
  response.set('Cache-Control', 'no-store');
  return response.redirect(301, rest === '' ? '/' : rest);
});
const publicSiteRouter = createReactAppRouter({
  reactRoot: path.join(contentRoot, 'site'),
  securityHeaders: PUBLIC_SITE_SECURITY_HEADERS,
  transformIndexHtml: transformSiteIndexHtml,
});
app.use('/site', publicSiteRouter);
// Public order intake from the customer site's checkout — persists straight
// into the same orders[] the admin app reads, no admin auth, no state sync.
if (stateRepository) {
  app.use('/api/site/orders', createSiteOrderRouter({ repository: stateRepository }));
  app.use('/api/site/status', createSiteStatusRouter({ repository: stateRepository }));
  app.use('/api/site/catalog', createSiteCatalogRouter({ repository: stateRepository }));
  // Site concierge chat: public, strictly rate-limited, answers only from
  // live catalog + fixed business facts, in the visitor's language.
  app.use('/api/site/concierge', createConciergeRouter({ repository: stateRepository }));
  app.use('/api/site/delivery-windows', createPublicWindowsRouter({ repository: stateRepository }));
  app.use('/api/site/holidays', createPublicHolidaysRouter({ repository: stateRepository }));
} else {
  app.use('/api/site/orders', (_request, response) => {
    response.set('Cache-Control', 'no-store');
    response.status(503).json({ error: 'order intake unavailable' });
  });
  app.use('/api/site/status', (_request, response) => {
    response.set('Cache-Control', 'no-store');
    response.status(503).json({ error: 'status unavailable' });
  });
  app.use('/api/site/catalog', (_request, response) => {
    response.set('Cache-Control', 'no-store');
    response.status(503).json({ error: 'catalog unavailable' });
  });
  app.use('/api/site/concierge', (_request, response) => {
    response.set('Cache-Control', 'no-store');
    response.status(503).json({ error: { code: 'ai_not_configured', message: 'The concierge is unavailable.' } });
  });
  app.use('/api/site/delivery-windows', (_request, response) => {
    response.set('Cache-Control', 'no-store');
    response.status(503).json({ error: 'windows unavailable' });
  });
  app.use('/api/site/holidays', (_request, response) => {
    response.set('Cache-Control', 'no-store');
    response.status(503).json({ error: 'holidays unavailable' });
  });
}
// מיי — Lin's Telegram assistant, now also Felix's delivery dispatcher.
// Publicly reachable (Telegram must be able to POST to it) but only acts on
// messages from the known staff chat, and only via the bounded tool set in
// server/business-actions.js. Photo/voice/location/callback handlers degrade
// to no-ops when their dependencies are unavailable.
if (stateRepository && process.env.TELEGRAM_WEBHOOK_SECRET && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_ORDERS_CHAT_ID) {
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_ORDERS_CHAT_ID;
  // Phone-only WhatsApp intake: same review pipeline as the panel, wired so
  // מיי can build a draft order from a forwarded conversation or export file.
  const whatsappIntake = createWhatsAppIntake({
    repository: stateRepository,
    reviewOrderIntake: createOpenAIOrderIntake(),
    draftOrderReply: createOpenAIOrderReply(),
  });
  const meyAgent = createMeyAgent({ repository: stateRepository, whatsappIntake });
  const r2Storage = createR2Storage();
  app.use(
    '/api/telegram/webhook',
    createTelegramWebhookRouter({
      webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
      botToken: telegramBotToken,
      ordersChatId: telegramChatId,
      agent: meyAgent,
      repository: stateRepository,
      proofHandler: r2Storage.enabled
        ? createProofHandler({
            repository: stateRepository,
            storage: r2Storage,
            botToken: telegramBotToken,
            chatId: telegramChatId,
          })
        : null,
      voiceTranscriber: createVoiceTranscriber(),
      callbackHandler: createCallbackHandler({
        repository: stateRepository,
        botToken: telegramBotToken,
        chatId: telegramChatId,
        agent: meyAgent,
      }),
      telegramFiles: { getFilePath, downloadFile },
      whatsappIntake,
    })
  );
  // Proactive delivery reminders (Friday digest, lead/check-in/late nudges).
  // Kill switch: remove/blank MEY_DELIVERY_REMINDERS on Railway to disable.
  if (process.env.MEY_DELIVERY_REMINDERS === 'on') {
    const deliveryScheduler = createDeliveryScheduler({
      repository: stateRepository,
      botToken: telegramBotToken,
      chatId: telegramChatId,
    });
    deliveryScheduler.start();
  }
  // Wednesday digest, Saturday-night weekly summary, nightly encrypted
  // off-site backup. Kill switch: BM_BUSINESS_CLOCK=off.
  if (process.env.BM_BUSINESS_CLOCK !== 'off') {
    const businessClock = createBusinessClock({
      repository: stateRepository,
      botToken: telegramBotToken,
      chatId: telegramChatId,
      storage: r2Storage,
    });
    businessClock.start();
  }
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
// The public site answers on the clean root domain. Staff with an active
// session still land straight in the admin app from '/'. Only the known
// site pages are claimed — every staff/hidden path stays untouched and
// keeps falling through to the decoy gate.
const SITE_PAGE_NAMES = [
  'weekdays', 'story', 'shabbat-order', 'shabbat-extras', 'checkout',
  'legal', 'kashrut', 'gallery', 'events', 'how-it-works', 'experiences',
];
const SITE_PAGE_REGEX = new RegExp(
  `^/(?:en|fr)?/?$|^/(?:(?:en|fr)/)?(?:${SITE_PAGE_NAMES.join('|')})(?:/|$)`
);
app.use((request, response, next) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return next();
  if (request.path === '/' && hasValidSession(request, SESSION_SECRET)) {
    response.set('Cache-Control', 'no-store');
    return response.redirect(302, '/admin/today');
  }
  if (!SITE_PAGE_REGEX.test(request.path)) return next();
  return publicSiteRouter(request, response, next);
});

app.get('/sitemap.xml', (_request, response) => {
  response.sendFile(path.join(contentRoot, 'site', 'sitemap.xml'));
});

app.get('/robots.txt', (_request, response) => {
  response.type('text/plain').send([
    'User-agent: *',
    'Disallow: /orders/admin',
    'Disallow: /app',
    'Disallow: /api',
    'Disallow: /kitchen',
    'Disallow: /t',
    'Disallow: /calendar',
    'Sitemap: https://www.batmelech.ae/sitemap.xml',
  ].join('\n') + '\n');
});

// --- מצב מטבח: the wall-tablet surface. Its OWN low-privilege login (Moshe:
// separate user/pass, can only view and mark prep done — nothing else). All
// kitchen mounts sit BEFORE the decoy gate; the asset bridge lets a kitchen
// session load the bundle's static files without a staff session. ---
{
  const kitchenUser = process.env.BM_KITCHEN_USER || 'lin';
  const kitchenPass = process.env.BM_KITCHEN_PASS || 'lin123';
  app.use('/api/kitchen/login', createKitchenLoginRouter({
    kitchenUser,
    kitchenPass,
    sessionSecret: SESSION_SECRET,
  }));
  if (stateRepository) {
    app.use('/api/kitchen', createKitchenApiRouter({
      repository: stateRepository,
      sessionSecret: SESSION_SECRET,
    }));
  } else {
    app.use('/api/kitchen', (_request, response) => {
      response.set('Cache-Control', 'no-store');
      response.status(503).json({ error: 'kitchen unavailable' });
    });
  }
  app.use('/kitchen', createKitchenAppRouter({ reactRoot: REACT_ROOT, sessionSecret: SESSION_SECRET }));
  app.use('/app', createKitchenAssetBridge({ reactRoot: REACT_ROOT, sessionSecret: SESSION_SECRET }));
}

// --- Public customer form: no manager sync, state API, or admin authentication ---
app.use('/order-form.html', createCustomerOrderRouter({ getContentRoot: () => contentRoot }));

// --- Hotel search for both the admin panel and the public checkout: read-only
// place lookup, no customer or order state. Rate limited per IP inside the
// router because it is reachable without a staff session. ---
app.use('/api/hotels/search', createHotelSearchRouter());

// --- Public customer tracking: signed per-order link, read-only, generic 404
// for anything invalid. Must sit BEFORE the decoy gate. ---
if (stateRepository) {
  app.use('/t', createTrackingRouter({ repository: stateRepository, sessionSecret: SESSION_SECRET }));
  // Phone-calendar ICS feed of deliveries — the signed URL is the capability.
  app.use('/calendar', createCalendarRouter({ repository: stateRepository, sessionSecret: SESSION_SECRET }));
}

// --- staff gate on everything else: no valid session -> looks like a 404 ---
app.use(createDecoyGate(SESSION_SECRET));

// Only reachable with a valid session already (the gate above ran first).
app.post('/api/auth/logout', (_request, response) => {
  clearSessionCookie(response);
  response.set('Cache-Control', 'no-store');
  response.status(204).end();
});

// --- Staff-only: mint the signed customer tracking link for an order ---
app.use('/api/tracking-link', createTrackingAdminRouter({ sessionSecret: SESSION_SECRET }));

app.use(express.json({ limit: '15mb' }));

// --- AI-assisted order interpretation (review-only; never persists state) ---
app.use('/api/ai/order-intake', createOrderIntakeRouter());

// --- AI-drafted WhatsApp reply for Lin to copy (read-only; system never sends) ---
app.use('/api/ai/order-reply', createOrderReplyRouter({ repository: stateRepository }));

// --- Staff-only: Jewish holiday menus configuration ---
if (stateRepository) {
  app.use('/api/holidays', createHolidaysAdminRouter({ repository: stateRepository }));
} else {
  app.use('/api/holidays', (_request, response) => {
    response.set('Cache-Control', 'no-store');
    response.status(503).json({ error: 'holidays unavailable' });
  });
}

// --- Staff-only: delivery time windows configuration ---
if (stateRepository) {
  app.use('/api/settings/delivery-windows', createWindowsAdminRouter({ repository: stateRepository }));
} else {
  app.use('/api/settings/delivery-windows', (_request, response) => {
    response.set('Cache-Control', 'no-store');
    response.status(503).json({ error: 'windows unavailable' });
  });
}

// --- מיי audit log: browse/undo her changes, emergency freeze control ---
if (stateRepository) {
  app.use('/api/mey/audit', createMeyAuditRouter({ repository: stateRepository }));
} else {
  app.use('/api/mey/audit', (_request, response) => {
    response.set('Cache-Control', 'no-store');
    response.status(503).json({ error: 'audit unavailable' });
  });
}

// --- AI-assisted operations analysis (sanitized advisory; never persists state) ---
app.use('/api/ai/operations-review', createOperationsReviewRouter());

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

// --- Admin-only storage plan status (usage, quota, upgrade links). ---
const storagePlan = createStoragePlan();
app.use('/api/settings/storage-plan', storagePlan.createRouter());

// --- Admin-only supplier expenses: upload + AI scan + categorized archive. ---
{
  const invoiceFilesStorage = createR2Storage();
  if (invoiceFilesStorage.enabled && pool) {
    app.use('/api/settings/supplier-invoices', createSupplierInvoicesRouter({
      pool,
      storage: invoiceFilesStorage,
      scanner: createInvoiceScanner(),
      quota: storagePlan,
    }));
  } else {
    app.use('/api/settings/supplier-invoices', (_request, response) => {
      response.set('Cache-Control', 'no-store');
      response.status(503).json({ error: 'not configured' });
    });
  }
}

// --- Admin-only dish photo upload for the menu editor. ---
{
  const menuImageStorage = createR2Storage();
  if (menuImageStorage.enabled) {
    app.use('/api/settings/menu-image', createMenuImageRouter({ storage: menuImageStorage, quota: storagePlan }));
  } else {
    app.use('/api/settings/menu-image', (_request, response) => {
      response.set('Cache-Control', 'no-store');
      response.status(503).json({ error: 'not configured' });
    });
  }
}

// --- Staff-only invoices: browse issued ones, re-send one, issue one by hand.
// The state repository comes along because issuing by hand reads orders and
// business settings out of the same versioned state the panel edits. ---
if (pool) {
  app.use('/api/invoices', createInvoiceBrowseRouter({
    pool,
    resendApiKey: process.env.RESEND_API_KEY,
    stateRepository,
  }));
} else {
  app.use('/api/invoices', (_request, response) => {
    response.set('Cache-Control', 'no-store');
    response.status(503).json({ error: 'invoices unavailable' });
  });
}

// --- Versioned Postgres-backed app state with merge, history, and idempotency ---
if (stateRepository) {
  // History browse/restore must mount before the general state router so its
  // subpaths are not swallowed. Same decoy-gated /api/state prefix.
  app.use('/api/state/history', createStateHistoryRouter({ pool, repository: stateRepository }));
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

// --- Staff-only delivery proof photo gallery: read-only, safe field set only ---
app.use('/api/delivery-photos', createDeliveryPhotosRouter({ repository: stateRepository }));

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
app.use('/app', (request, response, next) => {
  response.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  next();
});
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


// The legacy manager was retired; old entry points fall through to the
// decoy gate like any other unknown path.
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
