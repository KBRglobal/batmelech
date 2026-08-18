'use strict';

// Small, bounded set of state mutations any trusted caller (admin UI, the
// Telegram assistant) can perform without going through the full versioned
// /api/state client flow. Each function loads-mutates-saves with retry,
// mirroring the pattern in site-order-route.js. Deliberately narrow: this is
// NOT a general state-write API — it only knows how to flip these specific
// fields under settings.

const crypto = require('node:crypto');
const { dubaiDateString } = require('./telegram/delivery-day');

const MAX_ATTEMPTS = 5;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MILLISECONDS_PER_DAY = 86_400_000;

function normalizedDay(value) {
  const day = typeof value === 'string' ? value.trim() : '';
  return DATE_PATTERN.test(day) ? day : '';
}

// Closing ordering always means "not for the upcoming Shabbat", never "until
// somebody remembers to open it again": settings.orderingClosedUntil names the
// day ordering comes back — the next Sunday, exclusive of nothing before it —
// and every read compares it to today. The reopen therefore needs no scheduler.
function upcomingSundayDubai(now = new Date()) {
  const today = dubaiDateString(now);
  const midnightUtc = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(midnightUtc)) throw new RangeError('now must be a valid Date');
  const weekday = new Date(midnightUtc).getUTCDay(); // 0 = Sunday
  const daysAhead = 7 - weekday; // Sunday closes for a full week, never for zero days
  return new Date(midnightUtc + daysAhead * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
}

// The one place that answers "can a customer order right now". State blobs
// written before orderingClosedUntil existed only carry the boolean, so an
// absent (or unparsable) date falls back to it.
function effectiveOrderingOpen(settings, todayDubaiString = dubaiDateString()) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const closedUntil = normalizedDay(source.orderingClosedUntil);
  const today = normalizedDay(todayDubaiString);
  if (closedUntil === '' || today === '') return source.orderingOpen !== false;
  return today >= closedUntil; // open again ON the reopen day
}

function orderingStatus(settings, todayDubaiString = dubaiDateString()) {
  const open = effectiveOrderingOpen(settings, todayDubaiString);
  const closedUntil = normalizedDay(settings && settings.orderingClosedUntil);
  return { open, reopensOn: open ? null : closedUntil || null };
}

// A mutate() that returns null means "nothing to do" — the caller already sees
// the value it wanted, so we skip the save entirely. Used by the claim-style
// actions (digest sent, delivery nudges) where a second call must be a no-op.
async function withSettingsUpdate(repository, mutate) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const current = await repository.loadState();
    const settings = current.data.settings && typeof current.data.settings === 'object' ? current.data.settings : {};
    const nextSettings = mutate(settings);
    if (nextSettings === null) return { ok: true, skipped: true };
    const localState = { ...current.data, settings: nextSettings };
    const saved = await repository.saveState({
      baseState: current.data,
      localState,
      baseRevision: current.revision,
      baseHash: current.hash,
      requestId: crypto.randomUUID(),
    });
    if (saved.ok) return { ok: true };
  }
  return { ok: false };
}

// Same load-mutate-save retry, scoped to a single order. mutate(order) returns
// the replacement order object, or null to skip the save. Because mutate runs
// again on every retry against a freshly loaded order, a mutate that inspects a
// marker field doubles as a concurrency guard.
async function withOrderUpdate(repository, orderId, mutate) {
  const id = typeof orderId === 'string' ? orderId.trim() : String(orderId ?? '').trim();
  if (id === '') throw new RangeError('order id required');
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const current = await repository.loadState();
    const orders = Array.isArray(current.data.orders) ? current.data.orders : [];
    const existing = orders.find((order) => String(order.id) === id);
    if (!existing) return { ok: false, error: 'order not found' };
    const nextOrder = mutate(existing);
    if (nextOrder === null) return { ok: true, skipped: true, order: existing };
    const localState = {
      ...current.data,
      orders: orders.map((order) => (String(order.id) === id ? nextOrder : order)),
    };
    const saved = await repository.saveState({
      baseState: current.data,
      localState,
      baseRevision: current.revision,
      baseHash: current.hash,
      requestId: crypto.randomUUID(),
    });
    if (saved.ok) return { ok: true, order: nextOrder };
  }
  return { ok: false, error: 'save failed after retries' };
}

