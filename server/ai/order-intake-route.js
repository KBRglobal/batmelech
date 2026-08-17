'use strict';

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');
const { MAX_CATALOG_ITEMS, OrderCatalogSchema } = require('./order-intake-schema');
const {
  OrderIntakeServiceError,
  createOpenAIOrderIntake,
} = require('./openai-order-intake');
const {
  ChatImageServiceError,
  MAX_IMAGE_DATA_URL_LENGTH,
  createOpenAIChatImageTranscriber,
  isValidImageDataUrl,
} = require('./openai-chat-image');
const { normalizeWhatsAppInput } = require('./whatsapp-chat');

// Large enough for a whole exported WhatsApp thread (the approved
// whole-conversation path), not just a single pasted message.
const MAX_MESSAGE_LENGTH = 24000;
const MAX_CATALOG_JSON_LENGTH = 100000;
const ORDER_INTAKE_RATE_LIMIT = Object.freeze({
  limit: 30,
  windowMs: 15 * 60 * 1000,
});

// Exactly one input: pasted/uploaded text (a message or a whole exported
// chat), or a chat screenshot as a data URL — never both at once.
const OrderIntakeRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH).optional(),
    image: z
      .string()
      .min(1)
      .max(MAX_IMAGE_DATA_URL_LENGTH)
      .refine((value) => isValidImageDataUrl(value), { message: 'invalid image data url' })
      .optional(),
    catalog: OrderCatalogSchema,
  })
  .strict()
  .refine((request) => (request.message === undefined) !== (request.image === undefined), {
    message: 'exactly one of message or image is required',
  });

function sendError(res, statusCode, code, message) {
  return res.status(statusCode).json({
    error: { code, message },
  });
}

function requestIsTooLarge(body) {
  if (body && typeof body.message === 'string' && body.message.length > MAX_MESSAGE_LENGTH) {
    return true;
  }
  if (body && typeof body.image === 'string' && body.image.length > MAX_IMAGE_DATA_URL_LENGTH) {
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

function createOrderIntakeHandler({ reviewOrderIntake, transcribeChatImage } = {}) {
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
      let sourceText = request.data.message;
      if (request.data.image !== undefined) {
        if (typeof transcribeChatImage !== 'function') {
          return sendError(res, 503, 'ai_not_configured', 'Screenshot reading is unavailable.');
        }
        sourceText = await transcribeChatImage(request.data.image);
      }
      // The transcript the model reads is the transcript the operator must
      // see and the review is grounded against — one shared normalization.
      const conversation = normalizeWhatsAppInput(sourceText).slice(0, MAX_MESSAGE_LENGTH);
      if (conversation === '') {
        return sendError(res, 400, 'invalid_request', 'Invalid order intake request.');
      }
      const review = await reviewOrderIntake({
        message: conversation,
        catalog: request.data.catalog,
      });
      return res.status(200).json({ review, conversation });
    } catch (error) {
      if (error instanceof OrderIntakeServiceError || error instanceof ChatImageServiceError) {
        return sendError(res, error.statusCode, error.code, error.message);
      }
      return sendError(res, 502, 'ai_provider_error', 'The order review service failed.');
    }
  };
}

function createOrderIntakeRouter({ reviewOrderIntake, transcribeChatImage, client, model, env } = {}) {
  const router = express.Router();
  const reviewer =
    reviewOrderIntake || createOpenAIOrderIntake({ client, model, env: env || process.env });
  const imageTranscriber =
    transcribeChatImage ||
    createOpenAIChatImageTranscriber({ client, model, env: env || process.env });

  // Screenshots ride in the JSON body as data URLs, so the body cap must
  // exceed the image cap. Scoped to this router only.
  router.use(express.json({ limit: '10mb' }));
  router.post(
    '/',
    createOrderIntakeRateLimiter(),
    createOrderIntakeHandler({ reviewOrderIntake: reviewer, transcribeChatImage: imageTranscriber })
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
