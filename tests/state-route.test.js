'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');

const { createStateRouter, isExactCommand } = require('../server/state/state-route');

const HASH = 'a'.repeat(64);
const BASE = { orders: [{ id: 'order-1', total: '100' }] };
const LOCAL = { orders: [{ id: 'order-1', total: '120' }] };

function command(overrides = {}) {
  return {
    baseState: BASE,
    localState: LOCAL,
    baseRevision: 123,
    baseHash: HASH,
    requestId: 'request-123',
    ...overrides,
  };
}

async function withServer(service, run, logger = { error() {} }) {
  const app = express();
  app.use(express.json());
  app.use('/api/state', createStateRouter({ service, logger }));
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

function assertNoStore(response) {
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  assert.equal(response.headers.get('pragma'), 'no-cache');
}

test('state route accepts only the exact versioned command shape', () => {
  assert.equal(isExactCommand(command()), true);
  assert.equal(isExactCommand({ data: LOCAL }), false);
  assert.equal(isExactCommand({ ...command(), extra: true }), false);
  assert.equal(isExactCommand(null), false);
  assert.equal(isExactCommand([]), false);
});

test('GET returns the exact revision-bound state envelope', async () => {
  const envelope = { revision: 123, ts: 123, hash: HASH, data: BASE };
  const service = {
    loadState: async () => envelope,
    mergeAndSave: async () => assert.fail('save must not run'),
  };

  await withServer(service, async (origin) => {
    const response = await fetch(`${origin}/api/state`);
    assert.equal(response.status, 200);
    assertNoStore(response);
    assert.deepEqual(await response.json(), envelope);
  });
});

test('POST forwards one exact command and returns a merged success', async () => {
  const calls = [];
  const merged = { orders: [...LOCAL.orders, { id: 'remote-order' }] };
  const saved = {
    ok: true,
    revision: 124,
    ts: 124,
    hash: 'b'.repeat(64),
    data: merged,
    idempotent: false,
  };
  const service = {
    loadState: async () => assert.fail('load must not run'),
    mergeAndSave: async (value) => {
      calls.push(structuredClone(value));
      return saved;
    },
  };

  await withServer(service, async (origin) => {
    const response = await fetch(`${origin}/api/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(command()),
    });
    assert.equal(response.status, 200);
    assertNoStore(response);
    assert.deepEqual(await response.json(), saved);
  });
  assert.deepEqual(calls, [command()]);
});

test('POST returns persisted merge conflicts without applying another write', async () => {
  let calls = 0;
  const conflict = {
    ok: false,
    conflict: {
      kind: 'merge-conflict',
      conflicts: [{ path: ['orders', 'order-1', 'total'] }],
      actualRevision: 124,
      actualHash: 'c'.repeat(64),
      remoteState: BASE,
    },
    stage: 'merge',
    idempotent: true,
  };
  const service = {
    loadState: async () => assert.fail('load must not run'),
    mergeAndSave: async () => {
      calls += 1;
      return conflict;
    },
  };

  await withServer(service, async (origin) => {
    const response = await fetch(`${origin}/api/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(command()),
    });
    assert.equal(response.status, 409);
    assertNoStore(response);
    assert.deepEqual(await response.json(), conflict);
  });
  assert.equal(calls, 1);
});

test('legacy and malformed writes fail closed before reaching persistence', async () => {
  let calls = 0;
  const service = {
    loadState: async () => BASE,
    mergeAndSave: async () => {
      calls += 1;
      return { ok: true };
    },
  };

  await withServer(service, async (origin) => {
    for (const body of [{ data: LOCAL }, { ...command(), extra: true }]) {
      const response = await fetch(`${origin}/api/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
      assertNoStore(response);
      assert.deepEqual(await response.json(), {
        error: 'versioned state command required',
      });
    }
  });
  assert.equal(calls, 0);
});

test('client validation and internal failures are sanitized', async (t) => {
  await t.test('known client error', async () => {
    const error = Object.assign(new Error('sensitive submitted state'), {
      code: 'BASE_HASH_MISMATCH',
    });
    const service = {
      loadState: async () => BASE,
      mergeAndSave: async () => { throw error; },
    };
    await withServer(service, async (origin) => {
      const response = await fetch(`${origin}/api/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command()),
      });
      assert.equal(response.status, 400);
      assertNoStore(response);
      assert.deepEqual(await response.json(), { error: 'invalid state command' });
    });
  });

  await t.test('unexpected load and save errors', async () => {
    const errors = [];
    const privateError = new Error('database secret detail');
    const service = {
      loadState: async () => { throw privateError; },
      mergeAndSave: async () => { throw privateError; },
    };
    await withServer(service, async (origin) => {
      const load = await fetch(`${origin}/api/state`);
      assert.equal(load.status, 500);
      assertNoStore(load);
      assert.deepEqual(await load.json(), { error: 'state unavailable' });

      const save = await fetch(`${origin}/api/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command()),
      });
      assert.equal(save.status, 500);
      assertNoStore(save);
      assert.deepEqual(await save.json(), { error: 'state unavailable' });
    }, { error: (...args) => errors.push(args) });
    assert.equal(errors.length, 2);
  });
});
