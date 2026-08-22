'use strict';

// Read-only business questions answered straight off the stored state: one
// order in full, one diner's whole history, what every dish sold, what the
// money did, and what a dish costs to make.
//
// Nothing here writes. Every function takes the already-loaded state blob and
// returns plain data — מיי's read tools are a thin wrapper over these, and so
// is any future report.
//
// The persisted legacy shapes (web/src/domain/preparation.ts is the authority)
// are not uniform and never will be:
//   salads:   { name: { o: ordered, p: gift } }   — 'פינוק' is still a portion cooked
//   firsts | mains | sides | desserts: { name: count }
//   extras:   { name: { q: count, note } }
//   lunch:    { key: { q, v, sides, addon } }
//   total, deposit: whatever Lin typed — '390', '740$', '$1,200', or junk
// So every reader degrades to 0 or null rather than throwing: one odd order
// must never cost Lin the answer to a question about all of them.

const { costRecipe, marginMinorUnits, productLibraryMap } = require('./recipe-cost');

const CANCELLED_STATUS = 'בוטלה';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MAX_TEXT = 10_000;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' && value.length <= MAX_TEXT ? value.trim() : '';
}

function ordersOf(state) {
  return Array.isArray(state?.orders) ? state.orders.filter(isRecord) : [];
}

function orderStatus(order) {
  return text(order.status);
}

function isCancelled(order) {
  return orderStatus(order) === CANCELLED_STATUS;
}

function orderDate(order) {
  const value = text(order.date);
  return DATE_PATTERN.test(value) ? value : null;
}

/**
 * Money Lin typed by hand, in minor units. '740$', '$1,200', '1,200.50' and
 * 1200 all parse; junk and negatives return null so a caller can say "not a
 * number" instead of quietly reporting zero revenue.
 */
function parseMoneyMinorUnits(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    const minorUnits = Math.round(value * 100);
    return Number.isSafeInteger(minorUnits) ? minorUnits : null;
  }
  const raw = text(value).replace(/[$₪\s]/gu, '').replaceAll(',', '');
  if (raw === '' || !/^\d+(?:\.\d{1,2})?$/u.test(raw)) return null;
  const [whole, fraction = ''] = raw.split('.');
  const minorUnits = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(minorUnits) ? minorUnits : null;
}

function countOf(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  if (typeof value === 'string' && /^\d+$/u.test(value.trim())) return Number(value.trim());
  return 0;
}

/** A dish entry is either a bare count, a salad {o,p} or an extra {q,note}. */
function dishQuantity(value) {
  if (isRecord(value)) {
    if ('o' in value || 'p' in value) return countOf(value.o) + countOf(value.p);
    if ('q' in value) return countOf(value.q);
    if ('quantity' in value) return countOf(value.quantity);
    return 0;
  }
  return countOf(value);
}

function normalizedPhone(value) {
  const digits = text(value).replace(/\D/gu, '');
  return digits.length >= 7 ? digits.slice(-9) : '';
}

/** The key that makes two orders the same diner: phone if there is one, else name. */
function customerKey(order) {
  const phone = normalizedPhone(order.phone);
  if (phone !== '') return `phone:${phone}`;
  const name = text(order.name).toLowerCase();
  return name === '' ? '' : `name:${name}`;
}

const COURSES = [
  { key: 'salads', label: 'סלטים' },
  { key: 'firsts', label: 'ראשונות' },
  { key: 'mains', label: 'עיקריות' },
  { key: 'sides', label: 'תוספות' },
  { key: 'desserts', label: 'קינוחים' },
  { key: 'extras', label: 'אקסטרות' },
];

