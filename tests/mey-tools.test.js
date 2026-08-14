'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createMeyTools } = require('../server/telegram/mey-tools');
const { dubaiDateString } = require('../server/telegram/delivery-day');

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

const silentLogger = { error() {} };

function toolsFor(state) {
  return createMeyTools({ repository: fakeRepository(state), logger: silentLogger });
}

const DAY = '2026-08-14';

function deliveryDayState() {
  return {
    orders: [
      {
        id: 'a1',
        date: DAY,
        name: 'קטי',
        time: '13:00',
        status: 'במשלוח',
        hotelName: 'Atlantis The Palm',
        meyAwaitingReplySince: 1700000000000,
        courierCheckinState: 'onTheWay',
        courierEtaMinutes: 25,
      },
      {
        id: 'a2',
        date: DAY,
        name: 'רותי',
        time: '11:30',
        status: 'נמסרה',
        hotelName: 'Burj Al Arab',
        deliveryProofUrl: 'https://files.example.com/proof.jpg',
        deliveredAt: 1700000111000,
      },
      { id: 'a3', date: DAY, name: 'דני', time: '12:00', status: 'בוטלה', hotelName: 'Rove Downtown' },
      { id: 'a4', date: DAY, name: 'שרה', time: '12:15', status: 'מוכנה', pickup: true },
      { id: 'a5', date: '2026-08-15', name: 'מיכל', time: '10:00', status: 'אושרה', hotelName: 'Hilton' },
    ],
    settings: {},
  };
}

test('get_delivery_day returns the day sorted by time, delivered included', async () => {
  const tools = toolsFor(deliveryDayState());
  const result = await tools.execute('get_delivery_day', { date: DAY });

  assert.equal(result.date, DAY);
  assert.equal(result.count, 2);
  assert.deepEqual(
    result.deliveries.map((delivery) => delivery.id),
    ['a2', 'a1'],
  );
});

test('get_delivery_day maps hotel, navigation link and coordination flags', async () => {
  const tools = toolsFor(deliveryDayState());
  const { deliveries } = await tools.execute('get_delivery_day', { date: DAY });
  const katy = deliveries.find((delivery) => delivery.id === 'a1');
  const ruti = deliveries.find((delivery) => delivery.id === 'a2');

  assert.equal(katy.name, 'קטי');
  assert.equal(katy.hotel, 'Atlantis The Palm');
  assert.equal(katy.time, '13:00');
  assert.equal(katy.status, 'במשלוח');
  assert.ok(katy.navigationUrl && katy.navigationUrl.startsWith('https://www.google.com/maps/search/'));
  assert.ok(katy.navigationUrl.includes(encodeURIComponent('Atlantis The Palm')));
  assert.equal(katy.awaitingReply, true);
  assert.equal(katy.checkinState, 'onTheWay');
  assert.equal(katy.etaMinutes, 25);
  assert.equal(katy.hasProofPhoto, false);
  assert.equal(katy.deliveredAt, null);

  assert.equal(ruti.hasProofPhoto, true);
  assert.equal(ruti.deliveredAt, 1700000111000);
  assert.equal(ruti.awaitingReply, false);
  assert.equal(ruti.checkinState, null);
  assert.equal(ruti.etaMinutes, null);
});

test('get_delivery_day excludes pickup, cancelled and other days', async () => {
  const tools = toolsFor(deliveryDayState());
  const { deliveries } = await tools.execute('get_delivery_day', { date: DAY });
  const ids = deliveries.map((delivery) => delivery.id);

  assert.ok(!ids.includes('a3'), 'cancelled order must not appear');
  assert.ok(!ids.includes('a4'), 'pickup order must not appear');
  assert.ok(!ids.includes('a5'), 'another day must not appear');
});

test('get_delivery_day falls back to null for a stop with no destination or time', async () => {
  const tools = toolsFor({ orders: [{ id: 'b1', date: DAY, status: 'מוכנה' }], settings: {} });
  const { deliveries } = await tools.execute('get_delivery_day', { date: DAY });

  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].name, 'ללא שם');
  assert.equal(deliveries[0].hotel, 'יעד לא צוין');
  assert.equal(deliveries[0].navigationUrl, null);
  assert.equal(deliveries[0].time, null);
});

