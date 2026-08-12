'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  DEFAULT_JSON_LIMITS,
  canonicalJsonStringify,
  inspectJsonValue,
  threeWayMergeState,
} = require('../server/state/three-way-merge');
const {
  EMPTY_STATE_HASH,
  EMPTY_STORE,
  MAX_REVISION,
  MIGRATION_SQL,
  SQL,
  createStateRepository: createRawStateRepository,
  requestFingerprint,
  stateHash,
} = require('../server/state/state-repository');
const {
  createStateSafetyService,
} = require('../server/state/state-service');

const COMMAND_SECRET = 'state-safety-unit-test-command-secret-v1';

function createStateRepository(options) {
  return createRawStateRepository({ ...options, commandSecret: COMMAND_SECRET });
}

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function result(rows = []) {
  return { rows, rowCount: rows.length };
}

function reply(sql, value = result()) {
  return { sql, value };
}

function fail(sql, error) {
  return { sql, error };
}

class ScriptedClient {
  constructor(steps) {
    this.steps = [...steps];
    this.queries = [];
    this.releaseArguments = [];
  }

  async query(sql, params = []) {
    this.queries.push({ sql, params: clone(params) });
    const step = this.steps.shift();
    assert.ok(step, `Unexpected query: ${sql}`);
    assert.equal(sql, step.sql);
    if (step.error) throw step.error;
    const value = typeof step.value === 'function' ? step.value(params) : step.value;
    return clone(value);
  }

  release(error) {
    this.releaseArguments.push(error);
  }
}

class ScriptedPool {
  constructor(steps) {
    this.client = new ScriptedClient(steps);
    this.connectCount = 0;
  }

  async connect() {
    this.connectCount += 1;
    return this.client;
  }

  assertComplete() {
    assert.deepEqual(this.client.steps, []);
    assert.equal(this.client.releaseArguments.length, 1);
  }
}

function pendingClaim(fingerprint, requestId = 'request-1') {
  return result([
    {
      request_id: requestId,
      request_fingerprint: fingerprint,
      state_id: 1,
      status: 'pending',
      result_response: null,
    },
  ]);
}

function commandFingerprint({ baseState, localState, baseRevision, baseHash }) {
  return requestFingerprint({ baseState, localState, baseRevision, baseHash });
}

test('three-way merge preserves independent additions and unknown fields', () => {
  const base = {
    orders: [],
    settings: { maxMeals: 8 },
    legacy: { keep: true },
  };
  const local = {
    ...clone(base),
    orders: [{ id: 'local-1', name: 'Local family' }],
    localUnknown: { keep: 'local' },
  };
  const remote = {
    ...clone(base),
    orders: [{ id: 'remote-1', name: 'Remote family' }],
    remoteUnknown: { keep: 'remote' },
  };

  const merged = threeWayMergeState(base, local, remote);

  assert.equal(merged.ok, true);
  assert.deepEqual(merged.merged.orders.map((order) => order.id), ['local-1', 'remote-1']);
  assert.deepEqual(merged.merged.legacy, { keep: true });
  assert.deepEqual(merged.merged.localUnknown, { keep: 'local' });
  assert.deepEqual(merged.merged.remoteUnknown, { keep: 'remote' });
});

test('three-way merge combines independent fields and rejects the same-field conflict', () => {
  const base = { orders: [{ id: 'o-1', total: '100', notes: '' }], settings: {} };
  const local = clone(base);
  local.orders[0].notes = 'No onions';
  const remote = clone(base);
  remote.orders[0].total = '130';

  const independent = threeWayMergeState(base, local, remote);
  assert.equal(independent.ok, true);
  assert.deepEqual(independent.merged.orders[0], {
    id: 'o-1',
    total: '130',
    notes: 'No onions',
  });

  remote.orders[0].notes = 'Extra onions';
  const conflicting = threeWayMergeState(base, local, remote);
  assert.equal(conflicting.ok, false);
  assert.equal(conflicting.conflicts[0].path, '$.orders[id="o-1"].notes');
  assert.equal(conflicting.conflicts[0].kind, 'concurrent-edit');
});

