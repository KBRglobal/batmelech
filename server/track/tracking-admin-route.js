'use strict';

// Staff-only helper: given an order id, return the signed customer tracking
// path for it. Carries no auth of its own — it MUST be mounted behind the
// decoy gate in server.js, like every other staff API. Returns a relative
// path ({url: "/t/<id>/<sig>"}); the admin client prefixes its own origin.

const express = require('express');
const { trackingPath } = require('./tracking-token');

const ORDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function createTrackingAdminRouter({ sessionSecret }) {
  if (typeof sessionSecret !== 'string' || sessionSecret === '') {
    throw new TypeError('sessionSecret required');
  }

  const router = express.Router();

  router.get('/:orderId', (request, response) => {
    response.set('Cache-Control', 'no-store');
    const orderId = request.params.orderId;
    if (!ORDER_ID_PATTERN.test(orderId)) {
      return response.status(400).json({ error: 'invalid order id' });
    }
    return response.status(200).json({ url: trackingPath(orderId, sessionSecret) });
  });

  return router;
}

module.exports = { createTrackingAdminRouter };
