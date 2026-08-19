'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { initializeMeyMemory, loadRecentTurns, appendTurn } = require('../server/telegram/mey-memory');
const { createMeyAgent } = require('../server/telegram/mey-agent');

// A pg-pool double implementing just what mey-memory issues.
function fakeMemoryPool() {
  const rows = [];
  let nextId = 1;
  return {
    rows,
    async query(sql, params = []) {
      if (sql.startsWith('CREATE TABLE')) return { rows: [] };
      if (sql.includes('INSERT INTO public.mey_conversation')) {
        rows.push({ id: nextId++, role: params[0], content: params[1], created_at: new Date() });
        return { rows: [] };
      }
      if (sql.includes('DELETE FROM public.mey_conversation')) {
        const maxId = rows.length ? rows[rows.length - 1].id : 0;
        const cutoff = maxId - 200;
        for (let i = rows.length - 1; i >= 0; i--) if (rows[i].id < cutoff) rows.splice(i, 1);
        return { rows: [] };
      }
      if (sql.includes('SELECT role, content')) {
        const recent = rows.slice(-16);
        return { rows: recent.map(({ role, content }) => ({ role, content })) };
      }
      return { rows: [] };
    },
  };
}

test('memory stores turns and returns them oldest-first, bounded', async () => {
  const pool = fakeMemoryPool();
  await initializeMeyMemory(pool);
  for (let i = 1; i <= 20; i++) {
    await appendTurn(pool, 'user', `שאלה ${i}`);
    await appendTurn(pool, 'assistant', `תשובה ${i}`);
  }
  const turns = await loadRecentTurns(pool);
  assert.equal(turns.length, 16);
  assert.equal(turns[turns.length - 1].content, 'תשובה 20');
  assert.equal(turns[0].role, 'user');
});

test('appendTurn refuses empty content and unknown roles', async () => {
  const pool = fakeMemoryPool();
  await appendTurn(pool, 'user', '   ');
  await appendTurn(pool, 'system', 'not allowed');
  assert.equal(pool.rows.length, 0);
});

test('the agent includes recent turns in the model input and stores the exchange', async (t) => {
  const pool = fakeMemoryPool();
  await appendTurn(pool, 'user', '[השולח: לין]\nמה האתר?');
  await appendTurn(pool, 'assistant', 'https://www.batmelech.ae');

  let capturedInput = null;
  const fakeClient = {
    responses: {
      create: async (request) => {
        capturedInput = request.input;
        return { output: [], output_text: 'זה מה שאמרתי קודם 🌸' };
      },
    },
  };
  const repository = { loadState: async () => ({ ok: true, state: {} }) };
  const agent = createMeyAgent({
    repository,
    pool,
    client: undefined,
    env: { OPENAI_MODEL: 'test-model', OPENAI_API_KEY: 'test-key' },
    clientFactory: () => fakeClient,
    logger: { error() {} },
  });

  const reply = await agent.reply('מה אמרת קודם?', { firstName: 'לין' });
  assert.equal(reply, 'זה מה שאמרתי קודם 🌸');
  // system + 2 remembered turns + current message
  assert.equal(capturedInput.length, 4);
  assert.equal(capturedInput[1].content, '[השולח: לין]\nמה האתר?');
  assert.equal(capturedInput[2].role, 'assistant');
  assert.match(capturedInput[3].content, /מה אמרת קודם/u);

  // the new exchange is persisted (fire-and-forget — allow the microtask to land)
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(pool.rows.length, 4);
  assert.equal(pool.rows[3].role, 'assistant');
});
