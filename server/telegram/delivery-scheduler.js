'use strict';

// מיי's proactive clock: everything Felix receives without asking — the morning
// digest, the 90-minute heads-up, the "בדרך?" check-in and the late nudge — is
// decided here, once a minute, from state alone.
//
// Two rules hold the whole file together:
// - Claim before send. Every message is first claimed as a state write
//   (setDeliveryDigestSent / markDeliveryNudge); only a claim that came back
//   claimed:true may produce a Telegram message. A restarted process re-reads
//   the same markers and stays quiet, so a crash loop never spams Felix.
// - Dubai time, never server time. The container can run anywhere; Felix drives
//   in Dubai, so both the day boundary and the clock come from delivery-day.js.

const {
  DELIVERED_STATUS,
  buildMultiStopMapsUrl,
  destinationLabel,
  dubaiDateString,
  dubaiMinutesOfDay,
  orderStatus,
  parseClockMinutes,
  selectDeliveryDay,
  suggestRouteOrder,
} = require('./delivery-day');
const { summarizeFridayPrep, summarizeWeek, weekdayOf } = require('./business-insights');
const {
  checkinPrompt,
  digest,
  lateEscalation,
  leadReminder,
  plataPickupDigest,
  prepForecast,
  weeklyBusinessDigest,
} = require('./delivery-messages');
const {
  markDeliveryNudge,
  setDeliveryDigestSent,
  setPlataDigestSent,
  setPrepForecastSent,
  setPromptMessageId,
  setWeeklyDigestSent,
} = require('../business-actions');
const { sendTelegramMessage } = require('./send-message');

const TICK_MS = 60_000;
const DIGEST_AT_MINUTES = 8 * 60;
const LEAD_MINUTES = 90;
const CHECKIN_MINUTES = 40;
const LATE_MINUTES = 15;

// The two business messages ride the same once-a-minute tick as the delivery
// day, but on their own weekday and hour. Sunday morning looks back at the week
// that closed; Wednesday mid-morning looks forward to Friday's cooking, early
// enough to still shop for it.
const WEEKLY_DIGEST_WEEKDAY = 0; // Sunday
const WEEKLY_DIGEST_AT_MINUTES = 9 * 60;
const PREP_FORECAST_WEEKDAY = 3; // Wednesday
const PREP_FORECAST_AT_MINUTES = 10 * 60;

// --- plata pickup digest -----------------------------------------------------
// Shabbat ends and the rented hotplates are still in the hotels. Felix collects
// them on the way home, so the list goes out Saturday evening — late enough that
// Shabbat is out in Dubai, and only while plates are actually still out there.
const PLATA_DIGEST_WEEKDAY = 6; // Saturday
const PLATA_DIGEST_AT_MINUTES = 20 * 60;

function awaitsPlataPickup(order) {
  if (!order || typeof order !== 'object') return false;
  const count = Number(order.plataCount);
  if (!Number.isFinite(count) || count <= 0) return false;
  return order.plataStatus === 'withCustomer' || order.plataStatus === 'awaitingPickup';
}
// --- end plata pickup digest -------------------------------------------------

// Orders whose time Lin never wrote (or wrote as free text we cannot read) ride
// in the digest and nowhere else — there is no minute to hang a nudge on.
function timedEntries(dayOrders) {
  return dayOrders
    .map((order) => ({ order, minutes: parseClockMinutes(order && order.time) }))
    .filter((entry) => entry.minutes !== null);
}

function isDelivered(order) {
  return orderStatus(order) === DELIVERED_STATUS;
}

