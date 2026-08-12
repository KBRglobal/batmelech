'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const OpenAI = require('openai');

const {
  OrderIntakeReviewSchema,
} = require('../server/ai/order-intake-schema');
const {
  OPENAI_CLIENT_OPTIONS,
  OPENAI_REQUEST_LIMITS,
  OPENAI_RETRY_LIMITS,
  OrderIntakeServiceError,
  SERVICE_ERROR_CODES,
  createOpenAIOrderIntake,
} = require('../server/ai/openai-order-intake');
const {
  MAX_MESSAGE_LENGTH,
  ORDER_INTAKE_RATE_LIMIT,
  createOrderIntakeHandler,
  createOrderIntakeRateLimiter,
  createOrderIntakeRouter,
} = require('../server/ai/order-intake-route');

const catalog = [
  {
    id: 'couscous',
    name: 'קוסקוס',
    category: 'sides',
    aliases: ['קוסקוס כמו ענן'],
    isPaidExtra: false,
    price: null,
    currency: null,
  },
  {
    id: 'schnitzel',
    name: 'שניצל',
    category: 'mains',
    aliases: ['שניצלל'],
    isPaidExtra: false,
    price: null,
    currency: null,
  },
  {
    id: 'extra_fish',
    name: 'פילה דג נוסף',
    category: 'extras',
    aliases: ['עוד דג'],
    isPaidExtra: true,
    price: 30,
    currency: 'USD',
  },
];

