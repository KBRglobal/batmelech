import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { getUsdMinorUnits } from './money.ts'
import {
  PreparationCatalogError,
  buildPreparationPlan,
  type PreparationCatalog,
} from './preparation.ts'
import type { LegacyOrder } from './store.ts'

const RECIPE = { kind: 'recipe' } as const
const NONE = { kind: 'none' } as const

const CATALOG = {
  items: [
    { id: 'salad-matbucha', category: 'salads', name: 'Matbucha', procurement: RECIPE },
    { id: 'salad-tahini', category: 'salads', name: 'Tahini', procurement: RECIPE },
    { id: 'first-fish', category: 'firsts', name: 'Fish', procurement: RECIPE },
    {
      id: 'main-stew',
      category: 'mains',
      name: 'Stew',
      legacyNames: ['Old stew'],
      procurement: RECIPE,
    },
    { id: 'main-chicken', category: 'mains', name: 'Chicken', procurement: RECIPE },
    { id: 'side-rice', category: 'sides', name: 'Rice', procurement: RECIPE },
    { id: 'side-pasta', category: 'sides', name: 'Pasta', procurement: RECIPE },
    { id: 'dessert-souffle', category: 'desserts', name: 'Souffle', procurement: RECIPE },
    { id: 'extra-delivery', category: 'extras', name: 'Delivery', procurement: NONE },
    {
      id: 'extra-wine',
      category: 'extras',
      name: 'Wine',
      procurement: {
        kind: 'direct',
        ingredientId: 'wine-bottle',
        ingredientName: 'Wine bottle',
        unit: 'each',
        quantityPerItem: '1',
      },
    },
    { id: 'custom-chef', category: 'custom', name: 'Chef special', procurement: NONE },
  ],
  lunchItems: [
    {
      key: 'schnitzel-plate',
      name: 'Schnitzel plate',
      allowsSides: true,
      variants: [
        {
          key: 'single',
          itemId: 'lunch-plate-single',
          name: 'Individual',
          procurement: RECIPE,
        },
        {
          key: 'couple',
          itemId: 'lunch-plate-couple',
          name: 'Couple',
          procurement: RECIPE,
        },
        {
          key: 'family',
          itemId: 'lunch-plate-family',
          name: 'Family',
          procurement: RECIPE,
        },
      ],
    },
    {
      key: 'schnitzel-roll',
      name: 'Schnitzel roll',
      variants: [
        {
          key: 'baguette',
          itemId: 'lunch-roll-baguette',
          name: 'Baguette',
          procurement: RECIPE,
        },
        {
          key: 'challah',
          itemId: 'lunch-roll-challah',
          name: 'Challah',
          procurement: RECIPE,
        },
      ],
    },
    {
      key: 'couscous',
      name: 'Couscous special',
      itemId: 'lunch-couscous',
      procurement: RECIPE,
      addon: {
        itemId: 'lunch-couscous-mafrum',
        name: 'Mafrum add-on',
        procurement: RECIPE,
      },
    },
  ],
} satisfies PreparationCatalog

function dateGroup(plan: ReturnType<typeof buildPreparationPlan>, serviceDate: string) {
  const group = plan.dates.find((candidate) => candidate.serviceDate === serviceDate)
  if (group === undefined) throw new Error(`Missing preparation group for ${serviceDate}`)
  return group
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}

function serializable<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown
}

