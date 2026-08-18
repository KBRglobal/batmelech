'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { getShabbatOrChagStatus } = require('../server/shabbat-calendar');

// Every instant below is written in UTC and annotated with its Dubai wall
// clock (Dubai is UTC+4 all year, it has never kept DST). Absolute instants are
// the point: the answers must not move with the server's own timezone.
function dubai(year, month, day, hour, minute = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour - 4, minute));
}

function dubaiTime(epochMs) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(epochMs));
}

test('an ordinary Friday afternoon is open', () => {
  const status = getShabbatOrChagStatus(dubai(2026, 8, 14, 14));
  assert.deepEqual(status, { closed: false, label: null, reopensAt: null, occasion: null });
});

test('Friday evening after candle lighting is closed for Shabbat', () => {
  const status = getShabbatOrChagStatus(dubai(2026, 8, 14, 19, 30));
  assert.equal(status.closed, true);
  assert.equal(status.occasion, 'shabbat');
  assert.equal(status.label, 'שבת שלום');
  // Havdalah the next night, ~19:30 Dubai.
  assert.equal(dubaiTime(status.reopensAt), 'Sat, 15 Aug 2026, 19:30');
});

test('Shabbat morning is still closed, pointing at the same havdalah', () => {
  const evening = getShabbatOrChagStatus(dubai(2026, 8, 14, 19, 30));
  const morning = getShabbatOrChagStatus(dubai(2026, 8, 15, 11));
  assert.equal(morning.closed, true);
  assert.equal(morning.occasion, 'shabbat');
  assert.equal(morning.reopensAt, evening.reopensAt);
});

test('Saturday night after havdalah is open again', () => {
  const status = getShabbatOrChagStatus(dubai(2026, 8, 15, 21));
  assert.equal(status.closed, false);
  assert.equal(status.reopensAt, null);
});

// The exact edges, since these are what decide whether an order is accepted.
test('closure begins at candle lighting and ends at havdalah, to the minute', () => {
  const candleLighting = getShabbatOrChagStatus(dubai(2026, 8, 14, 19, 30)).reopensAt;
  assert.ok(candleLighting, 'the Shabbat span must be found');

  // 18:36 Dubai is candle lighting on 14 Aug 2026: a minute before, still open.
  assert.equal(getShabbatOrChagStatus(dubai(2026, 8, 14, 18, 35)).closed, false);
  assert.equal(getShabbatOrChagStatus(dubai(2026, 8, 14, 18, 36)).closed, true);

  // Havdalah is 19:30 Dubai on 15 Aug: the closure ends exactly there.
  assert.equal(getShabbatOrChagStatus(dubai(2026, 8, 15, 19, 29)).closed, true);
  assert.equal(getShabbatOrChagStatus(dubai(2026, 8, 15, 19, 30)).closed, false);
});

test('Yom Kippur is closed and greeted the way people actually greet it', () => {
  const status = getShabbatOrChagStatus(dubai(2026, 9, 21, 10));
  assert.equal(status.closed, true);
  assert.equal(status.occasion, 'chag');
  assert.equal(status.label, 'גמר חתימה טובה');
  assert.equal(dubaiTime(status.reopensAt), 'Mon, 21 Sept 2026, 18:51');
});

test('Kol Nidrei night is already inside the Yom Kippur closure', () => {
  const status = getShabbatOrChagStatus(dubai(2026, 9, 20, 19));
  assert.equal(status.closed, true);
  assert.equal(status.occasion, 'chag');
});

test('a chag carries its own name in the label', () => {
  const pesach = getShabbatOrChagStatus(dubai(2027, 4, 22, 12));
  assert.equal(pesach.closed, true);
  assert.equal(pesach.occasion, 'chag');
  assert.equal(pesach.label, 'חג שמח — פסח');

  const shavuot = getShabbatOrChagStatus(dubai(2027, 6, 11, 12));
  assert.equal(shavuot.occasion, 'chag');
  assert.equal(shavuot.label, 'חג שמח — שבועות');
});

