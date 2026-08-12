import { describe, expect, it } from 'vitest'
import {
  AUTHORITATIVE_ALLOWANCES,
  AUTHORITATIVE_FIRST_COURSE_ITEMS,
  DEFAULT_SETTINGS_CATALOG,
  SUPERSEDED_MANUAL_EXTRAS,
  addCatalogExtra,
  addCatalogItem,
  applyCatalogToStore,
  applyRecipesToStore,
  buildPreparationCatalog,
  loadRecipeBook,
  loadSettingsCatalog,
  nextStableIngredientId,
  removeCatalogItem,
  recipeTargets,
  updateLunchPrice,
  validateRecipeDrafts,
  validateSettingsCatalog,
  type RecipeDraft,
  type SettingsCatalog,
} from './settings-catalog.ts'
import type { LegacyStore } from './store.ts'

const EMPTY_STORE: LegacyStore = { orders: [] }

describe('settings catalog', () => {
  it('loads the complete authoritative defaults when legacy menu values are absent', () => {
    const result = loadSettingsCatalog(EMPTY_STORE)

    expect(result.warnings).toEqual([])
    expect(result.catalog.couplePriceMinorUnits).toBe(23_000)
    expect(result.catalog.extraChallahMinorUnits).toBe(1_000)
    expect(result.catalog.includedChallahs).toBe(2)
    expect(Object.fromEntries(Object.entries(result.catalog.categories).map(([key, rows]) => [key, rows.length]))).toEqual({
      salads: 17,
      firsts: 3,
      mains: 8,
      sides: 6,
      desserts: 2,
    })
    expect(AUTHORITATIVE_ALLOWANCES).toMatchObject({
      includedSaladsPerCouple: 4,
      includedFishUnitsPerCouple: 2,
      extraFishFilletMinorUnits: 3_000,
      saladBlockMinorUnits: 2_500,
      saladRemainderMinorUnits: 700,
      soufflesPerCouple: 2,
      baklavaPortionsPerCouple: 1,
    })
    expect(result.catalog.extras.map((item) => item.name)).toEqual(expect.arrayContaining([
      'מרק ירקות לקוסקוס ללא עוף',
      'מרק ירקות לקוסקוס עם עוף',
      'אורז',
      'פסטה אדומה',
      'קוסקוס',
      'מארז הבדלה',
      'סט עריכה',
      'תוספת יין',
    ]))
    expect(result.catalog.extras.map((item) => item.name)).not.toEqual(expect.arrayContaining([...SUPERSEDED_MANUAL_EXTRAS]))
    expect(result.catalog.extras.map((item) => item.name)).not.toContain('משלוח')
    expect(result.catalog.categories.firsts).toEqual(AUTHORITATIVE_FIRST_COURSE_ITEMS)
  })

  it('keeps lunch structure fixed while accepting exact valid price overrides', () => {
    const store = {
      orders: [],
      menu: {
        lunch: [
          { key: 'baguette', price: '22.25' },
          {
            key: 'schnitzel-plate',
            variants: [
              { k: 'single', price: 36, sidePrice: 16 },
              { k: 'family', price: 150, sidePrice: 26 },
            ],
          },
          { key: 'couscous', price: 37, addon: { price: 21 } },
        ],
      },
    } as LegacyStore

    const result = loadSettingsCatalog(store)
    const plate = result.catalog.lunch.find((item) => item.key === 'schnitzel-plate')!
    const challah = result.catalog.lunch
      .find((item) => item.key === 'schnitzel-roll')!
      .variants.find((variant) => variant.key === 'challah')!

    expect(result.warnings).toEqual([])
    expect(result.catalog.lunch.find((item) => item.key === 'baguette')?.priceMinorUnits).toBe(2_225)
    expect(plate.variants.find((variant) => variant.key === 'single')).toMatchObject({
      priceMinorUnits: 3_600,
      extraSideMinorUnits: 1_600,
    })
    expect(plate.variants.find((variant) => variant.key === 'family')).toMatchObject({
      priceMinorUnits: 15_000,
      includedSides: 2,
      extraSideMinorUnits: 2_600,
    })
    expect(challah).toMatchObject({ weekendOnly: true, priceMinorUnits: 2_800 })
    expect(result.catalog.lunchSides.map((item) => item.name)).toEqual(['אורז לבן', 'פסטה אדומה', 'פסטה נקיה'])
  })

  it('removes superseded manual fish and salad charges instead of double charging', () => {
    const store = {
      orders: [],
      menu: {
        extras: [
          { name: 'תוספת מנת דג', price: 35 },
          { name: 'תוספת קציצות דגים', price: 70 },
          { name: 'תוספת 4 סלטים לבחירה', price: 25 },
          { name: 'תוספת חלה', price: 10 },
          { id: 'extra-safe', name: 'אקסטרה בטוחה', price: 12.34 },
        ],
      },
    } as LegacyStore

    const result = loadSettingsCatalog(store)

    expect(result.catalog.extras).toEqual([{ id: 'extra-safe', name: 'אקסטרה בטוחה', priceMinorUnits: 1_234 }])
    expect(result.warnings.filter((warning) => warning.code === 'SUPERSEDED_EXTRA_REMOVED')).toHaveLength(4)
  })

  it('canonicalizes every automatic reserved extra name and refuses to add or persist variants', () => {
    const store = {
      orders: [],
      menu: {
        extras: [
          { name: '  תוספת\u00a0\u00a0מנת   דג  ', price: 35 },
          { name: '  משלוח\u00a0 ', price: 15 },
          { name: '  תוספת   חלה ', price: 10 },
          { name: '  אקסטרה   בטוחה  ', price: 12, protectedMetadata: { keep: true } },
        ],
      },
    } as LegacyStore

    const loaded = loadSettingsCatalog(store)

    expect(loaded.catalog.extras).toEqual([
      {
        id: expect.stringMatching(/^extra-/),
        name: 'אקסטרה בטוחה',
        priceMinorUnits: 1_200,
      },
    ])
    expect(loaded.warnings.filter((warning) => warning.code === 'SUPERSEDED_EXTRA_REMOVED')).toHaveLength(3)
    expect(() => addCatalogExtra(DEFAULT_SETTINGS_CATALOG, ' תוספת\u00a0 מנת   דג ', 3_500)).toThrow(
      'reserved for automatic pricing',
    )
    expect(() => addCatalogExtra(DEFAULT_SETTINGS_CATALOG, '  משלוח  ', 1_500)).toThrow(
      'reserved for automatic pricing',
    )
    expect(() => addCatalogExtra(DEFAULT_SETTINGS_CATALOG, ' תוספת   חלה ', 1_000)).toThrow(
      'reserved for automatic pricing',
    )

    const saved = applyCatalogToStore(store, loaded.catalog) as Record<string, unknown>
    expect((saved.menu as { extras: Array<Record<string, unknown>> }).extras).toEqual([
      expect.objectContaining({ name: 'אקסטרה בטוחה', protectedMetadata: { keep: true } }),
    ])

    const unsafe = structuredClone(DEFAULT_SETTINGS_CATALOG) as SettingsCatalog
    ;(unsafe.extras as Array<{ id: string; name: string; priceMinorUnits: number }>).push({
      id: 'unsafe-delivery-extra',
      name: '  משלוח\u00a0 ',
      priceMinorUnits: 1_500,
    })
    expect(validateSettingsCatalog(unsafe)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SUPERSEDED_EXTRA_REMOVED' }),
    ]))
    expect(() => applyCatalogToStore(EMPTY_STORE, unsafe)).toThrow('reserved for automatic pricing')
  })

  it('keeps the three authoritative first-course rows immutable and rejects unsafe additions or replacements', () => {
    for (const item of AUTHORITATIVE_FIRST_COURSE_ITEMS) {
      expect(() => removeCatalogItem(DEFAULT_SETTINGS_CATALOG, 'firsts', item.id)).toThrow(
        'cannot be removed',
      )
    }
    expect(() => addCatalogItem(DEFAULT_SETTINGS_CATALOG, 'firsts', 'דג אחר')).toThrow(
      'cannot be added',
    )

    const renamed = structuredClone(DEFAULT_SETTINGS_CATALOG) as SettingsCatalog
    ;(renamed.categories.firsts as Array<{ id: string; name: string }>)[0] = {
      ...renamed.categories.firsts[0]!,
      name: 'פילה חלופי',
    }
    const issues = validateSettingsCatalog(renamed)
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'AUTHORITATIVE_FIRST_COURSE_REQUIRED' }),
      expect.objectContaining({ code: 'UNSAFE_FIRST_COURSE_ITEM' }),
    ]))
    expect(() => applyCatalogToStore(EMPTY_STORE, renamed)).toThrow('must retain its authoritative name and ID')
  })

  it('retains stable item IDs across an apply and reload cycle', () => {
    const added = addCatalogItem(DEFAULT_SETTINGS_CATALOG, 'mains', 'מנה עונתית')
    const item = added.categories.mains.find((candidate) => candidate.name === 'מנה עונתית')!
    const saved = applyCatalogToStore({ orders: [], preserved: { exact: true } } as LegacyStore, added)
    const reloaded = loadSettingsCatalog(saved)

    expect(reloaded.catalog.categories.mains.find((candidate) => candidate.name === 'מנה עונתית')?.id).toBe(item.id)
    expect((saved as Record<string, unknown>).preserved).toEqual({ exact: true })
    expect((saved as Record<string, unknown>).menu).toMatchObject({
      couplePrice: 230,
      challahPrice: 10,
      includedFish: 2,
      fishExtraPrice: 30,
      saladBlockPrice: 25,
      saladUnitPrice: 7,
    })
  })

  it('preserves intentional empty lists and blocks malformed rows instead of silently restoring defaults', () => {
    const empty = loadSettingsCatalog({
      orders: [],
      menu: { salads: [], extras: [] },
    } as LegacyStore)
    const malformed = loadSettingsCatalog({
      orders: [],
      menu: { salads: [{ unexpected: true }] },
    } as LegacyStore)

    expect(empty.catalog.categories.salads).toEqual([])
    expect(empty.catalog.extras).toEqual([])
    expect(empty.warnings).toEqual([])
    expect(malformed.catalog.categories.salads).toEqual([])
    expect(malformed.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INVALID_MENU_ITEM', path: 'salads.0' }),
    ]))
  })

  it('fails closed before malformed menu containers can be replaced by defaults', () => {
    const malformedRoot = { orders: [], menu: ['opaque', { keep: true }] } as LegacyStore
    const loaded = loadSettingsCatalog(malformedRoot)

    expect(loaded.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INVALID_MENU_STRUCTURE', path: 'menu' }),
    ]))
    expect(() => applyCatalogToStore(malformedRoot, loaded.catalog)).toThrow('menu must be an object')
  })

  it('fails closed on duplicate known lunch rows and malformed side entries', () => {
    const store = {
      orders: [],
      menu: {
        lunch: [
          { key: 'baguette', price: 22 },
          { key: 'baguette', price: 99, futureMetadata: { keep: true } },
        ],
        lunchSides: ['אורז לבן', { futureSide: { keep: true } }],
      },
    } as LegacyStore
    const loaded = loadSettingsCatalog(store)

    expect(loaded.catalog.lunch.find((item) => item.key === 'baguette')?.priceMinorUnits).toBe(2_200)
    expect(loaded.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'DUPLICATE_LUNCH_OVERRIDE', path: 'lunch.1.key' }),
      expect.objectContaining({ code: 'INVALID_MENU_ITEM', path: 'lunchSides.1' }),
    ]))
    expect(() => applyCatalogToStore(store, loaded.catalog)).toThrow('duplicate lunch override key baguette')
  })

  it('retains unknown per-item metadata while replacing only validated catalog fields', () => {
    const store = {
      orders: [],
      menu: {
        untouchedMenuField: { keep: true },
        itemIds: { futureCategory: { keep: 'id' } },
        extras: [{
          id: DEFAULT_SETTINGS_CATALOG.extras[0]!.id,
          name: DEFAULT_SETTINGS_CATALOG.extras[0]!.name,
          price: 10,
          procurementNote: { keep: true },
        }],
        lunch: [{
          key: 'schnitzel-plate',
          futureLunchField: true,
          variants: [{ k: 'single', price: 35, sidePrice: 15, futureVariantField: 'keep' }],
        }],
      },
    } as LegacyStore
    const catalog = loadSettingsCatalog(store).catalog
    const saved = applyCatalogToStore(store, catalog) as Record<string, unknown>
    const menu = saved.menu as Record<string, unknown>
    const extra = (menu.extras as Array<Record<string, unknown>>)[0]!
    const plate = (menu.lunch as Array<Record<string, unknown>>).find((item) => item.key === 'schnitzel-plate')!
    const single = (plate.variants as Array<Record<string, unknown>>).find((item) => item.k === 'single')!

    expect(menu.untouchedMenuField).toEqual({ keep: true })
    expect((menu.itemIds as Record<string, unknown>).futureCategory).toEqual({ keep: 'id' })
    expect(extra.procurementNote).toEqual({ keep: true })
    expect(plate.futureLunchField).toBe(true)
    expect(single.futureVariantField).toBe('keep')
  })

  it('builds a complete strict preparation catalog and retains explicit procurement policies', () => {
    const salad = DEFAULT_SETTINGS_CATALOG.categories.salads[0]!
    const store = {
      orders: [],
      preparationCatalog: {
        items: [{
          id: salad.id,
          category: 'salads',
          name: salad.name,
          legacyNames: ['שם היסטורי'],
          procurement: {
            kind: 'direct',
            ingredientId: 'ready-salad',
            ingredientName: 'סלט מוכן',
            unit: 'קופסה',
            quantityPerItem: '1',
          },
        }],
        lunchItems: [],
      },
    } as LegacyStore

    const preparation = buildPreparationCatalog(DEFAULT_SETTINGS_CATALOG, store)

    expect(preparation.items.find((item) => item.id === salad.id)).toEqual({
      id: salad.id,
      category: 'salads',
      name: salad.name,
      legacyNames: ['שם היסטורי'],
      procurement: {
        kind: 'direct',
        ingredientId: 'ready-salad',
        ingredientName: 'סלט מוכן',
        unit: 'קופסה',
        quantityPerItem: '1',
      },
    })
    expect(preparation.items.some((item) => item.name === 'משלוח')).toBe(false)
    expect(preparation.items.find((item) => item.name === 'מרק ירקות לקוסקוס ללא עוף')?.procurement).toEqual({ kind: 'recipe' })
    expect(preparation.lunchItems).toHaveLength(5)
  })

  it('preserves unknown preparation metadata through menu and recipe projections', () => {
    const salad = DEFAULT_SETTINGS_CATALOG.categories.salads[0]!
    const store = {
      orders: [],
      preparationCatalog: {
        futureRootMetadata: { keep: ['exactly', 7] },
        items: [{
          id: salad.id,
          category: 'salads',
          name: salad.name,
          procurement: { kind: 'recipe' },
          futureItemMetadata: { keep: true },
        }],
        lunchItems: [
          {
            key: 'baguette',
            name: 'בגט טוניסאי אותנטי',
            itemId: 'lunch-tunisian-baguette',
            procurement: { kind: 'recipe' },
            futureLunchMetadata: ['keep'],
          },
          {
            key: 'schnitzel-plate',
            name: 'שניצל בצלחת',
            variants: [{
              key: 'single',
              itemId: 'lunch-schnitzel-plate-single',
              name: 'אישית',
              procurement: { kind: 'recipe' },
              futureVariantMetadata: { keep: 'variant' },
            }],
          },
          {
            key: 'couscous',
            name: 'ספיישל קוסקוס',
            itemId: 'lunch-couscous-special',
            procurement: { kind: 'recipe' },
            addon: {
              itemId: 'lunch-couscous-mafrum',
              name: 'מנת מפרום ביתי',
              procurement: { kind: 'recipe' },
              futureAddonMetadata: { keep: 'addon' },
            },
          },
        ],
      },
    } as LegacyStore
    const snapshot = structuredClone(store)

    const projections = [
      applyCatalogToStore(store, DEFAULT_SETTINGS_CATALOG),
      applyRecipesToStore(store, [], DEFAULT_SETTINGS_CATALOG),
    ] as Array<Record<string, unknown>>

    for (const projection of projections) {
      const preparation = projection.preparationCatalog as Record<string, unknown>
      const items = preparation.items as Array<Record<string, unknown>>
      const lunchItems = preparation.lunchItems as Array<Record<string, unknown>>
      const baguette = lunchItems.find((item) => item.key === 'baguette')!
      const plate = lunchItems.find((item) => item.key === 'schnitzel-plate')!
      const couscous = lunchItems.find((item) => item.key === 'couscous')!

      expect(preparation.futureRootMetadata).toEqual({ keep: ['exactly', 7] })
      expect(items.find((item) => item.id === salad.id)?.futureItemMetadata).toEqual({ keep: true })
      expect(baguette.futureLunchMetadata).toEqual(['keep'])
      expect((plate.variants as Array<Record<string, unknown>>)[0]?.futureVariantMetadata).toEqual({ keep: 'variant' })
      expect((couscous.addon as Record<string, unknown>).futureAddonMetadata).toEqual({ keep: 'addon' })
    }
    expect(store).toEqual(snapshot)
  })

  it('rejects duplicate IDs and every malformed core, extra, and lunch price', () => {
    const catalog = structuredClone(DEFAULT_SETTINGS_CATALOG) as SettingsCatalog
    const duplicateId = catalog.categories.salads[0]!.id
    ;(catalog.categories.mains as Array<{ id: string; name: string }>)[0] = {
      ...catalog.categories.mains[0]!,
      id: duplicateId,
    }
    ;(catalog.extras as Array<{ id: string; name: string; priceMinorUnits: number }>)[0] = {
      ...catalog.extras[0]!,
      priceMinorUnits: -1,
    }
    ;(catalog.lunch[0] as { priceMinorUnits: number }).priceMinorUnits = 1.5

    const issues = validateSettingsCatalog(catalog)

    expect(issues.some((issue) => issue.code === 'DUPLICATE_ITEM_ID')).toBe(true)
    expect(issues.filter((issue) => issue.code === 'INVALID_PRICE')).toHaveLength(2)
    expect(() => applyCatalogToStore(EMPTY_STORE, catalog)).toThrow()
    expect(() => updateLunchPrice(DEFAULT_SETTINGS_CATALOG, { kind: 'base', itemKey: 'missing' }, 1_000)).toThrow(
      'unknown lunch price path',
    )
  })

  it('fails closed on malformed persisted prices instead of turning absent values into zero', () => {
    const missing = loadSettingsCatalog({ orders: [], menu: {} } as LegacyStore)
    const malformed = loadSettingsCatalog({
      orders: [],
      menu: { couplePrice: '1.234', extras: [{ name: 'אקסטרה בטוחה', price: '1.234' }] },
    } as LegacyStore)

    expect(missing.catalog.couplePriceMinorUnits).toBe(23_000)
    expect(missing.warnings).toEqual([])
    expect(malformed.catalog.couplePriceMinorUnits).toBe(23_000)
    expect(malformed.catalog.extras[0]?.priceMinorUnits).toBe(0)
    expect(malformed.warnings.filter((warning) => warning.code === 'INVALID_PRICE')).toHaveLength(2)
  })
})

