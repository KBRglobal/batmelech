'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  OperationsReviewInputSchema,
  OperationsReviewSchema,
} = require('../server/ai/operations-review-schema');
const {
  OPERATIONS_OPENAI_CLIENT_OPTIONS,
  OPERATIONS_OPENAI_REQUEST_LIMITS,
  OPERATIONS_SERVICE_ERROR_CODES,
  OperationsReviewServiceError,
  createOpenAIOperationsReview,
} = require('../server/ai/openai-operations-review');
const {
  MAX_OPERATIONS_REVIEW_JSON_LENGTH,
  OPERATIONS_REVIEW_RATE_LIMIT,
  createOperationsReviewHandler,
  createOperationsReviewRateLimiter,
  createOperationsReviewRouter,
} = require('../server/ai/operations-review-route');

function sanitizedSnapshot(overrides = {}) {
  return {
    scope: 'shopping',
    selectedServiceDate: '2099-08-14',
    demands: [
      {
        id: 'demand-1',
        source: 'preparation',
        serviceDate: '2099-08-14',
        category: 'mains',
        quantity: '12',
        procurementKind: 'recipe',
        comparisonGroup: null,
      },
      {
        id: 'demand-2',
        source: 'shopping',
        serviceDate: '2099-08-14',
        category: 'ingredient',
        quantity: '4.5',
        procurementKind: 'computed',
        comparisonGroup: 'group-1',
      },
    ],
    warnings: [
      {
        id: 'warning-1',
        source: 'shopping',
        code: 'MISSING_RECIPE',
        serviceDate: '2099-08-14',
        occurrences: 1,
        relatedDemandIds: ['demand-1'],
      },
      {
        id: 'warning-2',
        source: 'delivery',
        code: 'MISSING_DESTINATION',
        serviceDate: '2099-08-14',
        occurrences: 2,
        relatedDemandIds: [],
      },
    ],
    ...overrides,
  };
}

function completeReview(overrides = {}) {
  return {
    reviewOnly: true,
    overview: 'The sanitized snapshot contains grounded operational concerns.',
    findings: [
      {
        kind: 'configuration_gap',
        priority: 'high',
        sourceIds: ['warning-1'],
        explanation: 'A recipe configuration gap prevents a complete ingredient calculation.',
      },
    ],
    ...overrides,
  };
}

function fakeOpenAI(responseOrFactory) {
  const calls = [];
  return {
    calls,
    client: {
      responses: {
        async parse(request) {
          calls.push(request);
          return typeof responseOrFactory === 'function'
            ? responseOrFactory(request)
            : responseOrFactory;
        },
      },
    },
  };
}

async function invokeHandler(handler, body, requestProperties = {}) {
  const headers = new Map();
  let statusCode = 200;
  let responseBody;
  const response = {
    set(name, value) {
      headers.set(name.toLowerCase(), value);
      return this;
    },
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      responseBody = value;
      return this;
    },
  };

  await handler({ body, ...requestProperties }, response);
  return { body: responseBody, headers, statusCode };
}

async function invokeRateLimiter(rateLimiter) {
  const headers = new Map();
  let nextCalled = false;
  let nextError;
  let responseBody;
  let statusCode = 200;
  const request = {
    headers: {},
    ip: '127.0.0.1',
    method: 'POST',
    originalUrl: '/api/ai/operations-review',
  };
  const response = {
    headersSent: false,
    append(name, value) {
      const normalizedName = name.toLowerCase();
      const existing = headers.get(normalizedName) || [];
      headers.set(normalizedName, [...existing, value]);
      return this;
    },
    set(name, value) {
      headers.set(name.toLowerCase(), value);
      return this;
    },
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
      return this;
    },
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      responseBody = value;
      this.headersSent = true;
      return this;
    },
  };

  await rateLimiter(request, response, (error) => {
    nextCalled = !error;
    nextError = error;
  });
  if (nextError) throw nextError;
  return { body: responseBody, headers, nextCalled, statusCode };
}

