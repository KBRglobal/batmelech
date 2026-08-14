'use strict';

// Small, bounded set of state mutations any trusted caller (admin UI, the
// Telegram assistant) can perform without going through the full versioned
// /api/state client flow. Each function loads-mutates-saves with retry,
// mirroring the pattern in site-order-route.js. Deliberately narrow: this is
// NOT a general state-write API — it only knows how to flip these specific
// fields under settings.

const crypto = require('node:crypto');

const MAX_ATTEMPTS = 5;

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

async function setOrderingOpen(repository, open) {
  return withSettingsUpdate(repository, (settings) => ({ ...settings, orderingOpen: Boolean(open) }));
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

module.exports = {
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
  KNOWN_ORDER_STATUSES,
  KNOWN_CHECKIN_STATES,
};
