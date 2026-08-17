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
  readonly extraFilletPriceMinorUnits?: unknown
}

export interface FishPricingResult {
  readonly selectedUnits: number
  readonly includedUnits: number
  readonly extraUnits: number
  readonly surchargeMinorUnits: number
  readonly surchargeMoney: UsdMoney
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
  extraFilletPriceMinorUnits = EXTRA_FILLET_UNIT_PRICE_MINOR_UNITS,
}: FishPricingInput): FishPricingResult {
  const extraFilletPrice = requireNonNegativeSafeInteger(
    extraFilletPriceMinorUnits,
    'extra fillet price minor units',
  )
  const quantityRecord = requirePlainRecord(quantities)
  let selectedUnits = 0
  for (const [itemName, rawQuantity] of Object.entries(quantityRecord)) {
    const quantity = requireNonNegativeSafeInteger(rawQuantity, itemName)
    const unitWeight = itemName === FISH_CAKE_PORTION_NAME ? FILLET_UNITS_PER_COUPLE_MEAL : 1
    const itemUnits = checkedMultiply(quantity, unitWeight, `${itemName} units`)
    selectedUnits = checkedAdd(selectedUnits, itemUnits, 'selected fish units')
  }
  const includedUnits = checkedMultiply(
    requireNonNegativeSafeInteger(coupleMeals, 'couple meals'),
    FILLET_UNITS_PER_COUPLE_MEAL,
    'included fish units',
  )
  const extraUnits = Math.max(0, selectedUnits - includedUnits)
  const surchargeMinorUnits = checkedMultiply(
    extraUnits,
    extraFilletPrice,
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
