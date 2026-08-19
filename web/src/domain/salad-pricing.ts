import type { UsdMoney } from './money.ts'
import {
  checkedAdd,
  checkedMultiply,
  requireNonNegativeSafeInteger,
  usdFromMinorUnits,
} from './money.ts'
import { SALADS_INCLUDED_PER_MEAL } from './package-rules.ts'

// Re-exported under its historical name — the included amount is now
// defined once in package-rules.ts; this module and the AI-intake resolver
// both read it from there.
export const INCLUDED_SALADS_PER_COUPLE_MEAL = SALADS_INCLUDED_PER_MEAL
export const EXTRA_SALAD_BLOCK_SIZE = 4
export const EXTRA_SALAD_BLOCK_PRICE_MINOR_UNITS = 2_500
export const EXTRA_SALAD_SINGLE_PRICE_MINOR_UNITS = 700

export interface SaladPricingInput {
  readonly coupleMeals: unknown
  readonly orderedSalads: unknown
  readonly giftSalads?: unknown
  readonly blockPriceMinorUnits?: unknown
  readonly remainderPriceMinorUnits?: unknown
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
  blockPriceMinorUnits = EXTRA_SALAD_BLOCK_PRICE_MINOR_UNITS,
  remainderPriceMinorUnits = EXTRA_SALAD_SINGLE_PRICE_MINOR_UNITS,
}: SaladPricingInput): SaladPricingResult {
  const meals = requireNonNegativeSafeInteger(coupleMeals, 'couple meals')
  const ordered = requireNonNegativeSafeInteger(orderedSalads, 'ordered salads')
  const gifts = requireNonNegativeSafeInteger(giftSalads, 'gift salads')
  const blockPrice = requireNonNegativeSafeInteger(blockPriceMinorUnits, 'salad block price minor units')
  const remainderPrice = requireNonNegativeSafeInteger(remainderPriceMinorUnits, 'salad remainder price minor units')
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
    blockPrice,
    'salad block surcharge',
  )
  const singleCharge = checkedMultiply(
    extraSingles,
    remainderPrice,
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
