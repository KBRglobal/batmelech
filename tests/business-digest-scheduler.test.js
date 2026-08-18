'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createDeliveryScheduler } = require('../server/telegram/delivery-scheduler');

const silentLogger = { error() {}, warn() {}, log() {} };

// Same fake as tests/delivery-scheduler.test.js: the scheduler drives the real
// business-actions, so the repository must honour the load/save contract.
function fakeRepository(initialState) {
  let state = initialState;
  let revision = 1;
  return {
    async loadState() {
      return { data: state, revision, hash: 'h' };
    },
    async saveState({ localState }) {
      state = localState;
      revision += 1;
      return { ok: true };
    },
    _current: () => state,
  };
}

function stubFetch() {
  const sent = [];
  const original = global.fetch;
  let nextMessageId = 900;
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    nextMessageId += 1;
    sent.push({ url, messageId: nextMessageId, ...body });
    const payload = { ok: true, result: { message_id: nextMessageId } };
    return {
      ok: true,
      async json() { return payload; },
      async text() { return JSON.stringify(payload); },
    };
  };
  return { sent, restore() { global.fetch = original; } };
}

// Dubai is UTC+4 all year, so a wall-clock time there is one fixed instant.
function dubaiClock(dateString, hours, minutes) {
  const pad = (value) => String(value).padStart(2, '0');
  return new Date(`${dateString}T${pad(hours)}:${pad(minutes)}:00+04:00`);
}

function schedulerAt(repo, clock) {
  return createDeliveryScheduler({
    repository: repo,
    botToken: 'token',
    chatId: 77,
    logger: silentLogger,
    now: () => clock.at,
  });
}

const isWeekly = (message) => message.text.startsWith('סיכום השבוע');
const isForecast = (message) => message.text.startsWith('לפי מה שהוזמן עד עכשיו לשישי');

const SUNDAY = '2026-08-16';    // window: 09/08 (Sun) – 15/08 (Sat)
const WEDNESDAY = '2026-08-19';
const FRIDAY = '2026-08-21';
const SATURDAY_CLOSE = '2026-08-15';

function order(overrides) {
  return {
    id: 'o1',
    date: '2026-08-10',
    name: 'רותי',
    phone: '050-1234567',
    total: '390',
    status: 'נמסרה',
    mains: { 'חזה עוף': 2 },
    ...overrides,
  };
}

function stateWith(orders, settings = {}) {
  return { orders, settings };
}

// A week that always has something to report, so the tests below can vary only
// the clock.
function lastWeek() {
  return [
    order({ id: 'a', date: '2026-08-10', total: '390' }),
    order({ id: 'b', date: '2026-08-12', total: '740$' }),
  ];
}

test('the weekly digest goes out once on Sunday at 09:00, whatever the tick count', async (t) => {
  const fetchStub = stubFetch();
  t.after(() => fetchStub.restore());

  const repo = fakeRepository(stateWith(lastWeek()));
  const clock = { at: dubaiClock(SUNDAY, 9, 0) };
  const scheduler = schedulerAt(repo, clock);

  for (let i = 0; i < 5; i += 1) await scheduler.tick();

  const digests = fetchStub.sent.filter(isWeekly);
  assert.equal(digests.length, 1);
  assert.equal(repo._current().settings.meyWeeklyDigestSentFor, SATURDAY_CLOSE);
  assert.match(digests[0].text, /הכנסות: 1,130\$/u);
  assert.match(digests[0].text, /2 הזמנות/u);
});

test('the weekly digest waits for 09:00 and never fires on another weekday', async (t) => {
  const fetchStub = stubFetch();
  t.after(() => fetchStub.restore());

  const early = fakeRepository(stateWith(lastWeek()));
  await schedulerAt(early, { at: dubaiClock(SUNDAY, 8, 59) }).tick();
  assert.equal(fetchStub.sent.filter(isWeekly).length, 0);
  assert.equal(early._current().settings.meyWeeklyDigestSentFor, undefined);

  for (const [day, label] of [[WEDNESDAY, 'Wednesday'], ['2026-08-17', 'Monday'], [SATURDAY_CLOSE, 'Saturday']]) {
    const repo = fakeRepository(stateWith(lastWeek()));
    await schedulerAt(repo, { at: dubaiClock(day, 11, 0) }).tick();
    assert.equal(fetchStub.sent.filter(isWeekly).length, 0, `weekly digest leaked onto ${label}`);
  }

  // Same Sunday, one minute later — now it goes.
  const onTime = fakeRepository(stateWith(lastWeek()));
  await schedulerAt(onTime, { at: dubaiClock(SUNDAY, 9, 0) }).tick();
  assert.equal(fetchStub.sent.filter(isWeekly).length, 1);
});

