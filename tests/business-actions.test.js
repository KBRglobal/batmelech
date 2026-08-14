'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  effectiveOrderingOpen,
  orderingStatus,
  upcomingSundayDubai,
  setOrderingOpen,
  setSiteBanner,
  setItemStock,
  setOrderStatus,
  markDeliveryNudge,
  setDeliveryDigestSent,
  setPromptMessageId,
  setDeliveryCheckin,
  setDeliveryProof,
  revertDeliveryProof,
  setPendingProof,
  setCourierLocation,
  setPlataOnOrder,
  setPlataStatus,
  setPlataDigestSent,
} = require('../server/business-actions');

function fakeRepository(initialState) {
  let state = initialState;
  let revision = 1;
  let saves = 0;
  return {
    async loadState() {
      return { data: state, revision, hash: 'h' };
    },
    async saveState({ localState }) {
      state = localState;
      revision += 1;
      saves += 1;
      return { ok: true };
    },
    _current: () => state,
    _saves: () => saves,
  };
}

function orderById(repo, id) {
  return repo._current().orders.find((order) => String(order.id) === String(id));
}

// 2026-08-09 is a Sunday, so 08-14 is the Friday and 08-16 the Sunday after it.
const AUGUST_2026 = {
  sunday: '2026-08-09',
  monday: '2026-08-10',
  thursday: '2026-08-13',
  friday: '2026-08-14',
  saturday: '2026-08-15',
  nextSunday: '2026-08-16',
};

function dubaiNoon(dateString) {
  return new Date(`${dateString}T08:00:00Z`); // 12:00 in Dubai
}

test('upcomingSundayDubai lands on the next Sunday from every weekday', () => {
  for (const day of ['sunday', 'monday', 'thursday', 'friday', 'saturday']) {
    const expected = day === 'sunday' ? '2026-08-16' : AUGUST_2026.nextSunday;
    assert.equal(upcomingSundayDubai(dubaiNoon(AUGUST_2026[day])), expected, `from ${day}`);
  }
  // Closing on a Sunday closes the whole coming week, never zero days.
  assert.equal(upcomingSundayDubai(dubaiNoon(AUGUST_2026.nextSunday)), '2026-08-23');
});

test('upcomingSundayDubai reads the weekday in Dubai, not in UTC', () => {
  // 21:00 UTC Saturday is already 01:00 Sunday in Dubai.
  assert.equal(upcomingSundayDubai(new Date('2026-08-15T21:00:00Z')), '2026-08-23');
});

test('setOrderingOpen closes only until the coming Sunday', async () => {
  const repo = fakeRepository({ orders: [], settings: {} });
  const result = await setOrderingOpen(repo, false, dubaiNoon(AUGUST_2026.monday));
  assert.equal(result.ok, true);
  assert.equal(repo._current().settings.orderingOpen, false);
  assert.equal(repo._current().settings.orderingClosedUntil, AUGUST_2026.nextSunday);
});

test('setOrderingOpen closing on Friday reopens the Sunday right after', async () => {
  const repo = fakeRepository({ orders: [], settings: {} });
  await setOrderingOpen(repo, false, dubaiNoon(AUGUST_2026.friday));
  assert.equal(repo._current().settings.orderingClosedUntil, AUGUST_2026.nextSunday);
});

test('setOrderingOpen opening clears the reopen day', async () => {
  const repo = fakeRepository({
    orders: [],
    settings: { orderingOpen: false, orderingClosedUntil: AUGUST_2026.nextSunday },
  });
  await setOrderingOpen(repo, true);
  assert.equal(repo._current().settings.orderingOpen, true);
  assert.equal('orderingClosedUntil' in repo._current().settings, false);
});

test('setOrderingOpen preserves other settings fields', async () => {
  const repo = fakeRepository({ orders: [], settings: { businessName: 'בת מלך' } });
  await setOrderingOpen(repo, true);
  assert.equal(repo._current().settings.businessName, 'בת מלך');
  assert.equal(repo._current().settings.orderingOpen, true);

  await setOrderingOpen(repo, false, dubaiNoon(AUGUST_2026.thursday));
  assert.equal(repo._current().settings.businessName, 'בת מלך');
});

test('effectiveOrderingOpen stays closed until the reopen day and opens on it', () => {
  const closed = { orderingOpen: false, orderingClosedUntil: AUGUST_2026.nextSunday };
  assert.equal(effectiveOrderingOpen(closed, AUGUST_2026.friday), false);
  assert.equal(effectiveOrderingOpen(closed, AUGUST_2026.saturday), false);
  assert.equal(effectiveOrderingOpen(closed, AUGUST_2026.nextSunday), true);
  assert.equal(effectiveOrderingOpen(closed, '2026-08-20'), true);
});

