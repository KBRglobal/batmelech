'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'bm-sync.js'), 'utf8');
const STORE_KEY = 'batmelech-orders-v1';
const BASE_KEY = 'bm-sync-v2-base';
const PENDING_KEY = 'bm-sync-v2-pending';
const TS_KEY = 'bm-sync-ts';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

function envelope(revision, hash, data) {
  return { revision, ts: revision, hash, data };
}

class FakeStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
  }

  getItem(key) {
    return this.values.has(String(key)) ? this.values.get(String(key)) : null;
  }

  setItem(key, value) {
    this.values.set(String(key), String(value));
  }

  removeItem(key) {
    this.values.delete(String(key));
  }
}

function response(status, body) {
  return {
    status,
    json: async () => structuredClone(body),
  };
}

function createHarness({ remote, entries = {}, fetchSteps = [] }) {
  const localStorage = new FakeStorage(entries);
  const timers = [];
  const listeners = new Map();
  const fetchCalls = [];
  const events = [];
  const nodes = new Map();
  const body = {
    appendChild(node) {
      node.parentNode = body;
      nodes.set(node.id, node);
    },
    removeChild(node) {
      nodes.delete(node.id);
      node.parentNode = null;
    },
  };
  let nextTimerId = 1;
  let requestCounter = 0;

  class FakeXhr {
    open(method, url, async) {
      assert.equal(method, 'GET');
      assert.equal(url, '/api/state');
      assert.equal(async, false);
    }

    send() {
      this.status = 200;
      this.responseText = JSON.stringify(remote);
    }
  }

  class FakeCustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init.detail;
    }
  }

  const window = {
    localStorage,
    crypto: {
      randomUUID() {
        requestCounter += 1;
        return `00000000-0000-4000-8000-${String(requestCounter).padStart(12, '0')}`;
      },
    },
    CustomEvent: FakeCustomEvent,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    dispatchEvent(event) {
      events.push(event);
      return true;
    },
  };

  const context = vm.createContext({
    window,
    localStorage,
    Storage: FakeStorage,
    XMLHttpRequest: FakeXhr,
    CustomEvent: FakeCustomEvent,
    document: {
      body,
      createElement() {
        return {
          id: '',
          dir: '',
          style: { cssText: '' },
          parentNode: null,
          textContent: '',
          attributes: {},
          setAttribute(name, value) {
            this.attributes[name] = value;
          },
        };
      },
      getElementById(id) {
        return nodes.get(id) || null;
      },
    },
    fetch: async (url, options) => {
      fetchCalls.push({ url, options: structuredClone(options) });
      const step = fetchSteps.shift();
      if (!step) throw new Error('unexpected fetch');
      return typeof step === 'function' ? step(url, options) : step;
    },
    setTimeout(callback, delay) {
      const timer = { id: nextTimerId++, callback, delay, cancelled: false };
      timers.push(timer);
      return timer.id;
    },
    clearTimeout(id) {
      const timer = timers.find((candidate) => candidate.id === id);
      if (timer) timer.cancelled = true;
    },
    console: { error() {}, log() {} },
  });

  vm.runInContext(source, context, { filename: 'bm-sync.js' });

  async function flush() {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
  }

  async function runNextTimer() {
    const timer = timers.find((candidate) => !candidate.cancelled);
    assert.ok(timer, 'expected a pending timer');
    timer.cancelled = true;
    timer.callback();
    await flush();
    return timer;
  }

  return {
    events,
    fetchCalls,
    listeners,
    localStorage,
    nodes,
    runNextTimer,
    timers,
    flush,
  };
}

test('first versioned load installs the server snapshot without writing it back', () => {
  const state = { orders: [{ id: 'order-1' }], unknown: { keep: true } };
  const harness = createHarness({ remote: envelope(100, HASH_A, state) });

  assert.deepEqual(JSON.parse(harness.localStorage.getItem(STORE_KEY)), state);
  assert.deepEqual(JSON.parse(harness.localStorage.getItem(BASE_KEY)), envelope(100, HASH_A, state));
  assert.equal(harness.localStorage.getItem(TS_KEY), '100');
  assert.equal(harness.fetchCalls.length, 0);
  assert.equal(harness.timers.filter((timer) => !timer.cancelled).length, 0);
});

