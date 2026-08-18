'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const http = require('node:http');

const {
  TOKEN_HEX_LENGTH,
  buildDeliveriesCalendar,
  calendarPath,
  calendarToken,
  createCalendarRouter,
  verifyCalendarToken,
} = require('../server/calendar/ics-route');

const SECRET = 'test-session-secret';

function fakeRepository(initialState) {
  const state = initialState;
  return {
    async loadState() {
      return { data: structuredClone(state), revision: 1, hash: 'h' };
    },
  };
}

// The fixture deliberately carries everything the feed must NOT leak (phones,
// prices, deposits, notes) and every kind of order the feed must NOT list:
// cancelled, delivered, pickup, and undated.
function calendarState() {
  return {
    orders: [
      {
        id: 'ord-1',
        name: 'Cohen, Sarah; the "VIP"',
        date: '2099-08-14',
        time: '13:00',
        status: 'אושרה',
        hotelName: 'Address Marina, Tower 2; Floor 3',
        phone: '+971501234567',
        total: 850,
        deposit: 100,
        notes: 'allergic neighbor, private note',
      },
      {
        id: 'ord-2',
        name: 'דוד לוי',
        date: '2099-08-15',
        time: 'בסביבות הצהריים',
        status: 'חדשה',
        place: 'Marina Gate',
        phone: '+971509876543',
        total: 1200,
      },
      { id: 'ord-cancelled', name: 'מבוטלת', date: '2099-08-14', status: 'בוטלה', place: 'JBR' },
      {
        id: 'ord-delivered',
        name: 'כבר נמסרה',
        date: '2099-08-13',
        status: 'נמסרה',
        place: 'Palm Jumeirah',
        deliveredAt: 4_000_000_000_000,
      },
      { id: 'ord-pickup', name: 'איסוף עצמי', date: '2099-08-14', pickup: true, status: 'אושרה' },
      { id: 'ord-undated', name: 'בלי תאריך', date: 'יום שישי הקרוב', status: 'אושרה', place: 'DIFC' },
      { id: 'ord-rolled-date', name: 'תאריך בלתי אפשרי', date: '2099-02-31', status: 'אושרה' },
      { name: 'בלי מזהה', date: '2099-08-14', time: '12:00', status: 'אושרה', place: 'Bluewaters' },
    ],
  };
}

async function serve(build) {
  const app = express();
  build(app);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  return {
    url: (p) => `http://127.0.0.1:${port}${p}`,
    close: () => server.close(),
  };
}

function calendarSite(repository) {
  return serve((app) => {
    app.use('/calendar', createCalendarRouter({ repository, sessionSecret: SECRET, logger: { error() {} } }));
    app.use((_request, response) => response.status(404).send('decoy'));
  });
}

// Folded ICS output splits long lines with CRLF + space; unfold before
// asserting on content so assertions match logical lines, not wrapping.
function unfold(ics) {
  return ics.replace(/\r\n[ \t]/gu, '');
}

