import { describe, expect, it } from 'vitest'
import {
  demotePriceAvailabilityIssues,
  hasValidManualTotal,
  AIReviewSchema,
  DEFAULT_MENU_CATEGORIES,
  HOTEL_OPTIONS,
  applyAIReviewToDraft,
  applyCoupleMealQuantity,
  applyHotelNavigationInput,
  applyOrderDraftToStore,
  applyHotelSelection,
  buildAIOrderCatalog,
  buildOrderEditorMenu,
  calculateDessertAllowance,
  calculateOrderDraftPricing,
  classifyDraftSelectionMode,
  classifyStoredOrderIds,
  createCanonicalOrderId,
  createDuplicateOrderDraft,
  createOrderDraft,
  createOrderDraftFromLegacy,
  deleteOrderFromStore,
  formatUsdInputMinorUnits,
  legacyOrderEditIssue,
  nextFridayIso,
  parseUsdInputMinorUnits,
  parseHotelSearchResponse,
  serializeOrderDraft,
  validateOrderDraft,
  type AIReview,
  type HotelSearchResult,
  type OrderDraft,
} from './order-editor.ts'
import type { LegacyOrder, LegacyStore } from './store.ts'
import { buildDeliveryDashboard } from './delivery-dashboard.ts'

const emptyStore: LegacyStore = { orders: [] }

