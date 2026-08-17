'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const http = require('node:http');

const { chatFileReplyText, createTelegramWebhookRouter } = require('../server/telegram/webhook-route');

const CHAT_ID = '-100200300';
const SECRET = 'test-secret-path';

function agentStub() {
  return {
    async reply() {
      return 'תשובת סוכן';
    },
  };
}

async function postUpdate(router, update) {
  const app = express();
  app.use('/api/telegram/webhook', router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/telegram/webhook/${SECRET}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    });
    // Handling happens after the ack; give it a beat.
    await new Promise((resolve) => setTimeout(resolve, 30));
    return response.status;
  } finally {
    server.close();
  }
}

function documentUpdate(document) {
  return {
    message: {
      chat: { id: Number(CHAT_ID) },
      from: { first_name: 'Lin' },
      document,
    },
  };
}

test('an exported-chat .txt document runs the intake pipeline and replies deterministically', async () => {
  const sent = [];
  const originalFetch = global.fetch;
  const intakeCalls = [];

  const router = createTelegramWebhookRouter({
    webhookSecret: SECRET,
    botToken: 'bot-token',
    ordersChatId: CHAT_ID,
    agent: agentStub(),
    logger: { error() {} },
    telegramFiles: {
      async getFilePath() {
        return 'documents/chat.txt';
      },
      async downloadFile() {
        return Buffer.from('[18/08/2026, 14:32:11] David: 2 challahs please', 'utf8');
      },
    },
    whatsappIntake: {
      async intake(text) {
        intakeCalls.push(text);
        return {
          ok: true,
          orderId: 'mey-1-abcd',
          orderUrl: 'https://www.batmelech.ae/admin/orders/mey-1-abcd/edit',
          review: {
            draft: {
              customerName: 'David',
              items: [{ catalogItemName: 'חלות', quantity: 2 }],
            },
            unknownItems: [],
            missingFields: [{ field: 'fulfillment_method' }],
          },
          replyDraft: 'Hi David! Two challahs noted.',
        };
      },
    },
  });

  const wrappedFetch = async (url, options) => {
    const target = String(url);
    if (target.includes('api.telegram.org')) {
      sent.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return originalFetch(url, options);
  };
  global.fetch = wrappedFetch;
  try {
    const status = await postUpdate(
      router,
      documentUpdate({ file_id: 'f1', file_name: 'WhatsApp Chat with David.txt', mime_type: 'text/plain', file_size: 512 })
    );
    assert.equal(status, 200);
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(intakeCalls.length, 1);
  assert.match(intakeCalls[0], /2 challahs/u);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /David/u);
  assert.match(sent[0].text, /חלות x2/u);
  assert.match(sent[0].text, /mey-1-abcd/u);
  assert.match(sent[0].text, /Two challahs noted/u);
});

test('non-text documents and oversized files are ignored or refused safely', async () => {
  const sent = [];
  const originalFetch = global.fetch;
  let intakeCalled = false;

  const router = createTelegramWebhookRouter({
    webhookSecret: SECRET,
    botToken: 'bot-token',
    ordersChatId: CHAT_ID,
    agent: agentStub(),
    logger: { error() {} },
    telegramFiles: {
      async getFilePath() {
        return 'documents/big.txt';
      },
      async downloadFile() {
        return Buffer.alloc(400_000);
      },
    },
    whatsappIntake: {
      async intake() {
        intakeCalled = true;
        return { ok: false, error: 'empty' };
      },
    },
  });

  global.fetch = async (url, options) => {
    if (String(url).includes('api.telegram.org')) {
      sent.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return originalFetch(url, options);
  };
  try {
    // A PDF is not a chat export — silently ignored, no reply.
    await postUpdate(router, documentUpdate({ file_id: 'f2', file_name: 'menu.pdf', mime_type: 'application/pdf' }));
    assert.equal(sent.length, 0);
    assert.equal(intakeCalled, false);

    // Claimed-small .txt that downloads oversized -> polite failure, no intake.
    await postUpdate(router, documentUpdate({ file_id: 'f3', file_name: 'chat.txt', mime_type: 'text/plain', file_size: 100 }));
    assert.equal(intakeCalled, false);
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /לא הצלחתי לקרוא/u);
  } finally {
    global.fetch = originalFetch;
  }
});

test('chatFileReplyText maps intake errors to safe Hebrew and never leaks internals', () => {
  assert.match(chatFileReplyText({ ok: false, error: 'frozen' }), /הקפאה/u);
  assert.match(chatFileReplyText({ ok: false, error: 'menu_unavailable' }), /התפריט/u);
  assert.match(chatFileReplyText({ ok: false, error: 'weird_unknown' }), /לא הצלחתי לקרוא/u);
});
