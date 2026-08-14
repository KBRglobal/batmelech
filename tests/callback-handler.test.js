'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createCallbackHandler, UNKNOWN_ORDER_TEXT, CANCELLED_TEXT } = require('../server/telegram/callback-handler');
const { dubaiDateString } = require('../server/telegram/delivery-day');

const silentLogger = { error() {} };
const TODAY = dubaiDateString();

function fakeRepository(initialState) {
  let state = initialState;
  let revision = 1;
  return {
    async loadState() { return { data: state, revision, hash: 'h' }; },
    async saveState({ localState }) {
      state = localState;
      revision += 1;
      return { ok: true };
    },
    _current: () => state,
    _order: (id) => state.orders.find((order) => String(order.id) === String(id)),
  };
}

// Records every Telegram endpoint in call order — the ack must always be first.
function stubTelegram() {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, options) => {
    const endpoint = url.slice(url.lastIndexOf('/') + 1);
    calls.push({ endpoint, body: JSON.parse(options.body) });
    return { ok: true, async json() { return { ok: true, result: { message_id: calls.length } }; } };
  };
  return {
    calls,
    endpoints: () => calls.map((call) => call.endpoint),
    messages: () => calls.filter((call) => call.endpoint === 'sendMessage').map((call) => call.body),
    restore() { global.fetch = original; },
  };
}

function order(id, extra = {}) {
  return {
    id,
    name: `לקוח ${id}`,
    date: TODAY,
    status: 'מוכנה',
    hotelName: 'Atlantis',
    time: '13:00',
    meyToken: `tok${id}`,
    ...extra,
  };
}

function setup(orders, { settings = {}, agent = null } = {}) {
  const repository = fakeRepository({ orders, settings });
  const telegram = stubTelegram();
  const handler = createCallbackHandler({
    repository,
    botToken: 'token',
    chatId: -100,
    agent,
    logger: silentLogger,
  });
  return { repository, telegram, handler };
}

function tap(data, extra = {}) {
  return { id: 'cbq-1', data, from: { first_name: 'Felix' }, message: { chat: { id: -100 } }, ...extra };
}

test('the button is acknowledged before any state work happens', async (t) => {
  const kit = setup([order('a')]);
  t.after(() => kit.telegram.restore());

  await kit.handler.handle(tap('d|otw|toka'));

  assert.equal(kit.telegram.endpoints()[0], 'answerCallbackQuery');
  assert.deepEqual(kit.telegram.calls[0].body, { callback_query_id: 'cbq-1' });
  assert.equal(kit.telegram.endpoints()[1], 'sendMessage');
});

test('malformed callback data is acknowledged and then dropped', async (t) => {
  const kit = setup([order('a')]);
  t.after(() => kit.telegram.restore());

  for (const data of ['', 'garbage', 'd|otw', 'x|otw|toka', 'd||toka', 'd|otw|', undefined, 42]) {
    await kit.handler.handle(tap(data));
  }

  assert.deepEqual(new Set(kit.telegram.endpoints()), new Set(['answerCallbackQuery']));
  assert.equal(kit.repository._order('a').courierCheckinState, undefined);
});

test('otw and ontime record the check-in state with a short confirmation', async (t) => {
  const kit = setup([order('a', { name: 'כהן' }), order('b', { name: 'לוי' })]);
  t.after(() => kit.telegram.restore());

  await kit.handler.handle(tap('d|otw|toka'));
  assert.equal(kit.repository._order('a').courierCheckinState, 'onTheWay');
  assert.match(kit.telegram.messages()[0].text, /בדרך — כהן/u);

  await kit.handler.handle(tap('d|ontime|tokb'));
  assert.equal(kit.repository._order('b').courierCheckinState, 'onTime');
  assert.match(kit.telegram.messages()[1].text, /בזמן — לוי/u);
});

test('late records a delay and answers with the advice message, not a bare confirmation', async (t) => {
  const kit = setup([order('a', { name: 'כהן', time: '13:00' })]);
  t.after(() => kit.telegram.restore());

  await kit.handler.handle(tap('d|late|toka'));

  assert.equal(kit.repository._order('a').courierCheckinState, 'delayed');
  const messages = kit.telegram.messages();
  assert.equal(messages.length, 1, 'the advice is the confirmation, not a second message');
  assert.match(messages[0].text, /רשמתי שאתה מתעכב/u);
  assert.match(messages[0].text, /13:00/u);
  assert.deepEqual(messages[0].reply_markup.inline_keyboard[0][0].callback_data, 'd|draft|toka');
});

