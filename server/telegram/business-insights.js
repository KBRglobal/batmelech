'use strict';

// Pure business arithmetic behind מיי's two weekly business messages: the Sunday
// digest that looks back at the week, and the Wednesday forecast that looks
// forward at Friday's cooking. No I/O, no state writes, no Telegram — the
// scheduler owns all of that, the message builders own the Hebrew.
//
// Everything here reads the *persisted legacy order*, not the editor draft, and
// those two disagree. The persisted shapes (see web/src/domain/preparation.ts,
// which is the authority) are:
//   salads:   { name: { o: ordered, p: gift } }   — 'פינוק' is still a portion cooked
//   firsts | mains | sides | desserts: { name: count }
//   extras:   { name: { q: count, note } }
//   total:    a *string* Lin typed by hand — '390', '740$', '$1,200', or junk
// Older blobs and hand-edits carry other shapes, so every reader below degrades
// to 0 rather than throwing: a weird dish must not cost Lin the whole digest.

const CANCELLED_STATUS = 'בוטלה';
const DELIVERED_STATUS = 'נמסרה';
const MILLISECONDS_PER_DAY = 86_400_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MAX_TEXT_LENGTH = 10_000;

// Ordered the way Lin cooks and the way the order editor lists them, so the
// forecast reads top-to-bottom like her prep sheet.
const COURSES = [
  { key: 'salads', label: 'סלטים' },
  { key: 'firsts', label: 'ראשונות' },
  { key: 'mains', label: 'עיקריות' },
  { key: 'sides', label: 'תוספות' },
  { key: 'desserts', label: 'קינוחים' },
  { key: 'extras', label: 'אקסטרות' },
];

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH ? value.trim() : '';
}

function normalizedDay(value) {
  const day = text(value);
  return DATE_PATTERN.test(day) ? day : '';
}

// Dates are compared and shifted as calendar days, never as instants: the whole
// file already lives in the Dubai day the scheduler handed it, so anchoring at
// UTC midnight keeps the arithmetic free of any second timezone.
function shiftDate(dateString, days) {
  const day = normalizedDay(dateString);
  if (day === '') return '';
  const at = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(at)) return '';
  return new Date(at + days * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
}

// 0 = Sunday, matching Date#getUTCDay and the weekday the scheduler tests read.
function weekdayOf(dateString) {
  const day = normalizedDay(dateString);
  if (day === '') return null;
  const at = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(at)) return null;
  return new Date(at).getUTCDay();
}

function orderStatus(order) {
  return text(order && order.status) || 'חדשה';
}

function isCancelled(order) {
  return orderStatus(order) === CANCELLED_STATUS;
}

function isDelivered(order) {
  return orderStatus(order) === DELIVERED_STATUS;
}

function ordersOf(state) {
  if (Array.isArray(state)) return state;
  if (state && Array.isArray(state.orders)) return state.orders;
  return [];
}

// The business view of a day range: every live order, pickups included. Felix's
// selectDeliveryDay deliberately drops pickups and delivered stops because he
// only wants what is left to drive — money earned and food to cook care about
// neither. Cancelled orders are the one real exclusion: they are not revenue and
// nobody cooks them.
function ordersInRange(state, fromDate, toDate) {
  const from = normalizedDay(fromDate);
  const to = normalizedDay(toDate);
  if (from === '' || to === '' || from > to) return [];
  return ordersOf(state).filter((order) => {
    if (!isRecord(order)) return false;
    const day = normalizedDay(order.date);
    if (day === '' || day < from || day > to) return false;
    return !isCancelled(order);
  });
}

function countOf(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!/^\d+$/u.test(raw)) return null;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

// One dish entry, whatever shape it was written in. Salads carry ordered and
// gift separately and BOTH get cooked, so the prep number is their sum.
function dishQuantity(value) {
  const direct = countOf(value);
  if (direct !== null) return direct;
  if (!isRecord(value)) return 0;

  const packed = countOf(value.q);
  if (packed !== null) return packed;

  const ordered = countOf(value.o) ?? countOf(value.ordered);
  const gift = countOf(value.p) ?? countOf(value.gift);
  if (ordered === null && gift === null) return 0;
  return (ordered ?? 0) + (gift ?? 0);
}

function addDish(target, rawName, quantity) {
  const name = text(rawName);
  if (name === '' || quantity <= 0) return;
  target.set(name, (target.get(name) ?? 0) + quantity);
}

function sortedDishes(counts) {
  return [...counts.entries()]
    .map(([name, quantity]) => ({ name, quantity }))
    // Biggest first; ties resolved by name so the same week always renders the
    // same list rather than shuffling with Map insertion order.
    .sort((left, right) => right.quantity - left.quantity || left.name.localeCompare(right.name, 'he'));
}

