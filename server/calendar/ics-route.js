'use strict';

// Phone-calendar feed of deliveries (roadmap #39): GET
// /calendar/:token/deliveries.ics returns a VCALENDAR with one VEVENT per
// ACTIVE delivery order that has a real service date. The URL itself is the
// capability: the token is an HMAC signature over the fixed string
// 'deliveries', keyed by a secret DERIVED from the staff session secret
// (HMAC-scoped with 'calendar-scope'), mirroring server/track/tracking-token.js.
// A calendar token can never be replayed as session or tracking material and
// vice versa; rotating BM_SESSION_SECRET invalidates every issued feed URL.
//
// Privacy stance: a phone calendar is a low-trust surface (synced to Google/
// Apple, shown on lock screens). Each event carries ONLY the customer name
// and the destination label — never phone numbers, prices, deposits, or notes.
// An invalid token gets a generic 404 with no hint that a feed lives here.

const crypto = require('node:crypto');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const {
  CANCELLED_STATUS,
  DELIVERED_STATUS,
  destinationLabel,
  orderName,
  orderStatus,
  parseClockMinutes,
} = require('../telegram/delivery-day');

const TOKEN_HEX_LENGTH = 32;
const CALENDAR_SUBJECT = 'deliveries';
const DUBAI_TZID = 'Asia/Dubai';
const EVENT_DURATION_MINUTES = 90;
const NO_DESTINATION = 'יעד לא צוין';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const CRLF = '\r\n';
const FOLD_BYTE_LIMIT = 73;

// Deliberately anonymous, identical in spirit to the tracking route's 404:
// no brand, no wording that reveals a calendar feed lives under this path.
const NOT_FOUND_PAGE =
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<meta name="robots" content="noindex, nofollow"><title>Not Found</title></head>' +
  '<body><pre>Cannot GET</pre></body></html>';

const UNAVAILABLE_PAGE =
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<meta name="robots" content="noindex, nofollow"><title>Service Unavailable</title></head>' +
  '<body><pre>Service Unavailable</pre></body></html>';

function calendarSecret(sessionSecret) {
  if (typeof sessionSecret !== 'string' || sessionSecret === '') {
    throw new TypeError('sessionSecret required');
  }
  return crypto.createHmac('sha256', sessionSecret).update('calendar-scope').digest();
}

function calendarToken(sessionSecret) {
  return crypto
    .createHmac('sha256', calendarSecret(sessionSecret))
    .update(CALENDAR_SUBJECT)
    .digest('hex')
    .slice(0, TOKEN_HEX_LENGTH);
}

// The panel can show this later: the one URL to add on a phone.
function calendarPath(sessionSecret) {
  return `/calendar/${calendarToken(sessionSecret)}/${CALENDAR_SUBJECT}.ics`;
}

// Constant-time comparison: pad both sides to a common length so neither the
// comparison nor an early length check leaks how many characters matched.
function verifyCalendarToken(token, sessionSecret) {
  const expected = calendarToken(sessionSecret);
  const givenBuffer = Buffer.from(String(token));
  const expectedBuffer = Buffer.from(expected);
  const length = Math.max(givenBuffer.length, expectedBuffer.length, 1);
  const givenPadded = Buffer.concat([givenBuffer], length);
  const expectedPadded = Buffer.concat([expectedBuffer], length);
  return (
    crypto.timingSafeEqual(givenPadded, expectedPadded) &&
    givenBuffer.length === expectedBuffer.length
  );
}

