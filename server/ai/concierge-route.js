'use strict';

// Public concierge chat for the customer site. Answers visitor questions in
// any language from the shared business knowledge base (site-knowledge):
// fixed business facts plus the live menu, package rules, dish ingredients,
// ordering status and holiday menus — everything the site and the panel know
// that is safe for a customer, never admin bookkeeping. The chat never places
// orders; ordering stays on the site or WhatsApp.

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');
const { ConciergeServiceError, createOpenAIConcierge } = require('./openai-concierge');
const { buildSiteKnowledge } = require('./site-knowledge');

const MAX_MESSAGES = 12;
const MAX_MESSAGE_LENGTH = 1000;

const ConciergeMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  })
  .strict();

const ConciergeRequestSchema = z
  .object({
    messages: z.array(ConciergeMessageSchema).min(1).max(MAX_MESSAGES),
  })
  .strict();

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Kept as the route's public knowledge builder (tests target it); the actual
// projection lives in site-knowledge and takes the WHOLE state data.
function buildKnowledgeBlock(data) {
  return buildSiteKnowledge(data);
}

function sendError(res, statusCode, code, message) {
  return res.status(statusCode).json({ error: { code, message } });
}

function createConciergeRouter({ repository, answerConcierge, client, model, env, logger = console } = {}) {
  const router = express.Router();
  const answerer = answerConcierge || createOpenAIConcierge({ client, model, env: env || process.env });

  router.use(express.json({ limit: '32kb' }));
  // Public and per-visitor-IP: strict, this endpoint spends OpenAI tokens.
  router.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 20,
      identifier: 'batmelech-site-concierge',
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler(_req, res) {
        res.set('Cache-Control', 'no-store');
        return sendError(res, 429, 'ai_rate_limited', 'Too many messages. Please try again later.');
      },
    })
  );

  router.post('/', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const request = ConciergeRequestSchema.safeParse(req.body);
    if (!request.success) {
      return sendError(res, 400, 'invalid_request', 'Invalid concierge request.');
    }

    // Live state; a failed read degrades to business facts only — the
    // concierge then simply has no live menu or prices to quote.
    let data = {};
    if (repository && typeof repository.loadState === 'function') {
      try {
        const current = await repository.loadState();
        data = isRecord(current.data) ? current.data : {};
      } catch (error) {
        logger.error('concierge state read failed', error);
        data = {};
      }
    }

    try {
      const reply = await answerer({
        messages: request.data.messages,
        knowledge: buildKnowledgeBlock(data),
      });
      return res.status(200).json({ reply });
    } catch (error) {
      if (error instanceof ConciergeServiceError) {
        return sendError(res, error.statusCode, error.code, error.message);
      }
      logger.error('concierge answer failed', error);
      return sendError(res, 502, 'ai_provider_error', 'The concierge service failed.');
    }
  });

  return router;
}

module.exports = {
  MAX_MESSAGES,
  MAX_MESSAGE_LENGTH,
  ConciergeRequestSchema,
  buildKnowledgeBlock,
  createConciergeRouter,
};
