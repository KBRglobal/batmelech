'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const http = require('node:http');

const {
  allowedNumberTokens,
  createOpenAIOrderReply,
  replyNumbersAreGrounded,
} = require('../server/ai/openai-order-reply');
const { createOrderReplyRouter } = require('../server/ai/order-reply-route');

function fakeOpenAIClient(outputs) {
  const calls = [];
  let index = 0;
  return {
    calls,
    client: {
      responses: {
        async create(request) {
          calls.push(request);
          const output = outputs[Math.min(index, outputs.length - 1)];
          index += 1;
          if (output instanceof Error) throw output;
          return { output_text: output };
        },
      },
    },
  };
}

async function postJson(router, path, body) {
  const app = express();
  app.use(path, router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return { status: response.status, data };
  } finally {
    server.close();
  }
}

const SUMMARY = {
  lines: [{ name: 'חלות', qty: 2, priceUsd: 10 }],
  totalUsd: 250,
  serviceDate: '2026-08-22',
  serviceTime: '15:00',
  deliveryLocation: 'Atlantis The Palm',
  fulfillment: 'delivery',
};

test('number grounding: any digits not present in the data are rejected', () => {
  const allowed = allowedNumberTokens({ conversation: 'שתי חלות ל-22.8', summary: SUMMARY, missing: [] });
  assert.equal(replyNumbersAreGrounded('2 challahs, total $250, Friday 22.8 at 15:00', allowed), true);
  assert.equal(replyNumbersAreGrounded('Total is $260', allowed), false);
  assert.equal(replyNumbersAreGrounded('no numbers at all', allowed), true);
});

test('drafter retries once on an ungrounded number and then fails closed', async () => {
  const good = 'Hi! 2 challahs ($10 each), total $250, Friday 2026-08-22 at 15:00.';
  const retry = fakeOpenAIClient(['Total will be $999', good]);
  const drafter = createOpenAIOrderReply({ client: retry.client, model: 'm', env: {} });
  const reply = await drafter({ conversation: 'two challahs', summary: SUMMARY, missing: [] });
  assert.equal(reply, good);
  assert.equal(retry.calls.length, 2);
  assert.match(retry.calls[1].input[0].content, /Rewrite it using ONLY numbers/u);

  const alwaysBad = fakeOpenAIClient(['$999 please', '$888 please']);
  const failing = createOpenAIOrderReply({ client: alwaysBad.client, model: 'm', env: {} });
  await assert.rejects(
    () => failing({ conversation: 'two challahs', summary: SUMMARY, missing: [] }),
    /invalid/iu
  );
});

test('route validates requests and passes the stored style note', async () => {
  let received = null;
  const router = createOrderReplyRouter({
    repository: {
      async loadState() {
        return { data: { settings: { waReplyStyle: 'חמה, בלי סלנג' } }, revision: 1, hash: 'h' };
      },
    },
    draftOrderReply: async (input) => {
      received = input;
      return 'טיוטה';
    },
  });

  const bad = await postJson(router, '/api/ai/order-reply', { nope: true });
  assert.equal(bad.status, 400);

  const ok = await postJson(router, '/api/ai/order-reply', {
    conversation: 'David: two challahs please',
    summary: SUMMARY,
    missing: ['משלוח או איסוף'],
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.data, { reply: 'טיוטה' });
  assert.equal(received.styleNote, 'חמה, בלי סלנג');
  assert.equal(received.conversation, 'David: two challahs please');
});

test('route degrades cleanly when the drafter fails and when state is unavailable', async () => {
  const router = createOrderReplyRouter({
    repository: {
      async loadState() {
        throw new Error('db down');
      },
    },
    draftOrderReply: async (input) => {
      assert.equal(input.styleNote, null);
      return 'עדיין עובד';
    },
  });
  const ok = await postJson(router, '/api/ai/order-reply', {
    conversation: 'hello',
    summary: { ...SUMMARY, lines: [], totalUsd: null },
    missing: [],
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.reply, 'עדיין עובד');
});