async function setOrderingOpen(repository, open, now = new Date()) {
  if (open) {
    return withSettingsUpdate(repository, (settings) => {
      const next = { ...settings, orderingOpen: true };
      delete next.orderingClosedUntil;
      return next;
    });
  }
  const orderingClosedUntil = upcomingSundayDubai(now);
  return withSettingsUpdate(repository, (settings) => ({ ...settings, orderingOpen: false, orderingClosedUntil }));
}

async function setSiteBanner(repository, message) {
  const trimmed = typeof message === 'string' ? message.trim() : '';
  return withSettingsUpdate(repository, (settings) => ({ ...settings, siteBanner: trimmed === '' ? null : trimmed }));
}

async function setItemStock(repository, itemName, inStock) {
  const name = typeof itemName === 'string' ? itemName.trim() : '';
  if (name === '') throw new RangeError('item name required');
  return withSettingsUpdate(repository, (settings) => {
    const current = Array.isArray(settings.out) ? settings.out.filter((value) => typeof value === 'string') : [];
    const withoutName = current.filter((existing) => existing !== name);
    const next = inStock ? withoutName : [...withoutName, name];
    return { ...settings, out: next };
  });
}

const KNOWN_ORDER_STATUSES = ['חדשה', 'אושרה', 'במשלוח', 'מוכנה', 'נמסרה'];

async function setOrderStatus(repository, orderId, status) {
  const id = typeof orderId === 'string' ? orderId.trim() : '';
  if (id === '') throw new RangeError('order id required');
  if (!KNOWN_ORDER_STATUSES.includes(status)) {
    throw new RangeError(`status must be one of: ${KNOWN_ORDER_STATUSES.join(', ')}`);
  }
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const current = await repository.loadState();
    const orders = Array.isArray(current.data.orders) ? current.data.orders : [];
    const found = orders.some((order) => String(order.id) === id);
    if (!found) return { ok: false, error: 'order not found' };
    const localState = {
      ...current.data,
      orders: orders.map((order) => {
        if (String(order.id) !== id) return order;
        const next = { ...order, status };
        if (status === 'נמסרה') {
          if (!next.deliveredAt) next.deliveredAt = Date.now();
          delete next.meyAwaitingReplySince;
        }
        return next;
      }),
    };
    const saved = await repository.saveState({
      baseState: current.data,
      localState,
      baseRevision: current.revision,
      baseHash: current.hash,
      requestId: crypto.randomUUID(),
    });
    if (saved.ok) return { ok: true };
  }
  return { ok: false, error: 'save failed after retries' };
}

// --- delivery coordination (Mey) ---------------------------------------------

const NUDGE_MARKERS = { lead: 'meyLeadNudgeAt', checkin: 'meyCheckinAskedAt', late: 'meyLateNudgeAt' };

// Claims the right to send one delivery nudge for an order. The marker field is
// both the "already sent" record and the lock: a second caller (a re-run of the
// scheduler, a duplicate webhook) gets claimed:false and nothing is written.
async function markDeliveryNudge(repository, orderId, kind) {
  const marker = NUDGE_MARKERS[kind];
  if (!marker) throw new RangeError(`kind must be one of: ${Object.keys(NUDGE_MARKERS).join(', ')}`);
  const result = await withOrderUpdate(repository, orderId, (order) => {
    if (order[marker]) return null;
    const now = Date.now();
    const next = { ...order, [marker]: now, meyToken: order.meyToken || crypto.randomBytes(4).toString('hex') };
    if (kind === 'checkin') next.meyAwaitingReplySince = now;
    return next;
  });
  if (!result.ok) return result;
  return { ok: true, claimed: !result.skipped, token: result.order.meyToken || null };
}

