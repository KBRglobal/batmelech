'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MAX_CALLBACK_BYTES,
  callbackData,
  checkinPrompt,
  delayAdvice,
  digest,
  lateEscalation,
  leadReminder,
  plataPickupDigest,
  proofAmbiguous,
  proofRecorded,
} = require('../server/telegram/delivery-messages');

const RAW_ID = 'site-1786000000000-deadbeef';

function order(overrides) {
  return {
    id: RAW_ID,
    date: '2026-08-14',
    time: '12:30',
    name: 'דנה',
    hotelName: 'Atlantis',
    hotelAddress: 'Atlantis The Palm, Dubai',
    status: 'חדשה',
    meyToken: 'a1b2c3d4',
    ...overrides,
  };
}

const HEBREW = /[֐-׿]/u;

// One place that builds every message, so the cross-cutting checks below
// (callback size, no raw ids) can never miss a builder.
function everyMessage() {
  const first = order({});
  const second = order({ name: 'רותי', time: '13:45', hotelName: 'Rixos', meyToken: 'e5f6a7b8' });
  return [
    ['digest', digest([first, second, order({ name: 'שרה', time: '' })], '2026-08-14', [
      'https://www.google.com/maps/dir/Atlantis',
    ])],
    ['leadReminder single', leadReminder([first])],
    ['leadReminder grouped', leadReminder([first, second])],
    ['checkinPrompt', checkinPrompt(first)],
    ['lateEscalation', lateEscalation(first)],
    ['proofRecorded', proofRecorded(first, second)],
    ['proofRecorded last stop', proofRecorded(first, null)],
    ['proofAmbiguous', proofAmbiguous([first, second])],
    ['delayAdvice', delayAdvice(first, 25)],
    ['delayAdvice no eta', delayAdvice(first, null)],
  ];
}

function buttonsOf(message) {
  const rows = message.reply_markup ? message.reply_markup.inline_keyboard : [];
  return rows.flat();
}

test('every builder returns non-empty Hebrew text', () => {
  for (const [label, message] of everyMessage()) {
    assert.equal(typeof message.text, 'string', label);
    assert.ok(message.text.trim().length > 0, `${label} has text`);
    assert.match(message.text, HEBREW, `${label} speaks Hebrew`);
  }
});

test('every callback_data fits Telegram 64 bytes and uses the d|action|token shape', () => {
  const actions = new Set(['otw', 'ontime', 'late', 'proof', 'undo', 'draft', 'cancel']);
  for (const [label, message] of everyMessage()) {
    for (const entry of buttonsOf(message)) {
      assert.ok(entry.text.trim().length > 0, `${label} button has a label`);
      const parts = entry.callback_data.split('|');
      assert.equal(parts.length, 3, `${label} callback has three parts`);
      assert.equal(parts[0], 'd', `${label} callback is namespaced`);
      assert.ok(actions.has(parts[1]), `${label} uses a known action: ${parts[1]}`);
      assert.ok(
        Buffer.byteLength(entry.callback_data, 'utf8') <= MAX_CALLBACK_BYTES,
        `${label} callback fits 64 bytes`,
      );
    }
  }
});

test('no message ever leaks a raw order id', () => {
  for (const [label, message] of everyMessage()) {
    assert.ok(!message.text.includes(RAW_ID), `${label} text has no order id`);
    for (const entry of buttonsOf(message)) {
      assert.ok(!entry.callback_data.includes(RAW_ID), `${label} callback has no order id`);
    }
  }
});

test('callbackData refuses unknown actions, bad tokens, and oversized payloads', () => {
  assert.equal(callbackData('otw', 'a1b2c3d4'), 'd|otw|a1b2c3d4');
  assert.throws(() => callbackData('nuke', 'a1b2c3d4'), /unknown delivery callback action/u);
  assert.throws(() => callbackData('otw', ''), /meyToken/u);
  assert.throws(() => callbackData('otw', 'has spaces'), /meyToken/u);
  assert.throws(() => callbackData('otw', 'x'.repeat(49)), /meyToken/u);
  assert.throws(() => checkinPrompt(order({ meyToken: undefined })), /meyToken/u);
});

