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

test('buildIntakeCatalog carries the weekday lunch menu so a kubbeh order can be priced', () => {
  const { items, priceById, lunchTargetById, liveItemCount } = buildIntakeCatalog(menuState());
  const kubeh = items.find((item) => item.id === 'lunch:2');
  assert.equal(kubeh.name, 'מנת קובה סלק ביתית');
  assert.equal(kubeh.category, 'lunch');
  assert.equal(kubeh.price, 35);
  assert.ok(kubeh.aliases.includes('קובה'), 'the word a customer actually types must reach the catalog');
  assert.equal(priceById.get('lunch:2'), 35);
  assert.deepEqual(lunchTargetById.get('lunch:2'), { key: 'kubeh', variantKey: '' });

  const familyPlate = items.find((item) => item.id === 'lunch:3:2');
  assert.equal(familyPlate.name, 'שניצל בצלחת (משפחתית — כולל 2 תוספות)');
  assert.equal(familyPlate.price, 145);
  assert.deepEqual(lunchTargetById.get('lunch:3:2'), { key: 'schnitzel-plate', variantKey: 'family' });

  const mafrum = items.find((item) => item.id === 'lunch-addon:4');
  assert.equal(mafrum.category, 'lunch_addon');
  assert.equal(mafrum.price, 20);
  // The lunch fallback must never make an empty menu look loaded.
  assert.ok(liveItemCount >= 5);
  assert.equal(buildIntakeCatalog({ menu: {} }).liveItemCount, 0);
});

test('a stored lunch price and name override the built-in weekday fallback', () => {
  const state = menuState();
  state.menu.lunch = [
    { key: 'kubeh', name: 'מנת קובה סלק — מהדורת חורף', price: 39 },
    { key: 'schnitzel-plate', variants: [{ k: 'single', price: 38, sidePrice: 15 }] },
  ];
  const { items } = buildIntakeCatalog(state);
  const kubeh = items.find((item) => item.id === 'lunch:2');
  assert.equal(kubeh.name, 'מנת קובה סלק — מהדורת חורף');
  assert.equal(kubeh.price, 39);
  const singlePlate = items.find((item) => item.id === 'lunch:3:0');
  assert.equal(singlePlate.price, 38);
  assert.equal(singlePlate.name, 'שניצל בצלחת (אישית)');
});

test('a lunch dish named with no digit is saved as one portion, not dropped', async () => {
  const repository = fakeRepository(menuState());
  const intake = createWhatsAppIntake({
    repository,
    reviewOrderIntake: async () => reviewFixture({
      draft: {
        ...reviewFixture().draft,
        items: [
          {
            catalogItemId: 'lunch:2',
            catalogItemName: 'מנת קובה סלק ביתית',
            category: 'lunch',
            quantity: null,
            sourceText: 'קובה',
            confidence: 0.9,
          },
          {
            catalogItemId: 'lunch-addon:4',
            catalogItemName: 'מנת מפרום ביתי',
            category: 'lunch_addon',
            quantity: null,
            sourceText: 'מפרום',
            confidence: 0.8,
          },
          {
            catalogItemId: 'lunch:4',
            catalogItemName: 'ספיישל קוסקוס',
            category: 'lunch',
            quantity: 2,
            sourceText: '2 קוסקוס',
            confidence: 0.9,
          },
        ],
      },
    }),
    logger: silentLogger,
  });

  const result = await intake.intake('היי, אני רוצה קובה ו2 קוסקוס עם מפרום');
  assert.equal(result.ok, true);
  const saved = repository._current().orders[0];
  assert.deepEqual(saved.lunch.kubeh, { q: 1, v: '', sides: {}, addon: 0 });
  assert.deepEqual(saved.lunch.couscous, { q: 2, v: '', sides: {}, addon: 1 });
  // The dish is a real order line now, not just prose in the notes.
  assert.match(saved.notes, /מנת קובה סלק ביתית x1/u);
  // Naming a weekday plate must not invent a Shabbat couple meal.
  assert.equal(saved.meals, 0);
});

