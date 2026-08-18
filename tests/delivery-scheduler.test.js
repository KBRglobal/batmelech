'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createDeliveryScheduler } = require('../server/telegram/delivery-scheduler');
const { dubaiDateString, dubaiMinutesOfDay } = require('../server/telegram/delivery-day');

const silentLogger = { error() {}, warn() {}, log() {} };

// Same shape as the fake in business-actions.test.js: the scheduler calls the
// real business-actions, so the repository has to honour the load/save contract.
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

function orderById(repo, id) {
  return repo._current().orders.find((order) => String(order.id) === String(id));
}

// Every send goes through the real sendTelegramMessage, so fetch is the seam —
// exactly how tests/send-message.test.js does it.
function stubFetch() {
  const sent = [];
  const original = global.fetch;
  let nextMessageId = 500;
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
  return {
    sent,
    restore() { global.fetch = original; },
  };
}

// Dubai is UTC+4 all year — no DST — so a wall-clock time there is one fixed
// instant, and the tests can say what Felix's watch reads.
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

const isDigest = (message) => message.text.startsWith('בוקר טוב פליקס');
const isLead = (message) => message.text.startsWith('עוד שעה וחצי');
const isCheckin = (message) => message.text.endsWith('— בדרך?');
const isLate = (message) => message.text.includes('לא סומן שנמסר');

const TODAY = '2026-08-14';

function order(overrides) {
  return { id: 'o1', date: TODAY, name: 'רותי', hotelName: 'Atlantis', time: '19:00', status: 'חדשה', ...overrides };
}

function stateWith(orders, settings = {}) {
  return { orders, settings };
}

test('the digest goes out exactly once across five consecutive ticks', async (t) => {
  const fetchStub = stubFetch();
  t.after(() => fetchStub.restore());

  const repo = fakeRepository(stateWith([order({ id: 'a', time: '12:00' }), order({ id: 'b', time: '19:00' })]));
  const clock = { at: dubaiClock(TODAY, 8, 30) };
  const scheduler = schedulerAt(repo, clock);

  for (let i = 0; i < 5; i += 1) await scheduler.tick();

  const digests = fetchStub.sent.filter(isDigest);
  assert.equal(digests.length, 1);
  assert.equal(repo._current().settings.meyDigestSentFor, TODAY);
  assert.match(digests[0].text, /רותי/u);
});

test('a restarted scheduler reading the same state does not resend the digest', async (t) => {
  const fetchStub = stubFetch();
  t.after(() => fetchStub.restore());

  const repo = fakeRepository(stateWith([order({ id: 'a', time: '12:00' })]));
  const clock = { at: dubaiClock(TODAY, 8, 30) };

  await schedulerAt(repo, clock).tick();
  assert.equal(fetchStub.sent.filter(isDigest).length, 1);

  // Process died, container restarted, brand-new scheduler over the same state.
  await schedulerAt(repo, clock).tick();
  assert.equal(fetchStub.sent.filter(isDigest).length, 1);
});

test('the lead reminder fires only inside its window, and only once', async (t) => {
  const fetchStub = stubFetch();
  t.after(() => fetchStub.restore());

  // 19:00 is minute 1140, so the lead window is [17:30, 19:00).
  const tooEarly = fakeRepository(stateWith([order({ id: 'a' })]));
  await schedulerAt(tooEarly, { at: dubaiClock(TODAY, 17, 29) }).tick();
  assert.equal(fetchStub.sent.filter(isLead).length, 0);
  assert.equal(orderById(tooEarly, 'a').meyLeadNudgeAt, undefined);

  const inWindow = fakeRepository(stateWith([order({ id: 'a' })]));
  const clock = { at: dubaiClock(TODAY, 17, 31) };
  const scheduler = schedulerAt(inWindow, clock);
  await scheduler.tick();
  await scheduler.tick();
  const leads = fetchStub.sent.filter(isLead);
  assert.equal(leads.length, 1);
  assert.match(leads[0].text, /רותי/u);
  assert.ok(orderById(inWindow, 'a').meyLeadNudgeAt > 0);

  // Past the delivery time the heads-up is pointless — the check-in owns it now.
  const tooLate = fakeRepository(stateWith([order({ id: 'a' })]));
  await schedulerAt(tooLate, { at: dubaiClock(TODAY, 19, 5) }).tick();
  assert.equal(fetchStub.sent.filter(isLead).length, 1);
  assert.equal(orderById(tooLate, 'a').meyLeadNudgeAt, undefined);
});