test('digest numbers the route, names the untimed stops, and links the full route', () => {
  const message = digest(
    [
      order({ name: 'דנה', time: '12.30' }),
      order({ name: 'רותי', time: '13:45', hotelName: 'Rixos', meyToken: 'e5f6a7b8' }),
      order({ name: 'שרה', time: '', hotelName: 'Marina', meyToken: 'c9d8e7f6' }),
    ],
    '2026-08-14',
    ['https://www.google.com/maps/dir/A/B', 'https://www.google.com/maps/dir/C'],
  );
  assert.match(message.text, /פליקס/u, 'greets Felix');
  assert.match(message.text, /14\/08/u, 'shows the day');
  assert.ok(message.text.includes('1. 12:30 · דנה · Atlantis'), 'normalises 12.30 and numbers the stop');
  assert.ok(message.text.includes('2. 13:45 · רותי · Rixos'));
  assert.ok(message.text.includes('• ללא שעה: שרה'), 'untimed stops are named, never dropped');
  assert.ok(message.text.includes('מסלול מלא בניווט: https://www.google.com/maps/dir/A/B'));
  assert.ok(message.text.includes('מסלול מלא בניווט: https://www.google.com/maps/dir/C'), 'one line per chunk');
  assert.equal(message.reply_markup, undefined, 'the digest has no buttons');
});

test('digest drops the untimed line when every stop has a time, and handles an empty day', () => {
  const timedOnly = digest([order({})], '2026-08-14', []);
  assert.ok(!timedOnly.text.includes('ללא שעה'));
  assert.ok(!timedOnly.text.includes('מסלול מלא בניווט'));
  assert.ok(timedOnly.text.includes('משלוח אחד'));

  const empty = digest([], '2026-08-14');
  assert.match(empty.text, /אין משלוחים/u);
  assert.equal(empty.reply_markup, undefined);
});

test('leadReminder is one line for one stop and one message for a shared destination', () => {
  const single = leadReminder([order({})]);
  assert.ok(single.text.includes('עוד שעה וחצי: דנה ב-Atlantis, שעה 12:30'));
  assert.match(single.text, /ניווט: https:\/\//u);
  assert.equal(single.reply_markup, undefined);

  const grouped = leadReminder([
    order({}),
    order({ name: 'רותי', time: '12:45', meyToken: 'e5f6a7b8' }),
  ]);
  assert.ok(grouped.text.includes('עוד שעה וחצי ב-Atlantis:'));
  assert.ok(grouped.text.includes('• דנה, שעה 12:30'));
  assert.ok(grouped.text.includes('• רותי, שעה 12:45'));
  assert.equal(grouped.text.match(/עוד שעה וחצי/gu).length, 1, 'one nudge, not one per order');

  assert.equal(leadReminder([]).text, '');
});

test('checkinPrompt asks once and offers the three answers in a single row', () => {
  const message = checkinPrompt(order({}));
  assert.ok(message.text.includes('דנה ב-Atlantis בשעה 12:30 — בדרך?'));
  const rows = message.reply_markup.inline_keyboard;
  assert.equal(rows.length, 1);
  assert.deepEqual(
    rows[0].map((entry) => entry.callback_data),
    ['d|otw|a1b2c3d4', 'd|ontime|a1b2c3d4', 'd|late|a1b2c3d4'],
  );
});

test('a Hebrew destination keeps the prefix glued, a Latin one gets a hyphen', () => {
  const hebrew = checkinPrompt(order({ hotelName: 'מרינה' }));
  assert.ok(hebrew.text.includes('במרינה'), 'no hyphen inside Hebrew');
  const latin = checkinPrompt(order({ hotelName: 'Rixos' }));
  assert.ok(latin.text.includes('ב-Rixos'));
});

test('lateEscalation asks how things are and offers delivered / delayed / draft', () => {
  const message = lateEscalation(order({}));
  assert.ok(message.text.includes('כבר 12:30 ועוד לא סומן שנמסר לדנה. הכל בסדר?'));
  assert.deepEqual(
    message.reply_markup.inline_keyboard.map((row) => row[0].callback_data),
    ['d|proof|a1b2c3d4', 'd|late|a1b2c3d4', 'd|draft|a1b2c3d4'],
  );
  const withClock = lateEscalation(order({}), '13:05');
  assert.ok(withClock.text.includes('כבר 13:05'), 'the caller can pass the real clock time');
});

test('proofRecorded confirms, points at the next stop, and can be undone', () => {
  const next = order({
    name: 'רותי',
    time: '13:45',
    hotelName: 'Rixos',
    hotelAddress: 'Rixos Premium, JBR',
    meyToken: 'e5f6a7b8',
  });
  const message = proofRecorded(order({}), next);
  assert.ok(message.text.includes('צילום המסירה של דנה'));
  assert.ok(message.text.includes('היעד הבא: רותי ב-Rixos, 13:45'));
  assert.ok(
    message.text.includes(`ניווט: https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Rixos Premium, JBR')}`),
    'the link points at the next stop, not the one just delivered',
  );
  assert.deepEqual(
    message.reply_markup.inline_keyboard.map((row) => row[0].callback_data),
    ['d|undo|a1b2c3d4'],
    'undo targets the order just marked delivered, not the next one',
  );

  const last = proofRecorded(order({}), null);
  assert.ok(!last.text.includes('היעד הבא'));
});

test('proofAmbiguous offers one button per candidate plus a way out', () => {
  const candidates = [
    order({ name: 'דנה' }),
    order({ name: 'רותי', meyToken: 'e5f6a7b8' }),
  ];
  const message = proofAmbiguous(candidates);
  assert.equal(message.text, 'לאיזה משלוח לשייך את התמונה?');
  const rows = message.reply_markup.inline_keyboard;
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((row) => row[0].callback_data),
    ['d|proof|a1b2c3d4', 'd|proof|e5f6a7b8', 'd|cancel|-'],
  );
  assert.deepEqual(rows.map((row) => row[0].text), ['דנה', 'רותי', 'ביטול']);
});