test('uses Responses Structured Outputs with exact sanitized aggregates and immutable spend bounds', async () => {
  const snapshot = sanitizedSnapshot();
  const providerReview = completeReview();
  const fake = fakeOpenAI({ status: 'completed', output: [], output_parsed: providerReview });
  const reviewer = createOpenAIOperationsReview({
    client: fake.client,
    model: 'injected-test-model',
    env: {},
  });

  const review = await reviewer(snapshot);

  assert.deepEqual(review, providerReview);
  assert.equal(fake.calls.length, 1);
  const request = fake.calls[0];
  assert.equal(request.model, 'injected-test-model');
  assert.equal(request.store, false);
  assert.equal(request.max_output_tokens, 1_600);
  assert.deepEqual(request.reasoning, { effort: 'medium' });
  assert.equal(request.text.format.type, 'json_schema');
  assert.equal(request.text.format.name, 'operations_review');
  assert.equal(request.text.format.strict, true);
  assert.match(request.input[0].content, /review-only/i);
  assert.match(request.input[0].content, /Never invent or recommend a quantity/i);
  assert.match(request.input[0].content, /Do not give instructions/i);
  assert.match(request.input[0].content, /customer name, phone, address/i);

  const providerSnapshot = JSON.parse(request.input[1].content.split('\n').slice(2).join('\n'));
  assert.deepEqual(providerSnapshot, snapshot);
  assert.deepEqual(Object.keys(providerSnapshot).sort(), [
    'demands',
    'scope',
    'selectedServiceDate',
    'warnings',
  ]);
  assert.doesNotMatch(
    request.input[1].content,
    /customerName|phone|address|destination|notes|rawOrders|ingredientName|itemName/u
  );

  assert.equal(Object.isFrozen(OPERATIONS_OPENAI_CLIENT_OPTIONS), true);
  assert.deepEqual(OPERATIONS_OPENAI_CLIENT_OPTIONS, { maxRetries: 0, timeout: 20_000 });
  assert.equal(Object.isFrozen(OPERATIONS_OPENAI_REQUEST_LIMITS), true);
  assert.equal(Object.isFrozen(OPERATIONS_OPENAI_REQUEST_LIMITS.reasoning), true);
});

test('uses only server configuration and constructs a frozen no-retry client', async () => {
  const fake = fakeOpenAI({ status: 'completed', output: [], output_parsed: completeReview() });
  let capturedOptions;
  const reviewer = createOpenAIOperationsReview({
    env: {
      OPENAI_API_KEY: 'server-only-test-key',
      OPENAI_MODEL: 'environment-test-model',
    },
    clientFactory(options) {
      capturedOptions = options;
      return fake.client;
    },
  });

  await reviewer(sanitizedSnapshot());
  assert.equal(fake.calls[0].model, 'environment-test-model');
  assert.equal(Object.isFrozen(capturedOptions), true);
  assert.deepEqual(capturedOptions, {
    apiKey: 'server-only-test-key',
    maxRetries: 0,
    timeout: 20_000,
  });
});

test('rejects PII, customer text, raw orders, and unknown request fields before provider access', async (t) => {
  const fake = fakeOpenAI({ status: 'completed', output: [], output_parsed: completeReview() });
  const reviewer = createOpenAIOperationsReview({ client: fake.client, model: 'test-model' });
  const handler = createOperationsReviewHandler({ reviewOperations: reviewer });

  for (const [field, value] of [
    ['customerName', 'Private Person'],
    ['phone', '+971500000000'],
    ['address', 'Private Hotel'],
    ['notes', ['private note']],
    ['rawOrders', [{ id: 'real-order' }]],
    ['itemName', 'customer-authored custom dish'],
  ]) {
    await t.test(field, async () => {
      const response = await invokeHandler(handler, {
        snapshot: { ...sanitizedSnapshot(), [field]: value },
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.error.code, 'invalid_request');
    });
  }

  assert.equal(fake.calls.length, 0);
});

test('returns advisory review only and has no persistence or state dependency', async () => {
  const providerReview = completeReview();
  const fake = fakeOpenAI({ status: 'completed', output: [], output_parsed: providerReview });
  const reviewer = createOpenAIOperationsReview({ client: fake.client, model: 'test-model' });
  const handler = createOperationsReviewHandler({ reviewOperations: reviewer });
  const persistenceCalls = [];
  const persistenceBoundary = new Proxy(
    {},
    {
      get(_target, operation) {
        return (...args) => persistenceCalls.push({ operation, args });
      },
    }
  );
  const originalFetch = global.fetch;
  const originalConsole = { error: console.error, log: console.log, warn: console.warn };
  let fetchCalls = 0;
  const consoleCalls = [];
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error('Unexpected network persistence call.');
  };
  console.error = (...args) => consoleCalls.push(args);
  console.log = (...args) => consoleCalls.push(args);
  console.warn = (...args) => consoleCalls.push(args);

  let response;
  try {
    response = await invokeHandler(
      handler,
      { snapshot: sanitizedSnapshot() },
      {
        app: {
          locals: {
            database: persistenceBoundary,
            pool: persistenceBoundary,
            stateStore: persistenceBoundary,
          },
        },
      }
    );
  } finally {
    global.fetch = originalFetch;
    console.error = originalConsole.error;
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
  }

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(response.body, { review: providerReview });
  assert.deepEqual(Object.keys(response.body), ['review']);
  assert.deepEqual(persistenceCalls, []);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(consoleCalls, []);

  const router = createOperationsReviewRouter({ reviewOperations: reviewer });
  assert.equal(router.stack.length, 1);
  assert.equal(router.stack[0].route.methods.post, true);
  assert.equal(router.stack[0].route.stack.length, 2);
});

