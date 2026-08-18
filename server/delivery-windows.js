'use strict';

// Delivery time windows with per-window capacity. The windows live under
// settings.deliveryWindows as [{ key, start, end, capacity }]; an empty or
// absent array means the feature is off and checkout keeps its free time
// field. Availability is always computed live against orders[] — a window's
// `remaining` is its capacity minus the ACTIVE delivery orders already booked
// inside it — so the public route must never be cached.
//
// Two routers are exported: a public read-only availability route (mounted
// with the other /api/site/* routes, BEFORE the decoy gate) and a staff-only
// CRUD route (mounted AFTER the decoy gate, like /api/mey/audit).

const crypto = require('node:crypto');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { CANCELLED_STATUS, parseClockMinutes } = require('./telegram/delivery-day');

const MAX_ATTEMPTS = 5;
const MAX_WINDOWS = 20;
const MIN_CAPACITY = 1;
const MAX_CAPACITY = 500;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const PICKUP_ADDRESS = 'איסוף עצמי';

function timeToMinutes(value) {
  if (typeof value !== 'string' || !TIME_PATTERN.test(value)) return null;
  const [hours, minutes] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
}

function isValidWindow(value) {
  if (!value || typeof value !== 'object') return false;
  if (typeof value.key !== 'string' || !KEY_PATTERN.test(value.key)) return false;
  const start = timeToMinutes(value.start);
  const end = timeToMinutes(value.end);
  if (start === null || end === null || start >= end) return false;
  if (!Number.isInteger(value.capacity) || value.capacity < MIN_CAPACITY || value.capacity > MAX_CAPACITY) {
    return false;
  }
  return true;
}

// Reads settings.deliveryWindows defensively: malformed entries (hand-edited
// state, older blobs) are skipped rather than crashing checkout. Returns
// windows sorted by start time. Empty result = feature off.
function readWindows(settings) {
  const source = settings && typeof settings === 'object' ? settings.deliveryWindows : undefined;
  if (!Array.isArray(source)) return [];
  const seen = new Set();
  const windows = [];
  for (const entry of source.slice(0, MAX_WINDOWS)) {
    if (!isValidWindow(entry)) continue;
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);
    windows.push({ key: entry.key, start: entry.start, end: entry.end, capacity: entry.capacity });
  }
  return windows.sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
}

// Strict validation for the admin PUT: the whole array must be well-formed —
// nothing is silently dropped when staff save. Returns { ok, windows | error }.
function validateWindowsInput(value) {
  if (!Array.isArray(value)) return { ok: false, error: 'windows must be an array' };
  if (value.length > MAX_WINDOWS) return { ok: false, error: `at most ${MAX_WINDOWS} windows` };
  const keys = new Set();
  const windows = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return { ok: false, error: 'each window must be an object' };
    const key = typeof entry.key === 'string' ? entry.key.trim() : '';
    if (!KEY_PATTERN.test(key)) return { ok: false, error: 'invalid window key' };
    if (keys.has(key)) return { ok: false, error: 'duplicate window key' };
    keys.add(key);
    const start = typeof entry.start === 'string' ? entry.start.trim() : '';
    const end = typeof entry.end === 'string' ? entry.end.trim() : '';
    if (timeToMinutes(start) === null || timeToMinutes(end) === null) {
      return { ok: false, error: 'times must be HH:MM' };
    }
    if (timeToMinutes(start) >= timeToMinutes(end)) {
      return { ok: false, error: 'start must be before end' };
    }
    const capacity = Number(entry.capacity);
    if (!Number.isInteger(capacity) || capacity < MIN_CAPACITY || capacity > MAX_CAPACITY) {
      return { ok: false, error: `capacity must be an integer between ${MIN_CAPACITY} and ${MAX_CAPACITY}` };
    }
    windows.push({ key, start, end, capacity });
  }
  windows.sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
  for (let at = 1; at < windows.length; at += 1) {
    if (timeToMinutes(windows[at].start) < timeToMinutes(windows[at - 1].end)) {
      return { ok: false, error: 'windows must not overlap' };
    }
  }
  return { ok: true, windows };
}

// An order consumes capacity while it is a live delivery: cancelled orders
// never count, pickups never count (both the admin's pickup flag and the
// address marker site pickup orders are saved with).
function isActiveDeliveryOrder(order) {
  if (!order || typeof order !== 'object') return false;
  if (order.pickup === true) return false;
  const address = typeof order.address === 'string' ? order.address.trim() : '';
  if (address === PICKUP_ADDRESS) return false;
  const status = typeof order.status === 'string' ? order.status.trim() : '';
  if (status === CANCELLED_STATUS || status.toLowerCase() === 'cancelled') return false;
  return true;
}

