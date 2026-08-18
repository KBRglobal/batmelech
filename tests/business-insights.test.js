'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  aggregateDishQuantities,
  dishQuantity,
  ordersInRange,
  parseOrderTotal,
  splitNewAndReturning,
  summarizeFridayPrep,
  summarizeWeek,
  topDishes,
  upcomingFridayFrom,
  weekdayOf,
  weeklyWindowFor,
} = require('../server/telegram/business-insights');
const { prepForecast, weeklyBusinessDigest } = require('../server/telegram/delivery-messages');

// 2026-08-16 is a Sunday, so the week it reports on is 09/08 (Sun) - 15/08 (Sat).
const SUNDAY = '2026-08-16';
const WEDNESDAY = '2026-08-19';
const FRIDAY = '2026-08-21';

function order(overrides) {
  return { id: 'o1', date: '2026-08-10', name: 'רותי', phone: '050-1234567', total: '390', ...overrides };
}

test('the money parser reads what Lin actually types and refuses what it cannot', () => {
  assert.equal(parseOrderTotal('390'), 390);
  assert.equal(parseOrderTotal('740$'), 740);
  assert.equal(parseOrderTotal('$740'), 740);
  assert.equal(parseOrderTotal(' 1,200 '), 1200);
  assert.equal(parseOrderTotal('1200.50'), 1200.5);
  assert.equal(parseOrderTotal(390), 390);

  // Unreadable is null, never a guessed zero — the digest counts these apart.
  for (const junk of ['שילמה במזומן', '', '   ', 'abc', '-50', '12.345', null, undefined, {}, NaN, -1]) {
    assert.equal(parseOrderTotal(junk), null, `expected ${JSON.stringify(junk)} to be unreadable`);
  }
});

test('a dish quantity survives every shape the state has ever stored', () => {
  assert.equal(dishQuantity(4), 4);          // firsts/mains/sides/desserts
  assert.equal(dishQuantity('4'), 4);        // hand-edited blobs keep strings
  assert.equal(dishQuantity({ q: 3 }), 3);   // extras
  assert.equal(dishQuantity({ o: 2, p: 1 }), 3); // salads: ordered + פינוק both cooked
  assert.equal(dishQuantity({ ordered: 2, gift: 1 }), 3);
  assert.equal(dishQuantity({ o: 2 }), 2);

  for (const junk of [null, undefined, 'לא', {}, [], -1, 1.5, { q: 'x' }]) {
    assert.equal(dishQuantity(junk), 0, `expected ${JSON.stringify(junk)} to count as nothing`);
  }
});

test('aggregation sums one dish across courses, orders and shapes', () => {
  const orders = [
    order({
      salads: { 'סלט חצילים': { o: 2, p: 1 }, 'טחינה': { o: 1, p: 0 } },
      firsts: { 'מרק': 2 },
      mains: { 'חזה עוף': 3 },
      extras: { 'חלה': { q: 2, note: 'בלי שומשום' } },
    }),
    order({
      id: 'o2',
      salads: { 'סלט חצילים': { o: 4, p: 0 } },
      mains: { 'חזה עוף': '1' },
      desserts: { 'עוגת שוקולד': 5 },
      sides: { 'אורז': 0 }, // a zero never becomes a line
    }),
  ];

  const aggregate = aggregateDishQuantities(orders);
  const byLabel = Object.fromEntries(aggregate.courses.map((course) => [course.key, course.dishes]));

  assert.deepEqual(byLabel.salads, [
    { name: 'סלט חצילים', quantity: 7 },
    { name: 'טחינה', quantity: 1 },
  ]);
  assert.deepEqual(byLabel.mains, [{ name: 'חזה עוף', quantity: 4 }]);
  assert.deepEqual(byLabel.extras, [{ name: 'חלה', quantity: 2 }]);
  assert.equal('sides' in byLabel, false); // every side was zero, so no empty block

  assert.deepEqual(topDishes(orders, 3), [
    { name: 'סלט חצילים', quantity: 7 },
    { name: 'עוגת שוקולד', quantity: 5 },
    { name: 'חזה עוף', quantity: 4 },
  ]);
});

