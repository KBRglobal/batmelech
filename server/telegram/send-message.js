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

// "מיי מקלידה…" — Telegram shows the indicator for about five seconds per
// call, so a long answer needs it repeated. Fire-and-forget, never throws.
async function sendTelegramChatAction({ botToken, chatId, action = 'typing', logger = console }) {
  if (typeof botToken !== 'string' || !botToken.trim()) return { ok: false };
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action }),
    });
    return { ok: response.ok };
  } catch (error) {
    logger.error('sendTelegramChatAction failed', error);
    return { ok: false };
  }
}

const TYPING_REPEAT_MS = 4_000;

/**
 * Keeps the typing indicator alive while `work` runs; resolves to work's
 * result. The indicator is UX only — a failure to send it is ignored.
 */
async function whileTyping({ botToken, chatId, logger = console }, work) {
  const ping = () => sendTelegramChatAction({ botToken, chatId, logger }).catch(() => {});
  ping();
  const timer = setInterval(ping, TYPING_REPEAT_MS);
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}

module.exports = { sendTelegramMessage, answerCallbackQuery, sendTelegramChatAction, whileTyping };
