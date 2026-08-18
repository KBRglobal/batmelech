'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');

const {
  readWindows,
  validateWindowsInput,
  windowAvailability,
  checkSubmissionWindow,
  createPublicWindowsRouter,
  createWindowsAdminRouter,
} = require('../server/delivery-windows');

const WINDOWS = Object.freeze([
  Object.freeze({ key: 'noon', start: '12:00', end: '14:00', capacity: 2 }),
  Object.freeze({ key: 'evening', start: '18:00', end: '20:00', capacity: 1 }),
]);

function deliveryOrder(overrides = {}) {
  return {
    id: `o-${Math.random()}`,
    date: '2026-08-20',
    time: '12:30',
    name: 'לקוח',
    address: 'מרינה, בניין 7',
    status: 'חדשה',
    ...overrides,
  };
}

function stateWith(orders, deliveryWindows = WINDOWS) {
  return { orders, settings: { deliveryWindows: [...deliveryWindows] } };
}

function fakeRepository(data, { failSaves = 0 } = {}) {
  let remainingFailures = failSaves;
  const saved = [];
  return {
    saved,
    async loadState() {
      return { data, revision: 1, hash: 'h' };
    },
    async saveState({ localState }) {
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        return { ok: false };
      }
      saved.push(localState);
      return { ok: true };
    },
  };
}

async function withServer(configure, run) {
  const app = express();
  configure(app);
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

// --- readWindows --------------------------------------------------------------

test('readWindows returns windows sorted by start time', () => {
  const windows = readWindows({ deliveryWindows: [WINDOWS[1], WINDOWS[0]] });
  assert.deepEqual(
    windows.map((window) => window.key),
    ['noon', 'evening'],
  );
});

test('readWindows is empty (feature off) when absent, empty, or not an array', () => {
  assert.deepEqual(readWindows(undefined), []);
  assert.deepEqual(readWindows({}), []);
  assert.deepEqual(readWindows({ deliveryWindows: [] }), []);
  assert.deepEqual(readWindows({ deliveryWindows: 'nope' }), []);
});

test('readWindows skips malformed entries instead of crashing', () => {
  const windows = readWindows({
    deliveryWindows: [
      WINDOWS[0],
      null,
      'text',
      { key: 'bad-time', start: '25:00', end: '26:00', capacity: 3 },
      { key: 'backwards', start: '14:00', end: '12:00', capacity: 3 },
      { key: 'no-capacity', start: '15:00', end: '16:00', capacity: 0 },
      { key: 'noon', start: '16:00', end: '17:00', capacity: 3 }, // duplicate key
    ],
  });
  assert.deepEqual(windows, [WINDOWS[0]]);
});

// --- validateWindowsInput -----------------------------------------------------

test('validateWindowsInput accepts a valid set and sorts it by start', () => {
  const result = validateWindowsInput([WINDOWS[1], WINDOWS[0]]);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.windows.map((window) => window.key),
    ['noon', 'evening'],
  );
});

test('validateWindowsInput accepts back-to-back windows (end equals next start)', () => {
  const result = validateWindowsInput([
    { key: 'a', start: '12:00', end: '14:00', capacity: 2 },
    { key: 'b', start: '14:00', end: '16:00', capacity: 2 },
  ]);
  assert.equal(result.ok, true);
});

test('validateWindowsInput rejects every malformed shape', () => {
  const invalid = [
    'not-an-array',
    [{ key: 'a', start: '12:00', end: '14:00', capacity: 2 }, { key: 'a', start: '15:00', end: '16:00', capacity: 2 }],
    [{ key: '', start: '12:00', end: '14:00', capacity: 2 }],
    [{ key: 'a', start: '12:0', end: '14:00', capacity: 2 }],
    [{ key: 'a', start: '24:00', end: '25:00', capacity: 2 }],
    [{ key: 'a', start: '14:00', end: '12:00', capacity: 2 }],
    [{ key: 'a', start: '12:00', end: '12:00', capacity: 2 }],
    [{ key: 'a', start: '12:00', end: '14:00', capacity: 0 }],
    [{ key: 'a', start: '12:00', end: '14:00', capacity: 501 }],
    [{ key: 'a', start: '12:00', end: '14:00', capacity: 2.5 }],
    [
      { key: 'a', start: '12:00', end: '14:00', capacity: 2 },
      { key: 'b', start: '13:00', end: '15:00', capacity: 2 }, // overlap
    ],
    Array.from({ length: 21 }, (_, at) => ({
      key: `w${at}`,
      start: `${String(at).padStart(2, '0')}:00`,
      end: `${String(at).padStart(2, '0')}:30`,
      capacity: 1,
    })),
  ];
  for (const candidate of invalid) {
    const result = validateWindowsInput(candidate);
    assert.equal(result.ok, false, JSON.stringify(candidate).slice(0, 80));
    assert.equal(typeof result.error, 'string');
  }
});

