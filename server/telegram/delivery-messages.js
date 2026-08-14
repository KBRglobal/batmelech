'use strict';

// Every Hebrew message מיי sends Felix during a delivery day. Pure builders:
// they take orders in and return { text, reply_markup? } — nothing here talks
// to Telegram, reads state, or writes anything.
//
// Two rules the builders enforce for the send layer:
// - callback_data is `d|<action>|<token>` and must fit Telegram's 64-byte cap.
// - nothing ever prints a raw order id. Felix speaks names and hotels; ids are
//   an internal detail and leak nothing useful into a chat.

const {
  destinationLabel,
  navigationHref,
  orderName,
  parseClockMinutes,
} = require('./delivery-day');

const MAX_CALLBACK_BYTES = 64;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,48}$/u;
const CANCEL_TOKEN = '-';
const ACTIONS = new Set(['otw', 'ontime', 'late', 'proof', 'undo', 'draft', 'cancel']);

function callbackData(action, token) {
  if (!ACTIONS.has(action)) {
    throw new TypeError(`unknown delivery callback action: ${action}`);
  }
  if (!TOKEN_PATTERN.test(token)) {
    throw new TypeError('delivery callback needs a short alphanumeric meyToken');
  }
  const data = `d|${action}|${token}`;
  if (Buffer.byteLength(data, 'utf8') > MAX_CALLBACK_BYTES) {
    throw new TypeError('delivery callback_data exceeds Telegram 64-byte limit');
  }
  return data;
}

function tokenOf(order) {
  const token = order && typeof order.meyToken === 'string' ? order.meyToken.trim() : '';
  if (!TOKEN_PATTERN.test(token)) {
    throw new TypeError('order is missing a usable meyToken');
  }
  return token;
}

function button(label, action, token) {
  return { text: label, callback_data: callbackData(action, token) };
}

function keyboard(rows) {
  return { inline_keyboard: rows };
}

// '19.00' and '19:00' are the same time to Felix — show one shape.
function timeLabel(order) {
  const minutes = parseClockMinutes(order && order.time);
  if (minutes === null) {
    return typeof order?.time === 'string' && order.time.trim() !== '' ? order.time.trim() : '';
  }
  const hours = String(Math.floor(minutes / 60)).padStart(2, '0');
  return `${hours}:${String(minutes % 60).padStart(2, '0')}`;
}

function navigationLine(order) {
  const href = navigationHref(order);
  return href === null ? null : `ניווט: ${href}`;
}

function joinLines(lines) {
  return lines.filter((line) => typeof line === 'string' && line !== '').join('\n');
}

function humanDate(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(typeof dateString === 'string' ? dateString.trim() : '');
  return match === null ? '' : `${match[3]}/${match[2]}`;
}

function digest(routeOrderedOrders, dateString, mapsUrls = []) {
  const orders = Array.isArray(routeOrderedOrders) ? routeOrderedOrders.filter(Boolean) : [];
  const day = humanDate(dateString);
  const dayText = day === '' ? 'היום' : `היום (${day})`;
  if (orders.length === 0) {
    return { text: `בוקר טוב פליקס! ${dayText} אין משלוחים. יום נעים!` };
  }

  const timed = orders.filter((order) => parseClockMinutes(order.time) !== null);
  const untimed = orders.filter((order) => parseClockMinutes(order.time) === null);
  const countText = orders.length === 1 ? 'משלוח אחד' : `${orders.length} משלוחים`;
  const numbered = timed.map(
    (order, at) => `${at + 1}. ${timeLabel(order)} · ${orderName(order)} · ${destinationLabel(order)}`,
  );
  const untimedLine =
    untimed.length === 0 ? null : `• ללא שעה: ${untimed.map((order) => orderName(order)).join(', ')}`;
  const routeLines = (Array.isArray(mapsUrls) ? mapsUrls : [])
    .filter((url) => typeof url === 'string' && url !== '')
    .map((url) => `מסלול מלא בניווט: ${url}`);

  return {
    text: joinLines([
      `בוקר טוב פליקס! ${dayText} יש ${countText}, לפי הסדר:`,
      '',
      ...numbered,
      untimedLine === null ? '' : '',
      untimedLine,
      routeLines.length === 0 ? '' : '',
      ...routeLines,
      '',
      'יום קל! כל שינוי — תכתוב לי.',
    ]),
  };
}

