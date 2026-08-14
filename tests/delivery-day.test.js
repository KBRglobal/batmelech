'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildMultiStopMapsUrl,
  destinationLabel,
  dubaiDateString,
  dubaiMinutesOfDay,
  findByToken,
  navigationHref,
  nextStop,
  parseClockMinutes,
  selectDeliveryDay,
  suggestRouteOrder,
} = require('../server/telegram/delivery-day');

function order(overrides) {
  return {
    id: `id-${overrides.name || 'x'}`,
    date: '2026-08-14',
    time: '',
    name: 'לקוח',
    status: 'חדשה',
    ...overrides,
  };
}

test('parseClockMinutes reads the messy ways people write a time', () => {
  assert.equal(parseClockMinutes('19:00'), 19 * 60);
  assert.equal(parseClockMinutes('19.00'), 19 * 60);
  assert.equal(parseClockMinutes('9:30'), 9 * 60 + 30);
  assert.equal(parseClockMinutes('  בסביבות 13:15 אחרי הצהריים '), 13 * 60 + 15);
  assert.equal(parseClockMinutes('בין 25:00 ל13:00'), 13 * 60, 'skips an impossible hour and keeps looking');
  assert.equal(parseClockMinutes('12:75'), null, 'rejects an impossible minute');
  assert.equal(parseClockMinutes('אחרי הצהריים'), null);
  assert.equal(parseClockMinutes(''), null);
  assert.equal(parseClockMinutes(null), null);
  assert.equal(parseClockMinutes(undefined), null);
  assert.equal(parseClockMinutes(1300), null);
});

test('selectDeliveryDay keeps only the deliveries of that day, sorted by time', () => {
  const state = {
    orders: [
      order({ name: 'דנה', time: '14:00' }),
      order({ name: 'אבי', time: '9:30' }),
      order({ name: 'יוסי', time: '' }),
      order({ name: 'מחר', date: '2026-08-15', time: '10:00' }),
      order({ name: 'איסוף', time: '11:00', pickup: true }),
      order({ name: 'נמסר', time: '08:00', status: 'נמסרה' }),
      order({ name: 'בוטל', time: '08:30', status: 'בוטלה' }),
    ],
  };
  const day = selectDeliveryDay(state, '2026-08-14');
  assert.deepEqual(
    day.map((entry) => entry.name),
    ['אבי', 'דנה', 'יוסי'],
    'untimed rides last, pickups/delivered/cancelled/other days are out',
  );
});

test('selectDeliveryDay sorts equal times by name and can include delivered ones', () => {
  const state = {
    orders: [
      order({ name: 'בני', time: '12:00' }),
      order({ name: 'אורית', time: '12.00' }),
      order({ name: 'נמסר', time: '07:00', status: 'נמסרה' }),
      order({ name: 'בוטל', time: '06:00', status: 'בוטלה' }),
    ],
  };
  assert.deepEqual(
    selectDeliveryDay(state, '2026-08-14').map((entry) => entry.name),
    ['אורית', 'בני'],
  );
  assert.deepEqual(
    selectDeliveryDay(state, '2026-08-14', { includeDelivered: true }).map((entry) => entry.name),
    ['נמסר', 'אורית', 'בני'],
    'the progress view sees delivered stops, never cancelled ones',
  );
});

test('selectDeliveryDay accepts a bare orders array and an empty date', () => {
  const orders = [order({ name: 'אבי', time: '10:00' })];
  assert.equal(selectDeliveryDay(orders, '2026-08-14').length, 1);
  assert.deepEqual(selectDeliveryDay(orders, ''), []);
  assert.deepEqual(selectDeliveryDay(null, '2026-08-14'), []);
});

test('navigationHref prefers a stored google link and falls back to a maps search', () => {
  const stored = order({
    name: 'דנה',
    navigationUrl: 'https://maps.google.com/?q=Atlantis',
    hotelAddress: 'Atlantis The Palm, Dubai',
  });
  assert.equal(navigationHref(stored), 'https://maps.google.com/?q=Atlantis');

  const search = navigationHref(order({ hotelAddress: 'Atlantis The Palm, Dubai' }));
  assert.equal(
    search,
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Atlantis The Palm, Dubai')}`,
  );
});

test('navigationHref rejects http and non-google stored links', () => {
  const insecure = order({ navigationUrl: 'http://www.google.com/maps/place/X', hotelName: 'Rixos' });
  assert.match(navigationHref(insecure), /^https:\/\/www\.google\.com\/maps\/search/u);

  const foreign = order({ navigationUrl: 'https://maps.evil.com/x', hotelName: 'Rixos' });
  assert.match(navigationHref(foreign), /^https:\/\/www\.google\.com\/maps\/search/u);

  const lookalike = order({ navigationUrl: 'https://www.google.com.evil.com/x', hotelName: 'Rixos' });
  assert.match(navigationHref(lookalike), /^https:\/\/www\.google\.com\/maps\/search/u);

  const garbage = order({ navigationUrl: 'not a url' });
  assert.equal(navigationHref(garbage), null, 'no stored link and no destination text means no link at all');
});

test('navigationHref and destinationLabel follow the documented field precedence', () => {
  const full = order({ hotelAddress: 'addr', hotelName: 'hotel', address: 'street', place: 'place' });
  assert.match(navigationHref(full), /query=addr$/u);
  assert.equal(destinationLabel(full), 'hotel');
  assert.equal(destinationLabel(order({ place: 'place', address: 'street' })), 'place');
  assert.equal(destinationLabel(order({ address: 'street' })), 'street');
  assert.equal(destinationLabel(order({})), 'יעד לא צוין');
});