test('rejects malformed, ungrounded, corrective, and action-taking provider output', async (t) => {
  const cases = [
    ['malformed schema', { reviewOnly: true }],
    [
      'invented source',
      completeReview({
        findings: [{
          kind: 'configuration_gap',
          priority: 'high',
          sourceIds: ['warning-999'],
          explanation: 'A configuration gap prevents complete calculation.',
        }],
      }),
    ],
    [
      'wrong finding source kind',
      completeReview({
        findings: [{
          kind: 'unit_conflict',
          priority: 'high',
          sourceIds: ['warning-1'],
          explanation: 'The supplied warning represents an identity conflict.',
        }],
      }),
    ],
    [
      'invented corrective quantity',
      completeReview({
        findings: [{
          kind: 'configuration_gap',
          priority: 'high',
          sourceIds: ['warning-1'],
          explanation: 'Set the quantity to 50 before production.',
        }],
      }),
    ],
    [
      'invented action',
      completeReview({
        findings: [{
          kind: 'configuration_gap',
          priority: 'high',
          sourceIds: ['warning-1'],
          explanation: 'Update the recipe before production.',
        }],
      }),
    ],
    [
      'invented quantity written as a word',
      completeReview({
        findings: [{
          kind: 'configuration_gap',
          priority: 'high',
          sourceIds: ['warning-1'],
          explanation: 'The corrective target is fifty portions.',
        }],
      }),
    ],
    [
      'invented Hebrew action with punctuation',
      completeReview({
        findings: [{
          kind: 'configuration_gap',
          priority: 'high',
          sourceIds: ['warning-1'],
          explanation: 'מומלץ, לעדכן את המתכון.',
        }],
      }),
    ],
    [
      'invented mutation field',
      { ...completeReview(), applyChanges: true },
    ],
  ];

  for (const [name, providerOutput] of cases) {
    await t.test(name, async () => {
      const fake = fakeOpenAI({ status: 'completed', output: [], output_parsed: providerOutput });
      const reviewer = createOpenAIOperationsReview({ client: fake.client, model: 'test-model' });
      await assert.rejects(
        reviewer(sanitizedSnapshot()),
        (error) => {
          assert.ok(error instanceof OperationsReviewServiceError);
          assert.equal(error.code, OPERATIONS_SERVICE_ERROR_CODES.INVALID_PROVIDER_OUTPUT);
          return true;
        }
      );
    });
  }
});