// Generic once-per-day claim at the settings level: markerKey remembers the
// last day the action ran; a second caller the same day gets claimed:false.
async function claimDailyMarker(repository, markerKey, dateString) {
  const key = typeof markerKey === 'string' ? markerKey.trim() : '';
  const day = typeof dateString === 'string' ? dateString.trim() : '';
  if (key === '' || day === '') throw new RangeError('marker key and date required');
  const result = await withSettingsUpdate(repository, (settings) => (
    settings[key] === day ? null : { ...settings, [key]: day }
  ));
  if (!result.ok) return { ok: false, error: 'save failed after retries' };
  return { ok: true, claimed: !result.skipped };
}

// Same claim shape, one per calendar day, at the settings level.
async function setDeliveryDigestSent(repository, dateString) {
  const day = typeof dateString === 'string' ? dateString.trim() : '';
  if (day === '') throw new RangeError('date string required');
  const result = await withSettingsUpdate(repository, (settings) => (
    settings.meyDigestSentFor === day ? null : { ...settings, meyDigestSentFor: day }
  ));
  if (!result.ok) return { ok: false, error: 'save failed after retries' };
  return { ok: true, claimed: !result.skipped };
}

// --- weekly business digest + Friday prep forecast (business-insights) -------
// Same settings-level claim as setDeliveryDigestSent, one marker per message.
// The stored day is the thing the message is ABOUT — the window's closing
// Saturday, the Friday being cooked for — not the day it was sent, so a
// restart, a redeploy or a clock that ticks twice can never produce a second
// copy of the same week.
async function setWeeklyDigestSent(repository, dateString) {
  const day = typeof dateString === 'string' ? dateString.trim() : '';
  if (day === '') throw new RangeError('date string required');
  const result = await withSettingsUpdate(repository, (settings) => (
    settings.meyWeeklyDigestSentFor === day ? null : { ...settings, meyWeeklyDigestSentFor: day }
  ));
  if (!result.ok) return { ok: false, error: 'save failed after retries' };
  return { ok: true, claimed: !result.skipped };
}

async function setPrepForecastSent(repository, dateString) {
  const day = typeof dateString === 'string' ? dateString.trim() : '';
  if (day === '') throw new RangeError('date string required');
  const result = await withSettingsUpdate(repository, (settings) => (
    settings.meyPrepForecastSentFor === day ? null : { ...settings, meyPrepForecastSentFor: day }
  ));
  if (!result.ok) return { ok: false, error: 'save failed after retries' };
  return { ok: true, claimed: !result.skipped };
}
// --- end weekly business digest + Friday prep forecast -----------------------

async function setPromptMessageId(repository, orderId, messageId) {
  const id = Number(messageId);
  if (!Number.isFinite(id)) return { ok: false, error: 'message id must be a number' };
  const result = await withOrderUpdate(repository, orderId, (order) => ({ ...order, meyPromptMessageId: id }));
  return result;
}

const KNOWN_CHECKIN_STATES = ['onTheWay', 'onTime', 'delayed'];
const MAX_ETA_MINUTES = 600;
const MAX_NOTE_LENGTH = 500;

async function setDeliveryCheckin(repository, orderId, { state, etaMinutes, note } = {}) {
  if (!KNOWN_CHECKIN_STATES.includes(state)) {
    return { ok: false, error: `state must be one of: ${KNOWN_CHECKIN_STATES.join(', ')}` };
  }
  const eta = Number(etaMinutes);
  const hasEta = Number.isFinite(eta) && eta > 0 && eta <= MAX_ETA_MINUTES;
  const trimmedNote = typeof note === 'string' ? note.trim() : '';
  return withOrderUpdate(repository, orderId, (order) => {
    const now = Date.now();
    const next = { ...order, courierCheckinState: state, courierCheckinAt: now };
    if (hasEta) {
      next.courierEtaMinutes = eta;
      next.courierEtaAt = now;
    }
    if (trimmedNote !== '') next.courierNote = trimmedNote.slice(0, MAX_NOTE_LENGTH);
    delete next.meyAwaitingReplySince;
    return next;
  });
}

