'use strict';

// Public, read-only status for the customer-facing site (customer-site/):
// whether ordering is currently open, any site-wide banner message, and
// which menu item names are currently marked out of stock. Derived from the
// same settings the admin app edits (server/site-order-route.js is the
// sibling write path for new orders; this route never writes).

const express = require('express');
const { rateLimit } = require('express-rate-limit');

function createSiteStatusRouter({ repository, logger = console }) {
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

  router.get('/', async (_request, response) => {
    try {
      const current = await repository.loadState();
      const settings = current.data.settings && typeof current.data.settings === 'object' ? current.data.settings : {};
      const outOfStockNames = Array.isArray(settings.out)
        ? settings.out.filter((value) => typeof value === 'string')
        : [];
      return response.status(200).json({
        orderingOpen: settings.orderingOpen !== false,
        siteBanner: typeof settings.siteBanner === 'string' && settings.siteBanner.trim() ? settings.siteBanner : null,
        outOfStockNames,
      });
    } catch (error) {
      logger.error('site status read failed', error);
      return response.status(503).json({ error: 'status unavailable' });
    }
  });

  return router;
}

module.exports = { createSiteStatusRouter };
