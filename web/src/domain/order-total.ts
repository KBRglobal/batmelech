import {
  EXTRA_FILLET_UNIT_PRICE_MINOR_UNITS,
  calculateFishPricing,
  type FishPricingResult,
} from './fish-pricing.ts'
import {
  checkedAdd,
  checkedMultiply,
  requireNonNegativeSafeInteger,
  usdFromMinorUnits,
  type UsdMoney,
} from './money.ts'
import {
  calculateSaladPricing,
  type SaladPricingResult,
} from './salad-pricing.ts'

export const LEGACY_FISH_DISH_EXTRA_NAME = 'תוספת מנת דג'
export const LEGACY_FISH_CAKE_EXTRA_NAME = 'תוספת קציצות דגים'
export const LEGACY_SALAD_BLOCK_EXTRA_NAME = 'תוספת 4 סלטים לבחירה'
export const LEGACY_CHALLAH_EXTRA_NAME = 'תוספת חלה'
export const DELIVERY_EXTRA_NAME = 'משלוח'

export type ChargeSource = 'legacy-extra' | 'custom' | 'lunch' | 'delivery' | 'other'

export interface ChargeLineInput {
  readonly source: ChargeSource
  readonly name: string
  readonly quantity: unknown
  readonly unitPriceMinorUnits: unknown
}

export interface OrderTotalInput {
  readonly coupleMeals: unknown
  readonly coupleMealUnitPriceMinorUnits: unknown
  readonly fishQuantities: unknown
  readonly orderedSalads: unknown
  readonly giftSalads?: unknown
  readonly chargeLines?: readonly ChargeLineInput[]
}

export interface OrderTotalLine {
  readonly kind: 'couple-meal' | 'fish-surcharge' | 'salad-surcharge' | 'manual'
  readonly name: string
  readonly quantity: number
  readonly unitPriceMinorUnits: number
  readonly amountMinorUnits: number
  readonly source?: ChargeSource
}

export interface ExcludedLegacyExtra {
  readonly index: number
  readonly name: string
  readonly quantity: number
}

export interface OrderTotalResult {
  readonly fish: FishPricingResult
  readonly salads: SaladPricingResult
  readonly lines: readonly OrderTotalLine[]
  readonly excludedLegacyExtras: readonly ExcludedLegacyExtra[]
  readonly totalMinorUnits: number
  readonly totalMoney: UsdMoney
}

const COUPLE_MEAL_LINE_NAME = 'ארוחה זוגית'
const FISH_SURCHARGE_LINE_NAME = 'פילה דג אקסטרה'
const SALAD_SURCHARGE_LINE_NAME = 'סלטים אקסטרה'
const SUPPORTED_CHARGE_SOURCES = new Set<ChargeSource>([
  'legacy-extra',
  'custom',
  'lunch',
  'delivery',
  'other',
])

export function canonicalizeChargeName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
}

const AUTOMATIC_CHARGE_NAMES = new Set([
  canonicalizeChargeName(LEGACY_FISH_DISH_EXTRA_NAME),
  canonicalizeChargeName(LEGACY_FISH_CAKE_EXTRA_NAME),
  canonicalizeChargeName(LEGACY_SALAD_BLOCK_EXTRA_NAME),
  canonicalizeChargeName(LEGACY_CHALLAH_EXTRA_NAME),
  canonicalizeChargeName(DELIVERY_EXTRA_NAME),
])

export function isAutomaticChargeName(value: string): boolean {
  return AUTOMATIC_CHARGE_NAMES.has(canonicalizeChargeName(value))
}

