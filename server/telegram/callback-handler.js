'use strict';

// Every inline-keyboard tap Felix makes lands here. The buttons are built in
// delivery-messages.js, so the contract is that file's: `d|<action>|<token>`,
// where the token is the order's meyToken and `-` is the reserved token for the
// one action that is not about a specific order (cancel).
//
// The acknowledgement goes out before anything else, always. Telegram spins the
// button until answerCallbackQuery returns, so a slow state write or a failed
// lookup must never be what Felix is staring at.

const {
  revertDeliveryProof,
  setDeliveryCheckin,
  setDeliveryProof,
  setOrderStatus,
  setPendingProof,
} = require('../business-actions');
const {
  DELIVERED_STATUS,
  dubaiDateString,
  findByToken,
  orderName,
  selectDeliveryDay,
} = require('./delivery-day');
const { delayAdvice } = require('./delivery-messages');
const { proofConfirmation } = require('./proof-of-delivery');
const { answerCallbackQuery, sendTelegramMessage } = require('./send-message');

const CHECKIN_STATES = { otw: 'onTheWay', ontime: 'onTime', late: 'delayed' };
const CANCEL_TOKEN = '-';
const UNKNOWN_ORDER_TEXT = 'לא הצלחתי לזהות את ההזמנה';
const CANCELLED_TEXT = 'בסדר, ביטלתי. התמונה לא שויכה לאף משלוח.';
const FAILED_TEXT = 'משהו השתבש אצלי ולא הצלחתי לעדכן, נסה שוב עוד רגע';

function parseData(data) {
  if (typeof data !== 'string') return null;
  const parts = data.split('|');
  if (parts.length !== 3 || parts[0] !== 'd') return null;
  const [, action, token] = parts;
  if (action === '' || token === '') return null;
  return { action, token };
}

function draftRequest(name) {
  return `נסחי בבקשה הודעה קצרה ומכובדת ללקוח/ה ${name} שהמשלוח מתעכב, שפליקס/לין יוכלו להעתיק ולשלוח בעצמם. אל תשלחי כלום בעצמך.`;
}

function createCallbackHandler({ repository, botToken, chatId, agent, logger = console } = {}) {
  if (!repository || typeof repository.loadState !== 'function') {
    throw new TypeError('A state repository is required');
  }

  function say(text, replyMarkup) {
    return sendTelegramMessage({ botToken, chatId, text, replyMarkup, logger });
  }

  return {
    async handle(callbackQuery) {
      const query = callbackQuery && typeof callbackQuery === 'object' ? callbackQuery : {};
      await answerCallbackQuery({ botToken, callbackQueryId: query.id, logger });

      const parsed = parseData(query.data);
      if (parsed === null) {
        logger.error('callback: unparseable data', String(query.data));
        return;
      }
      const { action, token } = parsed;

      // The photo-was-ambiguous keyboard carries a cancel button that belongs to
      // no order, so it is settled before any lookup happens.
      if (action === 'cancel') {
        await setPendingProof(repository, null);
        await say(CANCELLED_TEXT);
        return;
      }

      const state = await repository.loadState();
      // Delivered orders stay in scope: undo exists precisely to walk one back.
      const day = selectDeliveryDay(state.data, dubaiDateString(), { includeDelivered: true });
      const order = findByToken(day, token);
      if (order === null) {
        await say(UNKNOWN_ORDER_TEXT);
        return;
      }
      const name = orderName(order);

      if (Object.hasOwn(CHECKIN_STATES, action)) {
        const result = await setDeliveryCheckin(repository, order.id, { state: CHECKIN_STATES[action] });
        if (!result.ok) {
          logger.error('callback: checkin failed', result.error || '');
          await say(FAILED_TEXT);
          return;
        }
        // delayAdvice already opens with "רשמתי שאתה מתעכב", so for `late` it is
        // the confirmation — a separate short line would just say it twice.
        if (action === 'late') {
          const advice = delayAdvice(order);
          await say(advice.text, advice.reply_markup);
          return;
        }
        await say(action === 'otw' ? `רשמתי שאתה בדרך — ${name}.` : `מעולה, רשמתי שאתה מגיע בזמן — ${name}.`);
        return;
      }

      if (action === 'proof') {
        const settings = state.data && typeof state.data.settings === 'object' && state.data.settings !== null
          ? state.data.settings
          : {};
        const pending = settings.meyPendingProof;
        // No parked photo means this came from the "נמסר עכשיו" escalation
        // button: Felix is confirming the delivery itself, with no evidence.
        if (!pending || typeof pending.url !== 'string') {
          const result = await setOrderStatus(repository, order.id, DELIVERED_STATUS);
          if (!result.ok) {
            logger.error('callback: mark delivered failed', result.error || '');
            await say(FAILED_TEXT);
            return;
          }
          await say(`סימנתי ש${name} נמסרה. תודה!`);
          return;
        }
        const result = await setDeliveryProof(repository, order.id, {
          url: pending.url,
          at: pending.at,
          by: pending.by,
        });
        if (!result.ok) {
          logger.error('callback: attach pending proof failed', result.error || '');
          await say(FAILED_TEXT);
          return;
        }
        await setPendingProof(repository, null);
        const done = proofConfirmation(day, result.order, token);
        await say(done.text, done.reply_markup);
        return;
      }

      if (action === 'undo') {
        const result = await revertDeliveryProof(repository, order.id);
        if (!result.ok) {
          logger.error('callback: undo failed', result.error || '');
          await say(FAILED_TEXT);
          return;
        }
        await say(`בסדר, ${name} שוב לא מסומן כנמסר.`);
        return;
      }

      if (action === 'draft') {
        if (!agent || typeof agent.reply !== 'function') {
          logger.error('callback: draft requested with no agent');
          await say(FAILED_TEXT);
          return;
        }
        const drafted = await agent.reply(draftRequest(name));
        if (typeof drafted === 'string' && drafted.trim() !== '') await say(drafted.trim());
        return;
      }

      logger.error('callback: unknown action', action);
    },
  };
}

module.exports = { CANCEL_TOKEN, UNKNOWN_ORDER_TEXT, CANCELLED_TEXT, FAILED_TEXT, createCallbackHandler };