async function setDeliveryProof(repository, orderId, { url, at, by } = {}) {
  if (typeof url !== 'string' || !url.startsWith('https://')) {
    return { ok: false, error: 'proof url must be an https url' };
  }
  let previousStatus = null;
  const result = await withOrderUpdate(repository, orderId, (order) => {
    previousStatus = order.status;
    const now = Date.now();
    const next = {
      ...order,
      deliveryProofUrl: url,
      deliveryProofAt: Number.isFinite(at) ? at : now,
      statusBeforeProof: order.status,
      status: 'נמסרה',
      deliveredAt: now,
    };
    if (typeof by === 'string' && by.trim() !== '') next.deliveryProofBy = by.trim();
    else delete next.deliveryProofBy;
    delete next.meyAwaitingReplySince;
    return next;
  });
  if (!result.ok) return result;
  return { ok: true, previousStatus, order: result.order };
}

// Undo for a proof attached to the wrong order. The uploaded object stays in R2
// on purpose — the photo is still evidence, it just is not this order's.
async function revertDeliveryProof(repository, orderId) {
  return withOrderUpdate(repository, orderId, (order) => {
    const next = { ...order, status: order.statusBeforeProof || 'מוכנה' };
    delete next.deliveryProofUrl;
    delete next.deliveryProofAt;
    delete next.deliveryProofBy;
    delete next.deliveredAt;
    delete next.statusBeforeProof;
    return next;
  });
}

// A photo that arrived before we know which order it belongs to.
async function setPendingProof(repository, pending) {
  let value = null;
  if (pending && typeof pending === 'object') {
    const url = typeof pending.url === 'string' ? pending.url : '';
    if (!url.startsWith('https://')) return { ok: false, error: 'proof url must be an https url' };
    value = { url, at: Number.isFinite(pending.at) ? pending.at : Date.now() };
    if (typeof pending.by === 'string' && pending.by.trim() !== '') value.by = pending.by.trim();
  }
  const result = await withSettingsUpdate(repository, (settings) => ({ ...settings, meyPendingProof: value }));
  if (!result.ok) return { ok: false, error: 'save failed after retries' };
  return { ok: true };
}

async function setCourierLocation(repository, { lat, lon, at } = {}) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { ok: false, error: 'lat and lon must be numbers' };
  }
  const result = await withSettingsUpdate(repository, (settings) => ({
    ...settings,
    meyCourierLocation: { lat: latitude, lon: longitude, at: Number.isFinite(at) ? at : Date.now() },
  }));
  if (!result.ok) return { ok: false, error: 'save failed after retries' };
  return { ok: true };
}

// --- plata (hotplate) rental --------------------------------------------------

// A rented hotplate is business equipment held against a deposit, so the money
// only closes when the plate is physically back: it goes out withCustomer, the
// customer says where they left it (awaitingPickup), Felix collects it
// (collected), and Lin returns the deposit (depositReturned).
const KNOWN_PLATA_STATUSES = ['withCustomer', 'awaitingPickup', 'collected', 'depositReturned'];
const MAX_PLATA_COUNT = 20;
const MAX_PLATA_NOTE_LENGTH = 300;
const PLATA_FIELDS = [
  'plataCount',
  'plataDeposit',
  'plataStatus',
  'plataPickupNote',
  'plataCollectedAt',
  'plataDepositReturnedAt',
];

// Stored the way order.deposit is stored — a canonical 'D.CC' string — so the
// two amounts stay comparable. Mirrors canonicalOptionalUsd /
// parsePlataDepositMinorUnits in web/src/domain/plata.ts: change one, change
// the other, or the admin editor and מיי start writing different shapes.
const PLATA_DEPOSIT_PATTERN = /^\$?(\d{1,9})(?:\.(\d{1,2}))?$/u;

