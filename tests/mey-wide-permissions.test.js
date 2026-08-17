'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const http = require('node:http');

const { createMeyTools } = require('../server/telegram/mey-tools');
const { createMeyAuditRouter } = require('../server/telegram/mey-audit-route');
const { AUDIT_LOG_KEY } = require('../server/telegram/mey-audited-actions');

function fakeRepository(initialState) {
  let state = initialState;
  let revision = 1;
  return {
    async loadState() {
      return { data: structuredClone(state), revision, hash: 'h' };
    },
    async saveState({ localState }) {
      state = structuredClone(localState);
      revision += 1;
      return { ok: true };
    },
    _current: () => state,
  };
}

const silentLogger = { error() {} };

function baseState(settings = {}) {
  return {
    orders: [{ id: 'a1', name: 'קטי', date: '2026-08-21', time: '13:00', status: 'אושרה' }],
    settings,
    menu: { salads: ['סלט חצילים'], firsts: ['דג'], mains: ['עוף'], sides: ['אורז'], desserts: ['עוגה'], extras: [] },
  };
}

test('every write tool refuses while frozen; undo and reads still work', async () => {
  const repository = fakeRepository(baseState({ meyWritesFrozen: true, [AUDIT_LOG_KEY]: [] }));
  const tools = createMeyTools({
    repository,
    logger: silentLogger,
    whatsappIntake: { async intake() { throw new Error('must not be called while frozen'); } },
  });

  for (const [name, args] of [
    ['set_item_stock', { itemName: 'סלט חצילים', inStock: false }],
    ['set_order_status', { orderId: 'a1', status: 'מוכנה' }],
    ['set_ordering_open', { open: false }],
    ['set_site_banner', { message: 'x' }],
    ['update_order_details', { orderId: 'a1', fields: { time: '15:00' } }],
    ['delete_order', { orderId: 'a1' }],
    ['edit_menu_item', { op: 'add', category: 'salads', name: 'חדש', newName: null }],
    ['set_extra_price', { name: 'x', priceUsd: 5 }],
    ['set_base_prices', { couplePriceUsd: 250, challahPriceUsd: null }],
    ['build_order_from_whatsapp', { conversationText: 'הזמנה' }],
  ]) {
    const result = await tools.execute(name, args);
    assert.match(result.error || '', /הקפאה/u, `${name} must be blocked while frozen`);
  }

  const read = await tools.execute('search_orders', { query: 'קטי' });
  assert.equal(read.count, 1);

  const undo = await tools.execute('undo_last_change', { entryId: null });
  assert.equal(undo.ok, false); // nothing to undo, but not blocked by the freeze
  assert.doesNotMatch(undo.error, /הקפאה/u);
});

test('freeze_writes works from the chat and update_order_details round-trips through execute', async () => {
  const repository = fakeRepository(baseState());
  const tools = createMeyTools({ repository, logger: silentLogger });

  const updated = await tools.execute('update_order_details', { orderId: 'a1', fields: { time: '15:00' } });
  assert.equal(updated.ok, true);
  assert.equal(repository._current().orders[0].time, '15:00');

  const frozen = await tools.execute('freeze_writes', {});
  assert.equal(frozen.ok, true);
  const blocked = await tools.execute('update_order_details', { orderId: 'a1', fields: { time: '16:00' } });
  assert.match(blocked.error, /הקפאה/u);

  const undone = await tools.execute('undo_last_change', { entryId: null });
  assert.equal(undone.ok, true);
  assert.equal(repository._current().orders[0].time, '13:00');
});

test('build_order_from_whatsapp surfaces the intake result for the chat', async () => {
  const repository = fakeRepository(baseState());
  const tools = createMeyTools({
    repository,
    logger: silentLogger,
    whatsappIntake: {
      async intake(text) {
        assert.equal(text, 'David: 2 challahs');
        return {
          ok: true,
          orderId: 'mey-1-ff',
          orderUrl: 'https://www.batmelech.ae/admin/orders/mey-1-ff/edit',
          review: {
            draft: {
              customerName: 'David',
              customerPhone: null,
              serviceDate: null,
              serviceTime: null,
              deliveryLocation: null,
              items: [{ catalogItemId: 'selection:challahs', catalogItemName: 'חלות', category: 'challahs', quantity: 2, sourceText: '2 challahs', confidence: 0.9 }],
            },
            unknownItems: [],
            missingFields: [{ field: 'service_date' }],
          },
          replyDraft: 'Hi David!',
        };
      },
    },
  });

  const result = await tools.execute('build_order_from_whatsapp', { conversationText: 'David: 2 challahs' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.items, [{ name: 'חלות', quantity: 2 }]);
  assert.equal(result.replyDraftForCustomer, 'Hi David!');
  assert.match(result.orderUrl, /mey-1-ff/u);

  const withoutIntake = createMeyTools({ repository, logger: silentLogger });
  const unavailable = await withoutIntake.execute('build_order_from_whatsapp', { conversationText: 'x' });
  assert.match(unavailable.error, /לא זמינה/u);
});

async function requestJson(router, method, path, body) {
  const app = express();
  app.use('/api/mey/audit', router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  } finally {
    server.close();
  }
}

test('audit route: browse, undo by id, freeze and panel-only unfreeze', async () => {
  const repository = fakeRepository(baseState());
  const tools = createMeyTools({ repository, logger: silentLogger });
  await tools.execute('update_order_details', { orderId: 'a1', fields: { time: '18:00' } });

  const router = createMeyAuditRouter({ repository, logger: silentLogger });

  const listed = await requestJson(router, 'GET', '/api/mey/audit/');
  assert.equal(listed.status, 200);
  assert.equal(listed.data.frozen, false);
  assert.equal(listed.data.entries.length, 1);
  const entryId = listed.data.entries[0].id;

  const frozen = await requestJson(router, 'POST', '/api/mey/audit/freeze', { frozen: true });
  assert.equal(frozen.status, 200);
  assert.equal(repository._current().settings.meyWritesFrozen, true);

  const undone = await requestJson(router, 'POST', '/api/mey/audit/undo', { entryId });
  assert.equal(undone.status, 200);
  assert.equal(repository._current().orders[0].time, '13:00');

  const badFreeze = await requestJson(router, 'POST', '/api/mey/audit/freeze', { frozen: 'yes' });
  assert.equal(badFreeze.status, 400);

  const unfrozen = await requestJson(router, 'POST', '/api/mey/audit/freeze', { frozen: false });
  assert.equal(unfrozen.status, 200);
  assert.equal(repository._current().settings.meyWritesFrozen, undefined);

  const nothingLeft = await requestJson(router, 'POST', '/api/mey/audit/undo', {});
  assert.equal(nothingLeft.status, 409);
});
