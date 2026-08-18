'use strict';

// Public concierge chat for the customer site. Answers visitor questions in
// any language from a knowledge block built server-side: fixed business facts
// plus the live menu projected from state the same way site-catalog-route
// projects it (names and prices only — never admin bookkeeping, never
// hardcoded prices). The chat never places orders; ordering stays on the site
// or WhatsApp.

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');
const { ConciergeServiceError, createOpenAIConcierge } = require('./openai-concierge');

const MAX_MESSAGES = 12;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_TEXT_LENGTH = 240;
const MAX_ITEMS = 500;
const CATEGORY_LABELS = Object.freeze({
  salads: 'Salads',
  firsts: 'First courses',
  mains: 'Main courses',
  sides: 'Sides',
  desserts: 'Desserts',
});

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

// Fixed facts that do not live in menu state. Prices that DO live in state
// (dishes, packages) are never written here — they come from the projection.
const BUSINESS_FACTS = [
  'Bat Melech Kitchen is a kosher home kitchen in Dubai — fresh homemade Jewish cooking.',
  'Ordering happens on the website or by WhatsApp at +971 58 628 8776. This chat cannot place, confirm, or change orders.',
  'Delivery fee: Dubai $15, Abu Dhabi $55. Self-pickup is free.',
  'Payment is on delivery: cash, bank transfer, Bit, or PayBox.',
  'The kitchen offers a weekday menu and Shabbat packages, plus royal Shabbat extras ordered a la carte.',
].join('\n- ');

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

function names(list) {
  return (Array.isArray(list) ? list : [])
    .slice(0, MAX_ITEMS)
    .map((name) => text(name))
    .filter((name) => name !== '');
}

function priced(name, priceUsd) {
  return priceUsd === null ? name : `${name} — $${priceUsd}`;
}

function projectMenuKnowledge(menu) {
  const lines = [];
  const couplePrice = usd(menu.couplePrice);
  if (couplePrice !== null) {
    lines.push(`Shabbat package for two, base price: $${couplePrice}.`);
  }
  lines.push('The Shabbat package is built from the categories below; the dishes listed are included in the package price:');
  for (const [category, label] of Object.entries(CATEGORY_LABELS)) {
    const dishes = names(menu[category]);
    if (dishes.length > 0) lines.push(`${label}: ${dishes.join(', ')}.`);
  }
  const challahPrice = usd(menu.challahPrice);
  if (challahPrice !== null) lines.push(`Challah: $${challahPrice} each.`);

  const extras = (Array.isArray(menu.extras) ? menu.extras : [])
    .slice(0, MAX_ITEMS)
    .filter((row) => isRecord(row) && text(row.name) !== '')
    .map((row) => priced(text(row.name), usd(row.price)));
  if (extras.length > 0) lines.push(`Shabbat extras, a la carte: ${extras.join('; ')}.`);

  const lunch = (Array.isArray(menu.lunch) ? menu.lunch : [])
    .slice(0, MAX_ITEMS)
    .filter((row) => isRecord(row) && text(row.key) !== '')
    .map((row) => {
      const variants = (Array.isArray(row.variants) ? row.variants : [])
        .filter((variant) => isRecord(variant) && text(variant.k) !== '')
        .map((variant) => priced(text(variant.k), usd(variant.price)));
      const base = priced(text(row.key), usd(row.price));
      return variants.length > 0 ? `${base} (${variants.join(', ')})` : base;
    });
  if (lunch.length > 0) lines.push(`Weekday menu: ${lunch.join('; ')}.`);

  const lunchSides = names(menu.lunchSides);
  if (lunchSides.length > 0) lines.push(`Weekday sides: ${lunchSides.join(', ')}.`);

  return lines;
}

function buildKnowledgeBlock(menu) {
  const menuLines = projectMenuKnowledge(isRecord(menu) ? menu : {});
  return [
    `Business facts:\n- ${BUSINESS_FACTS}`,
    `Live menu (current names and prices, USD):\n- ${menuLines.join('\n- ')}`,
  ].join('\n\n');
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

    // Live menu from state; a failed read degrades to business facts only —
    // the concierge then simply has no dish prices to quote.
    let menu = {};
    if (repository && typeof repository.loadState === 'function') {
      try {
        const current = await repository.loadState();
        menu = isRecord(current.data.menu) ? current.data.menu : {};
      } catch (error) {
        logger.error('concierge state read failed', error);
        menu = {};
      }
    }

    try {
      const reply = await answerer({
        messages: request.data.messages,
        knowledge: buildKnowledgeBlock(menu),
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
