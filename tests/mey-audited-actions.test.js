'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AUDIT_LOG_KEY,
  FROZEN_KEY,
  MAX_AUDIT_ENTRIES,
  deleteOrder,
  editMenuItem,
  freezeWrites,
  isWritesFrozen,
  readAuditLog,
  recordOrderCreated,
  setBasePrices,
  setExtraPrice,
  undoMeyChange,
  unfreezeWrites,
  updateOrderDetails,
} = require('../server/telegram/mey-audited-actions');

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

function baseState() {
  return {
    orders: [
      { id: 'a1', name: 'קטי', date: '2026-08-21', time: '13:00', status: 'אושרה', total: 230, paid: 'לא' },
      { id: 'a2', name: 'דני', date: '2026-08-21', status: 'חדשה' },
    ],
    settings: { out: ['קוסקוס עננים'] },
    menu: {
      couplePrice: 230,
      challahPrice: 10,
      salads: ['סלט חצילים', 'קוסקוס עננים'],
      firsts: ['פילה דג ברוטב מרוקאי'],
      mains: ['עוף בתנור'],
      sides: ['אורז'],
      desserts: ['עוגת שוקולד'],
      extras: [{ name: 'מגש בשרים', price: 120 }],
      itemIds: { salads: { 'קוסקוס עננים': 'id-couscous' } },
      itemMeta: { 'id-couscous': { description: 'אוורירי' } },
    },
  };
}

test('update_order_details edits whitelisted fields, audits, and undoes exactly', async () => {
  const repository = fakeRepository(baseState());

  const result = await updateOrderDetails(repository, 'a1', { time: '15:00', total: 320, paid: 'כן' });
  assert.equal(result.ok, true);
  const updated = repository._current().orders.find((order) => order.id === 'a1');
  assert.equal(updated.time, '15:00');
  assert.equal(updated.total, 320);
  assert.equal(updated.paid, 'כן');

  const log = repository._current().settings[AUDIT_LOG_KEY];
  assert.equal(log.length, 1);
  assert.match(log[0].summary, /קטי/);
  assert.equal(log[0].undone, false);

  const undo = await undoMeyChange(repository);
  assert.equal(undo.ok, true);
  const reverted = repository._current().orders.find((order) => order.id === 'a1');
  assert.equal(reverted.time, '13:00');
  assert.equal(reverted.total, 230);
  assert.equal(reverted.paid, 'לא');
  assert.equal(repository._current().settings[AUDIT_LOG_KEY][0].undone, true);

  const again = await undoMeyChange(repository);
  assert.equal(again.ok, false);
});

test('update_order_details rejects unknown fields, bad values, and unknown orders', async () => {
  const repository = fakeRepository(baseState());
  assert.equal((await updateOrderDetails(repository, 'a1', { meyToken: 'x' })).ok, false);
  assert.equal((await updateOrderDetails(repository, 'a1', { intakeConversation: 'x' })).ok, false);
  assert.equal((await updateOrderDetails(repository, 'a1', { date: '21.8' })).ok, false);
  assert.equal((await updateOrderDetails(repository, 'a1', { status: 'בוטלה' })).ok, false);
  assert.equal((await updateOrderDetails(repository, 'missing', { time: '10:00' })).ok, false);
  assert.equal((await updateOrderDetails(repository, 'a1', {})).ok, false);
  assert.equal(repository._current().settings[AUDIT_LOG_KEY], undefined);
});

test('delete_order removes the order and undo restores it fully', async () => {
  const repository = fakeRepository(baseState());
  const result = await deleteOrder(repository, 'a2');
  assert.equal(result.ok, true);
  assert.equal(repository._current().orders.length, 1);

  const undo = await undoMeyChange(repository);
  assert.equal(undo.ok, true);
  const restored = repository._current().orders.find((order) => order.id === 'a2');
  assert.deepEqual(restored, { id: 'a2', name: 'דני', date: '2026-08-21', status: 'חדשה' });
});

test('menu rename carries the photo mapping and stock list, and undo restores both', async () => {
  const repository = fakeRepository(baseState());
  const result = await editMenuItem(repository, {
    op: 'rename',
    category: 'salads',
    name: 'קוסקוס עננים',
    newName: 'קוסקוס ענני זהב',
  });
  assert.equal(result.ok, true);
  const menu = repository._current().menu;
  assert.deepEqual(menu.salads, ['סלט חצילים', 'קוסקוס ענני זהב']);
  assert.equal(menu.itemIds.salads['קוסקוס ענני זהב'], 'id-couscous');
  assert.equal(menu.itemIds.salads['קוסקוס עננים'], undefined);
  assert.deepEqual(repository._current().settings.out, ['קוסקוס ענני זהב']);

  const undo = await undoMeyChange(repository);
  assert.equal(undo.ok, true);
  assert.deepEqual(repository._current().menu.salads, ['סלט חצילים', 'קוסקוס עננים']);
  assert.equal(repository._current().menu.itemIds.salads['קוסקוס עננים'], 'id-couscous');
  assert.deepEqual(repository._current().settings.out, ['קוסקוס עננים']);
});

