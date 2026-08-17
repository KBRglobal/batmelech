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
const CHAT_FILE_FAILED_TEXT = 'לא הצלחתי לקרוא את קובץ השיחה 😔 אפשר לנסות שוב, או להדביק את הטקסט ישירות.';
const MAX_CHAT_FILE_BYTES = 300_000;

const INTAKE_ERROR_TEXTS = {
  frozen: 'מצב הקפאה פעיל — אני לא יוצרת הזמנות כרגע. שחרור מהפאנל, בהגדרות.',
  empty: 'הקובץ ריק או לא בפורמט של ייצוא שיחה מוואטסאפ.',
  menu_unavailable: 'התפריט לא זמין כרגע אז אני לא יכולה לפענח בבטחה. נסי שוב עוד רגע 🙏',
  review_failed: 'לא הצלחתי לפענח את השיחה בבטחה. אפשר לנסות שוב, או להזין את ההזמנה בפאנל.',
  save_failed: 'פיענחתי את השיחה אבל השמירה נכשלה. נסי לשלוח שוב עוד רגע 🙏',
};

// Deterministic Hebrew reply for an exported-chat file — never through
// agent.reply, same rule as the delivery-scheduler templates.
function chatFileReplyText(result) {
  if (!result.ok) return INTAKE_ERROR_TEXTS[result.error] || CHAT_FILE_FAILED_TEXT;
  const lines = ['קלטתי את השיחה ובניתי טיוטת הזמנה 🌸', ''];
  const draft = result.review.draft;
  if (draft.customerName) lines.push(`לקוח/ה: ${draft.customerName}`);
  if (draft.items.length > 0) {
    lines.push('פריטים:');
    for (const item of draft.items) {
      lines.push(`• ${item.catalogItemName}${item.quantity === null ? ' (כמות לא צוינה)' : ` x${item.quantity}`}`);
    }
  } else {
    lines.push('לא זיהיתי פריטים ודאיים — צריך לבדוק בפאנל.');
  }
  if (result.review.unknownItems.length > 0) {
    lines.push(`בקשות שלא מצאתי בתפריט: ${result.review.unknownItems.length}`);
  }
  if (result.review.missingFields.length > 0) {
    lines.push('יש פרטים חסרים — פירטתי בתוך ההזמנה.');
  }
  lines.push('');
  lines.push(`ההזמנה נשמרה לבדיקה: ${result.orderUrl}`);
  if (result.replyDraft) {
    lines.push('');
    lines.push('טיוטת תשובה ללקוח (להעתקה, את שולחת בעצמך):');
    lines.push('');
    lines.push(result.replyDraft);
  }
  return lines.join('\n');
}

function isChatTextDocument(document) {
  if (!document || typeof document !== 'object' || !document.file_id) return false;
  const name = typeof document.file_name === 'string' ? document.file_name.toLowerCase() : '';
  const mime = typeof document.mime_type === 'string' ? document.mime_type : '';
  const size = Number(document.file_size);
  if (Number.isFinite(size) && size > MAX_CHAT_FILE_BYTES) return false;
  return name.endsWith('.txt') || mime === 'text/plain';
}

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
  whatsappIntake = null,
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

  const senderOf = (message) => {
    const from = message && message.from;
    if (!from || typeof from !== 'object') return undefined;
    return { username: from.username, firstName: from.first_name };
  };

  async function answerText(text, sender) {
    const replyText = await agent.reply(text, sender);
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
    const replyText = await agent.reply(transcript.trim(), senderOf(message));
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

    // A .txt document is WhatsApp's native "Export chat" file — the approved
    // whole-conversation intake path. Runs the deterministic pipeline, never
    // the conversational agent.
    if (message.document && isChatTextDocument(message.document)) {
      if (!telegramFiles || !whatsappIntake) return;
      const filePath = await telegramFiles.getFilePath({ botToken, fileId: message.document.file_id, logger });
      const buffer = filePath ? await telegramFiles.downloadFile({ botToken, filePath, logger }) : null;
      if (!buffer || buffer.length === 0 || buffer.length > MAX_CHAT_FILE_BYTES) {
        await say(CHAT_FILE_FAILED_TEXT);
        return;
      }
      const result = await whatsappIntake.intake(buffer.toString('utf8'));
      await say(chatFileReplyText(result));
      return;
    }

    if (message.location) {
      await noteLocation(message.location);
      return;
    }

    const text = typeof message.text === 'string' ? message.text : '';
    if (!text.trim()) return;
    await answerText(text, senderOf(message));
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

module.exports = {
  CHAT_FILE_FAILED_TEXT,
  VOICE_FAILED_TEXT,
  chatFileReplyText,
  createTelegramWebhookRouter,
};
