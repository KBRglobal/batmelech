'use strict';

// Public customer tracking page: GET /t/:orderId/:sig renders a read-only,
// server-side HTML view of one order's delivery status — the flagship
// "personal link" surface. It reads the same state Felix's Telegram flow
// writes (courier check-in, ETA, delivery proof) and never writes anything.
//
// Privacy stance: the page shows first name, service date/time, destination
// label, a status timeline, the courier line, and the delivery photo. It
// never shows prices, phone numbers, notes, or any other order's data. An
// invalid or unknown link gets a generic 404 with no hint that tracking
// exists here at all.

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { verifyTrackingSignature } = require('./tracking-token');
const { destinationLabel, orderName, orderStatus } = require('../telegram/delivery-day');

const CANCELLED_STATUS = 'בוטלה';
const NO_NAME = 'ללא שם';
const NO_DESTINATION = 'יעד לא צוין';
const ETA_FRESHNESS_MS = 3 * 60 * 60 * 1000;
const MAX_TEXT_LENGTH = 200;

// Timeline: received -> confirmed -> being prepared -> out for delivery -> delivered.
const STEP_BY_STATUS = {
  'חדשה': 0,
  'אושרה': 1,
  'מוכנה': 2,
  'במשלוח': 3,
  'נמסרה': 4,
};
const OUT_FOR_DELIVERY_STEP = 3;
const DELIVERED_STEP = 4;

const LANGS = new Set(['he', 'en', 'fr']);

// Native copy per language. Register matters: this is a kosher Shabbat
// kitchen — always Shabbat/Chabbat, never Saturday/samedi.
const COPY = {
  he: {
    locale: 'he',
    dir: 'rtl',
    brandLatin: 'Bat Melech',
    brand: 'מטעמי בת מלך',
    tagline: 'מטבח ביתי כשר · דובאי',
    title: 'מעקב הזמנה',
    hello: (name) => `שלום ${name},`,
    intro: 'הזמנת השבת שלך',
    dateLabel: 'מועד',
    destinationLabel: 'יעד',
    pickup: 'איסוף עצמי מהמטבח',
    steps: ['התקבלה', 'אושרה', 'בהכנה', 'בדרך אליך', 'נמסרה'],
    courier: 'השליח בדרך אליך',
    eta: (minutes) => `הגעה משוערת: בעוד כ-${minutes} דקות`,
    deliveredNote: 'ההזמנה נמסרה. שבת שלום!',
    proofCaption: 'תמונת המסירה',
  },
  en: {
    locale: 'en-GB',
    dir: 'ltr',
    brandLatin: 'Bat Melech',
    brand: 'מטעמי בת מלך',
    tagline: 'Kosher home kitchen · Dubai',
    title: 'Order tracking',
    hello: (name) => `Hello ${name},`,
    intro: 'Your Shabbat order',
    dateLabel: 'Service date',
    destinationLabel: 'Destination',
    pickup: 'Pickup from the kitchen',
    steps: ['Received', 'Confirmed', 'Being prepared', 'Out for delivery', 'Delivered'],
    courier: 'The courier is on the way',
    eta: (minutes) => `Estimated arrival: about ${minutes} minutes`,
    deliveredNote: 'Your order has been delivered. Shabbat Shalom!',
    proofCaption: 'Delivery photo',
  },
  fr: {
    locale: 'fr',
    dir: 'ltr',
    brandLatin: 'Bat Melech',
    brand: 'מטעמי בת מלך',
    tagline: 'Cuisine familiale casher · Dubaï',
    title: 'Suivi de commande',
    hello: (name) => `Bonjour ${name},`,
    intro: 'Votre commande de Chabbat',
    dateLabel: 'Date',
    destinationLabel: 'Destination',
    pickup: 'Retrait à la cuisine',
    steps: ['Reçue', 'Confirmée', 'En préparation', 'En cours de livraison', 'Livrée'],
    courier: 'Le livreur est en route',
    eta: (minutes) => `Arrivée estimée : dans environ ${minutes} minutes`,
    deliveredNote: 'Votre commande a été livrée. Chabbat Chalom !',
    proofCaption: 'Photo de livraison',
  },
};