test('partial stores are invalid and can never erase the orders collection', () => {
  const full = { orders: [{ id: 'o-1' }], settings: {} };
  const partial = { settings: {} };

  for (const [base, local, remote, source] of [
    [partial, full, full, 'base'],
    [full, partial, full, 'local'],
    [full, full, partial, 'remote'],
  ]) {
    const outcome = threeWayMergeState(base, local, remote);
    assert.equal(outcome.ok, false);
    assert.equal(
      outcome.conflicts.some(
        (entry) => entry.source === source && entry.path === '$.orders' && entry.kind === 'missing-orders'
      ),
      true
    );
  }
});

test('local reorder survives an independent remote order edit', () => {
  const base = {
    orders: [{ id: 'a', note: '' }, { id: 'b', note: '' }, { id: 'c', note: '' }],
    settings: {},
  };
  const local = clone(base);
  local.orders = [local.orders[1], local.orders[0], local.orders[2]];
  const remote = clone(base);
  remote.orders[0].note = 'remote edit';

  const merged = threeWayMergeState(base, local, remote);

  assert.equal(merged.ok, true);
  assert.deepEqual(merged.merged.orders.map((order) => order.id), ['b', 'a', 'c']);
  assert.equal(merged.merged.orders[1].note, 'remote edit');
});

test('different concurrent reorderings are explicit conflicts', () => {
  const base = { orders: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], settings: {} };
  const local = { orders: [{ id: 'b' }, { id: 'a' }, { id: 'c' }], settings: {} };
  const remote = { orders: [{ id: 'a' }, { id: 'c' }, { id: 'b' }], settings: {} };

  const merged = threeWayMergeState(base, local, remote);

  assert.equal(merged.ok, false);
  assert.equal(
    merged.conflicts.some(
      (entry) => entry.path === '$.orders' && entry.kind === 'concurrent-order-reorder'
    ),
    true
  );
});

test('large stable-ID reorders merge without quadratic anchor scans', () => {
  const orders = Array.from({ length: 5_000 }, (_, index) => ({
    id: `bulk-${index}`,
    value: index,
  }));
  const base = { orders };
  const local = { orders: [...orders].reverse() };
  const remote = clone(base);
  remote.orders[2_500].remoteNote = 'kept';

  const outcome = threeWayMergeState(base, local, remote);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.merged.orders[0].id, 'bulk-4999');
  assert.equal(
    outcome.merged.orders.find((order) => order.id === 'bulk-2500').remoteNote,
    'kept'
  );
});

test('delete versus edit remains a conflict while unchanged deletion is accepted', () => {
  const base = { orders: [{ id: 'o-1', notes: '' }], settings: {} };
  const deleted = { orders: [], settings: {} };
  const edited = { orders: [{ id: 'o-1', notes: 'Changed' }], settings: {} };

  const conflict = threeWayMergeState(base, deleted, edited);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.conflicts[0].kind, 'delete-edit');

  const accepted = threeWayMergeState(base, deleted, base);
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.merged.orders, []);
});

test('order IDs are canonical safe strings and numeric/string collisions are detected', () => {
  const invalid = {
    orders: [
      { id: 1 },
      { id: '1' },
      { id: 'bad" onclick="alert(1)' },
      { id: ' spaced ' },
      { id: 'valid-id:1' },
    ],
    settings: {},
  };

  const outcome = threeWayMergeState(invalid, invalid, invalid);

  assert.equal(outcome.ok, false);
  assert.equal(outcome.conflicts.some((entry) => entry.kind === 'order-id-collision'), true);
  assert.equal(outcome.conflicts.filter((entry) => entry.kind === 'invalid-order-id').length, 9);
});

test('prototype-pollution keys, accessors, cycles, and non-plain objects are rejected', () => {
  const polluted = JSON.parse(
    '{"orders":[],"nested":{"constructor":{"prototype":{"polluted":true}}}}'
  );
  const accessor = { orders: [] };
  Object.defineProperty(accessor, 'unsafe', { enumerable: true, get: () => 'value' });
  const cyclic = { orders: [] };
  cyclic.self = cyclic;
  const dated = { orders: [], value: new Date() };

  for (const state of [polluted, accessor, cyclic, dated]) {
    const outcome = threeWayMergeState(state, state, state);
    assert.equal(outcome.ok, false);
  }
  assert.equal({}.polluted, undefined);
});