/** Every dish on one order, course by course, with its quantity and any note. */
function orderDishes(order) {
  const dishes = [];
  for (const course of COURSES) {
    const record = isRecord(order[course.key]) ? order[course.key] : {};
    for (const [name, value] of Object.entries(record)) {
      const quantity = dishQuantity(value);
      if (quantity <= 0) continue;
      const entry = { course: course.label, courseKey: course.key, name: text(name), quantity };
      if (isRecord(value)) {
        if ('p' in value && countOf(value.p) > 0) entry.giftPortions = countOf(value.p);
        if (text(value.note) !== '') entry.note = text(value.note);
      }
      dishes.push(entry);
    }
  }
  const lunch = isRecord(order.lunch) ? order.lunch : {};
  for (const [key, value] of Object.entries(lunch)) {
    if (!isRecord(value)) continue;
    const quantity = countOf(value.q ?? value.quantity);
    if (quantity <= 0) continue;
    const sides = isRecord(value.sides) ? value.sides : {};
    dishes.push({
      course: 'תפריט צהריים',
      courseKey: 'lunch',
      name: text(key),
      quantity,
      variant: text(value.v ?? value.variantKey) || null,
      sides: Object.entries(sides)
        .map(([sideName, sideValue]) => ({ name: text(sideName), quantity: countOf(sideValue) }))
        .filter((side) => side.quantity > 0),
      addonQuantity: countOf(value.addon ?? value.addonQuantity),
    });
  }
  for (const item of Array.isArray(order.custom) ? order.custom : []) {
    if (!isRecord(item)) continue;
    const quantity = countOf(item.q ?? item.quantity);
    if (quantity <= 0) continue;
    dishes.push({
      course: 'פריט חופשי',
      courseKey: 'custom',
      name: text(item.name),
      quantity,
      unitPriceMinorUnits: parseMoneyMinorUnits(item.price ?? item.unitPrice),
    });
  }
  return dishes;
}

/** What was paid and what is still open on one order. */
function orderMoney(order) {
  const totalMinorUnits = parseMoneyMinorUnits(order.total);
  const depositMinorUnits = parseMoneyMinorUnits(order.deposit);
  const paidFlag = text(order.paid);
  const fullyPaid = paidFlag === 'כן';
  const collectedMinorUnits = fullyPaid
    ? totalMinorUnits
    : (depositMinorUnits ?? (totalMinorUnits === null ? null : 0));
  return {
    totalMinorUnits,
    totalUnreadable: order.total !== undefined && order.total !== '' && totalMinorUnits === null,
    depositMinorUnits,
    collectedMinorUnits,
    outstandingMinorUnits:
      totalMinorUnits === null || collectedMinorUnits === null
        ? null
        : Math.max(0, totalMinorUnits - collectedMinorUnits),
    paid: paidFlag,
    fullyPaid,
    payMethod: text(order.payMethod),
    invoiceNumber: text(order.invoiceNumber) || null,
  };
}

/**
 * One order, whole. This is deliberately everything an operator can see in the
 * panel — the dish list included. A summary that drops the dishes cannot
 * answer "what exactly did she order", which is most of what anyone asks.
 * `meyToken` is the one field withheld: it is a courier capability token, not
 * business information.
 */
function fullOrder(order) {
  const { meyToken: _withheld, ...rest } = order;
  return {
    id: order.id ?? null,
    date: orderDate(order),
    time: text(order.time) || null,
    customer: {
      name: text(order.name) || null,
      phone: text(order.phone) || null,
      email: text(order.email) || null,
    },
    fulfillment: {
      pickup: order.pickup === true,
      deliveryZone: text(order.deliveryZone) || null,
      place: text(order.place) || null,
      address: text(order.address) || null,
    },
    status: orderStatus(order) || null,
    source: text(order.source) || null,
    coupleMeals: countOf(order.meals),
    challahs: countOf(order.challot),
    dishes: orderDishes(order),
    money: orderMoney(order),
    plata: {
      count: countOf(order.plataCount),
      depositMinorUnits: parseMoneyMinorUnits(order.plataDeposit),
      status: text(order.plataStatus) || null,
    },
    delivery: {
      checkinState: text(order.courierCheckinState) || null,
      deliveredAt: typeof order.deliveredAt === 'number' ? order.deliveredAt : null,
      hasProofPhoto: Boolean(order.deliveryProofUrl),
    },
    notes: text(order.notes) || null,
    intakeConversation: text(order.intakeConversation) || null,
    // Anything the panel stores that this shape has not named explicitly, so a
    // field added tomorrow is readable today without touching this file.
    raw: rest,
  };
}