test('a lunch add-on is dropped when its dish was never ordered', async () => {
  const repository = fakeRepository(menuState());
  const intake = createWhatsAppIntake({
    repository,
    reviewOrderIntake: async () => reviewFixture({
      draft: {
        ...reviewFixture().draft,
        items: [
          {
            catalogItemId: 'lunch-addon:4',
            catalogItemName: 'מנת מפרום ביתי',
            category: 'lunch_addon',
            quantity: null,
            sourceText: 'מפרום',
            confidence: 0.8,
          },
        ],
      },
    }),
    logger: silentLogger,
  });

  assert.equal((await intake.intake('אפשר מפרום?')).ok, true);
  assert.deepEqual(repository._current().orders[0].lunch, {});
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

// Regression: מיי used to save only a bare order shell (name/phone/date)
// with the dish list buried in free-text notes, so every order she took
// still needed a human to rebuild it item by item in the panel. She now
// resolves quantities the same way the panel does — a couple-meal count
// with no explicit digit still fills in fish/salad/dessert defaults from
// the package rules, exactly matching what the panel would produce from
// the identical message (see web's package-rules.test.ts / order-editor.test.ts).
test('resolves a couple-meal order into the same structured fields the panel would build', async () => {
  const coupleMealState = {
    orders: [],
    settings: {},
    menu: {
      couplePrice: 230,
      challahPrice: 10,
      salads: ['כרוב לבן קלאסי', 'מטבוחה פיקנטית'],
      firsts: ['פילה דג ברוטב מרוקאי'],
      mains: ['קציצות בשר ברוטב אדום עשיר'],
      sides: ['אורז לבן'],
      desserts: ['סופלה שוקולד', 'סוכריות בקלוואה'],
      extras: [{ name: 'מגש בשרים', price: 120 }],
    },
  };
  const repository = fakeRepository(coupleMealState);
  const intake = createWhatsAppIntake({
    repository,
    reviewOrderIntake: async ({ message, catalog }) => {
      const byName = new Map(catalog.map((item) => [item.name, item]));
      const item = (name, quantity, sourceText) => ({
        catalogItemId: byName.get(name).id,
        catalogItemName: name,
        category: byName.get(name).category,
        quantity,
        sourceText,
        confidence: 0.9,
      });
      return reviewFixture({
        draft: {
          customerName: 'לקוחה מהוואטסאפ',
          customerPhone: null,
          serviceDate: null,
          serviceTime: null,
          fulfillmentMethod: 'unknown',
          deliveryLocation: null,
          items: [
            item('ארוחה זוגית', 2, 'ל 2 זוגות'),
            item('פילה דג ברוטב מרוקאי', null, 'דגים מרוקאים'),
            item('כרוב לבן קלאסי', null, 'כרוב לבן'),
            item('מטבוחה פיקנטית', null, 'מטבוחה'),
            item('קציצות בשר ברוטב אדום עשיר', null, 'קציצות ברוטב אדום'),
            item('סופלה שוקולד', null, 'סופלה שוקולד'),
          ],
          notes: [],
        },
        unknownItems: [],
        missingFields: [],
      });
    },
    logger: silentLogger,
  });

  const result = await intake.intake('ל 2 זוגות: דגים מרוקאים, כרוב לבן, מטבוחה, קציצות ברוטב אדום, סופלה שוקולד');
  assert.equal(result.ok, true);

  const saved = repository._current().orders[0];
  assert.equal(saved.meals, 2);
  // 2 fish units per meal x 2 meals = 4, per package-rules.js — never a
  // private "x2" here.
  assert.equal(saved.firsts['פילה דג ברוטב מרוקאי'], 4);
  assert.deepEqual(saved.salads['כרוב לבן קלאסי'], { o: 1, p: 0 });
  assert.deepEqual(saved.salads['מטבוחה פיקנטית'], { o: 1, p: 0 });
  assert.equal(saved.mains['קציצות בשר ברוטב אדום עשיר'], 1);
  // 2 dessert half-units per meal x 2 meals = 4 half-units; a soufflé is
  // one half-unit, so 4 soufflés.
  assert.equal(saved.desserts['סופלה שוקולד'], 4);
  assert.match(saved.notes, /פילה דג ברוטב מרוקאי x4/u);
  assert.match(saved.notes, /סופלה שוקולד x4/u);
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
