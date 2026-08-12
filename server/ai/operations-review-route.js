'use strict';

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');
const { OperationsReviewInputSchema } = require('./operations-review-schema');
const {
  OperationsReviewServiceError,
  createOpenAIOperationsReview,
} = require('./openai-operations-review');

const MAX_OPERATIONS_REVIEW_JSON_LENGTH = 75_000;
const OPERATIONS_REVIEW_RATE_LIMIT = Object.freeze({
  limit: 20,
  windowMs: 15 * 60 * 1000,
});

const OperationsReviewRequestSchema = z
  .object({ snapshot: OperationsReviewInputSchema })
  .strict();

function sendError(res, statusCode, code, message) {
  return res.status(statusCode).json({ error: { code, message } });
}

function requestIsTooLarge(body) {
  try {
    const serialized = JSON.stringify(body);
    return typeof serialized === 'string' && serialized.length > MAX_OPERATIONS_REVIEW_JSON_LENGTH;
  } catch {
    return true;
  }
}

function createOperationsReviewRateLimiter() {
  return rateLimit({
    ...OPERATIONS_REVIEW_RATE_LIMIT,
    identifier: 'batmelech-operations-review',
    keyGenerator: () => 'authenticated-batmelech-staff',
    legacyHeaders: false,
    standardHeaders: 'draft-8',
    handler(_req, res) {
      res.set('Cache-Control', 'no-store');
      return sendError(
        res,
        429,
        'ai_rate_limited',
        'Too many operations review requests. Please try again later.'
      );
    },
  });
}

function createOperationsReviewHandler({ reviewOperations } = {}) {
  if (typeof reviewOperations !== 'function') {
    throw new TypeError('reviewOperations must be a function.');
  }

  return async function operationsReviewHandler(req, res) {
    res.set('Cache-Control', 'no-store');

    if (requestIsTooLarge(req.body)) {
      return sendError(res, 413, 'request_too_large', 'Operations review request is too large.');
    }

    const request = OperationsReviewRequestSchema.safeParse(req.body);
    if (!request.success) {
      return sendError(res, 400, 'invalid_request', 'Invalid operations review request.');
    }

    try {
      const review = await reviewOperations(request.data.snapshot);
      return res.status(200).json({ review });
    } catch (error) {
      if (error instanceof OperationsReviewServiceError) {
        return sendError(res, error.statusCode, error.code, error.message);
      }
      return sendError(res, 502, 'ai_provider_error', 'The operations review service failed.');
    }
  };
}

function createOperationsReviewRouter({ reviewOperations, client, model, env } = {}) {
  const router = express.Router();
  const reviewer =
    reviewOperations || createOpenAIOperationsReview({ client, model, env: env || process.env });

  router.post(
    '/',
    createOperationsReviewRateLimiter(),
    createOperationsReviewHandler({ reviewOperations: reviewer })
  );
  return router;
}

module.exports = {
  MAX_OPERATIONS_REVIEW_JSON_LENGTH,
  OPERATIONS_REVIEW_RATE_LIMIT,
  OperationsReviewRequestSchema,
  createOperationsReviewHandler,
  createOperationsReviewRateLimiter,
  createOperationsReviewRouter,
};
