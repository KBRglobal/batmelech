'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');

const { createSiteStatusRouter } = require('../server/site-status-route');

function fakeRepository(data) {
  return { async loadState() { return { data, revision: 1, hash: 'h' }; } };
}

// Wednesday, 19 Aug 2026, noon in Dubai: an ordinary working day, so the
// Shabbat gate stays out of the way of the tests that are about other things.
const WEEKDAY = new Date(Date.UTC(2026, 7, 19, 8, 0));

async function withServer(repository, run, clock = () => WEEKDAY) {
  const app = express();
  app.use('/api/site/status', createSiteStatusRouter({ repository, logger: { error() {} }, clock }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('site status defaults ordering open and no banner when settings is missing', async () => {
  await withServer(fakeRepository({ orders: [] }), async (base) => {
    const response = await fetch(`${base}/api/site/status`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.orderingOpen, true);
    assert.equal(body.reopensOn, null);
    assert.equal(body.siteBanner, null);
    assert.deepEqual(body.outOfStockNames, []);
  });
});

test('site status keeps a dated close shut and names the day ordering returns', async () => {
  const repo = fakeRepository({
    orders: [],
    settings: { orderingOpen: false, orderingClosedUntil: '2099-01-04' },
  });
  await withServer(repo, async (base) => {
    const body = await (await fetch(`${base}/api/site/status`)).json();
    assert.equal(body.orderingOpen, false);
    assert.equal(body.reopensOn, '2099-01-04');
  });
});

// The whole point of the date: nobody has to remember to flip the flag back.
test('site status reopens on its own once the reopen day has passed', async () => {
  const repo = fakeRepository({
    orders: [],
    settings: { orderingOpen: false, orderingClosedUntil: '2020-01-05' },
  });
  await withServer(repo, async (base) => {
    const body = await (await fetch(`${base}/api/site/status`)).json();
    assert.equal(body.orderingOpen, true);
    assert.equal(body.reopensOn, null);
  });
});

test('site status reflects a closed store, a banner, and out-of-stock names', async () => {
  const repo = fakeRepository({
    orders: [],
    settings: { orderingOpen: false, siteBanner: '  חוזרים ביום ראשון  ', out: ['מטבוחה', 42, null] },
  });
  await withServer(repo, async (base) => {
    const response = await fetch(`${base}/api/site/status`);
    const body = await response.json();
    assert.equal(body.orderingOpen, false);
    assert.equal(body.reopensOn, null); // legacy boolean-only close
    assert.equal(body.siteBanner, '  חוזרים ביום ראשון  ');
    assert.deepEqual(body.outOfStockNames, ['מטבוחה']);
  });
});

test('site status never caches', async () => {
  await withServer(fakeRepository({ orders: [] }), async (base) => {
    const response = await fetch(`${base}/api/site/status`);
    assert.match(response.headers.get('cache-control') || '', /no-store/);
  });
});

test('site status reports the Shabbat gate closed, with the greeting and havdalah', async () => {
  const fridayNight = () => new Date(Date.UTC(2026, 7, 14, 15, 30)); // Fri 14 Aug 2026, 19:30 Dubai
  await withServer(
    fakeRepository({ orders: [] }),
    async (base) => {
      const body = await (await fetch(`${base}/api/site/status`)).json();
      assert.equal(body.shabbatClosed, true);
      assert.equal(body.shabbatLabel, 'שבת שלום');
      assert.equal(body.shabbatOccasion, 'shabbat');
      assert.equal(typeof body.shabbatReopensAt, 'number');
      assert.ok(body.shabbatReopensAt > Date.UTC(2026, 7, 15));
    },
    fridayNight,
  );
});

test('site status reports the Shabbat gate open on a working day', async () => {
  await withServer(fakeRepository({ orders: [] }), async (base) => {
    const body = await (await fetch(`${base}/api/site/status`)).json();
    assert.equal(body.shabbatClosed, false);
    assert.equal(body.shabbatLabel, null);
    assert.equal(body.shabbatReopensAt, null);
    assert.equal(body.shabbatOccasion, null);
  });
});

// Manual closing and the calendar are separate gates; neither may mask the other.
test('the Shabbat gate and the manual close are reported independently', async () => {
  const repo = fakeRepository({ orders: [], settings: { orderingOpen: false, orderingClosedUntil: '2099-01-04' } });
  const chag = () => new Date(Date.UTC(2027, 3, 22, 8, 0)); // Pesach I, noon Dubai
  await withServer(
    repo,
    async (base) => {
      const body = await (await fetch(`${base}/api/site/status`)).json();
      assert.equal(body.orderingOpen, false);
      assert.equal(body.reopensOn, '2099-01-04');
      assert.equal(body.shabbatClosed, true);
      assert.equal(body.shabbatLabel, 'חג שמח — פסח');
      assert.equal(body.shabbatOccasion, 'chag');
    },
    chag,
  );
});

test('site status responds 503 when the repository read fails', async () => {
  const repo = { async loadState() { throw new Error('db down'); } };
  await withServer(repo, async (base) => {
    const response = await fetch(`${base}/api/site/status`);
    assert.equal(response.status, 503);
  });
});