// Grouped upstream by destination, so one hotel with three deliveries is one
// nudge and not three pings a minute apart.
function leadReminder(orders) {
  const list = (Array.isArray(orders) ? orders : []).filter(Boolean);
  if (list.length === 0) return { text: '' };
  const [first] = list;
  const navigation = navigationLine(first);

  if (list.length === 1) {
    const time = timeLabel(first);
    const timeText = time === '' ? '' : `, שעה ${time}`;
    return {
      text: joinLines([
        `עוד שעה וחצי: ${orderName(first)} ב${destinationLabel(first)}${timeText}`,
        navigation,
      ]),
    };
  }

  const rows = list.map((order) => {
    const time = timeLabel(order);
    return time === '' ? `• ${orderName(order)}` : `• ${orderName(order)}, שעה ${time}`;
  });
  return {
    text: joinLines([`עוד שעה וחצי ב${destinationLabel(first)}:`, ...rows, navigation]),
  };
}

function checkinPrompt(order) {
  const token = tokenOf(order);
  const time = timeLabel(order);
  const timeText = time === '' ? '' : ` בשעה ${time}`;
  return {
    text: `${orderName(order)} ב${destinationLabel(order)}${timeText} — בדרך?`,
    reply_markup: keyboard([
      [
        button('🚗 בדרך', 'otw', token),
        button('✅ מגיע בזמן', 'ontime', token),
        button('⏳ מתעכב', 'late', token),
      ],
    ]),
  };
}

function lateEscalation(order, nowText) {
  const token = tokenOf(order);
  const time = typeof nowText === 'string' && nowText.trim() !== '' ? nowText.trim() : timeLabel(order);
  const opening = time === '' ? 'עוד לא סומן שנמסר' : `כבר ${time} ועוד לא סומן שנמסר`;
  return {
    text: `${opening} ל${orderName(order)}. הכל בסדר?`,
    reply_markup: keyboard([
      [button('✅ נמסר עכשיו', 'proof', token)],
      [button('⏳ מתעכב', 'late', token)],
      [button('📝 לנסח הודעה ללקוח', 'draft', token)],
    ]),
  };
}

function proofRecorded(order, nextOrder) {
  const token = tokenOf(order);
  const lines = [`נשמר ✅ צילום המסירה של ${orderName(order)}. סימנתי כנמסר.`];
  if (nextOrder) {
    const time = timeLabel(nextOrder);
    const timeText = time === '' ? '' : `, ${time}`;
    lines.push('', `היעד הבא: ${orderName(nextOrder)} ב${destinationLabel(nextOrder)}${timeText}`);
    lines.push(navigationLine(nextOrder));
  }
  return {
    text: joinLines(lines),
    reply_markup: keyboard([[button('לא, עוד לא נמסר', 'undo', token)]]),
  };
}

function proofAmbiguous(candidates) {
  const list = (Array.isArray(candidates) ? candidates : []).filter(Boolean);
  const rows = list.map((order) => [button(orderName(order), 'proof', tokenOf(order))]);
  rows.push([button('ביטול', 'cancel', CANCEL_TOKEN)]);
  return {
    text: 'לאיזה משלוח לשייך את התמונה?',
    reply_markup: keyboard(rows),
  };
}

// Felix said he is running late. This only advises him — מיי never sends
// anything to a customer, she drafts text for him to copy.
function delayAdvice(order, etaMinutes) {
  const token = tokenOf(order);
  const eta = Number(etaMinutes);
  const etaText =
    Number.isFinite(eta) && eta > 0
      ? `הבנתי, רשמתי עוד בערך ${Math.round(eta)} דקות.`
      : 'הבנתי, רשמתי שאתה מתעכב.';
  const time = timeLabel(order);
  const timeText =
    time === ''
      ? `אם זה מתארך — שווה לעדכן את ${orderName(order)}, זה חוסך טלפונים אחר כך.`
      : `אם זה עובר את ${time} שביקש/ה ${orderName(order)} — שווה לעדכן, זה חוסך טלפונים אחר כך.`;
  return {
    text: joinLines([etaText, timeText, '', 'רוצה שאנסח לך הודעה להעתיק?']),
    reply_markup: keyboard([[button('📝 כן, נסחי', 'draft', token)]]),
  };
}

module.exports = {
  MAX_CALLBACK_BYTES,
  callbackData,
  checkinPrompt,
  delayAdvice,
  digest,
  lateEscalation,
  leadReminder,
  proofAmbiguous,
  proofRecorded,
};
