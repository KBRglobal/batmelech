'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const http = require('node:http');

const {
  trackingPath,
  trackingSignature,
  verifyTrackingSignature,
} = require('../server/track/tracking-token');
const { createTrackingRouter } = require('../server/track/tracking-route');
const { createTrackingAdminRouter } = require('../server/track/tracking-admin-route');

const SECRET = 'test-session-secret';

function fakeRepository(initialState) {
  let state = initialState;
  return {
    async loadState() {
      return { data: structuredClone(state), revision: 1, hash: 'h' };
    },
    _set: (next) => {
      state = next;
    },
  };
}

// The fixture deliberately carries everything the page must NOT leak: a
// price, a phone number, private notes, and a second customer's data.
function trackingState() {
  return {
    orders: [
      {
        id: 'ord-1',
        name: 'Sarah Cohen',
        date: '2099-08-14',
        time: '13:00',
        status: 'במשלוח',
        hotelName: 'Address Marina',
        phone: '+971501234567',
        total: 850,
        notes: 'allergic neighbor, private note',
        payMethod: 'cash',
        courierCheckinState: 'onTheWay',
        courierEtaMinutes: 25,
        courierEtaAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      },
      {
        id: 'ord-2',
        name: 'דוד לוי',
        date: '2099-08-14',
        time: '12:00',
        status: 'נמסרה',
        place: 'Marina Gate Tower',
        phone: '+971509876543',
        total: 1200,
        deliveryProofUrl: 'https://proof.example.com/photos/ord-2.jpg',
        deliveredAt: '2099-08-14T11:45:00Z',
      },
    ],
  };
}

async function serve(build) {
  const app = express();
  build(app);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  return {
    url: (p) => `http://127.0.0.1:${port}${p}`,
    close: () => server.close(),
  };
}

function trackingSite(repository) {
  return serve((app) => {
    app.use('/t', createTrackingRouter({ repository, sessionSecret: SECRET, logger: { error() {} } }));
    app.use('/api/tracking-link', createTrackingAdminRouter({ sessionSecret: SECRET }));
    app.use((_request, response) => response.status(404).send('decoy'));
  });
}

test('a valid link renders the live status and leaks no price, phone, notes, or other orders', async () => {
  const site = await trackingSite(fakeRepository(trackingState()));
  try {
    const response = await fetch(site.url(trackingPath('ord-1', SECRET)));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/u);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('x-robots-tag'), /noindex/u);

    const html = await response.text();
    // First name only, brand header, destination, courier line + fresh ETA (default Hebrew).
    assert.match(html, /Sarah/u);
    assert.doesNotMatch(html, /Sarah Cohen/u, 'only the first name may appear');
    assert.match(html, /מטעמי בת מלך/u);
    assert.match(html, /Address Marina/u);
    assert.match(html, /השליח בדרך אליך/u);
    assert.match(html, /כ-25 דקות/u, 'fresh ETA minutes must be shown');
    assert.match(html, /dir="rtl"/u);

    // Never on this surface: price, phone, notes, payment, other orders.
    assert.doesNotMatch(html, /850/u, 'price must not leak');
    assert.doesNotMatch(html, /971501234567|971509876543/u, 'phone numbers must not leak');
    assert.doesNotMatch(html, /private note|allergic/u, 'notes must not leak');
    assert.doesNotMatch(html, /cash/u, 'payment method must not leak');
    assert.doesNotMatch(html, /דוד|Marina Gate|ord-2/u, "another order's data must not leak");
  } finally {
    site.close();
  }
});

test('an invalid or unknown link gets a generic 404 with no hint', async () => {
  const site = await trackingSite(fakeRepository(trackingState()));
  try {
    // Wrong signature for a real order.
    const wrongSig = await fetch(site.url('/t/ord-1/0123456789abcdef'));
    assert.equal(wrongSig.status, 404);
    const wrongSigHtml = await wrongSig.text();
    assert.doesNotMatch(wrongSigHtml, /Sarah|מלך|Melech|track/iu, '404 must not hint at tracking');

    // Correctly signed link for an order that does not exist.
    const ghost = await fetch(site.url(trackingPath('ghost-order', SECRET)));
    assert.equal(ghost.status, 404);
    assert.doesNotMatch(await ghost.text(), /מלך|Melech|track/iu);
  } finally {
    site.close();
  }
});