test('JSON validation rejects non-dense array properties without silently dropping them', () => {
  const values = [];
  Object.defineProperty(values, '4294967295', {
    enumerable: true,
    configurable: true,
    value: { wouldBeDropped: true },
  });
  const state = { orders: [], values };

  const issues = inspectJsonValue(state, 'state');

  assert.equal(issues.some((entry) => entry.kind === 'non-json-array-property'), true);
  assert.equal(threeWayMergeState(state, state, state).ok, false);
});

test('JSON validation rejects hostile sparse array lengths before scanning holes', () => {
  const hostile = [];
  hostile.length = 4_294_967_295;

  const issues = inspectJsonValue(hostile, 'hostile', '$', {
    maxDepth: 64,
    maxNodes: 100,
    maxBytes: 1024,
  });
  assert.equal(
    issues.some((entry) => entry.kind === 'array-length-limit-exceeded'),
    true
  );
});

test('JSON validation enforces iterative depth, node, and byte limits', () => {
  let nested = { leaf: true };
  for (let index = 0; index <= DEFAULT_JSON_LIMITS.maxDepth; index += 1) {
    nested = { next: nested };
  }
  const deepState = { orders: [], nested };
  assert.equal(
    inspectJsonValue(deepState, 'state').some((entry) => entry.kind === 'depth-limit-exceeded'),
    true
  );

  assert.equal(
    inspectJsonValue({ orders: [], values: [1, 2, 3] }, 'state', '$', {
      maxDepth: 10,
      maxNodes: 4,
      maxBytes: 1000,
    }).some((entry) => entry.kind === 'node-limit-exceeded'),
    true
  );

  assert.equal(
    inspectJsonValue({ orders: [], text: 'too large' }, 'state', '$', {
      maxDepth: 10,
      maxNodes: 100,
      maxBytes: 10,
    }).some((entry) => entry.kind === 'byte-limit-exceeded'),
    true
  );
});

test('merge never mutates or aliases frozen input objects', () => {
  const base = deepFreeze({ orders: [{ id: 'o-1', nested: { a: 1 } }], settings: {} });
  const local = deepFreeze({
    orders: [{ id: 'o-1', nested: { a: 1, local: true } }],
    settings: {},
  });
  const remote = deepFreeze({
    orders: [{ id: 'o-1', nested: { a: 1, remote: true } }],
    settings: {},
  });

  const merged = threeWayMergeState(base, local, remote);

  assert.equal(merged.ok, true);
  assert.notEqual(merged.merged, base);
  assert.notEqual(merged.merged.orders[0], local.orders[0]);
  assert.deepEqual(merged.merged.orders[0].nested, {
    a: 1,
    local: true,
    remote: true,
  });
});

test('canonical hashing ignores object key order and fingerprints the exact versioned command', () => {
  const baseA = { orders: [], settings: { a: 1, b: 2 } };
  const baseB = { settings: { b: 2, a: 1 }, orders: [] };
  const localA = { orders: [{ id: 'o-1' }], settings: { a: 1, b: 2 } };
  const localB = { settings: { b: 2, a: 1 }, orders: [{ id: 'o-1' }] };
  const baseHash = stateHash(baseA);

  assert.equal(canonicalJsonStringify(baseA), canonicalJsonStringify(baseB));
  assert.equal(stateHash(baseA), stateHash(baseB));
  assert.equal(
    commandFingerprint({ baseState: baseA, localState: localA, baseRevision: 10, baseHash }),
    commandFingerprint({ baseState: baseB, localState: localB, baseRevision: 10, baseHash })
  );
  assert.notEqual(
    commandFingerprint({ baseState: baseA, localState: localA, baseRevision: 10, baseHash }),
    commandFingerprint({ baseState: baseA, localState: localA, baseRevision: 11, baseHash })
  );
  assert.notEqual(
    commandFingerprint({ baseState: baseA, localState: localA, baseRevision: 10, baseHash }),
    commandFingerprint({
      baseState: baseA,
      localState: { orders: [{ id: 'o-2' }], settings: { a: 1, b: 2 } },
      baseRevision: 10,
      baseHash,
    })
  );
});