function createDeliveryScheduler({ repository, botToken, chatId, logger = console, now = () => new Date() }) {
  let timer = null;

  // Message builders throw on a malformed order (a missing meyToken, say). One
  // bad order must not cancel the rest of the tick, so every send is fenced.
  async function send(build, context) {
    try {
      const message = build();
      const result = await sendTelegramMessage({
        botToken,
        chatId,
        text: message.text,
        replyMarkup: message.reply_markup,
        logger,
      });
      if (!result.ok) {
        // The claim is already written, so this message is gone for good. Loud
        // on purpose: a dropped nudge is the failure mode worth chasing.
        logger.error('delivery-scheduler: claimed but failed to send', context);
      }
      return result;
    } catch (error) {
      logger.error('delivery-scheduler: claimed but could not build/send', context, error);
      return { ok: false, messageId: null };
    }
  }

  async function runDigest(state, today, dayOrders, nowMin) {
    if (nowMin < DIGEST_AT_MINUTES) return;
    if (dayOrders.length === 0) return;
    const settings = state && state.data && state.data.settings;
    if (settings && settings.meyDigestSentFor === today) return;

    const claim = await setDeliveryDigestSent(repository, today);
    if (!claim.ok || !claim.claimed) return;

    // The gate above asks "is there anything left to drive?", but the digest
    // itself shows the whole day — an early delivery already marked נמסרה still
    // belongs in the numbered list, so Felix's list matches Lin's dashboard.
    const fullDay = selectDeliveryDay(state.data, today, { includeDelivered: true });
    const route = suggestRouteOrder(fullDay);
    await send(() => digest(route, today, buildMultiStopMapsUrl(route)), { step: 'digest', date: today });
  }

  // One hotel with three deliveries at 19:00 is one message, not three pings a
  // minute apart — so the window is evaluated per order and the send is per
  // destination.
  async function runLeadReminders(timed, nowMin) {
    const groups = new Map();
    for (const { order, minutes } of timed) {
      if (order.meyLeadNudgeAt) continue;
      if (!(minutes - LEAD_MINUTES <= nowMin && nowMin < minutes)) continue;
      const key = destinationLabel(order);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(order);
    }

    for (const [label, group] of groups) {
      const claimed = [];
      for (const order of group) {
        const claim = await markDeliveryNudge(repository, order.id, 'lead');
        if (claim.ok && claim.claimed) claimed.push({ ...order, meyToken: claim.token });
      }
      // Whoever lost the claim already got its reminder; only the orders this
      // tick actually won are allowed into the text.
      if (claimed.length === 0) continue;
      await send(() => leadReminder(claimed), { step: 'lead', destination: label });
    }
  }

  async function runCheckins(timed, nowMin) {
    for (const { order, minutes } of timed) {
      if (order.meyCheckinAskedAt) continue;
      if (isDelivered(order)) continue;
      if (!(minutes - CHECKIN_MINUTES <= nowMin && nowMin < minutes + LATE_MINUTES)) continue;

      const claim = await markDeliveryNudge(repository, order.id, 'checkin');
      if (!claim.ok || !claim.claimed) continue;

      // The token is minted by the claim, so the buttons must be built from the
      // claim's order — not from the snapshot we loaded before it.
      const result = await send(() => checkinPrompt({ ...order, meyToken: claim.token }), {
        step: 'checkin',
        orderId: order.id,
      });
      // Remembering the message id is what lets a later reply edit this prompt
      // instead of stacking another one under it.
      if (result.ok && result.messageId !== null) {
        await setPromptMessageId(repository, order.id, result.messageId);
      }
    }
  }

  async function runLateEscalations(timed, nowMin) {
    for (const { order, minutes } of timed) {
      if (order.meyLateNudgeAt) continue;
      if (isDelivered(order)) continue;
      if (!(nowMin > minutes + LATE_MINUTES)) continue;

      const claim = await markDeliveryNudge(repository, order.id, 'late');
      if (!claim.ok || !claim.claimed) continue;
      await send(() => lateEscalation({ ...order, meyToken: claim.token }), {
        step: 'late',
        orderId: order.id,
      });
    }
  }

  // --- weekly business digest + Friday prep forecast -------------------------
  // Both follow the delivery digest's rule exactly: decide there is something
  // worth saying, claim the marker, and only then send. The claimed day is the
  // subject of the message (the window's Saturday, the Friday being cooked for),
  // never "today", so the claim survives a restart at any hour.

  async function runWeeklyBusinessDigest(state, today, nowMin) {
    if (weekdayOf(today) !== WEEKLY_DIGEST_WEEKDAY) return;
    if (nowMin < WEEKLY_DIGEST_AT_MINUTES) return;

    const stats = summarizeWeek(state.data, today);
    if (stats === null) return;
    // A week with no orders at all has nothing to report; a week that had orders
    // is worth sending even if the revenue could not be totalled, because that
    // gap is itself the news.
    if (stats.orderCount === 0) return;

    const settings = state && state.data && state.data.settings;
    if (settings && settings.meyWeeklyDigestSentFor === stats.to) return;

    const claim = await setWeeklyDigestSent(repository, stats.to);
    if (!claim.ok || !claim.claimed) return;
    await send(() => weeklyBusinessDigest(stats), { step: 'weekly-digest', window: stats.to });
  }

  async function runPrepForecast(state, today, nowMin) {
    if (weekdayOf(today) !== PREP_FORECAST_WEEKDAY) return;
    if (nowMin < PREP_FORECAST_AT_MINUTES) return;

    // Returns null when Friday is still empty — no orders, nothing to prep, so
    // מיי says nothing rather than sending an empty list.
    const forecast = summarizeFridayPrep(state.data, today);
    if (forecast === null) return;

    const settings = state && state.data && state.data.settings;
    if (settings && settings.meyPrepForecastSentFor === forecast.date) return;

    const claim = await setPrepForecastSent(repository, forecast.date);
    if (!claim.ok || !claim.claimed) return;
    await send(() => prepForecast(forecast), { step: 'prep-forecast', friday: forecast.date });
  }
  // --- end weekly business digest + Friday prep forecast ---------------------

  // --- plata pickup digest ---------------------------------------------------
  // Same claim-before-send rule, one digest per Saturday. Plates from earlier
  // weeks that were never collected ride in it too — an open plate is open
  // business until its deposit goes back, whatever date the order carried.
  async function runPlataPickupDigest(state, today, nowMin) {
    if (weekdayOf(today) !== PLATA_DIGEST_WEEKDAY) return;
    if (nowMin < PLATA_DIGEST_AT_MINUTES) return;

    const orders = Array.isArray(state.data.orders) ? state.data.orders.filter(awaitsPlataPickup) : [];
    if (orders.length === 0) return;

    const settings = state && state.data && state.data.settings;
    if (settings && settings.meyPlataDigestSentFor === today) return;

    const claim = await setPlataDigestSent(repository, today);
    if (!claim.ok || !claim.claimed) return;
    await send(() => plataPickupDigest(orders), { step: 'plata-digest', date: today });
  }
  // --- end plata pickup digest -----------------------------------------------

  // Runs every minute forever: it reports failures and returns, never rejects.
  async function tick() {
    try {
      const at = now();
      const today = dubaiDateString(at);
      const nowMin = dubaiMinutesOfDay(at);
      if (nowMin === null) {
        logger.error('delivery-scheduler: could not read the Dubai clock', at);
        return;
      }

      const state = await repository.loadState();
      const dayOrders = selectDeliveryDay(state.data, today);
      const timed = timedEntries(dayOrders);

      await runDigest(state, today, dayOrders, nowMin);
      await runLeadReminders(timed, nowMin);
      await runCheckins(timed, nowMin);
      await runLateEscalations(timed, nowMin);
      await runWeeklyBusinessDigest(state, today, nowMin);
      await runPrepForecast(state, today, nowMin);
      await runPlataPickupDigest(state, today, nowMin);
    } catch (error) {
      logger.error('delivery-scheduler: tick failed', error);
    }
  }

  function start() {
    if (timer !== null) return;
    // Fire once immediately so a restart mid-day catches up on anything due;
    // the claim markers are what keep that from repeating what was already sent.
    tick().catch((error) => logger.error('delivery-scheduler: first tick failed', error));
    timer = setInterval(tick, TICK_MS);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function stop() {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  }

  return { start, stop, tick };
}

module.exports = {
  CHECKIN_MINUTES,
  DIGEST_AT_MINUTES,
  LATE_MINUTES,
  LEAD_MINUTES,
  PLATA_DIGEST_AT_MINUTES,
  PLATA_DIGEST_WEEKDAY,
  PREP_FORECAST_AT_MINUTES,
  PREP_FORECAST_WEEKDAY,
  TICK_MS,
  WEEKLY_DIGEST_AT_MINUTES,
  WEEKLY_DIGEST_WEEKDAY,
  createDeliveryScheduler,
};