describe('recipe settings domain', () => {
  it('reports missing recipes without inventing a yield, quantity, unit, or conversion', () => {
    const book = loadRecipeBook(EMPTY_STORE, DEFAULT_SETTINGS_CATALOG)

    expect(book.recipes).toEqual([])
    expect(book.missingTargets).toEqual(recipeTargets(DEFAULT_SETTINGS_CATALOG))
    expect(book.missingTargets.some((target) => target.name === 'קוסקוס עננים')).toBe(true)
    expect(book.saveable).toBe(true)
  })

  it('retains invalid raw records and blocks replacement when strict fields or duplicate IDs conflict', () => {
    const valid = {
      itemId: 'shabbat-mains-01',
      yield: 2,
      ingredients: [{ ingredientId: 'tomato', ingredientName: 'עגבנייה', quantity: '1', unit: 'kg' }],
    }
    const store = {
      orders: [],
      recipes: [valid, { ...valid }, { ...valid, itemId: 'bad', yeild: 2 }],
    } as LegacyStore

    const book = loadRecipeBook(store, DEFAULT_SETTINGS_CATALOG)

    expect(book.records).toHaveLength(3)
    expect(book.records[2]).toMatchObject({ sourceIndex: 2, valid: false, value: { itemId: 'bad', yeild: 2 } })
    expect(book.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('duplicate recipe itemId'),
      expect.stringContaining('Unrecognized key'),
    ]))
    expect(book.saveable).toBe(false)
  })

  it('treats a non-array recipe container as an invalid retained source', () => {
    const raw = {
      itemId: 'shabbat-mains-01',
      yield: 2,
      ingredients: [{ ingredientId: 'tomato', ingredientName: 'עגבנייה', quantity: '1', unit: 'kg' }],
    }
    const book = loadRecipeBook({ orders: [], recipes: raw } as LegacyStore, DEFAULT_SETTINGS_CATALOG)

    expect(book.saveable).toBe(false)
    expect(book.recipes).toEqual([])
    expect(book.records[0]).toMatchObject({ valid: false, value: raw })
    expect(book.issues).toEqual(['recipes: recipes must be an array'])
  })

  it('allocates stable ingredient IDs without changing them when labels or units are edited', () => {
    const first = nextStableIngredientId('shabbat-mains-01', [])
    const repeated = nextStableIngredientId('shabbat-mains-01', [])
    const second = nextStableIngredientId('shabbat-mains-01', [{ ingredientId: first }])

    expect(first).toBe(repeated)
    expect(second).toBe(`${first}-2`)
    expect(nextStableIngredientId('shabbat-mains-02', [])).not.toBe(first)
  })

  it('strictly rejects unknown keys, invalid waste, duplicate recipes, and ingredient identity conflicts', () => {
    const base: RecipeDraft = {
      itemId: 'shabbat-mains-01',
      name: 'מנה',
      yield: '4',
      ingredients: [
        { ingredientId: 'tomato', ingredientName: 'עגבנייה', quantity: '1.250', unit: 'kg', wastePercent: '10' },
      ],
    }
    const unknown = { ...base, conversion: 'automatic' } as RecipeDraft
    const badWaste: RecipeDraft = {
      ...base,
      ingredients: [{ ...base.ingredients[0]!, wastePercent: '100.01' }],
    }
    const conflict: RecipeDraft = {
      ...base,
      ingredients: [
        ...base.ingredients,
        { ingredientId: 'tomato', ingredientName: 'עגבניות', quantity: '1', unit: 'kg' },
      ],
    }

    expect(validateRecipeDrafts([unknown]).valid).toBe(false)
    expect(validateRecipeDrafts([badWaste]).valid).toBe(false)
    expect(validateRecipeDrafts([conflict]).issues.join(' ')).toContain('conflicts with the name')
    expect(validateRecipeDrafts([base, base]).issues).toContain('duplicate recipe itemId: shabbat-mains-01')
  })

  it('persists canonical recipe strings exactly and preserves unrelated store data', () => {
    const draft: RecipeDraft = {
      itemId: 'shabbat-mains-01',
      name: 'מנה',
      yield: '4',
      ingredients: [
        { ingredientId: 'tomato', ingredientName: 'עגבנייה', quantity: '1.250', unit: 'ק״ג', wastePercent: '10.5' },
      ],
    }
    const result = validateRecipeDrafts([draft])
    expect(result.valid).toBe(true)
    const saved = applyRecipesToStore({ orders: [], untouched: ['yes'] } as LegacyStore, result.recipes)

    expect((saved as Record<string, unknown>).untouched).toEqual(['yes'])
    expect((saved as Record<string, unknown>).recipes).toEqual([
      {
        itemId: 'shabbat-mains-01',
        name: 'מנה',
        yield: 4,
        ingredients: [
          { ingredientId: 'tomato', ingredientName: 'עגבנייה', quantity: '1.250', unit: 'ק״ג', wastePercent: '10.5' },
        ],
      },
    ])
  })
})