test('nextStop walks the day and skips whatever is already delivered', () => {
  const day = [
    order({ id: 'a', name: 'אבי', status: 'נמסרה' }),
    order({ id: 'b', name: 'בני', status: 'במשלוח' }),
    order({ id: 'c', name: 'גדי', status: 'נמסרה' }),
    order({ id: 'd', name: 'דנה', status: 'חדשה' }),
  ];
  assert.equal(nextStop(day, 'b').name, 'דנה');
  assert.equal(nextStop(day, 'd'), null);
  assert.equal(nextStop(day, 'unknown').name, 'בני', 'an unknown id falls back to the first undelivered');
  assert.equal(nextStop(day, null).name, 'בני');
  assert.equal(nextStop([], null), null);
});

test('findByToken answers only when exactly one order matches', () => {
  const orders = [
    order({ name: 'אבי', meyToken: 'tok1' }),
    order({ name: 'בני', meyToken: 'tok2' }),
    order({ name: 'גדי', meyToken: 'tok2' }),
  ];
  assert.equal(findByToken(orders, 'tok1').name, 'אבי');
  assert.equal(findByToken(orders, 'tok2'), null, 'an ambiguous token is never guessed');
  assert.equal(findByToken(orders, 'nope'), null);
  assert.equal(findByToken(orders, ''), null);
  assert.equal(findByToken([], 'tok1'), null);
});

test('suggestRouteOrder keeps the clock first and only reorders nearby stops by proximity', () => {
  const near = order({ name: 'קרוב', time: '12:20', hotelLatitude: 25.21, hotelLongitude: 55.28 });
  const far = order({ name: 'רחוק', time: '12:10', hotelLatitude: 25.4, hotelLongitude: 55.5 });
  const start = order({ name: 'ראשון', time: '12:00', hotelLatitude: 25.2, hotelLongitude: 55.27 });
  const blind = order({ name: 'בלי-קואורדינטות', time: '12:15' });
  const late = order({ name: 'מאוחר', time: '18:00', hotelLatitude: 25.3, hotelLongitude: 55.3 });
  const untimed = order({ name: 'ללא שעה' });

  const route = suggestRouteOrder([untimed, late, near, blind, far, start]);
  assert.deepEqual(
    route.map((entry) => entry.name),
    ['ראשון', 'קרוב', 'בלי-קואורדינטות', 'רחוק', 'מאוחר', 'ללא שעה'],
    'inside the 12:00-12:20 cluster the near hotel jumps ahead of the far one, the coordinate-less stop holds its slot, a later request stays later, and untimed rides last',
  );
});

test('suggestRouteOrder is deterministic and total', () => {
  const orders = [
    order({ name: 'א', time: '10:00', hotelLatitude: 25.1, hotelLongitude: 55.1 }),
    order({ name: 'ב', time: '10:05', hotelLatitude: 25.9, hotelLongitude: 55.9 }),
    order({ name: 'ג', time: '10:10', hotelLatitude: 25.11, hotelLongitude: 55.11 }),
    order({ name: 'ד' }),
  ];
  const once = suggestRouteOrder(orders).map((entry) => entry.name);
  const twice = suggestRouteOrder(orders).map((entry) => entry.name);
  assert.deepEqual(once, twice);
  assert.equal(once.length, orders.length, 'no stop is ever dropped');
  assert.deepEqual(suggestRouteOrder([]), []);
});

test('buildMultiStopMapsUrl skips destination-less stops and chunks by nine', () => {
  assert.deepEqual(buildMultiStopMapsUrl([]), []);

  const three = buildMultiStopMapsUrl([
    order({ hotelAddress: 'Atlantis, Dubai' }),
    order({ name: 'ללא יעד' }),
    order({ place: 'Marina' }),
  ]);
  assert.equal(three.length, 1);
  assert.equal(
    three[0],
    `https://www.google.com/maps/dir/${encodeURIComponent('Atlantis, Dubai')}/${encodeURIComponent('Marina')}`,
  );

  const ten = buildMultiStopMapsUrl(
    Array.from({ length: 10 }, (unused, at) => order({ hotelName: `Hotel ${at}` })),
  );
  assert.equal(ten.length, 2);
  assert.equal(ten[0].replace('https://www.google.com/maps/dir/', '').split('/').length, 9);
  assert.equal(ten[1], `https://www.google.com/maps/dir/${encodeURIComponent('Hotel 9')}`);
});

test('Dubai date and minutes follow Dubai, not UTC', () => {
  const middayUtc = new Date('2026-08-14T08:15:00Z');
  assert.equal(dubaiDateString(middayUtc), '2026-08-14');
  assert.equal(dubaiMinutesOfDay(middayUtc), 12 * 60 + 15);

  const eveningUtc = new Date('2026-08-14T20:30:00Z');
  assert.equal(dubaiDateString(eveningUtc), '2026-08-15', 'a UTC evening is already tomorrow in Dubai');
  assert.equal(dubaiMinutesOfDay(eveningUtc), 30);

  const midnightDubai = new Date('2026-08-14T20:00:00Z');
  assert.equal(dubaiMinutesOfDay(midnightDubai), 0, 'midnight is minute zero, not 1440');
});
