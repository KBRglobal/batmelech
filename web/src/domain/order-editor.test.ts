import { describe, expect, it } from 'vitest'
import {
  AIReviewSchema,
  HOTEL_OPTIONS,
  applyAIReviewToDraft,
  applyHotelSelection,
  buildAIOrderCatalog,
  buildOrderEditorMenu,
  calculateDessertAllowance,
  calculateOrderDraftPricing,
  createOrderDraft,
  createOrderDraftFromLegacy,
  nextFridayIso,
  validateOrderDraft,
  type AIReview,
  type OrderDraft,
} from './order-editor.ts'
import type { LegacyStore } from './store.ts'

const emptyStore: LegacyStore = { orders: [] }

function draftWith(patch: Partial<OrderDraft>): OrderDraft {
  return { ...createOrderDraft(buildOrderEditorMenu(emptyStore), new Date(2026, 7, 12)), ...patch }
}

function reviewWith(patch: Partial<AIReview> = {}): AIReview {
  return AIReviewSchema.parse({
    reviewOnly: true,
    draft: {
      customerName: null,
      customerPhone: null,
      serviceDate: null,
      serviceTime: null,
      fulfillmentMethod: 'unknown',
      deliveryLocation: null,
      items: [],
      notes: [],
    },
    corrections: [],
    ambiguities: [],
    paidExtras: [],
    unknownItems: [],
    missingFields: [],
    warnings: [],
    overallConfidence: 1,
    ...patch,
  })
}

describe('nextFridayIso', () => {
  it('uses the same Friday and advances every other weekday to the nearest Friday', () => {
    expect(nextFridayIso(new Date(2026, 7, 14, 23, 59))).toBe('2026-08-14')
    expect(nextFridayIso(new Date(2026, 7, 15))).toBe('2026-08-21')
    expect(nextFridayIso(new Date(2026, 7, 12))).toBe('2026-08-14')
  })

  it('handles month and year boundaries in local calendar time', () => {
    expect(nextFridayIso(new Date(2026, 11, 31))).toBe('2027-01-01')
  })
})

describe('order editor menu and drafts', () => {
  it('provides the complete legacy categories, authoritative extras, and lunch variants', () => {
    const menu = buildOrderEditorMenu(emptyStore)

    expect(menu.salads).toHaveLength(17)
    expect(menu.firsts).toEqual([
      'פילה דג ברוטב מרוקאי',
      'פילה דג ברוטב חריימה',
      'קציצות דגים ברוטב מרוקאי',
    ])
    expect(menu.extras).toEqual(
      expect.arrayContaining([
        { name: 'אורז', priceMinorUnits: 2_500 },
        { name: 'פסטה אדומה', priceMinorUnits: 2_500 },
        { name: 'קוסקוס', priceMinorUnits: 2_500 },
        { name: 'תוספת יין', priceMinorUnits: 500 },
      ]),
    )
    expect(menu.extras.map(({ name }) => name)).not.toContain('תוספת מנת דג')
    expect(menu.extras.map(({ name }) => name)).not.toContain('תוספת קציצות דגים')
    expect(menu.lunch.find((item) => item.key === 'schnitzel-plate')?.variants).toHaveLength(3)
  })

  it('uses persisted menu values only when they are structurally usable', () => {
    const menu = buildOrderEditorMenu({
      orders: [],
      menu: {
        salads: ['סלט עונתי'],
        firsts: [],
        extras: [{ name: 'פריט מיוחד', price: 12.34 }],
        couplePrice: 240.5,
        includedChallot: 3,
      },
    })

    expect(menu.salads).toEqual(['סלט עונתי'])
    expect(menu.firsts).toHaveLength(3)
    expect(menu.extras).toEqual([{ name: 'פריט מיוחד', priceMinorUnits: 1_234 }])
    expect(menu.couplePriceMinorUnits).toBe(24_050)
    expect(menu.includedChallahs).toBe(3)

    expect(buildOrderEditorMenu({ orders: [], menu: { includedChallot: 'invalid' } }).includedChallahs).toBe(2)
  })

  it('creates the complete fresh draft and preserves unknown legacy fields on edit', () => {
    const menu = buildOrderEditorMenu(emptyStore)
    const fresh = createOrderDraft(menu, new Date(2026, 7, 12))
    const original = {
      id: 'live-1',
      date: '2026-08-22',
      name: 'לקוחה',
      meals: '2',
      challot: 5,
      salads: { 'טחינה': { o: 1, p: 2 } },
      unknownProductionField: { keep: true },
    }
    const edited = createOrderDraftFromLegacy(original, menu)

    expect(fresh).toMatchObject({ date: '2026-08-14', meals: 1, challot: 2, status: 'חדשה', paid: 'לא' })
    expect(edited).toMatchObject({ id: 'live-1', meals: 2, challot: 5 })
    expect(edited.salads['טחינה']).toEqual({ ordered: 1, gift: 2 })
    expect(edited.unknownProductionField).toEqual({ keep: true })
    expect(original).toEqual({
      id: 'live-1',
      date: '2026-08-22',
      name: 'לקוחה',
      meals: '2',
      challot: 5,
      salads: { 'טחינה': { o: 1, p: 2 } },
      unknownProductionField: { keep: true },
    })

    expect(createOrderDraftFromLegacy({ id: 'legacy-missing-counts' }, menu)).toMatchObject({
      meals: 1,
      aricha: 0,
      challot: 2,
    })
  })
})

