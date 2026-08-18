import { describe, expect, it } from 'vitest'
import { digitsOnlyPhone, isPhoneBlocked } from './customers.ts'
import type { LegacyStore } from './store.ts'

function storeWithBlocked(blockedPhones: string[] | undefined): LegacyStore {
  return {
    orders: [],
    settings: blockedPhones === undefined ? undefined : { blockedPhones },
  }
}

describe('digitsOnlyPhone', () => {
  it('removes every non-digit character', () => {
    expect(digitsOnlyPhone('+972 50 123 4567')).toBe('972501234567')
    expect(digitsOnlyPhone('050-123-4567')).toBe('0501234567')
    expect(digitsOnlyPhone('0501234567')).toBe('0501234567')
  })

  it('returns an empty string for input without digits', () => {
    expect(digitsOnlyPhone('abc')).toBe('')
    expect(digitsOnlyPhone('')).toBe('')
  })
})

describe('isPhoneBlocked', () => {
  it('returns false when settings or blockedPhones are missing', () => {
    expect(isPhoneBlocked('0501234567', { orders: [] })).toBe(false)
    expect(isPhoneBlocked('0501234567', storeWithBlocked(undefined))).toBe(false)
  })

  it('matches a blocked phone regardless of formatting', () => {
    const store = storeWithBlocked(['050-123-4567'])
    expect(isPhoneBlocked('050 123 4567', store)).toBe(true)
    expect(isPhoneBlocked('0501234567', store)).toBe(true)
  })

  it('does not match a different phone number', () => {
    const store = storeWithBlocked(['0501234567'])
    expect(isPhoneBlocked('0501234568', store)).toBe(false)
    expect(isPhoneBlocked('050123456', store)).toBe(false)
  })

  it('checks every entry in the blocked list', () => {
    const store = storeWithBlocked(['+971500000000', '0501234567'])
    expect(isPhoneBlocked('0501234567', store)).toBe(true)
    expect(isPhoneBlocked('+971500000000', store)).toBe(true)
    expect(isPhoneBlocked('+972501234567', store)).toBe(false)
  })

  it('returns false for an empty phone number', () => {
    expect(isPhoneBlocked('', storeWithBlocked(['0501234567']))).toBe(false)
  })
})