test('a clean browser advances to a newer remote revision without posting stale data', () => {
  const oldState = { orders: [{ id: 'order-1' }] };
  const newState = { orders: [{ id: 'order-1' }, { id: 'remote-order' }] };
  const oldBase = envelope(100, HASH_A, oldState);
  const newRemote = envelope(101, HASH_B, newState);
  const harness = createHarness({
    remote: newRemote,
    entries: {
      [STORE_KEY]: JSON.stringify(oldState),
      [BASE_KEY]: JSON.stringify(oldBase),
      [TS_KEY]: '100',
    },
  });

  assert.deepEqual(JSON.parse(harness.localStorage.getItem(STORE_KEY)), newState);
  assert.deepEqual(JSON.parse(harness.localStorage.getItem(BASE_KEY)), newRemote);
  assert.equal(harness.fetchCalls.length, 0);
  assert.equal(harness.timers.filter((timer) => !timer.cancelled).length, 0);
});

test('legacy page writes use the exact versioned command and accept the merged server state', async () => {
  const baseState = { orders: [{ id: 'order-1', total: '100' }], keep: true };
  const localState = { orders: [{ id: 'order-1', total: '120' }], keep: true };
  const mergedState = {
    orders: [
      { id: 'order-1', total: '120' },
      { id: 'remote-order', total: '50' },
    ],
    keep: true,
  };
  const remote = envelope(100, HASH_A, baseState);
  const saved = { ok: true, idempotent: false, ...envelope(101, HASH_B, mergedState) };
  const harness = createHarness({
    remote,
    entries: {
      [STORE_KEY]: JSON.stringify(baseState),
      [BASE_KEY]: JSON.stringify(remote),
      [TS_KEY]: '100',
    },
    fetchSteps: [response(200, saved)],
  });

  harness.localStorage.setItem(STORE_KEY, JSON.stringify(localState));
  const timer = await harness.runNextTimer();
  assert.equal(timer.delay, 1200);
  assert.equal(harness.fetchCalls.length, 1);
  const call = harness.fetchCalls[0];
  const command = JSON.parse(call.options.body);
  assert.deepEqual(command.baseState, baseState);
  assert.deepEqual(command.localState, localState);
  assert.equal(command.baseRevision, 100);
  assert.equal(command.baseHash, HASH_A);
  assert.match(command.requestId, /^browser-/);
  assert.equal(call.options.credentials, 'same-origin');
  assert.equal(call.options.keepalive, false);
  assert.deepEqual(JSON.parse(harness.localStorage.getItem(STORE_KEY)), mergedState);
  assert.deepEqual(JSON.parse(harness.localStorage.getItem(BASE_KEY)), envelope(101, HASH_B, mergedState));
  assert.equal(harness.localStorage.getItem(PENDING_KEY), null);
});

test('a merge conflict keeps the complete local copy and shows one persistent warning', async () => {
  const baseState = { orders: [{ id: 'order-1', total: '100' }] };
  const localState = { orders: [{ id: 'order-1', total: '120' }] };
  const remote = envelope(100, HASH_A, baseState);
  const conflict = {
    ok: false,
    idempotent: false,
    stage: 'merge',
    conflict: {
      kind: 'merge-conflict',
      conflicts: [{ path: ['orders', 'order-1', 'total'] }],
      actualRevision: 101,
      actualHash: HASH_B,
      remoteState: { orders: [{ id: 'order-1', total: '130' }] },
    },
  };
  const harness = createHarness({
    remote,
    entries: {
      [STORE_KEY]: JSON.stringify(baseState),
      [BASE_KEY]: JSON.stringify(remote),
      [TS_KEY]: '100',
    },
    fetchSteps: [response(409, conflict)],
  });

  harness.localStorage.setItem(STORE_KEY, JSON.stringify(localState));
  await harness.runNextTimer();

  assert.deepEqual(JSON.parse(harness.localStorage.getItem(STORE_KEY)), localState);
  assert.deepEqual(JSON.parse(harness.localStorage.getItem(BASE_KEY)), remote);
  assert.ok(harness.localStorage.getItem(PENDING_KEY));
  assert.ok(harness.nodes.has('bm-sync-conflict'));
  assert.equal(harness.events.at(-1).type, 'bm-sync-conflict');
  assert.equal(harness.fetchCalls.length, 1);
});