test('one message per destination even when a hotel has several deliveries', async (t) => {
  const fetchStub = stubFetch();
  t.after(() => fetchStub.restore());

  const repo = fakeRepository(stateWith([
    order({ id: 'a', name: 'רותי', hotelName: 'Atlantis' }),
    order({ id: 'b', name: 'דנה', hotelName: 'Atlantis' }),
    order({ id: 'c', name: 'שירה', hotelName: 'Burj Al Arab' }),
  ]));
  await schedulerAt(repo, { at: dubaiClock(TODAY, 17, 31) }).tick();

  const leads = fetchStub.sent.filter(isLead);
  assert.equal(leads.length, 2);
  const atlantis = leads.find((message) => message.text.includes('Atlantis'));
  assert.match(atlantis.text, /רותי/u);
  assert.match(atlantis.text, /דנה/u);
  assert.equal(leads.filter((message) => message.text.includes('שירה')).length, 1);
});

test('the check-in prompt carries the keyboard and records its message id; late fires only for undelivered', async (t) => {
  const fetchStub = stubFetch();
  t.after(() => fetchStub.restore());

  // Digest and lead already sent, so the check-in is the only thing left to do.
  const repo = fakeRepository(stateWith([
    order({ id: 'a', name: 'רותי', status: 'במשלוח', meyLeadNudgeAt: 1 }),
    order({ id: 'b', name: 'דנה', status: 'נמסרה' }),
  ], { meyDigestSentFor: TODAY }));
  const clock = { at: dubaiClock(TODAY, 18, 30) };
  const scheduler = schedulerAt(repo, clock);

  await scheduler.tick();
  const checkins = fetchStub.sent.filter(isCheckin);
  assert.equal(checkins.length, 1);
  assert.match(checkins[0].text, /רותי/u);
  const buttons = checkins[0].reply_markup.inline_keyboard[0];
  assert.equal(buttons.length, 3);
  const token = orderById(repo, 'a').meyToken;
  assert.deepEqual(buttons.map((b) => b.callback_data), [`d|otw|${token}`, `d|ontime|${token}`, `d|late|${token}`]);
  assert.equal(orderById(repo, 'a').meyPromptMessageId, checkins[0].messageId);

  // 19:15 is the grace edge; 19:20 is past it.
  clock.at = dubaiClock(TODAY, 19, 20);
  await scheduler.tick();
  const lates = fetchStub.sent.filter(isLate);
  assert.equal(lates.length, 1);
  assert.match(lates[0].text, /רותי/u);
  assert.equal(fetchStub.sent.filter((m) => m.text.includes('דנה')).length, 0);
  assert.equal(orderById(repo, 'b').meyLateNudgeAt, undefined);
  assert.equal(fetchStub.sent.filter(isCheckin).length, 1);
});

