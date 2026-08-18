'use strict';

// Staff-only gallery feed for delivery proof photos. Mounted after the decoy
// gate, so it is only reachable with a valid staff session. It deliberately
// returns a tiny, fixed field set — no phones, notes, prices, or other PII.

const express = require('express');

function safeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function presentDeliveryPhoto(order) {
  const id = order.id !== undefined && order.id !== null ? String(order.id) : '';
  return {
    id,
    name: safeString(order.name) || 'ללא שם',
    date: safeString(order.date),
    time: safeString(order.time),
    hotelName: safeString(order.hotelName),
    deliveryProofUrl: order.deliveryProofUrl,
    deliveryProofAt: typeof order.deliveryProofAt === 'number' && Number.isFinite(order.deliveryProofAt)
      ? order.deliveryProofAt
      : null,
    status: safeString(order.status),
  };
}

function hasDeliveryProof(order) {
  return (
    order != null &&
    typeof order.deliveryProofUrl === 'string' &&
    order.deliveryProofUrl.trim().length > 0
  );
}

function createDeliveryPhotosRouter({ repository, logger = console }) {
  const router = express.Router();

  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/', async (_request, response) => {
    if (!repository || typeof repository.loadState !== 'function') {
      return response.status(503).json({ error: 'delivery photos unavailable' });
    }

    let current;
    try {
      current = await repository.loadState();
    } catch (error) {
      logger.error('delivery photos state load failed', error);
      return response.status(500).json({ error: 'delivery photos unavailable' });
    }

    const orders = Array.isArray(current?.data?.orders) ? current.data.orders : [];
    const photos = orders
      .filter(hasDeliveryProof)
      .map(presentDeliveryPhoto)
      .sort((left, right) => (right.deliveryProofAt ?? 0) - (left.deliveryProofAt ?? 0));

    return response.json({ photos });
  });

  return router;
}

module.exports = { createDeliveryPhotosRouter, presentDeliveryPhoto };