function completeReview(overrides = {}) {
  const review = {
    reviewOnly: true,
    draft: {
      customerName: null,
      customerPhone: null,
      serviceDate: null,
      serviceTime: null,
      fulfillmentMethod: 'unknown',
      deliveryLocation: null,
      items: [],
      notes: [],
    },
    corrections: [],
    ambiguities: [],
    paidExtras: [],
    unknownItems: [],
    missingFields: [],
    warnings: [],
    overallConfidence: 0.8,
  };

  return {
    ...review,
    ...overrides,
    draft: { ...review.draft, ...(overrides.draft || {}) },
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
    originalUrl: '/api/ai/order-intake',
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

test('uses official Responses structured output and preserves every review finding', async () => {
  const providerReview = completeReview({
    draft: {
      items: [
        {
          catalogItemId: 'couscous',
          catalogItemName: 'קוסקוס',
          category: 'sides',
          quantity: 1,
          sourceText: 'קוסקוסס כמו ענן אחד',
          confidence: 0.91,
        },
        {
          catalogItemId: 'schnitzel',
          catalogItemName: 'שניצל',
          category: 'mains',
          quantity: 3,
          sourceText: 'שתי שניצלל בעצם שלוש',
          confidence: 0.98,
        },
        {
          catalogItemId: 'extra_fish',
          catalogItemName: 'פילה דג נוסף',
          category: 'extras',
          quantity: 1,
          sourceText: 'ועוד דג אחד',
          confidence: 0.99,
        },
      ],
    },
    corrections: [
      {
        originalText: 'שתי שניצלל',
        correctedText: 'בעצם שלוש',
        reason: 'The customer explicitly corrected the quantity.',
      },
    ],
    ambiguities: [
      {
        sourceText: 'לשישי',
        question: 'Which Friday date did the customer mean?',
        candidateCatalogItemIds: [],
      },
    ],
    paidExtras: [
      {
        catalogItemId: 'extra_fish',
        catalogItemName: 'פילה דג נוסף',
        quantity: 1,
        catalogPrice: 30,
        currency: 'USD',
        sourceText: 'ועוד דג אחד',
        reason: 'This catalog item is marked as a paid extra and needs confirmation.',
        confidence: 0.99,
      },
    ],
    unknownItems: [
      {
        sourceText: 'קובנה אחת',
        requestedQuantity: 1,
        reason: 'No supplied catalog item matches this request.',
      },
    ],
    missingFields: [
      {
        field: 'service_date',
        sourceText: 'לשישי',
        reason: 'An exact service date is missing.',
      },
    ],
    warnings: [
      {
        code: 'paid_extra',
        severity: 'warning',
        message: 'Confirm the paid fish extra with the customer.',
      },
    ],
    overallConfidence: 0.86,
  });
  const fake = fakeOpenAI({ status: 'completed', output: [], output_parsed: providerReview });
  const reviewOrderIntake = createOpenAIOrderIntake({
    client: fake.client,
    model: 'injected-test-model',
    env: {},
  });
  const message =
    'לשישי קוסקוסס כמו ענן אחד, שתי שניצלל בעצם שלוש, ועוד דג אחד וקובנה אחת';

  const review = await reviewOrderIntake({ message, catalog });

  assert.equal(OrderIntakeReviewSchema.safeParse(review).success, true);
  assert.equal(review.reviewOnly, true);
  assert.equal(review.corrections.length, 1);
  assert.equal(review.draft.items[0].catalogItemId, 'couscous');
  assert.equal(review.draft.items[1].quantity, 3);
  assert.equal(review.paidExtras[0].catalogPrice, 30);
  assert.equal(review.unknownItems[0].sourceText, 'קובנה אחת');
  assert.equal(review.missingFields[0].field, 'service_date');
  assert.ok(review.warnings.some((warning) => warning.code === 'paid_extra'));
  assert.equal(review.overallConfidence, 0.5);

  assert.equal(fake.calls.length, 1);
  const request = fake.calls[0];
  assert.equal(request.model, 'injected-test-model');
  assert.equal(request.store, false);
  assert.equal(request.max_output_tokens, 12_000);
  assert.deepEqual(request.reasoning, { effort: 'low' });
  assert.equal(request.text.format.type, 'json_schema');
  assert.equal(request.text.format.name, 'order_intake_review');
  assert.equal(request.text.format.strict, true);
  assert.match(request.input[0].content, /self-correct/i);
  assert.match(request.input[0].content, /misspell/i);
  assert.match(request.input[0].content, /cloud-like couscous/i);
  assert.match(request.input[0].content, /Never invent a quantity/i);
  assert.match(request.input[0].content, /Never invent or calculate a price/i);
  assert.match(request.input[0].content, /isPaidExtra/i);
  assert.match(request.input[1].content, /קוסקוסס כמו ענן/);
});

test('uses OPENAI_MODEL when no model is injected and never hardcodes one', async () => {
  const review = completeReview();
  const fake = fakeOpenAI({ status: 'completed', output: [], output_parsed: review });
  const reviewOrderIntake = createOpenAIOrderIntake({
    client: fake.client,
    env: { OPENAI_MODEL: 'environment-test-model' },
  });

  await reviewOrderIntake({ message: 'הזמנה לבדיקה', catalog });
  assert.equal(fake.calls[0].model, 'environment-test-model');
});

test('uses a frozen no-retry 120-second OpenAI client options guard', async () => {
  const fake = fakeOpenAI({ status: 'completed', output: [], output_parsed: completeReview() });
  let capturedOptions;
  const reviewer = createOpenAIOrderIntake({
    env: {
      OPENAI_API_KEY: 'server-only-test-key',
      OPENAI_MODEL: 'environment-test-model',
    },
    clientFactory(options) {
      capturedOptions = options;
      return fake.client;
    },
  });

  assert.equal(Object.isFrozen(OPENAI_CLIENT_OPTIONS), true);
  assert.deepEqual(OPENAI_CLIENT_OPTIONS, { maxRetries: 0, timeout: 120_000 });
  await reviewer({ message: 'הזמנה לבדיקה', catalog });
  assert.equal(Object.isFrozen(capturedOptions), true);
  assert.deepEqual(capturedOptions, {
    apiKey: 'server-only-test-key',
    maxRetries: 0,
    timeout: 120_000,
  });
});

test('uses immutable low-reasoning output limits on every provider request', async () => {
  const fake = fakeOpenAI({ status: 'completed', output: [], output_parsed: completeReview() });
  const reviewer = createOpenAIOrderIntake({
    client: fake.client,
    model: 'test-model',
  });

  assert.equal(Object.isFrozen(OPENAI_REQUEST_LIMITS), true);
  assert.equal(Object.isFrozen(OPENAI_REQUEST_LIMITS.reasoning), true);
  assert.deepEqual(OPENAI_REQUEST_LIMITS, {
    max_output_tokens: 12_000,
    reasoning: { effort: 'low' },
  });
  assert.equal(Object.isFrozen(OPENAI_RETRY_LIMITS), true);
  assert.equal(Object.isFrozen(OPENAI_RETRY_LIMITS.reasoning), true);
  assert.deepEqual(OPENAI_RETRY_LIMITS, {
    max_output_tokens: 12_000,
    reasoning: { effort: 'low' },
  });

  await reviewer({ message: 'הזמנה לבדיקה', catalog });

  assert.equal(fake.calls[0].max_output_tokens, 12_000);
  assert.deepEqual(fake.calls[0].reasoning, { effort: 'low' });
});

test('returns safe service errors for refusals, null output, and malformed output', async (t) => {
  await t.test('refusal', async () => {
    const fake = fakeOpenAI({
      status: 'completed',
      output_parsed: null,
      output: [
        {
          type: 'message',
          content: [{ type: 'refusal', refusal: 'provider-only refusal details' }],
        },
      ],
    });
    const reviewer = createOpenAIOrderIntake({ client: fake.client, model: 'test-model' });

    await assert.rejects(
      reviewer({ message: 'טקסט לקוח סודי', catalog }),
      (error) => {
        assert.ok(error instanceof OrderIntakeServiceError);
        assert.equal(error.code, SERVICE_ERROR_CODES.REFUSED);
        assert.equal(error.statusCode, 422);
        assert.doesNotMatch(error.message, /provider-only|טקסט לקוח/);
        return true;
      }
    );
  });

  await t.test('null parsed output', async () => {
    const fake = fakeOpenAI({ status: 'completed', output: [], output_parsed: null });
    const reviewer = createOpenAIOrderIntake({ client: fake.client, model: 'test-model' });

    await assert.rejects(
      reviewer({ message: 'הזמנה', catalog }),
      (error) => {
        assert.equal(error.code, SERVICE_ERROR_CODES.INVALID_PROVIDER_OUTPUT);
        assert.equal(error.internalReason, 'null_parsed_output');
        return true;
      }
    );
    assert.equal(fake.calls.length, 2);
    assert.match(fake.calls[1].input[0].content, /previous response could not be parsed/i);
    assert.equal(fake.calls[1].store, false);
  });

  await t.test('schema-valid output with invented catalog data becomes a review-only unknown', async () => {
    const malformed = completeReview({
      draft: {
        items: [
          {
            catalogItemId: 'invented_item',
            catalogItemName: 'מנה שלא קיימת',
            category: 'invented',
            quantity: 1,
            sourceText: 'מנה',
            confidence: 1,
          },
        ],
      },
    });
    const fake = fakeOpenAI({ status: 'completed', output: [], output_parsed: malformed });
    const reviewer = createOpenAIOrderIntake({ client: fake.client, model: 'test-model' });

    const review = await reviewer({ message: 'מנה', catalog });
    assert.deepEqual(review.draft.items, []);
    assert.deepEqual(review.unknownItems, [
      {
        sourceText: 'מנה',
        requestedQuantity: null,
        reason: 'The proposed catalog ID is not present in the authoritative catalog.',
      },
    ]);
    assert.ok(review.warnings.some((warning) => warning.code === 'catalog_mismatch'));
    assert.equal(review.overallConfidence, 0.5);
    assert.equal(fake.calls.length, 1);
  });

  await t.test('schema-malformed output', async () => {
    const fake = fakeOpenAI({
      status: 'completed',
      output: [],
      output_parsed: { reviewOnly: true, draft: {} },
    });
    const reviewer = createOpenAIOrderIntake({ client: fake.client, model: 'test-model' });

    await assert.rejects(
      reviewer({ message: 'הזמנה', catalog }),
      (error) => error.code === SERVICE_ERROR_CODES.INVALID_PROVIDER_OUTPUT
    );
  });

  await t.test('SDK JSON parse failure', async () => {
    const fake = fakeOpenAI(() => {
      throw new SyntaxError('Unexpected token in provider output');
    });
    const reviewer = createOpenAIOrderIntake({ client: fake.client, model: 'test-model' });

    await assert.rejects(
      reviewer({ message: 'הזמנה', catalog }),
      (error) => {
        assert.equal(error.code, SERVICE_ERROR_CODES.INVALID_PROVIDER_OUTPUT);
        assert.equal(error.internalReason, 'structured_parse_failed');
        return true;
      }
    );
    assert.equal(fake.calls.length, 2);
  });

  await t.test('SDK Zod parse failure', async () => {
    const fake = fakeOpenAI(() => {
      const error = new Error('Provider output failed schema parsing');
      error.name = 'ZodError';
      throw error;
    });
    const reviewer = createOpenAIOrderIntake({ client: fake.client, model: 'test-model' });

    await assert.rejects(
      reviewer({ message: 'הזמנה', catalog }),
      (error) => error.code === SERVICE_ERROR_CODES.INVALID_PROVIDER_OUTPUT
    );
    assert.equal(fake.calls.length, 2);
  });

  await t.test('fabricated source evidence', async () => {
    const malformed = completeReview({
      draft: {
        items: [
          {
            catalogItemId: 'schnitzel',
            catalogItemName: 'שניצל',
            category: 'mains',
            quantity: 999,
            sourceText: '999 שניצל',
            confidence: 1,
          },
        ],
      },
    });
    const fake = fakeOpenAI({ status: 'completed', output: [], output_parsed: malformed });
    const reviewer = createOpenAIOrderIntake({ client: fake.client, model: 'test-model' });

    const review = await reviewer({ message: 'רק קוסקוס אחד', catalog });
    assert.deepEqual(review.draft.items, []);
    assert.ok(review.warnings.some((warning) => warning.code === 'catalog_mismatch'));
    assert.equal(fake.calls.length, 1);
  });

  await t.test('quantity absent from grounded source evidence', async () => {
    const malformed = completeReview({
      draft: {
        items: [
          {
            catalogItemId: 'schnitzel',
            catalogItemName: 'שניצל',
            category: 'mains',
            quantity: 999,
            sourceText: 'שניצל בבקשה',
            confidence: 1,
          },
        ],
      },
    });
    const fake = fakeOpenAI({ status: 'completed', output: [], output_parsed: malformed });
    const reviewer = createOpenAIOrderIntake({ client: fake.client, model: 'test-model' });

    const review = await reviewer({ message: 'שניצל בבקשה', catalog });
    assert.equal(review.draft.items[0].quantity, null);
    assert.ok(review.missingFields.some((finding) => finding.field === 'item_quantity'));
    assert.ok(review.warnings.some((warning) => warning.code === 'quantity_missing'));
    assert.equal(fake.calls.length, 1);
  });

  for (const [field, inventedValue] of [
    ['customerName', 'Invented Customer'],
    ['customerPhone', '+971500000000'],
    ['serviceDate', '2099-01-01'],
    ['serviceTime', '12:34'],
    ['deliveryLocation', 'Invented Hotel'],
  ]) {
    await t.test(`invented draft ${field}`, async () => {
      const malformed = completeReview({ draft: { [field]: inventedValue } });
      const fake = fakeOpenAI({ status: 'completed', output: [], output_parsed: malformed });
      const reviewer = createOpenAIOrderIntake({ client: fake.client, model: 'test-model' });

      const review = await reviewer({ message: 'הזמנה לבדיקה', catalog });
      assert.equal(review.draft[field], null);
      assert.ok(review.warnings.some((warning) => warning.code === 'missing_field'));
      assert.equal(fake.calls.length, 1);
    });
  }

  await t.test('invented draft note', async () => {
    const malformed = completeReview({ draft: { notes: ['Invented customer note'] } });
    const fake = fakeOpenAI({ status: 'completed', output: [], output_parsed: malformed });
    const reviewer = createOpenAIOrderIntake({ client: fake.client, model: 'test-model' });

    const review = await reviewer({ message: 'הזמנה לבדיקה', catalog });
    assert.deepEqual(review.draft.notes, []);
    assert.ok(review.warnings.some((warning) => warning.code === 'other'));
    assert.equal(fake.calls.length, 1);
  });

  await t.test('exact grounded draft contact and note text', async () => {
    const grounded = completeReview({
      draft: {
        customerName: 'נועה כהן',
        customerPhone: '050-123-4567',
        deliveryLocation: 'מלון לדוגמה',
        notes: ['בלי חריף'],
      },
    });
    const fake = fakeOpenAI({ status: 'completed', output: [], output_parsed: grounded });
    const reviewer = createOpenAIOrderIntake({ client: fake.client, model: 'test-model' });

    const review = await reviewer({
      message: 'נועה כהן 050-123-4567 מלון לדוגמה בלי חריף',
      catalog,
    });
    assert.equal(review.draft.customerName, 'נועה כהן');
    assert.deepEqual(review.draft.notes, ['בלי חריף']);
  });

  await t.test('paid extra omitted from paidExtras is rebuilt from the authoritative catalog', async () => {
    const malformed = completeReview({
      draft: {
        items: [
          {
            catalogItemId: 'extra_fish',
            catalogItemName: 'פילה דג נוסף',
            category: 'extras',
            quantity: 1,
            sourceText: 'עוד דג אחד',
            confidence: 0.99,
          },
        ],
      },
      paidExtras: [],
    });
    const fake = fakeOpenAI({ status: 'completed', output: [], output_parsed: malformed });
    const reviewer = createOpenAIOrderIntake({ client: fake.client, model: 'test-model' });

    const review = await reviewer({ message: 'עוד דג אחד', catalog });
    assert.equal(review.paidExtras.length, 1);
    assert.equal(review.paidExtras[0].catalogPrice, 30);
    assert.equal(review.paidExtras[0].currency, 'USD');
    assert.ok(review.warnings.some((warning) => warning.code === 'paid_extra'));
  });

  for (const [field, inventedValue] of [
    ['catalogPrice', 999],
    ['currency', 'AED'],
  ]) {
    await t.test(`paid extra with invented ${field}`, async () => {
      const malformed = completeReview({
        draft: {
          items: [
            {
              catalogItemId: 'extra_fish',
              catalogItemName: 'פילה דג נוסף',
              category: 'extras',
              quantity: 1,
              sourceText: 'עוד דג אחד',
              confidence: 0.99,
            },
          ],
        },
        paidExtras: [
          {
            catalogItemId: 'extra_fish',
            catalogItemName: 'פילה דג נוסף',
            quantity: 1,
            catalogPrice: 30,
            currency: 'USD',
            sourceText: 'עוד דג אחד',
            reason: 'This catalog item is marked as a paid extra.',
            confidence: 0.99,
            [field]: inventedValue,
          },
        ],
      });
      const fake = fakeOpenAI({ status: 'completed', output: [], output_parsed: malformed });
      const reviewer = createOpenAIOrderIntake({ client: fake.client, model: 'test-model' });

      const review = await reviewer({ message: 'עוד דג אחד', catalog });
      assert.equal(review.paidExtras[0].catalogPrice, 30);
      assert.equal(review.paidExtras[0].currency, 'USD');
      assert.equal(review.overallConfidence, 0.5);
      assert.equal(fake.calls.length, 1);
    });
  }

  await t.test('provider failure does not expose provider or customer text', async () => {
    const fake = fakeOpenAI(() => {
      throw new Error('API secret and customer text leaked here');
    });
    const reviewer = createOpenAIOrderIntake({ client: fake.client, model: 'test-model' });

    await assert.rejects(
      reviewer({ message: 'טקסט לקוח סודי', catalog }),
      (error) => {
        assert.equal(error.code, SERVICE_ERROR_CODES.PROVIDER_FAILURE);
        assert.doesNotMatch(error.message, /API secret|טקסט לקוח/);
        return true;
      }
    );
  });

  await t.test('provider timeout does not expose provider or customer text', async () => {
    const fake = fakeOpenAI(() => {
      throw new OpenAI.APIConnectionTimeoutError({
        message: 'Provider timed out while processing secret customer text',
      });
    });
    const reviewer = createOpenAIOrderIntake({ client: fake.client, model: 'test-model' });
    const handler = createOrderIntakeHandler({ reviewOrderIntake: reviewer });

    const response = await invokeHandler(handler, {
      message: 'טקסט לקוח סודי',
      catalog,
    });

    assert.equal(response.statusCode, 502);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(response.body, {
      error: {
        code: SERVICE_ERROR_CODES.PROVIDER_FAILURE,
        message: 'The order review service failed.',
      },
    });
    assert.doesNotMatch(
      JSON.stringify(response.body),
      /Provider timed out|secret customer|טקסט לקוח/
    );
  });
});

test('accepts an item with null quantity and requires operator review when none was stated', async () => {
  const providerReview = completeReview({
    draft: {
      items: [
        {
          catalogItemId: 'schnitzel',
          catalogItemName: 'שניצל',
          category: 'mains',
          quantity: null,
          sourceText: 'שניצל',
          confidence: 0.9,
        },
      ],
    },
    missingFields: [
      {
        field: 'item_quantity',
        sourceText: 'שניצל',
        reason: 'The customer did not state a quantity.',
      },
    ],
    warnings: [
      {
        code: 'quantity_missing',
        severity: 'warning',
        message: 'Confirm the schnitzel quantity before applying this draft.',
      },
    ],
  });
  const fake = fakeOpenAI({ status: 'completed', output: [], output_parsed: providerReview });
  const reviewer = createOpenAIOrderIntake({ client: fake.client, model: 'test-model' });

  const review = await reviewer({ message: 'שניצל בבקשה', catalog });

  assert.equal(review.draft.items[0].quantity, null);
  assert.equal(review.missingFields[0].field, 'item_quantity');
});

test('retries exactly once after an SDK structured parse failure and returns the valid retry', async () => {
  const calls = [];
  const client = {
    responses: {
      async parse(request) {
        calls.push(request);
        if (calls.length === 1) throw new SyntaxError('malformed provider JSON');
        return { status: 'completed', output: [], output_parsed: completeReview() };
      },
    },
  };
  const reviewer = createOpenAIOrderIntake({ client, model: 'test-model' });

  const review = await reviewer({ message: 'הזמנה לבדיקה', catalog });

  assert.equal(review.reviewOnly, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].max_output_tokens, 12_000);
  assert.equal(calls[1].max_output_tokens, 12_000);
  assert.match(calls[1].input[0].content, /minimal, schema-valid review/i);
});

test('retries exactly once after an incomplete response and never retries a schema-valid audit failure', async (t) => {
  await t.test('incomplete response', async () => {
    let callCount = 0;
    const fake = fakeOpenAI(() => {
      callCount += 1;
      if (callCount === 1) {
        return { status: 'incomplete', output: [], output_parsed: null };
      }
      return { status: 'completed', output: [], output_parsed: completeReview() };
    });
    const reviewer = createOpenAIOrderIntake({ client: fake.client, model: 'test-model' });

    await reviewer({ message: 'הזמנה לבדיקה', catalog });
    assert.equal(fake.calls.length, 2);
  });

  await t.test('strict-schema audit failure', async () => {
    const fake = fakeOpenAI({
      status: 'completed',
      output: [],
      output_parsed: { reviewOnly: true, draft: {} },
    });
    const reviewer = createOpenAIOrderIntake({ client: fake.client, model: 'test-model' });

    await assert.rejects(
      reviewer({ message: 'הזמנה', catalog }),
      (error) => {
        assert.equal(error.code, SERVICE_ERROR_CODES.INVALID_PROVIDER_OUTPUT);
        assert.equal(error.internalReason, 'schema_invalid');
        return true;
      }
    );
    assert.equal(fake.calls.length, 1);
  });
});

test('never retries provider transport failures or refusals', async (t) => {
  await t.test('transport failure', async () => {
    const fake = fakeOpenAI(() => {
      throw new OpenAI.APIConnectionTimeoutError({ message: 'private provider detail' });
    });
    const reviewer = createOpenAIOrderIntake({ client: fake.client, model: 'test-model' });

    await assert.rejects(
      reviewer({ message: 'טקסט לקוח סודי', catalog }),
      (error) => {
        assert.equal(error.code, SERVICE_ERROR_CODES.PROVIDER_FAILURE);
        assert.equal(error.internalReason, 'provider_request_failed');
        assert.doesNotMatch(error.message, /private|טקסט/);
        return true;
      }
    );
    assert.equal(fake.calls.length, 1);
  });

  await t.test('refusal', async () => {
    const fake = fakeOpenAI({
      status: 'completed',
      output_parsed: null,
      output: [
        { type: 'message', content: [{ type: 'refusal', refusal: 'private refusal' }] },
      ],
    });
    const reviewer = createOpenAIOrderIntake({ client: fake.client, model: 'test-model' });

    await assert.rejects(
      reviewer({ message: 'הזמנה', catalog }),
      (error) => error.code === SERVICE_ERROR_CODES.REFUSED
    );
    assert.equal(fake.calls.length, 1);
  });
});

test('hydrates catalog identity and price, nulls unsafe quantities, and forces fulfillment review', async () => {
  const providerReview = completeReview({
    draft: {
      fulfillmentMethod: 'delivery',
      items: [
        {
          catalogItemId: 'extra_fish',
          catalogItemName: 'Invented fish name',
          category: 'invented-category',
          quantity: 7,
          sourceText: 'עוד דג',
          confidence: 0.99,
        },
      ],
    },
    paidExtras: [
      {
        catalogItemId: 'extra_fish',
        catalogItemName: 'Invented fish name',
        quantity: 7,
        catalogPrice: 999,
        currency: 'AED',
        sourceText: 'עוד דג',
        reason: 'Provider supplied reason.',
        confidence: 0.99,
      },
    ],
  });
  const fake = fakeOpenAI({ status: 'completed', output: [], output_parsed: providerReview });
  const reviewer = createOpenAIOrderIntake({ client: fake.client, model: 'test-model' });

  const review = await reviewer({ message: 'משלוח עם עוד דג', catalog });

  assert.deepEqual(review.draft.items[0], {
    catalogItemId: 'extra_fish',
    catalogItemName: 'פילה דג נוסף',
    category: 'extras',
    quantity: null,
    sourceText: 'עוד דג',
    confidence: 0.99,
  });
  assert.equal(review.draft.fulfillmentMethod, 'unknown');
  assert.equal(review.paidExtras[0].catalogItemName, 'פילה דג נוסף');
  assert.equal(review.paidExtras[0].catalogPrice, 30);
  assert.equal(review.paidExtras[0].currency, 'USD');
  assert.equal(review.paidExtras[0].quantity, null);
  assert.equal(
    review.paidExtras[0].reason,
    'This authoritative catalog item is marked as a paid extra.'
  );
  assert.ok(review.missingFields.some((finding) => finding.field === 'item_quantity'));
  assert.ok(review.missingFields.some((finding) => finding.field === 'fulfillment_method'));
});

test('never turns unrelated grounded text and quantity into a paid catalog item', async () => {
  const sourceText = '3 סלטים בלי חריף';
  const providerReview = completeReview({
    draft: {
      items: [
        {
          catalogItemId: 'extra_fish',
          catalogItemName: 'פילה דג נוסף',
          category: 'extras',
          quantity: 3,
          sourceText,
          confidence: 0.99,
        },
      ],
    },
    paidExtras: [
      {
        catalogItemId: 'extra_fish',
        catalogItemName: 'פילה דג נוסף',
        quantity: 3,
        catalogPrice: 30,
        currency: 'USD',
        sourceText,
        reason: 'The provider proposed a paid fish extra.',
        confidence: 0.99,
      },
    ],
  });
  const fake = fakeOpenAI({ status: 'completed', output: [], output_parsed: providerReview });
  const reviewer = createOpenAIOrderIntake({ client: fake.client, model: 'test-model' });

  const review = await reviewer({ message: sourceText, catalog });

  assert.deepEqual(review.draft.items, []);
  assert.deepEqual(review.paidExtras, []);
  assert.deepEqual(review.unknownItems, [
    {
      sourceText,
      requestedQuantity: null,
      reason: 'The quoted customer wording does not identify the proposed catalog item.',
    },
  ]);
  assert.ok(review.warnings.some((warning) => warning.code === 'catalog_mismatch'));
  assert.equal(review.overallConfidence, 0.5);
  assert.equal(fake.calls.length, 1);
});

test('never attaches another dish quantity to a later paid catalog mention', async () => {
  const sourceText = '3 סלטים בלי חריף ועוד דג אחד';
  const providerReview = completeReview({
    draft: {
      items: [
        {
          catalogItemId: 'extra_fish',
          catalogItemName: 'פילה דג נוסף',
          category: 'extras',
          quantity: 3,
          sourceText,
          confidence: 0.99,
        },
      ],
    },
  });
  const fake = fakeOpenAI({ status: 'completed', output: [], output_parsed: providerReview });
  const reviewer = createOpenAIOrderIntake({ client: fake.client, model: 'test-model' });

  const review = await reviewer({ message: sourceText, catalog });

  assert.equal(review.draft.items.length, 1);
  assert.equal(review.draft.items[0].catalogItemId, 'extra_fish');
  assert.equal(review.draft.items[0].quantity, null);
  assert.equal(review.paidExtras[0].quantity, null);
  assert.ok(review.missingFields.some((finding) => finding.field === 'item_quantity'));
  assert.ok(review.warnings.some((warning) => warning.code === 'quantity_missing'));
});

test('never matches a paid catalog identity embedded inside an unrelated word', async () => {
  const sourceText = 'עניין אחד';
  const wineCatalog = [
    {
      id: 'wine',
      name: 'יין',
      category: 'extras',
      aliases: [],
      isPaidExtra: true,
      price: 5,
      currency: 'USD',
    },
  ];
  const providerReview = completeReview({
    draft: {
      items: [
        {
          catalogItemId: 'wine',
          catalogItemName: 'יין',
          category: 'extras',
          quantity: 1,
          sourceText,
          confidence: 0.99,
        },
      ],
    },
  });
  const fake = fakeOpenAI({ status: 'completed', output: [], output_parsed: providerReview });
  const reviewer = createOpenAIOrderIntake({ client: fake.client, model: 'test-model' });

  const review = await reviewer({ message: sourceText, catalog: wineCatalog });

  assert.deepEqual(review.draft.items, []);
  assert.deepEqual(review.paidExtras, []);
  assert.equal(review.unknownItems[0].sourceText, sourceText);
  assert.equal(review.unknownItems[0].requestedQuantity, null);
  assert.ok(review.warnings.some((warning) => warning.code === 'catalog_mismatch'));
});

test('duplicate catalog matches never silently combine quantities', async () => {
  const providerReview = completeReview({
    draft: {
      items: [
        {
          catalogItemId: 'schnitzel',
          catalogItemName: 'שניצל',
          category: 'mains',
          quantity: 2,
          sourceText: 'שני שניצל',
          confidence: 0.9,
        },
        {
          catalogItemId: 'schnitzel',
          catalogItemName: 'שניצל',
          category: 'mains',
          quantity: 3,
          sourceText: 'שלושה שניצל',
          confidence: 0.8,
        },
      ],
    },
  });
  const fake = fakeOpenAI({ status: 'completed', output: [], output_parsed: providerReview });
  const reviewer = createOpenAIOrderIntake({ client: fake.client, model: 'test-model' });

  const review = await reviewer({
    message: 'שני שניצל, רגע שלושה שניצל',
    catalog,
  });

  assert.equal(review.draft.items.length, 1);
  assert.equal(review.draft.items[0].quantity, null);
  assert.ok(review.ambiguities.some((finding) => finding.sourceText === 'שלושה שניצל'));
  assert.ok(review.warnings.some((warning) => warning.code === 'ambiguous_intent'));
});

test('sanitizer caps generated findings and returns a final strict-schema review', async () => {
  const ambiguityTexts = Array.from({ length: 50 }, (_, index) => `בחירה ${index + 1}`);
  const message = `${ambiguityTexts.join(', ')}, שני שניצל, שלושה שניצל`;
  const providerReview = completeReview({
    draft: {
      items: [
        {
          catalogItemId: 'schnitzel',
          catalogItemName: 'שניצל',
          category: 'mains',
          quantity: 2,
          sourceText: 'שני שניצל',
          confidence: 0.9,
        },
        {
          catalogItemId: 'schnitzel',
          catalogItemName: 'שניצל',
          category: 'mains',
          quantity: 3,
          sourceText: 'שלושה שניצל',
          confidence: 0.8,
        },
      ],
    },
    ambiguities: ambiguityTexts.map((sourceText) => ({
      sourceText,
      question: 'Provider question.',
      candidateCatalogItemIds: ['schnitzel', 'unknown-id'],
    })),
  });
  const fake = fakeOpenAI({ status: 'completed', output: [], output_parsed: providerReview });
  const reviewer = createOpenAIOrderIntake({ client: fake.client, model: 'test-model' });

  const review = await reviewer({ message, catalog });

  assert.equal(review.ambiguities.length, 50);
  assert.ok(
    review.ambiguities.every(
      (finding) => finding.question === "Confirm the customer's intended choice."
    )
  );
  assert.ok(
    review.ambiguities.every((finding) =>
      finding.candidateCatalogItemIds.every((id) => catalog.some((item) => item.id === id))
    )
  );
  assert.equal(review.draft.items[0].quantity, null);
  assert.equal(OrderIntakeReviewSchema.safeParse(review).success, true);
});

test('rejects missing AI configuration without constructing a provider request', async () => {
  const fake = fakeOpenAI({ status: 'completed', output: [], output_parsed: completeReview() });
  const reviewer = createOpenAIOrderIntake({ client: fake.client, env: {} });

  await assert.rejects(
    reviewer({ message: 'הזמנה', catalog }),
    (error) => {
      assert.equal(error.code, SERVICE_ERROR_CODES.NOT_CONFIGURED);
      assert.equal(error.statusCode, 503);
      return true;
    }
  );
  assert.equal(fake.calls.length, 0);
});

test('route is lazy at startup and returns a sanitized 503 when AI is not configured', async () => {
  assert.doesNotThrow(() => createOrderIntakeRouter({ env: {} }));
  const reviewer = createOpenAIOrderIntake({ env: {} });
  const handler = createOrderIntakeHandler({ reviewOrderIntake: reviewer });

  const response = await invokeHandler(handler, { message: 'טקסט לקוח סודי', catalog });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, {
    error: {
      code: 'ai_not_configured',
      message: 'Order review is temporarily unavailable.',
    },
  });
  assert.doesNotMatch(JSON.stringify(response.body), /טקסט לקוח|OPENAI|API key/i);
});

