'use strict';

// The customer site keeps Shabbat and yom tov by itself: this module answers
// "is the kitchen resting at this instant?" for any date, years ahead, with no
// network call and nothing for staff to remember to switch on or off.
//
// @hebcal/core does the Hebrew calendar and the astronomy. Two of its defaults
// are ours by adoption rather than by accident:
//   * a closure starts at candle lighting — 18 minutes before sunset in Dubai;
//   * a closure ends at havdalah — tzeit at 8.5 degrees below the horizon,
//     the "three small stars" reckoning.
// Holidays follow the ISRAELI schedule (one day of yom tov, Rosh Hashana
// excepted) because the clientele is Israeli, and chol hamoed and the minor
// holidays are working days, so the site stays open through them.

const {
  HebrewCalendar,
  Location,
  Locale,
  CandleLightingEvent,
  HavdalahEvent,
  flags,
} = require('@hebcal/core');

const DUBAI_TIMEZONE = 'Asia/Dubai';
// Dubai is outside Israel, so the location itself is built with israel=false;
// the Israeli holiday schedule is asked for per query instead.
const DUBAI = new Location(25.2048, 55.2708, false, DUBAI_TIMEZONE, 'Dubai', 'AE');
const ISRAEL_SCHEDULE = true;

// Wide enough that any closure covering `now` has both of its ends inside the
// window: the longest span the Israeli schedule can produce is three days —
// two days of Rosh Hashana running straight into Shabbat.
const WINDOW_DAYS_BEHIND = 5;
const WINDOW_DAYS_AHEAD = 14;

const SHABBAT_LABEL = 'שבת שלום';
const CHAG_LABEL = 'חג שמח';
// "חג שמח" is not what anyone says on these two, so they carry the greeting
// people actually use; every other chag takes the default with its name.
const CHAG_GREETINGS = new Map([
  ['Rosh Hashana', 'שנה טובה'],
  ['Yom Kippur', 'גמר חתימה טובה'],
]);

const OPEN = Object.freeze({ closed: false, label: null, reopensAt: null, occasion: null });

const CACHE_LIMIT = 8;
const spanCache = new Map();

function dubaiDateKey(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: DUBAI_TIMEZONE }).format(now);
}

// The window is anchored on the Dubai calendar date, never on the exact
// instant, so every call on the same date computes — and caches — one identical
// set of spans. Local-midnight Dates are what hebcal reads date parts off, so
// they stay correct whatever timezone the server itself runs in.
function windowFor(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return {
    start: new Date(year, month - 1, day - WINDOW_DAYS_BEHIND),
    end: new Date(year, month - 1, day + WINDOW_DAYS_AHEAD),
  };
}

function computeSpans(dateKey) {
  const { start, end } = windowFor(dateKey);
  const events = HebrewCalendar.calendar({
    start,
    end,
    location: DUBAI,
    candlelighting: true,
    il: ISRAEL_SCHEDULE,
    sedrot: false,
  });

  // Only these two classes bound a closure. Chanukah's nightly candles are a
  // TimedChanukahEvent and a fast's begin/end are a plain TimedEvent, so
  // Chanukah, Purim and the minor fasts leave the site open, as they should.
  const bounds = events
    .filter((event) => event instanceof CandleLightingEvent || event instanceof HavdalahEvent)
    .filter((event) => event.eventTime instanceof Date)
    .sort((a, b) => a.eventTime.getTime() - b.eventTime.getTime());

  const spans = [];
  let current = null;
  for (const event of bounds) {
    if (event instanceof CandleLightingEvent) {
      // A second candle lighting inside an open span is a chag rolling into
      // Shabbat, or day two of Rosh Hashana: it opens a new Hebrew day, not a
      // new closure, so the span keeps running and the days accumulate.
      if (current) {
        current.days.push(event);
      } else {
        current = { start: event.eventTime.getTime(), days: [event] };
      }
    } else if (current) {
      spans.push({ start: current.start, end: event.eventTime.getTime(), days: current.days });
      current = null;
    }
  }
  return spans;
}

function spansFor(now) {
  const dateKey = dubaiDateKey(now);
  const cached = spanCache.get(dateKey);
  if (cached) return cached;
  const spans = computeSpans(dateKey);
  spanCache.set(dateKey, spans);
  if (spanCache.size > CACHE_LIMIT) {
    spanCache.delete(spanCache.keys().next().value);
  }
  return spans;
}

// Each candle lighting opens exactly one Hebrew day, so the last one at or
// before `now` names the day being kept right now. That is what tells the
// Shabbat apart from the chag when the two run together.
function occasionAt(span, instant) {
  let currentDay = null;
  for (const event of span.days) {
    if (event.eventTime.getTime() <= instant) currentDay = event;
  }
  if (!currentDay) return { occasion: 'shabbat', label: SHABBAT_LABEL };

  const holidays = HebrewCalendar.getHolidaysOnDate(currentDay.getDate().next(), ISRAEL_SCHEDULE) || [];
  const chag = holidays.find((event) => (event.mask & flags.CHAG) && !(event.mask & flags.CHOL_HAMOED));
  if (!chag) return { occasion: 'shabbat', label: SHABBAT_LABEL };

  const name = chag.basename();
  const greeting = CHAG_GREETINGS.get(name);
  if (greeting) return { occasion: 'chag', label: greeting };

  const hebrewName = Locale.lookupTranslation(name, 'he-x-nonikud');
  return { occasion: 'chag', label: hebrewName ? `${CHAG_LABEL} — ${hebrewName}` : CHAG_LABEL };
}

/**
 * Whether the site is resting for Shabbat or a chag at `now`.
 *
 * Pure and deterministic: the same instant always produces the same answer,
 * on any server, in any timezone.
 *
 * @param {Date} [now]
 * @returns {{ closed: boolean, label: string|null, reopensAt: number|null, occasion: 'shabbat'|'chag'|null }}
 *   `reopensAt` is the havdalah instant in epoch milliseconds.
 */
function getShabbatOrChagStatus(now = new Date()) {
  const instant = now instanceof Date ? now.getTime() : NaN;
  if (!Number.isFinite(instant)) {
    throw new TypeError('getShabbatOrChagStatus needs a valid Date');
  }

  const span = spansFor(now).find((candidate) => instant >= candidate.start && instant < candidate.end);
  if (!span) return { ...OPEN };

  const { occasion, label } = occasionAt(span, instant);
  return { closed: true, label, reopensAt: span.end, occasion };
}

module.exports = { getShabbatOrChagStatus, DUBAI_TIMEZONE };
