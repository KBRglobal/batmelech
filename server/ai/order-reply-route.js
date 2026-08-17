'use strict';

// Drafts the WhatsApp reply Lin copies to the customer after she approved an
// intake review. Read-only: nothing is ever sent anywhere by the system.
// The pricing in `summary` comes from the panel's own pricing engine — the
// AI only phrases it, and the numeric grounding check in openai-order-reply
// rejects any drafted number that does not appear in the supplied data.

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');
const { OrderReplyServiceError, createOpenAIOrderReply } = require('./openai-order-reply');

const MAX_CONVERSATION_LENGTH = 24000;

const SummaryLineSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    qty: z.number().int().min(1).max(1000),
    priceUsd: z.number().finite().nonnegative().max(1_000_000).nullable(),
  })
  .strict();

const OrderReplyRequestSchema = z
  .object({
    conversation: z.string().trim().min(1).max(MAX_CONVERSATION_LENGTH),
    summary: z
      .object({
        lines: z.array(SummaryLineSchema).max(100),
        totalUsd: z.number().finite().nonnegative().max(1_000_000).nullable(),
        serviceDate: z.string().trim().min(1).max(40).nullable(),
        serviceTime: z.string().trim().min(1).max(40).nullable(),
        deliveryLocation: z.string().trim().min(1).max(300).nullable(),
        fulfillment: z.enum(['delivery', 'pickup', 'unknown']),
      })
      .strict(),
    missing: z.array(z.string().trim().min(1).max(200)).max(30),
  })
  .strict();

function sendError(res, statusCode, code, message) {
  return res.status(statusCode).json({ error: { code, message } });
}

function readStyleNote(settings) {
  const note = settings && typeof settings.waReplyStyle === 'string' ? settings.waReplyStyle.trim() : '';
  return note === '' ? null : note.slice(0, 2000);
}

function createOrderReplyRouter({ repository, draftOrderReply, client, model, env } = {}) {
  const router = express.Router();
  const drafter = draftOrderReply || createOpenAIOrderReply({ client, model, env: env || process.env });

  router.use(express.json({ limit: '512kb' }));
  router.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 30,
      identifier: 'batmelech-order-reply',
      keyGenerator: () => 'authenticated-batmelech-staff',
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler(_req, res) {
        res.set('Cache-Control', 'no-store');
        return sendError(res, 429, 'ai_rate_limited', 'Too many reply drafts. Please try again later.');
      },
    })
  );

  router.post('/', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const request = OrderReplyRequestSchema.safeParse(req.body);
    if (!request.success) {
      return sendError(res, 400, 'invalid_request', 'Invalid reply draft request.');
    }

    let styleNote = null;
    if (repository && typeof repository.loadState === 'function') {
      try {
        const current = await repository.loadState();
        styleNote = readStyleNote(current.data.settings);
      } catch {
        styleNote = null;
      }
    }

    try {
      const reply = await drafter({ ...request.data, styleNote });
      return res.status(200).json({ reply });
    } catch (error) {
      if (error instanceof OrderReplyServiceError) {
        return sendError(res, error.statusCode, error.code, error.message);
      }
      return sendError(res, 502, 'ai_provider_error', 'The reply drafting service failed.');
    }
  });

  return router;
}

module.exports = {
  MAX_CONVERSATION_LENGTH,
  OrderReplyRequestSchema,
  createOrderReplyRouter,
};