// Deliberately anonymous: no brand, no wording that reveals a tracking
// surface lives under this path.
const NOT_FOUND_PAGE =
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<meta name="robots" content="noindex, nofollow"><title>Not Found</title></head>' +
  '<body><pre>Cannot GET</pre></body></html>';

const UNAVAILABLE_PAGE =
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<meta name="robots" content="noindex, nofollow"><title>Service Unavailable</title></head>' +
  '<body><pre>Service Unavailable</pre></body></html>';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/gu, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim().slice(0, MAX_TEXT_LENGTH) : '';
}

function pickLanguage(queryLang, acceptLanguage) {
  if (typeof queryLang === 'string' && LANGS.has(queryLang.toLowerCase())) {
    return queryLang.toLowerCase();
  }
  if (typeof acceptLanguage === 'string') {
    for (const part of acceptLanguage.toLowerCase().split(',')) {
      const primary = part.trim().split(';')[0].split('-')[0];
      if (primary === 'iw') return 'he'; // legacy Hebrew tag
      if (LANGS.has(primary)) return primary;
    }
  }
  return 'he';
}

function firstName(order) {
  const name = orderName(order);
  if (name === NO_NAME) return '';
  return name.split(/\s+/u)[0] || '';
}

// No weekday on purpose: a service date can fall on Shabbat itself, and the
// locale weekday would print Saturday/samedi — a register this brand never uses.
function formatServiceDate(dateString, locale) {
  const raw = cleanText(dateString);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(raw)) return raw;
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

function freshEtaMinutes(order, now) {
  const minutes = Math.round(Number(order.courierEtaMinutes));
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) return null;
  const recordedAt = Date.parse(order.courierEtaAt);
  if (!Number.isFinite(recordedAt)) return null;
  const age = now - recordedAt;
  if (age < 0 || age > ETA_FRESHNESS_MS) return null;
  return minutes;
}

