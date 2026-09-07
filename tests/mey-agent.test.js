'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createMeyAgent, needsVerification, nowBlock, rankingViolation, replyIsGrounded, UNGROUNDED_REPLY } = require('../server/telegram/mey-agent');

const silentLogger = { error() {} };
const repository = { loadState: async () => ({ ok: true, data: {} }) };

// Scripted OpenAI double: each call returns the next response; tool calls come
// back to the agent as function_call items exactly like the Responses API.
function scriptedClient(responses) {
  const requests = [];
  return {
    requests,
    responses: {
      create: async (request) => {
        requests.push(request);
        const next = responses.shift();
        if (!next) throw new Error('no scripted response left');
        return next;
      },
    },
  };
}

function textResponse(text) {
  return { output: [], output_text: text };
}

function toolCallResponse(name, args) {
  return { output: [{ type: 'function_call', call_id: `call-${name}`, name, arguments: JSON.stringify(args) }] };
}

function agentWith(client, env = {}) {
  return createMeyAgent({
    repository,
    clientFactory: () => client,
    env: { OPENAI_MODEL: 'test-model', OPENAI_API_KEY: 'k', OPENAI_MEY_VERIFY: 'off', ...env },
    logger: silentLogger,
  });
}

function isVerifierRequest(request) {
  return Boolean(request.text && request.text.format && request.text.format.type === 'json_schema');
}

test('the model is told what day it is in Dubai, and the dirham peg', () => {
  const block = nowBlock(new Date('2026-09-07T10:32:00Z')); // Monday 14:32 Dubai
  assert.match(block, /2026-09-07/u);
  assert.match(block, /14:32/u);
  assert.match(block, /שני/u, 'weekday in Hebrew');
  assert.match(block, /2026-09-11/u, 'the coming Friday, delivery day');
  assert.match(block, /3\.6725/u);
});

test('the system prompt carries the now-block on every turn', async () => {
  const client = scriptedClient([textResponse('בטח אהובה')]);
  await agentWith(client).reply('היי', { firstName: 'לין' });
  const system = client.requests[0].input[0];
  assert.equal(system.role, 'system');
  assert.match(system.content, /שעון דובאי/u);
});

test('grounding: numbers must come from the data; small counts and list numbers are free', () => {
  const evidence = [{ totalMinorUnits: 14_800, totalUsd: '148.00', totalAed: '543.53', phone: '0526360575' }];
  assert.equal(replyIsGrounded('לטוני יצא 148.00$ שזה 543.53 דירהם', evidence), true);
  assert.equal(replyIsGrounded('הטלפון 0526360575, 2 משלוחים ב-Atlantis', evidence), true);
  assert.equal(replyIsGrounded('1. רותי 2. דנה 3. חן — סה"כ 7 משלוחים', evidence), true);
  assert.equal(replyIsGrounded('סה"כ 1,061.16 דירהם', [{ aed: '1061.16' }]), true, 'comma grouping is fine');
  assert.equal(replyIsGrounded('143 דירהם', evidence), false);
  assert.equal(replyIsGrounded('בדולרים — 39$', evidence), false);
  assert.equal(replyIsGrounded('בערך 105 דירהם', evidence), false);
});

test('an invented number is sent back once with a correction, and the corrected reply goes out', async () => {
  const client = scriptedClient([
    toolCallResponse('search_orders', { query: 'טוני' }),
    textResponse('143 דירהם.'),
    textResponse('לטוני יצא 148.00$, שזה 543.53 דירהם.'),
  ]);
  const agent = createMeyAgent({
    repository,
    clientFactory: () => client,
    env: { OPENAI_MODEL: 'test-model', OPENAI_API_KEY: 'k', OPENAI_MEY_VERIFY: 'off' },
    logger: silentLogger,
    toolsFactory: () => ({
      definitions: [],
      execute: async () => ({ count: 1, orders: [{ name: 'טוני', totalUsd: '148.00', totalAed: '543.53' }] }),
    }),
  });
  const reply = await agent.reply('כמה יצא לטוני בדירהם?', { firstName: 'לין' });
  assert.equal(reply, 'לטוני יצא 148.00$, שזה 543.53 דירהם.');
  assert.equal(client.requests.length, 3);
  const correction = client.requests[2].input.at(-1);
  assert.equal(correction.role, 'system');
  assert.match(correction.content, /143/u, 'the correction names the invented number');
});

