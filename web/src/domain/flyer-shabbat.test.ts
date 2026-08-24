import { describe, expect, it } from 'vitest'
import { upcomingShabbat } from './flyer-shabbat.ts'

describe('upcomingShabbat', () => {
  // A fixed mid-week moment: Wednesday 2026-08-26 12:00 Dubai (08:00 UTC).
  const wednesday = new Date('2026-08-26T08:00:00Z')

  it('names the coming parasha in Hebrew', () => {
    const result = upcomingShabbat(wednesday)
    expect(result.parasha).not.toBeNull()
    expect(result.parasha).toMatch(/פרשת/)
  })

  it('gives a Dubai candle-lighting time as HH:MM', () => {
    const result = upcomingShabbat(wednesday)
    expect(result.candleLighting).toMatch(/^\d{2}:\d{2}$/)
  })

  it('is stable for the same instant', () => {
    expect(upcomingShabbat(wednesday)).toEqual(upcomingShabbat(wednesday))
  })
})