function safeProofUrl(value) {
  if (typeof value !== 'string' || value === '') return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function renderTimeline(copy, currentStep) {
  const items = copy.steps
    .map((label, index) => {
      const state = index < currentStep ? 'done' : index === currentStep ? 'current' : 'pending';
      return `<li class="step ${state}"><span class="label">${escapeHtml(label)}</span></li>`;
    })
    .join('');
  return `<ol class="timeline">${items}</ol>`;
}

function renderTrackingPage(order, lang, now = Date.now()) {
  const copy = COPY[lang] || COPY.he;
  const status = orderStatus(order);
  const currentStep = STEP_BY_STATUS[status] ?? 0;

  const name = firstName(order);
  const helloHtml = name ? `<p class="hello">${escapeHtml(copy.hello(name))}</p>` : '';

  const dateText = formatServiceDate(order.date, copy.locale);
  const timeText = cleanText(order.time);
  const whenHtml = dateText
    ? `<div class="row"><span class="key">${escapeHtml(copy.dateLabel)}</span>` +
      `<span class="value">${escapeHtml(dateText)}${timeText ? ` · ${escapeHtml(timeText)}` : ''}</span></div>`
    : '';

  const destination = order.pickup === true ? copy.pickup : destinationLabel(order);
  const destinationHtml = destination && destination !== NO_DESTINATION
    ? `<div class="row"><span class="key">${escapeHtml(copy.destinationLabel)}</span>` +
      `<span class="value">${escapeHtml(destination)}</span></div>`
    : '';

  let courierHtml = '';
  if (currentStep === OUT_FOR_DELIVERY_STEP) {
    const etaMinutes = freshEtaMinutes(order, now);
    courierHtml =
      '<div class="courier"><span class="courier-dot"></span><div>' +
      `<p class="courier-line">${escapeHtml(copy.courier)}</p>` +
      (etaMinutes !== null ? `<p class="courier-eta">${escapeHtml(copy.eta(etaMinutes))}</p>` : '') +
      '</div></div>';
  }

  let deliveredHtml = '';
  if (currentStep === DELIVERED_STEP) {
    const proofUrl = safeProofUrl(order.deliveryProofUrl);
    deliveredHtml =
      `<div class="delivered"><p class="delivered-note">${escapeHtml(copy.deliveredNote)}</p>` +
      (proofUrl
        ? `<figure class="proof"><img src="${escapeHtml(proofUrl)}" alt="${escapeHtml(copy.proofCaption)}">` +
          `<figcaption>${escapeHtml(copy.proofCaption)}</figcaption></figure>`
        : '') +
      '</div>';
  }

  return `<!doctype html>
<html lang="${copy.dir === 'rtl' ? 'he' : lang}" dir="${copy.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(copy.brandLatin)} · ${escapeHtml(copy.title)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: #F7ECE6; color: #3B151A;
         font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; line-height: 1.5; }
  .wrap { max-width: 30rem; margin: 0 auto; padding: 1.25rem 1rem 3rem; }
  header { background: #3B151A; color: #F7ECE6; border-radius: 1.25rem; padding: 1.5rem 1.25rem; text-align: center; }
  .brand-latin { margin: 0; font-size: .75rem; letter-spacing: .22em; text-transform: uppercase; opacity: .85; }
  .brand { margin: .3rem 0 0; font-size: 1.7rem; font-weight: 900; }
  .tagline { margin: .4rem 0 0; font-size: .85rem; opacity: .8; }
  .card { background: #FFFDFB; border-radius: 1.25rem; padding: 1.5rem 1.25rem; margin-top: 1rem;
          box-shadow: 0 12px 32px rgba(59, 21, 26, .1); }
  .hello { margin: 0; font-size: 1.15rem; font-weight: 800; }
  .intro { margin: .2rem 0 1rem; font-size: 1rem; font-weight: 700; color: #7A3B2E; }
  .row { display: flex; gap: .75rem; padding: .3rem 0; font-size: .95rem; }
  .key { min-width: 6.5rem; color: rgba(59, 21, 26, .6); font-weight: 700; }
  .value { font-weight: 600; }
  .timeline { list-style: none; margin: 1.4rem 0 0; padding: 0; }
  .step { position: relative; padding-inline-start: 2.1rem; padding-bottom: 1.35rem; font-size: 1rem; }
  .step:last-child { padding-bottom: 0; }
  .step::before { content: ''; position: absolute; inset-inline-start: 0; top: .28rem;
                  width: .95rem; height: .95rem; border-radius: 50%; background: #E3D2C8; }
  .step::after { content: ''; position: absolute; inset-inline-start: .41rem; top: 1.35rem; bottom: .1rem;
                 width: .15rem; border-radius: .1rem; background: #EDE0D8; }
  .step:last-child::after { display: none; }
  .step.done::before { background: #7A3B2E; }
  .step.done::after { background: #C79A8C; }
  .step.done .label { color: rgba(59, 21, 26, .75); }
  .step.current .label { font-weight: 900; }
  .step.current::before { background: #7A3B2E; animation: pulse 2s ease-out infinite; }
  .step.pending .label { color: rgba(59, 21, 26, .4); }
  @keyframes pulse {
    0% { box-shadow: 0 0 0 0 rgba(122, 59, 46, .4); }
    70% { box-shadow: 0 0 0 .7rem rgba(122, 59, 46, 0); }
    100% { box-shadow: 0 0 0 0 rgba(122, 59, 46, 0); }
  }
  .courier { display: flex; gap: .8rem; align-items: flex-start; margin-top: 1.4rem;
             background: #FBF1E7; border: 1px solid #EDD9C9; border-radius: 1rem; padding: .9rem 1rem; }
  .courier-dot { flex: none; width: .7rem; height: .7rem; border-radius: 50%; background: #2E7D4F;
                 margin-top: .45rem; animation: pulse-green 1.6s ease-out infinite; }
  @keyframes pulse-green {
    0% { box-shadow: 0 0 0 0 rgba(46, 125, 79, .45); }
    70% { box-shadow: 0 0 0 .55rem rgba(46, 125, 79, 0); }
    100% { box-shadow: 0 0 0 0 rgba(46, 125, 79, 0); }
  }
  .courier-line { margin: 0; font-weight: 800; }
  .courier-eta { margin: .15rem 0 0; font-size: .92rem; color: rgba(59, 21, 26, .7); }
  .delivered { margin-top: 1.4rem; }
  .delivered-note { margin: 0; font-weight: 800; color: #2E7D4F; }
  .proof { margin: .8rem 0 0; }
  .proof img { display: block; width: 100%; max-width: 100%; border-radius: 1rem; }
  .proof figcaption { margin-top: .4rem; font-size: .82rem; color: rgba(59, 21, 26, .6); }
  footer { text-align: center; margin-top: 1.25rem; font-size: .78rem; color: rgba(59, 21, 26, .55); }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <p class="brand-latin">${escapeHtml(copy.brandLatin)}</p>
    <h1 class="brand">${escapeHtml(copy.brand)}</h1>
    <p class="tagline">${escapeHtml(copy.tagline)}</p>
  </header>
  <main class="card">
    ${helloHtml}
    <p class="intro">${escapeHtml(copy.intro)}</p>
    ${whenHtml}
    ${destinationHtml}
    ${renderTimeline(copy, currentStep)}
    ${courierHtml}
    ${deliveredHtml}
  </main>
  <footer>${escapeHtml(copy.brandLatin)} · ${escapeHtml(copy.tagline)}</footer>
</div>
</body>
</html>`;
}

function createTrackingRouter({ repository, sessionSecret, logger = console }) {
  if (!repository || typeof repository.loadState !== 'function') {
    throw new TypeError('A state repository is required');
  }
  if (typeof sessionSecret !== 'string' || sessionSecret === '') {
    throw new TypeError('sessionSecret required');
  }
  if (!logger || typeof logger.error !== 'function') {
    throw new TypeError('A logger with an error method is required');
  }

  const router = express.Router();

  router.use(
    rateLimit({
      windowMs: 15 * 60 * 1_000,
      limit: 60,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    })
  );
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    response.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
    // Inline CSS only; the delivery proof photo is the single remote asset.
    response.set(
      'Content-Security-Policy',
      "default-src 'none'; img-src https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
    );
    next();
  });

  router.get('/:orderId/:sig', async (request, response) => {
    const { orderId, sig } = request.params;
    const notFound = () => response.status(404).type('html').send(NOT_FOUND_PAGE);

    // Always run the timing-safe verify first; a bad signature never touches
    // state, and a good signature for a missing order looks identical.
    if (!verifyTrackingSignature(orderId, sig, sessionSecret)) return notFound();

    let order;
    try {
      const current = await repository.loadState();
      const orders = Array.isArray(current.data.orders) ? current.data.orders : [];
      order = orders.find(
        (candidate) => candidate && typeof candidate === 'object' && String(candidate.id) === orderId
      );
    } catch (error) {
      logger.error('tracking state read failed', error);
      return response.status(503).type('html').send(UNAVAILABLE_PAGE);
    }

    if (!order || orderStatus(order) === CANCELLED_STATUS) return notFound();

    const lang = pickLanguage(request.query.lang, request.headers['accept-language']);
    return response.status(200).type('html').send(renderTrackingPage(order, lang));
  });

  return router;
}

module.exports = { createTrackingRouter, renderTrackingPage };
