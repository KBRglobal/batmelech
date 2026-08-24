import { HebrewCalendar, Location } from '@hebcal/core'

/**
 * The coming Shabbat, the way the flyer states it: the parasha name and the
 * Dubai candle-lighting time. Mirrors the server's calendar choices
 * (server/shabbat-calendar.js): Dubai coordinates, 18 minutes before sunset,
 * and the ISRAELI reading cycle because the clientele is Israeli.
 */
export interface FlyerShabbat {
  readonly parasha: string | null
  /** HH:MM in Dubai local time, or null if the calendar gave nothing. */
  readonly candleLighting: string | null
}

const DUBAI_TIMEZONE = 'Asia/Dubai'
const DUBAI = new Location(25.2048, 55.2708, false, DUBAI_TIMEZONE, 'Dubai', 'AE')

export function upcomingShabbat(now: Date = new Date()): FlyerShabbat {
  try {
    const end = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000)
    const events = HebrewCalendar.calendar({
      location: DUBAI,
      start: now,
      end,
      candlelighting: true,
      sedrot: true,
      il: true,
      locale: 'he-x-NoNikud',
    })

    let parasha: string | null = null
    let candleLighting: string | null = null
    for (const event of events) {
      const desc = event.getDesc()
      if (parasha === null && desc.startsWith('Parashat')) {
        parasha = event.render('he-x-NoNikud')
      }
      if (candleLighting === null && desc.startsWith('Candle lighting')) {
        const eventDate = (event as { eventTime?: Date }).eventTime
        if (eventDate instanceof Date) {
          candleLighting = eventDate.toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: DUBAI_TIMEZONE,
          })
        }
      }
      if (parasha !== null && candleLighting !== null) break
    }
    return { parasha, candleLighting }
  } catch {
    // A flyer without the calendar line beats no flyer.
    return { parasha: null, candleLighting: null }
  }
}