function requireChargeLine(value: unknown, index: number): ChargeLineInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`chargeLines[${index}] must be an object`)
  }

  const prototype = Object.getPrototypeOf(value)

  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`chargeLines[${index}] must be a plain object`)
  }

  const line = value as Partial<ChargeLineInput>

  if (
    !Object.hasOwn(value, 'source') ||
    !Object.hasOwn(value, 'name') ||
    !Object.hasOwn(value, 'quantity') ||
    !Object.hasOwn(value, 'unitPriceMinorUnits')
  ) {
    throw new TypeError(`chargeLines[${index}] is missing a required field`)
  }

  if (!SUPPORTED_CHARGE_SOURCES.has(line.source as ChargeSource)) {
    throw new TypeError(`chargeLines[${index}].source is not supported`)
  }

  if (typeof line.name !== 'string' || canonicalizeChargeName(line.name).length === 0) {
    throw new TypeError(`chargeLines[${index}].name must be a non-empty string`)
  }

  return line as ChargeLineInput
}

function buildLine(
  kind: OrderTotalLine['kind'],
  name: string,
  quantity: number,
  unitPriceMinorUnits: number,
  source?: ChargeSource,
): OrderTotalLine {
  return {
    kind,
    name,
    quantity,
    unitPriceMinorUnits,
    amountMinorUnits: checkedMultiply(quantity, unitPriceMinorUnits, `${name} charge`),
    ...(source === undefined ? {} : { source }),
  }
}

export function calculateOrderTotal({
  coupleMeals,
  coupleMealUnitPriceMinorUnits,
  fishQuantities,
  orderedSalads,
  giftSalads = 0,
  chargeLines = [],
}: OrderTotalInput): OrderTotalResult {
  const meals = requireNonNegativeSafeInteger(coupleMeals, 'couple meals')
  const mealPrice = requireNonNegativeSafeInteger(
    coupleMealUnitPriceMinorUnits,
    'couple meal unit price minor units',
  )

  if (!Array.isArray(chargeLines)) {
    throw new TypeError('chargeLines must be an array')
  }

  const fish = calculateFishPricing({ coupleMeals: meals, quantities: fishQuantities })
  const salads = calculateSaladPricing({ coupleMeals: meals, orderedSalads, giftSalads })
  const lines: OrderTotalLine[] = []
  const excludedLegacyExtras: ExcludedLegacyExtra[] = []

  if (meals > 0) {
    lines.push(buildLine('couple-meal', COUPLE_MEAL_LINE_NAME, meals, mealPrice))
  }

  if (fish.extraUnits > 0) {
    lines.push(
      buildLine(
        'fish-surcharge',
        FISH_SURCHARGE_LINE_NAME,
        fish.extraUnits,
        EXTRA_FILLET_UNIT_PRICE_MINOR_UNITS,
      ),
    )
  }

  if (salads.surchargeMinorUnits > 0) {
    lines.push(
      buildLine(
        'salad-surcharge',
        SALAD_SURCHARGE_LINE_NAME,
        1,
        salads.surchargeMinorUnits,
      ),
    )
  }

  chargeLines.forEach((rawLine, index) => {
    const line = requireChargeLine(rawLine, index)
    const name = canonicalizeChargeName(line.name)
    const quantity = requireNonNegativeSafeInteger(
      line.quantity,
      `chargeLines[${index}].quantity`,
    )
    const unitPriceMinorUnits = requireNonNegativeSafeInteger(
      line.unitPriceMinorUnits,
      `chargeLines[${index}].unitPriceMinorUnits`,
    )

    if (line.source !== 'delivery' && AUTOMATIC_CHARGE_NAMES.has(name)) {
      if (quantity > 0) {
        excludedLegacyExtras.push({ index, name, quantity })
      }
      return
    }

    if (quantity > 0) {
      lines.push(buildLine('manual', name, quantity, unitPriceMinorUnits, line.source))
    }
  })

  const totalMinorUnits = lines.reduce(
    (total, line) => checkedAdd(total, line.amountMinorUnits, 'order total'),
    0,
  )

  return {
    fish,
    salads,
    lines,
    excludedLegacyExtras,
    totalMinorUnits,
    totalMoney: usdFromMinorUnits(totalMinorUnits),
  }
}