test('an untimed order rides in the digest and is never nudged; pickups stay out entirely', async (t) => {
  const fetchStub = stubFetch();
  t.after(() => fetchStub.restore());

  const repo = fakeRepository(stateWith([
    order({ id: 'a', name: 'רותי', time: '12:00' }),
    order({ id: 'b', name: 'נעמי', time: '' }),
    order({ id: 'c', name: 'איסוף', pickup: true }),
    order({ id: 'd', name: 'דנה', status: 'נמסרה' }),
  ]));
  const clock = { at: dubaiClock(TODAY, 8, 30) };
  const scheduler = schedulerAt(repo, clock);

  await scheduler.tick();
  const [morning] = fetchStub.sent.filter(isDigest);
  assert.match(morning.text, /נעמי/u);
  assert.match(morning.text, /ללא שעה/u);
  assert.equal(morning.text.includes('איסוף'), false);
  // Deliberate: the digest is the whole day, so an already-delivered stop still
  // shows — the gate above it, not the content, is what looks at what is left.
  assert.match(morning.text, /דנה/u);

  clock.at = dubaiClock(TODAY, 19, 20);
  await scheduler.tick();
  for (const message of fetchStub.sent.filter((m) => !isDigest(m))) {
    assert.equal(message.text.includes('נעמי'), false);
    assert.equal(message.text.includes('איסוף'), false);
    assert.equal(message.text.includes('דנה'), false);
  }
  assert.equal(orderById(repo, 'b').meyCheckinAskedAt, undefined);
  assert.equal(orderById(repo, 'b').meyLateNudgeAt, undefined);
  assert.equal(orderById(repo, 'c').meyLeadNudgeAt, undefined);
  assert.equal(orderById(repo, 'd').meyLateNudgeAt, undefined);
});

test('the day boundary follows Dubai, not UTC', async (t) => {
  const fetchStub = stubFetch();
  t.after(() => fetchStub.restore());

  // UTC evening on the 14th is already past midnight on the 15th in Dubai.
  const utcEvening = new Date('2026-08-14T20:45:00Z');
  assert.equal(dubaiDateString(utcEvening), '2026-08-15');
  assert.equal(dubaiMinutesOfDay(utcEvening), 45);

  const repo = fakeRepository(stateWith([
    order({ id: 'yesterday', name: 'רותי', date: '2026-08-14', time: '00:15' }),
    order({ id: 'tomorrow', name: 'נעמי', date: '2026-08-15', time: '00:15' }),
  ]));
  const clock = { at: utcEvening };
  const scheduler = schedulerAt(repo, clock);

  await scheduler.tick();
  const lates = fetchStub.sent.filter(isLate);
  assert.equal(lates.length, 1);
  assert.match(lates[0].text, /נעמי/u);
  assert.equal(orderById(repo, 'yesterday').meyLateNudgeAt, undefined);

  // Same Dubai day, now at digest time (04:30 UTC on the 15th).
  clock.at = new Date('2026-08-15T04:30:00Z');
  await scheduler.tick();
  const [morning] = fetchStub.sent.filter(isDigest);
  assert.equal(repo._current().settings.meyDigestSentFor, '2026-08-15');
  assert.match(morning.text, /15\/08/u);
  assert.equal(morning.text.includes('רותי'), false);
});

test('tick never throws when the repository is down', async (t) => {
  const fetchStub = stubFetch();
  t.after(() => fetchStub.restore());

  const errors = [];
  const scheduler = createDeliveryScheduler({
    repository: { async loadState() { throw new Error('postgres is having a day'); } },
    botToken: 'token',
    chatId: 77,
    logger: { error: (...args) => errors.push(args) },
    now: () => dubaiClock(TODAY, 8, 30),
  });

  await scheduler.tick();
  assert.equal(errors.length, 1);
  assert.equal(fetchStub.sent.length, 0);
});

test('start fires once immediately, keeps a unref-ed interval, and stop clears it', async (t) => {
  const fetchStub = stubFetch();
  t.after(() => fetchStub.restore());

  const repo = fakeRepository(stateWith([order({ id: 'a', time: '12:00' })]));
  const scheduler = schedulerAt(repo, { at: dubaiClock(TODAY, 8, 30) });

  scheduler.start();
  await new Promise((resolve) => setImmediate(resolve));
  scheduler.stop();

  assert.equal(fetchStub.sent.filter(isDigest).length, 1);
});

// --- plata pickup digest -------------------------------------------------------
// TODAY (2026-08-14) is a Friday, so 08-15 is the Saturday the plates come back.
const SATURDAY = '2026-08-15';

const isPlataDigest = (message) => message.text.startsWith('פלטות לאיסוף:');