function draftWith(patch: Partial<OrderDraft>): OrderDraft {
  return {
    ...createOrderDraft(buildOrderEditorMenu(emptyStore), new Date(2026, 7, 12)),
    pickup: true,
    ...patch,
  }
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

  it('uses the Dubai business calendar across a UTC midnight boundary', () => {
    expect(nextFridayIso(new Date('2026-08-13T21:30:00.000Z'))).toBe('2026-08-14')
    expect(nextFridayIso(new Date('2026-08-14T21:00:00.000Z'))).toBe('2026-08-21')
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
    expect(menu.extras.map(({ name }) => name)).not.toContain('תוספת 4 סלטים לבחירה')
    expect(menu.extras.map(({ name }) => name)).not.toContain('תוספת חלה')
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

  it('filters every superseded automatic charge from persisted extras', () => {
    const menu = buildOrderEditorMenu({
      orders: [],
      menu: {
        extras: [
          { name: 'תוספת 4 סלטים לבחירה', price: 25 },
          { name: 'תוספת מנת דג', price: 35 },
          { name: 'תוספת קציצות דגים', price: 70 },
          { name: ' תוספת  חלה ', price: 10 },
          { name: 'תוספת יין', price: 5 },
        ],
      },
    })

    expect(menu.extras).toEqual([{ name: 'תוספת יין', priceMinorUnits: 500 }])
  })

  it('honors intentional empty configurable categories and extras without resurrecting defaults', () => {
    const menu = buildOrderEditorMenu({
      orders: [],
      menu: { salads: [], mains: [], sides: [], desserts: [], extras: [] },
    })

    expect(menu.salads).toEqual([])
    expect(menu.mains).toEqual([])
    expect(menu.sides).toEqual([])
    expect(menu.desserts).toEqual([])
    expect(menu.extras).toEqual([])
    expect(menu.firsts).toEqual([...DEFAULT_MENU_CATEGORIES.firsts])
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

  it('defaults delivery zone to Dubai for legacy orders that never stored one, and round-trips a stored zone', () => {
    const menu = buildOrderEditorMenu(emptyStore)
    expect(createOrderDraftFromLegacy({ id: 'legacy-no-zone', pickup: false }, menu)).toMatchObject({
      deliveryZone: 'dubai',
    })
    expect(createOrderDraftFromLegacy(
      { id: 'legacy-bad-zone', pickup: false, deliveryZone: 'sharjah' } as unknown as LegacyOrder,
      menu,
    )).toMatchObject({
      deliveryZone: 'dubai',
    })
    const stored = serializeOrderDraft(
      { ...createOrderDraft(menu), pickup: false, deliveryZone: 'abu-dhabi' },
      'order-zone',
    )
    expect(stored.deliveryZone).toBe('abu-dhabi')
    expect(createOrderDraftFromLegacy(stored, menu)).toMatchObject({ deliveryZone: 'abu-dhabi' })
  })

  it('preserves unknown nested legacy fields without retaining duplicate storage aliases', () => {
    const menu = buildOrderEditorMenu(emptyStore)
    const edited = createOrderDraftFromLegacy({
      id: 'order-existing',
      salads: { טחינה: { o: 2, p: 1, ordered: 99, future: 'salad' } },
      extras: { יין: { q: 1, quantity: 99, note: 'קר', future: 'extra' } },
      custom: [{ name: 'מיוחד', qty: 1, price: '0.10', future: 'custom' }],
      lunch: { baguette: { q: 1, v: '', sides: {}, addon: 0, future: 'lunch' } },
    }, menu)

    expect(edited.salads.טחינה).toEqual({ ordered: 2, gift: 1, future: 'salad' })
    expect(edited.extras.יין).toEqual({ quantity: 1, note: 'קר', future: 'extra' })
    expect(edited.custom[0]).toEqual({ name: 'מיוחד', quantity: 1, unitPrice: '0.10', note: '', future: 'custom' })
    expect(edited.lunch.baguette).toEqual({ quantity: 1, variantKey: '', sides: {}, addonQuantity: 0, future: 'lunch' })
    expect(createOrderDraftFromLegacy({
      salads: { עתידי: { o: 0, p: 0, future: 'salad' } },
      extras: { עתידי: { q: 0, future: 'extra' } },
      lunch: { future: { q: 0, future: 'lunch' } },
    }, menu)).toMatchObject({
      salads: { עתידי: { ordered: 0, gift: 0, future: 'salad' } },
      extras: { עתידי: { quantity: 0, note: '', future: 'extra' } },
      lunch: { future: { quantity: 0, variantKey: '', sides: {}, addonQuantity: 0, future: 'lunch' } },
    })
  })

  it('fails closed before opaque legacy collection values can be dropped by an edit', () => {
    const menu = buildOrderEditorMenu(emptyStore)
    const malformedOrders = [
      { id: 'bad-firsts', firsts: { דג: { quantity: 1 } } },
      { id: 'bad-salad', salads: { טחינה: 'one' } },
      { id: 'bad-extra', extras: { יין: { q: '1e2' } } },
      { id: 'bad-custom', custom: ['opaque'] },
      { id: 'bad-lunch', lunch: { baguette: { sides: ['אורז'] } } },
    ]

    for (const order of malformedOrders) {
      expect(legacyOrderEditIssue(order)).not.toBeNull()
      expect(() => createOrderDraftFromLegacy(order, menu)).toThrow()
    }
  })
})

describe('guarded order persistence projection', () => {
  const UUID_A = '123e4567-e89b-42d3-a456-426614174000'
  const UUID_B = '123e4567-e89b-42d3-a456-426614174001'

  it('generates a canonical string ID, skips a collision, and never mutates the base store', () => {
    const existing = `order-${UUID_A}`
    const store: LegacyStore = {
      orders: [{ id: existing }],
      futureTopLevel: { keep: true },
    }
    const original = structuredClone(store)
    const ids = [UUID_A, UUID_B]
    const generated = createCanonicalOrderId(store, () => ids.shift()!)
    const saved = applyOrderDraftToStore(
      store,
      draftWith({ name: 'לקוחה', total: '0.10', deposit: '0.20' }),
      { mode: 'new', orderId: generated },
    )

    expect(generated).toBe(`order-${UUID_B}`)
    expect(saved.orders).toHaveLength(2)
    expect(saved.orders[1]).toMatchObject({ id: generated, total: '0.10', deposit: '0.20' })
    expect(saved.futureTopLevel).toEqual({ keep: true })
    expect(store).toEqual(original)
  })

  it('edits exactly one canonical string ID and preserves every unknown legacy field', () => {
    const store: LegacyStore = {
      orders: [{
        id: 'live-1',
        name: 'לפני',
        futureOrderField: { keep: true },
        salads: { טחינה: { o: 1, p: 0, ordered: 99, gift: 99, future: 'salad' } },
        extras: { יין: { q: 1, quantity: 99, note: 'קר', future: 'extra' } },
        custom: [{ name: 'מיוחד', qty: 1, quantity: 99, price: '0.10', unitPrice: '99.00', future: 'custom' }],
        lunch: { baguette: { q: 1, quantity: 99, v: '', variantKey: 'bad', sides: {}, addon: 0, addonQuantity: 99, future: 'lunch' } },
      }],
      futureTopLevel: { keep: true },
    }
    const draft = createOrderDraftFromLegacy(store.orders[0]!, buildOrderEditorMenu(store))
    const saved = applyOrderDraftToStore(store, { ...draft, name: 'אחרי', total: '1.2' }, {
      mode: 'edit',
      orderId: 'live-1',
    })

    expect(saved.orders[0]).toMatchObject({
      id: 'live-1',
      name: 'אחרי',
      total: '1.20',
      futureOrderField: { keep: true },
      salads: { טחינה: { o: 1, p: 0, future: 'salad' } },
      extras: { יין: { q: 1, note: 'קר', future: 'extra' } },
      custom: [{ name: 'מיוחד', qty: 1, price: '0.10', note: '', future: 'custom' }],
      lunch: { baguette: { q: 1, v: '', sides: {}, addon: 0, future: 'lunch' } },
    })
    expect(saved.futureTopLevel).toEqual({ keep: true })
  })

  it('fails closed for malformed, numeric, or collision-equivalent IDs', () => {
    expect(classifyStoredOrderIds([{ id: 'live-1' }])).toBe('safe')
    expect(classifyStoredOrderIds([{ id: 7 }])).toBe('unsafe')
    expect(classifyStoredOrderIds([{ id: 'bad id' }])).toBe('unsafe')
    expect(classifyStoredOrderIds([{ id: 7 }, { id: '7' }])).toBe('collision')
    expect(() => applyOrderDraftToStore(
      { orders: [{ id: 7 }] },
      draftWith({ name: 'לקוחה' }),
      { mode: 'new', orderId: `order-${UUID_A}` },
    )).toThrow('unsafe order ID')
    expect(() => applyOrderDraftToStore(
      { orders: [{ id: 'bad id' }] },
      draftWith({ name: 'לקוחה' }),
      { mode: 'new', orderId: `order-${UUID_A}` },
    )).toThrow('unsafe order ID')
    expect(() => applyOrderDraftToStore(
      { orders: [{ id: '7' }, { id: '7' }] },
      draftWith({ name: 'לקוחה' }),
      { mode: 'edit', orderId: '7' },
    )).toThrow('duplicate order IDs')
  })

  it('deletes exactly one order, never mutates the base store, and fails closed otherwise', () => {
    const store: LegacyStore = {
      orders: [{ id: 'live-1', name: 'נשארת' }, { id: 'live-2', name: 'נמחקת' }],
      futureTopLevel: { keep: true },
    }
    const original = structuredClone(store)
    const next = deleteOrderFromStore(store, 'live-2')
    expect(next.orders).toEqual([{ id: 'live-1', name: 'נשארת' }])
    expect(next.futureTopLevel).toEqual({ keep: true })
    expect(store).toEqual(original)

    expect(() => deleteOrderFromStore(store, 'missing')).toThrow('not unique')
    expect(() => deleteOrderFromStore(store, '')).toThrow('unsafe')
    expect(() => deleteOrderFromStore({ orders: [{ id: '7' }, { id: '7' }] }, '7')).toThrow('duplicate order IDs')
  })

  it('keeps money as exact integer-minor-unit canonical input strings', () => {
    expect(parseUsdInputMinorUnits('90071992547409.91')).toBe(Number.MAX_SAFE_INTEGER)
    expect(parseUsdInputMinorUnits('90071992547409.92')).toBeNull()
    expect(formatUsdInputMinorUnits(10)).toBe('0.10')
    expect(formatUsdInputMinorUnits(26_701)).toBe('267.01')
    expect(formatUsdInputMinorUnits(Number.MAX_SAFE_INTEGER)).toBe('90071992547409.91')
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
    expect(selected.hotelProviderId).toBe('')
    expect(selected.hotelLatitude).toBeNull()
    expect(selected.hotelLongitude).toBeNull()
  })

  it('replaces stale custom navigation when the hotel changes without erasing delivery instructions', () => {
    const selected = applyHotelSelection(
      draftWith({ address: 'הוראה שנכתבה', hotelAddress: 'כתובת שמורה', navigationUrl: 'https://maps.example/custom' }),
      'Atlantis The Palm',
    )

    expect(selected.address).toBe('הוראה שנכתבה')
    expect(selected.hotelAddress).toBe('Crescent Rd, Palm Jumeirah, Dubai')
    expect(selected.navigationUrl).toContain('Palm%20Jumeirah%2C%20Dubai')
  })

  it('retains a manual navigation override while reselecting the same hotel', () => {
    const selected = applyHotelSelection(
      draftWith({
        place: 'Atlantis The Palm',
        hotelName: 'Atlantis The Palm',
        hotelAddress: 'Crescent Rd, Palm Jumeirah, Dubai',
        address: 'הוראה שנכתבה',
        navigationUrl: 'https://maps.example/custom',
      }),
      'Atlantis The Palm',
    )

    expect(selected.navigationUrl).toBe('https://maps.example/custom')
  })

  it('replaces only previous auto-filled hotel values when selecting another hotel', () => {
    const first = applyHotelSelection(
      draftWith({ address: '', hotelAddress: '', navigationUrl: '' }),
      'Atlantis The Palm',
    )
    const second = applyHotelSelection(first, 'Rosewood Abu Dhabi')

    expect(second.hotelName).toBe('Rosewood Abu Dhabi')
    expect(second.address).toBe('Al Maryah Island, Abu Dhabi')
    expect(second.hotelAddress).toBe('Al Maryah Island, Abu Dhabi')
    expect(second.navigationUrl).toContain('Abu%20Dhabi')
    expect(second.navigationUrl).not.toContain('Dubai')
  })

  it('replaces a provider Hotel A custom route with static or provider Hotel B navigation', () => {
    const hotelA: HotelSearchResult = {
      id: 'N123',
      name: 'Hotel A Dubai',
      fullAddress: 'Hotel A, Dubai, United Arab Emirates',
      latitude: 25.2,
      longitude: 55.3,
      navigationUrl: 'https://www.google.com/maps/search/?api=1&query=25.2%2C55.3',
    }
    const hotelB: HotelSearchResult = {
      id: 'W456',
      name: 'Hotel B Abu Dhabi',
      fullAddress: 'Hotel B, Abu Dhabi, United Arab Emirates',
      latitude: 24.5,
      longitude: 54.4,
      navigationUrl: 'https://www.google.com/maps/search/?api=1&query=24.5%2C54.4',
    }
    const hotelACustomRoute = applyHotelNavigationInput(
      applyHotelSelection(draftWith({ address: 'מסירה בקבלה', pickup: false }), hotelA),
      'https://www.google.com/maps/search/?api=1&query=25.21%2C55.31',
    )

    const staticB = applyHotelSelection(hotelACustomRoute, 'Rosewood Abu Dhabi')
    expect(staticB.navigationUrl).toContain('Al%20Maryah%20Island%2C%20Abu%20Dhabi')
    expect(staticB.navigationUrl).not.toContain('25.21')
    expect(staticB.address).toBe('מסירה בקבלה')

    const providerB = applyHotelSelection(hotelACustomRoute, hotelB)
    expect(providerB.navigationUrl).toBe(hotelB.navigationUrl)
    expect(providerB.hotelProviderId).toBe(hotelB.id)
    expect(providerB.address).toBe('מסירה בקבלה')
    const stored = serializeOrderDraft({ ...providerB, name: 'לקוחה', total: '230.00' }, 'hotel-b')
    const reloaded = createOrderDraftFromLegacy(
      stored,
      buildOrderEditorMenu(emptyStore),
    )
    expect(reloaded.navigationUrl).toBe(hotelB.navigationUrl)
    expect(reloaded.hotelAddress).toBe(hotelB.fullAddress)
    expect(buildDeliveryDashboard({ orders: [stored] }).groups[0]?.destinations[0]?.navigationHref)
      .toBe(hotelB.navigationUrl)
  })

  it('validates provider responses, rejects duplicate or forged rows, and applies a dynamic result', () => {
    const hotel: HotelSearchResult = {
      id: 'N123',
      name: 'Rosewood Abu Dhabi',
      fullAddress: 'Rosewood Abu Dhabi, Al Maryah Island, Abu Dhabi, United Arab Emirates',
      latitude: 24.5012,
      longitude: 54.3875,
      navigationUrl: 'https://www.google.com/maps/search/?api=1&query=24.5012%2C54.3875',
    }
    const response = {
      results: [hotel],
      attribution: {
        label: 'OpenStreetMap contributors',
        url: 'https://www.openstreetmap.org/copyright',
      },
    }

    expect(parseHotelSearchResponse(response)?.results).toEqual([hotel])
    expect(parseHotelSearchResponse({ ...response, results: [hotel, hotel] })).toBeNull()
    expect(parseHotelSearchResponse({
      ...response,
      results: [{ ...hotel, navigationUrl: 'javascript:alert(1)' }],
    })).toBeNull()

    const selected = applyHotelSelection(
      draftWith({ address: 'להשאיר בקבלה' }),
      hotel,
    )
    expect(selected).toMatchObject({
      place: 'Rosewood Abu Dhabi',
      hotelName: 'Rosewood Abu Dhabi',
      hotelProviderId: 'N123',
      hotelAddress: hotel.fullAddress,
      hotelLatitude: 24.5012,
      hotelLongitude: 54.3875,
      navigationUrl: hotel.navigationUrl,
      address: 'להשאיר בקבלה',
    })
  })

  it('safely round-trips pickup, static, dynamic, and operator-navigation hotel drafts', () => {
    const menu = buildOrderEditorMenu(emptyStore)
    const dynamicHotel: HotelSearchResult = {
      id: 'W456',
      name: 'Dynamic Abu Dhabi Hotel',
      fullAddress: 'Saadiyat Island, Abu Dhabi, United Arab Emirates',
      latitude: 24.539,
      longitude: 54.435,
      navigationUrl: 'https://www.google.com/maps/search/?api=1&query=24.539%2C54.435',
    }
    const pickup = draftWith({ pickup: true })
    const staticHotel = applyHotelSelection(draftWith({}), 'Atlantis The Palm')
    const dynamic = applyHotelSelection(draftWith({ address: 'מסירה בקבלה' }), dynamicHotel)
    const manualNavigation = applyHotelNavigationInput(dynamic, 'https://maps.example/operator-route')
    const cases = [pickup, staticHotel, dynamic, manualNavigation]

    cases.forEach((draft, index) => {
      const stored = serializeOrderDraft({ ...draft, name: 'לקוחה', total: '0.00' }, `hotel-${index}`)
      const reloaded = createOrderDraftFromLegacy(stored, menu)
      expect(legacyOrderEditIssue(stored)).toBeNull()
      expect(reloaded.navigationUrl).toBe(draft.navigationUrl)
      expect(reloaded.hotelAddress).toBe(draft.hotelAddress)
      if (draft.hotelProviderId) {
        expect(stored).toMatchObject({
          hotelProviderId: draft.hotelProviderId,
          hotelLatitude: draft.hotelLatitude,
          hotelLongitude: draft.hotelLongitude,
        })
      } else {
        expect(stored).not.toHaveProperty('hotelProviderId')
        expect(stored).not.toHaveProperty('hotelLatitude')
        expect(stored).not.toHaveProperty('hotelLongitude')
      }
    })

    expect(manualNavigation.hotelProviderId).toBe('')
    expect(manualNavigation.hotelLatitude).toBeNull()
    expect(manualNavigation.hotelLongitude).toBeNull()
    expect(() => serializeOrderDraft({
      ...dynamic,
      navigationUrl: 'https://maps.example/forged-with-provider-id',
    }, 'hotel-inconsistent')).toThrow('Hotel provider identity is inconsistent')
  })

  it('keeps explicit reception instructions separate from a free-text hotel destination on reload', () => {
    const reloaded = createOrderDraftFromLegacy({
      id: 'free-text-hotel',
      place: 'New Abu Dhabi Hotel',
      hotelName: 'New Abu Dhabi Hotel',
      hotelAddress: '',
      address: 'מסירה בקבלה',
      navigationUrl: '',
    }, buildOrderEditorMenu(emptyStore))

    expect(reloaded.hotelName).toBe('New Abu Dhabi Hotel')
    expect(reloaded.hotelAddress).toBe('')
    expect(reloaded.address).toBe('מסירה בקבלה')
  })
})

describe('duplicate order projection', () => {
  it('retains customer, fulfillment, and item data while resetting new-order identity and payment state', () => {
    const menu = buildOrderEditorMenu(emptyStore)
    const source = {
      id: 'source-1',
      date: '2026-08-01',
      name: 'לקוחה',
      phone: '050-1234567',
      place: 'Rosewood Abu Dhabi',
      address: 'מסירה בקבלה',
      time: '14:00',
      status: 'נמסרה',
      paid: 'כן',
      deposit: '100.00',
      total: '245.00',
      meals: 1,
      mains: { 'קציצות בשר ברוטב אדום עשיר': 1 },
      salads: { טחינה: { o: 1, p: 0 } },
      futureField: { keep: true },
    }
    const original = structuredClone(source)
    const duplicate = createDuplicateOrderDraft(source, menu, new Date(2026, 7, 12))

    expect(duplicate).toMatchObject({
      id: null,
      date: '2026-08-14',
      name: 'לקוחה',
      phone: '050-1234567',
      place: 'Rosewood Abu Dhabi',
      address: 'מסירה בקבלה',
      time: '14:00',
      status: 'חדשה',
      paid: 'לא',
      deposit: '',
      total: '245.00',
      meals: 1,
      mains: { 'קציצות בשר ברוטב אדום עשיר': 1 },
      futureField: { keep: true },
    })
    expect(source).toEqual(original)
  })

  it('fails closed instead of dropping malformed legacy collection data', () => {
    expect(() => createDuplicateOrderDraft(
      { id: 'source-opaque', custom: ['opaque'] },
      buildOrderEditorMenu(emptyStore),
    )).toThrow()
  })
})

describe('deterministic draft pricing and allowances', () => {
  it('synchronizes included challahs with couple meals only while the prior automatic value is untouched', () => {
    const menu = buildOrderEditorMenu(emptyStore)
    const automatic = applyCoupleMealQuantity(
      draftWith({ meals: 1, challot: menu.includedChallahs }),
      menu,
      2,
    )
    expect(automatic).toMatchObject({ meals: 2, challot: 4 })

    const overridden = applyCoupleMealQuantity({ ...automatic, challot: 5 }, menu, 3)
    expect(overridden).toMatchObject({ meals: 3, challot: 5 })
  })

  it('prices lunch-only without the default couple meal and blocks mixed orders until explicit confirmation', () => {
    const menu = buildOrderEditorMenu(emptyStore)
    const lunch = {
      baguette: { quantity: 1, variantKey: '', sides: {}, addonQuantity: 0 },
    }
    const lunchOnly = draftWith({ meals: 0, challot: 0, lunch })
    const accidentalMixed = draftWith({ lunch })

    expect(classifyDraftSelectionMode(lunchOnly)).toBe('lunch')
    expect(calculateOrderDraftPricing(lunchOnly, menu)).toMatchObject({
      result: { totalMinorUnits: 2_200 },
      issues: [],
    })
    expect(classifyDraftSelectionMode(accidentalMixed)).toBe('mixed')
    expect(calculateOrderDraftPricing(accidentalMixed, menu).issues).toContainEqual(
      expect.objectContaining({ code: 'MIXED_LUNCH_SHABBAT_UNCONFIRMED', blocking: true }),
    )
    expect(calculateOrderDraftPricing(accidentalMixed, menu, {
      allowMixedLunchAndShabbat: true,
    })).toMatchObject({
      result: { totalMinorUnits: 25_200 },
      issues: [],
    })
  })

  it('blocks blank and over-deposited totals, but only warns on a manually adjusted total', () => {
    const expected = 23_000
    expect(validateOrderDraft(draftWith({ name: 'לקוחה', total: '' }), expected)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'INVALID_TOTAL', blocking: true })]),
    )
    expect(validateOrderDraft(draftWith({ name: 'לקוחה', total: '1.00' }), expected)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'TOTAL_MISMATCH', blocking: false })]),
    )
    expect(validateOrderDraft(draftWith({ name: 'לקוחה', total: '230.00', deposit: '231.00' }), expected)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'DEPOSIT_EXCEEDS_TOTAL', blocking: true })]),
    )
    expect(validateOrderDraft(draftWith({ name: 'לקוחה', total: '230.00', deposit: '230.00' }), expected)).toEqual([])
  })

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

  it('prices a stored extra whose saved price is not a plain number', () => {
    // A legacy store keeps a price as the string the operator typed. The
    // menu editor already reads that; the pricing engine used to fall
    // straight through to 0, so a $125 סיר קובה סלק joined the order as a
    // $0.00 line and the suggested total was quietly short by its price.
    const kubeh = 'סיר קובה סלק בתוספת אורז (ל־4 אנשים)'
    for (const storedPrice of [125, '125', '$125', null, undefined]) {
      const menu = buildOrderEditorMenu({
        orders: [],
        menu: { extras: [{ name: kubeh, price: storedPrice }] },
      } as unknown as LegacyStore)
      expect(menu.extras.find((extra) => extra.name === kubeh)?.priceMinorUnits)
        .toBe(12_500)

      const pricing = calculateOrderDraftPricing(
        draftWith({ meals: 1, extras: { [kubeh]: { quantity: 1, note: '' } } }),
        menu,
      )
      expect(pricing.issues.filter((issue) => issue.blocking)).toEqual([])
      expect(pricing.result?.lines).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: kubeh, amountMinorUnits: 12_500 })]),
      )
    }
  })

  it('refuses to save an ordered extra it cannot price instead of charging nothing', () => {
    const unknownDish = 'מנה שאינה בתפריט'
    const menu = buildOrderEditorMenu({
      orders: [],
      menu: { extras: [{ name: unknownDish }] },
    } as unknown as LegacyStore)
    expect(menu.extras.find((extra) => extra.name === unknownDish)?.priceMinorUnits).toBeNull()

    const pricing = calculateOrderDraftPricing(
      draftWith({ meals: 1, extras: { [unknownDish]: { quantity: 1, note: '' } } }),
      menu,
    )
    expect(pricing.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'UNPRICED_EXTRA', blocking: true })]),
    )
    expect(pricing.result?.lines).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: unknownDish })]),
    )
  })

  it('gives every schnitzel plate the side choice its price already covers', () => {
    const menu = buildOrderEditorMenu(emptyStore)
    // The plate requires a side and the menu price includes it
    // (docs/menu-source-of-truth-2026-08-14.md); only sides beyond the
    // allowance are a charge.
    const oneSide = calculateOrderDraftPricing(
      draftWith({
        meals: 0,
        challot: 0,
        lunch: {
          'schnitzel-plate': {
            quantity: 1,
            variantKey: 'single',
            sides: { 'אורז לבן': 1 },
            addonQuantity: 0,
          },
        },
      }),
      menu,
    )
    expect(oneSide.result?.totalMinorUnits).toBe(3_500)
    expect(oneSide.result?.lines).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'תוספות לשניצל בצלחת' })]),
    )

    const twoSides = calculateOrderDraftPricing(
      draftWith({
        meals: 0,
        challot: 0,
        lunch: {
          'schnitzel-plate': {
            quantity: 1,
            variantKey: 'couple',
            sides: { 'אורז לבן': 1, 'פסטה אדומה': 1 },
            addonQuantity: 0,
          },
        },
      }),
      menu,
    )
    expect(twoSides.result?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'תוספות לשניצל בצלחת', amountMinorUnits: 2_500 }),
      ]),
    )
    expect(twoSides.result?.totalMinorUnits).toBe(8_500)
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

  it.each([
    'תוספת מנת דג',
    '  תוספת   מנת דג  ',
    'תוספת קציצות דגים',
    'תוספת 4 סלטים לבחירה',
    'משלוח',
  ])('blocks a custom automatic-charge alias without double charging: %s', (name) => {
    const pricing = calculateOrderDraftPricing(
      draftWith({
        meals: 1,
        firsts: { 'פילה דג ברוטב מרוקאי': 3 },
        custom: [{ name, quantity: 1, unitPrice: '999.00', note: '' }],
      }),
      buildOrderEditorMenu(emptyStore),
    )

    expect(pricing.issues).toContainEqual(expect.objectContaining({ code: 'RESERVED_CUSTOM_ITEM', blocking: true }))
    expect(pricing.result?.totalMinorUnits).toBe(26_000)
  })

  it('prices each lunch plate by its own variant and pools included sides across plates', () => {
    const menu = buildOrderEditorMenu(emptyStore)
    const pricing = calculateOrderDraftPricing(
      draftWith({
        meals: 0,
        challot: 0,
        pickup: true,
        lunch: {
          'schnitzel-plate': {
            quantity: 2,
            variantKey: 'single',
            addonQuantity: 0,
            sides: { 'אורז לבן': 4 },
            plates: [
              { variantKey: 'single', sides: { 'אורז לבן': 1 } },
              { variantKey: 'family', sides: { 'אורז לבן': 3 } },
            ],
          },
        },
      }),
      menu,
    )

    expect(pricing.result?.lines).toContainEqual(expect.objectContaining({
      name: 'שניצל בצלחת (אישית)', quantity: 1, amountMinorUnits: 3_500,
    }))
    expect(pricing.result?.lines).toContainEqual(expect.objectContaining({
      name: 'שניצל בצלחת (משפחתית — כולל 2 תוספות)', quantity: 1, amountMinorUnits: 14_500,
    }))
    // 4 sides selected, 3 included (1 with the single plate, 2 with the
    // family one) → 1 excess, charged at the highest side price among the
    // chosen variants (the family's $25).
    expect(pricing.result?.lines).toContainEqual(expect.objectContaining({
      name: 'תוספות לשניצל בצלחת', quantity: 1, amountMinorUnits: 2_500,
    }))
    expect(pricing.result?.totalMinorUnits).toBe(20_500)
  })

  it('falls back to the pooled legacy lunch pricing when plates are stale or absent', () => {
    const menu = buildOrderEditorMenu(emptyStore)
    const stalePlates = calculateOrderDraftPricing(
      draftWith({
        meals: 0,
        challot: 0,
        pickup: true,
        lunch: {
          'schnitzel-plate': {
            quantity: 2,
            variantKey: 'single',
            addonQuantity: 0,
            sides: {},
            plates: [{ variantKey: 'family', sides: {} }],
          },
        },
      }),
      menu,
    )
    // One plate for a quantity of two is stale — priced as 2 × single, not family.
    expect(stalePlates.result?.lines).toContainEqual(expect.objectContaining({
      name: 'שניצל בצלחת (אישית)', quantity: 2, amountMinorUnits: 7_000,
    }))
    expect(stalePlates.result?.totalMinorUnits).toBe(7_000)
  })

  it('adds exactly one delivery charge and no charge for pickup', () => {
    const menu = buildOrderEditorMenu(emptyStore)
    const delivery = calculateOrderDraftPricing(draftWith({ pickup: false }), menu)
    const pickup = calculateOrderDraftPricing(draftWith({ pickup: true }), menu)

    expect(delivery.result?.lines).toContainEqual(expect.objectContaining({ source: 'delivery', name: 'משלוח', amountMinorUnits: 1_500 }))
    expect(delivery.result?.totalMinorUnits).toBe(24_500)
    expect(pickup.result?.totalMinorUnits).toBe(23_000)
  })

  it('prices delivery by zone: Dubai at $15, Abu Dhabi at $55', () => {
    const menu = buildOrderEditorMenu(emptyStore)
    const dubai = calculateOrderDraftPricing(draftWith({ pickup: false, deliveryZone: 'dubai' }), menu)
    const abuDhabi = calculateOrderDraftPricing(draftWith({ pickup: false, deliveryZone: 'abu-dhabi' }), menu)

    expect(dubai.result?.lines).toContainEqual(expect.objectContaining({ source: 'delivery', name: 'משלוח', amountMinorUnits: 1_500 }))
    expect(abuDhabi.result?.lines).toContainEqual(expect.objectContaining({ source: 'delivery', name: 'משלוח', amountMinorUnits: 5_500 }))
    expect(abuDhabi.result?.totalMinorUnits).toBe(28_500)
  })

  it('auto-prices an extra Shabbat main course, and still blocks unpriced side overage', () => {
    const menu = buildOrderEditorMenu(emptyStore)
    const pricing = calculateOrderDraftPricing(
      draftWith({
        meals: 1,
        mains: {
          'קציצות בשר ברוטב אדום עשיר': 1,
          'קציצות בשר עם אפונה וארטישוק': 1,
        },
        sides: { 'אורז לבן': 2 },
      }),
      menu,
    )
    // Extra main is a confirmed, priced upsell ($100/unit) — it must never
    // block the save, unlike the still-unpriced extra side.
    expect(pricing.issues.some((issue) => issue.blocking)).toBe(true)
    expect(pricing.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SIDE_OVERAGE', blocking: true }),
    ]))
    expect(pricing.result?.lines).toContainEqual(expect.objectContaining({
      name: 'עיקרית נוספת',
      quantity: 1,
      unitPriceMinorUnits: menu.extraMainPriceMinorUnits,
      amountMinorUnits: menu.extraMainPriceMinorUnits,
    }))

    const standalone = calculateOrderDraftPricing(
      draftWith({ meals: 0, challot: 0, mains: { 'קציצות בשר ברוטב אדום עשיר': 1 } }),
      menu,
    )
    expect(standalone.result?.lines).toContainEqual(expect.objectContaining({
      name: 'עיקרית נוספת',
      quantity: 1,
      unitPriceMinorUnits: menu.extraMainPriceMinorUnits,
    }))
  })

  it('respects a site-configured extra-main price instead of the $100 default', () => {
    const store: LegacyStore = { orders: [], menu: { mainExtraPrice: 75 } }
    const menu = buildOrderEditorMenu(store)
    expect(menu.extraMainPriceMinorUnits).toBe(7_500)
    const pricing = calculateOrderDraftPricing(
      draftWith({ meals: 1, mains: { 'קציצות בשר ברוטב אדום עשיר': 2 } }),
      menu,
    )
    expect(pricing.result?.lines).toContainEqual(expect.objectContaining({
      name: 'עיקרית נוספת',
      unitPriceMinorUnits: 7_500,
      amountMinorUnits: 7_500,
    }))
  })

  it('charges every challah when there are zero couple meals', () => {
    const pricing = calculateOrderDraftPricing(
      draftWith({ meals: 0, challot: 2 }),
      buildOrderEditorMenu(emptyStore),
    )
    expect(pricing.result?.lines).toContainEqual(expect.objectContaining({
      name: 'חלות נוספות',
      quantity: 2,
      amountMinorUnits: 2_000,
    }))
    expect(pricing.result?.totalMinorUnits).toBe(2_000)
  })

  it('models two souffles or one baklava portion per couple, and charges excess at the configured dessert price', () => {
    expect(calculateDessertAllowance(draftWith({ meals: 1, desserts: { 'סופלה שוקולד': 2 } }))).toMatchObject({ selectedHalfUnits: 2, includedHalfUnits: 2, excessHalfUnits: 0 })
    expect(calculateDessertAllowance(draftWith({ meals: 2, desserts: { 'סוכריות בקלוואה': 2 } }))).toMatchObject({ selectedHalfUnits: 4, includedHalfUnits: 4, excessHalfUnits: 0 })
    const unpriced = calculateOrderDraftPricing(
      draftWith({ meals: 1, desserts: { 'סופלה שוקולד': 1, 'סוכריות בקלוואה': 1 } }),
      buildOrderEditorMenu(emptyStore),
    )
    expect(unpriced.issues).not.toContainEqual(expect.objectContaining({ code: 'DESSERT_OVERAGE' }))
    expect(unpriced.result?.lines).toContainEqual(expect.objectContaining({ name: 'קינוח נוסף', quantity: 1, amountMinorUnits: 0 }))

    const priced = calculateOrderDraftPricing(
      draftWith({ meals: 1, desserts: { 'סופלה שוקולד': 1, 'סוכריות בקלוואה': 1 } }),
      { ...buildOrderEditorMenu(emptyStore), extraDessertHalfUnitMinorUnits: 500 },
    )
    expect(priced.result?.lines).toContainEqual(expect.objectContaining({ name: 'קינוח נוסף', quantity: 1, amountMinorUnits: 500 }))
  })
})