test('a reply that stays ungrounded after the correction never reaches the chat', async () => {
  const client = scriptedClient([textResponse('143 דירהם.'), textResponse('בערך 105 דירהם.')]);
  const reply = await agentWith(client).reply('כמה יצא לטוני בדירהם?', { firstName: 'לין' });
  assert.equal(reply, UNGROUNDED_REPLY);
});

test('numbers the person typed are theirs to hear back', async () => {
  const client = scriptedClient([textResponse('רשמתי: וייז אומר 25 דקות 🌸')]);
  const reply = await agentWith(client).reply('וייז אומר 25 דקות', { username: 'balmin55' });
  assert.equal(reply, 'רשמתי: וייז אומר 25 דקות 🌸');
});

test('Mey has her own model and reasoning knobs, with sane defaults', async () => {
  const shared = scriptedClient([textResponse('היי')]);
  await agentWith(shared).reply('היי', {});
  assert.equal(shared.requests[0].model, 'test-model');
  assert.deepEqual(shared.requests[0].reasoning, { effort: 'medium' });

  const own = scriptedClient([textResponse('היי')]);
  await agentWith(own, { OPENAI_MEY_MODEL: 'big-model', OPENAI_MEY_EFFORT: 'high' }).reply('היי', {});
  assert.equal(own.requests[0].model, 'big-model');
  assert.deepEqual(own.requests[0].reasoning, { effort: 'high' });

  const junk = scriptedClient([textResponse('היי')]);
  await agentWith(junk, { OPENAI_MEY_EFFORT: 'turbo' }).reply('היי', {});
  assert.deepEqual(junk.requests[0].reasoning, { effort: 'medium' }, 'an unknown effort falls back');
});

test('the system prompt carries the live business briefing', async () => {
  const client = scriptedClient([textResponse('בטח')]);
  const agent = createMeyAgent({
    repository: {
      loadState: async () => ({
        data: {
          settings: { orderingOpen: true },
          orders: [{ id: 'x', date: '2026-09-11', name: 'דנה', place: 'Five Palm', total: '460', status: 'אושרה', paid: 'לא' }],
        },
      }),
    },
    clientFactory: () => client,
    env: { OPENAI_MODEL: 'test-model', OPENAI_API_KEY: 'k', OPENAI_MEY_VERIFY: 'off' },
    logger: silentLogger,
    now: () => new Date('2026-09-07T10:00:00Z'),
  });
  await agent.reply('היי', { firstName: 'לין' });
  const system = client.requests[0].input[0].content;
  assert.match(system, /תמונת מצב של העסק/u);
  assert.match(system, /שישי הקרוב \(2026-09-11\): 1 הזמנות/u);
  assert.match(system, /דנה — Five Palm/u);
});

test('numbers from the briefing count as evidence', async () => {
  const client = scriptedClient([textResponse('לשישי יש הזמנה של דנה על 460.00$')]);
  const agent = createMeyAgent({
    repository: {
      loadState: async () => ({
        data: { orders: [{ id: 'x', date: '2026-09-11', name: 'דנה', total: '460', status: 'אושרה' }] },
      }),
    },
    clientFactory: () => client,
    env: { OPENAI_MODEL: 'test-model', OPENAI_API_KEY: 'k', OPENAI_MEY_VERIFY: 'off' },
    logger: silentLogger,
    now: () => new Date('2026-09-07T10:00:00Z'),
  });
  const reply = await agent.reply('מה יש לשישי?', { firstName: 'לין' });
  assert.equal(reply, 'לשישי יש הזמנה של דנה על 460.00$');
});

test('verification is needed after a tool call or when the reply states a number, not for small talk', () => {
  assert.equal(needsVerification('בוקר טוב אהובה 🌸', []), false);
  assert.equal(needsVerification('יש 7 משלוחים', []), true);
  assert.equal(needsVerification('בטח', [{ tool: 'x' }]), true);
});