// Live availability for one date: each configured window with how many slots
// are left. An order counts against the window whose [start, end) range its
// time falls into; times are parsed leniently (staff type '19.00' too).
function windowAvailability(state, date) {
  const data = state && typeof state === 'object' ? state : {};
  const settings = data.settings && typeof data.settings === 'object' ? data.settings : {};
  const windows = readWindows(settings);
  if (windows.length === 0) return [];
  const day = typeof date === 'string' ? date.trim() : '';
  const orders = Array.isArray(data.orders) ? data.orders : [];
  const booked = windows.map(() => 0);
  for (const order of orders) {
    if (!isActiveDeliveryOrder(order)) continue;
    const orderDate = typeof order.date === 'string' ? order.date.trim() : '';
    if (orderDate === '' || orderDate !== day) continue;
    const minutes = parseClockMinutes(order.time);
    if (minutes === null) continue;
    const at = windows.findIndex(
      (window) => minutes >= timeToMinutes(window.start) && minutes < timeToMinutes(window.end),
    );
    if (at >= 0) booked[at] += 1;
  }
  return windows.map((window, at) => ({
    ...window,
    remaining: Math.max(0, window.capacity - booked[at]),
  }));
}

// Checkout-side gate for one submission. Returns null when the windows do not
// constrain this submission (feature off, pickup, or no date+time), otherwise
// 'invalid_window' / 'window_full' / ok with the matched window.
function checkSubmissionWindow(state, { fulfillment, date, time } = {}) {
  const data = state && typeof state === 'object' ? state : {};
  const settings = data.settings && typeof data.settings === 'object' ? data.settings : {};
  if (readWindows(settings).length === 0) return null;
  if (fulfillment !== 'delivery') return null;
  const day = typeof date === 'string' ? date.trim() : '';
  const clock = typeof time === 'string' ? time.trim() : '';
  if (day === '' || clock === '') return null;
  const minutes = timeToMinutes(clock);
  if (minutes === null) return { ok: false, error: 'invalid_window' };
  const availability = windowAvailability(data, day);
  const match = availability.find(
    (window) => minutes >= timeToMinutes(window.start) && minutes < timeToMinutes(window.end),
  );
  if (!match) return { ok: false, error: 'invalid_window' };
  if (match.remaining <= 0) return { ok: false, error: 'window_full' };
  return { ok: true, window: match };
}

// Public, read-only: which windows exist for a date and how many slots each
// still has. Mounted with the other public /api/site/* routes, BEFORE the
// decoy gate. Availability must be live, so responses are never cacheable.
function createPublicWindowsRouter({ repository, logger = console }) {
  if (!repository || typeof repository.loadState !== 'function') {
    throw new TypeError('A state repository is required');
  }
  if (!logger || typeof logger.error !== 'function') {
    throw new TypeError('A logger with an error method is required');
  }

  const router = express.Router();

  router.use(
    rateLimit({
      windowMs: 15 * 60 * 1_000,
      limit: 120,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    })
  );
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/', async (request, response) => {
    const date = typeof request.query.date === 'string' ? request.query.date.trim() : '';
    if (!DATE_PATTERN.test(date)) {
      return response.status(400).json({ error: 'invalid date' });
    }
    try {
      const current = await repository.loadState();
      const windows = windowAvailability(current.data, date).map(({ key, start, end, remaining }) => ({
        key,
        start,
        end,
        remaining,
      }));
      return response.status(200).json({ windows });
    } catch (error) {
      logger.error('delivery windows read failed', error);
      return response.status(503).json({ error: 'windows unavailable' });
    }
  });

  return router;
}

// Staff-only CRUD over the configured windows. Mounted AFTER the decoy gate
// (like /api/mey/audit) — never public. PUT replaces the full array via the
// same load-mutate-save retry loop business-actions.js uses.
function createWindowsAdminRouter({ repository, logger = console }) {
  if (!repository || typeof repository.loadState !== 'function' || typeof repository.saveState !== 'function') {
    throw new TypeError('A state repository is required');
  }
  if (!logger || typeof logger.error !== 'function') {
    throw new TypeError('A logger with an error method is required');
  }

  const router = express.Router();

  router.use(express.json({ limit: '64kb' }));
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/', async (_request, response) => {
    try {
      const current = await repository.loadState();
      const settings =
        current.data.settings && typeof current.data.settings === 'object' ? current.data.settings : {};
      return response.status(200).json({ windows: readWindows(settings) });
    } catch (error) {
      logger.error('delivery windows admin read failed', error);
      return response.status(503).json({ error: 'windows unavailable' });
    }
  });

  router.put('/', async (request, response) => {
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const validated = validateWindowsInput(body.windows);
    if (!validated.ok) {
      return response.status(400).json({ error: 'invalid_windows', detail: validated.error });
    }
    try {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        const current = await repository.loadState();
        const settings =
          current.data.settings && typeof current.data.settings === 'object' ? current.data.settings : {};
        const localState = {
          ...current.data,
          settings: { ...settings, deliveryWindows: validated.windows },
        };
        const saved = await repository.saveState({
          baseState: current.data,
          localState,
          baseRevision: current.revision,
          baseHash: current.hash,
          requestId: crypto.randomUUID(),
        });
        if (saved.ok) return response.status(200).json({ ok: true, windows: validated.windows });
      }
      return response.status(503).json({ error: 'save failed, please try again' });
    } catch (error) {
      logger.error('delivery windows admin save failed', error);
      return response.status(503).json({ error: 'save failed, please try again' });
    }
  });

  return router;
}

module.exports = {
  readWindows,
  validateWindowsInput,
  windowAvailability,
  checkSubmissionWindow,
  createPublicWindowsRouter,
  createWindowsAdminRouter,
};