test('effectiveOrderingOpen falls back to the legacy boolean without a reopen day', () => {
  assert.equal(effectiveOrderingOpen({}, AUGUST_2026.friday), true);
  assert.equal(effectiveOrderingOpen({ orderingOpen: true }, AUGUST_2026.friday), true);
  assert.equal(effectiveOrderingOpen({ orderingOpen: false }, AUGUST_2026.friday), false);
  assert.equal(effectiveOrderingOpen(null, AUGUST_2026.friday), true);
  // A junk date is not a licence to open a store its owner closed.
  assert.equal(effectiveOrderingOpen({ orderingOpen: false, orderingClosedUntil: 'soon' }, AUGUST_2026.friday), false);
});

test('orderingStatus reports the reopen day only while ordering is closed', () => {
  const closed = { orderingOpen: false, orderingClosedUntil: AUGUST_2026.nextSunday };
  assert.deepEqual(orderingStatus(closed, AUGUST_2026.friday), {
    open: false,
    reopensOn: AUGUST_2026.nextSunday,
  });
  assert.deepEqual(orderingStatus(closed, AUGUST_2026.nextSunday), { open: true, reopensOn: null });
  assert.deepEqual(orderingStatus({}, AUGUST_2026.friday), { open: true, reopensOn: null });
  assert.deepEqual(orderingStatus({ orderingOpen: false }, AUGUST_2026.friday), {
    open: false,
    reopensOn: null,
  });
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

test('setOrderStatus updates the matching order and leaves others untouched', async () => {
  const repo = fakeRepository({
    orders: [{ id: 'a', status: 'חדשה' }, { id: 'b', status: 'חדשה' }],
    settings: {},
  });
  const result = await setOrderStatus(repo, 'a', 'אושרה');
  assert.equal(result.ok, true);
  assert.deepEqual(repo._current().orders, [{ id: 'a', status: 'אושרה' }, { id: 'b', status: 'חדשה' }]);
});

test('setOrderStatus fails cleanly when the order id does not exist', async () => {
  const repo = fakeRepository({ orders: [{ id: 'a', status: 'חדשה' }], settings: {} });
  const result = await setOrderStatus(repo, 'missing', 'אושרה');
  assert.equal(result.ok, false);
});

test('setOrderStatus rejects an unknown status value', async () => {
  const repo = fakeRepository({ orders: [{ id: 'a', status: 'חדשה' }], settings: {} });
  await assert.rejects(() => setOrderStatus(repo, 'a', 'לא קיים'), RangeError);
});

test('setOrderStatus stamps deliveredAt and clears the awaiting-reply marker on נמסרה', async () => {
  const repo = fakeRepository({
    orders: [{ id: 'a', status: 'במשלוח', meyAwaitingReplySince: 111 }],
    settings: {},
  });
  const result = await setOrderStatus(repo, 'a', 'נמסרה');
  assert.equal(result.ok, true);
  const order = orderById(repo, 'a');
  assert.equal(order.status, 'נמסרה');
  assert.equal(typeof order.deliveredAt, 'number');
  assert.equal('meyAwaitingReplySince' in order, false);
});

test('setOrderStatus keeps an existing deliveredAt stamp', async () => {
  const repo = fakeRepository({ orders: [{ id: 'a', status: 'נמסרה', deliveredAt: 500 }], settings: {} });
  await setOrderStatus(repo, 'a', 'נמסרה');
  assert.equal(orderById(repo, 'a').deliveredAt, 500);
});

test('setOrderStatus does not stamp deliveredAt for other statuses', async () => {
  const repo = fakeRepository({ orders: [{ id: 'a', status: 'חדשה' }], settings: {} });
  await setOrderStatus(repo, 'a', 'במשלוח');
  assert.equal('deliveredAt' in orderById(repo, 'a'), false);
});

test('markDeliveryNudge claims the lead nudge and mints a token', async () => {
  const repo = fakeRepository({ orders: [{ id: 'a', status: 'מוכנה' }, { id: 'b', status: 'חדשה' }], settings: {} });
  const result = await markDeliveryNudge(repo, 'a', 'lead');
  assert.equal(result.ok, true);
  assert.equal(result.claimed, true);
  assert.match(result.token, /^[0-9a-f]{8}$/);
  const order = orderById(repo, 'a');
  assert.equal(typeof order.meyLeadNudgeAt, 'number');
  assert.equal(order.meyToken, result.token);
  assert.deepEqual(orderById(repo, 'b'), { id: 'b', status: 'חדשה' });
});

test('markDeliveryNudge is a no-op on the second call and does not save again', async () => {
  const repo = fakeRepository({ orders: [{ id: 'a', status: 'מוכנה' }], settings: {} });
  const first = await markDeliveryNudge(repo, 'a', 'lead');
  const savesAfterFirst = repo._saves();
  const stampAfterFirst = orderById(repo, 'a').meyLeadNudgeAt;

  const second = await markDeliveryNudge(repo, 'a', 'lead');
  assert.equal(second.ok, true);
  assert.equal(second.claimed, false);
  assert.equal(second.token, first.token);
  assert.equal(repo._saves(), savesAfterFirst);
  assert.equal(orderById(repo, 'a').meyLeadNudgeAt, stampAfterFirst);
});

test('markDeliveryNudge keeps the three nudge kinds independent', async () => {
  const repo = fakeRepository({ orders: [{ id: 'a', status: 'מוכנה' }], settings: {} });
  const lead = await markDeliveryNudge(repo, 'a', 'lead');
  const checkin = await markDeliveryNudge(repo, 'a', 'checkin');
  const late = await markDeliveryNudge(repo, 'a', 'late');
  assert.equal(checkin.claimed, true);
  assert.equal(late.claimed, true);
  assert.equal(checkin.token, lead.token);
  const order = orderById(repo, 'a');
  assert.equal(typeof order.meyLeadNudgeAt, 'number');
  assert.equal(typeof order.meyCheckinAskedAt, 'number');
  assert.equal(typeof order.meyLateNudgeAt, 'number');
});

test('markDeliveryNudge sets the awaiting-reply marker only for the checkin kind', async () => {
  const repo = fakeRepository({ orders: [{ id: 'a', status: 'מוכנה' }], settings: {} });
  await markDeliveryNudge(repo, 'a', 'lead');
  assert.equal('meyAwaitingReplySince' in orderById(repo, 'a'), false);
  await markDeliveryNudge(repo, 'a', 'checkin');
  assert.equal(typeof orderById(repo, 'a').meyAwaitingReplySince, 'number');
});

test('markDeliveryNudge reuses an existing token instead of minting a new one', async () => {
  const repo = fakeRepository({ orders: [{ id: 'a', status: 'מוכנה', meyToken: 'deadbeef' }], settings: {} });
  const result = await markDeliveryNudge(repo, 'a', 'late');
  assert.equal(result.token, 'deadbeef');
  assert.equal(orderById(repo, 'a').meyToken, 'deadbeef');
});

test('markDeliveryNudge rejects an unknown kind and fails cleanly on a missing order', async () => {
  const repo = fakeRepository({ orders: [{ id: 'a', status: 'מוכנה' }], settings: {} });
  await assert.rejects(() => markDeliveryNudge(repo, 'a', 'whatever'), RangeError);
  const missing = await markDeliveryNudge(repo, 'nope', 'lead');
  assert.equal(missing.ok, false);
});

test('markDeliveryNudge yields the claim when another writer wins the save race', async () => {
  // First save is rejected (someone else wrote in between) and the order comes
  // back already nudged — the retry must re-check, not blindly overwrite.
  let order = { id: 'a', status: 'מוכנה' };
  let attempts = 0;
  const repo = {
    async loadState() {
      return { data: { orders: [order], settings: {} }, revision: 1, hash: 'h' };
    },
    async saveState() {
      attempts += 1;
      if (attempts === 1) {
        order = { ...order, meyLeadNudgeAt: 123, meyToken: 'aabbccdd' };
        return { ok: false };
      }
      return { ok: true };
    },
  };
  const result = await markDeliveryNudge(repo, 'a', 'lead');
  assert.deepEqual(result, { ok: true, claimed: false, token: 'aabbccdd' });
  assert.equal(attempts, 1);
  assert.equal(order.meyLeadNudgeAt, 123);
});

test('setDeliveryDigestSent claims a date once', async () => {
  const repo = fakeRepository({ orders: [], settings: { businessName: 'בת מלך' } });
  const first = await setDeliveryDigestSent(repo, '2026-08-14');
  assert.deepEqual(first, { ok: true, claimed: true });
  assert.equal(repo._current().settings.meyDigestSentFor, '2026-08-14');
  assert.equal(repo._current().settings.businessName, 'בת מלך');

  const savesAfterFirst = repo._saves();
  const second = await setDeliveryDigestSent(repo, '2026-08-14');
  assert.deepEqual(second, { ok: true, claimed: false });
  assert.equal(repo._saves(), savesAfterFirst);

  const nextDay = await setDeliveryDigestSent(repo, '2026-08-15');
  assert.equal(nextDay.claimed, true);
  assert.equal(repo._current().settings.meyDigestSentFor, '2026-08-15');
});

test('setPromptMessageId stores the message id as a number', async () => {
  const repo = fakeRepository({ orders: [{ id: 'a', status: 'מוכנה' }], settings: {} });
  const result = await setPromptMessageId(repo, 'a', 4321);
  assert.equal(result.ok, true);
  assert.equal(orderById(repo, 'a').meyPromptMessageId, 4321);

  const bad = await setPromptMessageId(repo, 'a', 'not a number');
  assert.equal(bad.ok, false);
});

test('setDeliveryCheckin records state, eta and note', async () => {
  const repo = fakeRepository({
    orders: [{ id: 'a', status: 'במשלוח', meyAwaitingReplySince: 111 }, { id: 'b', status: 'חדשה' }],
    settings: {},
  });
  const result = await setDeliveryCheckin(repo, 'a', { state: 'delayed', etaMinutes: 25, note: '  פקק  ' });
  assert.equal(result.ok, true);
  const order = orderById(repo, 'a');
  assert.equal(order.courierCheckinState, 'delayed');
  assert.equal(typeof order.courierCheckinAt, 'number');
  assert.equal(order.courierEtaMinutes, 25);
  assert.equal(typeof order.courierEtaAt, 'number');
  assert.equal(order.courierNote, 'פקק');
  assert.equal('meyAwaitingReplySince' in order, false);
  assert.deepEqual(orderById(repo, 'b'), { id: 'b', status: 'חדשה' });
});

test('setDeliveryCheckin ignores an out-of-range eta and truncates a long note', async () => {
  const repo = fakeRepository({ orders: [{ id: 'a', status: 'במשלוח' }], settings: {} });
  await setDeliveryCheckin(repo, 'a', { state: 'onTheWay', etaMinutes: 9000, note: 'x'.repeat(700) });
  const order = orderById(repo, 'a');
  assert.equal('courierEtaMinutes' in order, false);
  assert.equal(order.courierNote.length, 500);
});

test('setDeliveryCheckin rejects an unknown state without touching the order', async () => {
  const repo = fakeRepository({ orders: [{ id: 'a', status: 'במשלוח' }], settings: {} });
  const result = await setDeliveryCheckin(repo, 'a', { state: 'teleporting' });
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, 'string');
  assert.equal(repo._saves(), 0);
  assert.deepEqual(orderById(repo, 'a'), { id: 'a', status: 'במשלוח' });
});

test('setDeliveryProof marks the order delivered and remembers the previous status', async () => {
  const repo = fakeRepository({
    orders: [{ id: 'a', status: 'במשלוח', meyAwaitingReplySince: 111 }],
    settings: {},
  });
  const result = await setDeliveryProof(repo, 'a', { url: 'https://r2.example/proof.jpg', by: 'לין' });
  assert.equal(result.ok, true);
  assert.equal(result.previousStatus, 'במשלוח');
  const order = orderById(repo, 'a');
  assert.equal(order.deliveryProofUrl, 'https://r2.example/proof.jpg');
  assert.equal(order.deliveryProofBy, 'לין');
  assert.equal(typeof order.deliveryProofAt, 'number');
  assert.equal(order.statusBeforeProof, 'במשלוח');
  assert.equal(order.status, 'נמסרה');
  assert.equal(typeof order.deliveredAt, 'number');
  assert.equal('meyAwaitingReplySince' in order, false);
});

test('setDeliveryProof rejects a non-https url', async () => {
  const repo = fakeRepository({ orders: [{ id: 'a', status: 'במשלוח' }], settings: {} });
  const httpResult = await setDeliveryProof(repo, 'a', { url: 'http://r2.example/proof.jpg' });
  assert.equal(httpResult.ok, false);
  const missingResult = await setDeliveryProof(repo, 'a', {});
  assert.equal(missingResult.ok, false);
  assert.equal(repo._saves(), 0);
  assert.deepEqual(orderById(repo, 'a'), { id: 'a', status: 'במשלוח' });
});

test('setDeliveryProof honours an explicit timestamp', async () => {
  const repo = fakeRepository({ orders: [{ id: 'a', status: 'מוכנה' }], settings: {} });
  await setDeliveryProof(repo, 'a', { url: 'https://r2.example/proof.jpg', at: 777 });
  assert.equal(orderById(repo, 'a').deliveryProofAt, 777);
});

test('revertDeliveryProof restores the exact previous status and clears the proof fields', async () => {
  const repo = fakeRepository({ orders: [{ id: 'a', status: 'במשלוח' }], settings: {} });
  await setDeliveryProof(repo, 'a', { url: 'https://r2.example/proof.jpg', by: 'לין' });
  const result = await revertDeliveryProof(repo, 'a');
  assert.equal(result.ok, true);
  assert.deepEqual(orderById(repo, 'a'), { id: 'a', status: 'במשלוח' });
});

test('revertDeliveryProof falls back to מוכנה when no previous status was recorded', async () => {
  const repo = fakeRepository({
    orders: [{ id: 'a', status: 'נמסרה', deliveryProofUrl: 'https://r2.example/p.jpg', deliveredAt: 5 }],
    settings: {},
  });
  await revertDeliveryProof(repo, 'a');
  assert.deepEqual(orderById(repo, 'a'), { id: 'a', status: 'מוכנה' });
});

test('setPendingProof stores and clears the pending photo', async () => {
  const repo = fakeRepository({ orders: [], settings: { businessName: 'בת מלך' } });
  const stored = await setPendingProof(repo, { url: 'https://r2.example/p.jpg', at: 42, by: 'לין' });
  assert.equal(stored.ok, true);
  assert.deepEqual(repo._current().settings.meyPendingProof, { url: 'https://r2.example/p.jpg', at: 42, by: 'לין' });
  assert.equal(repo._current().settings.businessName, 'בת מלך');

  const cleared = await setPendingProof(repo, null);
  assert.equal(cleared.ok, true);
  assert.equal(repo._current().settings.meyPendingProof, null);
});

test('setPendingProof rejects a non-https url', async () => {
  const repo = fakeRepository({ orders: [], settings: {} });
  const result = await setPendingProof(repo, { url: 'ftp://r2.example/p.jpg' });
  assert.equal(result.ok, false);
  assert.equal(repo._saves(), 0);
});

test('setCourierLocation stores coordinates and rejects non-numbers', async () => {
  const repo = fakeRepository({ orders: [], settings: {} });
  const result = await setCourierLocation(repo, { lat: 31.77, lon: 35.21, at: 99 });
  assert.equal(result.ok, true);
  assert.deepEqual(repo._current().settings.meyCourierLocation, { lat: 31.77, lon: 35.21, at: 99 });

  const bad = await setCourierLocation(repo, { lat: 'north', lon: 35.21 });
  assert.equal(bad.ok, false);
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

// --- plata (hotplate) rental ---------------------------------------------------

function plataRepository(order = {}) {
  return fakeRepository({
    orders: [{ id: 'p1', name: 'רותי', hotelName: 'Atlantis', date: '2026-08-14', ...order }],
    settings: {},
  });
}

test('setPlataOnOrder marks hotplates out with an order and stores a canonical deposit', async () => {
  const repo = plataRepository();
  const result = await setPlataOnOrder(repo, 'p1', { count: 2, deposit: '50' });
  assert.equal(result.ok, true);

  const order = orderById(repo, 'p1');
  assert.equal(order.plataCount, 2);
  assert.equal(order.plataStatus, 'withCustomer');
  assert.equal(order.plataDeposit, '50.00');
  assert.equal(order.name, 'רותי', 'the rest of the order is untouched');
});

test('setPlataOnOrder accepts a numeric deposit and rejects a nonsense one', async () => {
  const repo = plataRepository();
  assert.equal((await setPlataOnOrder(repo, 'p1', { count: 1, deposit: 37.5 })).ok, true);
  assert.equal(orderById(repo, 'p1').plataDeposit, '37.50');

  const bad = await setPlataOnOrder(repo, 'p1', { count: 1, deposit: 'חמישים' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /deposit/);
  assert.equal(orderById(repo, 'p1').plataDeposit, '37.50', 'the stored deposit survives a rejected write');
});

test('setPlataOnOrder rejects a count that is not a whole number in range', async () => {
  const repo = plataRepository();
  for (const count of [-1, 2.5, 21, 'two', undefined]) {
    const result = await setPlataOnOrder(repo, 'p1', { count });
    assert.equal(result.ok, false, `count ${String(count)} must be rejected`);
  }
  assert.equal(repo._saves(), 0);
});

test('setPlataOnOrder with count 0 clears every plata field', async () => {
  const repo = plataRepository({
    plataCount: 2,
    plataDeposit: '50.00',
    plataStatus: 'collected',
    plataPickupNote: 'בקבלה',
    plataCollectedAt: 1_760_000_000_000,
    plataDepositReturnedAt: 1_760_000_100_000,
  });
  const result = await setPlataOnOrder(repo, 'p1', { count: 0 });
  assert.equal(result.ok, true);

  const order = orderById(repo, 'p1');
  for (const field of [
    'plataCount', 'plataDeposit', 'plataStatus', 'plataPickupNote',
    'plataCollectedAt', 'plataDepositReturnedAt',
  ]) {
    assert.equal(field in order, false, `${field} must be gone`);
  }
  assert.equal(order.name, 'רותי');
});

test('setPlataOnOrder keeps a status that already moved past withCustomer', async () => {
  const repo = plataRepository({ plataCount: 1, plataStatus: 'awaitingPickup', plataPickupNote: 'בקבלה' });
  const result = await setPlataOnOrder(repo, 'p1', { count: 2, deposit: '80' });
  assert.equal(result.ok, true);

  const order = orderById(repo, 'p1');
  assert.equal(order.plataCount, 2);
  assert.equal(order.plataStatus, 'awaitingPickup');
  assert.equal(order.plataPickupNote, 'בקבלה');
});

test('setPlataStatus walks the lifecycle and stamps each step once', async () => {
  const repo = plataRepository({ plataCount: 1, plataStatus: 'withCustomer' });

  const waiting = await setPlataStatus(repo, 'p1', 'awaitingPickup', { note: '  בקבלה  ' });
  assert.equal(waiting.ok, true);
  assert.equal(orderById(repo, 'p1').plataStatus, 'awaitingPickup');
  assert.equal(orderById(repo, 'p1').plataPickupNote, 'בקבלה');
  assert.equal('plataCollectedAt' in orderById(repo, 'p1'), false);

  assert.equal((await setPlataStatus(repo, 'p1', 'collected')).ok, true);
  const collectedAt = orderById(repo, 'p1').plataCollectedAt;
  assert.equal(typeof collectedAt, 'number');
  assert.equal('plataDepositReturnedAt' in orderById(repo, 'p1'), false);

  assert.equal((await setPlataStatus(repo, 'p1', 'collected')).ok, true);
  assert.equal(orderById(repo, 'p1').plataCollectedAt, collectedAt, 'the first collection time stands');

  assert.equal((await setPlataStatus(repo, 'p1', 'depositReturned')).ok, true);
  const order = orderById(repo, 'p1');
  assert.equal(order.plataStatus, 'depositReturned');
  assert.equal(typeof order.plataDepositReturnedAt, 'number');
  assert.equal(order.plataCollectedAt, collectedAt);
});

test('setPlataStatus rejects an unknown status and truncates a long note', async () => {
  const repo = plataRepository({ plataCount: 1, plataStatus: 'withCustomer' });

  const bad = await setPlataStatus(repo, 'p1', 'returnedMaybe');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /status must be one of/);
  assert.equal(repo._saves(), 0);

  await setPlataStatus(repo, 'p1', 'awaitingPickup', { note: 'א'.repeat(400) });
  assert.equal(orderById(repo, 'p1').plataPickupNote.length, 300);
});

test('setPlataStatus reports an order that is not there', async () => {
  const repo = plataRepository();
  const result = await setPlataStatus(repo, 'nope', 'collected');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'order not found');
});

test('setPlataDigestSent claims one motzei-Shabbat digest per day', async () => {
  const repo = fakeRepository({ orders: [], settings: {} });

  const first = await setPlataDigestSent(repo, '2026-08-15');
  assert.deepEqual(first, { ok: true, claimed: true });
  assert.equal(repo._current().settings.meyPlataDigestSentFor, '2026-08-15');

  const second = await setPlataDigestSent(repo, '2026-08-15');
  assert.deepEqual(second, { ok: true, claimed: false });
  assert.equal(repo._saves(), 1, 'a lost claim writes nothing');

  const nextWeek = await setPlataDigestSent(repo, '2026-08-22');
  assert.deepEqual(nextWeek, { ok: true, claimed: true });
});