// The one aggregation both features share: dish quantities per course, plus a
// flat view across every course for "what sold most".
function aggregateDishQuantities(orders) {
  const perCourse = new Map(COURSES.map((course) => [course.key, new Map()]));
  const flat = new Map();

  for (const order of Array.isArray(orders) ? orders : []) {
    if (!isRecord(order)) continue;
    for (const course of COURSES) {
      const source = order[course.key];
      if (!isRecord(source)) continue;
      for (const [rawName, rawValue] of Object.entries(source)) {
        const quantity = dishQuantity(rawValue);
        addDish(perCourse.get(course.key), rawName, quantity);
        addDish(flat, rawName, quantity);
      }
    }
  }

  return {
    courses: COURSES.map((course) => ({
      key: course.key,
      label: course.label,
      dishes: sortedDishes(perCourse.get(course.key)),
    })).filter((course) => course.dishes.length > 0),
    all: sortedDishes(flat),
  };
}

function topDishes(orders, limit = 3) {
  return aggregateDishQuantities(orders).all.slice(0, Math.max(0, limit));
}

// Lin types totals by hand into a text field: '390', '740$', '$1,200', '1200.50'
// and, now and then, 'שילמה במזומן'. Anything we cannot read is never guessed at
// and never silently zeroed — it is counted and shown, so a digest that says
// 4,180$ is a number she can trust.
function parseOrderTotal(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  const raw = text(value);
  if (raw === '') return null;
  const stripped = raw.replace(/^\$/u, '').replace(/\$$/u, '').replace(/,/gu, '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/u.test(stripped)) return null;
  const amount = Number(stripped);
  return Number.isFinite(amount) ? amount : null;
}

function normalizedPhone(value) {
  const digits = text(value).replace(/\D/gu, '');
  return digits.length >= 6 ? digits : '';
}

// A customer is "returning" when that phone appears on any order dated before
// the window — including orders we would otherwise ignore. Someone who ordered
// once and cancelled is still a face Lin has seen.
function splitNewAndReturning(state, windowOrders, fromDate) {
  const from = normalizedDay(fromDate);
  const seenBefore = new Set();
  for (const order of ordersOf(state)) {
    if (!isRecord(order)) continue;
    const day = normalizedDay(order.date);
    if (day === '' || day >= from) continue;
    const phone = normalizedPhone(order.phone);
    if (phone !== '') seenBefore.add(phone);
  }

  const fresh = new Set();
  const returning = new Set();
  for (const order of windowOrders) {
    const phone = normalizedPhone(order.phone);
    // An order with no readable phone cannot be attributed either way, so it is
    // left out of both counts rather than inflating one of them.
    if (phone === '') continue;
    if (seenBefore.has(phone)) returning.add(phone);
    else fresh.add(phone);
  }

  return { newCustomers: fresh.size, returningCustomers: returning.size };
}

// The window a Sunday digest reports on: the seven days ending yesterday, which
// from a Sunday is exactly last Sunday through Saturday.
function weeklyWindowFor(todayDateString) {
  const today = normalizedDay(todayDateString);
  if (today === '') return null;
  return { from: shiftDate(today, -7), to: shiftDate(today, -1) };
}

// The Friday a Wednesday forecast looks at: two days out.
function upcomingFridayFrom(todayDateString) {
  return shiftDate(todayDateString, 2);
}

function sumMeals(orders) {
  let meals = 0;
  for (const order of orders) {
    meals += countOf(order && order.meals) ?? 0;
  }
  return meals;
}

// Everything the Sunday message needs, computed once. `unpricedOrders` is the
// honest companion to `revenue`: without it a week where Lin left two totals
// blank would quietly under-report itself.
function summarizeWeek(state, todayDateString) {
  const window = weeklyWindowFor(todayDateString);
  if (window === null) return null;

  const orders = ordersInRange(state, window.from, window.to);
  let revenue = 0;
  let unpricedOrders = 0;
  for (const order of orders) {
    const amount = parseOrderTotal(order.total);
    if (amount === null) unpricedOrders += 1;
    else revenue += amount;
  }

  return {
    from: window.from,
    to: window.to,
    revenue: Math.round(revenue * 100) / 100,
    unpricedOrders,
    orderCount: orders.length,
    deliveredCount: orders.filter(isDelivered).length,
    topDishes: topDishes(orders, 3),
    ...splitNewAndReturning(state, orders, window.from),
  };
}

// Everything the Wednesday message needs. Returns null when nobody has ordered
// for Friday yet — מיי stays quiet rather than sending an empty prep list.
function summarizeFridayPrep(state, todayDateString) {
  const friday = upcomingFridayFrom(todayDateString);
  if (friday === '') return null;
  const orders = ordersInRange(state, friday, friday);
  if (orders.length === 0) return null;

  const aggregate = aggregateDishQuantities(orders);
  if (aggregate.courses.length === 0) return null;

  return {
    date: friday,
    orderCount: orders.length,
    meals: sumMeals(orders),
    courses: aggregate.courses,
  };
}

module.exports = {
  COURSES,
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
};
