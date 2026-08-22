'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createMeyTools } = require('../server/telegram/mey-tools');
const { createMeyReadTools, WITHHELD_ORDER_FIELDS } = require('../server/telegram/mey-read-tools');
const {
  customerLedger,
  dishDemand,
  financialSummary,
  fullOrder,
  orderMoney,
  parseMoneyMinorUnits,
} = require('../server/domain/business-queries');

const silentLogger = { error() {} };

function stateFixture() {
  return {
    settings: { orderingOpen: true },
    menu: { extras: [{ name: 'מארז הבדלה', price: 20 }] },
    expenses: {
      '2026-08-10': [{ date: '2026-08-10', label: 'קניות שוק', category: 'חומרי גלם', amount: 300 }],
      '2026-07-01': [{ date: '2026-07-01', label: 'גז', amount: '50$' }],
    },
    recipes: [
      {
        itemId: 'dish-matbucha',
        name: 'מטבוחה פיקנטית',
        yield: 10,
        ingredients: [
          { ingredientId: 'prod-tomato', ingredientName: 'עגבניות', quantity: '5', unit: 'ק"ג' },
          { ingredientId: 'prod-ghost', ingredientName: 'תבלין נעלם', quantity: '10', unit: 'גרם' },
        ],
      },
    ],
    productLibrary: [
      {
        id: 'prod-tomato',
        name: 'עגבניות',
        category: 'vegetable',
        kosherOnly: false,
        supplierOverride: null,
        insignificant: false,
        listings: {
          nesto: { packSize: '1', packUnit: 'ק"ג', packPriceMinorUnits: 400, updatedAt: 1, manualPrice: null },
        },
      },
    ],
    orders: [
      {
        id: 'o-1',
        date: '2026-08-14',
        name: 'רותי לוי',
        phone: '+971 50 111 2233',
        status: 'נמסרה',
        meals: 2,
        challot: 4,
        salads: { 'מטבוחה פיקנטית': { o: 2, p: 1 }, 'טחינה': { o: 1, p: 0 } },
        mains: { 'קציצות בשר ברוטב אדום עשיר': 2 },
        extras: { 'מארז הבדלה': { q: 1, note: 'לאריזה בנפרד' } },
        lunch: { kubeh: { q: 1, v: '', sides: {}, addon: 0 } },
        total: '520',
        deposit: '200',
        paid: 'לא',
        payMethod: 'העברה',
        meyToken: 'SECRET-COURIER-TOKEN',
      },
      {
        id: 'o-2',
        date: '2026-08-21',
        name: 'רותי לוי',
        phone: '0501112233',
        status: 'נמסרה',
        meals: 1,
        salads: { 'טחינה': { o: 1, p: 0 } },
        total: '$230',
        paid: 'כן',
      },
      {
        id: 'o-3',
        date: '2026-08-21',
        name: 'דנה כהן',
        phone: '971509998877',
        status: 'בוטלה',
        total: '400',
      },
      {
        id: 'o-4',
        date: '2026-08-22',
        name: 'שרה מ',
        phone: '0521234567',
        status: 'חדשה',
        meals: 1,
        mains: { 'קציצות בשר ברוטב אדום עשיר': 1 },
        total: 'לסכם מול לין',
      },
    ],
  };
}

function fakeRepository(initial) {
  let saved = 0;
  return {
    async loadState() {
      return { data: structuredClone(initial), revision: 1, hash: 'h' };
    },
    async saveState() {
      saved += 1;
      return { ok: true };
    },
    _saveCount: () => saved,
  };
}

function tools() {
  return createMeyTools({ repository: fakeRepository(stateFixture()), logger: silentLogger });
}

test('money Lin typed by hand parses in every shape she uses, and junk stays null', () => {
  assert.equal(parseMoneyMinorUnits('520'), 52_000);
  assert.equal(parseMoneyMinorUnits('$230'), 23_000);
  assert.equal(parseMoneyMinorUnits('740$'), 74_000);
  assert.equal(parseMoneyMinorUnits('1,200.50'), 120_050);
  assert.equal(parseMoneyMinorUnits(390), 39_000);
  assert.equal(parseMoneyMinorUnits('לסכם מול לין'), null);
  assert.equal(parseMoneyMinorUnits(''), null);
  assert.equal(parseMoneyMinorUnits(-5), null);
});

