import { describe, expect, it } from 'vitest'
import {
  AUTHORITATIVE_ALLOWANCES,
  AUTHORITATIVE_FIRST_COURSE_ITEMS,
  DEFAULT_SETTINGS_CATALOG,
  REVIEWED_LEGACY_PREPARATION_ITEMS,
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
  renameCatalogExtra,
  renameCatalogItem,
  resolvePreparationCatalog,
  recipeTargets,
  updateLunchPrice,
  validateRecipeDrafts,
  validateSettingsCatalog,
  type CatalogItem,
  type PricedCatalogItem,
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
    expect(result.catalog.categories.firsts).toEqual(
      AUTHORITATIVE_FIRST_COURSE_ITEMS.map((item) => ({ ...item, description: '', imageUrl: null })),
    )
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

    expect(result.catalog.extras).toEqual([
      { id: 'extra-safe', name: 'אקסטרה בטוחה', priceMinorUnits: 1_234, description: '', imageUrl: null },
    ])
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
        description: '',
        imageUrl: null,
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
    ;(unsafe.extras as PricedCatalogItem[]).push({
      id: 'unsafe-delivery-extra',
      name: '  משלוח\u00a0 ',
      priceMinorUnits: 1_500,
      description: '',
      imageUrl: null,
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
    ;(renamed.categories.firsts as CatalogItem[])[0] = {
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

  it('rejects renaming the authoritative first-course rows but allows renaming elsewhere, keeping the same ID', () => {
    for (const item of AUTHORITATIVE_FIRST_COURSE_ITEMS) {
      expect(() => renameCatalogItem(DEFAULT_SETTINGS_CATALOG, 'firsts', item.id, 'שם אחר')).toThrow(
        'cannot be renamed',
      )
    }

    const target = DEFAULT_SETTINGS_CATALOG.categories.salads[0]!
    const renamed = renameCatalogItem(DEFAULT_SETTINGS_CATALOG, 'salads', target.id, '  סלט חדש  ')
    const renamedItem = renamed.categories.salads.find((item) => item.id === target.id)
    expect(renamedItem?.name).toBe('סלט חדש')
    expect(renamed.categories.salads).toHaveLength(DEFAULT_SETTINGS_CATALOG.categories.salads.length)

    expect(() => renameCatalogItem(DEFAULT_SETTINGS_CATALOG, 'salads', target.id, '')).toThrow('nonblank')
    const secondItem = DEFAULT_SETTINGS_CATALOG.categories.salads[1]!
    expect(() => renameCatalogItem(DEFAULT_SETTINGS_CATALOG, 'salads', target.id, secondItem.name)).toThrow(
      'already exists',
    )

    const saved = applyCatalogToStore({ orders: [] } as LegacyStore, renamed)
    const reloaded = loadSettingsCatalog(saved)
    expect(reloaded.catalog.categories.salads.find((item) => item.id === target.id)?.name).toBe('סלט חדש')
  })

  it('renames an extra in place, keeping its price and ID, and rejects reserved or duplicate names', () => {
    const target = DEFAULT_SETTINGS_CATALOG.extras[0]!
    const renamed = renameCatalogExtra(DEFAULT_SETTINGS_CATALOG, target.id, '  אקסטרה חדשה  ')
    const renamedItem = renamed.extras.find((item) => item.id === target.id)
    expect(renamedItem).toMatchObject({ id: target.id, name: 'אקסטרה חדשה', priceMinorUnits: target.priceMinorUnits })

    expect(() => renameCatalogExtra(DEFAULT_SETTINGS_CATALOG, target.id, '')).toThrow('nonblank')
    expect(() => renameCatalogExtra(DEFAULT_SETTINGS_CATALOG, target.id, 'משלוח')).toThrow(
      'reserved for automatic pricing',
    )
    const secondExtra = DEFAULT_SETTINGS_CATALOG.extras[1]!
    expect(() => renameCatalogExtra(DEFAULT_SETTINGS_CATALOG, target.id, secondExtra.name)).toThrow(
      'already exists',
    )
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

  it('resolves every active default category, extra, and lunch identity when preparation is missing', () => {
    const resolved = resolvePreparationCatalog(EMPTY_STORE)

    expect(resolved.state).toBe('missing')
    expect(resolved.issues).toEqual([])
    for (const category of ['salads', 'firsts', 'mains', 'sides', 'desserts'] as const) {
      expect(
        resolved.catalog.items
          .filter((item) => item.category === category)
          .map((item) => ({ id: item.id, name: item.name })),
      ).toEqual(DEFAULT_SETTINGS_CATALOG.categories[category].map((item) => ({ id: item.id, name: item.name })))
    }
    expect(
      resolved.catalog.items
        .filter((item) => item.category === 'extras')
        .map((item) => item.name),
    ).toEqual(DEFAULT_SETTINGS_CATALOG.extras.map((item) => item.name))
    expect(resolved.catalog.lunchItems.map((item) => item.key)).toEqual(
      DEFAULT_SETTINGS_CATALOG.lunch.map((item) => item.key),
    )
  })

  it('completes empty and partial preparation, reports malformed storage, and honors empty menu arrays', () => {
    const salad = DEFAULT_SETTINGS_CATALOG.categories.salads[0]!
    const empty = resolvePreparationCatalog({
      orders: [],
      preparationCatalog: {},
    } as LegacyStore)
    const partial = resolvePreparationCatalog({
      orders: [],
      preparationCatalog: {
        futureRoot: { keepPersistedOnly: true },
        items: [{
          id: salad.id,
          legacyNames: ['סלט היסטורי'],
          procurement: { kind: 'none' },
          futureItem: { keepPersistedOnly: true },
        }],
      },
    } as LegacyStore)
    const malformed = resolvePreparationCatalog({
      orders: [],
      preparationCatalog: { items: 'not-an-array' },
    } as LegacyStore)
    const intentionallyEmpty = resolvePreparationCatalog({
      orders: [],
      menu: { salads: [], extras: [], lunchSides: [] },
    } as LegacyStore)

    expect(empty.state).toBe('configured')
    expect(empty.catalog.items.length).toBeGreaterThan(0)
    expect(partial.state).toBe('configured')
    expect(partial.catalog.items.find((item) => item.id === salad.id)).toEqual({
      id: salad.id,
      category: 'salads',
      name: salad.name,
      legacyNames: ['סלט היסטורי'],
      procurement: { kind: 'none' },
    })
    expect(partial.catalog).not.toHaveProperty('futureRoot')
    expect(partial.catalog.items.find((item) => item.id === salad.id)).not.toHaveProperty('futureItem')
    expect(malformed.state).toBe('invalid')
    expect(malformed.issues).toContain('preparationCatalog.items must be an array')
    expect(malformed.catalog.items.length).toBeGreaterThan(0)
    expect(intentionallyEmpty.catalog.items.filter((item) => item.category === 'salads')).toEqual([])
    expect(intentionallyEmpty.catalog.items.filter((item) => item.category === 'extras')).toEqual([])
    expect(loadSettingsCatalog({ orders: [], menu: { lunchSides: [] } } as LegacyStore).catalog.lunchSides).toEqual([])
  })

  it('adds only the three reviewed legacy order identities with deterministic recipe policies', () => {
    const store = {
      orders: [{
        id: 'legacy-items',
        date: '2026-08-15',
        extras: { 'מגש אורז / קוסקוס / פסטה אדומה': { q: 1 } },
        custom: [
          { name: 'חומוס', qty: 2 },
          { name: 'מרק ירקות קוסקוס פרווה', qty: 1 },
          { name: 'פריט שרירותי', qty: 1 },
        ],
      }],
    } as LegacyStore

    const first = resolvePreparationCatalog(store)
    const second = resolvePreparationCatalog(structuredClone(store))
    const reviewedNames = new Set<string>(REVIEWED_LEGACY_PREPARATION_ITEMS.map((item) => item.name))
    const reviewed = first.catalog.items.filter((item) => reviewedNames.has(item.name))

    expect(reviewed).toEqual(REVIEWED_LEGACY_PREPARATION_ITEMS.map((item) => ({
      ...item,
      procurement: { kind: 'recipe' },
    })))
    expect(second.catalog.items.filter((item) => reviewedNames.has(item.name))).toEqual(reviewed)
    expect(first.catalog.items.some((item) => item.name === 'פריט שרירותי')).toBe(false)
  })

  it('preserves valid configured custom entries in persistence but strips their future metadata at runtime', () => {
    const store = {
      orders: [{
        id: 'custom-order',
        date: '2026-08-15',
        custom: [{ name: 'מנה פרטית מאושרת', qty: 1 }],
      }],
      preparationCatalog: {
        futureRoot: { keep: true },
        items: [{
          id: 'custom-approved-item',
          category: 'custom',
          name: 'מנה פרטית מאושרת',
          legacyNames: ['שם פרטי קודם'],
          procurement: { kind: 'none' },
          futureItem: { keep: true },
        }],
        lunchItems: [],
      },
    } as LegacyStore

    for (const persisted of [
      applyCatalogToStore(store, loadSettingsCatalog(store).catalog),
      applyRecipesToStore(store, [], loadSettingsCatalog(store).catalog),
    ] as Array<Record<string, unknown>>) {
      const preparation = persisted.preparationCatalog as Record<string, unknown>
      const custom = (preparation.items as Array<Record<string, unknown>>).find(
        (item) => item.id === 'custom-approved-item',
      )
      expect(preparation.futureRoot).toEqual({ keep: true })
      expect(custom).toMatchObject({
        category: 'custom',
        name: 'מנה פרטית מאושרת',
        futureItem: { keep: true },
      })
    }

    const runtime = resolvePreparationCatalog(store)
    expect(runtime.state).toBe('configured')
    expect(runtime.catalog).not.toHaveProperty('futureRoot')
    expect(runtime.catalog.items.find((item) => item.id === 'custom-approved-item')).toEqual({
      id: 'custom-approved-item',
      category: 'custom',
      name: 'מנה פרטית מאושרת',
      legacyNames: ['שם פרטי קודם'],
      procurement: { kind: 'none' },
    })
  })

  it('keeps used configured non-menu items and lunch while omitting unused reviewed history', () => {
    const store = {
      orders: [{
        id: 'configured-use',
        date: '2026-08-15',
        mains: { 'עיקרית שמורה': 1 },
        extras: { 'אקסטרה שמורה': { q: 2 } },
        lunch: { 'legacy-lunch': { q: 1 } },
      }],
      preparationCatalog: {
        items: [
          { id: 'saved-main', category: 'mains', name: 'עיקרית שמורה', procurement: { kind: 'none' } },
          { id: 'saved-extra', category: 'extras', name: 'אקסטרה שמורה', procurement: { kind: 'none' } },
          {
            id: REVIEWED_LEGACY_PREPARATION_ITEMS[1]!.id,
            category: 'custom',
            name: REVIEWED_LEGACY_PREPARATION_ITEMS[1]!.name,
            procurement: { kind: 'recipe' },
          },
        ],
        lunchItems: [{
          key: 'legacy-lunch',
          name: 'צהריים שמור',
          itemId: 'saved-lunch',
          procurement: { kind: 'none' },
        }],
      },
    } as LegacyStore

    const resolved = resolvePreparationCatalog(store)

    expect(resolved.state).toBe('configured')
    expect(resolved.catalog.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'saved-main', name: 'עיקרית שמורה' }),
      expect.objectContaining({ id: 'saved-extra', name: 'אקסטרה שמורה' }),
    ]))
    expect(resolved.catalog.lunchItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'legacy-lunch', itemId: 'saved-lunch' }),
    ]))
    expect(resolved.catalog.items.some((item) => item.name === 'חומוס')).toBe(false)
  })

  it('fails safely on persisted cross-section ID collisions without throwing', () => {
    const store = {
      orders: [{
        id: 'collision-use',
        date: '2026-08-15',
        custom: [{ name: 'מנה מתנגשת', qty: 1 }],
      }],
      preparationCatalog: {
        items: [{
          id: 'lunch-tunisian-baguette',
          category: 'custom',
          name: 'מנה מתנגשת',
          procurement: { kind: 'none' },
        }],
        lunchItems: [],
      },
    } as LegacyStore

    expect(() => resolvePreparationCatalog(store)).not.toThrow()
    const resolved = resolvePreparationCatalog(store)
    expect(resolved.state).toBe('invalid')
    expect(resolved.issues.join(' ')).toContain('conflicts with an authoritative lunch ID')
    expect(resolved.catalog.items.some((item) => item.name === 'מנה מתנגשת')).toBe(false)
    expect(resolved.catalog.lunchItems.some((item) => item.key === 'baguette')).toBe(true)
  })

  it('marks incomplete persisted rows invalid and gives issues precedence over a missing catalog', () => {
    const incomplete = resolvePreparationCatalog({
      orders: [],
      preparationCatalog: {
        items: [{ id: 'incomplete-item', name: 'חסר סיווג' }],
        lunchItems: [{ key: 'incomplete-lunch', name: 'חסר מזהה' }],
      },
    } as LegacyStore)
    const missingWithMenuCollision = resolvePreparationCatalog({
      orders: [],
      menu: {
        mains: ['מנה עם מזהה מתנגש'],
        itemIds: { mains: { 'מנה עם מזהה מתנגש': 'lunch-tunisian-baguette' } },
      },
    } as LegacyStore)

    expect(incomplete.state).toBe('invalid')
    expect(incomplete.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('items.0.category is invalid'),
      expect.stringContaining('items.0.procurement is invalid'),
      expect.stringContaining('lunchItems.0.itemId is invalid'),
      expect.stringContaining('lunchItems.0.procurement is invalid'),
    ]))
    expect(missingWithMenuCollision.state).toBe('invalid')
    expect(missingWithMenuCollision.issues.join(' ')).toContain('conflicts with an existing catalog ID')
    expect(missingWithMenuCollision.catalog.lunchItems.some((item) => item.key === 'baguette')).toBe(false)
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
    ;(catalog.categories.mains as CatalogItem[])[0] = {
      ...catalog.categories.mains[0]!,
      id: duplicateId,
    }
    ;(catalog.extras as PricedCatalogItem[])[0] = {
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
