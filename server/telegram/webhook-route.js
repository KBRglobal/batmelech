'use strict';

// Inbound Telegram webhook for מיי (Mey), Lin's assistant. Reachable
// publicly by design (Telegram must be able to POST to it) — security
// comes from the secret path segment (known only to Telegram's registered
// webhook URL) plus a hard check that the message came from the known
// staff group, not the path alone. Anything else is acknowledged and
// silently dropped, never processed.
//
// This router only routes. Photos, voice notes, button taps and locations each
// belong to a collaborator passed in, and every one of those is optional: with
// none of them wired the route behaves exactly as it did when it only spoke
// text, which is what server.js still asks for today.

const express = require('express');
const { setCourierLocation } = require('../business-actions');
const { sendTelegramMessage } = require('./send-message');

const VOICE_FAILED_TEXT = 'לא הצלחתי להבין את ההקלטה, אפשר לכתוב?';

function createTelegramWebhookRouter({
  webhookSecret,
  botToken,
  ordersChatId,
  agent,
  logger = console,
  repository = null,
  proofHandler = null,
  voiceTranscriber = null,
  callbackHandler = null,
  telegramFiles = null,
}) {
  if (typeof webhookSecret !== 'string' || !webhookSecret.trim()) {
    throw new TypeError('A webhook secret is required');
  }
  if (typeof botToken !== 'string' || !botToken.trim()) {
    throw new TypeError('A bot token is required');
  }
  if (!agent || typeof agent.reply !== 'function') {
    throw new TypeError('An agent with a reply method is required');
  }

  const fromOrdersChat = (chatId) => String(chatId) === String(ordersChatId);
  const say = (text) => sendTelegramMessage({ botToken, chatId: ordersChatId, text, logger });

  async function answerText(text) {
    const replyText = await agent.reply(text);
    await say(replyText);
  }

  // Felix's live location, either as a one-shot pin or as the stream of edits
  // Telegram sends while a shared location is running.
  async function noteLocation(location) {
    if (!repository || !location) return;
    await setCourierLocation(repository, { lat: location.latitude, lon: location.longitude });
  }

  async function handleVoice(message) {
    if (!telegramFiles || !voiceTranscriber) return;
    const filePath = await telegramFiles.getFilePath({ botToken, fileId: message.voice.file_id, logger });
    const buffer = filePath ? await telegramFiles.downloadFile({ botToken, filePath, logger }) : null;
    const transcript = buffer ? await voiceTranscriber.transcribe(buffer) : null;
    if (typeof transcript !== 'string' || transcript.trim() === '') {
      await say(VOICE_FAILED_TEXT);
      return;
    }
    // Echoing what was heard is the only way Felix can catch a misheard word.
    const replyText = await agent.reply(transcript.trim());
    await say(`🎤 "${transcript.trim()}"\n\n${replyText}`);
  }

  async function handleUpdate(body) {
    if (!body || typeof body !== 'object') return;

    if (body.callback_query) {
      const query = body.callback_query;
      const chatId = query.message && query.message.chat && query.message.chat.id;
      if (!fromOrdersChat(chatId) || !callbackHandler) return;
      await callbackHandler.handle(query);
      return;
    }

    const edited = body.edited_message && typeof body.edited_message === 'object' ? body.edited_message : null;
    const message = (body.message && typeof body.message === 'object' ? body.message : null) || edited;
    if (!message) return;
    if (!fromOrdersChat(message.chat && message.chat.id)) return;

    // An edited message is almost always Telegram streaming a live location.
    // Edited *text* has always been ignored — re-running מיי on a corrected
    // sentence would act on the same instruction twice.
    if (edited && !body.message) {
      if (message.location) await noteLocation(message.location);
      return;
    }

    if (Array.isArray(message.photo) && message.photo.length > 0) {
      if (proofHandler) await proofHandler.handlePhoto(message);
      return;
    }

    if (message.voice && message.voice.file_id) {
      await handleVoice(message);
      return;
    }

    if (message.location) {
      await noteLocation(message.location);
      return;
    }

    const text = typeof message.text === 'string' ? message.text : '';
    if (!text.trim()) return;
    await answerText(text);
  }

  const router = express.Router();
  router.use(express.json({ limit: '256kb' }));

  router.post(`/${webhookSecret}`, (request, response) => {
    // Ack immediately — Telegram retries aggressively on slow/failed
    // responses, and the actual work can safely happen after we've replied.
    response.status(200).json({ ok: true });
    handleUpdate(request.body).catch((error) => logger.error('mey webhook handling failed', error));
  });

  return router;
}

module.exports = { VOICE_FAILED_TEXT, createTelegramWebhookRouter };
