import { describe, expect, it } from 'vitest'
import { isDateClosed } from './calendar.ts'

describe('isDateClosed', () => {
  it('returns true when the exact date is in the closed list', () => {
    expect(isDateClosed('2026-08-20', ['2026-08-19', '2026-08-20'])).toBe(true)
  })

  it('returns false when the date is not in the list', () => {
    expect(isDateClosed('2026-08-21', ['2026-08-19', '2026-08-20'])).toBe(false)
  })

  it('returns false for malformed dates even if a matching string exists', () => {
    expect(isDateClosed('20/08/2026', ['20/08/2026'])).toBe(false)
  })

  it('returns false when the closed list is missing or empty', () => {
    expect(isDateClosed('2026-08-20', undefined)).toBe(false)
    expect(isDateClosed('2026-08-20', [])).toBe(false)
  })

  it('ignores non-string entries in the closed list', () => {
    expect(isDateClosed('2026-08-20', [20260820 as unknown as string, null as unknown as string, '2026-08-20'])).toBe(true)
  })
})
