'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { setOrderingOpen, setSiteBanner, setItemStock } = require('../server/business-actions');

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
  };
}

test('setOrderingOpen writes the flag under settings', async () => {
  const repo = fakeRepository({ orders: [], settings: {} });
  const result = await setOrderingOpen(repo, false);
  assert.equal(result.ok, true);
  assert.equal(repo._current().settings.orderingOpen, false);
});

test('setOrderingOpen preserves other settings fields', async () => {
  const repo = fakeRepository({ orders: [], settings: { businessName: 'בת מלך' } });
  await setOrderingOpen(repo, true);
  assert.equal(repo._current().settings.businessName, 'בת מלך');
  assert.equal(repo._current().settings.orderingOpen, true);
});

test('setSiteBanner trims and stores a message', async () => {
  const repo = fakeRepository({ orders: [], settings: {} });
  await setSiteBanner(repo, '  חוזרים ביום ראשון  ');
  assert.equal(repo._current().settings.siteBanner, 'חוזרים ביום ראשון');
});

test('setSiteBanner clears the banner on empty or non-string input', async () => {
  const repo = fakeRepository({ orders: [], settings: { siteBanner: 'ישן' } });
  await setSiteBanner(repo, '   ');
  assert.equal(repo._current().settings.siteBanner, null);

  const repo2 = fakeRepository({ orders: [], settings: { siteBanner: 'ישן' } });
  await setSiteBanner(repo2, null);
  assert.equal(repo2._current().settings.siteBanner, null);
});

test('setItemStock adds an item name to settings.out when marked unavailable', async () => {
  const repo = fakeRepository({ orders: [], settings: {} });
  await setItemStock(repo, 'מטבוחה פיקנטית', false);
  assert.deepEqual(repo._current().settings.out, ['מטבוחה פיקנטית']);
});

test('setItemStock removes the item name when marked back in stock', async () => {
  const repo = fakeRepository({ orders: [], settings: { out: ['מטבוחה פיקנטית', 'חומוס'] } });
  await setItemStock(repo, 'מטבוחה פיקנטית', true);
  assert.deepEqual(repo._current().settings.out, ['חומוס']);
});

test('setItemStock does not duplicate an already-out item', async () => {
  const repo = fakeRepository({ orders: [], settings: { out: ['מטבוחה פיקנטית'] } });
  await setItemStock(repo, 'מטבוחה פיקנטית', false);
  assert.deepEqual(repo._current().settings.out, ['מטבוחה פיקנטית']);
});

test('setItemStock rejects a blank item name', async () => {
  const repo = fakeRepository({ orders: [], settings: {} });
  await assert.rejects(() => setItemStock(repo, '  ', false), RangeError);
});

test('setOrderingOpen reports failure when every save attempt is rejected', async () => {
  const repo = {
    async loadState() {
      return { data: { orders: [], settings: {} }, revision: 1, hash: 'h' };
    },
    async saveState() {
      return { ok: false };
    },
  };
  const result = await setOrderingOpen(repo, false);
  assert.equal(result.ok, false);
});