test('a restarted scheduler does not resend the weekly digest', async (t) => {
  const fetchStub = stubFetch();
  t.after(() => fetchStub.restore());

  const repo = fakeRepository(stateWith(lastWeek()));
  const clock = { at: dubaiClock(SUNDAY, 9, 30) };

  await schedulerAt(repo, clock).tick();
  assert.equal(fetchStub.sent.filter(isWeekly).length, 1);

  // Container restarted: brand-new scheduler, same state, later in the day.
  clock.at = dubaiClock(SUNDAY, 18, 0);
  await schedulerAt(repo, clock).tick();
  assert.equal(fetchStub.sent.filter(isWeekly).length, 1);
});

test('a week with no orders sends nothing at all', async (t) => {
  const fetchStub = stubFetch();
  t.after(() => fetchStub.restore());

  // Orders exist, but all of them outside the window (and one cancelled inside).
  const repo = fakeRepository(stateWith([
    order({ id: 'old', date: '2026-07-01' }),
    order({ id: 'cancelled', date: '2026-08-12', status: 'בוטלה' }),
  ]));
  await schedulerAt(repo, { at: dubaiClock(SUNDAY, 9, 30) }).tick();

  assert.equal(fetchStub.sent.filter(isWeekly).length, 0);
  assert.equal(repo._current().settings.meyWeeklyDigestSentFor, undefined);
});

test('the weekly digest counts new against returning customers', async (t) => {
  const fetchStub = stubFetch();
  t.after(() => fetchStub.restore());

  const repo = fakeRepository(stateWith([
    order({ id: 'history', date: '2026-06-01', phone: '050-1111111' }),
    order({ id: 'w1', date: '2026-08-10', phone: '0501111111' }), // returning
    order({ id: 'w2', date: '2026-08-11', phone: '050-2222222' }), // new
  ]));
  await schedulerAt(repo, { at: dubaiClock(SUNDAY, 9, 30) }).tick();

  const [message] = fetchStub.sent.filter(isWeekly);
  assert.match(message.text, /1 חדשים, 1 חוזרים/u);
});

test('an unreadable total is reported apart instead of quietly zeroed', async (t) => {
  const fetchStub = stubFetch();
  t.after(() => fetchStub.restore());

  const repo = fakeRepository(stateWith([
    order({ id: 'a', date: '2026-08-10', total: '390' }),
    order({ id: 'b', date: '2026-08-11', total: '740$' }),
    order({ id: 'c', date: '2026-08-12', total: 'שילמה במזומן' }),
    order({ id: 'd', date: '2026-08-13', total: '' }),
  ]));
  await schedulerAt(repo, { at: dubaiClock(SUNDAY, 9, 30) }).tick();

  const [message] = fetchStub.sent.filter(isWeekly);
  assert.match(message.text, /הכנסות: 1,130\$/u);
  assert.match(message.text, /2 הזמנות בלי סכום קריא — לא חושבו/u);
});

test('the prep forecast goes out once on Wednesday at 10:00 and lists Friday by course', async (t) => {
  const fetchStub = stubFetch();
  t.after(() => fetchStub.restore());

  const repo = fakeRepository(stateWith([
    order({ id: 'f1', date: FRIDAY, status: 'חדשה', meals: 2, salads: { 'טחינה': { o: 3, p: 1 } }, mains: { 'דג': 2 } }),
    order({ id: 'f2', date: FRIDAY, status: 'חדשה', meals: 1, salads: { 'טחינה': { o: 1, p: 0 } }, mains: {} }),
  ]));
  const clock = { at: dubaiClock(WEDNESDAY, 10, 0) };
  const scheduler = schedulerAt(repo, clock);

  for (let i = 0; i < 3; i += 1) await scheduler.tick();

  const forecasts = fetchStub.sent.filter(isForecast);
  assert.equal(forecasts.length, 1);
  assert.equal(repo._current().settings.meyPrepForecastSentFor, FRIDAY);
  assert.match(forecasts[0].text, /21\/08/u);
  assert.match(forecasts[0].text, /סלטים:\n• טחינה — 5/u);   // 3+1 ordered/gift, plus 1
  assert.match(forecasts[0].text, /עיקריות:\n• דג — 2/u);
  assert.match(forecasts[0].text, /2 הזמנות · 3 ארוחות זוגיות/u);
});