test('repository rejects malformed command content before opening a connection', async () => {
  const pool = new ScriptedPool([]);
  assert.throws(
    () => createRawStateRepository({ pool }),
    (error) => error.code === 'INVALID_COMMAND_SECRET'
  );
  assert.throws(
    () => createRawStateRepository({ pool, commandSecret: 'too-short' }),
    (error) => error.code === 'INVALID_COMMAND_SECRET'
  );
  const repository = createStateRepository({ pool });
  const full = { orders: [], settings: {} };

  await assert.rejects(
    repository.saveState({
      baseState: full,
      localState: { settings: {} },
      baseRevision: 0,
      baseHash: stateHash(full),
      requestId: 'partial-store',
    }),
    (error) => error.code === 'INVALID_STATE'
  );
  await assert.rejects(
    repository.saveState({
      baseState: full,
      localState: full,
      baseRevision: 0,
      baseHash: '0'.repeat(64),
      requestId: 'wrong-hash',
    }),
    (error) => error.code === 'BASE_HASH_MISMATCH'
  );
  assert.equal(pool.connectCount, 0);
});

test('repository saves against the locked actual row and persists the exact response', async () => {
  const base = { orders: [{ id: 'o-1', total: '100' }], settings: {} };
  const local = { orders: [{ id: 'o-1', total: '130' }], settings: {} };
  const baseHash = stateHash(base);
  const fingerprint = commandFingerprint({
    baseState: base,
    localState: local,
    baseRevision: 500,
    baseHash,
  });
  const pool = new ScriptedPool([
    reply('BEGIN ISOLATION LEVEL READ COMMITTED'),
    reply(SQL.ACQUIRE_STATE_LOCK),
    reply(SQL.CLAIM_REQUEST, pendingClaim(fingerprint)),
    reply(
      SQL.READ_STATE_FOR_UPDATE,
      result([{ data: base, revision: '500', state_hash: baseHash, updated_at: '500' }])
    ),
    reply(SQL.APPLY_STATE_CHANGE, (params) => {
      assert.equal(params[4], 500);
      assert.equal(params[5], baseHash);
      assert.equal(params[6], 501);
      assert.deepEqual(JSON.parse(params[8]), local);
      assert.equal(params[9], canonicalJsonStringify(local));
      const response = JSON.parse(params[10]);
      return result([{ result_response: response }]);
    }),
    reply('COMMIT'),
  ]);
  const repository = createStateRepository({ pool, clock: () => 100.9 });

  const saved = await repository.saveState({
    baseState: base,
    localState: local,
    baseRevision: 500,
    baseHash,
    requestId: 'request-1',
  });

  assert.equal(saved.ok, true);
  assert.equal(saved.revision, 501);
  assert.equal(saved.ts, 501);
  assert.equal(saved.hash, stateHash(local));
  assert.deepEqual(saved.data, local);
  assert.equal(saved.idempotent, false);
  pool.assertComplete();
});

test('repository loads a hash-bound current snapshot under the state lock', async () => {
  const state = { orders: [{ id: 'loaded-1' }], settings: { legacy: true } };
  const hash = stateHash(state);
  const pool = new ScriptedPool([
    reply('BEGIN ISOLATION LEVEL READ COMMITTED'),
    reply(SQL.ACQUIRE_STATE_LOCK),
    reply(
      SQL.READ_STATE_FOR_UPDATE,
      result([{ data: state, revision: '77', state_hash: hash, updated_at: '77' }])
    ),
    reply('COMMIT'),
  ]);

  const loaded = await createStateRepository({ pool }).loadState();
  assert.deepEqual(loaded, {
    revision: 77,
    ts: 77,
    hash,
    data: state,
  });
  assert.notEqual(loaded.data, state);
  pool.assertComplete();
});

