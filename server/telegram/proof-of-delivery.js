'use strict';

// Felix photographs the bag at the door. This turns that photo into a stored
// object plus a status change on exactly one order.
//
// The whole difficulty is "which order". Felix sends a bare photo with no
// context, so we upload first (the bytes are evidence either way and Telegram's
// file path expires quickly) and only then try to identify the delivery, from
// the strongest signal to the weakest. When nothing is conclusive we do not
// guess: the photo is parked as a pending proof and מיי asks him to tap.

const crypto = require('node:crypto');

const {
  setDeliveryProof,
  setPendingProof,
} = require('../business-actions');
const {
  DELIVERED_STATUS,
  dubaiDateString,
  nextStop,
  selectDeliveryDay,
} = require('./delivery-day');
const { proofAmbiguous, proofRecorded } = require('./delivery-messages');
const { downloadFile, getFilePath } = require('./telegram-files');
const { sendTelegramMessage } = require('./send-message');

const MAX_ATTEMPTS = 5;
const AWAITING_REPLY_WINDOW_MS = 45 * 60 * 1000;
const IN_TRANSIT_STATUS = 'במשלוח';
const SAVE_FAILED_TEXT = 'קיבלתי את התמונה אבל לא הצלחתי לשמור אותה, נסו שוב';
const NO_CANDIDATES_TEXT = 'קיבלתי את התמונה, אבל אין היום משלוח פתוח לשייך אותה אליו.';

// business-actions.js owns every order write, but it exposes no "just give this
// order a token" primitive: the one place a meyToken is minted is
// markDeliveryNudge, where minting is welded to setting a nudge marker. Calling
// that here would silently suppress a later reminder for an order Felix has not
// delivered yet. So the mint lives here, as its own narrow load-mutate-save
// with the same retry and the same idempotence guard (an order that already has
// a token is never written), and it exists only because delivery-messages.js
// hard-requires a token to build the undo / disambiguation buttons.
async function ensureToken(repository, orderId) {
  const id = String(orderId);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const current = await repository.loadState();
    const orders = Array.isArray(current.data.orders) ? current.data.orders : [];
    const existing = orders.find((order) => String(order.id) === id);
    if (!existing) return null;
    if (typeof existing.meyToken === 'string' && existing.meyToken.trim() !== '') {
      return existing.meyToken.trim();
    }
    const token = crypto.randomBytes(4).toString('hex');
    const saved = await repository.saveState({
      baseState: current.data,
      localState: {
        ...current.data,
        orders: orders.map((order) => (String(order.id) === id ? { ...order, meyToken: token } : order)),
      },
      baseRevision: current.revision,
      baseHash: current.hash,
      requestId: crypto.randomUUID(),
    });
    if (saved.ok) return token;
  }
  return null;
}

function rawName(order) {
  return order && typeof order.name === 'string' ? order.name.trim() : '';
}

// Felix types "אטלנטיס" under a photo for an order named "משפחת כהן - אטלנטיס",
// or the full name when he copies it. Either direction counts as a match.
function captionMatches(caption, order) {
  const name = rawName(order).toLowerCase();
  if (name === '') return false;
  const typed = caption.toLowerCase();
  return name.includes(typed) || typed.includes(name);
}

function only(orders) {
  return orders.length === 1 ? orders[0] : null;
}

// Strongest signal first. Each rule only ever returns a match it is sure of;
// anything less falls through to the next one and ultimately to "ask Felix".
function resolveOrder(active, message, now) {
  const replyTo = message.reply_to_message && Number(message.reply_to_message.message_id);
  if (Number.isFinite(replyTo)) {
    const byPrompt = only(active.filter((order) => Number(order.meyPromptMessageId) === replyTo));
    if (byPrompt) return byPrompt;
  }

  const caption = typeof message.caption === 'string' ? message.caption.trim() : '';
  if (caption !== '') {
    const byCaption = only(active.filter((order) => captionMatches(caption, order)));
    if (byCaption) return byCaption;
  }

  const inTransit = only(active.filter((order) => order.status === IN_TRANSIT_STATUS));
  if (inTransit) return inTransit;

  const cutoff = now - AWAITING_REPLY_WINDOW_MS;
  const awaiting = only(active.filter((order) => {
    const since = Number(order.meyAwaitingReplySince);
    return Number.isFinite(since) && since >= cutoff;
  }));
  if (awaiting) return awaiting;

  return only(active);
}

