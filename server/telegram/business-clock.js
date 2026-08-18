'use strict';

// The business clock: everything the kitchen should hear on a schedule that
// is NOT about a single delivery — the Wednesday pre-Shabbat digest, the
// Saturday-night weekly summary, and the nightly encrypted off-site backup.
// Same discipline as delivery-scheduler.js: claim-before-send (a restarted
// process stays quiet), Dubai time only, deterministic Hebrew templates.

const { claimDailyMarker, withSettingsUpdate } = require('../business-actions');
const { dubaiDateString, dubaiMinutesOfDay, parseClockMinutes } = require('./delivery-day');
const { sendTelegramMessage } = require('./send-message');
const { encryptSecret } = require('../business-data/secret-box');
const { sendBackupEmail: defaultSendBackupEmail } = require('../business-data/send-backup-email');

const TICK_MS = 60_000;
const WEDNESDAY_DIGEST_MINUTES = 10 * 60; // 10:00
const WEEKLY_SUMMARY_MINUTES = 21 * 60 + 30; // 21:30, Saturday night
const BACKUP_MINUTES = 3 * 60 + 30; // 03:30
const WEEKLY_BACKUP_MINUTES = 8 * 60; // 08:00 Sunday

const CANCELLED = new Set(['בוטלה', 'cancelled', 'canceled']);

function dubaiWeekday(now) {
  // 'Sun'..'Sat' independent of server locale.
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Asia/Dubai' }).format(now);
}

function isActive(order) {
  const status = typeof order.status === 'string' ? order.status.trim().toLowerCase() : '';
  return !CANCELLED.has(status);
}

function ordersOn(orders, day) {
  return orders.filter((order) => order.date === day && isActive(order));
}

// The upcoming Friday, Dubai time (today if today is Friday).
function upcomingFriday(now) {
  for (let ahead = 0; ahead < 7; ahead += 1) {
    const candidate = new Date(now.getTime() + ahead * 86_400_000);
    if (dubaiWeekday(candidate) === 'Fri') return dubaiDateString(candidate);
  }
  return dubaiDateString(now);
}

function missingDetails(order) {
  const missing = [];
  if (parseClockMinutes(order.time) === null) missing.push('שעה');
  const destination =
    order.pickup === true ||
    (typeof order.hotelName === 'string' && order.hotelName.trim() !== '') ||
    (typeof order.address === 'string' && order.address.trim() !== '');
  if (!destination) missing.push('כתובת');
  const total = typeof order.total === 'number' ? order.total : Number(order.total);
  if (!Number.isFinite(total) || total <= 0) missing.push('מחיר');
  return missing;
}

