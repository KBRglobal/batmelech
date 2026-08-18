'use strict';

// Pure Hebrew-calendar computation — no dependencies, no network, no state.
// Uses the Intl built-in hebrew calendar to map Gregorian days (as observed
// in Asia/Dubai) to Hebrew dates, then finds the known holidays by their
// fixed Hebrew date. Empirically, Node's ICU emits Hebrew month NAMES
// ("Tishri", "Adar", "Adar I", "Adar II", ...) even when 'numeric' is
// requested, so holidays are keyed by month name — this also sidesteps the
// regular-vs-leap-year month numbering question entirely.

const DUBAI_UTC_OFFSET = '+04:00'; // fixed, the UAE has no DST
const MILLISECONDS_PER_DAY = 86_400_000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Formatting a Date pinned to noon Dubai time guarantees the formatter sees
// the intended calendar day whatever the process timezone is.
const hebrewFormatter = new Intl.DateTimeFormat('en-u-ca-hebrew-nu-latn', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'Asia/Dubai',
});

const hebrewLabelFormatter = new Intl.DateTimeFormat('he-u-ca-hebrew', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Dubai',
});

const dubaiDayFormatter = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Dubai',
});

// Diaspora observance (Dubai's community keeps two festival days).
const HOLIDAY_DEFINITIONS = [
  {
    key: 'rosh-hashanah',
    months: ['Tishri'],
    startDay: 1,
    lengthDays: 2,
    names: { he: 'ראש השנה', en: 'Rosh Hashanah', fr: 'Roch Hachana' },
  },
  {
    key: 'yom-kippur',
    months: ['Tishri'],
    startDay: 10,
    lengthDays: 1,
    names: { he: 'יום כיפור', en: 'Yom Kippur', fr: 'Yom Kippour' },
  },
  {
    key: 'sukkot',
    months: ['Tishri'],
    startDay: 15,
    lengthDays: 7,
    names: { he: 'סוכות', en: 'Sukkot', fr: 'Souccot' },
  },
  {
    key: 'shmini-atzeret',
    months: ['Tishri'],
    startDay: 22,
    lengthDays: 2, // Shmini Atzeret + Simchat Torah in the diaspora
    names: { he: 'שמיני עצרת ושמחת תורה', en: 'Shmini Atzeret & Simchat Torah', fr: "Chemini Atseret et Sim'hat Torah" },
  },
  {
    key: 'chanukah',
    months: ['Kislev'],
    startDay: 25,
    lengthDays: 8,
    names: { he: 'חנוכה', en: 'Chanukah', fr: "'Hanoucca" },
  },
  {
    key: 'tu-bishvat',
    months: ['Shevat'],
    startDay: 15,
    lengthDays: 1,
    names: { he: 'ט"ו בשבט', en: 'Tu BiShvat', fr: 'Tou Bichvat' },
  },
  {
    // 14 Adar in a regular year, 14 Adar II in a leap year — Intl names the
    // single regular-year month plain "Adar", so matching both names is exact.
    key: 'purim',
    months: ['Adar', 'Adar II'],
    startDay: 14,
    lengthDays: 1,
    names: { he: 'פורים', en: 'Purim', fr: 'Pourim' },
  },
  {
    key: 'pesach',
    months: ['Nisan'],
    startDay: 15,
    lengthDays: 8,
    names: { he: 'פסח', en: 'Passover', fr: 'Pessah' },
  },
  {
    key: 'shavuot',
    months: ['Sivan'],
    startDay: 6,
    lengthDays: 2,
    names: { he: 'שבועות', en: 'Shavuot', fr: 'Chavouot' },
  },
];

const HOLIDAY_KEYS = HOLIDAY_DEFINITIONS.map((definition) => definition.key);

function noonDubai(dayString) {
  return new Date(`${dayString}T12:00:00${DUBAI_UTC_OFFSET}`);
}

/** The calendar day (YYYY-MM-DD) currently observed in Dubai for a Date. */
function dubaiDayString(date = new Date()) {
  return dubaiDayFormatter.format(date);
}

function addDays(dayString, days) {
  const base = Date.parse(`${dayString}T00:00:00Z`);
  return new Date(base + days * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
}

/** Hebrew date of a Gregorian calendar day: { day, monthName, year }. */
function hebrewDateOf(dayString) {
  const parts = hebrewFormatter.formatToParts(noonDubai(dayString));
  const byType = {};
  for (const part of parts) byType[part.type] = part.value;
  return {
    day: Number(byType.day),
    monthName: byType.month,
    year: Number(byType.year),
  };
}

function hebrewDateLabel(dayString) {
  return hebrewLabelFormatter.format(noonDubai(dayString));
}

function addMonthsToDay(dayString, months) {
  const [year, month, day] = dayString.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + months, day)).toISOString().slice(0, 10);
}

/**
 * All holidays whose last day falls on or after `fromDate` (Dubai calendar
 * day), starting within the next `months` Gregorian months. A holiday already
 * in progress on `fromDate` is included with its true (past) startDate.
 *
 * @param {Date|string} fromDate a Date, or a YYYY-MM-DD Dubai day string
 * @returns {Array<{key, startDate, endDate, eveDate, hebrewDateLabel, names}>}
 */
function upcomingHolidays(fromDate = new Date(), months = 13) {
  const from = typeof fromDate === 'string' ? fromDate : dubaiDayString(fromDate);
  if (!DAY_PATTERN.test(from)) throw new RangeError('fromDate must be a Date or a YYYY-MM-DD string');
  const monthCount = Number.isInteger(months) && months >= 1 && months <= 24 ? months : 13;
  const lastStart = addMonthsToDay(from, monthCount);

  // Back up past the longest holiday so one in progress today is still found.
  const longest = Math.max(...HOLIDAY_DEFINITIONS.map((definition) => definition.lengthDays));
  const scanStart = addDays(from, -(longest - 1));
  const totalDays = Math.min(
    Math.round((Date.parse(`${lastStart}T00:00:00Z`) - Date.parse(`${scanStart}T00:00:00Z`)) / MILLISECONDS_PER_DAY),
    800
  );

  const holidays = [];
  for (let offset = 0; offset <= totalDays; offset += 1) {
    const day = addDays(scanStart, offset);
    const hebrew = hebrewDateOf(day);
    for (const definition of HOLIDAY_DEFINITIONS) {
      if (hebrew.day !== definition.startDay || !definition.months.includes(hebrew.monthName)) continue;
      const endDate = addDays(day, definition.lengthDays - 1);
      if (endDate < from) continue; // already fully over
      holidays.push({
        key: definition.key,
        startDate: day,
        endDate,
        eveDate: addDays(day, -1),
        hebrewDateLabel: hebrewDateLabel(day),
        names: { ...definition.names },
      });
    }
  }
  return holidays;
}

module.exports = {
  HOLIDAY_KEYS,
  dubaiDayString,
  addDays,
  hebrewDateOf,
  upcomingHolidays,
};
