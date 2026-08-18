'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createBusinessClock,
  missingDetails,
  upcomingFriday,
  wednesdayDigestText,
  weeklySummaryText,
  weekRange,
} = require('../server/telegram/business-clock');
const { decryptSecret } = require('../server/business-data/secret-box');

const KEY = Buffer.alloc(32, 7).toString('base64');

function fakeRepository(initialState) {
  let state = initialState;
  let revision = 1;
  return {
    async loadState() {
      return { data: structuredClone(state), revision, hash: 'h' };
    },
    async saveState({ localState }) {
      state = structuredClone(localState);
      revision += 1;
      return { ok: true };
    },
    _current: () => state,
  };
}

const silentLogger = { error() {} };

function stubTelegram(sent) {
  const original = global.fetch;
  global.fetch = async (url, options) => {
    if (String(url).includes('api.telegram.org')) {
      sent.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    }
    return original(url, options);
  };
  return () => {
    global.fetch = original;
  };
}

// Wednesday 2026-08-19 12:00 Dubai == 08:00 UTC.
const WEDNESDAY_NOON = new Date('2026-08-19T08:00:00Z');
// Saturday 2026-08-22 22:00 Dubai == 18:00 UTC.
const SATURDAY_NIGHT = new Date('2026-08-22T18:00:00Z');

test('helpers: upcoming friday, missing details, week range', () => {
  assert.equal(upcomingFriday(WEDNESDAY_NOON), '2026-08-21');
  assert.equal(upcomingFriday(new Date('2026-08-21T08:00:00Z')), '2026-08-21');
  assert.deepEqual(
    missingDetails({ name: 'א', time: '', address: '', total: 0 }),
    ['שעה', 'כתובת', 'מחיר']
  );
  assert.deepEqual(missingDetails({ time: '13:00', hotelName: 'Hilton', total: 230 }), []);
  const range = weekRange(SATURDAY_NIGHT);
  assert.equal(range.days.length, 7);
  assert.equal(range.to, '2026-08-22');
  assert.equal(range.days[0], '2026-08-16');
});

test('wednesday digest fires once, at the right time, with honest missing-details lines', async () => {
  const repository = fakeRepository({
    orders: [
      { id: 'a', date: '2026-08-21', name: 'קטי', time: '13:00', hotelName: 'Hilton', total: 230, meals: 1, status: 'אושרה' },
      { id: 'b', date: '2026-08-21', name: 'דני', time: '', address: '', total: 0, status: 'חדשה' },
      { id: 'c', date: '2026-08-21', name: 'מבוטלת', status: 'בוטלה' },
      { id: 'd', date: '2026-08-28', name: 'שבוע הבא', status: 'חדשה' },
    ],
    settings: {},
  });
  const sent = [];
  const restore = stubTelegram(sent);
  const clock = createBusinessClock({
    repository,
    botToken: 't',
    chatId: '-1',
    logger: silentLogger,
    env: {},
    now: () => WEDNESDAY_NOON,
  });
  try {
    await clock.tick();
    await clock.tick(); // second tick must be silent — claimed
  } finally {
    restore();
  }
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /2 הזמנות/u);
  assert.match(sent[0].text, /1 זוגיות/u);
  assert.match(sent[0].text, /דני — שעה, כתובת, מחיר/u);
  assert.doesNotMatch(sent[0].text, /מבוטלת|שבוע הבא/u);
  assert.equal(repository._current().settings.meyWednesdayDigestFor, '2026-08-19');
});

test('digest stays quiet before 10:00 and on non-Wednesdays', async () => {
  const repository = fakeRepository({ orders: [{ id: 'a', date: '2026-08-21', status: 'חדשה' }], settings: {} });
  const sent = [];
  const restore = stubTelegram(sent);
  try {
    // Wednesday 08:00 Dubai (04:00 UTC) — too early.
    await createBusinessClock({ repository, botToken: 't', chatId: '-1', logger: silentLogger, env: {}, now: () => new Date('2026-08-19T04:00:00Z') }).tick();
    // Thursday noon — wrong day.
    await createBusinessClock({ repository, botToken: 't', chatId: '-1', logger: silentLogger, env: {}, now: () => new Date('2026-08-20T08:00:00Z') }).tick();
  } finally {
    restore();
  }
  assert.equal(sent.length, 0);
});

test('saturday-night summary counts the closing week honestly', async () => {
  const repository = fakeRepository({
    orders: [
      { id: 'a', date: '2026-08-21', name: 'א', status: 'נמסרה', total: 230 },
      { id: 'b', date: '2026-08-18', name: 'ב', status: 'אושרה', total: 155 },
      { id: 'c', date: '2026-08-20', name: 'ג', status: 'חדשה' }, // no price
      { id: 'old', date: '2026-08-10', name: 'ישן', status: 'נמסרה', total: 999 },
    ],
    settings: {},
  });
  const sent = [];
  const restore = stubTelegram(sent);
  try {
    const clock = createBusinessClock({ repository, botToken: 't', chatId: '-1', logger: silentLogger, env: {}, now: () => SATURDAY_NIGHT });
    await clock.tick();
    await clock.tick();
  } finally {
    restore();
  }
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /3 הזמנות השבוע · 1 נמסרו/u);
  assert.match(sent[0].text, /\$385/u);
  assert.match(sent[0].text, /בלי 1 הזמנות ללא מחיר/u);
  assert.doesNotMatch(sent[0].text, /999/u);
});