describe('validation and AI review application', () => {
  it('accepts a real ISO calendar date independently of the browser time zone', () => {
    expect(validateOrderDraft(draftWith({ date: '2026-08-14', name: 'לקוחה', total: '230.00' }))).toEqual([])
  })

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
    const schnitzelTray = catalog.items.find(
      (item) => item.name === "מגש שניצלים (זוגי, כ־13–15 יח')",
    )
    const wine = catalog.items.find((item) => item.name === 'תוספת יין')

    expect(new Set(ids).size).toBe(ids.length)
    expect(couscous?.aliases).toContain('קוסקוס אוורירי')
    expect(schnitzelTray?.aliases).toContain('מגש שניצלים')
    expect(catalog.targetsById[schnitzelTray!.id]).toEqual({
      kind: 'extra',
      name: "מגש שניצלים (זוגי, כ־13–15 יח')",
    })
    expect(wine).toMatchObject({ isPaidExtra: true, price: 5, currency: 'USD' })
  })

  it('applies the short schnitzel-tray alias to the exact authoritative extra', () => {
    const menu = buildOrderEditorMenu(emptyStore)
    const catalog = buildAIOrderCatalog(menu)
    const schnitzelTray = catalog.items.find(
      (item) => item.name === "מגש שניצלים (זוגי, כ־13–15 יח')",
    )!
    const applied = applyAIReviewToDraft(
      draftWith({ extras: {} }),
      reviewWith({
        draft: {
          customerName: null,
          customerPhone: null,
          serviceDate: null,
          serviceTime: null,
          fulfillmentMethod: 'unknown',
          deliveryLocation: null,
          items: [{
            catalogItemId: schnitzelTray.id,
            catalogItemName: schnitzelTray.name,
            category: schnitzelTray.category,
            quantity: 1,
            sourceText: 'מגש שניצלים',
            confidence: 1,
          }],
          notes: [],
        },
      }),
      catalog.targetsById,
      menu,
    )

    expect(applied.extras).toEqual({
      ["מגש שניצלים (זוגי, כ־13–15 יח')"]: { quantity: 1, note: '' },
    })
    expect(applied.extras).not.toHaveProperty('מגש שניצלים')
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
    const applied = applyAIReviewToDraft(draft, review, catalog.targetsById, menu)

    expect(applied).toMatchObject({ name: 'לקוחה', phone: '050-1111111', meals: 2, place: 'Address Downtown', time: '14:00' })
    expect(applied.challot).toBe(4)
    expect(applied.hotelName).toBe('Address Downtown')
    expect(applied.hotelAddress).toBe('')
    expect(applied.hotelProviderId).toBe('')
    expect(applied.hotelLatitude).toBeNull()
    expect(applied.hotelLongitude).toBeNull()
    expect(applied.navigationUrl).toBe('')
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

  it('does not retain an orphan AI lunch add-on when its parent lunch item is absent', () => {
    const menu = buildOrderEditorMenu(emptyStore)
    const catalog = buildAIOrderCatalog(menu)
    const addon = catalog.items.find((item) => item.name === 'מנת מפרום ביתי')!
    const review = reviewWith({
      draft: {
        customerName: null,
        customerPhone: null,
        serviceDate: null,
        serviceTime: null,
        fulfillmentMethod: 'unknown',
        deliveryLocation: null,
        items: [{
          catalogItemId: addon.id,
          catalogItemName: addon.name,
          category: addon.category,
          quantity: 2,
          sourceText: 'שתי מנות מפרום',
          confidence: 1,
        }],
        notes: [],
      },
    })
    const applied = applyAIReviewToDraft(
      draftWith({ meals: 0, challot: 0, lunch: {} }),
      review,
      catalog.targetsById,
      menu,
    )

    expect(applied.lunch).toEqual({})
    expect(calculateOrderDraftPricing(applied, menu).result?.lines).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: expect.stringContaining('מפרום') })]),
    )
  })

  it('applies a lunch dish the customer named without a digit as one portion', () => {
    const menu = buildOrderEditorMenu(emptyStore)
    const catalog = buildAIOrderCatalog(menu)
    const kubeh = catalog.items.find((item) => item.name === 'מנת קובה סלק ביתית')!
    // Customers say "אני רוצה קובה", never "קובה x1". Leaving the quantity
    // unresolved dropped the dish out of the order and off the bill.
    const applied = applyAIReviewToDraft(
      draftWith({ meals: 0, challot: 0, lunch: {} }),
      reviewWith({
        draft: {
          customerName: null,
          customerPhone: null,
          serviceDate: null,
          serviceTime: null,
          fulfillmentMethod: 'pickup',
          deliveryLocation: null,
          items: [{
            catalogItemId: kubeh.id,
            catalogItemName: kubeh.name,
            category: kubeh.category,
            quantity: null,
            sourceText: 'קובה',
            confidence: 0.9,
          }],
          notes: [],
        },
      }),
      catalog.targetsById,
      menu,
    )

    expect(applied.lunch.kubeh).toMatchObject({ quantity: 1 })
    // A weekday plate is not evidence of a Shabbat couple meal.
    expect(applied.meals).toBe(0)
    expect(calculateOrderDraftPricing(applied, menu).result?.totalMinorUnits).toBe(3_500)
  })

  it('applies a paid lunch add-on after its parent regardless of review item order', () => {
    const menu = buildOrderEditorMenu(emptyStore)
    const catalog = buildAIOrderCatalog(menu)
    const parent = catalog.items.find((item) => item.name === 'ספיישל קוסקוס')!
    const addon = catalog.items.find((item) => item.name === 'מנת מפרום ביתי')!
    const parentItem = {
      catalogItemId: parent.id,
      catalogItemName: parent.name,
      category: parent.category,
      quantity: 1,
      sourceText: 'ספיישל קוסקוס אחד',
      confidence: 1,
    }
    const addonItem = {
      catalogItemId: addon.id,
      catalogItemName: addon.name,
      category: addon.category,
      quantity: 2,
      sourceText: 'ושתי מנות מפרום',
      confidence: 1,
    }
    const apply = (items: AIReview['draft']['items']) => applyAIReviewToDraft(
      draftWith({ meals: 0, challot: 0, lunch: {} }),
      reviewWith({
        draft: {
          customerName: null,
          customerPhone: null,
          serviceDate: null,
          serviceTime: null,
          fulfillmentMethod: 'pickup',
          deliveryLocation: null,
          items,
          notes: [],
        },
      }),
      catalog.targetsById,
      menu,
    )

    const addonFirst = apply([addonItem, parentItem])
    const parentFirst = apply([parentItem, addonItem])

    expect(addonFirst.lunch).toEqual(parentFirst.lunch)
    expect(addonFirst.lunch.couscous).toMatchObject({ quantity: 1, addonQuantity: 2 })
    expect(calculateOrderDraftPricing(addonFirst, menu).result?.totalMinorUnits).toBe(7_500)
  })

  it('replaces the complete stale hotel tuple when AI delivery location changes', () => {
    const menu = buildOrderEditorMenu(emptyStore)
    const oldHotel: HotelSearchResult = {
      id: 'N123',
      name: 'Old Dubai Hotel',
      fullAddress: 'Old Dubai Hotel, Dubai, United Arab Emirates',
      latitude: 25.2,
      longitude: 55.3,
      navigationUrl: 'https://www.google.com/maps/search/?api=1&query=25.2%2C55.3',
    }
    const draft = applyHotelSelection(draftWith({ address: 'מסירה בקבלה' }), oldHotel)
    const review = reviewWith({
      draft: {
        customerName: null,
        customerPhone: null,
        serviceDate: null,
        serviceTime: null,
        fulfillmentMethod: 'delivery',
        deliveryLocation: 'New Abu Dhabi Hotel',
        items: [],
        notes: [],
      },
    })
    const applied = applyAIReviewToDraft(draft, review, {}, menu)

    expect(applied).toMatchObject({
      place: 'New Abu Dhabi Hotel',
      hotelName: 'New Abu Dhabi Hotel',
      hotelAddress: '',
      hotelProviderId: '',
      hotelLatitude: null,
      hotelLongitude: null,
      navigationUrl: '',
      address: 'מסירה בקבלה',
    })
  })
})