test('a flagged claim goes back to the model with its tools; a grounded retry that passes goes out', async () => {
  const client = scriptedClient([
    toolCallResponse('search_orders', { query: 'טוני' }),
    textResponse('טוני הזמינה ל-Atlantis The Royal, 148.00$.'),
    textResponse(JSON.stringify({ ok: false, problems: ['המלון בראיות הוא Atlantis The Palm'], corrected: 'x' })),
    toolCallResponse('get_order_full', { orderId: 'o-1' }),
    textResponse('טוני הזמינה ל-Atlantis The Palm, 148.00$.'),
    textResponse(JSON.stringify({ ok: true, problems: [], corrected: 'טוני הזמינה ל-Atlantis The Palm, 148.00$.' })),
  ]);
  const agent = createMeyAgent({
    repository,
    clientFactory: () => client,
    env: { OPENAI_MODEL: 'test-model', OPENAI_API_KEY: 'k' },
    logger: silentLogger,
    toolsFactory: () => ({
      definitions: [{ type: 'function', name: 'search_orders' }],
      execute: async () => ({ count: 1, orders: [{ name: 'טוני', place: 'Atlantis The Palm', totalUsd: '148.00' }] }),
    }),
  });
  const reply = await agent.reply('לאן טוני הזמינה?', { firstName: 'לין' });
  assert.equal(reply, 'טוני הזמינה ל-Atlantis The Palm, 148.00$.');
  assert.equal(client.requests.length, 6);
  const retryInstruction = [...client.requests[3].input].reverse().find((item) => item.role === 'system');
  assert.ok(retryInstruction, 'the retry carries a system instruction');
  assert.match(retryInstruction.content, /Atlantis The Palm/u, 'the retry carries the verifier findings');
  assert.match(client.requests[2].input[1].content, /search_orders/u, 'the verifier knows her tools');
});

test('when the retry still fails the check, the verifier rewrite goes out', async () => {
  const client = scriptedClient([
    toolCallResponse('search_orders', { query: 'טוני' }),
    textResponse('טוני הזמינה ל-Atlantis The Royal, 148.00$.'),
    textResponse(JSON.stringify({ ok: false, problems: ['המלון בראיות הוא Atlantis The Palm'], corrected: 'טוני הזמינה ל-Atlantis The Palm, 148.00$.' })),
    textResponse('טוני הזמינה ל-Atlantis The Royal, 148.00$.'),
    textResponse(JSON.stringify({ ok: false, problems: ['עדיין Royal'], corrected: 'טוני הזמינה ל-Atlantis The Palm, 148.00$.' })),
  ]);
  const agent = createMeyAgent({
    repository,
    clientFactory: () => client,
    env: { OPENAI_MODEL: 'test-model', OPENAI_API_KEY: 'k' },
    logger: silentLogger,
    toolsFactory: () => ({
      definitions: [],
      execute: async () => ({ count: 1, orders: [{ name: 'טוני', place: 'Atlantis The Palm', totalUsd: '148.00' }] }),
    }),
  });
  const reply = await agent.reply('לאן טוני הזמינה?', { firstName: 'לין' });
  assert.equal(reply, 'טוני הזמינה ל-Atlantis The Palm, 148.00$.');
  const verifier = client.requests[2];
  assert.ok(isVerifierRequest(verifier), 'the third call is the structured truth check');
  assert.match(verifier.input[1].content, /Atlantis The Palm/u, 'the verifier sees the tool output');
  assert.match(verifier.input[1].content, /Atlantis The Royal/u, 'and the draft');
});

test('a truth check that passes leaves the reply untouched; a failed check call keeps the draft', async () => {
  const passing = scriptedClient([
    textResponse('יש 7 משלוחים'),
    textResponse(JSON.stringify({ ok: true, problems: [], corrected: 'יש 7 משלוחים' })),
  ]);
  assert.equal(await agentWith(passing, { OPENAI_MEY_VERIFY: 'on' }).reply('כמה משלוחים?', {}), 'יש 7 משלוחים');

  const broken = scriptedClient([textResponse('יש 7 משלוחים')]); // the verifier call throws: no scripted response
  assert.equal(await agentWith(broken, { OPENAI_MEY_VERIFY: 'on' }).reply('כמה משלוחים?', {}), 'יש 7 משלוחים');
});

test('a corrected reply still has to pass the number guard', async () => {
  const client = scriptedClient([
    textResponse('יש 7 משלוחים'),
    textResponse(JSON.stringify({ ok: false, problems: ['x'], corrected: 'יש 7 משלוחים בסך 999.99$' })),
    textResponse('יש 7 משלוחים בסך 888.88$'), // retry invents too -> not grounded -> ignored
  ]);
  assert.equal(await agentWith(client, { OPENAI_MEY_VERIFY: 'on' }).reply('כמה משלוחים?', {}), UNGROUNDED_REPLY);
});

