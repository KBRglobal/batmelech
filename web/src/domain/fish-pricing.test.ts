import { describe, expect, it } from 'vitest'
import {
  CHRAIME_FILLET_NAME,
  FISH_CAKE_PORTION_NAME,
  MOROCCAN_FILLET_NAME,
  calculateFishPricing,
} from './fish-pricing.ts'

describe('calculateFishPricing', () => {
  it.each([
    {
      name: 'includes a mixed fillet pair with one couple meal',
      coupleMeals: 1,
      quantities: { [MOROCCAN_FILLET_NAME]: 1, [CHRAIME_FILLET_NAME]: 1 },
      expected: { selectedUnits: 2, includedUnits: 2, extraUnits: 0, surcharge: 0 },
    },
    {
      name: 'includes two fillets of the same kind with one couple meal',
      coupleMeals: 1,
      quantities: { [MOROCCAN_FILLET_NAME]: 2 },
      expected: { selectedUnits: 2, includedUnits: 2, extraUnits: 0, surcharge: 0 },
    },
    {
      name: 'charges for a third fillet with one couple meal',
      coupleMeals: 1,
      quantities: { [MOROCCAN_FILLET_NAME]: 2, [CHRAIME_FILLET_NAME]: 1 },
      expected: { selectedUnits: 3, includedUnits: 2, extraUnits: 1, surcharge: 30 },
    },
    {
      name: 'includes four fillets with two couple meals',
      coupleMeals: 2,
      quantities: { [MOROCCAN_FILLET_NAME]: 2, [CHRAIME_FILLET_NAME]: 2 },
      expected: { selectedUnits: 4, includedUnits: 4, extraUnits: 0, surcharge: 0 },
    },
    {
      name: 'charges for a fifth fillet with two couple meals',
      coupleMeals: 2,
      quantities: { [MOROCCAN_FILLET_NAME]: 3, [CHRAIME_FILLET_NAME]: 2 },
      expected: { selectedUnits: 5, includedUnits: 4, extraUnits: 1, surcharge: 30 },
    },
    {
      name: 'charges for one standalone fillet',
      coupleMeals: 0,
      quantities: { [MOROCCAN_FILLET_NAME]: 1 },
      expected: { selectedUnits: 1, includedUnits: 0, extraUnits: 1, surcharge: 30 },
    },
    {
      name: 'charges for two standalone fillets',
      coupleMeals: 0,
      quantities: { [CHRAIME_FILLET_NAME]: 2 },
      expected: { selectedUnits: 2, includedUnits: 0, extraUnits: 2, surcharge: 60 },
    },
    {
      name: 'treats one fish-cake portion as one included couple-meal equivalent',
      coupleMeals: 1,
      quantities: { [FISH_CAKE_PORTION_NAME]: 1 },
      expected: { selectedUnits: 2, includedUnits: 2, extraUnits: 0, surcharge: 0 },
    },
    {
      name: 'charges one extra unit for a fish-cake portion plus a fillet',
      coupleMeals: 1,
      quantities: { [FISH_CAKE_PORTION_NAME]: 1, [MOROCCAN_FILLET_NAME]: 1 },
      expected: { selectedUnits: 3, includedUnits: 2, extraUnits: 1, surcharge: 30 },
    },
    {
      name: 'charges two units for a standalone fish-cake portion',
      coupleMeals: 0,
      quantities: { [FISH_CAKE_PORTION_NAME]: 1 },
      expected: { selectedUnits: 2, includedUnits: 0, extraUnits: 2, surcharge: 60 },
    },
  ])('$name', ({ coupleMeals, quantities, expected }) => {
    expect(calculateFishPricing({ coupleMeals, quantities })).toEqual(expected)
  })

  it('treats invalid, negative, and non-finite quantities as zero', () => {
    expect(
      calculateFishPricing({
        coupleMeals: Number.NEGATIVE_INFINITY,
        quantities: {
          [MOROCCAN_FILLET_NAME]: -1,
          [CHRAIME_FILLET_NAME]: Number.POSITIVE_INFINITY,
          [FISH_CAKE_PORTION_NAME]: Number.NaN,
        },
      }),
    ).toEqual({ selectedUnits: 0, includedUnits: 0, extraUnits: 0, surcharge: 0 })

    expect(
      calculateFishPricing({
        coupleMeals: 1.5,
        quantities: {
          [MOROCCAN_FILLET_NAME]: 1.5,
        },
      }),
    ).toEqual({ selectedUnits: 0, includedUnits: 0, extraUnits: 0, surcharge: 0 })

    expect(
      calculateFishPricing({
        coupleMeals: '1',
        quantities: {
          [MOROCCAN_FILLET_NAME]: '2',
          [CHRAIME_FILLET_NAME]: null,
          [FISH_CAKE_PORTION_NAME]: undefined,
        },
      }),
    ).toEqual({ selectedUnits: 0, includedUnits: 0, extraUnits: 0, surcharge: 0 })
  })

  it('does not mutate the input or its quantity map', () => {
    const quantities = Object.freeze({
      [MOROCCAN_FILLET_NAME]: 1,
      [CHRAIME_FILLET_NAME]: 1,
      [FISH_CAKE_PORTION_NAME]: 1,
    })
    const input = Object.freeze({ coupleMeals: 1, quantities })
    const snapshot = { ...quantities }

    expect(calculateFishPricing(input)).toEqual({
      selectedUnits: 4,
      includedUnits: 2,
      extraUnits: 2,
      surcharge: 60,
    })
    expect(input.quantities).toBe(quantities)
    expect(quantities).toEqual(snapshot)
  })
})