test('menu add/remove validate existence and are undoable', async () => {
  const repository = fakeRepository(baseState());
  assert.equal((await editMenuItem(repository, { op: 'add', category: 'salads', name: 'סלט חצילים' })).ok, false);
  assert.equal((await editMenuItem(repository, { op: 'remove', category: 'salads', name: 'לא קיים' })).ok, false);
  assert.equal((await editMenuItem(repository, { op: 'add', category: 'bogus', name: 'x' })).ok, false);

  const added = await editMenuItem(repository, { op: 'add', category: 'desserts', name: 'מלבי' });
  assert.equal(added.ok, true);
  assert.deepEqual(repository._current().menu.desserts, ['עוגת שוקולד', 'מלבי']);

  const removed = await editMenuItem(repository, { op: 'remove', category: 'desserts', name: 'מלבי' });
  assert.equal(removed.ok, true);
  assert.deepEqual(repository._current().menu.desserts, ['עוגת שוקולד']);

  const undo = await undoMeyChange(repository);
  assert.equal(undo.ok, true);
  assert.deepEqual(repository._current().menu.desserts, ['עוגת שוקולד', 'מלבי']);
});

test('price updates audit and undo, and reject bad values', async () => {
  const repository = fakeRepository(baseState());
  assert.equal((await setExtraPrice(repository, { name: 'לא קיים', priceUsd: 5 })).ok, false);
  assert.equal((await setExtraPrice(repository, { name: 'מגש בשרים', priceUsd: -1 })).ok, false);

  const extra = await setExtraPrice(repository, { name: 'מגש בשרים', priceUsd: 150 });
  assert.equal(extra.ok, true);
  assert.equal(repository._current().menu.extras[0].price, 150);

  const bases = await setBasePrices(repository, { couplePriceUsd: 250, challahPriceUsd: null });
  assert.equal(bases.ok, true);
  assert.equal(repository._current().menu.couplePrice, 250);
  assert.equal(repository._current().menu.challahPrice, 10);

  await undoMeyChange(repository); // undo base prices
  assert.equal(repository._current().menu.couplePrice, 230);
  await undoMeyChange(repository); // undo extra price
  assert.equal(repository._current().menu.extras[0].price, 120);
});

test('freeze blocks writes, undo still works, unfreeze is separate', async () => {
  const repository = fakeRepository(baseState());
  await updateOrderDetails(repository, 'a1', { time: '15:00' });

  const frozen = await freezeWrites(repository);
  assert.equal(frozen.ok, true);
  assert.equal(isWritesFrozen(repository._current().settings), true);

  const blocked = await updateOrderDetails(repository, 'a1', { time: '16:00' });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /מוקפאת/);

  const undo = await undoMeyChange(repository);
  assert.equal(undo.ok, true);
  assert.equal(repository._current().orders.find((order) => order.id === 'a1').time, '13:00');

  await unfreezeWrites(repository);
  assert.equal(isWritesFrozen(repository._current().settings), false);
  assert.equal(repository._current().settings[FROZEN_KEY], undefined);
  const allowed = await updateOrderDetails(repository, 'a1', { time: '17:00' });
  assert.equal(allowed.ok, true);
});

test('undo of a created order deletes it; specific entry undo works by id', async () => {
  const repository = fakeRepository(baseState());
  repository._current(); // noop
  await recordOrderCreated(repository, 'a2', 'יצירת הזמנה מוואטסאפ — דני');
  await updateOrderDetails(repository, 'a1', { time: '18:00' });

  const log = await readAuditLog(repository);
  assert.equal(log.entries.length, 2);
  const createdEntry = log.entries.find((entry) => entry.tool === 'create_order');

  const undone = await undoMeyChange(repository, createdEntry.id);
  assert.equal(undone.ok, true);
  assert.equal(repository._current().orders.some((order) => order.id === 'a2'), false);
  // The later edit is untouched.
  assert.equal(repository._current().orders.find((order) => order.id === 'a1').time, '18:00');
});

test('audit log is capped', async () => {
  const repository = fakeRepository(baseState());
  for (let index = 0; index < MAX_AUDIT_ENTRIES + 10; index += 1) {
    await updateOrderDetails(repository, 'a1', { time: `0${index % 10}:00`.slice(-5) });
  }
  assert.equal(repository._current().settings[AUDIT_LOG_KEY].length, MAX_AUDIT_ENTRIES);
});

test('readAuditLog reports newest first with undoable flags', async () => {
  const repository = fakeRepository(baseState());
  await updateOrderDetails(repository, 'a1', { time: '15:00' });
  await deleteOrder(repository, 'a2');
  const log = await readAuditLog(repository);
  assert.equal(log.frozen, false);
  assert.equal(log.entries[0].tool, 'delete_order');
  assert.equal(log.entries[0].undoable, true);
  assert.equal(log.entries[1].tool, 'update_order_details');
});