test('route returns review data only and performs zero persistence writes', async () => {
  const providerReview = completeReview({ overallConfidence: 0.93 });
  const fake = fakeOpenAI({ status: 'completed', output: [], output_parsed: providerReview });
  const reviewer = createOpenAIOrderIntake({
    client: fake.client,
    model: 'test-model',
    env: {},
  });
  const handler = createOrderIntakeHandler({ reviewOrderIntake: reviewer });
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
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error('Unexpected network persistence call.');
  };

  let response;
  try {
    response = await invokeHandler(
      handler,
      { message: 'הזמנה לבדיקה', catalog },
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
  }

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(response.body, { review: providerReview });
  assert.deepEqual(Object.keys(response.body), ['review']);
  assert.deepEqual(persistenceCalls, []);
  assert.equal(fetchCalls, 0);
  assert.equal(fake.calls.length, 1);

  const router = createOrderIntakeRouter({ reviewOrderIntake: reviewer });
  assert.equal(router.stack.length, 1);
  assert.equal(router.stack[0].route.methods.post, true);
  assert.equal(router.stack[0].route.stack.length, 2);
});

test('route validates message and catalog size before calling OpenAI', async () => {
  const fake = fakeOpenAI({ status: 'completed', output: [], output_parsed: completeReview() });
  const reviewer = createOpenAIOrderIntake({
    client: fake.client,
    model: 'test-model',
    env: {},
  });
  const handler = createOrderIntakeHandler({ reviewOrderIntake: reviewer });

  const oversizedMessage = await invokeHandler(handler, {
    message: 'א'.repeat(MAX_MESSAGE_LENGTH + 1),
    catalog,
  });
  assert.equal(oversizedMessage.statusCode, 413);
  assert.equal(oversizedMessage.body.error.code, 'request_too_large');

  const oversizedCatalog = Array.from({ length: 201 }, (_, index) => ({
    id: `item-${index}`,
    name: `Item ${index}`,
    category: 'test',
  }));
  const tooManyItems = await invokeHandler(handler, {
    message: 'הזמנה',
    catalog: oversizedCatalog,
  });
  assert.equal(tooManyItems.statusCode, 413);
  assert.equal(tooManyItems.body.error.code, 'request_too_large');

  const invalidCatalog = await invokeHandler(handler, {
    message: 'הזמנה',
    catalog: [catalog[0], { ...catalog[1], id: catalog[0].id }],
  });
  assert.equal(invalidCatalog.statusCode, 400);
  assert.equal(invalidCatalog.body.error.code, 'invalid_request');

  const missingCatalog = await invokeHandler(handler, { message: 'הזמנה' });
  assert.equal(missingCatalog.statusCode, 400);
  assert.equal(missingCatalog.body.error.code, 'invalid_request');
  assert.equal(fake.calls.length, 0);
});

