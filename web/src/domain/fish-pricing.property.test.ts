import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  CHRAIME_FILLET_NAME,
  EXTRA_FILLET_UNIT_PRICE_MINOR_UNITS,
  FISH_CAKE_PORTION_NAME,
  FILLET_UNITS_PER_COUPLE_MEAL,
  MOROCCAN_FILLET_NAME,
  calculateFishPricing,
} from './fish-pricing.ts'
import { getUsdMinorUnits } from './money.ts'

const boundedCount = fc.integer({ min: 0, max: 1_000_000 })

describe('fish pricing properties', () => {
  it('matches the exact allowance and price formula for all bounded safe counts', () => {
    fc.assert(
      fc.property(
        boundedCount,
        boundedCount,
        boundedCount,
        boundedCount,
        (coupleMeals, moroccan, chraime, fishCakePortions) => {
          const quantities = Object.freeze({
            [MOROCCAN_FILLET_NAME]: moroccan,
            [CHRAIME_FILLET_NAME]: chraime,
            [FISH_CAKE_PORTION_NAME]: fishCakePortions,
          })
          const input = Object.freeze({ coupleMeals, quantities })
          const snapshot = { ...quantities }
          const result = calculateFishPricing(input)
          const expectedSelected =
            moroccan + chraime + fishCakePortions * FILLET_UNITS_PER_COUPLE_MEAL
          const expectedIncluded = coupleMeals * FILLET_UNITS_PER_COUPLE_MEAL
          const expectedExtra = Math.max(0, expectedSelected - expectedIncluded)
          const expectedMinorUnits = expectedExtra * EXTRA_FILLET_UNIT_PRICE_MINOR_UNITS

          expect(result.selectedUnits).toBe(expectedSelected)
          expect(result.includedUnits).toBe(expectedIncluded)
          expect(result.extraUnits).toBe(expectedExtra)
          expect(result.surchargeMinorUnits).toBe(expectedMinorUnits)
          expect(getUsdMinorUnits(result.surchargeMoney)).toBe(expectedMinorUnits)
          expect(input.quantities).toBe(quantities)
          expect(quantities).toEqual(snapshot)
        },
      ),
    )
  })

  it('never lowers the charge when one selected fillet is added', () => {
    fc.assert(
      fc.property(
        boundedCount,
        boundedCount,
        boundedCount,
        boundedCount,
        (coupleMeals, moroccan, chraime, fishCakePortions) => {
          const before = calculateFishPricing({
            coupleMeals,
            quantities: {
              [MOROCCAN_FILLET_NAME]: moroccan,
              [CHRAIME_FILLET_NAME]: chraime,
              [FISH_CAKE_PORTION_NAME]: fishCakePortions,
            },
          })
          const after = calculateFishPricing({
            coupleMeals,
            quantities: {
              [MOROCCAN_FILLET_NAME]: moroccan + 1,
              [CHRAIME_FILLET_NAME]: chraime,
              [FISH_CAKE_PORTION_NAME]: fishCakePortions,
            },
          })

          expect(after.selectedUnits).toBe(before.selectedUnits + 1)
          expect(after.extraUnits).toBeGreaterThanOrEqual(before.extraUnits)
          expect(after.extraUnits - before.extraUnits).toBeLessThanOrEqual(1)
          expect(after.surchargeMinorUnits).toBeGreaterThanOrEqual(before.surchargeMinorUnits)
          expect([0, EXTRA_FILLET_UNIT_PRICE_MINOR_UNITS]).toContain(
            after.surchargeMinorUnits - before.surchargeMinorUnits,
          )
        },
      ),
    )
  })
})
