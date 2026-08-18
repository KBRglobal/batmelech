'use strict';

// Jewish-holiday menus, two faces of the same data:
//  - createPublicHolidaysRouter: read-only, for the customer site — the
//    upcoming holiday calendar plus only the menus whose publish window
//    covers today. Strictly whitelisted field by field, like the catalog.
//  - createHolidaysAdminRouter: staff-only CRUD over settings.holidayMenus
//    (gate by mounting it BEHIND the decoy gate in server.js). Full-array
//    replace through the same load-mutate-save retry every settings writer
//    uses (see business-actions.js withSettingsUpdate).

const crypto = require('node:crypto');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { HOLIDAY_KEYS, dubaiDayString, upcomingHolidays } = require('./hebrew-calendar');

const MAX_MENUS = 20;
const MAX_DISHES = 60;
const MAX_TEXT_LENGTH = 240;
const MAX_PRICE_USD = 100_000;
const MAX_ATTEMPTS = 5;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH ? value.trim() : '';
}

// A real calendar day: pattern AND round-trips through Date (2026-02-30 fails).
function realDay(value) {
  const day = typeof value === 'string' ? value.trim() : '';
  if (!DAY_PATTERN.test(day)) return '';
  const parsed = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day ? '' : day;
}

function price(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_PRICE_USD
    ? value
    : null;
}

function projectMenu(menu) {
  return {
    id: text(menu.id),
    holidayKey: text(menu.holidayKey),
    title: {
      he: text(isRecord(menu.title) ? menu.title.he : ''),
      en: text(isRecord(menu.title) ? menu.title.en : ''),
      fr: text(isRecord(menu.title) ? menu.title.fr : ''),
    },
    dishes: (Array.isArray(menu.dishes) ? menu.dishes : [])
      .slice(0, MAX_DISHES)
      .filter((dish) => isRecord(dish) && text(dish.name) !== '')
      .map((dish) => ({
        name: text(dish.name),
        displayName: {
          en: text(isRecord(dish.displayName) ? dish.displayName.en : ''),
          fr: text(isRecord(dish.displayName) ? dish.displayName.fr : ''),
        },
        priceUsd: price(dish.priceUsd),
      })),
    publishFrom: realDay(menu.publishFrom),
    publishUntil: realDay(menu.publishUntil),
    orderCutoff: realDay(menu.orderCutoff),
  };
}

function storedMenus(settings) {
  const rows = Array.isArray(settings.holidayMenus) ? settings.holidayMenus : [];
  return rows.slice(0, MAX_MENUS).filter(isRecord).map(projectMenu).filter((menu) => menu.id !== '');
}

// Returns a normalized menu array, or a string describing the first problem.
function validateMenus(value) {
  if (!Array.isArray(value)) return 'menus must be an array';
  if (value.length > MAX_MENUS) return `no more than ${MAX_MENUS} menus`;
  const seenIds = new Set();
  const normalized = [];
  for (const [index, raw] of value.entries()) {
    const label = `menu ${index + 1}`;
    if (!isRecord(raw)) return `${label}: must be an object`;
    const id = text(raw.id);
    if (id === '') return `${label}: id is required`;
    if (seenIds.has(id)) return `${label}: duplicate id "${id}"`;
    seenIds.add(id);
    const holidayKey = text(raw.holidayKey);
    if (!HOLIDAY_KEYS.includes(holidayKey)) return `${label}: unknown holidayKey "${holidayKey}"`;
    if (!isRecord(raw.title) || text(raw.title.he) === '') return `${label}: a Hebrew title is required`;
    const publishFrom = realDay(raw.publishFrom);
    const publishUntil = realDay(raw.publishUntil);
    const orderCutoff = realDay(raw.orderCutoff);
    if (publishFrom === '') return `${label}: publishFrom must be a real YYYY-MM-DD date`;
    if (publishUntil === '') return `${label}: publishUntil must be a real YYYY-MM-DD date`;
    if (orderCutoff === '') return `${label}: orderCutoff must be a real YYYY-MM-DD date`;
    if (publishFrom > publishUntil) return `${label}: publishFrom is after publishUntil`;
    if (!Array.isArray(raw.dishes)) return `${label}: dishes must be an array`;
    if (raw.dishes.length > MAX_DISHES) return `${label}: no more than ${MAX_DISHES} dishes`;
    const dishes = [];
    for (const [dishIndex, dish] of raw.dishes.entries()) {
      const dishLabel = `${label}, dish ${dishIndex + 1}`;
      if (!isRecord(dish) || text(dish.name) === '') return `${dishLabel}: a Hebrew name is required`;
      if (price(dish.priceUsd) === null) return `${dishLabel}: price must be a number between 0 and ${MAX_PRICE_USD}`;
      dishes.push({
        name: text(dish.name),
        displayName: {
          en: text(isRecord(dish.displayName) ? dish.displayName.en : ''),
          fr: text(isRecord(dish.displayName) ? dish.displayName.fr : ''),
        },
        priceUsd: price(dish.priceUsd),
      });
    }
    normalized.push({
      id,
      holidayKey,
      title: { he: text(raw.title.he), en: text(raw.title.en), fr: text(raw.title.fr) },
      dishes,
      publishFrom,
      publishUntil,
      orderCutoff,
    });
  }
  return normalized;
}

