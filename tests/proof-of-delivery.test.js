'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createProofHandler, SAVE_FAILED_TEXT, NO_CANDIDATES_TEXT } = require('../server/telegram/proof-of-delivery');
const { dubaiDateString } = require('../server/telegram/delivery-day');

const silentLogger = { error() {} };
const NOW = new Date('2026-08-14T10:00:00.000Z');
const TODAY = dubaiDateString(NOW);
const MINUTE = 60 * 1000;

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
    _order: (id) => state.orders.find((order) => String(order.id) === String(id)),
  };
}

function fakeStorage({ failing = false } = {}) {
  const calls = [];
  return {
    calls,
    enabled: !failing,
    async putProofPhoto(args) {
      calls.push(args);
      return failing ? null : { url: `https://proof.batmelech.ae/proof/${TODAY}/${args.orderId}-1-abc.jpg`, key: 'k' };
    },
  };
}

// One stub for the three Telegram endpoints this flow touches, so the tests
// exercise the real telegram-files + send-message code paths.
function stubTelegram() {
  const sent = [];
  const original = global.fetch;
  global.fetch = async (url, options) => {
    if (url.includes('/getFile')) {
      return { ok: true, async json() { return { ok: true, result: { file_path: 'photos/p.jpg' } }; } };
    }
    if (url.includes('/file/bot')) {
      const bytes = Buffer.from('jpeg-bytes');
      return {
        ok: true,
        headers: { get: () => String(bytes.byteLength) },
        async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
      };
    }
    if (url.includes('/sendMessage')) {
      sent.push(JSON.parse(options.body));
      return { ok: true, async json() { return { ok: true, result: { message_id: 100 + sent.length } }; } };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  return {
    sent,
    restore() { global.fetch = original; },
  };
}

function order(id, extra = {}) {
  return { id, name: `לקוח ${id}`, date: TODAY, status: 'מוכנה', hotelName: 'Atlantis', time: '13:00', ...extra };
}

function photo(extra = {}) {
  return { photo: [{ file_id: 'small' }, { file_id: 'best' }], from: { first_name: 'Felix' }, ...extra };
}

function setup(orders, { settings = {}, storage = fakeStorage() } = {}) {
  const repository = fakeRepository({ orders, settings });
  const telegram = stubTelegram();
  const handler = createProofHandler({
    repository,
    storage,
    botToken: 'token',
    chatId: -100,
    logger: silentLogger,
    now: () => NOW,
  });
  return { repository, storage, telegram, handler };
}

function buttonData(message) {
  return (message.reply_markup.inline_keyboard || []).flat().map((b) => b.callback_data);
}

test('rule 1: a photo replying to a check-in prompt attaches to that order', async (t) => {
  const kit = setup([
    order('a', { meyPromptMessageId: 555 }),
    order('b', { status: 'במשלוח' }),
  ]);
  t.after(() => kit.telegram.restore());

  await kit.handler.handlePhoto(photo({ reply_to_message: { message_id: 555 } }));

  // Order b is the one the weaker "in transit" rule would have picked, which is
  // exactly why the reply must win.
  assert.equal(kit.repository._order('a').status, 'נמסרה');
  assert.equal(kit.repository._order('b').status, 'במשלוח');
  assert.match(kit.telegram.sent[0].text, /נשמר/u);
  assert.equal(kit.storage.calls[0].orderId, 'a');
});

test('rule 2: a caption naming one customer attaches to that order', async (t) => {
  const kit = setup([
    order('a', { name: 'משפחת כהן' }),
    order('b', { name: 'משפחת לוי' }),
  ]);
  t.after(() => kit.telegram.restore());

  await kit.handler.handlePhoto(photo({ caption: '  כהן ' }));

  assert.equal(kit.repository._order('a').status, 'נמסרה');
  assert.equal(kit.repository._order('b').status, 'מוכנה');
});

test('rule 2: a caption matching two customers is not a match', async (t) => {
  const kit = setup([
    order('a', { name: 'משפחת כהן' }),
    order('b', { name: 'משפחת כהן-לוי' }),
  ]);
  t.after(() => kit.telegram.restore());

  await kit.handler.handlePhoto(photo({ caption: 'כהן' }));

  assert.equal(kit.repository._order('a').status, 'מוכנה');
  assert.equal(kit.repository._order('b').status, 'מוכנה');
  assert.equal(kit.telegram.sent[0].text, 'לאיזה משלוח לשייך את התמונה?');
});

test('rule 3: the single order marked in transit wins', async (t) => {
  const kit = setup([order('a'), order('b', { status: 'במשלוח' }), order('c')]);
  t.after(() => kit.telegram.restore());

  await kit.handler.handlePhoto(photo());

  assert.equal(kit.repository._order('b').status, 'נמסרה');
  assert.equal(kit.repository._order('a').status, 'מוכנה');
});

test('rule 4: the single order awaiting a reply in the last 45 minutes wins', async (t) => {
  const kit = setup([
    order('a'),
    order('b', { meyAwaitingReplySince: NOW.getTime() - 10 * MINUTE }),
  ]);
  t.after(() => kit.telegram.restore());

  await kit.handler.handlePhoto(photo());

  assert.equal(kit.repository._order('b').status, 'נמסרה');
});

test('rule 4: an ask older than 45 minutes is too stale to identify the order', async (t) => {
  const kit = setup([
    order('a'),
    order('b', { meyAwaitingReplySince: NOW.getTime() - 90 * MINUTE }),
  ]);
  t.after(() => kit.telegram.restore());

  await kit.handler.handlePhoto(photo());

  assert.equal(kit.repository._order('b').status, 'מוכנה');
  assert.equal(kit.telegram.sent[0].text, 'לאיזה משלוח לשייך את התמונה?');
});

test('rule 5: with one delivery left today no other signal is needed', async (t) => {
  const kit = setup([
    order('a'),
    order('b', { status: 'נמסרה' }),
    order('c', { status: 'בוטלה' }),
    order('d', { date: '2026-08-15' }),
    order('e', { pickup: true }),
  ]);
  t.after(() => kit.telegram.restore());

  await kit.handler.handlePhoto(photo());

  assert.equal(kit.repository._order('a').status, 'נמסרה');
  assert.equal(kit.repository._order('a').deliveryProofBy, 'Felix');
  assert.match(kit.repository._order('a').deliveryProofUrl, /^https:\/\/proof\.batmelech\.ae\//u);
});

test('rule 6: an unresolvable photo is parked as pending and Felix is asked to pick', async (t) => {
  const kit = setup([order('a', { name: 'כהן' }), order('b', { name: 'לוי' })]);
  t.after(() => kit.telegram.restore());

  await kit.handler.handlePhoto(photo());

  assert.equal(kit.repository._order('a').status, 'מוכנה');
  assert.equal(kit.repository._order('b').status, 'מוכנה');

  const pending = kit.repository._current().settings.meyPendingProof;
  assert.match(pending.url, /^https:\/\/proof\.batmelech\.ae\//u);
  assert.equal(pending.at, NOW.getTime());
  assert.equal(pending.by, 'Felix');

  const ask = kit.telegram.sent[0];
  assert.equal(ask.text, 'לאיזה משלוח לשייך את התמונה?');
  const tokenA = kit.repository._order('a').meyToken;
  const tokenB = kit.repository._order('b').meyToken;
  assert.deepEqual(buttonData(ask), [`d|proof|${tokenA}`, `d|proof|${tokenB}`, 'd|cancel|-']);
});

// The photo is uploaded before we know whose it is, so an unidentified one still
// has to land in the bucket — under a "pending" id rather than an order id.
test('an unresolvable photo is still uploaded, under a pending key', async (t) => {
  const kit = setup([order('a'), order('b')]);
  t.after(() => kit.telegram.restore());

  await kit.handler.handlePhoto(photo());

  assert.equal(kit.storage.calls.length, 1);
  assert.equal(kit.storage.calls[0].orderId, 'pending');
  assert.equal(kit.storage.calls[0].dateString, TODAY);
});

test('a failed upload changes nothing and tells Felix to send it again', async (t) => {
  const kit = setup([order('a')], { storage: fakeStorage({ failing: true }) });
  t.after(() => kit.telegram.restore());

  await kit.handler.handlePhoto(photo());

  assert.equal(kit.repository._order('a').status, 'מוכנה');
  assert.equal(kit.repository._order('a').deliveryProofUrl, undefined);
  assert.equal(kit.repository._current().settings.meyPendingProof, undefined);
  assert.deepEqual(kit.telegram.sent.map((m) => m.text), [SAVE_FAILED_TEXT]);
});

test('a photo that cannot be downloaded is never uploaded and never touches state', async (t) => {
  const kit = setup([order('a')]);
  t.after(() => kit.telegram.restore());
  const original = global.fetch;
  global.fetch = async (url, options) => {
    if (url.includes('/getFile')) return { ok: false, status: 400, async json() { return {}; }, async text() { return ''; } };
    return original(url, options);
  };

  await kit.handler.handlePhoto(photo());

  assert.equal(kit.storage.calls.length, 0);
  assert.equal(kit.repository._order('a').status, 'מוכנה');
  assert.deepEqual(kit.telegram.sent.map((m) => m.text), [SAVE_FAILED_TEXT]);
});

test('the confirmation names the next stop and offers an undo bound to the order', async (t) => {
  const kit = setup([
    order('a', { name: 'כהן', status: 'במשלוח', time: '12:00' }),
    order('b', { name: 'לוי', time: '15:00', hotelName: 'Burj Al Arab' }),
  ]);
  t.after(() => kit.telegram.restore());

  await kit.handler.handlePhoto(photo());

  const confirm = kit.telegram.sent[0];
  assert.match(confirm.text, /צילום המסירה של כהן/u);
  assert.match(confirm.text, /היעד הבא: לוי/u);
  assert.match(confirm.text, /Burj Al Arab/u);
  assert.deepEqual(buttonData(confirm), [`d|undo|${kit.repository._order('a').meyToken}`]);
});

// delivery-messages.js refuses to build an undo button without a meyToken, and
// a photo can easily arrive before any scheduled nudge has minted one.
test('a token is minted for an order that has none, and an existing one is kept', async (t) => {
  const kit = setup([order('a')]);
  t.after(() => kit.telegram.restore());

  assert.equal(kit.repository._order('a').meyToken, undefined);
  await kit.handler.handlePhoto(photo());
  assert.match(kit.repository._order('a').meyToken, /^[a-f0-9]{8}$/u);

  const kept = setup([order('z', { meyToken: 'keepme' })]);
  t.after(() => kept.telegram.restore());
  await kept.handler.handlePhoto(photo());
  assert.equal(kept.repository._order('z').meyToken, 'keepme');
  assert.deepEqual(buttonData(kept.telegram.sent[0]), ['d|undo|keepme']);
});

test('a photo on a day with no open deliveries says so instead of parking a pending proof', async (t) => {
  const kit = setup([order('a', { status: 'נמסרה' })]);
  t.after(() => kit.telegram.restore());

  await kit.handler.handlePhoto(photo());

  assert.equal(kit.repository._current().settings.meyPendingProof, undefined);
  assert.deepEqual(kit.telegram.sent.map((m) => m.text), [NO_CANDIDATES_TEXT]);
});

test('a message with no photo is ignored entirely', async (t) => {
  const kit = setup([order('a')]);
  t.after(() => kit.telegram.restore());

  await kit.handler.handlePhoto({ text: 'שלום' });
  await kit.handler.handlePhoto({ photo: [] });

  assert.equal(kit.storage.calls.length, 0);
  assert.equal(kit.telegram.sent.length, 0);
});

test('the largest photo size offered by Telegram is the one downloaded', async (t) => {
  const kit = setup([order('a')]);
  const seen = [];
  t.after(() => kit.telegram.restore());
  const stubbed = global.fetch;
  global.fetch = async (url, options) => {
    if (url.includes('/getFile')) seen.push(new URL(url).searchParams.get('file_id'));
    return stubbed(url, options);
  };

  await kit.handler.handlePhoto(photo());
  assert.deepEqual(seen, ['best']);
});