function plataOrder(overrides) {
  return {
    id: 'p1',
    date: TODAY,
    name: 'רותי',
    hotelName: 'Atlantis',
    status: 'נמסרה',
    plataCount: 1,
    plataDeposit: '50.00',
    plataStatus: 'withCustomer',
    ...overrides,
  };
}

test('the plata digest goes out once on Saturday evening and never twice', async (t) => {
  const fetchStub = stubFetch();
  t.after(() => fetchStub.restore());

  const repo = fakeRepository(stateWith([
    plataOrder({ id: 'p1' }),
    plataOrder({ id: 'p2', name: 'קטי', hotelName: 'Hilton', plataStatus: 'awaitingPickup', plataPickupNote: 'בקבלה' }),
  ]));
  const clock = { at: dubaiClock(SATURDAY, 20, 30) };
  const scheduler = schedulerAt(repo, clock);

  for (let i = 0; i < 3; i += 1) await scheduler.tick();

  const digests = fetchStub.sent.filter(isPlataDigest);
  assert.equal(digests.length, 1);
  assert.equal(repo._current().settings.meyPlataDigestSentFor, SATURDAY);
  assert.match(digests[0].text, /רותי/u);
  assert.match(digests[0].text, /קטי · Hilton · פלטה אחת · בקבלה/u);

  // Process died mid-evening: a fresh scheduler over the same state stays quiet.
  await schedulerAt(repo, clock).tick();
  assert.equal(fetchStub.sent.filter(isPlataDigest).length, 1);
});

test('the plata digest waits for 20:00 Dubai and for Saturday', async (t) => {
  const fetchStub = stubFetch();
  t.after(() => fetchStub.restore());

  const tooEarly = fakeRepository(stateWith([plataOrder({})]));
  await schedulerAt(tooEarly, { at: dubaiClock(SATURDAY, 19, 59) }).tick();
  assert.equal(fetchStub.sent.filter(isPlataDigest).length, 0);
  assert.equal(tooEarly._current().settings.meyPlataDigestSentFor, undefined);

  // Friday evening — same hour, wrong day. The plates are still in use.
  const friday = fakeRepository(stateWith([plataOrder({})]));
  await schedulerAt(friday, { at: dubaiClock(TODAY, 20, 30) }).tick();
  assert.equal(fetchStub.sent.filter(isPlataDigest).length, 0);

  const sunday = fakeRepository(stateWith([plataOrder({})]));
  await schedulerAt(sunday, { at: dubaiClock('2026-08-16', 20, 30) }).tick();
  assert.equal(fetchStub.sent.filter(isPlataDigest).length, 0);
});

test('the plata digest only counts plates that are still out', async (t) => {
  const fetchStub = stubFetch();
  t.after(() => fetchStub.restore());

  const closed = fakeRepository(stateWith([
    plataOrder({ id: 'p1', plataStatus: 'collected' }),
    plataOrder({ id: 'p2', plataStatus: 'depositReturned' }),
    plataOrder({ id: 'p3', plataCount: 0, plataStatus: undefined }),
    { id: 'p4', date: TODAY, name: 'שירה', hotelName: 'Rixos', status: 'נמסרה' },
  ]));
  await schedulerAt(closed, { at: dubaiClock(SATURDAY, 20, 30) }).tick();
  assert.equal(fetchStub.sent.filter(isPlataDigest).length, 0);
  assert.equal(closed._current().settings.meyPlataDigestSentFor, undefined, 'nothing to say claims nothing');

  // A plate from an earlier week that nobody collected still rides in the list.
  const stale = fakeRepository(stateWith([plataOrder({ id: 'old', date: '2026-08-07', name: 'מיכל' })]));
  await schedulerAt(stale, { at: dubaiClock(SATURDAY, 20, 30) }).tick();
  const digests = fetchStub.sent.filter(isPlataDigest);
  assert.equal(digests.length, 1);
  assert.match(digests[0].text, /מיכל/u);
});
