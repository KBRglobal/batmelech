import { describe, expect, it } from 'vitest'
import { buildFlyerHtml } from './flyer-print.ts'

const SHABBAT = { parasha: 'פרשת כי־תבוא', candleLighting: '18:31' }

describe('buildFlyerHtml', () => {
  it('carries the brand, the QR, and the shabbat line', () => {
    const html = buildFlyerHtml('https://batmelech.ae/', SHABBAT)
    expect(html).not.toBeNull()
    expect(html).toContain('מטעמי בת מלך')
    expect(html).toContain('פרשת כי־תבוא')
    expect(html).toContain('הדלקת נרות בדובאי: 18:31')
    expect(html).toContain('h1v1h-1z') // QR modules rendered inline
    expect(html).toContain('https://batmelech.ae/')
  })

  it('omits the shabbat line when the calendar gave nothing', () => {
    const html = buildFlyerHtml('https://batmelech.ae/', { parasha: null, candleLighting: null })
    expect(html).not.toBeNull()
    expect(html).not.toContain('class="shabbat"')
  })

  it('returns null for an impossible QR payload', () => {
    expect(buildFlyerHtml('x'.repeat(20_000), SHABBAT)).toBeNull()
  })
})
