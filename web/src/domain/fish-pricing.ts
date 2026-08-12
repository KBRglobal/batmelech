export const MOROCCAN_FILLET_NAME = 'פילה דג ברוטב מרוקאי'
export const CHRAIME_FILLET_NAME = 'פילה דג ברוטב חריימה'
export const FISH_CAKE_PORTION_NAME = 'קציצות דגים ברוטב מרוקאי'

export const FILLET_UNITS_PER_COUPLE_MEAL = 2
export const EXTRA_FILLET_UNIT_PRICE = 30

export interface FishPricingInput {
  readonly coupleMeals: unknown
  readonly quantities: Readonly<Record<string, unknown>>
}

export interface FishPricingResult {
  readonly selectedUnits: number
  readonly includedUnits: number
  readonly extraUnits: number
  readonly surcharge: number
}

function validQuantity(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0
}

export function calculateFishPricing({
  coupleMeals,
  quantities,
}: FishPricingInput): FishPricingResult {
  const filletUnits =
    validQuantity(quantities[MOROCCAN_FILLET_NAME]) +
    validQuantity(quantities[CHRAIME_FILLET_NAME])
  const fishCakeUnits = validQuantity(quantities[FISH_CAKE_PORTION_NAME]) * FILLET_UNITS_PER_COUPLE_MEAL
  const selectedUnits = filletUnits + fishCakeUnits
  const includedUnits = validQuantity(coupleMeals) * FILLET_UNITS_PER_COUPLE_MEAL
  const extraUnits = Math.max(0, selectedUnits - includedUnits)

  return {
    selectedUnits,
    includedUnits,
    extraUnits,
    surcharge: extraUnits * EXTRA_FILLET_UNIT_PRICE,
  }
}