// Same load-mutate-save retry as business-actions.withSettingsUpdate (not
// exported from there, so mirrored — do not let the two drift apart).
async function withSettingsUpdate(repository, mutate) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const current = await repository.loadState();
    const settings = isRecord(current.data.settings) ? current.data.settings : {};
    const nextSettings = mutate(settings);
    if (nextSettings === null) return { ok: true, skipped: true };
    const saved = await repository.saveState({
      baseState: current.data,
      localState: { ...current.data, settings: nextSettings },
      baseRevision: current.revision,
      baseHash: current.hash,
      requestId: crypto.randomUUID(),
    });
    if (saved.ok) return { ok: true };
  }
  return { ok: false };
}

function assertRepository(repository) {
  if (!repository || typeof repository.loadState !== 'function') {
    throw new TypeError('A state repository is required');
  }
}

function createPublicHolidaysRouter({ repository, logger = console }) {
  assertRepository(repository);
  if (!logger || typeof logger.error !== 'function') {
    throw new TypeError('A logger with an error method is required');
  }

  const router = express.Router();

  router.use(
    rateLimit({
      windowMs: 15 * 60 * 1_000,
      limit: 240,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    })
  );

  router.get('/', async (_request, response) => {
    try {
      const today = dubaiDayString();
      const current = await repository.loadState();
      const settings = isRecord(current.data.settings) ? current.data.settings : {};
      const menus = storedMenus(settings).filter(
        (menu) => menu.publishFrom !== '' && menu.publishUntil !== '' && menu.publishFrom <= today && today <= menu.publishUntil
      );
      // Holiday dates change once a year; menus change rarely — five minutes
      // of public cache keeps the endpoint essentially free.
      response.set('Cache-Control', 'public, max-age=300');
      return response.status(200).json({ holidays: upcomingHolidays(new Date(), 13), menus });
    } catch (error) {
      logger.error('site holidays read failed', error);
      response.set('Cache-Control', 'no-store');
      return response.status(503).json({ error: 'holidays unavailable' });
    }
  });

  return router;
}

function createHolidaysAdminRouter({ repository, logger = console }) {
  assertRepository(repository);
  if (!repository || typeof repository.saveState !== 'function') {
    throw new TypeError('A state repository with saveState is required');
  }
  if (!logger || typeof logger.error !== 'function') {
    throw new TypeError('A logger with an error method is required');
  }

  const router = express.Router();

  router.use(express.json({ limit: '256kb' }));
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

  // The holiday calendar rides along so the admin UI needs a single fetch.
  router.get('/menus', async (_request, response) => {
    try {
      const current = await repository.loadState();
      const settings = isRecord(current.data.settings) ? current.data.settings : {};
      return response.status(200).json({
        menus: storedMenus(settings),
        holidays: upcomingHolidays(new Date(), 13),
        today: dubaiDayString(),
      });
    } catch (error) {
      logger.error('holiday menus read failed', error);
      return response.status(503).json({ error: 'holiday menus unavailable' });
    }
  });

  // Full-array replace: the admin UI always sends the complete list it shows.
  router.put('/menus', async (request, response) => {
    const body = isRecord(request.body) ? request.body : {};
    const result = validateMenus(body.menus);
    if (typeof result === 'string') {
      return response.status(400).json({ error: result });
    }
    try {
      const saved = await withSettingsUpdate(repository, (settings) => ({ ...settings, holidayMenus: result }));
      if (!saved.ok) return response.status(503).json({ error: 'save did not complete, please try again' });
      return response.status(200).json({ ok: true, menus: result });
    } catch (error) {
      logger.error('holiday menus save failed', error);
      return response.status(503).json({ error: 'save did not complete, please try again' });
    }
  });

  return router;
}

module.exports = { createPublicHolidaysRouter, createHolidaysAdminRouter };
