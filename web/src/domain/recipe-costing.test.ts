import { describe, expect, it } from 'vitest'
import { costForPortionGrams, costRecipe, marginMinorUnits, saladSizeCosts } from './recipe-costing.ts'
import type { ProductLibraryEntry } from './product-library.ts'
import type { RecipeDefinition } from './recipes.ts'

function product(overrides: Partial<ProductLibraryEntry>): ProductLibraryEntry {
  return {
    id: overrides.id ?? 'product',
    name: overrides.name ?? 'product',
    category: '',
    kosherOnly: false,
    supplierOverride: null,
    insignificant: false,
    listings: {},
    ...overrides,
  }
}

const LIBRARY = new Map<string, ProductLibraryEntry>([
  [
    'cucumber',
    product({
      id: 'cucumber',
      listings: {
        nesto: { packSize: '1', packUnit: 'ק"ג', packPriceMinorUnits: 600, updatedAt: 1, manualPrice: null },
      },
    }),
  ],
  [
    'tahini-paste',
    product({
      id: 'tahini-paste',
      listings: {
        rimon: { packSize: '500', packUnit: 'גרם', packPriceMinorUnits: 1500, updatedAt: 1, manualPrice: null },
      },
    }),
  ],
])

const SALAD_RECIPE: Pick<RecipeDefinition, 'yield' | 'ingredients'> = {
  yield: 10, // 10 servings of 100g each = 1000g batch
  ingredients: [
    { ingredientId: 'cucumber', ingredientName: 'מלפפון', quantity: '700', unit: 'גרם' },
    { ingredientId: 'tahini-paste', ingredientName: 'טחינה גולמית', quantity: '300', unit: 'גרם' },
  ],
}

describe('costRecipe', () => {
  it('costs a fully priced recipe and derives cost per 100g', () => {
    const result = costRecipe(SALAD_RECIPE, LIBRARY)
    expect(result.complete).toBe(true)
    expect(result.warnings).toHaveLength(0)
    // cucumber: 700g -> 0.7kg * 600 fils/kg = 420
    // tahini: 300g * (1500/500 fils per g) = 300 * 3 = 900
    expect(result.totalMinorUnits).toBe(420 + 900)
    expect(result.totalWeightGrams).toBe(1000)
    expect(result.minorUnitsPer100g).toBe(132) // 1320/10 -> per 100g of a 1000g batch
    expect(result.perYieldUnitMinorUnits).toBe(132) // yield=10 portions of a 1000g/10=100g batch too
  })

  it('flags an ingredient with no product library entry, but still sums the rest', () => {
    const recipe: Pick<RecipeDefinition, 'yield' | 'ingredients'> = {
      yield: 1,
      ingredients: [
        { ingredientId: 'cucumber', ingredientName: 'מלפפון', quantity: '1', unit: 'ק"ג' },
        { ingredientId: 'unknown-item', ingredientName: 'לא ידוע', quantity: '1', unit: 'יחידה' },
      ],
    }
    const result = costRecipe(recipe, LIBRARY)
    expect(result.complete).toBe(false)
    expect(result.warnings).toEqual([
      { code: 'MISSING_PRODUCT', ingredientId: 'unknown-item', message: expect.stringContaining('לא ידוע') },
    ])
    expect(result.totalMinorUnits).toBe(600) // just the cucumber
  })

  it('flags a product priced only in an unmatched unit', () => {
    const library = new Map<string, ProductLibraryEntry>([
      [
        'shrimp',
        product({
          id: 'shrimp',
          listings: {
            nesto: { packSize: '3', packUnit: 'יחידה', packPriceMinorUnits: 900, updatedAt: 1, manualPrice: null },
          },
        }),
      ],
    ])
    const recipe: Pick<RecipeDefinition, 'yield' | 'ingredients'> = {
      yield: 1,
      ingredients: [{ ingredientId: 'shrimp', ingredientName: 'שרימפס', quantity: '200', unit: 'גרם' }],
    }
    const result = costRecipe(recipe, library)
    expect(result.complete).toBe(false)
    expect(result.warnings[0]!.code).toBe('INCOMPARABLE_UNIT')
  })

  it('applies waste percent before pricing', () => {
    const library = new Map<string, ProductLibraryEntry>([
      [
        'onion',
        product({
          id: 'onion',
          listings: {
            nesto: { packSize: '1', packUnit: 'ק"ג', packPriceMinorUnits: 500, updatedAt: 1, manualPrice: null },
          },
        }),
      ],
    ])
    const recipe: Pick<RecipeDefinition, 'yield' | 'ingredients'> = {
      yield: 1,
      ingredients: [
        { ingredientId: 'onion', ingredientName: 'בצל', quantity: '1', unit: 'ק"ג', wastePercent: '20' },
      ],
    }
    // 1kg * 1.20 waste factor * 500 fils/kg = 600
    expect(costRecipe(recipe, library).totalMinorUnits).toBe(600)
  })
})

describe('salad size scaling', () => {
  it('scales a per-100g cost across the standard portion ladder', () => {
    expect(costForPortionGrams(132, 150)).toBe(198)
    expect(saladSizeCosts(132)).toEqual({ 100: 132, 150: 198, 200: 264, 250: 330 })
  })
})

describe('marginMinorUnits', () => {
  it('is sale price minus cost', () => {
    expect(marginMinorUnits(600, 1500)).toBe(900)
    expect(marginMinorUnits(1500, 600)).toBe(-900)
  })
})