describe('buildPreparationPlan', () => {
  it('groups active orders by real service date, uses stable aliases, and excludes every cancelled status variant', () => {
    const cancelledStatuses = ['בוטלה', ' בוטלה ', 'cancelled', ' Cancelled ', 'canceled', 'CANCELED']
    const orders: LegacyOrder[] = [
      {
        id: 'later',
        date: '2026-08-22',
        name: 'Later customer',
        meals: '1',
        mains: { Stew: '2' },
      },
      {
        id: 'earlier',
        date: '2026-08-15',
        name: 'Earlier customer',
        status: 'in-progress',
        meals: '2',
        aricha: '3',
        challot: '4',
        mains: { 'Old stew': '1' },
      },
      ...cancelledStatuses.map((status, index) => ({
        id: `cancelled-${index}`,
        date: index === 0 ? undefined : '2026-08-15',
        status,
        meals: '99',
        mains: { Stew: '99' },
      })),
    ]

    const result = buildPreparationPlan(orders, CATALOG)

    expect(result.complete).toBe(true)
    expect(result.warnings).toEqual([])
    expect(result.dates.map((group) => group.serviceDate)).toEqual([
      '2026-08-15',
      '2026-08-22',
    ])
    expect(dateGroup(result, '2026-08-15')).toMatchObject({
      orderCount: 1,
      meals: 2,
      aricha: 3,
      challot: 4,
      categories: { mains: { 'Old stew': 1 } },
      itemDemands: [
        {
          itemId: 'main-stew',
          itemName: 'Stew',
          quantity: 1,
          procurement: RECIPE,
        },
      ],
    })
    expect(dateGroup(result, '2026-08-22')).toMatchObject({
      orderCount: 1,
      meals: 1,
      categories: { mains: { Stew: 2 } },
    })
  })

  it('aggregates every legacy food category, gifts, lunch choices, extras, custom rows, and notes with order identity', () => {
    const orders: LegacyOrder[] = [
      {
        id: 'full-a',
        group: 'family-a',
        date: '2026-08-15',
        name: 'Ada',
        meals: '2',
        aricha: '3',
        challot: '4',
        salads: {
          Matbucha: { o: '2', p: '1' },
          Tahini: { p: '2' },
        },
        firsts: { Fish: '2' },
        mains: { Chicken: '1' },
        sides: { Rice: '1' },
        desserts: { Souffle: '2' },
        extras: { Delivery: { q: '2', note: 'Use side gate' } },
        custom: [{ name: 'Chef special', qty: '3', price: '17.5', note: 'No nuts' }],
        lunch: {
          'schnitzel-plate': {
            q: '2',
            v: 'family',
            sides: { Rice: '3', Pasta: '1' },
          },
          couscous: { q: '1', addon: '2' },
        },
        heat: 'Spicy',
        firstsNote: 'One mild portion',
        mainsNote: 'Slice before packing',
        notes: 'Call on arrival',
      },
      {
        id: 'full-b',
        group: 'family-b',
        date: '2026-08-15',
        name: 'Ben',
        salads: { Matbucha: { o: '1', p: '2' } },
        firsts: { Fish: '1' },
        mains: { Chicken: '2' },
        sides: { Rice: '2' },
        desserts: { Souffle: '1' },
        extras: { Delivery: { q: '1', note: 'Lobby' } },
        custom: [{ name: 'Chef special', qty: '1', price: 20, note: 'Plain' }],
        lunch: {
          'schnitzel-plate': { q: '1', v: 'family', sides: { Rice: '1' } },
        },
        notes: 'Second customer note',
      },
    ]

    const result = buildPreparationPlan(orders, CATALOG)
    const group = dateGroup(result, '2026-08-15')

    expect(result.complete).toBe(true)
    expect(group.categories).toEqual({
      salads: {
        Matbucha: { ordered: 3, gift: 3, total: 6 },
        Tahini: { ordered: 0, gift: 2, total: 2 },
      },
      firsts: { Fish: 3 },
      mains: { Chicken: 3 },
      sides: { Pasta: 1, Rice: 7 },
      desserts: { Souffle: 3 },
      extras: { Delivery: 3 },
      custom: { 'Chef special': 4 },
      lunch: {
        'lunch-couscous': 1,
        'lunch-couscous-mafrum': 2,
        'lunch-plate-family': 3,
      },
    })

    expect(group.extraDetails).toEqual([
      {
        serviceDate: '2026-08-15',
        orderId: 'full-a',
        orderGroup: 'family-a',
        customerName: 'Ada',
        source: 'custom',
        itemName: 'Chef special',
        quantity: 3,
        note: 'No nuts',
        unitPrice: '17.5',
      },
      {
        serviceDate: '2026-08-15',
        orderId: 'full-a',
        orderGroup: 'family-a',
        customerName: 'Ada',
        source: 'extra',
        itemName: 'Delivery',
        quantity: 2,
        note: 'Use side gate',
      },
      {
        serviceDate: '2026-08-15',
        orderId: 'full-b',
        orderGroup: 'family-b',
        customerName: 'Ben',
        source: 'custom',
        itemName: 'Chef special',
        quantity: 1,
        note: 'Plain',
        unitPrice: 20,
      },
      {
        serviceDate: '2026-08-15',
        orderId: 'full-b',
        orderGroup: 'family-b',
        customerName: 'Ben',
        source: 'extra',
        itemName: 'Delivery',
        quantity: 1,
        note: 'Lobby',
      },
    ])
    expect(group.lunchDetails).toEqual([
      {
        serviceDate: '2026-08-15',
        orderId: 'full-a',
        orderGroup: 'family-a',
        customerName: 'Ada',
        itemKey: 'couscous',
        itemName: 'Couscous special',
        preparationKey: 'lunch-couscous',
        quantity: 1,
        sides: [],
        addonQuantity: 2,
      },
      {
        serviceDate: '2026-08-15',
        orderId: 'full-a',
        orderGroup: 'family-a',
        customerName: 'Ada',
        itemKey: 'schnitzel-plate',
        itemName: 'Schnitzel plate (Family)',
        preparationKey: 'lunch-plate-family',
        quantity: 2,
        variantKey: 'family',
        sides: [
          { itemName: 'Pasta', quantity: 1 },
          { itemName: 'Rice', quantity: 3 },
        ],
        addonQuantity: 0,
      },
      {
        serviceDate: '2026-08-15',
        orderId: 'full-b',
        orderGroup: 'family-b',
        customerName: 'Ben',
        itemKey: 'schnitzel-plate',
        itemName: 'Schnitzel plate (Family)',
        preparationKey: 'lunch-plate-family',
        quantity: 1,
        variantKey: 'family',
        sides: [{ itemName: 'Rice', quantity: 1 }],
        addonQuantity: 0,
      },
    ])
    expect(group.heatNotes[0]).toMatchObject({
      orderId: 'full-a',
      orderGroup: 'family-a',
      heat: 'Spicy',
      firstCourseNote: 'One mild portion',
    })
    expect(group.generalNotes.map(({ orderId, orderGroup, source, text }) => ({
      orderId,
      orderGroup,
      source,
      text,
    }))).toEqual([
      {
        orderId: 'full-a',
        orderGroup: 'family-a',
        source: 'general',
        text: 'Call on arrival',
      },
      {
        orderId: 'full-a',
        orderGroup: 'family-a',
        source: 'mains',
        text: 'Slice before packing',
      },
      {
        orderId: 'full-b',
        orderGroup: 'family-b',
        source: 'general',
        text: 'Second customer note',
      },
    ])
    expect(group.itemDemands.find((demand) => demand.itemId === 'salad-matbucha')).toEqual({
      serviceDate: '2026-08-15',
      category: 'salads',
      itemId: 'salad-matbucha',
      itemName: 'Matbucha',
      quantity: 6,
      procurement: RECIPE,
      orderedQuantity: 3,
      giftQuantity: 3,
    })
  })

  it('uses the catalog first variant for empty or unknown lunch variants and validates nested sides and add-ons', () => {
    const result = buildPreparationPlan(
      [
        {
          id: 'lunch-order',
          date: '2026-08-15',
          lunch: {
            'schnitzel-plate': { q: '1', v: '' },
            'schnitzel-roll': { q: '2', v: 'unknown', sides: { Rice: '1' } },
            couscous: { q: '1', sides: 'invalid', addon: '2' },
            broken: 'invalid',
            missing: { q: '1' },
          },
        },
      ],
      CATALOG,
    )
    const group = dateGroup(result, '2026-08-15')

    expect(group.lunchDetails.map(({ itemKey, variantKey, preparationKey, addonQuantity }) => ({
      itemKey,
      variantKey,
      preparationKey,
      addonQuantity,
    }))).toEqual([
      {
        itemKey: 'couscous',
        variantKey: undefined,
        preparationKey: 'lunch-couscous',
        addonQuantity: 2,
      },
      {
        itemKey: 'schnitzel-plate',
        variantKey: 'single',
        preparationKey: 'lunch-plate-single',
        addonQuantity: 0,
      },
      {
        itemKey: 'schnitzel-roll',
        variantKey: 'baguette',
        preparationKey: 'lunch-roll-baguette',
        addonQuantity: 0,
      },
    ])
    expect(result.warnings.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: 'UNEXPECTED_LUNCH_FIELD', path: 'lunch.broken' },
      { code: 'UNEXPECTED_LUNCH_FIELD', path: 'lunch.couscous.sides' },
      { code: 'UNKNOWN_LUNCH_ITEM', path: 'lunch.missing' },
      { code: 'UNEXPECTED_LUNCH_FIELD', path: 'lunch.schnitzel-roll.sides' },
      { code: 'LUNCH_VARIANT_FALLBACK', path: 'lunch.schnitzel-roll.variant' },
    ])
  })

  it('rejects fractional, scientific, hexadecimal, unsafe, and overflowing quantities without emitting non-finite totals', () => {
    const orders = [
      {
        id: 'malformed',
        date: '2026-08-15',
        meals: '1.5',
        aricha: '1e2',
        challot: '0x10',
        firsts: { Fish: '-1' },
        sides: { Rice: 1.25 },
        desserts: { Souffle: Number.MAX_SAFE_INTEGER + 1 },
        extras: { Delivery: { q: '9'.repeat(1_000) } },
        custom: [{ name: 'Chef special', qty: Number.POSITIVE_INFINITY }],
      },
      {
        id: 'main-max',
        date: '2026-08-15',
        mains: { Stew: Number.MAX_SAFE_INTEGER },
      },
      { id: 'main-overflow', date: '2026-08-15', mains: { Stew: 1 } },
      {
        id: 'salad-max',
        date: '2026-08-15',
        salads: { Matbucha: { o: Number.MAX_SAFE_INTEGER, p: 0 } },
      },
      {
        id: 'salad-overflow',
        date: '2026-08-15',
        salads: { Matbucha: { o: 0, p: Number.MAX_SAFE_INTEGER } },
      },
    ] satisfies LegacyOrder[]

    const result = buildPreparationPlan(orders, CATALOG)
    const group = dateGroup(result, '2026-08-15')

    expect(result.complete).toBe(false)
    expect(result.warnings.filter(({ code }) => code === 'INVALID_QUANTITY')).toHaveLength(8)
    expect(result.warnings.filter(({ code }) => code === 'QUANTITY_OVERFLOW')).toHaveLength(2)
    expect(group.categories.mains.Stew).toBe(Number.MAX_SAFE_INTEGER)
    expect(group.categories.salads.Matbucha).toEqual({
      ordered: Number.MAX_SAFE_INTEGER,
      gift: 0,
      total: Number.MAX_SAFE_INTEGER,
    })
    expect(Number.isFinite(group.meals)).toBe(true)
    expect(Number.isFinite(group.categories.mains.Stew)).toBe(true)
    expect(Number.isFinite(group.categories.salads.Matbucha.total)).toBe(true)
  })

  it('omits blank and impossible dates with explicit warnings while ignoring cancelled invalid dates', () => {
    const result = buildPreparationPlan(
      [
        { id: 'blank', date: '   ', mains: { Stew: 5 } },
        { id: 'february', date: '2026-02-30', mains: { Stew: 5 } },
        { id: 'month', date: '2026-13-01', mains: { Stew: 5 } },
        { id: 'format', date: '15/08/2026', mains: { Stew: 5 } },
        { id: 'valid', date: '2026-08-15', mains: { Stew: 1 } },
        { id: 'cancelled-invalid', date: 'not-a-date', status: 'בוטלה', mains: { Stew: 99 } },
      ],
      CATALOG,
    )

    expect(result.dates.map(({ serviceDate }) => serviceDate)).toEqual(['2026-08-15'])
    expect(result.warnings.map(({ code, orderId }) => ({ code, orderId }))).toEqual([
      { code: 'MISSING_SERVICE_DATE', orderId: 'blank' },
      { code: 'INVALID_SERVICE_DATE', orderId: 'february' },
      { code: 'INVALID_SERVICE_DATE', orderId: 'format' },
      { code: 'INVALID_SERVICE_DATE', orderId: 'month' },
    ])
  })

  it('keeps finance in integer USD minor units, preserves paid semantics, clamps over-deposits, and reports invalid money', () => {
    const valid = buildPreparationPlan(
      [
        {
          id: 'unpaid',
          date: '2026-08-15',
          total: '$1,234.56',
          deposit: '$34.56',
          paid: 'לא',
        },
        { id: 'over-deposit', date: '2026-08-15', total: 10, deposit: 20, paid: 'לא' },
        { id: 'paid', date: '2026-08-15', total: 5, deposit: 1, paid: 'כן' },
        { id: 'partner', date: '2026-08-15', total: 5, deposit: 1, paid: 'שת"פ' },
      ],
      CATALOG,
    )

    expect(valid.complete).toBe(true)
    expect(getUsdMinorUnits(valid.finance.revenue)).toBe(125_456)
    expect(getUsdMinorUnits(valid.finance.deposits)).toBe(5_656)
    expect(getUsdMinorUnits(valid.finance.outstanding)).toBe(120_000)
    expect(valid.finance.valid).toBe(true)
    expect(dateGroup(valid, '2026-08-15').finance.valid).toBe(true)

    const invalid = buildPreparationPlan(
      [
        { id: 'bad-money', date: '2026-08-15', total: '$1$', deposit: '1,2,3' },
        { id: 'money-huge', date: '2026-08-15', total: '9'.repeat(1_000), paid: 'כן' },
        {
          id: 'money-max',
          date: '2026-08-15',
          total: '90071992547409.91',
          paid: 'כן',
        },
        { id: 'money-overflow', date: '2026-08-15', total: '0.01', paid: 'כן' },
      ],
      CATALOG,
    )

    expect(invalid.finance.valid).toBe(false)
    expect(getUsdMinorUnits(invalid.finance.revenue)).toBe(Number.MAX_SAFE_INTEGER)
    expect(invalid.warnings.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: 'INVALID_MONEY', path: 'deposit' },
      { code: 'INVALID_MONEY', path: 'total' },
      { code: 'MONEY_OVERFLOW', path: 'total' },
      { code: 'MONEY_OVERFLOW', path: 'finance.revenue' },
    ])
  })

  it('uses prototype-safe maps for hostile legacy item names without mutating global prototypes', () => {
    const hostileCatalog = {
      ...CATALOG,
      items: [
        ...CATALOG.items,
        { id: 'main-to-string', category: 'mains', name: 'toString', procurement: RECIPE },
        { id: 'main-constructor', category: 'mains', name: 'constructor', procurement: RECIPE },
        { id: 'main-proto', category: 'mains', name: '__proto__', procurement: RECIPE },
      ],
    } satisfies PreparationCatalog
    const hostileMains = Object.fromEntries([
      ['toString', '2'],
      ['constructor', '3'],
      ['__proto__', '4'],
    ])
    const orders = [
      {
        id: 'hostile',
        date: '2026-08-15',
        mains: hostileMains,
        future: { __proto__: { polluted: true } },
      },
    ] as LegacyOrder[]

    expect((Object.prototype as { polluted?: unknown }).polluted).toBeUndefined()
    const result = buildPreparationPlan(orders, hostileCatalog)
    const mains = dateGroup(result, '2026-08-15').categories.mains

    expect(Object.keys(mains)).toEqual(['__proto__', 'constructor', 'toString'])
    expect(Object.getOwnPropertyDescriptor(mains, '__proto__')?.value).toBe(4)
    expect(Object.values(mains).reduce((sum, quantity) => sum + quantity, 0)).toBe(9)
    expect(Object.values(mains).every(Number.isFinite)).toBe(true)
    expect((Object.prototype as { polluted?: unknown }).polluted).toBeUndefined()
  })

  it('warns for unknown legacy names but keeps their preparation totals and never invents a recipe identity', () => {
    const result = buildPreparationPlan(
      [
        {
          id: 'unknown-name',
          date: '2026-08-15',
          mains: { 'Old stew': 2, Mystery: 3 },
        },
      ],
      CATALOG,
    )
    const group = dateGroup(result, '2026-08-15')

    expect(group.categories.mains).toEqual({ Mystery: 3, 'Old stew': 2 })
    expect(group.itemDemands).toEqual([
      {
        serviceDate: '2026-08-15',
        category: 'mains',
        itemId: 'main-stew',
        itemName: 'Stew',
        quantity: 2,
        procurement: RECIPE,
      },
    ])
    expect(result.warnings).toMatchObject([
      { code: 'UNKNOWN_CATALOG_ITEM', path: 'mains.Mystery' },
    ])
  })

  it('fails closed on ambiguous or unsafe injected catalog metadata', () => {
    const duplicateId = {
      items: [
        { id: 'same', category: 'mains', name: 'First', procurement: RECIPE },
        { id: 'same', category: 'sides', name: 'Second', procurement: RECIPE },
      ],
      lunchItems: [],
    } as unknown as PreparationCatalog
    const duplicateAlias = {
      items: [
        { id: 'first', category: 'mains', name: 'First', legacyNames: ['Shared'], procurement: RECIPE },
        { id: 'second', category: 'mains', name: 'Second', legacyNames: ['Shared'], procurement: RECIPE },
      ],
      lunchItems: [],
    } as unknown as PreparationCatalog
    const zeroDirectQuantity = {
      items: [
        {
          id: 'zero',
          category: 'extras',
          name: 'Zero',
          procurement: {
            kind: 'direct',
            ingredientId: 'zero',
            ingredientName: 'Zero',
            unit: 'each',
            quantityPerItem: '0',
          },
        },
      ],
      lunchItems: [],
    } as unknown as PreparationCatalog
    const duplicateLunchKey = {
      items: [],
      lunchItems: [
        { key: 'same', name: 'First', itemId: 'first', procurement: RECIPE },
        { key: 'same', name: 'Second', itemId: 'second', procurement: RECIPE },
      ],
    } as unknown as PreparationCatalog
    const ambiguousLunchShape = {
      items: [],
      lunchItems: [
        {
          key: 'ambiguous',
          name: 'Ambiguous',
          itemId: 'base',
          procurement: RECIPE,
          variants: [
            { key: 'one', itemId: 'variant', name: 'One', procurement: RECIPE },
          ],
        },
      ],
    } as unknown as PreparationCatalog
    const unknownCatalogProperty = {
      items: [
        { id: 'unknown-key', category: 'mains', name: 'Unknown', procurement: RECIPE, recipie: true },
      ],
      lunchItems: [],
    } as unknown as PreparationCatalog

    for (const catalog of [
      duplicateId,
      duplicateAlias,
      zeroDirectQuantity,
      duplicateLunchKey,
      ambiguousLunchShape,
      unknownCatalogProperty,
    ]) {
      expect(() => buildPreparationPlan([], catalog)).toThrow(PreparationCatalogError)
    }
  })

  it('does not mutate orders, unknown legacy fields, nested maps, arrays, or catalog metadata', () => {
    const orders: LegacyOrder[] = [
      {
        id: 'frozen',
        group: 'linked',
        date: '2026-08-15',
        name: 'Frozen customer',
        salads: { Matbucha: { o: '1', p: '1' } },
        extras: { Delivery: { q: '1', note: 'Door' } },
        custom: [{ name: 'Chef special', qty: '2', price: '3', note: 'Keep' }],
        lunch: { 'schnitzel-plate': { q: '1', v: 'single', sides: { Rice: '1' } } },
        futureField: { nested: ['preserve', { exact: true }] },
      },
    ]
    const catalog = structuredClone(CATALOG)
    const orderSnapshot = structuredClone(orders)
    const catalogSnapshot = structuredClone(catalog)
    deepFreeze(orders)
    deepFreeze(catalog)

    expect(() => buildPreparationPlan(orders, catalog)).not.toThrow()
    expect(orders).toEqual(orderSnapshot)
    expect(catalog).toEqual(catalogSnapshot)
  })

  it('is invariant to order permutations and emits every collection in deterministic order', () => {
    const orders: LegacyOrder[] = [
      {
        id: 'b',
        group: 'two',
        date: '2026-08-22',
        name: 'Beta',
        mains: { Stew: 2 },
        total: '20.10',
        deposit: '0.10',
        notes: 'B note',
      },
      {
        id: 'a',
        group: 'one',
        date: '2026-08-15',
        name: 'Alpha',
        salads: { Matbucha: { o: 1, p: 1 } },
        extras: { Delivery: { q: 1, note: 'A extra' } },
        total: '0.20',
      },
      {
        id: 'c',
        group: 'one',
        date: '2026-08-15',
        name: 'Gamma',
        lunch: { couscous: { q: 1, addon: 1 } },
        notes: 'C note',
      },
      {
        id: 'tie',
        group: 'same',
        date: '2026-08-15',
        name: 'Tie',
        extras: { Delivery: { q: 2, note: 'same' } },
      },
      {
        id: 'tie',
        group: 'same',
        date: '2026-08-15',
        name: 'Tie',
        extras: { Delivery: { q: 1, note: 'same' } },
      },
    ]
    const expected = serializable(buildPreparationPlan(orders, CATALOG))

    fc.assert(
      fc.property(
        fc.shuffledSubarray(orders, { minLength: orders.length, maxLength: orders.length }),
        (permutation) => {
          expect(serializable(buildPreparationPlan(permutation, CATALOG))).toEqual(expected)
        },
      ),
      { numRuns: 50 },
    )
  })
})