describe('delivery-confirmation fields through an admin edit', () => {
  const deliveryOwnedOrder = {
    id: 'order-1',
    date: '2026-08-14',
    name: 'לקוחה',
    phone: '+971501234567',
    place: 'מלון',
    address: 'Tower 7',
    time: '11:00',
    status: 'נמסרה',
    total: '100.00',
    paid: 'כן',
    meyToken: 'mey-token',
    meyLeadNudgeAt: 1_759_000_000_000,
    meyPromptMessageId: 4242,
    courierCheckinState: 'delayed',
    courierCheckinAt: 1_759_999_000_000,
    courierEtaMinutes: 20,
    courierNote: 'תנועה כבדה',
    deliveryProofUrl: 'https://pub-abc123.r2.dev/proof.jpg',
    deliveryProofAt: 1_760_000_000_000,
    deliveryProofBy: 'שליח',
    deliveredAt: 1_760_000_100_000,
    statusBeforeProof: 'במשלוח',
    plataCount: 2,
    plataDeposit: '50.00',
    plataStatus: 'awaitingPickup',
    plataPickupNote: 'בקבלה',
    plataCollectedAt: 1_760_000_200_000,
    plataDepositReturnedAt: 1_760_000_300_000,
  } satisfies LegacyOrder

  it('preserves every server-owned delivery field through the admin save round trip', () => {
    const menu = buildOrderEditorMenu(emptyStore)
    const draft = createOrderDraftFromLegacy(deliveryOwnedOrder, menu)

    const serialized = serializeOrderDraft({ ...draft, name: 'שם מעודכן' }, 'order-1')
    const saved = { ...deliveryOwnedOrder, ...serialized }

    expect(saved.name).toBe('שם מעודכן')
    expect(saved).toMatchObject({
      meyToken: 'mey-token',
      meyLeadNudgeAt: 1_759_000_000_000,
      meyPromptMessageId: 4242,
      courierCheckinState: 'delayed',
      courierCheckinAt: 1_759_999_000_000,
      courierEtaMinutes: 20,
      courierNote: 'תנועה כבדה',
      deliveryProofUrl: 'https://pub-abc123.r2.dev/proof.jpg',
      deliveryProofAt: 1_760_000_000_000,
      deliveryProofBy: 'שליח',
      deliveredAt: 1_760_000_100_000,
      statusBeforeProof: 'במשלוח',
      plataCount: 2,
      plataDeposit: '50.00',
      plataStatus: 'awaitingPickup',
      plataPickupNote: 'בקבלה',
      plataCollectedAt: 1_760_000_200_000,
      plataDepositReturnedAt: 1_760_000_300_000,
    })
  })

  it('keeps every plata field out of the draft, so the editor cannot save one by accident', () => {
    // The plata section is operator-editable, but through its own save. If a plata field ever
    // reaches serializeOrderDraft, an admin edit starts overwriting whatever מיי wrote while
    // the editor was open — which is exactly what this rule exists to prevent.
    const menu = buildOrderEditorMenu(emptyStore)
    const draft = createOrderDraftFromLegacy(deliveryOwnedOrder, menu)

    const serialized: Record<string, unknown> = serializeOrderDraft(draft, 'order-1')
    expect(Object.keys(serialized).filter((key) => key.startsWith('plata'))).toEqual([])
  })

  it('lets a hotplate update that landed mid-edit survive the admin save', () => {
    // Lin opens the order, מיי (or the plata section) then marks the plate collected. Saving
    // the order afterwards must not write the draft's stale 'awaitingPickup' back over it.
    const menu = buildOrderEditorMenu(emptyStore)
    const draft = createOrderDraftFromLegacy(deliveryOwnedOrder, menu)
    const movedOn: LegacyOrder = {
      ...deliveryOwnedOrder,
      plataStatus: 'collected',
      plataPickupNote: 'נאספה מהקבלה',
      plataCollectedAt: 1_760_000_900_000,
    }

    const nextState = applyOrderDraftToStore(
      { orders: [movedOn] },
      { ...draft, notes: 'הערה חדשה' },
      { mode: 'edit', orderId: 'order-1' },
    )

    expect(nextState.orders[0]).toMatchObject({
      notes: 'הערה חדשה',
      plataStatus: 'collected',
      plataPickupNote: 'נאספה מהקבלה',
      plataCollectedAt: 1_760_000_900_000,
    })
  })

  it('preserves the proof URL even if the serialized draft carries no delivery fields at all', () => {
    // The editor must never own these fields: the merge in applyOrderDraftToStore is what
    // keeps them, so the round trip has to survive a draft that dropped them entirely.
    const menu = buildOrderEditorMenu(emptyStore)
    const draft = createOrderDraftFromLegacy(deliveryOwnedOrder, menu)
    const serialized: Record<string, unknown> = { ...serializeOrderDraft(draft, 'order-1') }
    for (const field of [
      'meyToken', 'meyLeadNudgeAt', 'meyPromptMessageId', 'courierCheckinState', 'courierCheckinAt',
      'courierEtaMinutes', 'courierNote', 'deliveryProofUrl', 'deliveryProofAt', 'deliveryProofBy',
      'deliveredAt', 'statusBeforeProof',
    ]) delete serialized[field]

    expect({ ...deliveryOwnedOrder, ...serialized }).toMatchObject({
      deliveryProofUrl: 'https://pub-abc123.r2.dev/proof.jpg',
      deliveryProofAt: 1_760_000_000_000,
      deliveryProofBy: 'שליח',
      deliveredAt: 1_760_000_100_000,
      courierCheckinState: 'delayed',
    })
  })

  it('preserves the proof URL through the real applyOrderDraftToStore edit path', () => {
    const menu = buildOrderEditorMenu(emptyStore)
    const baseState: LegacyStore = { orders: [deliveryOwnedOrder] }
    const draft = createOrderDraftFromLegacy(deliveryOwnedOrder, menu)

    const nextState = applyOrderDraftToStore(
      baseState,
      { ...draft, name: 'שם מעודכן', notes: 'הערה חדשה' },
      { mode: 'edit', orderId: 'order-1' },
    )

    expect(nextState.orders[0]).toMatchObject({
      name: 'שם מעודכן',
      notes: 'הערה חדשה',
      deliveryProofUrl: 'https://pub-abc123.r2.dev/proof.jpg',
      deliveryProofAt: 1_760_000_000_000,
      deliveryProofBy: 'שליח',
      deliveredAt: 1_760_000_100_000,
      meyToken: 'mey-token',
      statusBeforeProof: 'במשלוח',
      plataCount: 2,
      plataStatus: 'awaitingPickup',
      plataPickupNote: 'בקבלה',
    })
  })
})

