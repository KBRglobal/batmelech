'use strict';

// Pure helpers for Felix's delivery day: which orders belong to a given day,
// in what order he should drive them, and where each stop navigates to.
// No I/O and no state writes — the Telegram route layer owns all of that.
//
// The navigation rules here intentionally mirror
// web/src/domain/delivery-dashboard.ts (buildGoogleMapsSearchHref /
// validatedNavigationHref, around line 271). The admin dashboard is TypeScript
// and cannot be imported into this CommonJS server, so the logic is duplicated:
// change one, change the other, or Felix's link and Lin's link stop matching.

const DUBAI_TIME_ZONE = 'Asia/Dubai';
const DUBAI_CENTER = { latitude: 25.2048, longitude: 55.2708 };
const CLUSTER_MINUTES = 30;
const MAX_STOPS_PER_MAPS_URL = 9;
const MAX_TEXT_LENGTH = 10_000; // mirrors MAX_TEXT_LENGTH in delivery-dashboard.ts
const DELIVERED_STATUS = 'נמסרה';
const CANCELLED_STATUS = 'בוטלה';
const CLOCK_SOURCE = '(\\d{1,2})[:.](\\d{2})';
const EARTH_RADIUS_KM = 6371;

const dubaiDateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: DUBAI_TIME_ZONE });
const dubaiTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: DUBAI_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function text(value) {
  return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH ? value.trim() : '';
}

function dubaiDateString(now = new Date()) {
  return dubaiDateFormatter.format(now);
}

function dubaiMinutesOfDay(now = new Date()) {
  const parts = dubaiTimeFormatter.formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

// Lin and the customers type times any way they feel like: '19:00', '19.00',
// '9:30 בערב', 'בסביבות 13:00'. Take the first token that is a real clock time.
function parseClockMinutes(value) {
  const raw = text(value);
  if (raw === '') return null;
  const pattern = new RegExp(CLOCK_SOURCE, 'gu');
  for (const match of raw.matchAll(pattern)) {
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours <= 23 && minutes <= 59) return hours * 60 + minutes;
  }
  return null;
}

function ordersOf(state) {
  if (Array.isArray(state)) return state;
  if (state && Array.isArray(state.orders)) return state.orders;
  return [];
}

function orderName(order) {
  return text(order && order.name) || 'ללא שם';
}

function orderStatus(order) {
  return text(order && order.status) || 'חדשה';
}

function compareEntries(a, b) {
  if (a.minutes !== b.minutes) {
    if (a.minutes === null) return 1; // untimed orders always ride at the end
    if (b.minutes === null) return -1;
    return a.minutes - b.minutes;
  }
  const byName = orderName(a.order).localeCompare(orderName(b.order), 'he');
  if (byName !== 0) return byName;
  return a.index - b.index;
}

function sortByTime(orders) {
  return orders
    .map((order, index) => ({ order, index, minutes: parseClockMinutes(order && order.time) }))
    .sort(compareEntries)
    .map((entry) => entry.order);
}

// The day Felix actually drives: deliveries only, cancelled ones never, and
// delivered ones only when the caller wants the full progress view.
function selectDeliveryDay(state, dateString, { includeDelivered = false } = {}) {
  const day = text(dateString);
  if (day === '') return [];
  const selected = ordersOf(state).filter((order) => {
    if (!order || typeof order !== 'object') return false;
    if (text(order.date) !== day) return false;
    if (order.pickup === true) return false;
    const status = orderStatus(order);
    if (status === CANCELLED_STATUS) return false;
    if (!includeDelivered && status === DELIVERED_STATUS) return false;
    return true;
  });
  return sortByTime(selected);
}

function destinationQuery(order) {
  if (!order || typeof order !== 'object') return '';
  return text(order.hotelAddress) || text(order.hotelName) || text(order.address) || text(order.place);
}

function destinationLabel(order) {
  if (!order || typeof order !== 'object') return 'יעד לא צוין';
  return text(order.hotelName) || text(order.place) || text(order.address) || 'יעד לא צוין';
}