// --- windowAvailability -------------------------------------------------------

test('availability subtracts active delivery orders on that date only', () => {
  const state = stateWith([
    deliveryOrder({ time: '12:30' }),
    deliveryOrder({ time: '13:59' }),
    deliveryOrder({ date: '2026-08-21', time: '12:30' }), // other day
    deliveryOrder({ time: '18:15' }),
  ]);
  const windows = windowAvailability(state, '2026-08-20');
  assert.deepEqual(
    windows.map((window) => [window.key, window.remaining]),
    [['noon', 0], ['evening', 0]],
  );
});

test('cancelled and pickup orders never consume capacity', () => {
  const state = stateWith([
    deliveryOrder({ status: 'בוטלה' }),
    deliveryOrder({ pickup: true }),
    deliveryOrder({ address: 'איסוף עצמי' }), // how site pickup orders are saved
  ]);
  const windows = windowAvailability(state, '2026-08-20');
  assert.equal(windows[0].remaining, 2);
});

test('boundary times: start is inside the window, end is outside it', () => {
  const state = stateWith([
    deliveryOrder({ time: '12:00' }), // exactly at start — counts
    deliveryOrder({ time: '14:00' }), // exactly at end — belongs to no window here
  ]);
  const windows = windowAvailability(state, '2026-08-20');
  assert.equal(windows[0].remaining, 1);
  assert.equal(windows[1].remaining, 1);
});

test('staff-typed times like 12.30 still count against the window', () => {
  const state = stateWith([deliveryOrder({ time: '12.30' })]);
  const windows = windowAvailability(state, '2026-08-20');
  assert.equal(windows[0].remaining, 1);
});

test('remaining never goes below zero even when overbooked by staff', () => {
  const state = stateWith([
    deliveryOrder({ time: '18:10' }),
    deliveryOrder({ time: '18:20' }),
    deliveryOrder({ time: '18:30' }),
  ]);
  const windows = windowAvailability(state, '2026-08-20');
  assert.equal(windows[1].remaining, 0);
});

test('no configured windows means empty availability', () => {
  assert.deepEqual(windowAvailability({ orders: [deliveryOrder()], settings: {} }, '2026-08-20'), []);
});

// --- checkSubmissionWindow ----------------------------------------------------

test('checkSubmissionWindow stays silent when the feature is off or does not apply', () => {
  const offState = { orders: [], settings: {} };
  assert.equal(checkSubmissionWindow(offState, { fulfillment: 'delivery', date: '2026-08-20', time: '12:30' }), null);
  const onState = stateWith([]);
  assert.equal(checkSubmissionWindow(onState, { fulfillment: 'pickup', date: '2026-08-20', time: '12:30' }), null);
  assert.equal(checkSubmissionWindow(onState, { fulfillment: 'delivery', date: '', time: '12:30' }), null);
  assert.equal(checkSubmissionWindow(onState, { fulfillment: 'delivery', date: '2026-08-20', time: '' }), null);
});

test('checkSubmissionWindow accepts an open window and rejects a full or unknown one', () => {
  const state = stateWith([deliveryOrder({ time: '18:30' })]);
  const open = checkSubmissionWindow(state, { fulfillment: 'delivery', date: '2026-08-20', time: '12:30' });
  assert.equal(open.ok, true);
  assert.equal(open.window.key, 'noon');

  const full = checkSubmissionWindow(state, { fulfillment: 'delivery', date: '2026-08-20', time: '18:45' });
  assert.deepEqual(full, { ok: false, error: 'window_full' });

  const outside = checkSubmissionWindow(state, { fulfillment: 'delivery', date: '2026-08-20', time: '16:00' });
  assert.deepEqual(outside, { ok: false, error: 'invalid_window' });
});