describe('hotel preservation', () => {
  it('stores the full Abu Dhabi navigation identity without adding Dubai', () => {
    const hotel = HOTEL_OPTIONS.find((option) => option.name === 'Rosewood Abu Dhabi')
    const selected = applyHotelSelection(
      draftWith({ address: '', hotelAddress: '', navigationUrl: '' }),
      'Rosewood Abu Dhabi',
    )

    expect(hotel?.city).toBe('אבו דאבי')
    expect(selected.address).toBe('Al Maryah Island, Abu Dhabi')
    expect(selected.navigationUrl).toContain('Al%20Maryah%20Island%2C%20Abu%20Dhabi')
    expect(selected.navigationUrl).not.toContain('Dubai')
  })

  it('never erases an address or navigation value already typed by the operator', () => {
    const selected = applyHotelSelection(
      draftWith({ address: 'הוראה שנכתבה', hotelAddress: 'כתובת שמורה', navigationUrl: 'https://maps.example/custom' }),
      'Atlantis The Palm',
    )

    expect(selected.address).toBe('הוראה שנכתבה')
    expect(selected.hotelAddress).toBe('כתובת שמורה')
    expect(selected.navigationUrl).toBe('https://maps.example/custom')
  })
})

describe('deterministic draft pricing and allowances', () => {
  it('uses two fish units per couple through the sole authoritative automatic charge', () => {
    const menu = buildOrderEditorMenu(emptyStore)
    const pricing = calculateOrderDraftPricing(
      draftWith({
        meals: 1,
        firsts: {
          'פילה דג ברוטב מרוקאי': 2,
          'פילה דג ברוטב חריימה': 1,
        },
      }),
      menu,
    )

    expect(pricing.result?.fish).toMatchObject({ selectedUnits: 3, includedUnits: 2, extraUnits: 1, surchargeMinorUnits: 3_000 })
    expect(pricing.result?.excludedLegacyExtras).toEqual([])
    expect(pricing.result?.totalMinorUnits).toBe(26_000)
  })

  it('charges standalone fish, recurring salad blocks, gifts excluded, and precise custom money', () => {
    const menu = buildOrderEditorMenu(emptyStore)
    const pricing = calculateOrderDraftPricing(
      draftWith({
        meals: 0,
        challot: 0,
        firsts: { 'קציצות דגים ברוטב מרוקאי': 1 },
        salads: { 'טחינה': { ordered: 9, gift: 4 } },
        custom: [{ name: 'פריט', quantity: 2, unitPrice: '0.10', note: '' }],
      }),
      menu,
    )

    expect(pricing.result?.fish.surchargeMinorUnits).toBe(6_000)
    expect(pricing.result?.salads).toMatchObject({ extraBlocks: 2, extraSingles: 1, surchargeMinorUnits: 5_700, giftSalads: 4 })
    expect(pricing.result?.totalMinorUnits).toBe(11_720)
  })

  it('prices every lunch variant, family included sides, excess sides, and mafrum addon', () => {
    const menu = buildOrderEditorMenu(emptyStore)
    const pricing = calculateOrderDraftPricing(
      draftWith({
        meals: 0,
        challot: 0,
        lunch: {
          'schnitzel-plate': {
            quantity: 2,
            variantKey: 'family',
            sides: { 'אורז לבן': 3, 'פסטה אדומה': 2 },
            addonQuantity: 0,
          },
          couscous: { quantity: 1, variantKey: '', sides: {}, addonQuantity: 2 },
        },
      }),
      menu,
    )

    expect(pricing.result?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'שניצל בצלחת (משפחתית — כולל 2 תוספות)', amountMinorUnits: 29_000 }),
        expect.objectContaining({ name: 'תוספות לשניצל בצלחת', amountMinorUnits: 2_500 }),
        expect.objectContaining({ name: 'מנת מפרום ביתי (לספיישל קוסקוס)', amountMinorUnits: 4_000 }),
      ]),
    )
    expect(pricing.result?.totalMinorUnits).toBe(39_000)
  })

  it('flags weekday challah without blocking and rejects malformed custom money', () => {
    const menu = buildOrderEditorMenu(emptyStore)
    const pricing = calculateOrderDraftPricing(
      draftWith({
        date: '2026-08-12',
        lunch: {
          'schnitzel-roll': { quantity: 1, variantKey: 'challah', sides: {}, addonQuantity: 0 },
        },
        custom: [{ name: 'פריט', quantity: 1, unitPrice: '1,2,3', note: '' }],
      }),
      menu,
    )

    expect(pricing.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'WEEKDAY_LUNCH_CHALLAH', blocking: false }),
        expect.objectContaining({ code: 'INVALID_CUSTOM_ITEM', blocking: true }),
      ]),
    )
  })

  it('models two souffles or one baklava portion per couple and flags excess without inventing a price', () => {
    expect(calculateDessertAllowance(draftWith({ meals: 1, desserts: { 'סופלה שוקולד': 2 } }))).toMatchObject({ selectedHalfUnits: 2, includedHalfUnits: 2, excessHalfUnits: 0 })
    expect(calculateDessertAllowance(draftWith({ meals: 2, desserts: { 'סוכריות בקלאווה': 2 } }))).toMatchObject({ selectedHalfUnits: 4, includedHalfUnits: 4, excessHalfUnits: 0 })
    const pricing = calculateOrderDraftPricing(
      draftWith({ meals: 1, desserts: { 'סופלה שוקולד': 1, 'סוכריות בקלאווה': 1 } }),
      buildOrderEditorMenu(emptyStore),
    )
    expect(pricing.issues).toContainEqual(expect.objectContaining({ code: 'DESSERT_OVERAGE' }))
    expect(pricing.result?.lines.some((line) => line.name.includes('קינוח'))).toBe(false)
  })
})

