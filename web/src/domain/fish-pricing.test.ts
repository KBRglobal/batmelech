import { describe, expect, it } from 'vitest'
import {
  CHRAIME_FILLET_NAME,
  EXTRA_FILLET_UNIT_PRICE_MINOR_UNITS,
  FISH_CAKE_PORTION_NAME,
  MOROCCAN_FILLET_NAME,
  calculateFishPricing,
} from './fish-pricing.ts'
import { getUsdMinorUnits } from './money.ts'

describe('calculateFishPricing', () => {
  it.each([
    {
      name: 'includes a mixed fillet pair with one couple meal',
      coupleMeals: 1,
      quantities: { [MOROCCAN_FILLET_NAME]: 1, [CHRAIME_FILLET_NAME]: 1 },
      expected: { selectedUnits: 2, includedUnits: 2, extraUnits: 0, surchargeMinorUnits: 0 },
    },
    {
      name: 'includes two fillets of the same kind with one couple meal',
      coupleMeals: 1,
      quantities: { [MOROCCAN_FILLET_NAME]: 2 },
      expected: { selectedUnits: 2, includedUnits: 2, extraUnits: 0, surchargeMinorUnits: 0 },
    },
    {
      name: 'charges for a third fillet with one couple meal',
      coupleMeals: 1,
      quantities: { [MOROCCAN_FILLET_NAME]: 2, [CHRAIME_FILLET_NAME]: 1 },
      expected: { selectedUnits: 3, includedUnits: 2, extraUnits: 1, surchargeMinorUnits: 3_000 },
    },
    {
      name: 'includes four fillets with two couple meals',
      coupleMeals: 2,
      quantities: { [MOROCCAN_FILLET_NAME]: 2, [CHRAIME_FILLET_NAME]: 2 },
      expected: { selectedUnits: 4, includedUnits: 4, extraUnits: 0, surchargeMinorUnits: 0 },
    },
    {
      name: 'charges for a fifth fillet with two couple meals',
      coupleMeals: 2,
      quantities: { [MOROCCAN_FILLET_NAME]: 3, [CHRAIME_FILLET_NAME]: 2 },
      expected: { selectedUnits: 5, includedUnits: 4, extraUnits: 1, surchargeMinorUnits: 3_000 },
    },
    {
      name: 'charges for one standalone fillet',
      coupleMeals: 0,
      quantities: { [MOROCCAN_FILLET_NAME]: 1 },
      expected: { selectedUnits: 1, includedUnits: 0, extraUnits: 1, surchargeMinorUnits: 3_000 },
    },
    {
      name: 'charges for two standalone fillets',
      coupleMeals: 0,
      quantities: { [CHRAIME_FILLET_NAME]: 2 },
      expected: { selectedUnits: 2, includedUnits: 0, extraUnits: 2, surchargeMinorUnits: 6_000 },
    },
    {
      name: 'treats one fish-cake portion as one included couple-meal equivalent',
      coupleMeals: 1,
      quantities: { [FISH_CAKE_PORTION_NAME]: 1 },
      expected: { selectedUnits: 2, includedUnits: 2, extraUnits: 0, surchargeMinorUnits: 0 },
    },
    {
      name: 'charges one extra unit for a fish-cake portion plus a fillet',
      coupleMeals: 1,
      quantities: { [FISH_CAKE_PORTION_NAME]: 1, [MOROCCAN_FILLET_NAME]: 1 },
      expected: { selectedUnits: 3, includedUnits: 2, extraUnits: 1, surchargeMinorUnits: 3_000 },
    },
    {
      name: 'charges two units for a standalone fish-cake portion',
      coupleMeals: 0,
      quantities: { [FISH_CAKE_PORTION_NAME]: 1 },
      expected: { selectedUnits: 2, includedUnits: 0, extraUnits: 2, surchargeMinorUnits: 6_000 },
    },
  ])('$name', ({ coupleMeals, quantities, expected }) => {
    const result = calculateFishPricing({ coupleMeals, quantities })

    expect(result).toEqual(expect.objectContaining(expected))
    expect(result.surchargeMinorUnits).toBe(expected.extraUnits * EXTRA_FILLET_UNIT_PRICE_MINOR_UNITS)
    expect(getUsdMinorUnits(result.surchargeMoney)).toBe(result.surchargeMinorUnits)
    expect(result).not.toHaveProperty('surcharge')
  })

  it.each([
    { coupleMeals: -1, quantities: {} },
    { coupleMeals: 1.5, quantities: {} },
    { coupleMeals: '1', quantities: {} },
    { coupleMeals: Number.POSITIVE_INFINITY, quantities: {} },
    { coupleMeals: 1, quantities: { [MOROCCAN_FILLET_NAME]: -1 } },
    { coupleMeals: 1, quantities: { [CHRAIME_FILLET_NAME]: 1.5 } },
    { coupleMeals: 1, quantities: { [FISH_CAKE_PORTION_NAME]: '1' } },
    { coupleMeals: 1, quantities: { [MOROCCAN_FILLET_NAME]: undefined } },
    { coupleMeals: 1, quantities: { [MOROCCAN_FILLET_NAME]: Number.MAX_SAFE_INTEGER + 1 } },
  ])('rejects invalid quantities instead of silently undercharging: %j', (input) => {
    expect(() => calculateFishPricing(input)).toThrow(RangeError)
  })

  it.each([
    { name: 'null', quantities: null },
    { name: 'array', quantities: [] },
    { name: 'date', quantities: new Date(0) },
    { name: 'map', quantities: new Map() },
    { name: 'custom prototype', quantities: Object.create({ inherited: true }) },
  ])('rejects a malformed $name quantity map', ({ quantities }) => {
    expect(() => calculateFishPricing({ coupleMeals: 1, quantities })).toThrow(TypeError)
  })

  it('accepts a null-prototype quantity record', () => {
    const quantities = Object.assign(Object.create(null) as Record<string, unknown>, {
      [MOROCCAN_FILLET_NAME]: 1,
    })

    expect(calculateFishPricing({ coupleMeals: 0, quantities })).toEqual(
      expect.objectContaining({ selectedUnits: 1, extraUnits: 1, surchargeMinorUnits: 3_000 }),
    )
  })

  it('does not mutate the input or its quantity map', () => {
    const quantities = Object.freeze({
      [MOROCCAN_FILLET_NAME]: 1,
      [CHRAIME_FILLET_NAME]: 1,
      [FISH_CAKE_PORTION_NAME]: 1,
    })
    const input = Object.freeze({ coupleMeals: 1, quantities })
    const snapshot = { ...quantities }

    expect(calculateFishPricing(input)).toEqual(
      expect.objectContaining({
        selectedUnits: 4,
        includedUnits: 2,
        extraUnits: 2,
        surchargeMinorUnits: 6_000,
      }),
    )
    expect(input.quantities).toBe(quantities)
    expect(quantities).toEqual(snapshot)
  })

  it('supports the largest safely priced extra-unit count and rejects the next one', () => {
    const largestSafelyPricedUnitCount = Math.floor(
      Number.MAX_SAFE_INTEGER / EXTRA_FILLET_UNIT_PRICE_MINOR_UNITS,
    )

    expect(
      calculateFishPricing({
        coupleMeals: 0,
        quantities: { [MOROCCAN_FILLET_NAME]: largestSafelyPricedUnitCount },
      }).surchargeMinorUnits,
    ).toBe(largestSafelyPricedUnitCount * EXTRA_FILLET_UNIT_PRICE_MINOR_UNITS)
    expect(() =>
      calculateFishPricing({
        coupleMeals: 0,
        quantities: { [MOROCCAN_FILLET_NAME]: largestSafelyPricedUnitCount + 1 },
      }),
    ).toThrow(RangeError)
  })

  it('rejects count aggregation and allowance overflow', () => {
    expect(() =>
      calculateFishPricing({
        coupleMeals: 0,
        quantities: {
          [MOROCCAN_FILLET_NAME]: Number.MAX_SAFE_INTEGER,
          [CHRAIME_FILLET_NAME]: 1,
        },
      }),
    ).toThrow(RangeError)
    expect(() =>
      calculateFishPricing({
        coupleMeals: Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1,
        quantities: {},
      }),
    ).toThrow(RangeError)
  })
})