test('network retry reuses the same request ID and exact command', async () => {
  const baseState = { orders: [{ id: 'order-1', total: '100' }] };
  const localState = { orders: [{ id: 'order-1', total: '120' }] };
  const remote = envelope(100, HASH_A, baseState);
  const saved = { ok: true, idempotent: true, ...envelope(101, HASH_B, localState) };
  const harness = createHarness({
    remote,
    entries: {
      [STORE_KEY]: JSON.stringify(baseState),
      [BASE_KEY]: JSON.stringify(remote),
      [TS_KEY]: '100',
    },
    fetchSteps: [
      () => Promise.reject(new Error('offline')),
      response(200, saved),
    ],
  });

  harness.localStorage.setItem(STORE_KEY, JSON.stringify(localState));
  await harness.runNextTimer();
  const retryTimer = await harness.runNextTimer();

  assert.equal(retryTimer.delay, 5000);
  assert.equal(harness.fetchCalls.length, 2);
  assert.equal(harness.fetchCalls[0].options.body, harness.fetchCalls[1].options.body);
  assert.deepEqual(JSON.parse(harness.localStorage.getItem(STORE_KEY)), localState);
  assert.equal(harness.localStorage.getItem(PENDING_KEY), null);
});

test('an edit made during a save is never replaced by the earlier response', async () => {
  const baseState = { orders: [{ id: 'order-1', total: '100' }] };
  const firstEdit = { orders: [{ id: 'order-1', total: '120' }] };
  const secondEdit = { orders: [{ id: 'order-1', total: '140' }] };
  const remote = envelope(100, HASH_A, baseState);
  let resolveFirst;
  const firstResponse = new Promise((resolve) => { resolveFirst = resolve; });
  const harness = createHarness({
    remote,
    entries: {
      [STORE_KEY]: JSON.stringify(baseState),
      [BASE_KEY]: JSON.stringify(remote),
      [TS_KEY]: '100',
    },
    fetchSteps: [
      () => firstResponse,
      response(200, { ok: true, idempotent: false, ...envelope(102, HASH_C, secondEdit) }),
    ],
  });

  harness.localStorage.setItem(STORE_KEY, JSON.stringify(firstEdit));
  const timerPromise = harness.runNextTimer();
  await Promise.resolve();
  harness.localStorage.setItem(STORE_KEY, JSON.stringify(secondEdit));
  resolveFirst(response(200, {
    ok: true,
    idempotent: false,
    ...envelope(101, HASH_B, firstEdit),
  }));
  await timerPromise;

  assert.deepEqual(JSON.parse(harness.localStorage.getItem(STORE_KEY)), secondEdit);
  assert.deepEqual(JSON.parse(harness.localStorage.getItem(BASE_KEY)), envelope(101, HASH_B, firstEdit));
  await harness.runNextTimer();
  assert.equal(harness.fetchCalls.length, 2);
  assert.deepEqual(JSON.parse(harness.fetchCalls[1].options.body).localState, secondEdit);
});

test('an unversioned divergent browser copy is preserved and never guessed as a merge base', () => {
  const localState = { orders: [{ id: 'local-unsynced' }] };
  const remoteState = { orders: [{ id: 'remote-current' }] };
  const harness = createHarness({
    remote: envelope(100, HASH_A, remoteState),
    entries: {
      [STORE_KEY]: JSON.stringify(localState),
      [TS_KEY]: '50',
    },
  });

  assert.deepEqual(JSON.parse(harness.localStorage.getItem(STORE_KEY)), localState);
  assert.equal(harness.localStorage.getItem(BASE_KEY), null);
  assert.equal(harness.fetchCalls.length, 0);
  assert.equal(harness.timers.filter((timer) => !timer.cancelled).length, 0);
  assert.ok(harness.nodes.has('bm-sync-conflict'));
});

test('pagehide flushes the pending versioned command with keepalive', async () => {
  const baseState = { orders: [{ id: 'order-1', total: '100' }] };
  const localState = { orders: [{ id: 'order-1', total: '120' }] };
  const remote = envelope(100, HASH_A, baseState);
  const harness = createHarness({
    remote,
    entries: {
      [STORE_KEY]: JSON.stringify(baseState),
      [BASE_KEY]: JSON.stringify(remote),
      [TS_KEY]: '100',
    },
    fetchSteps: [response(200, {
      ok: true,
      idempotent: false,
      ...envelope(101, HASH_B, localState),
    })],
  });

  harness.localStorage.setItem(STORE_KEY, JSON.stringify(localState));
  harness.listeners.get('pagehide')();
  await harness.flush();

  assert.equal(harness.fetchCalls.length, 1);
  assert.equal(harness.fetchCalls[0].options.keepalive, true);
});