test('an order that is not fully paid reports the deposit and what is still open', () => {
  const [order] = stateFixture().orders;
  assert.deepEqual(orderMoney(order), {
    totalMinorUnits: 52_000,
    totalUnreadable: false,
    depositMinorUnits: 20_000,
    collectedMinorUnits: 20_000,
    outstandingMinorUnits: 32_000,
    paid: 'לא',
    fullyPaid: false,
    payMethod: 'העברה',
    invoiceNumber: null,
  });
});

test('a full order carries every dish, gift portions and notes included', () => {
  const order = fullOrder(stateFixture().orders[0]);
  const byName = Object.fromEntries(order.dishes.map((dish) => [dish.name, dish]));

  assert.equal(order.coupleMeals, 2);
  assert.equal(order.challahs, 4);
  // A 'פינוק' portion is still a portion cooked, so it counts in the quantity
  // and is also called out on its own.
  assert.equal(byName['מטבוחה פיקנטית'].quantity, 3);
  assert.equal(byName['מטבוחה פיקנטית'].giftPortions, 1);
  assert.equal(byName['קציצות בשר ברוטב אדום עשיר'].quantity, 2);
  assert.equal(byName['מארז הבדלה'].note, 'לאריזה בנפרד');
  assert.equal(byName.kubeh.course, 'תפריט צהריים');
});

test('the courier token never leaves the system through a read tool', async () => {
  assert.ok(WITHHELD_ORDER_FIELDS.has('meyToken'));
  const mey = tools();
  for (const [name, args] of [
    ['get_order_full', { orderId: 'o-1' }],
    ['get_customer', { query: 'רותי' }],
    ['read_state', { path: 'orders' }],
    ['search_orders', { query: 'רותי' }],
  ]) {
    const result = await mey.execute(name, args);
    assert.ok(
      !JSON.stringify(result).includes('SECRET-COURIER-TOKEN'),
      `${name} leaked the courier token`,
    );
  }
});

test('one diner is one ledger even when the phone is written differently', () => {
  const ledger = customerLedger(stateFixture());
  const ruti = ledger.find((customer) => customer.name === 'רותי לוי');
  assert.equal(ruti.orderCount, 2, '+971 50 111 2233 and 0501112233 are the same person');
  assert.equal(ruti.totalBilledMinorUnits, 75_000);
  // 200 deposit on the open order + 230 fully paid.
  assert.equal(ruti.totalCollectedMinorUnits, 43_000);
  assert.equal(ruti.outstandingMinorUnits, 32_000);
  assert.equal(ruti.firstOrderDate, '2026-08-14');
  assert.equal(ruti.lastOrderDate, '2026-08-21');

  const dana = ledger.find((customer) => customer.name === 'דנה כהן');
  assert.equal(dana.orderCount, 0, 'a cancelled order is history, not revenue');
  assert.equal(dana.cancelledCount, 1);
  assert.equal(dana.totalCollectedMinorUnits, 0);
});

test('an unreadable total is reported, never counted as zero revenue in silence', () => {
  const summary = financialSummary(stateFixture());
  assert.equal(summary.unreadableTotals, 1);
  assert.equal(summary.cancelledCount, 1);
  assert.equal(summary.billedMinorUnits, 75_000);
  assert.equal(summary.collectedMinorUnits, 43_000);
  assert.equal(summary.outstandingMinorUnits, 32_000);
  assert.equal(summary.expensesMinorUnits, 35_000);
  assert.equal(summary.netMinorUnits, 8_000);
  assert.deepEqual(summary.unpaidOrders.map((row) => row.id), ['o-1']);
});