test('proof attaches the parked photo, clears it, and confirms with the next stop', async (t) => {
  const kit = setup(
    [order('a', { name: 'כהן', time: '12:00' }), order('b', { name: 'לוי', time: '15:00' })],
    { settings: { meyPendingProof: { url: 'https://proof.batmelech.ae/proof/x.jpg', at: 1234, by: 'Felix' } } },
  );
  t.after(() => kit.telegram.restore());

  await kit.handler.handle(tap('d|proof|toka'));

  const delivered = kit.repository._order('a');
  assert.equal(delivered.status, 'נמסרה');
  assert.equal(delivered.deliveryProofUrl, 'https://proof.batmelech.ae/proof/x.jpg');
  assert.equal(delivered.deliveryProofAt, 1234);
  assert.equal(delivered.deliveryProofBy, 'Felix');
  assert.equal(kit.repository._current().settings.meyPendingProof, null);

  const message = kit.telegram.messages()[0];
  assert.match(message.text, /צילום המסירה של כהן/u);
  assert.match(message.text, /היעד הבא: לוי/u);
  assert.equal(message.reply_markup.inline_keyboard[0][0].callback_data, 'd|undo|toka');
});

// The "נמסר עכשיו" button on the late escalation has no photo behind it — Felix
// is confirming the delivery itself.
test('proof with nothing parked simply marks the order delivered', async (t) => {
  const kit = setup([order('a', { name: 'כהן' })]);
  t.after(() => kit.telegram.restore());

  await kit.handler.handle(tap('d|proof|toka'));

  assert.equal(kit.repository._order('a').status, 'נמסרה');
  assert.equal(kit.repository._order('a').deliveryProofUrl, undefined);
  assert.match(kit.telegram.messages()[0].text, /כהן נמסרה/u);
});

test('undo walks a delivered order back and names the customer', async (t) => {
  const kit = setup([order('a', {
    name: 'כהן',
    status: 'נמסרה',
    statusBeforeProof: 'במשלוח',
    deliveryProofUrl: 'https://proof.batmelech.ae/proof/x.jpg',
    deliveryProofAt: 1,
    deliveredAt: 2,
  })]);
  t.after(() => kit.telegram.restore());

  await kit.handler.handle(tap('d|undo|toka'));

  const reverted = kit.repository._order('a');
  assert.equal(reverted.status, 'במשלוח');
  assert.equal(reverted.deliveryProofUrl, undefined);
  assert.equal(reverted.deliveredAt, undefined);
  assert.match(kit.telegram.messages()[0].text, /כהן שוב לא מסומן כנמסר/u);
});

test('draft asks מיי for text for Felix to copy and forwards it to the group', async (t) => {
  const asked = [];
  const agent = { async reply(text) { asked.push(text); return '  שלום, המשלוח בדרך ויגיע בקרוב.  '; } };
  const kit = setup([order('a', { name: 'כהן' })], { agent });
  t.after(() => kit.telegram.restore());

  await kit.handler.handle(tap('d|draft|toka'));

  assert.equal(asked.length, 1);
  assert.match(asked[0], /כהן/u);
  assert.match(asked[0], /אל תשלחי כלום בעצמך/u);
  assert.equal(kit.telegram.messages()[0].text, 'שלום, המשלוח בדרך ויגיע בקרוב.');
});

test('cancel clears the parked photo without needing to identify an order', async (t) => {
  const kit = setup([order('a')], { settings: { meyPendingProof: { url: 'https://proof.batmelech.ae/x.jpg', at: 1 } } });
  t.after(() => kit.telegram.restore());

  await kit.handler.handle(tap('d|cancel|-'));

  assert.equal(kit.repository._current().settings.meyPendingProof, null);
  assert.deepEqual(kit.telegram.messages().map((m) => m.text), [CANCELLED_TEXT]);
});

test('a token matching no order, or more than one, says so plainly', async (t) => {
  const kit = setup([order('a', { meyToken: 'dup' }), order('b', { meyToken: 'dup' })]);
  t.after(() => kit.telegram.restore());

  await kit.handler.handle(tap('d|otw|nosuchtoken'));
  await kit.handler.handle(tap('d|otw|dup'));

  assert.deepEqual(kit.telegram.messages().map((m) => m.text), [UNKNOWN_ORDER_TEXT, UNKNOWN_ORDER_TEXT]);
  assert.equal(kit.repository._order('a').courierCheckinState, undefined);
});

test("yesterday's order is out of scope even with a valid token", async (t) => {
  const kit = setup([order('a', { date: '2020-01-01' })]);
  t.after(() => kit.telegram.restore());

  await kit.handler.handle(tap('d|otw|toka'));

  assert.deepEqual(kit.telegram.messages().map((m) => m.text), [UNKNOWN_ORDER_TEXT]);
});

test('an unknown action is acknowledged and ignored, including inherited property names', async (t) => {
  const kit = setup([order('a')]);
  t.after(() => kit.telegram.restore());

  await kit.handler.handle(tap('d|toString|toka'));
  await kit.handler.handle(tap('d|explode|toka'));

  assert.deepEqual(kit.telegram.messages(), []);
  assert.equal(kit.repository._order('a').courierCheckinState, undefined);
});