test('get_delivery_day defaults to today in Dubai when no date is given', async () => {
  const today = dubaiDateString();
  const tools = toolsFor({
    orders: [
      { id: 'c1', date: today, name: 'לקוחה של היום', time: '12:00', status: 'מוכנה', hotelName: 'Rove Downtown' },
      { id: 'c2', date: '2020-01-01', name: 'ישנה', time: '12:00', status: 'מוכנה', hotelName: 'Hilton' },
    ],
    settings: {},
  });

  const result = await tools.execute('get_delivery_day', {});
  assert.equal(result.date, today);
  assert.deepEqual(
    result.deliveries.map((delivery) => delivery.id),
    ['c1'],
  );
});

test('set_delivery_checkin records state, eta and note on the order only', async () => {
  const repository = fakeRepository(deliveryDayState());
  const tools = createMeyTools({ repository, logger: silentLogger });

  const result = await tools.execute('set_delivery_checkin', {
    orderId: 'a1',
    state: 'delayed',
    etaMinutes: 25,
    note: 'וייז אומר 25 דקות',
  });

  assert.equal(result.ok, true);
  const order = repository._current().orders.find((candidate) => candidate.id === 'a1');
  assert.equal(order.courierCheckinState, 'delayed');
  assert.equal(order.courierEtaMinutes, 25);
  assert.equal(order.courierNote, 'וייז אומר 25 דקות');
  assert.equal(order.meyAwaitingReplySince, undefined);
  assert.equal(order.status, 'במשלוח', 'check-in must not touch the order status');
});

test('set_delivery_checkin accepts null eta and null note', async () => {
  const repository = fakeRepository(deliveryDayState());
  const tools = createMeyTools({ repository, logger: silentLogger });

  const result = await tools.execute('set_delivery_checkin', {
    orderId: 'a1',
    state: 'onTime',
    etaMinutes: null,
    note: null,
  });

  assert.equal(result.ok, true);
  const order = repository._current().orders.find((candidate) => candidate.id === 'a1');
  assert.equal(order.courierCheckinState, 'onTime');
  assert.equal(order.courierEtaMinutes, 25, 'a previously reported eta stays until a new one arrives');
  assert.equal(order.courierNote, undefined);
});

test('set_delivery_checkin rejects an unknown state and an unknown order', async () => {
  const repository = fakeRepository(deliveryDayState());
  const tools = createMeyTools({ repository, logger: silentLogger });

  const badState = await tools.execute('set_delivery_checkin', { orderId: 'a1', state: 'לא קיים' });
  assert.equal(badState.ok, false);
  assert.match(badState.error, /state must be one of/);
  assert.equal(repository._current().orders.find((o) => o.id === 'a1').courierCheckinState, 'onTheWay');

  const missing = await tools.execute('set_delivery_checkin', { orderId: 'nope', state: 'onTime' });
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'order not found');
});

test('the tool surface exposes nine well-formed definitions', async () => {
  const tools = toolsFor({ orders: [], settings: {} });

  assert.equal(tools.definitions.length, 9);
  for (const definition of tools.definitions) {
    assert.equal(definition.type, 'function', `${definition.name} must be a function tool`);
    assert.equal(typeof definition.name, 'string');
    assert.ok(definition.name.length > 0);
    assert.equal(typeof definition.description, 'string');
    assert.ok(definition.description.length > 0, `${definition.name} needs a description`);
    assert.equal(typeof definition.parameters, 'object');
    assert.equal(definition.parameters.type, 'object');
    assert.equal(definition.parameters.additionalProperties, false, `${definition.name} must be closed`);
  }

  const names = tools.definitions.map((definition) => definition.name);
  assert.ok(names.includes('get_delivery_day'));
  assert.ok(names.includes('set_delivery_checkin'));
});

test('unknown tools are reported rather than thrown', async () => {
  const tools = toolsFor({ orders: [], settings: {} });
  const result = await tools.execute('set_price', { amount: 10 });
  assert.equal(result.error, 'unknown tool: set_price');
});