function inRange(order, fromDate, toDate) {
  const date = orderDate(order);
  if (date === null) return false;
  if (fromDate && date < fromDate) return false;
  if (toDate && date > toDate) return false;
  return true;
}

/**
 * Every diner the orders know about, with what they actually paid.
 * Cancelled orders are counted separately: they are history, not revenue.
 */
function customerLedger(state) {
  const byKey = new Map();
  for (const order of ordersOf(state)) {
    const key = customerKey(order);
    if (key === '') continue;
    const existing = byKey.get(key) ?? {
      key,
      name: text(order.name) || null,
      phone: text(order.phone) || null,
      email: text(order.email) || null,
      orderCount: 0,
      cancelledCount: 0,
      firstOrderDate: null,
      lastOrderDate: null,
      totalBilledMinorUnits: 0,
      totalCollectedMinorUnits: 0,
      outstandingMinorUnits: 0,
      unreadableTotals: 0,
      dishCounts: new Map(),
      orderIds: [],
    };
    if (existing.name === null && text(order.name) !== '') existing.name = text(order.name);
    if (existing.email === null && text(order.email) !== '') existing.email = text(order.email);
    existing.orderIds.push(order.id ?? null);

    const date = orderDate(order);
    if (date !== null) {
      if (existing.firstOrderDate === null || date < existing.firstOrderDate) existing.firstOrderDate = date;
      if (existing.lastOrderDate === null || date > existing.lastOrderDate) existing.lastOrderDate = date;
    }

    if (isCancelled(order)) {
      existing.cancelledCount += 1;
    } else {
      existing.orderCount += 1;
      const money = orderMoney(order);
      if (money.totalUnreadable) existing.unreadableTotals += 1;
      existing.totalBilledMinorUnits += money.totalMinorUnits ?? 0;
      existing.totalCollectedMinorUnits += money.collectedMinorUnits ?? 0;
      existing.outstandingMinorUnits += money.outstandingMinorUnits ?? 0;
      for (const dish of orderDishes(order)) {
        if (dish.name === '') continue;
        existing.dishCounts.set(dish.name, (existing.dishCounts.get(dish.name) ?? 0) + dish.quantity);
      }
    }
    byKey.set(key, existing);
  }

  return [...byKey.values()]
    .map(({ dishCounts, ...customer }) => ({
      ...customer,
      favouriteDishes: [...dishCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'he'))
        .slice(0, 10)
        .map(([name, quantity]) => ({ name, quantity })),
    }))
    .sort((a, b) => b.totalCollectedMinorUnits - a.totalCollectedMinorUnits);
}

/** Every dish sold in a window, most-ordered first. */
function dishDemand(state, { fromDate = null, toDate = null } = {}) {
  const counts = new Map();
  let orderCount = 0;
  for (const order of ordersOf(state)) {
    if (isCancelled(order) || !inRange(order, fromDate, toDate)) continue;
    orderCount += 1;
    for (const dish of orderDishes(order)) {
      if (dish.name === '') continue;
      const existing = counts.get(dish.name) ?? { name: dish.name, course: dish.course, quantity: 0, orders: 0 };
      existing.quantity += dish.quantity;
      existing.orders += 1;
      counts.set(dish.name, existing);
    }
  }
  return {
    fromDate,
    toDate,
    orderCount,
    dishes: [...counts.values()].sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, 'he')),
  };
}