test('repository performs stale merge only after binding history and reading locked remote', async () => {
  const base = { orders: [{ id: 'o-1', total: '100', note: '' }], settings: {} };
  const local = { orders: [{ id: 'o-1', total: '100', note: 'local' }], settings: {} };
  const remote = { orders: [{ id: 'o-1', total: '130', note: '' }], settings: {} };
  const expectedMerged = {
    orders: [{ id: 'o-1', total: '130', note: 'local' }],
    settings: {},
  };
  const baseHash = stateHash(base);
  const remoteHash = stateHash(remote);
  const fingerprint = commandFingerprint({
    baseState: base,
    localState: local,
    baseRevision: 10,
    baseHash,
  });
  const pool = new ScriptedPool([
    reply('BEGIN ISOLATION LEVEL READ COMMITTED'),
    reply(SQL.ACQUIRE_STATE_LOCK),
    reply(SQL.CLAIM_REQUEST, pendingClaim(fingerprint)),
    reply(
      SQL.READ_STATE_FOR_UPDATE,
      result([{ data: remote, revision: '20', state_hash: remoteHash, updated_at: '20' }])
    ),
    reply(SQL.READ_HISTORICAL_STATE, result([{ replacement_data: base }])),
    reply(SQL.APPLY_STATE_CHANGE, (params) => {
      assert.equal(params[4], 20);
      assert.equal(params[5], remoteHash);
      assert.deepEqual(JSON.parse(params[8]), expectedMerged);
      return result([{ result_response: JSON.parse(params[10]) }]);
    }),
    reply('COMMIT'),
  ]);
  const repository = createStateRepository({ pool, clock: () => 21 });

  const saved = await repository.saveState({
    baseState: base,
    localState: local,
    baseRevision: 10,
    baseHash,
    requestId: 'request-1',
  });

  assert.equal(saved.ok, true);
  assert.deepEqual(saved.data, expectedMerged);
  pool.assertComplete();
});

test('unbound base version is a persisted deterministic conflict', async () => {
  const base = clone(EMPTY_STORE);
  const local = { orders: [{ id: 'o-1' }] };
  const remote = { orders: [{ id: 'remote' }], settings: {} };
  const baseHash = stateHash(base);
  const remoteHash = stateHash(remote);
  const fingerprint = commandFingerprint({
    baseState: base,
    localState: local,
    baseRevision: 9,
    baseHash,
  });
  const pool = new ScriptedPool([
    reply('BEGIN ISOLATION LEVEL READ COMMITTED'),
    reply(SQL.ACQUIRE_STATE_LOCK),
    reply(SQL.CLAIM_REQUEST, pendingClaim(fingerprint)),
    reply(
      SQL.READ_STATE_FOR_UPDATE,
      result([{ data: remote, revision: '10', state_hash: remoteHash, updated_at: '10' }])
    ),
    reply(SQL.READ_HISTORICAL_STATE, result()),
    reply(SQL.COMPLETE_CONFLICT, (params) =>
      result([{ result_response: JSON.parse(params[4]) }])
    ),
    reply('COMMIT'),
  ]);
  const repository = createStateRepository({ pool });

  const saved = await repository.saveState({
    baseState: base,
    localState: local,
    baseRevision: 9,
    baseHash,
    requestId: 'request-1',
  });

  assert.equal(saved.ok, false);
  assert.equal(saved.conflict.kind, 'base-version-mismatch');
  assert.deepEqual(saved.conflict.remoteState, remote);
  pool.assertComplete();
});

