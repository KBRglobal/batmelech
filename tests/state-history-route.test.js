'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');

const { createStateHistoryRouter } = require('../server/state-history-route');

function fakePool(handler) {
  return { query: handler };
}

async function withServer({ pool, repository }, run) {
  const app = express();
  app.use('/api/state/history', createStateHistoryRouter({ pool, repository, logger: { error() {} } }));
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

const IDLE_REPOSITORY = {
  async loadState() { throw new Error('not used'); },
  async saveState() { throw new Error('not used'); },
};

test('history list returns recent versions newest-first with source and order count', async () => {
  const pool = fakePool(async (sql, params) => {
    assert.match(sql, /bm_state_versions/);
    assert.deepEqual(params, [1, 80]);
    return {
      rows: [
        { replacement_revision: '12', created_at: new Date('2026-08-18T01:00:00Z'), request_id: 'web-orders:abc', orders_count: '7' },
        { replacement_revision: '11', created_at: new Date('2026-08-17T22:00:00Z'), request_id: 'site-1755:def', orders_count: '6' },
      ],
    };
  });

  await withServer({ pool, repository: IDLE_REPOSITORY }, async (base) => {
    const response = await fetch(`${base}/api/state/history`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.versions, [
      { revision: 12, savedAt: '2026-08-18T01:00:00.000Z', ordersCount: 7, source: 'web-orders' },
      { revision: 11, savedAt: '2026-08-17T22:00:00.000Z', ordersCount: 6, source: 'site-1755' },
    ]);
  });
});

test('restore saves the snapshot as a new version through the guarded save path', async () => {
  const snapshot = { orders: [{ id: 'old-1' }], settings: { maxMeals: 10 } };
  const pool = fakePool(async (sql, params) => {
    assert.match(sql, /replacement_data/);
    assert.deepEqual(params, [1, 9]);
    return { rows: [{ replacement_data: snapshot }] };
  });
  const saves = [];
  const repository = {
    async loadState() {
      return { data: { orders: [{ id: 'current' }] }, revision: 14, hash: 'h14' };
    },
    async saveState(command) {
      saves.push(command);
      return { ok: true, revision: 15, ts: 1, hash: 'h15', data: command.localState };
    },
  };

  await withServer({ pool, repository }, async (base) => {
    const response = await fetch(`${base}/api/state/history/9/restore`, { method: 'POST' });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body, { ok: true, revision: 15 });
    assert.equal(saves.length, 1);
    assert.deepEqual(saves[0].localState, snapshot);
    assert.equal(saves[0].baseRevision, 14);
    assert.equal(saves[0].baseHash, 'h14');
    assert.match(saves[0].requestId, /^web-restore:/);
  });
});

test('restore rejects unknown revisions, bad ids, and non-restorable snapshots', async () => {
  const pool = fakePool(async (_sql, params) =>
    params[1] === 404 ? { rows: [] } : { rows: [{ replacement_data: { notOrders: true } }] });

  await withServer({ pool, repository: IDLE_REPOSITORY }, async (base) => {
    assert.equal((await fetch(`${base}/api/state/history/404/restore`, { method: 'POST' })).status, 404);
    assert.equal((await fetch(`${base}/api/state/history/abc/restore`, { method: 'POST' })).status, 400);
    assert.equal((await fetch(`${base}/api/state/history/0/restore`, { method: 'POST' })).status, 400);
    assert.equal((await fetch(`${base}/api/state/history/7/restore`, { method: 'POST' })).status, 409);
  });
});

test('restoring the currently live revision is a safe no-op', async () => {
  const pool = fakePool(async () => ({ rows: [{ replacement_data: { orders: [] } }] }));
  const repository = {
    async loadState() { return { data: { orders: [] }, revision: 9, hash: 'h9' }; },
    async saveState() { throw new Error('must not save'); },
  };
  await withServer({ pool, repository }, async (base) => {
    const response = await fetch(`${base}/api/state/history/9/restore`, { method: 'POST' });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body, { ok: true, revision: 9, unchanged: true });
  });
});