test('aggregation never throws on a malformed order', () => {
  const aggregate = aggregateDishQuantities([null, 'nope', {}, { salads: 'broken' }, { mains: { '': 5 } }]);
  assert.deepEqual(aggregate.courses, []);
  assert.deepEqual(aggregate.all, []);
});

test('the window is Sunday-to-Saturday ending yesterday, and weekdays read Dubai days', () => {
  assert.deepEqual(weeklyWindowFor(SUNDAY), { from: '2026-08-09', to: '2026-08-15' });
  assert.equal(weekdayOf(SUNDAY), 0);
  assert.equal(weekdayOf(WEDNESDAY), 3);
  assert.equal(weekdayOf('2026-08-15'), 6);
  assert.equal(weekdayOf('nonsense'), null);
  assert.equal(upcomingFridayFrom(WEDNESDAY), '2026-08-21');
});

test('the range takes pickups and delivered orders but never a cancelled one', () => {
  const state = {
    orders: [
      order({ id: 'in', date: '2026-08-10' }),
      order({ id: 'pickup', date: '2026-08-11', pickup: true }),
      order({ id: 'delivered', date: '2026-08-12', status: 'נמסרה' }),
      order({ id: 'cancelled', date: '2026-08-13', status: 'בוטלה' }),
      order({ id: 'before', date: '2026-08-08' }),
      order({ id: 'after', date: '2026-08-16' }),
    ],
  };
  const ids = ordersInRange(state, '2026-08-09', '2026-08-15').map((o) => o.id);
  assert.deepEqual(ids, ['in', 'pickup', 'delivered']);
});

test('a phone seen before the window is returning, and only before it', () => {
  const state = {
    orders: [
      order({ id: 'old', date: '2026-07-01', phone: '050-1111111' }),
      order({ id: 'w1', date: '2026-08-10', phone: '0501111111' }), // same number, punctuated differently
      order({ id: 'w2', date: '2026-08-11', phone: '050-2222222' }),
      order({ id: 'w3', date: '2026-08-12', phone: '050-2222222' }), // same new customer twice = one
      order({ id: 'w4', date: '2026-08-13', phone: '' }),            // unattributable, counted nowhere
    ],
  };
  const windowOrders = ordersInRange(state, '2026-08-09', '2026-08-15');
  assert.deepEqual(splitNewAndReturning(state, windowOrders, '2026-08-09'), {
    newCustomers: 1,
    returningCustomers: 1,
  });
});

test('the weekly summary totals revenue, counts what it could not read, and reports the week', () => {
  const state = {
    orders: [
      order({ id: 'a', date: '2026-08-10', total: '390', status: 'נמסרה', mains: { 'חזה עוף': 4 } }),
      order({ id: 'b', date: '2026-08-12', total: '740$', status: 'נמסרה', mains: { 'חזה עוף': 2 } }),
      order({ id: 'c', date: '2026-08-14', total: 'שילמה במזומן', phone: '050-9999999' }),
      order({ id: 'cancelled', date: '2026-08-13', total: '5000', status: 'בוטלה' }),
      order({ id: 'outside', date: '2026-08-16', total: '9999' }),
    ],
  };

  const stats = summarizeWeek(state, SUNDAY);
  assert.equal(stats.from, '2026-08-09');
  assert.equal(stats.to, '2026-08-15');
  assert.equal(stats.revenue, 1130);      // the cancelled 5000 and next week's 9999 stay out
  assert.equal(stats.unpricedOrders, 1);
  assert.equal(stats.orderCount, 3);
  assert.equal(stats.deliveredCount, 2);
  assert.deepEqual(stats.topDishes, [{ name: 'חזה עוף', quantity: 6 }]);
});

test('an empty week summarizes to zero orders so the scheduler can stay quiet', () => {
  const stats = summarizeWeek({ orders: [order({ date: '2026-07-01' })] }, SUNDAY);
  assert.equal(stats.orderCount, 0);
  assert.equal(stats.revenue, 0);
});

