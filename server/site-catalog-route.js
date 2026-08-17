'use strict';

// Public, read-only menu catalog for the customer-facing site: dish names,
// descriptions, photos, and prices, projected from the same menu the admin
// app edits. Strictly whitelisted field by field — the raw menu object also
// carries admin-only bookkeeping (itemIds, unknown preserved fields) that
// must never leak. This route never writes.

const express = require('express');
const { rateLimit } = require('express-rate-limit');

const CATEGORY_KEYS = ['salads', 'firsts', 'mains', 'sides', 'desserts'];
const MAX_TEXT_LENGTH = 240;
const MAX_ITEMS = 500;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH ? value.trim() : '';
}

function usd(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000
    ? value
    : null;
}

function publicImageUrl(value) {
  const url = typeof value === 'string' ? value.trim() : '';
  return url.startsWith('https://') && url.length <= 500 ? url : null;
}

function itemMetaFor(menu, category, name) {
  const ids = isRecord(menu.itemIds) && isRecord(menu.itemIds[category]) ? menu.itemIds[category] : {};
  const metaMap = isRecord(menu.itemMeta) ? menu.itemMeta : {};
  const id = typeof ids[name] === 'string' ? ids[name] : '';
  const meta = id !== '' && isRecord(metaMap[id]) ? metaMap[id] : {};
  return {
    description: text(meta.description),
    imageUrl: publicImageUrl(meta.imageUrl),
  };
}

function projectCategories(menu) {
  const categories = {};
  for (const category of CATEGORY_KEYS) {
    const names = Array.isArray(menu[category]) ? menu[category] : [];
    categories[category] = names
      .slice(0, MAX_ITEMS)
      .map((name) => text(name))
      .filter((name) => name !== '')
      .map((name) => ({ name, ...itemMetaFor(menu, category, name) }));
  }
  return categories;
}

function projectExtras(menu) {
  const rows = Array.isArray(menu.extras) ? menu.extras : [];
  return rows
    .slice(0, MAX_ITEMS)
    .filter((row) => isRecord(row) && text(row.name) !== '')
    .map((row) => ({
      name: text(row.name),
      priceUsd: usd(row.price),
      description: text(row.description),
      imageUrl: publicImageUrl(row.imageUrl),
    }));
}

function projectLunch(menu) {
  const rows = Array.isArray(menu.lunch) ? menu.lunch : [];
  return rows
    .slice(0, MAX_ITEMS)
    .filter((row) => isRecord(row) && text(row.key) !== '')
    .map((row) => ({
      key: text(row.key),
      priceUsd: usd(row.price),
      variants: (Array.isArray(row.variants) ? row.variants : [])
        .filter((variant) => isRecord(variant) && text(variant.k) !== '')
        .map((variant) => ({
          key: text(variant.k),
          priceUsd: usd(variant.price),
          sidePriceUsd: usd(variant.sidePrice),
        })),
      addonPriceUsd: isRecord(row.addon) ? usd(row.addon.price) : null,
    }));
}

function createSiteCatalogRouter({ repository, logger = console }) {
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
      limit: 240,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    })
  );

  router.get('/', async (_request, response) => {
    try {
      const current = await repository.loadState();
      const menu = isRecord(current.data.menu) ? current.data.menu : {};
      // A short public cache keeps menu edits propagating within a minute
      // while sparing the database a read per visitor.
      response.set('Cache-Control', 'public, max-age=60');
      return response.status(200).json({
        couplePriceUsd: usd(menu.couplePrice),
        challahPriceUsd: usd(menu.challahPrice),
        categories: projectCategories(menu),
        extras: projectExtras(menu),
        lunch: projectLunch(menu),
        lunchSides: (Array.isArray(menu.lunchSides) ? menu.lunchSides : [])
          .slice(0, MAX_ITEMS)
          .map((name) => text(name))
          .filter((name) => name !== ''),
      });
    } catch (error) {
      logger.error('site catalog read failed', error);
      response.set('Cache-Control', 'no-store');
      return response.status(503).json({ error: 'catalog unavailable' });
    }
  });

  return router;
}

module.exports = { createSiteCatalogRouter };
