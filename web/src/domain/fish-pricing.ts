import type { UsdMoney } from './money.ts'
import {
  checkedAdd,
  checkedMultiply,
  requireNonNegativeSafeInteger,
  usdFromMinorUnits,
} from './money.ts'

export const MOROCCAN_FILLET_NAME = 'פילה דג ברוטב מרוקאי'
export const CHRAIME_FILLET_NAME = 'פילה דג ברוטב חריימה'
export const FISH_CAKE_PORTION_NAME = 'קציצות דגים ברוטב מרוקאי'

export const FILLET_UNITS_PER_COUPLE_MEAL = 2
export const EXTRA_FILLET_UNIT_PRICE_MINOR_UNITS = 3_000

export interface FishPricingInput {
  readonly coupleMeals: unknown
  readonly quantities: unknown
}

export interface FishPricingResult {
  readonly selectedUnits: number
  readonly includedUnits: number
  readonly extraUnits: number
  readonly surchargeMinorUnits: number
  readonly surchargeMoney: UsdMoney
}

function quantityFor(itemName: string, quantities: Readonly<Record<string, unknown>>): number {
  if (!Object.hasOwn(quantities, itemName)) {
    return 0
  }

  return requireNonNegativeSafeInteger(quantities[itemName], itemName)
}

function requirePlainRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('quantities must be a plain record')
  }

  const prototype = Object.getPrototypeOf(value)

  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('quantities must be a plain record')
  }

  return value as Readonly<Record<string, unknown>>
}

export function calculateFishPricing({
  coupleMeals,
  quantities,
}: FishPricingInput): FishPricingResult {
  const quantityRecord = requirePlainRecord(quantities)
  const moroccanFillets = quantityFor(MOROCCAN_FILLET_NAME, quantityRecord)
  const chraimeFillets = quantityFor(CHRAIME_FILLET_NAME, quantityRecord)
  const fishCakePortions = quantityFor(FISH_CAKE_PORTION_NAME, quantityRecord)
  const filletUnits = checkedAdd(moroccanFillets, chraimeFillets, 'fillet units')
  const fishCakeUnits = checkedMultiply(
    fishCakePortions,
    FILLET_UNITS_PER_COUPLE_MEAL,
    'fish-cake units',
  )
  const selectedUnits = checkedAdd(filletUnits, fishCakeUnits, 'selected fish units')
  const includedUnits = checkedMultiply(
    requireNonNegativeSafeInteger(coupleMeals, 'couple meals'),
    FILLET_UNITS_PER_COUPLE_MEAL,
    'included fish units',
  )
  const extraUnits = Math.max(0, selectedUnits - includedUnits)
  const surchargeMinorUnits = checkedMultiply(
    extraUnits,
    EXTRA_FILLET_UNIT_PRICE_MINOR_UNITS,
    'fish surcharge',
  )

  return {
    selectedUnits,
    includedUnits,
    extraUnits,
    surchargeMinorUnits,
    surchargeMoney: usdFromMinorUnits(surchargeMinorUnits),
  }
}
