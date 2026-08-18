import { describe, expect, it } from 'vitest'
import {
  applyManualPriceCorrection,
  applyProductLibraryToStore,
  compareSuppliers,
  effectivePricePerBaseUnit,
  effectiveSupplier,
  loadProductLibrary,
  minorUnitsToMoney,
  moneyToMinorUnits,
  nextStableProductId,
  priceCorrectionFromReceipt,
  purchaseOption,
  quickCostEstimate,
  type ProductLibraryEntry,
} from './product-library.ts'

function entry(overrides: Partial<ProductLibraryEntry> = {}): ProductLibraryEntry {
  return {
    id: 'product-meat',
    name: 'בשר בקר',
    category: 'meat',
    kosherOnly: false,
    supplierOverride: null,
    insignificant: false,
    listings: {
      nesto: {
        packSize: '5',
        packUnit: 'ק"ג',
        packPriceMinorUnits: 25000,
        updatedAt: 1000,
        manualPrice: null,
      },
      rimon: {
        packSize: '2',
        packUnit: 'ק"ג',
        packPriceMinorUnits: 11000,
        updatedAt: 1000,
        manualPrice: null,
      },
    },
    ...overrides,
  }
}

describe('money helpers', () => {
  it('round-trips a canonical amount', () => {
    expect(moneyToMinorUnits('45.90')).toBe(4590)
    expect(minorUnitsToMoney(4590)).toBe('45.90')
    expect(moneyToMinorUnits('3')).toBe(300)
  })
})

describe('effectivePricePerBaseUnit', () => {
  it('derives price per kg from pack price and size', () => {
    // 25000 fils / 5 kg = 5000 fils/kg
    expect(effectivePricePerBaseUnit(entry().listings.nesto!)).toBe(5000)
  })

  it('manual correction always wins over the derived pack price', () => {
    const withManual = applyManualPriceCorrection(entry(), 'nesto', 6100, 2000)
    expect(effectivePricePerBaseUnit(withManual.listings.nesto!)).toBe(6100)
  })
})

describe('effectiveSupplier', () => {
  it('picks the cheaper supplier when there is no override', () => {
    // nesto 5000/kg, rimon 5500/kg (11000/2) -> nesto is cheaper
    expect(effectiveSupplier(entry())).toBe('nesto')
  })

  it('an explicit override wins regardless of price', () => {
    expect(effectiveSupplier(entry({ supplierOverride: 'rimon' }))).toBe('rimon')
  })

  it('kosher-only forces Rimon even when Nesto is cheaper', () => {
    expect(effectiveSupplier(entry({ kosherOnly: true }))).toBe('rimon')
  })

  it('returns null when nothing is priced', () => {
    expect(effectiveSupplier(entry({ listings: {} }))).toBeNull()
  })
})

describe('purchaseOption', () => {
  it('rounds up to a whole number of packs', () => {
    // need 6kg, pack is 5kg -> 2 packs
    const option = purchaseOption(entry().listings.nesto!, 'nesto', '6', 'ק"ג')
    expect(option).toEqual({ supplier: 'nesto', packsNeeded: 2, totalMinorUnits: 50000, comparable: true })
  })

  it('unifies gram and kilogram units', () => {
    // need 500g against a 5kg pack -> 1 pack
    const option = purchaseOption(entry().listings.nesto!, 'nesto', '500', 'גרם')
    expect(option.packsNeeded).toBe(1)
  })

  it('flags an incomparable unit rather than guessing', () => {
    const option = purchaseOption(entry().listings.nesto!, 'nesto', '3', 'יחידה')
    expect(option.comparable).toBe(false)
  })
})

describe('compareSuppliers', () => {
  it('picks the cheaper total basket across suppliers', () => {
    const comparison = compareSuppliers(entry(), '6', 'ק"ג')
    // nesto: 2 packs * 25000 = 50000; rimon: 3 packs * 11000 = 33000 -> rimon cheaper here
    expect(comparison.cheapestSupplier).toBe('rimon')
    expect(comparison.kosherLocked).toBe(false)
  })

  it('locks to Rimon for kosher-only products', () => {
    const comparison = compareSuppliers(entry({ kosherOnly: true }), '6', 'ק"ג')
    expect(comparison.cheapestSupplier).toBe('rimon')
    expect(comparison.kosherLocked).toBe(true)
  })
})

describe('quick manual quantity+price entry', () => {
  it('estimates cost from a typed quantity using the effective supplier price', () => {
    const result = quickCostEstimate(entry(), '12', 'ק"ג')
    // effective supplier is nesto at 5000 fils/kg -> 12 * 5000 = 60000
    expect(result).toEqual({ minorUnits: 60000, supplier: 'nesto' })
  })

  it('reverse direction: a receipt total implies a corrected per-kg price', () => {
    const impliedPricePerKg = priceCorrectionFromReceipt('12', 'ק"ג', 'ק"ג', 61200)
    expect(impliedPricePerKg).toBe(5100)
    const corrected = applyManualPriceCorrection(entry(), 'nesto', impliedPricePerKg!, 5000)
    expect(effectivePricePerBaseUnit(corrected.listings.nesto!)).toBe(5100)
  })
})

describe('store persistence', () => {
  it('round-trips through applyProductLibraryToStore/loadProductLibrary', () => {
    const store = applyProductLibraryToStore({ orders: [] }, [entry()])
    const book = loadProductLibrary(store)
    expect(book.saveable).toBe(true)
    expect(book.entries).toHaveLength(1)
    expect(book.entries[0]!.id).toBe('product-meat')
  })

  it('flags duplicate product ids as unsaveable', () => {
    expect(() => applyProductLibraryToStore({ orders: [] }, [entry(), entry()])).toThrow()
  })
})

describe('nextStableProductId', () => {
  it('is deterministic for the same name and avoids existing ids', () => {
    const first = nextStableProductId('בשר בקר', [])
    const second = nextStableProductId('בשר בקר', [{ id: first }])
    expect(first).not.toBe(second)
    expect(nextStableProductId('בשר בקר', [])).toBe(first)
  })
})
