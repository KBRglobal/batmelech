'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildIntakeCatalog,
  createWhatsAppIntake,
  isoDateFrom,
} = require('../server/telegram/whatsapp-intake');
const { AUDIT_LOG_KEY } = require('../server/telegram/mey-audited-actions');

function fakeRepository(initialState) {
  let state = initialState;
  let revision = 1;
  return {
    async loadState() {
      return { data: structuredClone(state), revision, hash: 'h' };
    },
    async saveState({ localState }) {
      state = structuredClone(localState);
      revision += 1;
      return { ok: true };
    },
    _current: () => state,
  };
}

const silentLogger = { error() {} };

function menuState() {
  return {
    orders: [],
    settings: {},
    menu: {
      couplePrice: 230,
      challahPrice: 10,
      salads: ['סלט חצילים'],
      firsts: ['פילה דג ברוטב מרוקאי'],
      mains: ['עוף בתנור'],
      sides: ['אורז'],
      desserts: ['עוגת שוקולד'],
      extras: [{ name: 'מגש בשרים', price: 120 }],
    },
  };
}

function reviewFixture(overrides = {}) {
  return {
    reviewOnly: true,
    draft: {
      customerName: 'David Cohen',
      customerPhone: '+971501234567',
      serviceDate: '22.8',
      serviceTime: '15:00',
      fulfillmentMethod: 'unknown',
      deliveryLocation: 'Atlantis The Palm',
      items: [
        {
          catalogItemId: 'selection:challahs',
          catalogItemName: 'חלות',
          category: 'challahs',
          quantity: 2,
          sourceText: '2 חלות',
          confidence: 0.95,
        },
      ],
      notes: [],
    },
    corrections: [],
    ambiguities: [],
    paidExtras: [],
    unknownItems: [{ sourceText: 'משהו מתוק לילדים', requestedQuantity: null, reason: 'no match' }],
    missingFields: [{ field: 'fulfillment_method', sourceText: null, reason: 'must confirm' }],
    warnings: [],
    overallConfidence: 0.8,
    ...overrides,
  };
}

test('buildIntakeCatalog projects the live menu with the panel id scheme', () => {
  const { items, priceById } = buildIntakeCatalog(menuState());
  const ids = items.map((item) => item.id);
  assert.ok(ids.includes('meal:couple'));
  assert.ok(ids.includes('selection:challahs'));
  assert.ok(ids.includes('salad:0'));
  assert.ok(ids.includes('extra:0'));
  const extra = items.find((item) => item.id === 'extra:0');
  assert.equal(extra.isPaidExtra, true);
  assert.equal(extra.price, 120);
  assert.equal(priceById.get('extra:0'), 120);
});

test('isoDateFrom parses customer date formats and rejects junk', () => {
  assert.equal(isoDateFrom('2026-08-22'), '2026-08-22');
  assert.equal(isoDateFrom('22.8.2026'), '2026-08-22');
  assert.equal(isoDateFrom('22/8/26'), '2026-08-22');
  assert.equal(isoDateFrom('friday'), null);
  assert.equal(isoDateFrom('45.13'), null);
  assert.equal(isoDateFrom(null), null);
});

test('intake saves a reviewable order, records it in the audit log, and returns a reply draft', async () => {
  const repository = fakeRepository(menuState());
  const intake = createWhatsAppIntake({
    repository,
    reviewOrderIntake: async ({ message, catalog }) => {
      assert.match(message, /David/u);
      assert.ok(catalog.length >= 5);
      return reviewFixture();
    },
    draftOrderReply: async ({ conversation, summary, missing }) => {
      assert.ok(conversation.length > 0);
      assert.equal(summary.lines[0].name, 'חלות');
      assert.ok(missing.includes('משלוח או איסוף'));
      return 'Hi David! 2 challahs noted. Delivery or pickup?';
    },
    logger: silentLogger,
  });

  const result = await intake.intake('David Cohen: אפשר 2 חלות ל-22.8 ב-15:00, מלון Atlantis The Palm');
  assert.equal(result.ok, true);
  assert.match(result.orderUrl, /\/admin\/orders\/mey-.*\/edit$/u);
  assert.equal(result.replyDraft, 'Hi David! 2 challahs noted. Delivery or pickup?');

  const saved = repository._current().orders[0];
  assert.equal(saved.status, 'חדשה');
  assert.equal(saved.source, 'mey-whatsapp');
  assert.equal(saved.name, 'David Cohen');
  assert.equal(saved.date, '2026-08-22');
  assert.equal(saved.time, '15:00');
  assert.equal(saved.address, 'Atlantis The Palm');
  assert.equal(saved.total, 0);
  assert.match(saved.notes, /חלות x2/u);
  assert.match(saved.notes, /משהו מתוק לילדים/u);
  assert.match(saved.notes, /משלוח או איסוף/u);
  assert.match(saved.intakeConversation, /David Cohen/u);

  const audit = repository._current().settings[AUDIT_LOG_KEY];
  assert.equal(audit.length, 1);
  assert.equal(audit[0].tool, 'create_order');
  assert.equal(audit[0].undo.orderId, saved.id);
});

test('intake respects the emergency freeze and reports pipeline failures', async () => {
  const frozenRepository = fakeRepository({ ...menuState(), settings: { meyWritesFrozen: true } });
  const intake = createWhatsAppIntake({
    repository: frozenRepository,
    reviewOrderIntake: async () => reviewFixture(),
    logger: silentLogger,
  });
  assert.deepEqual(await intake.intake('הודעה'), { ok: false, error: 'frozen' });

  const emptyMenu = fakeRepository({ orders: [], settings: {}, menu: {} });
  const noMenu = createWhatsAppIntake({
    repository: emptyMenu,
    reviewOrderIntake: async () => reviewFixture(),
    logger: silentLogger,
  });
  assert.equal((await noMenu.intake('הודעה')).error, 'menu_unavailable');

  const failing = createWhatsAppIntake({
    repository: fakeRepository(menuState()),
    reviewOrderIntake: async () => {
      throw new Error('provider down');
    },
    logger: silentLogger,
  });
  assert.equal((await failing.intake('הודעה')).error, 'review_failed');

  const empty = createWhatsAppIntake({
    repository: fakeRepository(menuState()),
    reviewOrderIntake: async () => reviewFixture(),
    logger: silentLogger,
  });
  assert.equal((await empty.intake('   ')).error, 'empty');
});

test('a failed reply draft never blocks the saved order', async () => {
  const repository = fakeRepository(menuState());
  const intake = createWhatsAppIntake({
    repository,
    reviewOrderIntake: async () => reviewFixture(),
    draftOrderReply: async () => {
      throw new Error('reply provider down');
    },
    logger: silentLogger,
  });
  const result = await intake.intake('הודעה מלקוח');
  assert.equal(result.ok, true);
  assert.equal(result.replyDraft, null);
  assert.equal(repository._current().orders.length, 1);
});
