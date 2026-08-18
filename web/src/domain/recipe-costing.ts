import { decimalParts, type RecipeDefinition, type RecipeIngredient } from './recipes.ts'
import {
  effectivePriceRational,
  effectiveSupplier,
  ratAdd,
  ratDiv,
  ratFromDecimal,
  ratMul,
  ratToRoundedInt,
  toComparableBaseRational,
  type ProductLibraryEntry,
  type Rational,
  type SupplierKey,
} from './product-library.ts'

/**
 * Recipe costing on top of the product library: what a batch (and one portion of it)
 * actually costs to make, and — for anything sold by weight (salads) — the cost per 100g,
 * scaled to whichever portion size Moshe is pricing (100/150/200/250g and beyond).
 *
 * "Whole-product" recipes (couple / four-person / tray) need none of this specially —
 * they are just a RecipeDefinition with `yield` 2 / 4 / N, and `perYieldUnitMinorUnits`
 * below already gives their per-portion cost.
 */

export type RecipeCostWarningCode = 'MISSING_PRODUCT' | 'UNPRICED_PRODUCT' | 'INCOMPARABLE_UNIT'

export interface RecipeCostWarning {
  readonly code: RecipeCostWarningCode
  readonly ingredientId: string
  readonly message: string
}

export interface IngredientCost {
  readonly ingredientId: string
  readonly ingredientName: string
  readonly supplier: SupplierKey | null
  readonly minorUnits: number | null
  /** Waste-adjusted weight in grams, or null for a non-weight (יחידה) ingredient. */
  readonly weightGrams: number | null
}

export interface RecipeCostResult {
  /** false when at least one ingredient could not be priced — the totals below still sum whatever could be. */
  readonly complete: boolean
  readonly totalMinorUnits: number
  readonly perYieldUnitMinorUnits: number
  readonly totalWeightGrams: number | null
  readonly minorUnitsPer100g: number | null
  readonly ingredientCosts: readonly IngredientCost[]
  readonly warnings: readonly RecipeCostWarning[]
}

const GRAMS_PER_KILOGRAM: Rational = { num: 1000n, den: 1n }
const KILOGRAM_UNITS: ReadonlySet<string> = new Set(['ק"ג', 'ק״ג'])
const GRAM_UNITS: ReadonlySet<string> = new Set(['גרם'])
const ZERO: Rational = { num: 0n, den: 1n }

function wasteAdjustedQuantity(ingredient: Pick<RecipeIngredient, 'quantity' | 'wastePercent'>): Rational {
  const waste = decimalParts(ingredient.wastePercent ?? '0')
  const wasteDen = 10n ** BigInt(waste.scale)
  const wasteFactor: Rational = { num: 100n * wasteDen + waste.coefficient, den: 100n * wasteDen }
  return ratMul(ratFromDecimal(ingredient.quantity), wasteFactor)
}

function weightInGrams(quantity: Rational, unit: string): Rational | null {
  if (GRAM_UNITS.has(unit)) return quantity
  if (KILOGRAM_UNITS.has(unit)) return ratMul(quantity, GRAMS_PER_KILOGRAM)
  return null
}

