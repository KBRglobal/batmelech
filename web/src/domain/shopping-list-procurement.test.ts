import { describe, expect, it } from 'vitest'
import type { ProductLibraryEntry } from './product-library.ts'
import { attachProcurement } from './shopping-list-procurement.ts'
import type { ShoppingListResult } from './shopping-list.ts'

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

const SHOPPING_LIST: ShoppingListResult = {
  complete: true,
  warnings: [],
  items: [
    {
      ingredientId: 'cucumber',
      ingredientName: 'מלפפון',
      quantity: '6',
      unit: 'ק"ג',
      sources: [],
    },
    {
      ingredientId: 'parsley-garnish',
      ingredientName: 'פטרוזיליה לקישוט',
      quantity: '50',
      unit: 'גרם',
      sources: [],
    },
    {
      ingredientId: 'no-product-yet',
      ingredientName: 'עוד לא בספרייה',
      quantity: '2',
      unit: 'יחידה',
      sources: [],
    },
  ],
}

const LIBRARY = new Map<string, ProductLibraryEntry>([
  [
    'cucumber',
    product({
      id: 'cucumber',
      listings: {
        nesto: { packSize: '5', packUnit: 'ק"ג', packPriceMinorUnits: 2500, updatedAt: 1, manualPrice: null },
      },
    }),
  ],
  ['parsley-garnish', product({ id: 'parsley-garnish', insignificant: true })],
])

describe('attachProcurement', () => {
  it('attaches a supplier comparison for a priced ingredient', () => {
    const result = attachProcurement(SHOPPING_LIST, LIBRARY)
    const cucumber = result.items.find((item) => item.ingredientId === 'cucumber')!
    expect(cucumber.procurement?.cheapestSupplier).toBe('nesto')
  })

  it('drops an insignificant-flagged ingredient from the list entirely', () => {
    const result = attachProcurement(SHOPPING_LIST, LIBRARY)
    expect(result.items.some((item) => item.ingredientId === 'parsley-garnish')).toBe(false)
    expect(result.excludedInsignificant).toEqual([
      { ingredientId: 'parsley-garnish', ingredientName: 'פטרוזיליה לקישוט' },
    ])
  })

  it('leaves procurement null for an ingredient not yet in the product library', () => {
    const result = attachProcurement(SHOPPING_LIST, LIBRARY)
    const unknown = result.items.find((item) => item.ingredientId === 'no-product-yet')!
    expect(unknown.procurement).toBeNull()
  })
})