test('the prep forecast waits for 10:00, skips other weekdays, and survives a restart', async (t) => {
  const fetchStub = stubFetch();
  t.after(() => fetchStub.restore());

  const friday = () => [order({ id: 'f1', date: FRIDAY, status: 'חדשה', meals: 1, mains: { 'דג': 2 } })];

  const early = fakeRepository(stateWith(friday()));
  await schedulerAt(early, { at: dubaiClock(WEDNESDAY, 9, 59) }).tick();
  assert.equal(fetchStub.sent.filter(isForecast).length, 0);
  assert.equal(early._current().settings.meyPrepForecastSentFor, undefined);

  for (const day of [SUNDAY, '2026-08-18', '2026-08-20']) {
    const repo = fakeRepository(stateWith(friday()));
    await schedulerAt(repo, { at: dubaiClock(day, 11, 0) }).tick();
    assert.equal(fetchStub.sent.filter(isForecast).length, 0, `forecast leaked onto ${day}`);
  }

  const repo = fakeRepository(stateWith(friday()));
  const clock = { at: dubaiClock(WEDNESDAY, 10, 5) };
  await schedulerAt(repo, clock).tick();
  assert.equal(fetchStub.sent.filter(isForecast).length, 1);

  clock.at = dubaiClock(WEDNESDAY, 16, 0);
  await schedulerAt(repo, clock).tick(); // restart, same state
  assert.equal(fetchStub.sent.filter(isForecast).length, 1);
});

test('an empty Friday produces no forecast and claims nothing', async (t) => {
  const fetchStub = stubFetch();
  t.after(() => fetchStub.restore());

  const repo = fakeRepository(stateWith([
    order({ id: 'other', date: '2026-08-28', mains: { 'דג': 5 } }),
    order({ id: 'cancelled', date: FRIDAY, status: 'בוטלה', mains: { 'דג': 5 } }),
  ]));
  await schedulerAt(repo, { at: dubaiClock(WEDNESDAY, 10, 30) }).tick();

  assert.equal(fetchStub.sent.filter(isForecast).length, 0);
  assert.equal(repo._current().settings.meyPrepForecastSentFor, undefined);
});

test('the business messages follow the Dubai day, not UTC', async (t) => {
  const fetchStub = stubFetch();
  t.after(() => fetchStub.restore());

  // Saturday 21:30 UTC is already Sunday 01:30 in Dubai — still before 09:00.
  const repo = fakeRepository(stateWith(lastWeek()));
  await schedulerAt(repo, { at: new Date('2026-08-15T21:30:00Z') }).tick();
  assert.equal(fetchStub.sent.filter(isWeekly).length, 0);

  // Sunday 05:30 UTC is Sunday 09:30 in Dubai — the digest is due.
  await schedulerAt(repo, { at: new Date('2026-08-16T05:30:00Z') }).tick();
  const digests = fetchStub.sent.filter(isWeekly);
  assert.equal(digests.length, 1);
  assert.match(digests[0].text, /09\/08–15\/08/u);
});

test('both business steps stay silent when the repository is down, and never throw', async (t) => {
  const fetchStub = stubFetch();
  t.after(() => fetchStub.restore());

  const errors = [];
  const scheduler = createDeliveryScheduler({
    repository: { async loadState() { throw new Error('postgres is having a day'); } },
    botToken: 'token',
    chatId: 77,
    logger: { error: (...args) => errors.push(args) },
    now: () => dubaiClock(SUNDAY, 9, 30),
  });

  await scheduler.tick();
  assert.equal(errors.length, 1);
  assert.equal(fetchStub.sent.length, 0);
});