test('merge conflicts are completed and replayed without a second state read', async () => {
  const base = { orders: [{ id: 'o-1', total: '100' }], settings: {} };
  const local = { orders: [{ id: 'o-1', total: '110' }], settings: {} };
  const remote = { orders: [{ id: 'o-1', total: '120' }], settings: {} };
  const baseHash = stateHash(base);
  const remoteHash = stateHash(remote);
  const fingerprint = commandFingerprint({
    baseState: base,
    localState: local,
    baseRevision: 10,
    baseHash,
  });
  let persisted;
  const firstPool = new ScriptedPool([
    reply('BEGIN ISOLATION LEVEL READ COMMITTED'),
    reply(SQL.ACQUIRE_STATE_LOCK),
    reply(SQL.CLAIM_REQUEST, pendingClaim(fingerprint)),
    reply(
      SQL.READ_STATE_FOR_UPDATE,
      result([{ data: remote, revision: '20', state_hash: remoteHash, updated_at: '20' }])
    ),
    reply(SQL.READ_HISTORICAL_STATE, result([{ replacement_data: base }])),
    reply(SQL.COMPLETE_CONFLICT, (params) => {
      persisted = JSON.parse(params[4]);
      return result([{ result_response: persisted }]);
    }),
    reply('COMMIT'),
  ]);
  const firstRepository = createStateRepository({ pool: firstPool });

  const first = await firstRepository.saveState({
    baseState: base,
    localState: local,
    baseRevision: 10,
    baseHash,
    requestId: 'request-1',
  });
  assert.equal(first.ok, false);
  assert.equal(first.conflict.kind, 'merge-conflict');
  firstPool.assertComplete();

  const replayPool = new ScriptedPool([
    reply('BEGIN ISOLATION LEVEL READ COMMITTED'),
    reply(SQL.ACQUIRE_STATE_LOCK),
    reply(
      SQL.CLAIM_REQUEST,
      result([
        {
          request_id: 'request-1',
          request_fingerprint: fingerprint,
          state_id: 1,
          status: 'conflict',
          result_response: persisted,
        },
      ])
    ),
    reply('COMMIT'),
  ]);
  const replayRepository = createStateRepository({ pool: replayPool });
  const replay = await replayRepository.saveState({
    baseState: base,
    localState: local,
    baseRevision: 10,
    baseHash,
    requestId: 'request-1',
  });

  assert.equal(replay.ok, false);
  assert.equal(replay.conflict.kind, 'merge-conflict');
  assert.equal(replay.idempotent, true);
  replayPool.assertComplete();
});

test('request ID reuse with another exact command is rejected', async () => {
  const base = clone(EMPTY_STORE);
  const local = { orders: [{ id: 'o-1' }] };
  const baseHash = stateHash(base);
  const fingerprint = commandFingerprint({
    baseState: base,
    localState: local,
    baseRevision: 0,
    baseHash,
  });
  const pool = new ScriptedPool([
    reply('BEGIN ISOLATION LEVEL READ COMMITTED'),
    reply(SQL.ACQUIRE_STATE_LOCK),
    reply(
      SQL.CLAIM_REQUEST,
      result([
        {
          request_id: 'request-1',
          request_fingerprint: 'f'.repeat(64),
          state_id: 1,
          status: 'succeeded',
          result_response: { ok: true },
        },
      ])
    ),
    reply('COMMIT'),
  ]);
  assert.notEqual(fingerprint, 'f'.repeat(64));
  const repository = createStateRepository({ pool });

  const saved = await repository.saveState({
    baseState: base,
    localState: local,
    baseRevision: 0,
    baseHash,
    requestId: 'request-1',
  });

  assert.deepEqual(saved, {
    ok: false,
    conflict: { kind: 'idempotency-mismatch', requestId: 'request-1' },
    idempotent: false,
  });
  pool.assertComplete();
});