test('rate limiter blocks request 31 without invoking OpenAI or persistence', async () => {
  const rateLimiter = createOrderIntakeRateLimiter();
  let downstreamCalls = 0;

  assert.equal(Object.isFrozen(ORDER_INTAKE_RATE_LIMIT), true);
  assert.deepEqual(ORDER_INTAKE_RATE_LIMIT, {
    limit: 30,
    windowMs: 15 * 60 * 1000,
  });

  for (let requestNumber = 1; requestNumber <= ORDER_INTAKE_RATE_LIMIT.limit; requestNumber += 1) {
    const response = await invokeRateLimiter(rateLimiter);
    assert.equal(response.nextCalled, true);
    assert.equal(response.statusCode, 200);
    downstreamCalls += 1;
  }

  const blocked = await invokeRateLimiter(rateLimiter);
  assert.equal(blocked.nextCalled, false);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.headers.get('cache-control'), 'no-store');
  assert.deepEqual(blocked.body, {
    error: {
      code: 'ai_rate_limited',
      message: 'Too many order review requests. Please try again later.',
    },
  });
  assert.equal(downstreamCalls, ORDER_INTAKE_RATE_LIMIT.limit);
});

test('runtime order-intake modules contain no database or state persistence path', () => {
  const runtimeFiles = [
    'order-intake-schema.js',
    'order-intake-prompt.js',
    'openai-order-intake.js',
    'order-intake-route.js',
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
    assert.doesNotMatch(source, /req\.(?:app|socket)/);
  }
});

test('structured review schema is strict and rejects missing or invented fields', () => {
  const valid = completeReview();
  assert.equal(OrderIntakeReviewSchema.safeParse(valid).success, true);
  assert.equal(OrderIntakeReviewSchema.safeParse({ ...valid, saved: true }).success, false);
  assert.equal(
    OrderIntakeReviewSchema.safeParse({
      ...valid,
      draft: {
        ...valid.draft,
        items: [
          {
            catalogItemId: 'couscous',
            catalogItemName: 'קוסקוס',
            category: 'sides',
            quantity: 0,
            sourceText: 'קוסקוס',
            confidence: 0.8,
          },
        ],
      },
    }).success,
    false
  );
});
