'use strict';

// Public, read-only status for the customer-facing site (customer-site/):
// whether ordering is currently open, any site-wide banner message, and
// which menu item names are currently marked out of stock. Derived from the
// same settings the admin app edits (server/site-order-route.js is the
// sibling write path for new orders; this route never writes).

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { orderingStatus } = require('./business-actions');
const { getShabbatOrChagStatus } = require('./shabbat-calendar');

function createSiteStatusRouter({ repository, logger = console, clock = () => new Date() }) {
  if (!repository || typeof repository.loadState !== 'function') {
    throw new TypeError('A state repository is required');
  }
  if (!logger || typeof logger.error !== 'function') {
    throw new TypeError('A logger with an error method is required');
  }
  if (typeof clock !== 'function') {
    throw new TypeError('clock must be a function returning a Date');
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

  router.get('/', async (_request, response) => {
    try {
      const current = await repository.loadState();
      const settings = current.data.settings && typeof current.data.settings === 'object' ? current.data.settings : {};
      const outOfStockNames = Array.isArray(settings.out)
        ? settings.out.filter((value) => typeof value === 'string')
        : [];
      // Closed is closed only until the reopen day; the value is computed per
      // request, so Sunday morning opens the site with nobody touching it.
      const ordering = orderingStatus(settings);
      // Two independent gates: the kitchen closing for a week is a setting
      // staff edit, Shabbat and yom tov are the calendar. Either one alone
      // stops orders, and neither is allowed to mask the other.
      const shabbat = getShabbatOrChagStatus(clock());
      return response.status(200).json({
        orderingOpen: ordering.open,
        reopensOn: ordering.reopensOn,
        siteBanner: typeof settings.siteBanner === 'string' && settings.siteBanner.trim() ? settings.siteBanner : null,
        outOfStockNames,
        shabbatClosed: shabbat.closed,
        shabbatLabel: shabbat.label,
        shabbatReopensAt: shabbat.reopensAt,
        shabbatOccasion: shabbat.occasion,
      });
    } catch (error) {
      logger.error('site status read failed', error);
      return response.status(503).json({ error: 'status unavailable' });
    }
  });

  return router;
}

module.exports = { createSiteStatusRouter };
