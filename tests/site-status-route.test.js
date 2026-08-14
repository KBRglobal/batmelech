'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');

const { createSiteStatusRouter } = require('../server/site-status-route');

function fakeRepository(data) {
  return { async loadState() { return { data, revision: 1, hash: 'h' }; } };
}

async function withServer(repository, run) {
  const app = express();
  app.use('/api/site/status', createSiteStatusRouter({ repository, logger: { error() {} } }));
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
    assert.equal(body.siteBanner, null);
    assert.deepEqual(body.outOfStockNames, []);
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

test('site status responds 503 when the repository read fails', async () => {
  const repo = { async loadState() { throw new Error('db down'); } };
  await withServer(repo, async (base) => {
    const response = await fetch(`${base}/api/site/status`);
    assert.equal(response.status, 503);
  });
});