// Rosh Hashana 5787 runs Friday night straight through Sunday night: three days
// with no havdalah in the middle, which only works if adjacent days merge.
test('Rosh Hashana running into Shabbat is one unbroken closure', () => {
  const erev = getShabbatOrChagStatus(dubai(2026, 9, 11, 19));
  const shabbat = getShabbatOrChagStatus(dubai(2026, 9, 12, 12));
  const secondDay = getShabbatOrChagStatus(dubai(2026, 9, 13, 12));

  for (const status of [erev, shabbat, secondDay]) {
    assert.equal(status.closed, true);
    assert.equal(status.occasion, 'chag');
    assert.equal(status.label, 'שנה טובה');
  }
  // One span, so all three report the same reopening: Sunday night.
  assert.equal(erev.reopensAt, shabbat.reopensAt);
  assert.equal(shabbat.reopensAt, secondDay.reopensAt);
  assert.equal(dubaiTime(secondDay.reopensAt), 'Sun, 13 Sept 2026, 18:59');
});

test('a chag that ends into Shabbat keeps running until Shabbat is out', () => {
  // Shavuot 5787 falls on a Friday, so the closure continues to Saturday night.
  const status = getShabbatOrChagStatus(dubai(2027, 6, 12, 12));
  assert.equal(status.closed, true);
  assert.equal(status.occasion, 'shabbat');
  assert.equal(status.label, 'שבת שלום');
  assert.equal(dubaiTime(status.reopensAt), 'Sat, 12 Jun 2027, 19:48');
});

// The days that look festive but are ordinary working days for a kitchen.
test('Chanukah, Purim, chol hamoed and the minor fasts stay open', () => {
  const workingDays = [
    ['Chanukah', dubai(2026, 12, 7, 12)],
    ['chol hamoed Sukkot', dubai(2026, 9, 28, 12)],
    ['chol hamoed Pesach', dubai(2027, 4, 25, 12)],
    ['Purim', dubai(2027, 3, 23, 12)],
    ['Asara B\'Tevet', dubai(2026, 12, 20, 12)],
    ['Shushan Purim', dubai(2027, 3, 24, 12)],
  ];
  for (const [name, at] of workingDays) {
    const status = getShabbatOrChagStatus(at);
    assert.equal(status.closed, false, `${name} should leave the site open`);
    assert.equal(status.occasion, null, `${name} should have no occasion`);
  }
});

// Nothing to renew and no table to extend: the calendar is computed, not listed.
test('it still keeps Shabbat five years out', () => {
  const status = getShabbatOrChagStatus(dubai(2031, 1, 10, 20));
  assert.equal(status.closed, true);
  assert.equal(status.occasion, 'shabbat');
  assert.equal(dubaiTime(status.reopensAt), 'Sat, 11 Jan 2031, 18:24');

  const decade = getShabbatOrChagStatus(dubai(2036, 10, 1, 12)); // Yom Kippur 5797
  assert.equal(decade.closed, true);
  assert.equal(decade.occasion, 'chag');
  assert.equal(decade.label, 'גמר חתימה טובה');
});

test('the same instant always gives the same answer, and the cache never leaks between days', () => {
  const at = dubai(2026, 8, 14, 19, 30);
  const first = getShabbatOrChagStatus(at);
  getShabbatOrChagStatus(dubai(2027, 4, 22, 12)); // a different Dubai date, different span set
  getShabbatOrChagStatus(dubai(2026, 8, 19, 12));
  assert.deepEqual(getShabbatOrChagStatus(at), first);
});

test('the returned object is a fresh copy a caller may mutate', () => {
  const open = getShabbatOrChagStatus(dubai(2026, 8, 14, 14));
  open.closed = true;
  assert.equal(getShabbatOrChagStatus(dubai(2026, 8, 14, 14)).closed, false);
});

test('an invalid date is refused rather than silently opening the site', () => {
  assert.throws(() => getShabbatOrChagStatus(new Date('nonsense')), TypeError);
  assert.throws(() => getShabbatOrChagStatus('2026-08-14'), TypeError);
  assert.throws(() => getShabbatOrChagStatus(null), TypeError);
});
