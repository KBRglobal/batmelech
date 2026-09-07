'use strict';

// The business at a glance, rebuilt from live state on every turn and placed
// in front of מיי before she reads the message. Without it she starts every
// answer from zero and fills the gap from imagination; with it most questions
// are answered from facts she already has, and tool calls become confirmation
// rather than discovery. Every number here is data, so the grounding check
// accepts it as evidence.

const { customerLedger, financialSummary, orderMoney, ordersOf, parseMoneyMinorUnits } = require('../domain/business-queries');
const { DELIVERY_PRICE_MINOR_UNITS } = require('../domain/order-pricing');
const { LUNCH_MENU } = require('../domain/lunch-menu');
const { aedLabel, usdLabel } = require('../domain/money-labels');
const { orderingStatus } = require('../business-actions');
const { destinationLabel, dubaiDateString, selectDeliveryDay } = require('./delivery-day');
const { isWritesFrozen } = require('./mey-audited-actions');

const MAX_LIST = 12;
const MAX_NOTES = 20;
const MAX_CHARS = 6_000;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function money(minorUnits) {
  return `${usdLabel(minorUnits)}$ / ${aedLabel(minorUnits)} דירהם`;
}

function dollars(value, fallbackMinorUnits) {
  const parsed = parseMoneyMinorUnits(value);
  return usdLabel(parsed === null ? fallbackMinorUnits : parsed).replace(/\.00$/u, '');
}

function comingFriday(todayIso) {
  const start = new Date(`${todayIso}T12:00:00Z`);
  for (let ahead = 0; ahead < 7; ahead += 1) {
    const candidate = new Date(start.getTime() + ahead * 86_400_000);
    if (candidate.getUTCDay() === 5) return candidate.toISOString().slice(0, 10);
  }
  return todayIso;
}

function orderLine(order) {
  const m = orderMoney(order);
  const total = m.totalMinorUnits === null ? 'סכום לא קריא' : money(m.totalMinorUnits);
  const where = order.pickup === true ? 'איסוף עצמי' : destinationLabel(order) || text(order.place) || text(order.address) || 'יעד לא צוין';
  const when = text(order.time) || 'בלי שעה';
  const paid = m.fullyPaid ? 'שולם' : m.collectedMinorUnits > 0 ? `מקדמה ${usdLabel(m.collectedMinorUnits)}$` : 'לא שולם';
  return `${text(order.name) || 'ללא שם'} — ${where}, ${when}, ${total}, ${text(order.status) || 'ללא סטטוס'}, ${paid}`;
}

function priceLines(menu) {
  const m = isRecord(menu) ? menu : {};
  const lines = [
    `ארוחה זוגית ${dollars(m.couplePrice, 23_000)}$ (כוללת 4 סלטים, 2 פילה דג, עיקרית, תוספת, קינוח, ${Number.isInteger(m.includedChallot) ? m.includedChallot : 2} חלות); ` +
      `חלה נוספת ${dollars(m.challahPrice, 1_000)}$; סלט נוסף ${dollars(m.saladUnitPrice, 700)}$ או רביעייה ${dollars(m.saladBlockPrice, 2_500)}$; ` +
      `פילה דג נוסף ${dollars(m.fishExtraPrice, 3_000)}$; עיקרית נוספת ${dollars(m.mainExtraPrice, 10_000)}$; ` +
      `משלוח דובאי ${usdLabel(DELIVERY_PRICE_MINOR_UNITS.dubai).replace(/\.00$/u, '')}$, אבו דאבי ${usdLabel(DELIVERY_PRICE_MINOR_UNITS['abu-dhabi']).replace(/\.00$/u, '')}$, איסוף עצמי חינם.`,
  ];
  const extras = (Array.isArray(m.extras) ? m.extras : [])
    .filter((row) => isRecord(row) && text(row.name) !== '')
    .map((row) => `${text(row.name)} ${dollars(row.price, 0)}$`);
  if (extras.length > 0) lines.push(`תוספות שבת: ${extras.join('; ')}.`);
  const lunch = LUNCH_MENU.map((item) => {
    const saved = (Array.isArray(m.lunch) ? m.lunch : []).find((row) => isRecord(row) && row.key === item.key);
    if (item.variants.length === 0) return `${item.name} ${dollars(saved?.price, item.priceUsd * 100)}$`;
    const variants = item.variants.map((variant) => {
      const savedVariant = (Array.isArray(saved?.variants) ? saved.variants : []).find((row) => row.k === variant.key);
      return `${variant.label} ${dollars(savedVariant?.price, variant.priceUsd * 100)}$`;
    });
    return `${item.name}: ${variants.join(', ')}`;
  });
  lines.push(`תפריט צהריים: ${lunch.join('; ')}.`);
  return lines;
}

/**
 * The briefing text for the system prompt. `today` is a Dubai YYYY-MM-DD.
 */