function wednesdayDigestText(fridayDate, fridayOrders) {
  const lines = [`תזכורת רביעי 🌸 לקראת שישי ${fridayDate.split('-').reverse().slice(0, 2).join('.')}`, ''];
  if (fridayOrders.length === 0) {
    lines.push('עדיין אין הזמנות ליום שישי הקרוב.');
    return lines.join('\n');
  }
  const meals = fridayOrders.reduce((sum, order) => {
    const value = Number(order.meals);
    return sum + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);
  lines.push(`${fridayOrders.length} הזמנות${meals > 0 ? ` · ${meals} זוגיות` : ''}`);
  const incomplete = fridayOrders
    .map((order) => ({ order, missing: missingDetails(order) }))
    .filter((entry) => entry.missing.length > 0);
  if (incomplete.length > 0) {
    lines.push('');
    lines.push('חסרים פרטים:');
    for (const entry of incomplete.slice(0, 10)) {
      lines.push(`• ${entry.order.name || 'ללא שם'} — ${entry.missing.join(', ')}`);
    }
    if (incomplete.length > 10) lines.push(`ועוד ${incomplete.length - 10}...`);
  } else {
    lines.push('כל ההזמנות מלאות ✓');
  }
  return lines.join('\n');
}

function weekRange(now) {
  // Sunday..Saturday ending today (Saturday night run).
  const today = dubaiDateString(now);
  const days = [];
  for (let back = 6; back >= 0; back -= 1) {
    days.push(dubaiDateString(new Date(now.getTime() - back * 86_400_000)));
  }
  return { days, from: days[0], to: today };
}

function weeklySummaryText(orders, range) {
  const inWeek = orders.filter((order) => range.days.includes(order.date) && isActive(order));
  const delivered = inWeek.filter((order) => order.status === 'נמסרה');
  let revenue = 0;
  let unpriced = 0;
  for (const order of inWeek) {
    const total = typeof order.total === 'number' ? order.total : Number(order.total);
    if (Number.isFinite(total) && total > 0) revenue += total;
    else unpriced += 1;
  }
  const lines = [
    'סיכום שבועי 🌸',
    '',
    `${inWeek.length} הזמנות השבוע · ${delivered.length} נמסרו`,
    `הכנסות: $${revenue.toLocaleString('en-US')}${unpriced > 0 ? ` (בלי ${unpriced} הזמנות ללא מחיר)` : ''}`,
  ];
  return lines.join('\n');
}

function createBackupArtifact(store, now) {
  const content = JSON.stringify(store, null, 2);
  if (content === undefined) throw new TypeError('store could not be serialized');
  return {
    filename: `batmelech-orders-${dubaiDateString(now)}.json`,
    content,
    mimeType: 'application/json',
  };
}

function createBusinessClock({
  repository,
  botToken,
  chatId,
  storage = null,
  env = process.env,
  logger = console,
  now = () => new Date(),
  sendBackupEmail = defaultSendBackupEmail,
} = {}) {
  let timer = null;

  async function say(text) {
    const result = await sendTelegramMessage({ botToken, chatId, text, logger });
    if (!result.ok) logger.error('business-clock: claimed but failed to send');
  }

  async function runWednesdayDigest(state, nowDate, nowMin) {
    if (dubaiWeekday(nowDate) !== 'Wed' || nowMin < WEDNESDAY_DIGEST_MINUTES) return;
    const today = dubaiDateString(nowDate);
    const claim = await claimDailyMarker(repository, 'meyWednesdayDigestFor', today);
    if (!claim.ok || !claim.claimed) return;
    const friday = upcomingFriday(nowDate);
    const orders = Array.isArray(state.data.orders) ? state.data.orders : [];
    await say(wednesdayDigestText(friday, ordersOn(orders, friday)));
  }

  async function runWeeklySummary(state, nowDate, nowMin) {
    if (dubaiWeekday(nowDate) !== 'Sat' || nowMin < WEEKLY_SUMMARY_MINUTES) return;
    const today = dubaiDateString(nowDate);
    const claim = await claimDailyMarker(repository, 'meyWeeklySummaryFor', today);
    if (!claim.ok || !claim.claimed) return;
    const orders = Array.isArray(state.data.orders) ? state.data.orders : [];
    await say(weeklySummaryText(orders, weekRange(nowDate)));
  }

  async function runBackup(state, nowDate, nowMin) {
    if (nowMin < BACKUP_MINUTES) return;
    if (!storage || storage.enabled !== true || typeof storage.putStateBackup !== 'function') return;
    const secretsKey = env.BM_SECRETS_KEY;
    if (typeof secretsKey !== 'string' || secretsKey.trim() === '') return;
    const today = dubaiDateString(nowDate);
    const claim = await claimDailyMarker(repository, 'meyBackupFor', today);
    if (!claim.ok || !claim.claimed) return;
    try {
      const encrypted = encryptSecret(JSON.stringify(state.data), secretsKey.trim());
      const stored = await storage.putStateBackup({
        dateString: today,
        encryptedBody: JSON.stringify(encrypted),
      });
      if (stored === null) logger.error('business-clock: nightly backup upload failed');
    } catch (error) {
      logger.error('business-clock: nightly backup failed', error);
    }
  }

  function alreadySentToday(settings, today) {
    const last = settings.lastWeeklyBackupAt;
    if (typeof last !== 'number' || !Number.isSafeInteger(last) || last < 0) return false;
    const lastDate = new Date(last);
    if (!Number.isFinite(lastDate.getTime())) return false;
    return dubaiDateString(lastDate) === today;
  }

  async function runWeeklyEmailBackup(state, nowDate, nowMin) {
    if (dubaiWeekday(nowDate) !== 'Sun' || nowMin < WEEKLY_BACKUP_MINUTES) return;
    const settings = state.data.settings && typeof state.data.settings === 'object' ? state.data.settings : {};
    const toEmail = typeof settings.weeklyBackupEmail === 'string' ? settings.weeklyBackupEmail.trim() : '';
    if (toEmail === '') return;
    const apiKey = env.RESEND_API_KEY;
    if (typeof apiKey !== 'string' || apiKey.trim() === '') {
      logger.error('business-clock: weekly backup email skipped — RESEND_API_KEY is not configured');
      return;
    }
    const today = dubaiDateString(nowDate);
    if (alreadySentToday(settings, today)) return;
    const claim = await claimDailyMarker(repository, 'meyWeeklyBackupEmailFor', today);
    if (!claim.ok || !claim.claimed) return;
    try {
      const artifact = createBackupArtifact(state.data, nowDate);
      await sendBackupEmail({ apiKey: apiKey.trim(), toEmail, artifact });
      const recorded = await withSettingsUpdate(repository, (nextSettings) => ({
        ...nextSettings,
        lastWeeklyBackupAt: nowDate.getTime(),
      }));
      if (!recorded.ok) logger.error('business-clock: weekly backup email sent but failed to record timestamp');
    } catch (error) {
      logger.error('business-clock: weekly backup email failed', error);
    }
  }

  async function tick() {
    try {
      const nowDate = now();
      const nowMin = dubaiMinutesOfDay(nowDate);
      const state = await repository.loadState();
      await runBackup(state, nowDate, nowMin);
      await runWednesdayDigest(state, nowDate, nowMin);
      await runWeeklySummary(state, nowDate, nowMin);
      await runWeeklyEmailBackup(state, nowDate, nowMin);
    } catch (error) {
      logger.error('business-clock: tick failed', error);
    }
  }

  function start() {
    if (timer !== null) return;
    tick().catch((error) => logger.error('business-clock: first tick failed', error));
    timer = setInterval(tick, TICK_MS);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function stop() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, tick };
}

module.exports = {
  createBusinessClock,
  missingDetails,
  upcomingFriday,
  wednesdayDigestText,
  weeklySummaryText,
  weekRange,
};