describe('manual total overrides price-availability blocks', () => {
  const baseIssues = [
    { code: 'SIDE_OVERAGE', message: 'נבחרו יותר תוספות שבת ממספר הארוחות הזוגיות. אין מחיר מאושר לחריגה ולכן אי אפשר לשמור.', blocking: true },
    { code: 'PRICING_ERROR', message: 'אי אפשר לחשב מחיר בטוח עד שהכמויות יתוקנו.', blocking: true },
    { code: 'INVALID_CUSTOM_ITEM', message: 'פריט חופשי 1 חסר שם, כמות או מחיר תקין.', blocking: true },
    { code: 'TOTAL_MISMATCH', message: 'סך התשלום שונה מהמחיר המחושב — התאמה ידנית.', blocking: false },
  ] as const

  it('demotes only pricing-availability issues, and only with a valid manual total', () => {
    const menu = buildOrderEditorMenu({ orders: [] })
    const priced = { ...createOrderDraft(menu), total: '200' }
    const demoted = demotePriceAvailabilityIssues(baseIssues, priced)
    expect(demoted.find((issue) => issue.code === 'SIDE_OVERAGE')?.blocking).toBe(false)
    expect(demoted.find((issue) => issue.code === 'SIDE_OVERAGE')?.message).not.toContain('אי אפשר לשמור')
    expect(demoted.find((issue) => issue.code === 'PRICING_ERROR')?.blocking).toBe(false)
    // Data-integrity issues keep blocking even with a manual total.
    expect(demoted.find((issue) => issue.code === 'INVALID_CUSTOM_ITEM')?.blocking).toBe(true)

    const unpriced = { ...createOrderDraft(menu), total: '' }
    expect(demotePriceAvailabilityIssues(baseIssues, unpriced)).toEqual(baseIssues)

    const invalidTotal = { ...createOrderDraft(menu), total: 'abc' }
    expect(demotePriceAvailabilityIssues(baseIssues, invalidTotal)).toEqual(baseIssues)
  })

  it('hasValidManualTotal accepts real amounts only', () => {
    const menu = buildOrderEditorMenu({ orders: [] })
    const draft = createOrderDraft(menu)
    expect(hasValidManualTotal({ ...draft, total: '1320' })).toBe(true)
    expect(hasValidManualTotal({ ...draft, total: '199.5' })).toBe(true)
    expect(hasValidManualTotal({ ...draft, total: '' })).toBe(false)
    expect(hasValidManualTotal({ ...draft, total: 'שתיים' })).toBe(false)
  })
})