function buildBriefing(state, { today = dubaiDateString() } = {}) {
  const data = isRecord(state) ? state : {};
  const settings = isRecord(data.settings) ? data.settings : {};
  const orders = ordersOf(data);
  const lines = ['תמונת מצב של העסק כרגע (נתונים חיים מהמערכת — אלה עובדות, אפשר לצטט מהן):'];

  const ordering = orderingStatus(settings, today);
  const status = [ordering.open ? 'הזמנות באתר פתוחות' : `הזמנות באתר סגורות${ordering.reopensOn ? ` עד ${ordering.reopensOn}` : ''}`];
  const banner = text(settings.siteBanner);
  if (banner !== '') status.push(`באנר באתר: "${banner}"`);
  const out = Array.isArray(settings.out) ? settings.out.filter((v) => typeof v === 'string' && v.trim() !== '') : [];
  status.push(out.length > 0 ? `אזל מהמלאי: ${out.join(', ')}` : 'שום מנה לא מסומנת כאזלה');
  status.push(isWritesFrozen(settings) ? 'הקפאת כתיבה פעילה (רק קריאה וביטולים)' : 'הקפאת כתיבה: לא פעילה');
  lines.push(`- ${status.join('. ')}.`);

  const todayDeliveries = selectDeliveryDay(data, today, { includeDelivered: true });
  if (todayDeliveries.length === 0) lines.push(`- היום (${today}): אין משלוחים.`);
  else {
    lines.push(`- היום (${today}): ${todayDeliveries.length} משלוחים:`);
    for (const order of todayDeliveries.slice(0, MAX_LIST)) lines.push(`  • ${orderLine(order)}`);
    if (todayDeliveries.length > MAX_LIST) lines.push(`  • ועוד ${todayDeliveries.length - MAX_LIST} (get_delivery_day מחזיר את כולם)`);
  }

  const friday = comingFriday(today);
  if (friday !== today) {
    const fridayOrders = orders.filter((order) => text(order.date) === friday && text(order.status) !== 'בוטלה');
    if (fridayOrders.length === 0) lines.push(`- שישי הקרוב (${friday}): עדיין אין הזמנות.`);
    else {
      const billed = fridayOrders.reduce((sum, order) => sum + (orderMoney(order).totalMinorUnits ?? 0), 0);
      lines.push(`- שישי הקרוב (${friday}): ${fridayOrders.length} הזמנות, סה"כ ${money(billed)}:`);
      for (const order of fridayOrders.slice(0, MAX_LIST)) lines.push(`  • ${orderLine(order)}`);
      if (fridayOrders.length > MAX_LIST) lines.push(`  • ועוד ${fridayOrders.length - MAX_LIST}`);
    }
  }

  const summary = financialSummary(data, { fromDate: null, toDate: null });
  const debtors = customerLedger(data).filter((customer) => customer.outstandingMinorUnits > 0);
  if (debtors.length === 0) lines.push('- חובות פתוחים: אין.');
  else {
    const top = debtors.slice(0, 5).map((customer) => `${customer.name || customer.phone} ${usdLabel(customer.outstandingMinorUnits)}$`);
    lines.push(`- חובות פתוחים: ${debtors.length} לקוחות, סה"כ ${money(summary.outstandingMinorUnits)} (הגדולים: ${top.join(', ')}).`);
  }

  const platas = orders.filter((order) => Number(order.plataCount) > 0 && order.plataStatus !== 'depositReturned');
  lines.push(platas.length === 0 ? '- פלטות בחוץ: אין.' : `- פלטות בחוץ: ${platas.length} (${platas.slice(0, 6).map((order) => text(order.name)).join(', ')}).`);

  lines.push('- מחירון (המחירים שהפאנל מחשב לפיהם):');
  for (const line of priceLines(data.menu)) lines.push(`  ${line}`);

  const notes = Array.isArray(settings.meyNotes) ? settings.meyNotes.filter(isRecord) : [];
  if (notes.length > 0) {
    lines.push('- דברים שביקשו ממך לזכור (זיכרון קבוע):');
    for (const note of notes.slice(-MAX_NOTES)) lines.push(`  • ${text(note.text)}${text(note.by) ? ` (${text(note.by)}, ${text(note.date)})` : ''}`);
  }
  const customerMeta = isRecord(data.customerMeta) ? data.customerMeta : {};
  const noted = Object.values(customerMeta).filter((meta) => isRecord(meta) && text(meta.notes) !== '').length;
  if (noted > 0) lines.push(`- יש הערות אישיות על ${noted} לקוחות — get_customer מחזיר אותן יחד עם ההיסטוריה.`);

  const briefing = lines.join('\n');
  return briefing.length <= MAX_CHARS ? briefing : `${briefing.slice(0, MAX_CHARS)}\n(תמונת המצב נחתכה — לפרטים מלאים תשתמשי בכלים)`;
}

module.exports = { buildBriefing, comingFriday };