export function costRecipe(
  recipe: Pick<RecipeDefinition, 'yield' | 'ingredients' | 'finishedYieldGrams'>,
  productLibrary: ReadonlyMap<string, ProductLibraryEntry>,
): RecipeCostResult {
  const warnings: RecipeCostWarning[] = []
  const ingredientCosts: IngredientCost[] = []
  let totalCost = ZERO
  let totalWeight: Rational | null = null
  let complete = true

  for (const ingredient of recipe.ingredients) {
    const adjustedQuantity = wasteAdjustedQuantity(ingredient)
    const grams = weightInGrams(adjustedQuantity, ingredient.unit)
    if (grams !== null) totalWeight = totalWeight === null ? grams : ratAdd(totalWeight, grams)
    const weightGrams = grams === null ? null : Number(ratToRoundedInt(grams))

    const product = productLibrary.get(ingredient.ingredientId)
    if (product === undefined) {
      complete = false
      warnings.push({
        code: 'MISSING_PRODUCT',
        ingredientId: ingredient.ingredientId,
        message: `No product library entry for ${ingredient.ingredientName}.`,
      })
      ingredientCosts.push({
        ingredientId: ingredient.ingredientId,
        ingredientName: ingredient.ingredientName,
        supplier: null,
        minorUnits: null,
        weightGrams,
      })
      continue
    }

    const supplier = effectiveSupplier(product)
    const listing = supplier === null ? null : (product.listings[supplier] ?? null)
    const comparable =
      listing === null ? null : toComparableBaseRational(adjustedQuantity, ingredient.unit, listing.packUnit)
    if (supplier === null || listing === null || comparable === null) {
      complete = false
      warnings.push({
        code: supplier === null ? 'UNPRICED_PRODUCT' : 'INCOMPARABLE_UNIT',
        ingredientId: ingredient.ingredientId,
        message:
          supplier === null
            ? `${ingredient.ingredientName} has no priced supplier.`
            : `${ingredient.ingredientName}'s unit (${ingredient.unit}) does not match its product's pack unit.`,
      })
      ingredientCosts.push({
        ingredientId: ingredient.ingredientId,
        ingredientName: ingredient.ingredientName,
        supplier,
        minorUnits: null,
        weightGrams,
      })
      continue
    }

    const cost = ratMul(comparable, effectivePriceRational(listing))
    totalCost = ratAdd(totalCost, cost)
    ingredientCosts.push({
      ingredientId: ingredient.ingredientId,
      ingredientName: ingredient.ingredientName,
      supplier,
      minorUnits: Number(ratToRoundedInt(cost)),
      weightGrams,
    })
  }

  const totalMinorUnits = Number(ratToRoundedInt(totalCost))
  const perYieldUnitMinorUnits = Number(ratToRoundedInt(ratDiv(totalCost, { num: BigInt(recipe.yield), den: 1n })))
  // The stated finished weight wins over summed raw weights: cooked dishes lose
  // water, salads gain dressing — the batch Lin actually boxes is what matters.
  const effectiveWeight: Rational | null =
    recipe.finishedYieldGrams !== undefined
      ? { num: BigInt(recipe.finishedYieldGrams), den: 1n }
      : totalWeight
  const totalWeightGrams = effectiveWeight === null ? null : Number(ratToRoundedInt(effectiveWeight))
  const minorUnitsPer100g =
    effectiveWeight === null || effectiveWeight.num === 0n
      ? null
      : Number(ratToRoundedInt(ratDiv(ratMul(totalCost, { num: 100n, den: 1n }), effectiveWeight)))

  return {
    complete,
    totalMinorUnits,
    perYieldUnitMinorUnits,
    totalWeightGrams,
    minorUnitsPer100g,
    ingredientCosts,
    warnings,
  }
}

/** Scale a per-100g cost to any portion size — the salad-size ladder (100/150/200/250g and beyond). */
export function costForPortionGrams(minorUnitsPer100g: number, grams: number): number {
  if (!Number.isSafeInteger(grams) || grams <= 0) throw new RangeError('grams must be a positive safe integer')
  return Number(ratToRoundedInt(ratMul({ num: BigInt(minorUnitsPer100g), den: 100n }, { num: BigInt(grams), den: 1n })))
}

export const SALAD_PORTION_SIZES_GRAMS = [100, 150, 200, 250] as const
export type SaladPortionGrams = (typeof SALAD_PORTION_SIZES_GRAMS)[number]

export function saladSizeCosts(minorUnitsPer100g: number): Readonly<Record<SaladPortionGrams, number>> {
  const entries = SALAD_PORTION_SIZES_GRAMS.map(
    (grams) => [grams, costForPortionGrams(minorUnitsPer100g, grams)] as const,
  )
  return Object.fromEntries(entries) as Record<SaladPortionGrams, number>
}

/** Sale price minus cost, in minor units. Negative means the dish is sold under cost. */
export function marginMinorUnits(costMinorUnits: number, saleMinorUnits: number): number {
  return saleMinorUnits - costMinorUnits
}
