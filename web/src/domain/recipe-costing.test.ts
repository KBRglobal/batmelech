import { describe, expect, it } from 'vitest'
import { costForPortionGrams, costRecipe, marginMinorUnits, saladSizeCosts } from './recipe-costing.ts'
import { productLibraryMap, type ProductLibraryEntry } from './product-library.ts'
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

describe('name-fallback product join', () => {
  it('a recipe typed in the panel (generated ingredient ids) still finds prices by name', () => {
    const library = productLibraryMap([
      product({
        id: 'product-cabbage-white',
        name: 'כרוב לבן',
        listings: {
          nesto: { packSize: '1', packUnit: 'ק"ג', packPriceMinorUnits: 699, updatedAt: 1, manualPrice: null },
        },
      }),
    ])
    const recipe: Pick<RecipeDefinition, 'yield' | 'ingredients'> = {
      yield: 1,
      // ingredientId is a screen-generated hash — only the NAME matches the library
      ingredients: [{ ingredientId: 'ingredient-ab12cd34', ingredientName: 'כרוב לבן', quantity: '2', unit: 'ק"ג' }],
    }
    const result = costRecipe(recipe, library)
    expect(result.complete).toBe(true)
    expect(result.totalMinorUnits).toBe(1398)
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

describe("the spec's white-cabbage salad example", () => {
  // White cabbage 6.99 AED/kg, canola oil 9.20 AED/L, sugar 5.00 AED/kg,
  // citric acid (מלח לימון) 17.50 AED/kg — Lin's real invoice prices.
  const library = new Map<string, ProductLibraryEntry>([
    [
      'cabbage',
      product({
        id: 'cabbage',
        listings: { nesto: { packSize: '1', packUnit: 'ק"ג', packPriceMinorUnits: 699, updatedAt: 1, manualPrice: null } },
      }),
    ],
    [
      'canola-oil',
      product({
        id: 'canola-oil',
        listings: { nesto: { packSize: '5', packUnit: 'ליטר', packPriceMinorUnits: 4599, updatedAt: 1, manualPrice: null } },
      }),
    ],
    [
      'sugar',
      product({
        id: 'sugar',
        listings: { nesto: { packSize: '2', packUnit: 'ק"ג', packPriceMinorUnits: 999, updatedAt: 1, manualPrice: null } },
      }),
    ],
    [
      'citric-acid',
      product({
        id: 'citric-acid',
        listings: { nesto: { packSize: '200', packUnit: 'גרם', packPriceMinorUnits: 350, updatedAt: 1, manualPrice: null } },
      }),
    ],
    [
      'water',
      product({
        id: 'water',
        listings: { nesto: { packSize: '1', packUnit: 'ליטר', packPriceMinorUnits: 0, updatedAt: 1, manualPrice: null } },
      }),
    ],
  ])

  it('prices milliliter quantities against liter packs and honors the finished yield', () => {
    const recipe: Pick<RecipeDefinition, 'yield' | 'ingredients' | 'finishedYieldGrams'> = {
      yield: 10,
      finishedYieldGrams: 1000,
      ingredients: [
        { ingredientId: 'cabbage', ingredientName: 'כרוב לבן', quantity: '940', unit: 'גרם' },
        { ingredientId: 'canola-oil', ingredientName: 'שמן קנולה', quantity: '45', unit: 'מ"ל' },
        { ingredientId: 'sugar', ingredientName: 'סוכר', quantity: '10', unit: 'גרם' },
        { ingredientId: 'citric-acid', ingredientName: 'מלח לימון', quantity: '5', unit: 'גרם' },
      ],
    }
    const result = costRecipe(recipe, library)
    expect(result.complete).toBe(true)
    // Exact rationals, rounded ONCE at the end: cabbage 0.94kg*699=657.06 +
    // oil 0.045L*919.8=41.391 + sugar 0.01kg*499.5=4.995 + citric 5g*1.75=8.75
    // = 712.196 → 712
    expect(result.totalMinorUnits).toBe(712) // 7.12 AED, the spec's number
    expect(result.totalWeightGrams).toBe(1000) // the stated finished yield, not the raw sum
    expect(result.minorUnitsPer100g).toBe(71) // 0.71 AED per 100g
    expect(costForPortionGrams(result.minorUnitsPer100g!, 250)).toBe(178) // 1.78 AED per 250g box
  })

  it('water priced at zero costs nothing but never blocks the recipe', () => {
    const recipe: Pick<RecipeDefinition, 'yield' | 'ingredients'> = {
      yield: 1,
      ingredients: [
        { ingredientId: 'cabbage', ingredientName: 'כרוב לבן', quantity: '1', unit: 'ק"ג' },
        { ingredientId: 'water', ingredientName: 'מים', quantity: '500', unit: 'מ"ל' },
      ],
    }
    const result = costRecipe(recipe, library)
    expect(result.complete).toBe(true)
    expect(result.totalMinorUnits).toBe(699)
  })

  it('never converts weight into volume silently', () => {
    const recipe: Pick<RecipeDefinition, 'yield' | 'ingredients'> = {
      yield: 1,
      ingredients: [{ ingredientId: 'canola-oil', ingredientName: 'שמן קנולה', quantity: '45', unit: 'גרם' }],
    }
    const result = costRecipe(recipe, library)
    expect(result.complete).toBe(false)
    expect(result.warnings[0]!.code).toBe('INCOMPARABLE_UNIT')
  })
})
