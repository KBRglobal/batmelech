import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { getUsdMinorUnits } from './money.ts'
import {
  EXTRA_SALAD_BLOCK_PRICE_MINOR_UNITS,
  EXTRA_SALAD_BLOCK_SIZE,
  EXTRA_SALAD_SINGLE_PRICE_MINOR_UNITS,
  INCLUDED_SALADS_PER_COUPLE_MEAL,
  calculateSaladPricing,
} from './salad-pricing.ts'

describe('calculateSaladPricing', () => {
  it.each([
    { orderedSalads: 4, expectedExtra: 0, expectedMinorUnits: 0 },
    { orderedSalads: 5, expectedExtra: 1, expectedMinorUnits: 700 },
    { orderedSalads: 6, expectedExtra: 2, expectedMinorUnits: 1_400 },
    { orderedSalads: 7, expectedExtra: 3, expectedMinorUnits: 2_100 },
    { orderedSalads: 8, expectedExtra: 4, expectedMinorUnits: 2_500 },
    { orderedSalads: 9, expectedExtra: 5, expectedMinorUnits: 3_200 },
  ])(
    'prices the client example of $orderedSalads salads with one couple meal',
    ({ orderedSalads, expectedExtra, expectedMinorUnits }) => {
      const result = calculateSaladPricing({ coupleMeals: 1, orderedSalads })

      expect(result).toEqual(
        expect.objectContaining({
          orderedSalads,
          giftSalads: 0,
          totalPreparedSalads: orderedSalads,
          allowanceSalads: 4,
          includedSalads: 4,
          extraSalads: expectedExtra,
          extraBlocks: Math.floor(expectedExtra / 4),
          extraSingles: expectedExtra % 4,
          surchargeMinorUnits: expectedMinorUnits,
        }),
      )
      expect(getUsdMinorUnits(result.surchargeMoney)).toBe(expectedMinorUnits)
      expect(result).not.toHaveProperty('surcharge')
    },
  )

  it('starts charging only at the ninth salad for two couple meals', () => {
    expect(calculateSaladPricing({ coupleMeals: 2, orderedSalads: 8 })).toEqual(
      expect.objectContaining({ allowanceSalads: 8, extraSalads: 0, surchargeMinorUnits: 0 }),
    )
    expect(calculateSaladPricing({ coupleMeals: 2, orderedSalads: 9 })).toEqual(
      expect.objectContaining({ allowanceSalads: 8, extraSalads: 1, surchargeMinorUnits: 700 }),
    )
  })

  it('charges standalone salads in blocks of four and then singles', () => {
    expect(calculateSaladPricing({ coupleMeals: 0, orderedSalads: 4 })).toEqual(
      expect.objectContaining({ extraBlocks: 1, extraSingles: 0, surchargeMinorUnits: 2_500 }),
    )
    expect(calculateSaladPricing({ coupleMeals: 0, orderedSalads: 5 })).toEqual(
      expect.objectContaining({ extraBlocks: 1, extraSingles: 1, surchargeMinorUnits: 3_200 }),
    )
  })

  it('prepares gift salads but excludes them from allowance usage and charging', () => {
    const withoutGifts = calculateSaladPricing({ coupleMeals: 1, orderedSalads: 5 })
    const withGifts = calculateSaladPricing({
      coupleMeals: 1,
      orderedSalads: 5,
      giftSalads: 4,
    })

    expect(withGifts.totalPreparedSalads).toBe(9)
    expect(withGifts.giftSalads).toBe(4)
    expect(withGifts.extraSalads).toBe(withoutGifts.extraSalads)
    expect(withGifts.surchargeMinorUnits).toBe(withoutGifts.surchargeMinorUnits)
  })

  it.each([
    { coupleMeals: -1, orderedSalads: 0 },
    { coupleMeals: 1.5, orderedSalads: 0 },
    { coupleMeals: '1', orderedSalads: 0 },
    { coupleMeals: 1, orderedSalads: -1 },
    { coupleMeals: 1, orderedSalads: Number.NaN },
    { coupleMeals: 1, orderedSalads: Number.MAX_SAFE_INTEGER + 1 },
    { coupleMeals: 1, orderedSalads: 4, giftSalads: '1' },
  ])('rejects invalid counts instead of silently changing the price: %j', (input) => {
    expect(() => calculateSaladPricing(input)).toThrow(RangeError)
  })

  it('rejects prepared-count, allowance, and surcharge overflow', () => {
    expect(() =>
      calculateSaladPricing({
        coupleMeals: 0,
        orderedSalads: Number.MAX_SAFE_INTEGER,
        giftSalads: 1,
      }),
    ).toThrow(RangeError)
    expect(() =>
      calculateSaladPricing({
        coupleMeals: Math.floor(Number.MAX_SAFE_INTEGER / INCLUDED_SALADS_PER_COUPLE_MEAL) + 1,
        orderedSalads: 0,
      }),
    ).toThrow(RangeError)

    const maximumBlocks = Math.floor(
      Number.MAX_SAFE_INTEGER / EXTRA_SALAD_BLOCK_PRICE_MINOR_UNITS,
    )
    const blockCharge = maximumBlocks * EXTRA_SALAD_BLOCK_PRICE_MINOR_UNITS
    const maximumSingles = Math.min(
      EXTRA_SALAD_BLOCK_SIZE - 1,
      Math.floor(
        (Number.MAX_SAFE_INTEGER - blockCharge) / EXTRA_SALAD_SINGLE_PRICE_MINOR_UNITS,
      ),
    )
    const largestSafelyPricedSaladCount =
      maximumBlocks * EXTRA_SALAD_BLOCK_SIZE + maximumSingles

    expect(
      calculateSaladPricing({ coupleMeals: 0, orderedSalads: largestSafelyPricedSaladCount })
        .surchargeMinorUnits,
    ).toBe(
      blockCharge + maximumSingles * EXTRA_SALAD_SINGLE_PRICE_MINOR_UNITS,
    )
    expect(() =>
      calculateSaladPricing({
        coupleMeals: 0,
        orderedSalads: largestSafelyPricedSaladCount + 1,
      }),
    ).toThrow(RangeError)
  })
})

