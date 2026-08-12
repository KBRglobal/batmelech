'use strict';

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');
const { MAX_CATALOG_ITEMS, OrderCatalogSchema } = require('./order-intake-schema');
const {
  OrderIntakeServiceError,
  createOpenAIOrderIntake,
} = require('./openai-order-intake');

const MAX_MESSAGE_LENGTH = 6000;
const MAX_CATALOG_JSON_LENGTH = 100000;
const ORDER_INTAKE_RATE_LIMIT = Object.freeze({
  limit: 30,
  windowMs: 15 * 60 * 1000,
});

const OrderIntakeRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
    catalog: OrderCatalogSchema,
  })
  .strict();

function sendError(res, statusCode, code, message) {
  return res.status(statusCode).json({
    error: { code, message },
  });
}

function requestIsTooLarge(body) {
  if (body && typeof body.message === 'string' && body.message.length > MAX_MESSAGE_LENGTH) {
    return true;
  }
  if (body && Array.isArray(body.catalog) && body.catalog.length > MAX_CATALOG_ITEMS) {
    return true;
  }

  try {
    const serializedCatalog = JSON.stringify(body && body.catalog);
    return (
      typeof serializedCatalog === 'string' &&
      serializedCatalog.length > MAX_CATALOG_JSON_LENGTH
    );
  } catch {
    return true;
  }
}

function createOrderIntakeRateLimiter() {
  return rateLimit({
    ...ORDER_INTAKE_RATE_LIMIT,
    identifier: 'batmelech-order-intake',
    keyGenerator: () => 'authenticated-batmelech-staff',
    legacyHeaders: false,
    standardHeaders: 'draft-8',
    handler(_req, res) {
      res.set('Cache-Control', 'no-store');
      return sendError(
        res,
        429,
        'ai_rate_limited',
        'Too many order review requests. Please try again later.'
      );
    },
  });
}

function createOrderIntakeHandler({ reviewOrderIntake } = {}) {
  if (typeof reviewOrderIntake !== 'function') {
    throw new TypeError('reviewOrderIntake must be a function.');
  }

  return async function orderIntakeHandler(req, res) {
    res.set('Cache-Control', 'no-store');

    if (requestIsTooLarge(req.body)) {
      return sendError(res, 413, 'request_too_large', 'Order intake request is too large.');
    }

    const request = OrderIntakeRequestSchema.safeParse(req.body);
    if (!request.success) {
      return sendError(res, 400, 'invalid_request', 'Invalid order intake request.');
    }

    try {
      const review = await reviewOrderIntake(request.data);
      return res.status(200).json({ review });
    } catch (error) {
      if (error instanceof OrderIntakeServiceError) {
        return sendError(res, error.statusCode, error.code, error.message);
      }
      return sendError(res, 502, 'ai_provider_error', 'The order review service failed.');
    }
  };
}

function createOrderIntakeRouter({ reviewOrderIntake, client, model, env } = {}) {
  const router = express.Router();
  const reviewer =
    reviewOrderIntake || createOpenAIOrderIntake({ client, model, env: env || process.env });

  router.post(
    '/',
    createOrderIntakeRateLimiter(),
    createOrderIntakeHandler({ reviewOrderIntake: reviewer })
  );
  return router;
}

module.exports = {
  MAX_CATALOG_JSON_LENGTH,
  MAX_MESSAGE_LENGTH,
  ORDER_INTAKE_RATE_LIMIT,
  OrderIntakeRequestSchema,
  createOrderIntakeHandler,
  createOrderIntakeRateLimiter,
  createOrderIntakeRouter,
};