function createProofHandler({
  repository,
  storage,
  botToken,
  chatId,
  logger = console,
  now = () => new Date(),
} = {}) {
  if (!repository || typeof repository.loadState !== 'function') {
    throw new TypeError('A state repository is required');
  }

  function say(text, replyMarkup) {
    return sendTelegramMessage({ botToken, chatId, text, replyMarkup, logger });
  }

  return {
    async handlePhoto(message) {
      const photos = message && Array.isArray(message.photo) ? message.photo : [];
      if (photos.length === 0) return;
      // Telegram sends the same photo in ascending sizes; the last is the best.
      const fileId = photos[photos.length - 1] && photos[photos.length - 1].file_id;

      const at = now();
      const day = dubaiDateString(at);
      const by = message.from && typeof message.from.first_name === 'string' ? message.from.first_name : undefined;

      const filePath = await getFilePath({ botToken, fileId, logger });
      const buffer = filePath === null ? null : await downloadFile({ botToken, filePath, logger });
      if (buffer === null) {
        await say(SAVE_FAILED_TEXT);
        return;
      }

      const state = await repository.loadState();
      const active = selectDeliveryDay(state.data, day);
      const target = resolveOrder(active, message, at.getTime());

      // Uploaded before the order is known: the key wants an id, and "pending"
      // is a real, addressable bucket of its own.
      const stored = storage && typeof storage.putProofPhoto === 'function'
        ? await storage.putProofPhoto({
          orderId: target ? target.id : 'pending',
          dateString: day,
          buffer,
          contentType: 'image/jpeg',
        })
        : null;
      if (!stored || typeof stored.url !== 'string') {
        await say(SAVE_FAILED_TEXT);
        return;
      }

      if (target === null) {
        if (active.length === 0) {
          await say(NO_CANDIDATES_TEXT);
          return;
        }
        const pending = await setPendingProof(repository, { url: stored.url, at: at.getTime(), by });
        if (!pending.ok) {
          logger.error('proof: could not park pending photo', pending.error || '');
          await say(SAVE_FAILED_TEXT);
          return;
        }
        const candidates = [];
        for (const order of active) {
          const token = await ensureToken(repository, order.id);
          if (token !== null) candidates.push({ ...order, meyToken: token });
        }
        if (candidates.length === 0) {
          await say(NO_CANDIDATES_TEXT);
          return;
        }
        const ask = proofAmbiguous(candidates);
        await say(ask.text, ask.reply_markup);
        return;
      }

      // Minted before the write so the confirmation's undo button has a token
      // that findByToken can resolve back to this exact order.
      const token = await ensureToken(repository, target.id);
      const result = await setDeliveryProof(repository, target.id, { url: stored.url, at: at.getTime(), by });
      if (!result.ok) {
        logger.error('proof: could not attach photo to order', result.error || '');
        await say(SAVE_FAILED_TEXT);
        return;
      }

      // `active` is the pre-write view, so the delivered order still sits in it
      // at its route position and nextStop walks forward from there.
      const next = nextStop(
        active.map((order) => (String(order.id) === String(target.id) ? { ...order, status: DELIVERED_STATUS } : order)),
        target.id,
      );
      // No token means no undo button — say it plainly rather than let the
      // message builder throw and leave Felix with silence.
      if (token === null) {
        await say(`נשמר ✅ צילום המסירה של ${orderName(result.order)}. סימנתי כנמסר.`);
        return;
      }
      const done = proofRecorded({ ...result.order, meyToken: token }, next);
      await say(done.text, done.reply_markup);
    },
  };
}

module.exports = { AWAITING_REPLY_WINDOW_MS, SAVE_FAILED_TEXT, NO_CANDIDATES_TEXT, createProofHandler };