describe('salad pricing properties', () => {
  const boundedCount = fc.integer({ min: 0, max: 1_000_000 })

  it('matches the exact block-and-single formula and never mutates input', () => {
    fc.assert(
      fc.property(boundedCount, boundedCount, boundedCount, (coupleMeals, orderedSalads, giftSalads) => {
        const input = Object.freeze({ coupleMeals, orderedSalads, giftSalads })
        const snapshot = { ...input }
        const result = calculateSaladPricing(input)
        const allowance = coupleMeals * INCLUDED_SALADS_PER_COUPLE_MEAL
        const extra = Math.max(0, orderedSalads - allowance)
        const blocks = Math.floor(extra / EXTRA_SALAD_BLOCK_SIZE)
        const singles = extra % EXTRA_SALAD_BLOCK_SIZE
        const expectedMinorUnits =
          blocks * EXTRA_SALAD_BLOCK_PRICE_MINOR_UNITS +
          singles * EXTRA_SALAD_SINGLE_PRICE_MINOR_UNITS

        expect(result.allowanceSalads).toBe(allowance)
        expect(result.includedSalads).toBe(Math.min(orderedSalads, allowance))
        expect(result.extraSalads).toBe(extra)
        expect(result.extraBlocks).toBe(blocks)
        expect(result.extraSingles).toBe(singles)
        expect(result.surchargeMinorUnits).toBe(expectedMinorUnits)
        expect(getUsdMinorUnits(result.surchargeMoney)).toBe(expectedMinorUnits)
        expect(result.totalPreparedSalads).toBe(orderedSalads + giftSalads)
        expect(input).toEqual(snapshot)
      }),
    )
  })

  it('never changes the price when only gifts change', () => {
    fc.assert(
      fc.property(boundedCount, boundedCount, boundedCount, (coupleMeals, orderedSalads, gifts) => {
        const withoutGifts = calculateSaladPricing({ coupleMeals, orderedSalads, giftSalads: 0 })
        const withGifts = calculateSaladPricing({ coupleMeals, orderedSalads, giftSalads: gifts })

        expect(withGifts.surchargeMinorUnits).toBe(withoutGifts.surchargeMinorUnits)
        expect(withGifts.extraSalads).toBe(withoutGifts.extraSalads)
      }),
    )
  })

  it('never lowers the charge when one ordered salad is added', () => {
    fc.assert(
      fc.property(boundedCount, boundedCount, (coupleMeals, orderedSalads) => {
        const before = calculateSaladPricing({ coupleMeals, orderedSalads })
        const after = calculateSaladPricing({ coupleMeals, orderedSalads: orderedSalads + 1 })

        expect(after.surchargeMinorUnits).toBeGreaterThanOrEqual(before.surchargeMinorUnits)
        expect([0, 400, EXTRA_SALAD_SINGLE_PRICE_MINOR_UNITS]).toContain(
          after.surchargeMinorUnits - before.surchargeMinorUnits,
        )
      }),
    )
  })
})
