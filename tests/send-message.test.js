'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { sendTelegramMessage, answerCallbackQuery } = require('../server/telegram/send-message');

const silentLogger = { error() {} };

// Records every fetch and answers with a canned Telegram payload.
function stubFetch(responder) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return responder(calls.length);
  };
  return {
    calls,
    restore() {
      global.fetch = original;
    },
  };
}

function okResponse(payload) {
  return { ok: true, async json() { return payload; }, async text() { return JSON.stringify(payload); } };
}

test('sendTelegramMessage passes reply_markup through as an object and returns the message id', async (t) => {
  const fetchStub = stubFetch(() => okResponse({ ok: true, result: { message_id: 9182 } }));
  t.after(() => fetchStub.restore());

  const replyMarkup = { inline_keyboard: [[{ text: 'בדרך', callback_data: 'checkin:onTheWay:a' }]] };
  const result = await sendTelegramMessage({
    botToken: 'token',
    chatId: 42,
    text: 'שלום',
    replyMarkup,
    logger: silentLogger,
  });

  assert.deepEqual(result, { ok: true, messageId: 9182 });
  assert.equal(fetchStub.calls.length, 1);
  assert.match(fetchStub.calls[0].url, /\/bottoken\/sendMessage$/);
  assert.deepEqual(fetchStub.calls[0].body, { chat_id: 42, text: 'שלום', reply_markup: replyMarkup });
});

test('sendTelegramMessage omits reply_markup when none is given', async (t) => {
  const fetchStub = stubFetch(() => okResponse({ ok: true, result: { message_id: 1 } }));
  t.after(() => fetchStub.restore());

  await sendTelegramMessage({ botToken: 'token', chatId: 42, text: 'שלום', logger: silentLogger });
  assert.equal('reply_markup' in fetchStub.calls[0].body, false);
});

test('sendTelegramMessage returns a null message id when the payload has no result', async (t) => {
  const fetchStub = stubFetch(() => okResponse({ ok: true }));
  t.after(() => fetchStub.restore());

  const result = await sendTelegramMessage({ botToken: 'token', chatId: 1, text: 'x', logger: silentLogger });
  assert.deepEqual(result, { ok: true, messageId: null });
});

test('sendTelegramMessage never throws on a failing fetch', async (t) => {
  const fetchStub = stubFetch(() => { throw new Error('network down'); });
  t.after(() => fetchStub.restore());

  const result = await sendTelegramMessage({ botToken: 'token', chatId: 1, text: 'x', logger: silentLogger });
  assert.deepEqual(result, { ok: false, messageId: null });
});

test('sendTelegramMessage reports a non-ok HTTP response and a missing token', async (t) => {
  const fetchStub = stubFetch(() => ({
    ok: false,
    status: 429,
    async text() { return 'Too Many Requests'; },
    async json() { return {}; },
  }));
  t.after(() => fetchStub.restore());

  const httpFailure = await sendTelegramMessage({ botToken: 'token', chatId: 1, text: 'x', logger: silentLogger });
  assert.deepEqual(httpFailure, { ok: false, messageId: null });

  const noToken = await sendTelegramMessage({ botToken: '  ', chatId: 1, text: 'x', logger: silentLogger });
  assert.deepEqual(noToken, { ok: false, messageId: null });
  assert.equal(fetchStub.calls.length, 1);
});

test('answerCallbackQuery posts the callback id and optional text', async (t) => {
  const fetchStub = stubFetch(() => okResponse({ ok: true, result: true }));
  t.after(() => fetchStub.restore());

  const result = await answerCallbackQuery({
    botToken: 'token',
    callbackQueryId: 'cbq-1',
    text: 'נרשם',
    logger: silentLogger,
  });

  assert.deepEqual(result, { ok: true });
  assert.match(fetchStub.calls[0].url, /\/bottoken\/answerCallbackQuery$/);
  assert.deepEqual(fetchStub.calls[0].body, { callback_query_id: 'cbq-1', text: 'נרשם' });

  await answerCallbackQuery({ botToken: 'token', callbackQueryId: 'cbq-2', logger: silentLogger });
  assert.deepEqual(fetchStub.calls[1].body, { callback_query_id: 'cbq-2' });
});

test('answerCallbackQuery never throws on a failing fetch', async (t) => {
  const fetchStub = stubFetch(() => { throw new Error('network down'); });
  t.after(() => fetchStub.restore());

  const result = await answerCallbackQuery({ botToken: 'token', callbackQueryId: 'cbq-1', logger: silentLogger });
  assert.deepEqual(result, { ok: false });
});