test('rejects provider refusal, parse failure, and absent configuration with sanitized errors', async (t) => {
  await t.test('refusal', async () => {
    const fake = fakeOpenAI({
      status: 'completed',
      output_parsed: null,
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'private detail' }] }],
    });
    const reviewer = createOpenAIOperationsReview({ client: fake.client, model: 'test-model' });
    await assert.rejects(
      reviewer(sanitizedSnapshot()),
      (error) => error.code === OPERATIONS_SERVICE_ERROR_CODES.REFUSED
    );
  });

  await t.test('parse failure', async () => {
    const fake = fakeOpenAI(() => {
      throw new SyntaxError('private provider body');
    });
    const reviewer = createOpenAIOperationsReview({ client: fake.client, model: 'test-model' });
    await assert.rejects(
      reviewer(sanitizedSnapshot()),
      (error) => error.code === OPERATIONS_SERVICE_ERROR_CODES.INVALID_PROVIDER_OUTPUT
    );
  });

  await t.test('not configured', async () => {
    const reviewer = createOpenAIOperationsReview({ env: {} });
    await assert.rejects(
      reviewer(sanitizedSnapshot()),
      (error) => {
        assert.equal(error.code, OPERATIONS_SERVICE_ERROR_CODES.NOT_CONFIGURED);
        assert.doesNotMatch(error.message, /OPENAI|API key/i);
        return true;
      }
    );
  });
});

test('validates bounded request size before calling the reviewer', async () => {
  let calls = 0;
  const handler = createOperationsReviewHandler({
    async reviewOperations() {
      calls += 1;
      return completeReview();
    },
  });

  const oversized = await invokeHandler(handler, {
    snapshot: sanitizedSnapshot(),
    padding: 'x'.repeat(MAX_OPERATIONS_REVIEW_JSON_LENGTH),
  });
  assert.equal(oversized.statusCode, 413);
  assert.equal(oversized.body.error.code, 'request_too_large');

  const invalid = await invokeHandler(handler, { snapshot: { scope: 'shopping' } });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error.code, 'invalid_request');
  assert.equal(calls, 0);
});

test('rate limiter blocks request twenty-one before provider or persistence access', async () => {
  const rateLimiter = createOperationsReviewRateLimiter();
  let downstreamCalls = 0;

  assert.equal(Object.isFrozen(OPERATIONS_REVIEW_RATE_LIMIT), true);
  assert.deepEqual(OPERATIONS_REVIEW_RATE_LIMIT, {
    limit: 20,
    windowMs: 15 * 60 * 1000,
  });

  for (let requestNumber = 1; requestNumber <= OPERATIONS_REVIEW_RATE_LIMIT.limit; requestNumber += 1) {
    const response = await invokeRateLimiter(rateLimiter);
    assert.equal(response.nextCalled, true);
    downstreamCalls += 1;
  }

  const blocked = await invokeRateLimiter(rateLimiter);
  assert.equal(blocked.nextCalled, false);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.headers.get('cache-control'), 'no-store');
  assert.equal(blocked.body.error.code, 'ai_rate_limited');
  assert.equal(downstreamCalls, OPERATIONS_REVIEW_RATE_LIMIT.limit);
});

test('runtime operations-review modules contain no persistence, state, or logging path', () => {
  const runtimeFiles = [
    'operations-review-schema.js',
    'operations-review-prompt.js',
    'openai-operations-review.js',
    'operations-review-route.js',
  ];

  for (const file of runtimeFiles) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'ai', file), 'utf8');
    assert.doesNotMatch(source, /require\(['"]pg['"]\)/);
    assert.doesNotMatch(source, /require\(['"](?:node:)?(?:fs|http|https|net|child_process)['"]\)/);
    assert.doesNotMatch(source, /DATABASE_URL/);
    assert.doesNotMatch(source, /\/api\/state/);
    assert.doesNotMatch(source, /\.query\s*\(/);
    assert.doesNotMatch(source, /\bfetch\s*\(/);
    assert.doesNotMatch(source, /\b(?:writeFile|appendFile|createWriteStream)\s*\(/);
    assert.doesNotMatch(source, /\bconsole\.(?:log|warn|error)\s*\(/);
    assert.doesNotMatch(source, /req\.(?:app|socket)/);
  }
});

test('input and output schemas remain strict and review-only', () => {
  assert.equal(OperationsReviewInputSchema.safeParse(sanitizedSnapshot()).success, true);
  assert.equal(
    OperationsReviewInputSchema.safeParse({ ...sanitizedSnapshot(), customerName: 'Private' }).success,
    false
  );
  assert.equal(OperationsReviewSchema.safeParse(completeReview()).success, true);
  assert.equal(OperationsReviewSchema.safeParse({ ...completeReview(), saved: true }).success, false);
  assert.equal(OperationsReviewSchema.safeParse({ ...completeReview(), reviewOnly: false }).success, false);
});