function buildGoogleMapsSearchHref(destination) {
  const query = text(destination);
  if (query === '') return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function validatedNavigationHref(value) {
  const raw = text(value);
  if (raw === '') return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return null;
    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== 'google.com' && !hostname.endsWith('.google.com')) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function navigationHref(order) {
  if (!order || typeof order !== 'object') return null;
  return validatedNavigationHref(order.navigationUrl) || buildGoogleMapsSearchHref(destinationQuery(order));
}

function nextStop(dayOrders, afterOrderId) {
  const orders = Array.isArray(dayOrders) ? dayOrders : [];
  const undelivered = (order) => order && orderStatus(order) !== DELIVERED_STATUS;
  const wanted = afterOrderId === null || afterOrderId === undefined ? '' : String(afterOrderId);
  if (wanted !== '') {
    const at = orders.findIndex((order) => order && String(order.id) === wanted);
    if (at >= 0) return orders.slice(at + 1).find(undelivered) || null;
  }
  return orders.find(undelivered) || null;
}

function findByToken(orders, token) {
  const wanted = text(token);
  if (wanted === '') return null;
  const matches = (Array.isArray(orders) ? orders : []).filter(
    (order) => order && text(order.meyToken) === wanted,
  );
  return matches.length === 1 ? matches[0] : null;
}

function coordsOf(order) {
  if (!order || typeof order !== 'object') return null;
  const latitude = Number(order.hotelLatitude);
  const longitude = Number(order.hotelLongitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

function haversineKm(from, to) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLon = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Time beats geography: a customer who asked for 12:30 gets 12:30. Only inside
// a cluster of stops asked for at roughly the same time do we reorder by
// proximity, and only for stops that actually have coordinates — anything
// without coordinates keeps the slot its time gave it.
function suggestRouteOrder(orders) {
  const sorted = sortByTime(Array.isArray(orders) ? orders : []);
  const timed = sorted.filter((order) => parseClockMinutes(order && order.time) !== null);
  const untimed = sorted.filter((order) => parseClockMinutes(order && order.time) === null);

  let anchor = (timed.length > 0 && coordsOf(timed[0])) || DUBAI_CENTER;
  const route = [];
  let clusterStart = 0;
  while (clusterStart < timed.length) {
    const startMinutes = parseClockMinutes(timed[clusterStart].time);
    let clusterEnd = clusterStart + 1;
    while (
      clusterEnd < timed.length &&
      parseClockMinutes(timed[clusterEnd].time) - startMinutes <= CLUSTER_MINUTES
    ) {
      clusterEnd += 1;
    }
    const cluster = timed.slice(clusterStart, clusterEnd);
    const placeable = [];
    const remaining = [];
    cluster.forEach((order, slot) => {
      const point = coordsOf(order);
      if (point === null) return;
      placeable.push(slot);
      remaining.push({ order, point });
    });
    const ordered = [];
    while (remaining.length > 0) {
      let bestAt = 0;
      let bestDistance = haversineKm(anchor, remaining[0].point);
      for (let i = 1; i < remaining.length; i += 1) {
        const distance = haversineKm(anchor, remaining[i].point);
        if (distance < bestDistance) {
          bestAt = i;
          bestDistance = distance;
        }
      }
      const [chosen] = remaining.splice(bestAt, 1);
      anchor = chosen.point;
      ordered.push(chosen.order);
    }
    const arranged = cluster.slice();
    placeable.forEach((slot, i) => {
      arranged[slot] = ordered[i];
    });
    route.push(...arranged);
    clusterStart = clusterEnd;
  }

  return route.concat(untimed);
}

function buildMultiStopMapsUrl(orderedOrders) {
  const stops = (Array.isArray(orderedOrders) ? orderedOrders : [])
    .map((order) => destinationQuery(order))
    .filter((query) => query !== '')
    .map((query) => encodeURIComponent(query));
  const urls = [];
  for (let at = 0; at < stops.length; at += MAX_STOPS_PER_MAPS_URL) {
    urls.push(`https://www.google.com/maps/dir/${stops.slice(at, at + MAX_STOPS_PER_MAPS_URL).join('/')}`);
  }
  return urls;
}

module.exports = {
  DELIVERED_STATUS,
  CANCELLED_STATUS,
  DUBAI_CENTER,
  buildGoogleMapsSearchHref,
  buildMultiStopMapsUrl,
  destinationLabel,
  destinationQuery,
  dubaiDateString,
  dubaiMinutesOfDay,
  findByToken,
  navigationHref,
  nextStop,
  orderName,
  orderStatus,
  parseClockMinutes,
  selectDeliveryDay,
  suggestRouteOrder,
};
