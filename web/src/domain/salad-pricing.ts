import type { UsdMoney } from './money.ts'
import {
  checkedAdd,
  checkedMultiply,
  requireNonNegativeSafeInteger,
  usdFromMinorUnits,
} from './money.ts'

export const INCLUDED_SALADS_PER_COUPLE_MEAL = 4
export const EXTRA_SALAD_BLOCK_SIZE = 4
export const EXTRA_SALAD_BLOCK_PRICE_MINOR_UNITS = 2_500
export const EXTRA_SALAD_SINGLE_PRICE_MINOR_UNITS = 700

export interface SaladPricingInput {
  readonly coupleMeals: unknown
  readonly orderedSalads: unknown
  readonly giftSalads?: unknown
}

export interface SaladPricingResult {
  readonly orderedSalads: number
  readonly giftSalads: number
  readonly totalPreparedSalads: number
  readonly allowanceSalads: number
  readonly includedSalads: number
  readonly extraSalads: number
  readonly extraBlocks: number
  readonly extraSingles: number
  readonly surchargeMinorUnits: number
  readonly surchargeMoney: UsdMoney
}

export function calculateSaladPricing({
  coupleMeals,
  orderedSalads,
  giftSalads = 0,
}: SaladPricingInput): SaladPricingResult {
  const meals = requireNonNegativeSafeInteger(coupleMeals, 'couple meals')
  const ordered = requireNonNegativeSafeInteger(orderedSalads, 'ordered salads')
  const gifts = requireNonNegativeSafeInteger(giftSalads, 'gift salads')
  const totalPreparedSalads = checkedAdd(ordered, gifts, 'prepared salads')
  const allowanceSalads = checkedMultiply(
    meals,
    INCLUDED_SALADS_PER_COUPLE_MEAL,
    'included salads',
  )
  const includedSalads = Math.min(ordered, allowanceSalads)
  const extraSalads = Math.max(0, ordered - allowanceSalads)
  const extraBlocks = Math.floor(extraSalads / EXTRA_SALAD_BLOCK_SIZE)
  const extraSingles = extraSalads % EXTRA_SALAD_BLOCK_SIZE
  const blockCharge = checkedMultiply(
    extraBlocks,
    EXTRA_SALAD_BLOCK_PRICE_MINOR_UNITS,
    'salad block surcharge',
  )
  const singleCharge = checkedMultiply(
    extraSingles,
    EXTRA_SALAD_SINGLE_PRICE_MINOR_UNITS,
    'salad single surcharge',
  )
  const surchargeMinorUnits = checkedAdd(blockCharge, singleCharge, 'salad surcharge')

  return {
    orderedSalads: ordered,
    giftSalads: gifts,
    totalPreparedSalads,
    allowanceSalads,
    includedSalads,
    extraSalads,
    extraBlocks,
    extraSingles,
    surchargeMinorUnits,
    surchargeMoney: usdFromMinorUnits(surchargeMinorUnits),
  }
}