describe('validation and AI review application', () => {
  it('fails closed on the required identity fields and malformed manual money', () => {
    const issues = validateOrderDraft(
      draftWith({ date: '2026-02-30', name: '  ', total: '1,2,3', deposit: '-1' }),
    )

    expect(issues.map((issue) => issue.code)).toEqual([
      'INVALID_DATE',
      'MISSING_NAME',
      'INVALID_TOTAL',
      'INVALID_DEPOSIT',
    ])
  })

  it('builds a unique catalog from the real menu with paid prices and semantic aliases', () => {
    const catalog = buildAIOrderCatalog(buildOrderEditorMenu(emptyStore))
    const ids = catalog.items.map((item) => item.id)
    const couscous = catalog.items.find((item) => item.name === 'קוסקוס עננים')
    const wine = catalog.items.find((item) => item.name === 'תוספת יין')

    expect(new Set(ids).size).toBe(ids.length)
    expect(couscous?.aliases).toContain('קוסקוס אוורירי')
    expect(wine).toMatchObject({ isPaidExtra: true, price: 5, currency: 'USD' })
  })

  it('applies only reviewed catalog quantities to a new in-memory draft and does not mutate it', () => {
    const menu = buildOrderEditorMenu(emptyStore)
    const catalog = buildAIOrderCatalog(menu)
    const draft = createOrderDraft(menu, new Date(2026, 7, 12))
    const meal = catalog.items.find((item) => item.id === 'meal:couple')!
    const wine = catalog.items.find((item) => item.name === 'תוספת יין')!
    const review = reviewWith({
      draft: {
        customerName: 'לקוחה',
        customerPhone: '050-1111111',
        serviceDate: null,
        serviceTime: '14:00',
        fulfillmentMethod: 'delivery',
        deliveryLocation: 'Address Downtown',
        items: [
          { catalogItemId: meal.id, catalogItemName: meal.name, category: meal.category, quantity: 2, sourceText: '2 זוגיות', confidence: 1 },
          { catalogItemId: wine.id, catalogItemName: wine.name, category: wine.category, quantity: 1, sourceText: 'יין אחד', confidence: 0.9 },
        ],
        notes: ['ללא חריף'],
      },
    })
    const applied = applyAIReviewToDraft(draft, review, catalog.targetsById)

    expect(applied).toMatchObject({ name: 'לקוחה', phone: '050-1111111', meals: 2, place: 'Address Downtown', time: '14:00' })
    expect(applied.extras['תוספת יין']).toEqual({ quantity: 1, note: '' })
    expect(applied.notes).toBe('ללא חריף')
    expect(draft).toEqual(createOrderDraft(menu, new Date(2026, 7, 12)))
  })

  it('never applies an item whose server-returned ID is absent from the local catalog mapping', () => {
    const draft = draftWith({ meals: 1 })
    const review = reviewWith({
      draft: {
        customerName: null,
        customerPhone: null,
        serviceDate: null,
        serviceTime: null,
        fulfillmentMethod: 'unknown',
        deliveryLocation: null,
        items: [{ catalogItemId: 'forged', catalogItemName: 'forged', category: 'x', quantity: 99, sourceText: '99', confidence: 1 }],
        notes: [],
      },
    })

    expect(applyAIReviewToDraft(draft, review, {})).toEqual(draft)
  })
})