test('delayAdvice advises Felix and only ever offers to draft, never to send', () => {
  const message = delayAdvice(order({}), 25);
  assert.ok(message.text.includes('25 דקות'));
  assert.ok(message.text.includes('12:30'), 'names the time the customer asked for');
  assert.ok(message.text.includes('רוצה שאנסח לך הודעה להעתיק?'));
  assert.ok(!/שולח|שלחתי|נשלח/u.test(message.text), 'nothing here goes out to a customer');
  assert.deepEqual(
    message.reply_markup.inline_keyboard.map((row) => row[0].callback_data),
    ['d|draft|a1b2c3d4'],
  );

  const noEta = delayAdvice(order({}), null);
  assert.ok(noEta.text.includes('מתעכב'));
  assert.ok(!noEta.text.includes('NaN'));
});

// --- plata (hotplate) pickup digest --------------------------------------------

test('plataPickupDigest lists every plate to collect, with the note when there is one', () => {
  const message = plataPickupDigest([
    order({ name: 'דנה', hotelName: 'Atlantis', plataCount: 2, plataPickupNote: 'בקבלה' }),
    order({ name: 'רותי', hotelName: 'Hilton', plataCount: 1 }),
  ]);

  const lines = message.text.split('\n');
  assert.equal(lines[0], 'פלטות לאיסוף:');
  assert.equal(lines[2], '• דנה · Atlantis · 2 פלטות · בקבלה');
  assert.equal(lines[3], '• רותי · Hilton · פלטה אחת');
  assert.equal(message.reply_markup, undefined, 'v1 needs no buttons');
});

test('plataPickupDigest never prints a raw order id and survives a thin order', () => {
  const message = plataPickupDigest([order({ name: '', hotelName: '', place: '', address: '', plataCount: 0 })]);
  assert.ok(!message.text.includes(RAW_ID));
  assert.ok(message.text.includes('ללא שם'));
  assert.ok(message.text.includes('יעד לא צוין'));
  assert.ok(!message.text.includes('NaN'));
});

test('plataPickupDigest says nothing when there is nothing to collect', () => {
  assert.equal(plataPickupDigest([]).text, '');
  assert.equal(plataPickupDigest(null).text, '');
});