function canonicalPlataDeposit(value) {
  if (value === undefined || value === null || value === '') return null;
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  const match = PLATA_DEPOSIT_PATTERN.exec(raw.replaceAll(',', ''));
  if (match === null) return null;
  return `${match[1]}.${(match[2] || '').padEnd(2, '0')}`;
}

// count 0 means "no hotplate on this order" and clears the whole lifecycle, so a
// plate booked by mistake leaves nothing behind to chase after Shabbat.
async function setPlataOnOrder(repository, orderId, { count, deposit } = {}) {
  const requested = Number(count);
  if (!Number.isInteger(requested) || requested < 0 || requested > MAX_PLATA_COUNT) {
    return { ok: false, error: `count must be a whole number between 0 and ${MAX_PLATA_COUNT}` };
  }
  const hasDeposit = deposit !== undefined && deposit !== null && deposit !== '';
  const canonicalDeposit = hasDeposit ? canonicalPlataDeposit(deposit) : null;
  if (hasDeposit && canonicalDeposit === null) {
    return { ok: false, error: 'deposit must be a non-negative amount with at most two decimals' };
  }
  return withOrderUpdate(repository, orderId, (order) => {
    const next = { ...order };
    if (requested === 0) {
      for (const field of PLATA_FIELDS) delete next[field];
      return next;
    }
    next.plataCount = requested;
    // Correcting the count of a plate already reported as left at reception must
    // not drag it back to withCustomer, so an existing status stands.
    next.plataStatus = KNOWN_PLATA_STATUSES.includes(order.plataStatus) ? order.plataStatus : 'withCustomer';
    if (canonicalDeposit === null) delete next.plataDeposit;
    else next.plataDeposit = canonicalDeposit;
    return next;
  });
}

async function setPlataStatus(repository, orderId, status, { note } = {}) {
  if (!KNOWN_PLATA_STATUSES.includes(status)) {
    return { ok: false, error: `status must be one of: ${KNOWN_PLATA_STATUSES.join(', ')}` };
  }
  const trimmedNote = typeof note === 'string' ? note.trim() : '';
  return withOrderUpdate(repository, orderId, (order) => {
    const next = { ...order, plataStatus: status };
    if (trimmedNote !== '') next.plataPickupNote = trimmedNote.slice(0, MAX_PLATA_NOTE_LENGTH);
    // The stamps record when it actually happened, so the first report wins and a
    // repeated update does not move the clock.
    if (status === 'collected' && !next.plataCollectedAt) next.plataCollectedAt = Date.now();
    if (status === 'depositReturned' && !next.plataDepositReturnedAt) next.plataDepositReturnedAt = Date.now();
    return next;
  });
}

// Same claim shape as setDeliveryDigestSent: one motzei-Shabbat pickup digest
// per day, whatever restarts the scheduler.
async function setPlataDigestSent(repository, dateString) {
  const day = typeof dateString === 'string' ? dateString.trim() : '';
  if (day === '') throw new RangeError('date string required');
  const result = await withSettingsUpdate(repository, (settings) => (
    settings.meyPlataDigestSentFor === day ? null : { ...settings, meyPlataDigestSentFor: day }
  ));
  if (!result.ok) return { ok: false, error: 'save failed after retries' };
  return { ok: true, claimed: !result.skipped };
}

module.exports = {
  claimDailyMarker,
  effectiveOrderingOpen,
  orderingStatus,
  upcomingSundayDubai,
  withSettingsUpdate,
  setOrderingOpen,
  setSiteBanner,
  setItemStock,
  setOrderStatus,
  markDeliveryNudge,
  setDeliveryDigestSent,
  setPromptMessageId,
  setDeliveryCheckin,
  setDeliveryProof,
  revertDeliveryProof,
  setPendingProof,
  setCourierLocation,
  setPlataOnOrder,
  setPlataStatus,
  setPlataDigestSent,
  setWeeklyDigestSent,
  setPrepForecastSent,
  KNOWN_ORDER_STATUSES,
  KNOWN_CHECKIN_STATES,
  KNOWN_PLATA_STATUSES,
};
