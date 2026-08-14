'use strict';

// Plain HTTPS POST to the Telegram Bot API — no SDK, matching the
// convention already documented for this bot (see STATE.md / creds).

const FAILED = { ok: false, messageId: null };

async function sendTelegramMessage({ botToken, chatId, text, replyMarkup, logger = console }) {
  if (typeof botToken !== 'string' || !botToken.trim()) {
    logger.error('sendTelegramMessage: missing bot token');
    return { ...FAILED };
  }
  const body = { chat_id: chatId, text };
  // Telegram accepts reply_markup as a JSON object inside a JSON body —
  // stringifying it here would make Telegram reject it.
  if (replyMarkup && typeof replyMarkup === 'object') body.reply_markup = replyMarkup;
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      logger.error('sendTelegramMessage: non-ok response', response.status, await response.text().catch(() => ''));
      return { ...FAILED };
    }
    const payload = await response.json().catch(() => null);
    if (payload && payload.ok === false) {
      logger.error('sendTelegramMessage: api error', payload.description || '');
      return { ...FAILED };
    }
    const messageId = payload && payload.result && Number.isFinite(payload.result.message_id)
      ? payload.result.message_id
      : null;
    return { ok: true, messageId };
  } catch (error) {
    logger.error('sendTelegramMessage failed', error);
    return { ...FAILED };
  }
}

// Acknowledges an inline-keyboard tap. Telegram shows the spinner on the button
// until this is answered, so it is fire-and-forget but must never throw.
async function answerCallbackQuery({ botToken, callbackQueryId, text, logger = console }) {
  if (typeof botToken !== 'string' || !botToken.trim()) {
    logger.error('answerCallbackQuery: missing bot token');
    return { ok: false };
  }
  const body = { callback_query_id: callbackQueryId };
  if (typeof text === 'string' && text !== '') body.text = text;
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      logger.error('answerCallbackQuery: non-ok response', response.status, await response.text().catch(() => ''));
      return { ok: false };
    }
    return { ok: true };
  } catch (error) {
    logger.error('answerCallbackQuery failed', error);
    return { ok: false };
  }
}

module.exports = { sendTelegramMessage, answerCallbackQuery };