test('a valid token serves an ICS feed with only active dated delivery orders and no PII', async () => {
  const site = await calendarSite(fakeRepository(calendarState()));
  try {
    const response = await fetch(site.url(calendarPath(SECRET)));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/calendar/u);
    assert.equal(response.headers.get('cache-control'), 'private, max-age=300');
    assert.match(response.headers.get('x-robots-tag'), /noindex/u);

    const ics = unfold(await response.text());
    assert.match(ics, /^BEGIN:VCALENDAR\r\n/u);
    assert.match(ics, /END:VCALENDAR\r\n$/u);
    assert.match(ics, /BEGIN:VTIMEZONE\r\n(?:.*\r\n)*?TZID:Asia\/Dubai/u);

    // Exactly the two active dated orders — nothing else becomes an event.
    assert.equal((ics.match(/BEGIN:VEVENT/gu) || []).length, 2);
    assert.match(ics, /UID:bm-ord-1@bat-melech/u);
    assert.match(ics, /UID:bm-ord-2@bat-melech/u);
    assert.doesNotMatch(ics, /ord-cancelled|ord-delivered|ord-pickup|ord-undated|ord-rolled-date/u);
    assert.doesNotMatch(ics, /מבוטלת|כבר נמסרה|איסוף עצמי|בלי תאריך|בלי מזהה|תאריך בלתי אפשרי/u);

    // RFC 5545 escaping: commas and semicolons in name and destination.
    assert.match(ics, /SUMMARY:משלוח — Cohen\\, Sarah\\; the "VIP"/u);
    assert.match(ics, /LOCATION:Address Marina\\, Tower 2\\; Floor 3/u);

    // A parsable time becomes a timed Dubai event with a bounded end.
    assert.match(ics, /DTSTART;TZID=Asia\/Dubai:20990814T130000/u);
    assert.match(ics, /DTEND;TZID=Asia\/Dubai:20990814T143000/u);
    // An unparsable time becomes an honest all-day event.
    assert.match(ics, /DTSTART;VALUE=DATE:20990815/u);
    assert.match(ics, /DTEND;VALUE=DATE:20990816/u);

    // Never on this surface: phones, totals, deposits, notes. DTSTAMP lines
    // carry the current wall clock and could coincidentally contain any digit
    // run, so they are excluded from the digit assertions.
    const withoutStamps = ics.replace(/DTSTAMP:[^\r\n]*\r\n/gu, '');
    assert.doesNotMatch(withoutStamps, /971501234567|971509876543/u, 'phone numbers must not leak');
    assert.doesNotMatch(withoutStamps, /850|1200|\b100\b/u, 'prices and deposits must not leak');
    assert.doesNotMatch(withoutStamps, /allergic|private note/u, 'notes must not leak');
  } finally {
    site.close();
  }
});

test('an invalid token gets a generic 404 with no hint that a feed exists', async () => {
  const site = await calendarSite(fakeRepository(calendarState()));
  try {
    const wrong = await fetch(site.url(`/calendar/${'0'.repeat(TOKEN_HEX_LENGTH)}/deliveries.ics`));
    assert.equal(wrong.status, 404);
    const body = await wrong.text();
    assert.doesNotMatch(body, /calendar|deliver|מלך|Melech|token/iu, '404 must not hint at the feed');

    // Near-miss token: flip only the last character of the real token.
    const good = calendarToken(SECRET);
    const nearMiss = good.slice(0, -1) + (good.slice(-1) === '0' ? '1' : '0');
    const flipped = await fetch(site.url(`/calendar/${nearMiss}/deliveries.ics`));
    assert.equal(flipped.status, 404);
  } finally {
    site.close();
  }
});

test('timing-safe verify accepts exactly the derived token and nothing near it', () => {
  const token = calendarToken(SECRET);
  assert.equal(token.length, TOKEN_HEX_LENGTH);
  assert.equal(verifyCalendarToken(token, SECRET), true);
  assert.equal(verifyCalendarToken(token.slice(0, -1), SECRET), false);
  assert.equal(verifyCalendarToken(`${token}0`, SECRET), false);
  assert.equal(verifyCalendarToken('', SECRET), false);
  // A different session secret derives a different capability.
  assert.equal(verifyCalendarToken(token, 'other-secret'), false);

  assert.equal(calendarPath(SECRET), `/calendar/${token}/deliveries.ics`);
});

test('the builder folds long lines, terminates with CRLF, and stays valid on an empty store', () => {
  const longName = 'א'.repeat(120);
  const ics = buildDeliveriesCalendar({
    orders: [{ id: 'long', name: longName, date: '2099-01-02', time: '18:30', status: 'אושרה' }],
  });
  for (const line of ics.split('\r\n')) {
    assert.ok(Buffer.byteLength(line) <= 75, `folded line exceeds 75 octets: ${line.length} chars`);
  }
  assert.match(unfold(ics), new RegExp(`SUMMARY:משלוח — ${longName}`, 'u'));

  const empty = buildDeliveriesCalendar({ orders: [] });
  assert.match(empty, /BEGIN:VCALENDAR\r\n/u);
  assert.match(empty, /END:VCALENDAR\r\n$/u);
  assert.doesNotMatch(empty, /BEGIN:VEVENT/u);
});