test('initial insert uses the canonical empty base and refuses orphaned history', async () => {
  const local = { orders: [{ id: 'first' }], settings: {} };
  const fingerprint = commandFingerprint({
    baseState: EMPTY_STORE,
    localState: local,
    baseRevision: 0,
    baseHash: EMPTY_STATE_HASH,
  });
  const successPool = new ScriptedPool([
    reply('BEGIN ISOLATION LEVEL READ COMMITTED'),
    reply(SQL.ACQUIRE_STATE_LOCK),
    reply(SQL.CLAIM_REQUEST, pendingClaim(fingerprint)),
    reply(SQL.READ_STATE_FOR_UPDATE, result()),
    reply(SQL.COUNT_VERSIONS, result([{ count: '0' }])),
    reply(SQL.APPLY_STATE_CHANGE, (params) => {
      assert.equal(params[4], 0);
      assert.equal(params[5], EMPTY_STATE_HASH);
      return result([{ result_response: JSON.parse(params[10]) }]);
    }),
    reply('COMMIT'),
  ]);
  const successRepository = createStateRepository({ pool: successPool, clock: () => 100 });
  const saved = await successRepository.saveState({
    baseState: EMPTY_STORE,
    localState: local,
    baseRevision: 0,
    baseHash: EMPTY_STATE_HASH,
    requestId: 'request-1',
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.revision, 100);
  successPool.assertComplete();

  const orphanPool = new ScriptedPool([
    reply('BEGIN ISOLATION LEVEL READ COMMITTED'),
    reply(SQL.ACQUIRE_STATE_LOCK),
    reply(SQL.CLAIM_REQUEST, pendingClaim(fingerprint)),
    reply(SQL.READ_STATE_FOR_UPDATE, result()),
    reply(SQL.COUNT_VERSIONS, result([{ count: '1' }])),
    reply('ROLLBACK'),
  ]);
  const orphanRepository = createStateRepository({ pool: orphanPool });
  await assert.rejects(
    orphanRepository.saveState({
      baseState: EMPTY_STORE,
      localState: local,
      baseRevision: 0,
      baseHash: EMPTY_STATE_HASH,
      requestId: 'request-1',
    }),
    (error) => error.code === 'STATE_INTEGRITY_ERROR'
  );
  orphanPool.assertComplete();
});

test('stored hash corruption and revision overflow fail without applying state', async () => {
  const state = { orders: [], settings: {} };
  const hash = stateHash(state);
  const fingerprint = commandFingerprint({
    baseState: state,
    localState: state,
    baseRevision: 10,
    baseHash: hash,
  });
  const corruptPool = new ScriptedPool([
    reply('BEGIN ISOLATION LEVEL READ COMMITTED'),
    reply(SQL.ACQUIRE_STATE_LOCK),
    reply(SQL.CLAIM_REQUEST, pendingClaim(fingerprint)),
    reply(
      SQL.READ_STATE_FOR_UPDATE,
      result([{ data: state, revision: '10', state_hash: 'f'.repeat(64), updated_at: '10' }])
    ),
    reply('ROLLBACK'),
  ]);
  await assert.rejects(
    createStateRepository({ pool: corruptPool }).saveState({
      baseState: state,
      localState: state,
      baseRevision: 10,
      baseHash: hash,
      requestId: 'request-1',
    }),
    (error) => error.code === 'STATE_INTEGRITY_ERROR'
  );
  corruptPool.assertComplete();

  const maxFingerprint = commandFingerprint({
    baseState: state,
    localState: state,
    baseRevision: MAX_REVISION,
    baseHash: hash,
  });
  const overflowPool = new ScriptedPool([
    reply('BEGIN ISOLATION LEVEL READ COMMITTED'),
    reply(SQL.ACQUIRE_STATE_LOCK),
    reply(SQL.CLAIM_REQUEST, pendingClaim(maxFingerprint)),
    reply(
      SQL.READ_STATE_FOR_UPDATE,
      result([
        {
          data: state,
          revision: String(MAX_REVISION),
          state_hash: hash,
          updated_at: String(MAX_REVISION),
        },
      ])
    ),
    reply('ROLLBACK'),
  ]);
  await assert.rejects(
    createStateRepository({ pool: overflowPool, clock: () => 1 }).saveState({
      baseState: state,
      localState: state,
      baseRevision: MAX_REVISION,
      baseHash: hash,
      requestId: 'request-1',
    }),
    (error) => error.code === 'INVALID_REVISION'
  );
  overflowPool.assertComplete();
});

test('CAS function failures roll back and rollback failures destroy the pooled connection', async () => {
  const base = { orders: [], settings: {} };
  const local = { orders: [{ id: 'o-1' }], settings: {} };
  const baseHash = stateHash(base);
  const fingerprint = commandFingerprint({
    baseState: base,
    localState: local,
    baseRevision: 1,
    baseHash,
  });
  const casError = Object.assign(new Error('state CAS failed after locked read'), { code: '55000' });
  const rollbackError = new Error('rollback connection failure');
  const pool = new ScriptedPool([
    reply('BEGIN ISOLATION LEVEL READ COMMITTED'),
    reply(SQL.ACQUIRE_STATE_LOCK),
    reply(SQL.CLAIM_REQUEST, pendingClaim(fingerprint)),
    reply(
      SQL.READ_STATE_FOR_UPDATE,
      result([{ data: base, revision: '1', state_hash: baseHash, updated_at: '1' }])
    ),
    fail(SQL.APPLY_STATE_CHANGE, casError),
    fail('ROLLBACK', rollbackError),
  ]);
  const repository = createStateRepository({ pool, clock: () => 2 });

  await assert.rejects(
    repository.saveState({
      baseState: base,
      localState: local,
      baseRevision: 1,
      baseHash,
      requestId: 'request-1',
    }),
    (error) => error === casError && error.rollbackError === rollbackError
  );
  assert.equal(pool.client.releaseArguments[0], rollbackError);
  assert.deepEqual(pool.client.steps, []);
});

test('state service forwards the exact versioned command and labels repository conflicts', async () => {
  const base = { orders: [], settings: {} };
  const local = { orders: [{ id: 'o-1' }], settings: {} };
  const baseHash = stateHash(base);
  let captured;
  const service = createStateSafetyService({
    repository: {
      async loadState() {
        return { revision: 0, ts: 0, hash: EMPTY_STATE_HASH, data: EMPTY_STORE };
      },
      async saveState(input) {
        captured = clone(input);
        return { ok: false, conflict: { kind: 'merge-conflict', conflicts: [] } };
      },
    },
  });

  assert.deepEqual(await service.loadState(), {
    revision: 0,
    ts: 0,
    hash: EMPTY_STATE_HASH,
    data: EMPTY_STORE,
  });

  const resultValue = await service.mergeAndSave({
    baseState: base,
    localState: local,
    baseRevision: 0,
    baseHash,
    requestId: 'request-1',
  });

  assert.deepEqual(captured, {
    baseState: base,
    localState: local,
    baseRevision: 0,
    baseHash,
    requestId: 'request-1',
  });
  assert.equal(resultValue.stage, 'merge');
});

test('migration is schema-qualified, non-destructive, and contains DB enforcement paths', () => {
  for (const statement of MIGRATION_SQL) {
    assert.doesNotMatch(statement.trim(), /^(DROP|TRUNCATE|DELETE)\b/i);
  }
  const source = MIGRATION_SQL.join('\n');
  assert.match(source, /public\.bm_state_versions/);
  assert.match(source, /BEFORE UPDATE OR DELETE ON public\.bm_state_versions/);
  assert.match(source, /BEFORE TRUNCATE ON public\.bm_state_versions/);
  assert.match(source, /bm_state update requires a matching history row/);
  assert.match(source, /SECURITY DEFINER/);
  assert.match(source, /SET search_path = pg_catalog, public/);
});

test('schema validation excludes PostgreSQL 18 catalog-only NOT NULL constraints', () => {
  assert.match(SQL.READ_SCHEMA_CONSTRAINTS, /con\.contype <> 'n'/);
  assert.doesNotMatch(
    SQL.READ_SCHEMA_CONSTRAINTS,
    /con\.contype NOT IN \('n',\s*'p',\s*'u',\s*'f',\s*'c'\)/,
  );
});

test('state safety modules construct no production pool or network client', () => {
  for (const relative of [
    '../server/state/three-way-merge.js',
    '../server/state/state-repository.js',
    '../server/state/state-service.js',
  ]) {
    const source = fs.readFileSync(path.join(__dirname, relative), 'utf8');
    assert.doesNotMatch(source, /require\(['"]pg['"]\)|new\s+Pool\b|DATABASE_URL/);
    assert.doesNotMatch(source, /\bfetch\s*\(|https?:\/\//);
  }
});