// RFC 5545 §3.3.11 TEXT escaping: backslash first, then semicolon, comma,
// and newlines; control characters are dropped rather than smuggled through.
function escapeIcsText(value) {
  return String(value)
    .replace(/\\/gu, '\\\\')
    .replace(/;/gu, '\\;')
    .replace(/,/gu, '\\,')
    .replace(/\r\n|\r|\n/gu, '\\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '');
}

// RFC 5545 §3.1 folding: lines longer than 75 octets continue on the next
// line after a single space. Split on UTF-8 character boundaries only.
function foldIcsLine(line) {
  const parts = [];
  let current = '';
  let currentBytes = 0;
  for (const character of line) {
    const characterBytes = Buffer.byteLength(character);
    if (currentBytes + characterBytes > FOLD_BYTE_LIMIT && current !== '') {
      parts.push(current);
      current = ' ';
      currentBytes = 1;
    }
    current += character;
    currentBytes += characterBytes;
  }
  if (current !== '') parts.push(current);
  return parts.join(CRLF);
}

function parseServiceDate(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!DATE_PATTERN.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  // Reject calendar-impossible dates like 2026-02-31 that Date silently rolls.
  if (parsed.toISOString().slice(0, 10) !== raw) return null;
  return parsed;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function compactDate(date) {
  return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}`;
}

// Local Dubai wall-clock stamp for DTSTART;TZID=Asia/Dubai. The service date
// plus the parsed clock minutes ARE Dubai wall time already, so the UTC
// accessors of a UTC-constructed date give exactly the local fields we need.
function localStamp(serviceDate, minutesOfDay) {
  const at = new Date(serviceDate.getTime() + minutesOfDay * 60_000);
  return `${compactDate(at)}T${pad2(at.getUTCHours())}${pad2(at.getUTCMinutes())}00`;
}

function nextDay(serviceDate) {
  return new Date(serviceDate.getTime() + 24 * 60 * 60 * 1000);
}

function uidFromOrderId(orderId) {
  // Deterministic per order id, restricted to a UID-safe charset.
  const safe = String(orderId).replace(/[^\w.-]/gu, '-').slice(0, 120);
  return `bm-${safe}@bat-melech`;
}

// Active = the order is still on the delivery roster: a real (non-pickup)
// delivery that was neither cancelled nor already delivered.
function isActiveDelivery(order) {
  if (!order || typeof order !== 'object') return false;
  if (order.pickup === true) return false;
  const status = orderStatus(order);
  return status !== CANCELLED_STATUS && status !== DELIVERED_STATUS;
}

function hasUsableId(order) {
  if (typeof order.id === 'number') return Number.isFinite(order.id);
  return typeof order.id === 'string' && order.id.trim() !== '';
}

function deliveryEventLines(order, dtStamp) {
  const serviceDate = parseServiceDate(order.date);
  if (serviceDate === null) return null;

  const lines = ['BEGIN:VEVENT'];
  lines.push(`UID:${uidFromOrderId(order.id)}`);
  lines.push(`DTSTAMP:${dtStamp}`);

  const minutes = parseClockMinutes(order.time);
  if (minutes === null) {
    // No parsable time — an honest all-day event instead of an invented hour.
    lines.push(`DTSTART;VALUE=DATE:${compactDate(serviceDate)}`);
    lines.push(`DTEND;VALUE=DATE:${compactDate(nextDay(serviceDate))}`);
  } else {
    lines.push(`DTSTART;TZID=${DUBAI_TZID}:${localStamp(serviceDate, minutes)}`);
    lines.push(`DTEND;TZID=${DUBAI_TZID}:${localStamp(serviceDate, minutes + EVENT_DURATION_MINUTES)}`);
  }

  lines.push(`SUMMARY:${escapeIcsText(`משלוח — ${orderName(order)}`)}`);
  const destination = destinationLabel(order);
  if (destination !== NO_DESTINATION) {
    lines.push(`LOCATION:${escapeIcsText(destination)}`);
  }
  lines.push('STATUS:CONFIRMED');
  lines.push('END:VEVENT');
  return lines;
}

function buildDeliveriesCalendar(state, now = Date.now()) {
  const orders = state && Array.isArray(state.orders) ? state.orders : [];
  const stampDate = new Date(now);
  const dtStamp = Number.isNaN(stampDate.getTime())
    ? `${compactDate(new Date(0))}T000000Z`
    : `${compactDate(stampDate)}T${pad2(stampDate.getUTCHours())}${pad2(stampDate.getUTCMinutes())}${pad2(stampDate.getUTCSeconds())}Z`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Bat Melech//Deliveries//HE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText('משלוחים — בת מלך')}`,
    `X-WR-TIMEZONE:${DUBAI_TZID}`,
    // Asia/Dubai has a fixed +04:00 offset, no DST — one STANDARD block.
    'BEGIN:VTIMEZONE',
    `TZID:${DUBAI_TZID}`,
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0400',
    'TZOFFSETTO:+0400',
    'TZNAME:+04',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];

  for (const order of orders) {
    if (!isActiveDelivery(order) || !hasUsableId(order)) continue;
    const eventLines = deliveryEventLines(order, dtStamp);
    if (eventLines !== null) lines.push(...eventLines);
  }

  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}

function createCalendarRouter({ repository, sessionSecret, logger = console }) {
  if (!repository || typeof repository.loadState !== 'function') {
    throw new TypeError('A state repository is required');
  }
  if (typeof sessionSecret !== 'string' || sessionSecret === '') {
    throw new TypeError('sessionSecret required');
  }
  if (!logger || typeof logger.error !== 'function') {
    throw new TypeError('A logger with an error method is required');
  }

  const router = express.Router();

  router.use(
    rateLimit({
      windowMs: 15 * 60 * 1_000,
      limit: 60,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    })
  );
  router.use((_request, response, next) => {
    // Calendar apps poll aggressively; five minutes of private caching is
    // plenty fresh for a delivery schedule and shields the state store.
    response.set('Cache-Control', 'private, max-age=300');
    response.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
    next();
  });

  router.get(`/:token/${CALENDAR_SUBJECT}.ics`, async (request, response) => {
    // Timing-safe verify before anything else: a bad token never touches state.
    if (!verifyCalendarToken(request.params.token, sessionSecret)) {
      return response.status(404).type('html').send(NOT_FOUND_PAGE);
    }

    let calendar;
    try {
      const current = await repository.loadState();
      calendar = buildDeliveriesCalendar(current.data);
    } catch (error) {
      logger.error('calendar state read failed', error);
      return response.status(503).type('html').send(UNAVAILABLE_PAGE);
    }

    response.set('Content-Type', 'text/calendar; charset=utf-8');
    response.set('Content-Disposition', 'inline; filename="deliveries.ics"');
    return response.status(200).send(calendar);
  });

  return router;
}

module.exports = {
  TOKEN_HEX_LENGTH,
  buildDeliveriesCalendar,
  calendarPath,
  calendarToken,
  createCalendarRouter,
  verifyCalendarToken,
};
