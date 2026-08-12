'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  startAfterStateInitialization,
} = require('../server/state/state-startup');

test('HTTP listening starts only after state initialization finishes', async () => {
  const events = [];
  let finishInitialization;
  const repository = {
    initialize: async () => {
      events.push('initialize-start');
      await new Promise((resolve) => { finishInitialization = resolve; });
      events.push('initialize-finish');
    },
  };
  const start = startAfterStateInitialization({
    repository,
    listen: async () => {
      events.push('listen');
      return 'server';
    },
  });

  await Promise.resolve();
  assert.deepEqual(events, ['initialize-start']);
  finishInitialization();

  await assert.doesNotReject(start);
  assert.equal(await start, 'server');
  assert.deepEqual(events, ['initialize-start', 'initialize-finish', 'listen']);
});

test('an initialization failure closes the pool and never opens the listener', async () => {
  const events = [];
  const failure = new Error('migration failed');

  await assert.rejects(
    startAfterStateInitialization({
      repository: {
        initialize: async () => {
          events.push('initialize');
          throw failure;
        },
      },
      listen: async () => {
        events.push('listen');
      },
      closePool: async () => {
        events.push('close');
      },
    }),
    failure,
  );
  assert.deepEqual(events, ['initialize', 'close']);
});

test('a listener failure also closes the pool', async () => {
  const events = [];
  const failure = new Error('listen failed');

  await assert.rejects(
    startAfterStateInitialization({
      repository: { initialize: async () => { events.push('initialize'); } },
      listen: async () => {
        events.push('listen');
        throw failure;
      },
      closePool: async () => { events.push('close'); },
    }),
    failure,
  );
  assert.deepEqual(events, ['initialize', 'listen', 'close']);
});

test('startup dependencies are validated before any side effect', async () => {
  await assert.rejects(
    startAfterStateInitialization({ repository: {}, listen() {} }),
    /repository\.initialize/,
  );
  await assert.rejects(
    startAfterStateInitialization({ repository: null }),
    /listen/,
  );
  await assert.rejects(
    startAfterStateInitialization({ listen() {}, closePool: true }),
    /closePool/,
  );
});