test('tools learn who is talking, so a stored note is signed', async () => {
  let seenSender = null;
  const client = scriptedClient([toolCallResponse('remember_note', { scope: 'business', customerQuery: null, text: 'x' }), textResponse('זכרתי')]);
  const agent = createMeyAgent({
    repository,
    clientFactory: () => client,
    env: { OPENAI_MODEL: 'test-model', OPENAI_API_KEY: 'k', OPENAI_MEY_VERIFY: 'off' },
    logger: silentLogger,
    toolsFactory: () => ({
      definitions: [],
      execute: async (_name, _args, context) => {
        seenSender = context.sender;
        return { ok: true };
      },
    }),
  });
  await agent.reply('תזכרי ש-x', { firstName: 'F', username: 'balmin55' });
  assert.equal(seenSender, 'F @balmin55');
});

test('ranking guard: "the most" must be the first row of a sorted list', () => {
  const sorted = [{ tool: 'list_customers', result: { sortedBy: 'billed', customers: [{ name: 'רוני מועלם' }, { name: 'שירי דויד' }] } }];
  assert.equal(rankingViolation('מי הלקוח שהזמין בהכי הרבה כסף אי פעם?', 'רוני מועלם — 1744.00$', sorted), null);
  assert.match(rankingViolation('מי הלקוח שהזמין בהכי הרבה כסף אי פעם?', 'שירי דויד — 328.00$', sorted), /רוני/u);
  assert.match(rankingViolation('מי הלקוח שהזמין בהכי הרבה כסף?', 'שירי דויד — 328.00$', []), /list_customers/u);
  assert.equal(rankingViolation('כמה יצא לטוני?', 'טוני — 148.00$', []), null, 'not a ranking question');
  assert.equal(rankingViolation('מי הזמין הכי הרבה?', 'לא מצאתי הזמנות בכלל', []), null, 'an honest "none" is fine');
});

test('the Shiri David answer cannot happen again: the wrong first row is sent back, the right one goes out', async () => {
  const client = scriptedClient([
    toolCallResponse('list_customers', { sortBy: 'collected', limit: 1 }),
    textResponse('שירי דויד — 328.00$ / 1204.58 דירהם'),
    toolCallResponse('list_customers', { sortBy: 'billed', limit: 5 }),
    textResponse('רוני מועלם — 1744.00$ / 6404.84 דירהם'),
    textResponse(JSON.stringify({ ok: true, problems: [], corrected: 'רוני מועלם — 1744.00$ / 6404.84 דירהם' })),
  ]);
  const agent = createMeyAgent({
    repository,
    clientFactory: () => client,
    env: { OPENAI_MODEL: 'test-model', OPENAI_API_KEY: 'k' },
    logger: silentLogger,
    toolsFactory: () => ({
      definitions: [],
      execute: async (_name, args) =>
        args.sortBy === 'billed'
          ? { sortedBy: 'billed', customers: [{ name: 'רוני מועלם', totalBilledUsd: '1744.00', totalBilledAed: '6404.84' }, { name: 'שירי דויד' }] }
          : { sortedBy: 'collected', customers: [{ name: 'שירי דויד', totalCollectedUsd: '328.00', totalCollectedAed: '1204.58' }] },
    }),
  });
  const reply = await agent.reply('מי הלקוח שהזמין בהכי הרבה כסף אי פעם?', { firstName: 'לין' });
  assert.equal(reply, 'רוני מועלם — 1744.00$ / 6404.84 דירהם');
});

test('a ranking answer that stays wrong after the correction never reaches the chat', async () => {
  const client = scriptedClient([
    toolCallResponse('list_customers', { sortBy: 'billed', limit: 5 }),
    textResponse('שירי דויד — 328.00$'),
    textResponse('שירי דויד — 328.00$'),
  ]);
  const agent = createMeyAgent({
    repository,
    clientFactory: () => client,
    env: { OPENAI_MODEL: 'test-model', OPENAI_API_KEY: 'k', OPENAI_MEY_VERIFY: 'off' },
    logger: silentLogger,
    toolsFactory: () => ({
      definitions: [],
      execute: async () => ({ sortedBy: 'billed', customers: [{ name: 'רוני מועלם', totalBilledUsd: '1744.00' }, { name: 'שירי דויד', totalBilledUsd: '328.00' }] }),
    }),
  });
  assert.equal(await agent.reply('מי הזמין הכי הרבה?', { firstName: 'לין' }), UNGROUNDED_REPLY);
});
