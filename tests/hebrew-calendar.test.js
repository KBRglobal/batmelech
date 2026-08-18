'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  HOLIDAY_KEYS,
  dubaiDayString,
  addDays,
  hebrewDateOf,
  upcomingHolidays,
} = require('../server/holidays/hebrew-calendar');

function find(holidays, key) {
  return holidays.find((holiday) => holiday.key === key);
}

test('hebrewDateOf matches externally-known Hebrew dates', () => {
  // Externally verified (published Jewish calendars):
  assert.deepEqual(hebrewDateOf('2026-09-12'), { day: 1, monthName: 'Tishri', year: 5787 });
  assert.deepEqual(hebrewDateOf('2026-12-05'), { day: 25, monthName: 'Kislev', year: 5787 });
  assert.deepEqual(hebrewDateOf('2027-04-22'), { day: 15, monthName: 'Nisan', year: 5787 });
  // 5787 is a leap year — Purim falls in Adar II; 5786 is regular — plain "Adar".
  assert.deepEqual(hebrewDateOf('2027-03-23'), { day: 14, monthName: 'Adar II', year: 5787 });
  assert.deepEqual(hebrewDateOf('2026-03-03'), { day: 14, monthName: 'Adar', year: 5786 });
});

test('the coming Hebrew year 5787 lands on the known Gregorian dates', () => {
  const holidays = upcomingHolidays('2026-09-01', 13);

  // Hard-coded, externally-known dates (not derived from Intl):
  const roshHashanah = find(holidays, 'rosh-hashanah');
  assert.equal(roshHashanah.startDate, '2026-09-12');
  assert.equal(roshHashanah.endDate, '2026-09-13');
  assert.equal(roshHashanah.eveDate, '2026-09-11');

  const yomKippur = find(holidays, 'yom-kippur');
  assert.equal(yomKippur.startDate, '2026-09-21');
  assert.equal(yomKippur.endDate, '2026-09-21');

  const chanukah = find(holidays, 'chanukah');
  assert.equal(chanukah.startDate, '2026-12-05');
  assert.equal(chanukah.endDate, '2026-12-12');

  const purim = find(holidays, 'purim');
  assert.equal(purim.startDate, '2027-03-23'); // 14 Adar II — 5787 is a leap year

  const pesach = find(holidays, 'pesach');
  assert.equal(pesach.startDate, '2027-04-22');
  assert.equal(pesach.endDate, '2027-04-29'); // eight diaspora days
  assert.equal(pesach.eveDate, '2027-04-21');

  const sukkot = find(holidays, 'sukkot');
  assert.equal(sukkot.startDate, '2026-09-26');
  assert.equal(sukkot.endDate, '2026-10-02'); // 15–21 Tishrei

  const shminiAtzeret = find(holidays, 'shmini-atzeret');
  assert.equal(shminiAtzeret.startDate, '2026-10-03'); // 22 Tishrei

  const shavuot = find(holidays, 'shavuot');
  assert.equal(shavuot.startDate, '2027-06-11'); // 6 Sivan

  const tuBishvat = find(holidays, 'tu-bishvat');
  assert.equal(tuBishvat.startDate, '2027-01-23'); // 15 Shvat
});

test('regular-year Purim falls on plain 14 Adar (2026-03-03)', () => {
  const holidays = upcomingHolidays('2025-10-01', 13);
  const purim = find(holidays, 'purim');
  assert.equal(purim.startDate, '2026-03-03');
  // Same window: Pesach 5786 — externally known.
  assert.equal(find(holidays, 'pesach').startDate, '2026-04-02');
  assert.equal(find(holidays, 'chanukah').startDate, '2025-12-15');
});

test('day-of-week sanity cross-checked against Intl itself', () => {
  const holidays = upcomingHolidays('2026-09-01', 13);
  const dayOfWeek = (day) => new Date(`${day}T00:00:00Z`).getUTCDay();
  // Rosh Hashanah 2026-09-12 is a Saturday (Shabbat).
  assert.equal(dayOfWeek(find(holidays, 'rosh-hashanah').startDate), 6);
  // "Lo ADU Rosh": Rosh Hashanah never falls on Sunday, Wednesday, or Friday.
  assert.equal([0, 3, 5].includes(dayOfWeek(find(holidays, 'rosh-hashanah').startDate)), false);
  // First seder night (eve of 15 Nisan) can never be a Thursday start-day…
  // simpler invariant: Yom Kippur (10 Tishrei) is exactly 9 days after 1 Tishrei.
  assert.equal(
    find(holidays, 'yom-kippur').startDate,
    addDays(find(holidays, 'rosh-hashanah').startDate, 9)
  );
  // And Intl agrees the start days really are the right Hebrew dates.
  assert.equal(hebrewDateOf(find(holidays, 'sukkot').startDate).day, 15);
  assert.equal(hebrewDateOf(find(holidays, 'sukkot').startDate).monthName, 'Tishri');
});

test('holidays carry all three native names and a Hebrew date label', () => {
  const holidays = upcomingHolidays('2026-09-01', 13);
  for (const holiday of holidays) {
    assert.equal(typeof holiday.names.he, 'string');
    assert.notEqual(holiday.names.he, '');
    assert.notEqual(holiday.names.en, '');
    assert.notEqual(holiday.names.fr, '');
    assert.equal(typeof holiday.hebrewDateLabel, 'string');
    assert.notEqual(holiday.hebrewDateLabel, '');
  }
  const chanukah = find(holidays, 'chanukah');
  assert.equal(chanukah.names.en, 'Chanukah');
  assert.equal(chanukah.names.fr, "'Hanoucca");
  const pesach = find(holidays, 'pesach');
  assert.equal(pesach.names.en, 'Passover');
  assert.equal(pesach.names.fr, 'Pessah');
  // American Jewish English / French Jewish register — never a weekday word.
  for (const holiday of holidays) {
    assert.doesNotMatch(holiday.names.en, /Saturday/i);
    assert.doesNotMatch(holiday.names.fr, /samedi/i);
  }
});

test('a holiday already in progress is included with its true start date', () => {
  const holidays = upcomingHolidays('2026-12-08', 13); // mid-Chanukah
  const chanukah = find(holidays, 'chanukah');
  assert.equal(chanukah.startDate, '2026-12-05');
  assert.equal(chanukah.endDate, '2026-12-12');
  // But a holiday fully over is not resurrected.
  const later = upcomingHolidays('2026-12-13', 13);
  assert.notEqual(find(later, 'chanukah').startDate, '2026-12-05');
});

test('results are sorted by start date and stay within the window', () => {
  const holidays = upcomingHolidays('2026-09-01', 13);
  assert.equal(holidays.length >= 9, true);
  for (let index = 1; index < holidays.length; index += 1) {
    assert.equal(holidays[index - 1].startDate <= holidays[index].startDate, true);
  }
  for (const holiday of holidays) {
    assert.equal(holiday.startDate <= '2027-10-01', true);
    assert.equal(holiday.endDate >= '2026-09-01', true);
    assert.equal(HOLIDAY_KEYS.includes(holiday.key), true);
    assert.equal(holiday.eveDate, addDays(holiday.startDate, -1));
  }
});

test('dubaiDayString reflects the Asia/Dubai calendar day', () => {
  // 22:30 UTC is already the next day in Dubai (UTC+4).
  assert.equal(dubaiDayString(new Date('2026-09-11T22:30:00Z')), '2026-09-12');
  assert.equal(dubaiDayString(new Date('2026-09-11T12:00:00Z')), '2026-09-11');
});