function expensesOf(state, fromDate, toDate) {
  const raw = isRecord(state?.expenses) ? state.expenses : {};
  const rows = [];
  let totalMinorUnits = 0;
  for (const [key, value] of Object.entries(raw)) {
    const entries = Array.isArray(value) ? value : [value];
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      const date = DATE_PATTERN.test(text(entry.date)) ? text(entry.date) : (DATE_PATTERN.test(key) ? key : null);
      if (fromDate && (date === null || date < fromDate)) continue;
      if (toDate && (date === null || date > toDate)) continue;
      const amount = parseMoneyMinorUnits(entry.amount ?? entry.total ?? entry.sum);
      if (amount !== null) totalMinorUnits += amount;
      rows.push({
        date,
        label: text(entry.label ?? entry.name ?? entry.title ?? key) || key,
        category: text(entry.category) || null,
        amountMinorUnits: amount,
      });
    }
  }
  return { totalMinorUnits, count: rows.length, rows };
}

/** What the money did over a window: billed, collected, still owed, spent. */
function financialSummary(state, { fromDate = null, toDate = null } = {}) {
  let billedMinorUnits = 0;
  let collectedMinorUnits = 0;
  let outstandingMinorUnits = 0;
  let orderCount = 0;
  let cancelledCount = 0;
  let unreadableTotals = 0;
  const unpaidOrders = [];

  for (const order of ordersOf(state)) {
    if (!inRange(order, fromDate, toDate)) continue;
    if (isCancelled(order)) {
      cancelledCount += 1;
      continue;
    }
    orderCount += 1;
    const money = orderMoney(order);
    if (money.totalUnreadable) unreadableTotals += 1;
    billedMinorUnits += money.totalMinorUnits ?? 0;
    collectedMinorUnits += money.collectedMinorUnits ?? 0;
    const open = money.outstandingMinorUnits ?? 0;
    outstandingMinorUnits += open;
    if (open > 0) {
      unpaidOrders.push({
        id: order.id ?? null,
        date: orderDate(order),
        name: text(order.name) || null,
        outstandingMinorUnits: open,
      });
    }
  }

  const expenses = expensesOf(state, fromDate, toDate);
  return {
    fromDate,
    toDate,
    orderCount,
    cancelledCount,
    billedMinorUnits,
    collectedMinorUnits,
    outstandingMinorUnits,
    expensesMinorUnits: expenses.totalMinorUnits,
    netMinorUnits: collectedMinorUnits - expenses.totalMinorUnits,
    unreadableTotals,
    unpaidOrders: unpaidOrders.sort((a, b) => b.outstandingMinorUnits - a.outstandingMinorUnits),
    expenses: expenses.rows,
  };
}

/**
 * What every dish with a recipe costs to make, and — where the menu prices it —
 * what it earns. A dish with no recipe is reported as such, never as free.
 */
function dishCosts(state, { nameFilter = '' } = {}) {
  const recipes = Array.isArray(state?.recipes) ? state.recipes.filter(isRecord) : [];
  const library = productLibraryMap(
    (Array.isArray(state?.productLibrary) ? state.productLibrary : []).filter(
      (entry) => isRecord(entry) && typeof entry.id === 'string',
    ),
  );
  const query = nameFilter.trim().toLowerCase();
  const rows = [];
  for (const recipe of recipes) {
    const name = text(recipe.name);
    if (query !== '' && !name.toLowerCase().includes(query)) continue;
    let cost;
    try {
      cost = costRecipe(recipe, library);
    } catch (error) {
      rows.push({ dishName: name, itemId: text(recipe.itemId) || null, error: error.message });
      continue;
    }
    rows.push({
      dishName: name,
      itemId: text(recipe.itemId) || null,
      yield: recipe.yield,
      batchCostMinorUnits: cost.totalMinorUnits,
      perPortionCostMinorUnits: cost.perYieldUnitMinorUnits,
      costPer100gMinorUnits: cost.minorUnitsPer100g,
      complete: cost.complete,
      ingredients: cost.ingredientCosts,
      warnings: cost.warnings,
    });
  }
  return { count: rows.length, dishes: rows };
}

module.exports = {
  COURSES,
  customerKey,
  customerLedger,
  dishCosts,
  dishDemand,
  dishQuantity,
  expensesOf,
  financialSummary,
  fullOrder,
  marginMinorUnits,
  orderDishes,
  orderMoney,
  ordersOf,
  parseMoneyMinorUnits,
};
