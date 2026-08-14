'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');

const { createTelegramWebhookRouter, VOICE_FAILED_TEXT } = require('../server/telegram/webhook-route');

const silentLogger = { error() {} };
const SECRET = 'sekrit';
const CHAT_ID = -1001234;

// Only Telegram's own host is faked; the test's POST to its own express server
// still goes through the real fetch.
function stubTelegram() {
  const sent = [];
  const original = global.fetch;
  global.fetch = async (url, options) => {
    if (typeof url === 'string' && url.startsWith('https://api.telegram.org')) {
      sent.push({ endpoint: url.slice(url.lastIndexOf('/') + 1).split('?')[0], body: options ? JSON.parse(options.body) : null });
      return { ok: true, async json() { return { ok: true, result: { message_id: sent.length } }; } };
    }
    return original(url, options);
  };
  return {
    sent,
    texts: () => sent.filter((call) => call.endpoint === 'sendMessage').map((call) => call.body.text),
    restore() { global.fetch = original; },
  };
}

// The route acks before it works, so every assertion has to wait for the work.
async function settle(times = 12) {
  for (let i = 0; i < times; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

async function withRoute(options, run) {
  const app = express();
  app.use('/api/telegram/webhook', createTelegramWebhookRouter({
    webhookSecret: SECRET,
    botToken: 'token',
    ordersChatId: CHAT_ID,
    logger: silentLogger,
    ...options,
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await run(async (update) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/telegram/webhook/${SECRET}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
      await settle();
      return response;
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

function recordingAgent(reply = 'תשובה') {
  const seen = [];
  return { seen, async reply(text) { seen.push(text); return reply; } };
}

function fakeRepository(initialState = { orders: [], settings: {} }) {
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
  };
}

function textMessage(text, chatId = CHAT_ID) {
  return { message: { message_id: 1, chat: { id: chatId }, text } };
}

test('the constructor still rejects a missing secret, token, or agent', () => {
  const agent = recordingAgent();
  assert.throws(() => createTelegramWebhookRouter({ webhookSecret: ' ', botToken: 't', agent }), TypeError);
  assert.throws(() => createTelegramWebhookRouter({ webhookSecret: 's', botToken: '', agent }), TypeError);
  assert.throws(() => createTelegramWebhookRouter({ webhookSecret: 's', botToken: 't', agent: {} }), TypeError);
  assert.doesNotThrow(() => createTelegramWebhookRouter({ webhookSecret: 's', botToken: 't', agent }));
});

// THE regression test: everything else in this file is new behaviour, this is
// the behaviour that already worked and must keep working.
test('a text message still reaches מיי and her reply is sent back to the group', async (t) => {
  const telegram = stubTelegram();
  const agent = recordingAgent('היי לין');
  t.after(() => telegram.restore());

  await withRoute({ agent }, async (post) => {
    const response = await post(textMessage('כמה הזמנות יש היום?'));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  });

  assert.deepEqual(agent.seen, ['כמה הזמנות יש היום?']);
  assert.deepEqual(telegram.sent[0].body, { chat_id: CHAT_ID, text: 'היי לין' });
});

test('text still works with none of the optional collaborators wired', async (t) => {
  const telegram = stubTelegram();
  const agent = recordingAgent();
  t.after(() => telegram.restore());

  await withRoute({ agent }, async (post) => {
    await post({ message: { chat: { id: CHAT_ID }, photo: [{ file_id: 'x' }] } });
    await post({ message: { chat: { id: CHAT_ID }, voice: { file_id: 'v' } } });
    await post({ callback_query: { id: 'c', data: 'd|otw|t', message: { chat: { id: CHAT_ID } } } });
    await post({ message: { chat: { id: CHAT_ID }, location: { latitude: 25, longitude: 55 } } });
    await post(textMessage('עדיין עובד'));
  });

  assert.deepEqual(agent.seen, ['עדיין עובד']);
  assert.deepEqual(telegram.texts(), ['תשובה']);
});

test('an empty or whitespace-only text is dropped', async (t) => {
  const telegram = stubTelegram();
  const agent = recordingAgent();
  t.after(() => telegram.restore());

  await withRoute({ agent }, async (post) => {
    await post(textMessage('   '));
    await post({ message: { chat: { id: CHAT_ID } } });
    await post({});
  });

  assert.deepEqual(agent.seen, []);
  assert.deepEqual(telegram.sent, []);
});

test('every branch is dropped when the update comes from another chat', async (t) => {
  const telegram = stubTelegram();
  const agent = recordingAgent();
  const repository = fakeRepository();
  const proofHandler = { calls: 0, async handlePhoto() { this.calls += 1; } };
  const callbackHandler = { calls: 0, async handle() { this.calls += 1; } };
  const voiceTranscriber = { calls: 0, async transcribe() { this.calls += 1; return 'x'; } };
  const telegramFiles = { async getFilePath() { return 'voice/1.ogg'; }, async downloadFile() { return Buffer.from('a'); } };
  t.after(() => telegram.restore());

  const stranger = 999;
  await withRoute({ agent, repository, proofHandler, callbackHandler, voiceTranscriber, telegramFiles }, async (post) => {
    await post(textMessage('היי', stranger));
    await post({ message: { chat: { id: stranger }, photo: [{ file_id: 'x' }] } });
    await post({ message: { chat: { id: stranger }, voice: { file_id: 'v' } } });
    await post({ message: { chat: { id: stranger }, location: { latitude: 25, longitude: 55 } } });
    await post({ edited_message: { chat: { id: stranger }, location: { latitude: 25, longitude: 55 } } });
    await post({ callback_query: { id: 'c', data: 'd|otw|t', message: { chat: { id: stranger } } } });
    await post({ callback_query: { id: 'c', data: 'd|otw|t' } });
  });

  assert.deepEqual(agent.seen, []);
  assert.deepEqual(telegram.sent, []);
  assert.equal(proofHandler.calls, 0);
  assert.equal(callbackHandler.calls, 0);
  assert.equal(voiceTranscriber.calls, 0);
  assert.equal(repository._current().settings.meyCourierLocation, undefined);
});

test('a photo goes to the proof handler and never to מיי', async (t) => {
  const telegram = stubTelegram();
  const agent = recordingAgent();
  const seen = [];
  const proofHandler = { async handlePhoto(message) { seen.push(message); } };
  t.after(() => telegram.restore());

  await withRoute({ agent, proofHandler }, async (post) => {
    await post({ message: { chat: { id: CHAT_ID }, photo: [{ file_id: 'a' }], caption: 'כהן' } });
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].caption, 'כהן');
  assert.deepEqual(agent.seen, []);
  assert.deepEqual(telegram.sent, []);
});

test('a voice note is transcribed, answered, and echoed back with what was heard', async (t) => {
  const telegram = stubTelegram();
  const agent = recordingAgent('יש שבע הזמנות');
  const downloaded = [];
  const telegramFiles = {
    async getFilePath({ fileId }) { downloaded.push(fileId); return 'voice/file_3.oga'; },
    async downloadFile({ filePath }) { return Buffer.from(filePath); },
  };
  const voiceTranscriber = { async transcribe(buffer) { return `תמלול של ${buffer.toString()}`; } };
  t.after(() => telegram.restore());

  await withRoute({ agent, telegramFiles, voiceTranscriber }, async (post) => {
    await post({ message: { chat: { id: CHAT_ID }, voice: { file_id: 'voice-1' } } });
  });

  assert.deepEqual(downloaded, ['voice-1']);
  assert.deepEqual(agent.seen, ['תמלול של voice/file_3.oga']);
  assert.deepEqual(telegram.texts(), ['🎤 "תמלול של voice/file_3.oga"\n\nיש שבע הזמנות']);
});

test('a voice note that cannot be transcribed asks Felix to write instead', async (t) => {
  const telegram = stubTelegram();
  const agent = recordingAgent();
  const telegramFiles = {
    async getFilePath() { return 'voice/1.oga'; },
    async downloadFile() { return Buffer.from('a'); },
  };
  t.after(() => telegram.restore());

  await withRoute({ agent, telegramFiles, voiceTranscriber: { async transcribe() { return null; } } }, async (post) => {
    await post({ message: { chat: { id: CHAT_ID }, voice: { file_id: 'v' } } });
  });
  assert.deepEqual(telegram.texts(), [VOICE_FAILED_TEXT]);
  assert.deepEqual(agent.seen, []);

  const failedDownload = {
    async getFilePath() { return null; },
    async downloadFile() { throw new Error('never reached'); },
  };
  await withRoute({ agent, telegramFiles: failedDownload, voiceTranscriber: { async transcribe() { return 'x'; } } }, async (post) => {
    await post({ message: { chat: { id: CHAT_ID }, voice: { file_id: 'v' } } });
  });
  assert.deepEqual(telegram.texts(), [VOICE_FAILED_TEXT, VOICE_FAILED_TEXT]);
});

test('a button tap is dispatched to the callback handler', async (t) => {
  const telegram = stubTelegram();
  const agent = recordingAgent();
  const seen = [];
  const callbackHandler = { async handle(query) { seen.push(query); } };
  t.after(() => telegram.restore());

  await withRoute({ agent, callbackHandler }, async (post) => {
    await post({ callback_query: { id: 'cbq-9', data: 'd|proof|tok', message: { chat: { id: CHAT_ID } } } });
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].id, 'cbq-9');
  assert.equal(seen[0].data, 'd|proof|tok');
  assert.deepEqual(agent.seen, []);
});

test('an edited location updates the courier position but edited text stays ignored', async (t) => {
  const telegram = stubTelegram();
  const agent = recordingAgent();
  const repository = fakeRepository();
  t.after(() => telegram.restore());

  await withRoute({ agent, repository }, async (post) => {
    await post({ edited_message: { chat: { id: CHAT_ID }, location: { latitude: 25.11, longitude: 55.22 } } });
    await post({ edited_message: { chat: { id: CHAT_ID }, text: 'תבטלי את ההזמנה' } });
  });

  const position = repository._current().settings.meyCourierLocation;
  assert.equal(position.lat, 25.11);
  assert.equal(position.lon, 55.22);
  assert.ok(Number.isFinite(position.at));
  assert.deepEqual(agent.seen, []);
  assert.deepEqual(telegram.sent, []);
});

test('a one-shot location pin on a regular message also updates the courier position', async (t) => {
  const telegram = stubTelegram();
  const agent = recordingAgent();
  const repository = fakeRepository();
  t.after(() => telegram.restore());

  await withRoute({ agent, repository }, async (post) => {
    await post({ message: { chat: { id: CHAT_ID }, location: { latitude: 25.33, longitude: 55.44 } } });
  });

  assert.equal(repository._current().settings.meyCourierLocation.lat, 25.33);
  assert.deepEqual(agent.seen, []);
});

test('a wrong secret path is a 404, not a silent success', async (t) => {
  const telegram = stubTelegram();
  const agent = recordingAgent();
  t.after(() => telegram.restore());

  const app = express();
  app.use('/api/telegram/webhook', createTelegramWebhookRouter({
    webhookSecret: SECRET,
    botToken: 'token',
    ordersChatId: CHAT_ID,
    agent,
    logger: silentLogger,
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/telegram/webhook/wrong`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(textMessage('היי')),
  });
  await settle();

  assert.equal(response.status, 404);
  assert.deepEqual(agent.seen, []);
});

test('a collaborator that throws is logged and never crashes the request', async (t) => {
  const telegram = stubTelegram();
  const agent = recordingAgent();
  const logged = [];
  const proofHandler = { async handlePhoto() { throw new Error('r2 exploded'); } };
  t.after(() => telegram.restore());

  await withRoute({ agent, proofHandler, logger: { error: (...args) => logged.push(args) } }, async (post) => {
    const response = await post({ message: { chat: { id: CHAT_ID }, photo: [{ file_id: 'a' }] } });
    assert.equal(response.status, 200);
    const stillWorks = await post(textMessage('הכל בסדר?'));
    assert.equal(stillWorks.status, 200);
  });

  assert.equal(logged.length, 1);
  assert.match(String(logged[0][0]), /mey webhook handling failed/u);
  assert.deepEqual(agent.seen, ['הכל בסדר?']);
});