test('timing-safe verify rejects near-miss signatures', async () => {
  const goodSig = trackingSignature('ord-1', SECRET);
  assert.equal(goodSig.length, 16);
  assert.equal(verifyTrackingSignature('ord-1', goodSig, SECRET), true);

  // Flip only the last character: 15 of 16 characters match.
  const lastChar = goodSig.slice(-1);
  const nearMiss = goodSig.slice(0, -1) + (lastChar === '0' ? '1' : '0');
  assert.equal(verifyTrackingSignature('ord-1', nearMiss, SECRET), false);
  // Truncated (correct prefix) and padded variants must also fail.
  assert.equal(verifyTrackingSignature('ord-1', goodSig.slice(0, 15), SECRET), false);
  assert.equal(verifyTrackingSignature('ord-1', `${goodSig}0`, SECRET), false);
  // A signature for one order never opens another.
  assert.equal(verifyTrackingSignature('ord-2', goodSig, SECRET), false);

  const site = await trackingSite(fakeRepository(trackingState()));
  try {
    const response = await fetch(site.url(`/t/ord-1/${nearMiss}`));
    assert.equal(response.status, 404);
  } finally {
    site.close();
  }
});

test('a delivered order shows the delivery proof photo', async () => {
  const site = await trackingSite(fakeRepository(trackingState()));
  try {
    const response = await fetch(site.url(trackingPath('ord-2', SECRET)));
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /<img src="https:\/\/proof\.example\.com\/photos\/ord-2\.jpg"/u);
    assert.match(html, /דוד/u);
    assert.doesNotMatch(html, /1200/u, 'price must not leak');
    assert.doesNotMatch(html, /971509876543/u, 'phone must not leak');
  } finally {
    site.close();
  }
});

test('language switch: English and French pages use Shabbat register, never Saturday/samedi', async () => {
  const site = await trackingSite(fakeRepository(trackingState()));
  try {
    const english = await fetch(site.url(`${trackingPath('ord-1', SECRET)}?lang=en`));
    assert.equal(english.status, 200);
    const englishHtml = await english.text();
    assert.match(englishHtml, /Shabbat/u);
    assert.doesNotMatch(englishHtml, /Saturday/iu);
    assert.match(englishHtml, /The courier is on the way/u);
    assert.match(englishHtml, /Out for delivery/u);
    assert.match(englishHtml, /dir="ltr"/u);

    const french = await fetch(site.url(`${trackingPath('ord-1', SECRET)}?lang=fr`));
    assert.equal(french.status, 200);
    const frenchHtml = await french.text();
    assert.match(frenchHtml, /Chabbat/u);
    assert.match(frenchHtml, /casher/u);
    assert.doesNotMatch(frenchHtml, /samedi/iu);
    assert.match(frenchHtml, /Le livreur est en route/u);

    // Accept-Language detection without an explicit ?lang.
    const detected = await fetch(site.url(trackingPath('ord-1', SECRET)), {
      headers: { 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8' },
    });
    assert.match(await detected.text(), /Chabbat/u);

    // Unknown languages fall back to Hebrew.
    const fallback = await fetch(site.url(`${trackingPath('ord-1', SECRET)}?lang=de`), {
      headers: { 'Accept-Language': 'de-DE' },
    });
    assert.match(await fallback.text(), /השליח בדרך אליך/u);
  } finally {
    site.close();
  }
});

test('a stale courier ETA is hidden while the courier line stays', async () => {
  const state = trackingState();
  state.orders[0].courierEtaAt = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  const site = await trackingSite(fakeRepository(state));
  try {
    const html = await (await fetch(site.url(`${trackingPath('ord-1', SECRET)}?lang=en`))).text();
    assert.match(html, /The courier is on the way/u);
    assert.doesNotMatch(html, /about 25 minutes/u, 'a stale ETA must not be shown');
  } finally {
    site.close();
  }
});

test('admin route returns a relative tracking URL whose signature verifies', async () => {
  const site = await trackingSite(fakeRepository(trackingState()));
  try {
    const response = await fetch(site.url('/api/tracking-link/ord-1'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.url, trackingPath('ord-1', SECRET));
    const [, prefix, orderId, sig] = body.url.match(/^\/(t)\/([^/]+)\/([0-9a-f]{16})$/u) || [];
    assert.equal(prefix, 't');
    assert.equal(verifyTrackingSignature(decodeURIComponent(orderId), sig, SECRET), true);

    // The URL it hands out actually opens the public page.
    const page = await fetch(site.url(body.url));
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Sarah/u);

    // Malformed order ids are refused.
    for (const badId of ['bad%20id', '.hidden', '%2F%2Fetc', 'x'.repeat(200)]) {
      const rejected = await fetch(site.url(`/api/tracking-link/${badId}`));
      assert.equal(rejected.status, 400, `order id ${badId} must be refused`);
    }
  } finally {
    site.close();
  }
});

test('a cancelled order link goes dark', async () => {
  const state = trackingState();
  state.orders[0].status = 'בוטלה';
  const site = await trackingSite(fakeRepository(state));
  try {
    const response = await fetch(site.url(trackingPath('ord-1', SECRET)));
    assert.equal(response.status, 404);
  } finally {
    site.close();
  }
});
