'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const http = require('node:http');

const { ConciergeServiceError, createOpenAIConcierge } = require('../server/ai/openai-concierge');
const { buildKnowledgeBlock, createConciergeRouter } = require('../server/ai/concierge-route');

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

const MENU = {
  couplePrice: 250,
  challahPrice: 10,
  salads: ['Matbucha', 'Moroccan Carrots'],
  firsts: ['Gefilte Fish'],
  mains: ['Chicken in Silan'],
  sides: ['Jeweled Rice'],
  desserts: [],
  extras: [{ name: 'Yerushalmi Kugel', price: 35 }],
  lunch: [{ key: 'baguette', price: 18, variants: [{ k: 'schnitzel', price: 18 }] }],
  lunchSides: ['fries'],
  itemIds: { salads: { Matbucha: 'admin-internal-id' } },
};

function fakeRepository(menu = MENU) {
  return {
    async loadState() {
      return { data: { menu }, revision: 1, hash: 'h' };
    },
  };
}

async function withServer(router, run) {
  const app = express();
  app.use('/api/site/concierge', router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const post = async (body) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/site/concierge/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return { status: response.status, data };
  };
  try {
    return await run(post);
  } finally {
    server.close();
  }
}

const USER_QUESTION = { messages: [{ role: 'user', content: 'How much is the Shabbat package?' }] };

test('knowledge block carries business facts and the live catalog, never admin bookkeeping', () => {
  const knowledge = buildKnowledgeBlock(MENU);
  // Fixed business facts.
  assert.match(knowledge, /kosher home kitchen in Dubai/u);
  assert.match(knowledge, /Dubai \$15, Abu Dhabi \$55/u);
  assert.match(knowledge, /Self-pickup is free/u);
  assert.match(knowledge, /cash, bank transfer, Bit, or PayBox/u);
  assert.match(knowledge, /\+971 58 628 8776/u);
  // Live catalog projection: package base price, dish names, priced extras.
  assert.match(knowledge, /Shabbat package for two, base price: \$250/u);
  assert.match(knowledge, /Challah: \$10/u);
  assert.match(knowledge, /Matbucha/u);
  assert.match(knowledge, /Yerushalmi Kugel — \$35/u);
  assert.match(knowledge, /baguette — \$18/u);
  // Admin-only bookkeeping never leaks.
  assert.doesNotMatch(knowledge, /admin-internal-id/u);
});

test('route builds knowledge from the repository state and returns the reply', async () => {
  let received = null;
  const router = createConciergeRouter({
    repository: fakeRepository(),
    answerConcierge: async (input) => {
      received = input;
      return 'The Shabbat package for two is $250.';
    },
  });
  const ok = await withServer(router, (post) => post(USER_QUESTION));
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.data, { reply: 'The Shabbat package for two is $250.' });
  assert.match(received.knowledge, /\$250/u);
  assert.match(received.knowledge, /Yerushalmi Kugel — \$35/u);
  assert.equal(received.messages[0].content, 'How much is the Shabbat package?');
});

test('route validates shape and caps', async () => {
  const router = createConciergeRouter({
    repository: fakeRepository(),
    answerConcierge: async () => 'ok',
  });
  await withServer(router, async (post) => {
    assert.equal((await post({ nope: true })).status, 400);
    assert.equal((await post({ messages: [] })).status, 400);
    assert.equal((await post({ messages: [{ role: 'system', content: 'hi' }] })).status, 400);
    assert.equal((await post({ messages: [{ role: 'user', content: '' }] })).status, 400);
    assert.equal(
      (await post({ messages: [{ role: 'user', content: 'x'.repeat(1001) }] })).status,
      400
    );
    const tooMany = Array.from({ length: 13 }, () => ({ role: 'user', content: 'hi' }));
    assert.equal((await post({ messages: tooMany })).status, 400);
    // A valid alternating history passes.
    const valid = {
      messages: [
        { role: 'user', content: 'שלום' },
        { role: 'assistant', content: 'שלום! איך אפשר לעזור?' },
        { role: 'user', content: 'מה המחיר של מארז שבת?' },
      ],
    };
    assert.equal((await post(valid)).status, 200);
  });
});

test('number grounding: invented price is retried once, grounded retry wins', async () => {
  const knowledge = buildKnowledgeBlock(MENU);
  const good = 'The Shabbat package for two is $250, and the kugel is $35.';
  const retry = fakeOpenAIClient(['The package is $999.', good]);
  const answerer = createOpenAIConcierge({ client: retry.client, model: 'm', env: {} });
  const reply = await answerer({
    messages: [{ role: 'user', content: 'price?' }],
    knowledge,
  });
  assert.equal(reply, good);
  assert.equal(retry.calls.length, 2);
  assert.match(retry.calls[1].input[0].content, /ONLY numbers that appear verbatim/u);
});

test('number grounding: an always-inventing model fails closed as a 502 through the route', async () => {
  const alwaysBad = fakeOpenAIClient(['Special discount: only $999!', 'Fine, $888 then.']);
  const router = createConciergeRouter({
    repository: fakeRepository(),
    client: alwaysBad.client,
    model: 'm',
    env: {},
    logger: { error() {} },
  });
  const failed = await withServer(router, (post) => post(USER_QUESTION));
  assert.equal(failed.status, 502);
  assert.equal(failed.data.error.code, 'invalid_ai_response');
  assert.equal(alwaysBad.calls.length, 2);
});

test('ai_not_configured: no key and no client means 503, before any provider call', async () => {
  const router = createConciergeRouter({
    repository: fakeRepository(),
    env: {},
    logger: { error() {} },
  });
  const missing = await withServer(router, (post) => post(USER_QUESTION));
  assert.equal(missing.status, 503);
  assert.equal(missing.data.error.code, 'ai_not_configured');

  const service = createOpenAIConcierge({ env: {} });
  await assert.rejects(
    () => service({ messages: USER_QUESTION.messages, knowledge: 'k1' }),
    (error) => error instanceof ConciergeServiceError && error.code === 'ai_not_configured'
  );
});

test('rate limiter: 21st message from the same IP inside the window is rejected', async () => {
  const router = createConciergeRouter({
    repository: fakeRepository(),
    answerConcierge: async () => 'ok',
  });
  await withServer(router, async (post) => {
    for (let i = 0; i < 20; i += 1) {
      assert.equal((await post(USER_QUESTION)).status, 200);
    }
    const blocked = await post(USER_QUESTION);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.data.error.code, 'ai_rate_limited');
  });
});

test('route degrades to business facts when state is unavailable', async () => {
  let received = null;
  const router = createConciergeRouter({
    repository: {
      async loadState() {
        throw new Error('db down');
      },
    },
    answerConcierge: async (input) => {
      received = input;
      return 'still here';
    },
    logger: { error() {} },
  });
  const ok = await withServer(router, (post) => post(USER_QUESTION));
  assert.equal(ok.status, 200);
  assert.equal(ok.data.reply, 'still here');
  assert.match(received.knowledge, /Dubai \$15, Abu Dhabi \$55/u);
  assert.doesNotMatch(received.knowledge, /\$250/u);
});
