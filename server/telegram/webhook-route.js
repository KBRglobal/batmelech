'use strict';

// Inbound Telegram webhook for מיי (Mey), Lin's assistant. Reachable
// publicly by design (Telegram must be able to POST to it) — security
// comes from the secret path segment (known only to Telegram's registered
// webhook URL) plus a hard check that the message came from the known
// staff group, not the path alone. Anything else is acknowledged and
// silently dropped, never processed.

const express = require('express');
const { sendTelegramMessage } = require('./send-message');

function createTelegramWebhookRouter({ webhookSecret, botToken, ordersChatId, agent, logger = console }) {
  if (typeof webhookSecret !== 'string' || !webhookSecret.trim()) {
    throw new TypeError('A webhook secret is required');
  }
  if (typeof botToken !== 'string' || !botToken.trim()) {
    throw new TypeError('A bot token is required');
  }
  if (!agent || typeof agent.reply !== 'function') {
    throw new TypeError('An agent with a reply method is required');
  }

  const router = express.Router();
  router.use(express.json({ limit: '256kb' }));

  router.post(`/${webhookSecret}`, (request, response) => {
    // Ack immediately — Telegram retries aggressively on slow/failed
    // responses, and the actual work can safely happen after we've replied.
    response.status(200).json({ ok: true });

    const message = request.body && request.body.message;
    const chatId = message && message.chat && message.chat.id;
    const text = message && typeof message.text === 'string' ? message.text : '';

    if (String(chatId) !== String(ordersChatId) || !text.trim()) return;

    agent
      .reply(text)
      .then((replyText) => sendTelegramMessage({ botToken, chatId: ordersChatId, text: replyText, logger }))
      .catch((error) => logger.error('mey webhook handling failed', error));
  });

  return router;
}

module.exports = { createTelegramWebhookRouter };