test('a date range narrows the money and the dishes together', () => {
  const august = financialSummary(stateFixture(), { fromDate: '2026-08-01', toDate: '2026-08-31' });
  assert.equal(august.expensesMinorUnits, 30_000, 'the July gas bill is out of range');

  const demand = dishDemand(stateFixture(), { fromDate: '2026-08-21', toDate: '2026-08-31' });
  const byName = Object.fromEntries(demand.dishes.map((dish) => [dish.name, dish.quantity]));
  assert.equal(demand.orderCount, 2, 'the cancelled order is excluded');
  assert.equal(byName['טחינה'], 1);
  assert.equal(byName['מטבוחה פיקנטית'], undefined, 'that order is before the window');
});

test('a dish cost names the ingredients it could not price instead of under-reporting', async () => {
  const result = await tools().execute('get_dish_cost', { dishName: 'מטבוחה' });
  assert.equal(result.count, 1);
  const [dish] = result.dishes;
  assert.equal(dish.complete, false);
  assert.equal(dish.batchCostMinorUnits, 2_000);
  assert.equal(dish.perPortionCostMinorUnits, 200);
  assert.deepEqual(dish.warnings.map((warning) => warning.code), ['MISSING_PRODUCT']);
});

test('a dish with no recipe is reported as unpriceable, never as free', async () => {
  const result = await tools().execute('get_dish_cost', { dishName: 'מנה שאין לה מתכון' });
  assert.equal(result.count, 0);
  assert.match(result.note, /אין מתכון/u);
});

test('read_state reaches any corner of the state and guides when the path is wrong', async () => {
  const mey = tools();
  const root = await mey.execute('read_state', { path: '' });
  assert.equal(root.shape.type, 'object');
  assert.ok(root.shape.keys.includes('orders'));

  const nested = await mey.execute('read_state', { path: 'menu.extras.0' });
  assert.deepEqual(nested.value, { name: 'מארז הבדלה', price: 20 });

  const wrong = await mey.execute('read_state', { path: 'settings.nope' });
  assert.match(wrong.error, /nope/u);
  assert.ok(wrong.availableKeys.includes('orderingOpen'), 'a wrong path says what IS there');
});

test('a search result carries the dishes, so "what did she order" is answerable', async () => {
  const result = await tools().execute('search_orders', { query: 'רותי' });
  assert.equal(result.count, 2);
  const first = result.orders.find((order) => order.id === 'o-1');
  assert.ok(first.dishes.some((dish) => dish.name === 'מטבוחה פיקנטית' && dish.quantity === 3));
  assert.equal(first.outstandingMinorUnits, 32_000);
});

test('every read tool is exposed, and none of them can write', async () => {
  const repository = fakeRepository(stateFixture());
  const mey = createMeyTools({ repository, logger: silentLogger });
  const readTools = createMeyReadTools({ repository });

  const exposed = new Set(mey.definitions.map((definition) => definition.name));
  for (const name of readTools.names) {
    assert.ok(exposed.has(name), `${name} is not exposed to מיי`);
  }
  // Every read tool runs, and after all of them the store was never written.
  for (const [name, args] of [
    ['get_order_full', { orderId: 'o-1' }],
    ['get_customer', { query: '0501112233' }],
    ['list_customers', { limit: 5 }],
    ['get_dish_demand', { fromDate: null, toDate: null }],
    ['get_dish_cost', { dishName: null }],
    ['get_financial_summary', { fromDate: null, toDate: null }],
    ['read_state', { path: 'settings' }],
  ]) {
    const result = await mey.execute(name, args);
    assert.ok(result && typeof result === 'object', `${name} returned nothing`);
    assert.equal(result.error, undefined, `${name} failed: ${result.error}`);
  }
  assert.equal(repository._saveCount(), 0, 'a read tool wrote to the store');
});

test('the write freeze silences writes but never the answers', async () => {
  const frozen = stateFixture();
  frozen.settings.meyWritesFrozen = true;
  const mey = createMeyTools({ repository: fakeRepository(frozen), logger: silentLogger });

  const write = await mey.execute('set_ordering_open', { open: false });
  assert.match(write.error, /הקפאה/u);

  const read = await mey.execute('get_financial_summary', { fromDate: null, toDate: null });
  assert.equal(read.error, undefined);
  assert.equal(read.collectedMinorUnits, 43_000);
});