// --- public availability route ------------------------------------------------

function mountPublic(repository) {
  return (app) => {
    app.use('/api/site/delivery-windows', createPublicWindowsRouter({ repository, logger: { error() {} } }));
  };
}

test('GET /?date= returns live remaining counts and is never cacheable', async () => {
  const repository = fakeRepository(stateWith([deliveryOrder({ time: '12:30' })]));
  await withServer(mountPublic(repository), async (origin) => {
    const response = await fetch(`${origin}/api/site/delivery-windows/?date=2026-08-20`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      windows: [
        { key: 'noon', start: '12:00', end: '14:00', remaining: 1 },
        { key: 'evening', start: '18:00', end: '20:00', remaining: 1 },
      ],
    });
  });
});

test('GET rejects a malformed date and answers empty when no windows are configured', async () => {
  const repository = fakeRepository({ orders: [], settings: {} });
  await withServer(mountPublic(repository), async (origin) => {
    const bad = await fetch(`${origin}/api/site/delivery-windows/?date=not-a-date`);
    assert.equal(bad.status, 400);

    const off = await fetch(`${origin}/api/site/delivery-windows/?date=2026-08-20`);
    assert.equal(off.status, 200);
    assert.deepEqual(await off.json(), { windows: [] });
  });
});

// --- staff admin route --------------------------------------------------------

function mountAdmin(repository) {
  return (app) => {
    app.use('/api/settings/delivery-windows', createWindowsAdminRouter({ repository, logger: { error() {} } }));
  };
}

test('admin GET lists the configured windows with capacities', async () => {
  const repository = fakeRepository(stateWith([]));
  await withServer(mountAdmin(repository), async (origin) => {
    const response = await fetch(`${origin}/api/settings/delivery-windows/`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { windows: [...WINDOWS] });
  });
});

test('admin PUT replaces the full array and preserves the rest of settings', async () => {
  const repository = fakeRepository({ orders: [], settings: { siteBanner: 'hi', deliveryWindows: [...WINDOWS] } });
  await withServer(mountAdmin(repository), async (origin) => {
    const next = [{ key: 'morning', start: '09:00', end: '11:00', capacity: 5 }];
    const response = await fetch(`${origin}/api/settings/delivery-windows/`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ windows: next }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, windows: next });
    const savedSettings = repository.saved.at(-1).settings;
    assert.deepEqual(savedSettings.deliveryWindows, next);
    assert.equal(savedSettings.siteBanner, 'hi');
  });
});

test('admin PUT with an empty array turns the feature off', async () => {
  const repository = fakeRepository(stateWith([]));
  await withServer(mountAdmin(repository), async (origin) => {
    const response = await fetch(`${origin}/api/settings/delivery-windows/`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ windows: [] }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(repository.saved.at(-1).settings.deliveryWindows, []);
  });
});

test('admin PUT rejects invalid windows and saves nothing', async () => {
  const repository = fakeRepository(stateWith([]));
  await withServer(mountAdmin(repository), async (origin) => {
    const response = await fetch(`${origin}/api/settings/delivery-windows/`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        windows: [
          { key: 'a', start: '12:00', end: '14:00', capacity: 2 },
          { key: 'b', start: '13:00', end: '15:00', capacity: 2 },
        ],
      }),
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'invalid_windows');
    assert.equal(repository.saved.length, 0);
  });
});

test('admin PUT retries a lost save race and succeeds on the next attempt', async () => {
  const repository = fakeRepository(stateWith([]), { failSaves: 1 });
  await withServer(mountAdmin(repository), async (origin) => {
    const response = await fetch(`${origin}/api/settings/delivery-windows/`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ windows: [{ key: 'a', start: '12:00', end: '14:00', capacity: 2 }] }),
    });
    assert.equal(response.status, 200);
    assert.equal(repository.saved.length, 1);
  });
});
