import { dinero } from 'dinero.js'
import { USD } from 'dinero.js/currencies'
import { describe, expect, it } from 'vitest'
import {
  checkedAdd,
  checkedMultiply,
  getUsdMinorUnits,
  requireNonNegativeSafeInteger,
  usdFromMinorUnits,
} from './money.ts'

describe('USD money boundary', () => {
  it('stores USD as integer minor units at the canonical scale', () => {
    const money = usdFromMinorUnits(3_007)

    expect(money.toJSON()).toEqual({
      amount: 3_007,
      currency: USD,
      scale: USD.exponent,
    })
    expect(getUsdMinorUnits(money)).toBe(3_007)
  })

  it('accepts the largest safe minor-unit amount', () => {
    expect(getUsdMinorUnits(usdFromMinorUnits(Number.MAX_SAFE_INTEGER))).toBe(
      Number.MAX_SAFE_INTEGER,
    )
  })

  it.each([
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    '30',
    null,
    undefined,
  ])('rejects invalid integer input %j', (value) => {
    expect(() => requireNonNegativeSafeInteger(value, 'test value')).toThrow(RangeError)
    expect(() => usdFromMinorUnits(value)).toThrow(RangeError)
  })

  it('rejects unsafe addition and multiplication before precision can be lost', () => {
    expect(() => checkedAdd(Number.MAX_SAFE_INTEGER, 1, 'test addition')).toThrow(RangeError)
    expect(() => checkedMultiply(Number.MAX_SAFE_INTEGER, 2, 'test multiplication')).toThrow(
      RangeError,
    )
  })

  it('rejects a non-canonical Dinero scale at the boundary', () => {
    const nonCanonical = dinero({ amount: 3_000, currency: USD, scale: 3 })

    expect(() => getUsdMinorUnits(nonCanonical)).toThrow(RangeError)
  })

  it.each([
    { name: 'base', currency: { ...USD, base: 2 } },
    { name: 'exponent', currency: { ...USD, exponent: 3 } },
  ])('rejects forged USD $name metadata at the boundary', ({ currency }) => {
    const forgedUsd = dinero({ amount: 3_000, currency, scale: USD.exponent })

    expect(() => getUsdMinorUnits(forgedUsd)).toThrow(RangeError)
  })
})