test('nightly backup uploads an encrypted snapshot once per day', async () => {
  const repository = fakeRepository({
    orders: [{ id: 'a', name: 'סודי מאוד', phone: '+971500000001' }],
    settings: {},
  });
  const uploads = [];
  const storage = {
    enabled: true,
    async putStateBackup({ dateString, encryptedBody }) {
      uploads.push({ dateString, encryptedBody });
      return { key: `backups/${dateString}-x.json.enc` };
    },
  };
  const sent = [];
  const restore = stubTelegram(sent);
  try {
    const clock = createBusinessClock({
      repository,
      botToken: 't',
      chatId: '-1',
      storage,
      env: { BM_SECRETS_KEY: KEY },
      logger: silentLogger,
      now: () => new Date('2026-08-19T04:00:00Z'), // 08:00 Dubai — past 03:30
    });
    await clock.tick();
    await clock.tick();
  } finally {
    restore();
  }
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].dateString, '2026-08-19');
  // The payload is never plaintext — it decrypts back to the exact state.
  assert.doesNotMatch(uploads[0].encryptedBody, /סודי מאוד|971500000001/u);
  const decrypted = JSON.parse(decryptSecret(JSON.parse(uploads[0].encryptedBody), KEY));
  assert.equal(decrypted.orders[0].name, 'סודי מאוד');

  // Without a secrets key or storage, the backup never claims the marker.
  const bare = fakeRepository({ orders: [], settings: {} });
  const bareClock = createBusinessClock({ repository: bare, botToken: 't', chatId: '-1', storage: null, env: {}, logger: silentLogger, now: () => new Date('2026-08-19T04:00:00Z') });
  const restore2 = stubTelegram([]);
  try {
    await bareClock.tick();
  } finally {
    restore2();
  }
  assert.equal(bare._current().settings.meyBackupFor, undefined);
});

test('weekly email backup fires once on Sunday at 08:00 Dubai and records the send', async () => {
  const repository = fakeRepository({
    orders: [{ id: 'a', name: 'שמור', total: 100 }],
    settings: { weeklyBackupEmail: 'lin@batmelech.ae' },
  });
  const emails = [];
  const sendBackupEmail = async ({ toEmail, artifact }) => {
    emails.push({ toEmail, artifact });
  };
  const restore = stubTelegram([]);
  try {
    const clock = createBusinessClock({
      repository,
      botToken: 't',
      chatId: '-1',
      env: { RESEND_API_KEY: 're_test' },
      logger: silentLogger,
      now: () => new Date('2026-08-16T04:00:00Z'), // Sunday 08:00 Dubai
      sendBackupEmail,
    });
    await clock.tick();
    await clock.tick(); // second tick same day must be silent
  } finally {
    restore();
  }
  assert.equal(emails.length, 1);
  assert.equal(emails[0].toEmail, 'lin@batmelech.ae');
  assert.match(emails[0].artifact.filename, /batmelech-orders-2026-08-16\.json$/u);
  assert.equal(JSON.parse(emails[0].artifact.content).orders[0].name, 'שמור');

  const currentSettings = repository._current().settings;
  assert.equal(currentSettings.meyWeeklyBackupEmailFor, '2026-08-16');
  assert.equal(typeof currentSettings.lastWeeklyBackupAt, 'number');
  assert.ok(currentSettings.lastWeeklyBackupAt > 0);
});

test('weekly email backup stays quiet without a configured address or on wrong day/time', async () => {
  const noEmailRepo = fakeRepository({ orders: [], settings: {} });
  const emails = [];
  const sendBackupEmail = async ({ toEmail, artifact }) => {
    emails.push({ toEmail, artifact });
  };
  const restore = stubTelegram([]);
  try {
    // No email configured.
    await createBusinessClock({
      repository: noEmailRepo,
      botToken: 't',
      chatId: '-1',
      env: { RESEND_API_KEY: 're_test' },
      logger: silentLogger,
      now: () => new Date('2026-08-16T04:00:00Z'),
      sendBackupEmail,
    }).tick();

    // Email configured but it is Saturday.
    const saturdayRepo = fakeRepository({ orders: [], settings: { weeklyBackupEmail: 'lin@batmelech.ae' } });
    await createBusinessClock({
      repository: saturdayRepo,
      botToken: 't',
      chatId: '-1',
      env: { RESEND_API_KEY: 're_test' },
      logger: silentLogger,
      now: () => new Date('2026-08-15T04:00:00Z'), // Saturday 08:00 Dubai
      sendBackupEmail,
    }).tick();

    // Email configured, Sunday, but before 08:00 Dubai.
    const earlyRepo = fakeRepository({ orders: [], settings: { weeklyBackupEmail: 'lin@batmelech.ae' } });
    await createBusinessClock({
      repository: earlyRepo,
      botToken: 't',
      chatId: '-1',
      env: { RESEND_API_KEY: 're_test' },
      logger: silentLogger,
      now: () => new Date('2026-08-16T02:00:00Z'), // Sunday 06:00 Dubai
      sendBackupEmail,
    }).tick();
  } finally {
    restore();
  }
  assert.equal(emails.length, 0);
});

test(' texts contain no technical jargon', () => {
  const digest = wednesdayDigestText('2026-08-21', []);
  assert.match(digest, /תזכורת רביעי/u);
  const summary = weeklySummaryText([], weekRange(SATURDAY_NIGHT));
  assert.match(summary, /סיכום שבועי/u);
});