test('the Friday forecast aggregates that Friday only, and is null when Friday is empty', () => {
  const state = {
    orders: [
      order({ id: 'f1', date: FRIDAY, meals: 2, salads: { 'טחינה': { o: 3, p: 1 } }, mains: { 'דג': 2 } }),
      order({ id: 'f2', date: FRIDAY, meals: 1, salads: { 'טחינה': { o: 1, p: 0 } } }),
      order({ id: 'other', date: '2026-08-22', meals: 9, mains: { 'דג': 99 } }),
      order({ id: 'cancelled', date: FRIDAY, meals: 5, status: 'בוטלה', mains: { 'דג': 50 } }),
    ],
  };

  const forecast = summarizeFridayPrep(state, WEDNESDAY);
  assert.equal(forecast.date, FRIDAY);
  assert.equal(forecast.orderCount, 2);
  assert.equal(forecast.meals, 3);
  const salads = forecast.courses.find((course) => course.key === 'salads');
  assert.deepEqual(salads.dishes, [{ name: 'טחינה', quantity: 5 }]);
  const mains = forecast.courses.find((course) => course.key === 'mains');
  assert.deepEqual(mains.dishes, [{ name: 'דג', quantity: 2 }]);

  assert.equal(summarizeFridayPrep({ orders: [] }, WEDNESDAY), null);
  // Orders exist but carry no dishes at all — still nothing worth sending.
  assert.equal(summarizeFridayPrep({ orders: [order({ date: FRIDAY, meals: 1 })] }, WEDNESDAY), null);
});

test('the weekly digest message shows the numbers in Hebrew and marks what was not counted', () => {
  const message = weeklyBusinessDigest({
    from: '2026-08-09',
    to: '2026-08-15',
    revenue: 4180,
    unpricedOrders: 2,
    orderCount: 12,
    deliveredCount: 11,
    newCustomers: 3,
    returningCustomers: 7,
    topDishes: [
      { name: 'סלט חצילים', quantity: 24 },
      { name: 'חזה עוף', quantity: 18 },
    ],
  });

  assert.match(message.text, /09\/08–15\/08/u);
  assert.match(message.text, /הכנסות: 4,180\$/u);
  assert.match(message.text, /לא חושבו/u);
  assert.match(message.text, /12 הזמנות, מהן 11 נמסרו/u);
  assert.match(message.text, /3 חדשים, 7 חוזרים/u);
  assert.match(message.text, /• סלט חצילים — 24/u);
  assert.equal(message.reply_markup, undefined);
  // Nothing here is a delivery, so no order id and no buttons may leak in.
  assert.equal(message.text.includes('o1'), false);
});

test('the digest hides the unpriced note when every total was readable, and formats cents', () => {
  const clean = weeklyBusinessDigest({
    from: '2026-08-09', to: '2026-08-15', revenue: 1200.5, unpricedOrders: 0,
    orderCount: 1, deliveredCount: 1, newCustomers: 0, returningCustomers: 0, topDishes: [],
  });
  assert.equal(clean.text.includes('לא חושבו'), false);
  assert.match(clean.text, /1,200\.50\$/u);
  assert.match(clean.text, /הזמנה אחת, מהן 1 נמסרו/u);
  assert.equal(weeklyBusinessDigest(null).text, '');
});

test('the prep forecast lists dishes by course with the order and meal counts', () => {
  const message = prepForecast({
    date: FRIDAY,
    orderCount: 8,
    meals: 14,
    courses: [
      { key: 'salads', label: 'סלטים', dishes: [{ name: 'טחינה', quantity: 12 }] },
      { key: 'mains', label: 'עיקריות', dishes: [{ name: 'דג', quantity: 9 }] },
    ],
  });

  assert.match(message.text, /לפי מה שהוזמן עד עכשיו לשישי \(21\/08\) — ההכנות:/u);
  assert.match(message.text, /סלטים:\n• טחינה — 12/u);
  assert.match(message.text, /עיקריות:\n• דג — 9/u);
  assert.match(message.text, /8 הזמנות · 14 ארוחות זוגיות/u);
  assert.equal(message.reply_markup, undefined);

  assert.equal(prepForecast({ date: FRIDAY, courses: [] }).text, '');
  assert.equal(prepForecast(null).text, '');
});
