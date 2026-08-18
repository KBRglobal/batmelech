'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const { createDecoyGate } = require('../server/auth/decoy-auth');
const { makeToken, SESSION_COOKIE } = require('../server/auth/decoy-auth');
const { createDeliveryPhotosRouter } = require('../server/business-data/delivery-photos-route');

const SESSION_SECRET = 'delivery-photos-test-secret';

function validSessionCookie() {
  const token = makeToken({ exp: Date.now() + 60_000 }, SESSION_SECRET);
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
}

function fakeRepository(orders) {
  return {
    async loadState() {
      return { revision: 1, ts: Date.now(), hash: 'abc', data: { orders } };
    },
  };
}

async function startTestServer({ repository } = {}) {
  const app = express();
  app.use(createDecoyGate(SESSION_SECRET));
  app.use('/api/delivery-photos', createDeliveryPhotosRouter({
    repository,
    logger: { log() {}, error() {} },
  }));
  const server = await new Promise((resolve) => {
    const started = app.listen(0, '127.0.0.1', () => resolve(started));
  });
  return {
    server,
    origin: `http://127.0.0.1:${server.address().port}`,
  };
}

test('returns decoy 404 without a valid staff session', async () => {
  const { server, origin } = await startTestServer({
    repository: fakeRepository([]),
  });
  try {
    const response = await fetch(`${origin}/api/delivery-photos`);
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type') || '', /html/);
  } finally {
    server.close();
  }
});

test('returns the safe photo list newest-first for an authenticated request', async () => {
  const orders = [
    {
      id: 'o-older',
      name: 'רותי',
      date: '2026-08-10',
      time: '13:00',
      hotelName: 'Atlantis',
      status: 'נמסרה',
      deliveryProofUrl: 'https://example.com/older.jpg',
      deliveryProofAt: 1_000,
      phone: '050-0000000',
      notes: 'הערה סודית',
      total: 450,
    },
    {
      id: 'o-newer',
      name: 'דנה',
      date: '2026-08-11',
      time: '14:00',
      hotelName: 'Hilton',
      status: 'נמסרה',
      deliveryProofUrl: 'https://example.com/newer.jpg',
      deliveryProofAt: 2_000,
      phone: '050-1111111',
      notes: 'עוד הערה',
      total: 600,
    },
    {
      id: 'o-none',
      name: 'לא צולם',
      date: '2026-08-12',
      status: 'אושרה',
      phone: '050-2222222',
      notes: 'ללא תמונה',
      total: 300,
    },
  ];
  const { server, origin } = await startTestServer({
    repository: fakeRepository(orders),
  });
  try {
    const response = await fetch(`${origin}/api/delivery-photos`, {
      headers: { Cookie: validSessionCookie() },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const { photos } = await response.json();

    assert.equal(photos.length, 2);
    assert.deepEqual(photos[0], {
      id: 'o-newer',
      name: 'דנה',
      date: '2026-08-11',
      time: '14:00',
      hotelName: 'Hilton',
      deliveryProofUrl: 'https://example.com/newer.jpg',
      deliveryProofAt: 2_000,
      status: 'נמסרה',
    });
    assert.deepEqual(photos[1], {
      id: 'o-older',
      name: 'רותי',
      date: '2026-08-10',
      time: '13:00',
      hotelName: 'Atlantis',
      deliveryProofUrl: 'https://example.com/older.jpg',
      deliveryProofAt: 1_000,
      status: 'נמסרה',
    });

    const text = JSON.stringify(photos);
    assert.doesNotMatch(text, /050-/);
    assert.doesNotMatch(text, /הערה/);
    assert.doesNotMatch(text, /"total"/);
    assert.doesNotMatch(text, /"phone"/);
    assert.doesNotMatch(text, /"notes"/);
  } finally {
    server.close();
  }
});

test('omits malformed entries and falls back safely', async () => {
  const orders = [
    {
      id: 123,
      name: '  לין  ',
      date: '2026-08-12',
      hotelName: 'Rixos',
      status: 'נמסרה',
      deliveryProofUrl: 'https://example.com/proof.jpg',
      deliveryProofAt: Date.now(),
    },
    { deliveryProofUrl: 'https://example.com/no-id.jpg' },
    { name: 'No proof' },
    { deliveryProofUrl: '' },
    { deliveryProofUrl: '   ' },
  ];
  const { server, origin } = await startTestServer({
    repository: fakeRepository(orders),
  });
  try {
    const response = await fetch(`${origin}/api/delivery-photos`, {
      headers: { Cookie: validSessionCookie() },
    });
    assert.equal(response.status, 200);
    const { photos } = await response.json();
    assert.equal(photos.length, 2);
    assert.equal(photos[0].id, '123');
    assert.equal(photos[0].name, 'לין');
    assert.equal(photos[1].id, '');
    assert.equal(photos[1].name, 'ללא שם');
  } finally {
    server.close();
  }
});

test('returns 503 when state repository is unavailable', async () => {
  const { server, origin } = await startTestServer({ repository: null });
  try {
    const response = await fetch(`${origin}/api/delivery-photos`, {
      headers: { Cookie: validSessionCookie() },
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'delivery photos unavailable' });
  } finally {
    server.close();
  }
});

test('returns 500 when state load fails', async () => {
  const repository = {
    async loadState() {
      throw new Error('database is down');
    },
  };
  const { server, origin } = await startTestServer({ repository });
  try {
    const response = await fetch(`${origin}/api/delivery-photos`, {
      headers: { Cookie: validSessionCookie() },
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'delivery photos unavailable' });
  } finally {
    server.close();
  }
});
