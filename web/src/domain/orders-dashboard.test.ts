import { describe, expect, it } from 'vitest'
import type { LegacyStore } from './store.ts'
import {
  bonPaymentFields,
  bonServiceDate,
  buildBonFields,
  buildOrdersDashboard,
  buildWhatsAppOrderHref,
  formatLegacyOrderText,
  normalizeWhatsAppPhone,
  type OrdersDateGroup,
  type OrdersOrderView,
} from './orders-dashboard.ts'

const UTC_OPTIONS = {
  now: new Date('2026-08-12T08:00:00.000Z'),
  timeZone: 'UTC',
  locale: 'he-IL',
} as const

function store(overrides: Partial<LegacyStore> = {}): LegacyStore {
  return { orders: [], settings: { maxMeals: 0 }, ...overrides }
}

function groupOrders(group: OrdersDateGroup): OrdersOrderView[] {
  return group.blocks.flatMap((block) =>
    block.kind === 'linked-group' ? block.orders : [block.order],
  )
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}

describe('buildOrdersDashboard', () => {
  it('sorts date and time deterministically while splitting past, upcoming, invalid, and undated orders', () => {
    const result = buildOrdersDashboard(
      store({
        orders: [
          { id: 'undated', name: 'Undated' },
          { id: 'future', date: '2026-08-13', time: '08:00' },
          { id: 'today-no-time', date: '2026-08-12' },
          { id: 'past-old', date: '2026-08-10', time: '08:00' },
          { id: 'invalid', date: '2026-02-30' },
          { id: 'today-early', date: '2026-08-12', time: '09:00' },
          { id: 'past-recent', date: '2026-08-11', time: '08:00' },
        ],
      }),
      UTC_OPTIONS,
    )

    expect(result.upcomingGroups.map((group) => group.key)).toEqual([
      'dated:2026-08-12',
      'dated:2026-08-13',
      'invalid:2026-02-30',
      'undated',
    ])
    expect(groupOrders(result.upcomingGroups[0]!).map((order) => order.orderId)).toEqual([
      'today-early',
      'today-no-time',
    ])
    expect(result.pastGroups.map((group) => group.key)).toEqual([
      'dated:2026-08-11',
      'dated:2026-08-10',
    ])
    expect(result.pastOrderCount).toBe(2)
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'INVALID_SERVICE_DATE',
        orderId: 'invalid',
        path: 'date',
      }),
    )
  })

  it('searches every whitespace term case-insensitively across customer, destination, group, notes, and selected dishes', () => {
    const source = store({
      orders: [
        {
          id: 'past-cancelled',
          date: '2026-08-10',
          name: 'לקוח עבר',
          phone: '050-123-4567',
          place: 'Royal HOTEL',
          group: 'קבוצת חוף',
          notes: 'בלי חריף',
          salads: { מטבוחה: { o: 1, p: 0 } },
          status: 'בוטלה',
        },
        { id: 'future', date: '2026-08-14', name: 'לקוחה אחרת', mains: { שניצל: 1 } },
      ],
    })

    for (const query of ['לקוח 050', 'royal hotel', 'קבוצת חוף', 'בלי חריף', 'מטבוחה עבר']) {
      const result = buildOrdersDashboard(source, { ...UTC_OPTIONS, query })
      expect(result.searchActive).toBe(true)
      expect(result.matchCount).toBe(1)
      expect(groupOrders(result.searchGroups[0]!).map((order) => order.orderId)).toEqual([
        'past-cancelled',
      ])
    }

    const noMatch = buildOrdersDashboard(source, { ...UTC_OPTIONS, query: 'מטבוחה שניצל' })
    expect(noMatch.matchCount).toBe(0)
    expect(noMatch.searchGroups).toEqual([])
  })

  it('trims linked-group names and excludes cancelled families from destination and money totals', () => {
    const result = buildOrdersDashboard(
      store({
        orders: [
          { id: 'a', date: '2026-08-14', name: 'A', group: '  קבוצת ים  ', place: 'מלון ים', total: '0.10' },
          { id: 'b', date: '2026-08-14', name: 'B', group: 'קבוצת ים', place: 'מלון ים', total: '0.20' },
          { id: 'cancelled', date: '2026-08-14', name: 'C', group: 'קבוצת ים', place: 'מלון אחר', total: '999.99', status: 'בוטלה' },
          { id: 'single', date: '2026-08-14', name: 'Single', place: 'מלון יחיד', total: '1.00' },
        ],
      }),
      UTC_OPTIONS,
    )
    const date = result.upcomingGroups[0]!
    const linked = date.blocks[0]

    expect(linked?.kind).toBe('linked-group')
    if (linked?.kind !== 'linked-group') throw new Error('expected linked group')
    expect(linked.name).toBe('קבוצת ים')
    expect(linked.memberCount).toBe(3)
    expect(linked.activeDestinations).toEqual(['מלון ים'])
    expect(linked.activeTotalMinorUnits).toBe(30)
    expect(date.activeRevenueMinorUnits).toBe(130)
    expect(date.orderCount).toBe(4)
  })

  it('adds decimal legacy amounts only as exact integer minor units', () => {
    const result = buildOrdersDashboard(
      store({
        orders: [
          { id: 'ten', date: '2026-08-12', total: '0.10' },
          { id: 'twenty', date: '2026-08-12', total: '.20' },
        ],
      }),
      UTC_OPTIONS,
    )

    expect(result.upcomingGroups[0]?.activeRevenueMinorUnits).toBe(30)
    expect(result.warnings).toEqual([])
  })

  it.each(['1,2,3', '$1$', '1 23', '1,23.00', '1,2345.00', '12.345', '-1.00']) (
    'rejects malformed legacy money %j instead of coercing it',
    (total) => {
      const result = buildOrdersDashboard(
        store({ orders: [{ id: 'bad-money', date: '2026-08-12', total }] }),
        UTC_OPTIONS,
      )
      const order = groupOrders(result.upcomingGroups[0]!)[0]!

      expect(order.totalState).toBe('invalid')
      expect(order.totalMinorUnits).toBeNull()
      expect(result.upcomingGroups[0]?.activeRevenueMinorUnits).toBeNull()
      expect(result.warnings).toContainEqual(
        expect.objectContaining({ code: 'INVALID_MONEY', orderId: 'bad-money', path: 'total' }),
      )
    },
  )

  it.each([
    ['1,234.56', 123_456],
    ['$1,234.56', 123_456],
    [' .50 ', 50],
    ['12.34$', 1_234],
  ] as const)('accepts strict legacy-compatible money %j', (total, expected) => {
    const result = buildOrdersDashboard(
      store({ orders: [{ id: 'valid-money', date: '2026-08-12', total }] }),
      UTC_OPTIONS,
    )
    expect(result.upcomingGroups[0]?.activeRevenueMinorUnits).toBe(expected)
    expect(result.warnings).toEqual([])
  })

  it('keeps cancelled malformed money visible without poisoning active date totals', () => {
    const result = buildOrdersDashboard(
      store({
        orders: [
          { id: 'active', date: '2026-08-12', total: '0.10' },
          { id: 'cancelled', date: '2026-08-12', total: '1,2,3', status: 'בוטלה' },
        ],
      }),
      UTC_OPTIONS,
    )

    expect(result.upcomingGroups[0]?.activeRevenueMinorUnits).toBe(10)
    expect(groupOrders(result.upcomingGroups[0]!)[1]).toEqual(
      expect.objectContaining({ orderId: 'cancelled', cancelled: true, totalState: 'invalid' }),
    )
  })

  it('excludes cancelled meals from capacity and fails quantity aggregates closed', () => {
    const valid = buildOrdersDashboard(
      store({
        settings: { maxMeals: '3' },
        orders: [
          { id: 'active', date: '2026-08-12', meals: '3' },
          { id: 'cancelled', date: '2026-08-12', meals: 99, status: 'בוטלה' },
        ],
      }),
      UTC_OPTIONS,
    )
    expect(valid.upcomingGroups[0]).toEqual(
      expect.objectContaining({ activeMeals: 3, full: true }),
    )

    const malformed = buildOrdersDashboard(
      store({ orders: [{ id: 'bad-count', date: '2026-08-12', meals: '1.5' }] }),
      UTC_OPTIONS,
    )
    expect(malformed.upcomingGroups[0]?.activeMeals).toBeNull()
    expect(malformed.warnings).toContainEqual(
      expect.objectContaining({ code: 'INVALID_QUANTITY', orderId: 'bad-count', path: 'meals' }),
    )
  })

  it('builds card chips from legacy sparse maps without summing extra quantities as rows', () => {
    const result = buildOrdersDashboard(
      store({
        orders: [
          {
            id: 'chips',
            date: '2026-08-12',
            meals: 2,
            salads: { א: { o: 2, p: 1 }, ב: { o: 3, p: 0 } },
            extras: { משלוח: { q: 4 }, יין: { q: 1 } },
            custom: [{ name: 'פריט', qty: 2 }],
            aricha: 6,
            challot: 4,
          },
        ],
      }),
      UTC_OPTIONS,
    )
    expect(groupOrders(result.upcomingGroups[0]!)[0]?.summary).toEqual({
      meals: 2,
      orderedSalads: 5,
      complimentarySalads: 1,
      distinctExtras: 3,
      tableSettings: 6,
      challahs: 4,
    })
  })

  it('preserves unknown legacy fields and never mutates the source store', () => {
    const source = deepFreeze<LegacyStore>({
      orders: [
        {
          id: 'immutable',
          date: '2026-08-13',
          name: 'Source',
          total: '10.25',
          futureOrderField: { nested: ['keep', 42] },
        },
      ],
      settings: { maxMeals: '8', futureSetting: true },
      futureTopLevel: { version: 7 },
    })
    const before = JSON.stringify(source)
    const orderReference = source.orders[0]

    buildOrdersDashboard(source, UTC_OPTIONS)

    expect(JSON.stringify(source)).toBe(before)
    expect(source.orders[0]).toBe(orderReference)
    expect(source.orders[0]?.futureOrderField).toEqual({ nested: ['keep', 42] })
  })

  it('suppresses navigation for duplicate and numeric/string-colliding order IDs', () => {
    const result = buildOrdersDashboard(
      store({
        orders: [
          { id: 1, date: '2026-08-12', name: 'Numeric' },
          { id: '1', date: '2026-08-12', name: 'String' },
          { id: 'safe', date: '2026-08-12', name: 'Safe' },
        ],
      }),
      UTC_OPTIONS,
    )
    const orders = groupOrders(result.upcomingGroups[0]!)

    expect(orders.map((order) => order.orderId)).toEqual([null, null, 'safe'])
    expect(result.warnings.filter((warning) => warning.code === 'DUPLICATE_ORDER_ID')).toHaveLength(2)
  })

  it('marks mixed priced and unpriced active date and linked-group totals incomplete', () => {
    const result = buildOrdersDashboard(
      store({
        orders: [
          { id: 'priced', date: '2026-08-12', group: 'Group', total: '10.00' },
          { id: 'unpriced', date: '2026-08-12', group: 'Group' },
        ],
      }),
      UTC_OPTIONS,
    )
    const date = result.upcomingGroups[0]!
    const group = date.blocks[0]

    expect(date.activeRevenueMinorUnits).toBeNull()
    expect(group?.kind).toBe('linked-group')
    if (group?.kind !== 'linked-group') throw new Error('expected linked group')
    expect(group.activeTotalMinorUnits).toBeNull()
    expect(group.activeTotalComplete).toBe(false)
  })

  it('fails malformed nested quantities closed and disables customer sharing', () => {
    const result = buildOrdersDashboard(
      store({
        orders: [
          {
            id: 'malformed-nested',
            date: '2026-08-12',
            phone: '050-123-4567',
            salads: { מטבוחה: 2 },
            extras: { משלוח: 1 },
          },
        ],
      }),
      UTC_OPTIONS,
    )
    const order = groupOrders(result.upcomingGroups[0]!)[0]!

    expect(order.summary.orderedSalads).toBeNull()
    expect(order.summary.distinctExtras).toBeNull()
    expect(order.whatsappHref).toBeNull()
    expect(result.warnings.filter((warning) => warning.code === 'INVALID_STRUCTURE').length).toBeGreaterThan(0)
  })

  it('disables WhatsApp when malformed money would otherwise enter outbound order text', () => {
    const result = buildOrdersDashboard(
      store({
        orders: [
          { id: 'bad-outbound', date: '2026-08-12', phone: '050-123-4567', total: '1,2,3' },
        ],
      }),
      UTC_OPTIONS,
    )
    expect(groupOrders(result.upcomingGroups[0]!)[0]?.whatsappHref).toBeNull()
  })

  it('bounds hostile numeric and nested text tokens and fails them closed', () => {
    const huge = '9'.repeat(100_000)
    const result = buildOrdersDashboard(
      store({
        orders: [
          {
            id: 'bounded',
            date: '2026-08-12',
            phone: '050-123-4567',
            meals: huge,
            custom: [{ name: 'Huge', qty: 1, note: huge }],
          },
        ],
      }),
      UTC_OPTIONS,
    )
    const order = groupOrders(result.upcomingGroups[0]!)[0]!

    expect(order.summary.meals).toBeNull()
    expect(order.whatsappHref).toBeNull()
    expect(order.formattedText.length).toBeLessThan(20_000)
    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(['QUANTITY_OVERFLOW', 'TEXT_TOO_LONG']),
    )
  })

  it('uses the Dubai business date by default instead of the operator device zone', () => {
    const result = buildOrdersDashboard(store({ orders: [{ id: 'dubai', date: '2026-08-12' }] }), {
      now: new Date('2026-08-11T21:30:00.000Z'),
    })

    expect(result.todayIso).toBe('2026-08-12')
    expect(result.upcomingGroups).toHaveLength(1)
  })
})

describe('orders operations pack', () => {
  it('flags urgent orders and sorts them first inside their date group', () => {
    const result = buildOrdersDashboard(
      store({
        orders: [
          { id: 'calm', date: '2026-08-14', time: '09:00' },
          { id: 'hot', date: '2026-08-14', time: '15:00', urgent: true },
          { id: 'not-really', date: '2026-08-14', time: '10:00', urgent: 'yes' },
          { id: 'other-day', date: '2026-08-13', time: '20:00' },
        ],
      }),
      UTC_OPTIONS,
    )

    // Urgency never leaks across date groups.
    expect(result.upcomingGroups.map((group) => group.key)).toEqual([
      'dated:2026-08-13',
      'dated:2026-08-14',
    ])
    const orders = groupOrders(result.upcomingGroups[1]!)
    expect(orders.map((order) => order.orderId)).toEqual(['hot', 'calm', 'not-really'])
    expect(orders[0]?.urgent).toBe(true)
    // Only a literal boolean true counts — hostile string values stay off.
    expect(orders[2]?.urgent).toBe(false)
  })

  it('keeps drafts visible but out of date and linked-group totals', () => {
    const result = buildOrdersDashboard(
      store({
        orders: [
          { id: 'real', date: '2026-08-14', name: 'A', group: 'קבוצה', meals: 2, total: '100.00' },
          { id: 'draft', date: '2026-08-14', name: 'B', group: 'קבוצה', meals: 3, total: '50.00', draft: true },
        ],
      }),
      UTC_OPTIONS,
    )
    const date = result.upcomingGroups[0]!

    expect(date.activeMeals).toBe(2)
    expect(date.activeRevenueMinorUnits).toBe(10_000)
    expect(date.orderCount).toBe(2)

    const linked = date.blocks[0]
    expect(linked?.kind).toBe('linked-group')
    if (linked?.kind !== 'linked-group') throw new Error('expected linked group')
    expect(linked.memberCount).toBe(2)
    expect(linked.activeTotalMinorUnits).toBe(10_000)

    const draft = linked.orders.find((order) => order.orderId === 'draft')
    expect(draft?.draft).toBe(true)
    // A draft is not a commitment — the checklist never nags about it.
    expect(draft?.missingFields).toEqual([])
    expect(linked.orders.find((order) => order.orderId === 'real')?.draft).toBe(false)
  })

  it('pairs only active same-phone same-date orders as possible duplicates', () => {
    const result = buildOrdersDashboard(
      store({
        orders: [
          { id: 'a', date: '2026-08-14', name: 'רות לוי', phone: '050-123-4567' },
          { id: 'b', date: '2026-08-14', name: 'רות כהן', phone: '+972 50-123-4567' },
          { id: 'other-date', date: '2026-08-15', name: 'לא קשורה', phone: '050-123-4567' },
          { id: 'cancelled', date: '2026-08-14', name: 'מבוטלת', phone: '0501234567', status: 'בוטלה' },
          { id: 'draft', date: '2026-08-14', name: 'טיוטה', phone: '0501234567', draft: true },
          { id: 'no-phone', date: '2026-08-14', name: 'בלי טלפון' },
        ],
      }),
      UTC_OPTIONS,
    )
    const byId = new Map(
      result.upcomingGroups
        .flatMap((group) => groupOrders(group))
        .map((order) => [order.orderId, order]),
    )

    // The two active entries pair via the normalized last 9 digits.
    expect(byId.get('a')?.duplicateOtherNames).toEqual(['רות כהן'])
    expect(byId.get('b')?.duplicateOtherNames).toEqual(['רות לוי'])
    // Different date, cancelled, draft, and phoneless orders never pair.
    expect(byId.get('other-date')?.duplicateOtherNames).toEqual([])
    expect(byId.get('cancelled')?.duplicateOtherNames).toEqual([])
    expect(byId.get('draft')?.duplicateOtherNames).toEqual([])
    expect(byId.get('no-phone')?.duplicateOtherNames).toEqual([])
  })

  it('computes the missing-fields checklist per active order and stays silent when complete', () => {
    const result = buildOrdersDashboard(
      store({
        orders: [
          { id: 'complete', date: '2026-08-14', time: '12:00', place: 'מלון', phone: '0501234567', total: '80.00' },
          { id: 'pickup-ok', date: '2026-08-14', time: '9:30', pickup: true, phone: '0521111111', total: '5.00' },
          { id: 'empty', date: '2026-08-14' },
          { id: 'partial', date: '2026-08-14', time: 'צהריים', place: 'מלון', phone: '0522222222', total: '0' },
          { id: 'cancelled', date: '2026-08-14', status: 'בוטלה' },
        ],
      }),
      UTC_OPTIONS,
    )
    const byId = new Map(
      groupOrders(result.upcomingGroups[0]!).map((order) => [order.orderId, order]),
    )

    expect(byId.get('complete')?.missingFields).toEqual([])
    // Pickup satisfies the destination; H:MM parses.
    expect(byId.get('pickup-ok')?.missingFields).toEqual([])
    expect(byId.get('empty')?.missingFields).toEqual(['time', 'destination', 'price', 'phone'])
    // Unparsable time and a non-positive total are both flagged.
    expect(byId.get('partial')?.missingFields).toEqual(['time', 'price'])
    expect(byId.get('cancelled')?.missingFields).toEqual([])
  })

  it('raises the allergy alert from Hebrew or English notes, case-insensitively', () => {
    const result = buildOrdersDashboard(
      store({
        orders: [
          { id: 'hebrew', date: '2026-08-14', notes: 'יש אלרגיה לאגוזים' },
          { id: 'english', date: '2026-08-14', notes: 'ALLERGIC to nuts' },
          { id: 'clean', date: '2026-08-14', notes: 'בלי חריף' },
          { id: 'no-notes', date: '2026-08-14' },
        ],
      }),
      UTC_OPTIONS,
    )
    const byId = new Map(
      groupOrders(result.upcomingGroups[0]!).map((order) => [order.orderId, order]),
    )

    expect(byId.get('hebrew')?.allergyAlert).toBe(true)
    expect(byId.get('english')?.allergyAlert).toBe(true)
    expect(byId.get('clean')?.allergyAlert).toBe(false)
    expect(byId.get('no-notes')?.allergyAlert).toBe(false)
  })
})

describe('order communication helpers', () => {
  it.each([
    ['+971 58 123 4567', '971581234567'],
    ['00971-58-123-4567', '971581234567'],
    ['050-123-4567', '972501234567'],
    ['', null],
  ] as const)('normalizes WhatsApp phone %j', (phone, normalized) => {
    expect(normalizeWhatsAppPhone(phone)).toBe(normalized)
  })

  it('formats known order content and encodes the exact text in the WhatsApp URL', () => {
    const order = {
      date: '2026-08-14',
      name: 'לקוחה',
      phone: '050-123-4567',
      place: 'מלון',
      time: '12:00',
      meals: 2,
      salads: { מטבוחה: { o: 1, p: 0 } },
      notes: 'בלי חריף',
      paid: 'לא',
    }
    const formatted = formatLegacyOrderText(order)
    const href = buildWhatsAppOrderHref(order.phone, formatted)

    expect(formatted).toContain('שם מלא: לקוחה')
    expect(formatted).toContain('ארוחה זוגית')
    expect(formatted).toContain('מטבוחה')
    expect(formatted).toContain('הערות: בלי חריף')
    expect(href).toBe(`https://wa.me/972501234567?text=${encodeURIComponent(formatted)}`)
  })

  it('rejects empty, undersized, oversized, and international-prefix-only WhatsApp numbers', () => {
    expect(normalizeWhatsAppPhone('00971')).toBeNull()
    expect(normalizeWhatsAppPhone('123456')).toBeNull()
    expect(normalizeWhatsAppPhone('1234567890123456')).toBeNull()
    expect(buildWhatsAppOrderHref('not a phone', 'order text')).toBeNull()
  })

  it('formats lunch variants, item notes, table settings, and challahs without dumping storage keys', () => {
    const formatted = formatLegacyOrderText({
      date: '2026-08-14',
      extras: { משלוח: { q: 1, note: 'ללובי' } },
      custom: [{ name: 'בקשה מיוחדת', qty: 2, price: '5.00', note: 'לארוז בנפרד' }],
      lunch: {
        'schnitzel-plate': {
          q: 1,
          v: 'family',
          sides: { 'אורז לבן': 2 },
        },
      },
      aricha: 4,
      challot: 2,
    })

    expect(formatted).toContain('משלוח (ללובי)')
    expect(formatted).toContain('בקשה מיוחדת ×2 (5.00$) — לארוז בנפרד')
    expect(formatted).toContain('שניצל בצלחת (משפחתית) ×1 — תוספות: אורז לבן ×2')
    expect(formatted).toContain('עריכה: 4 איש')
    expect(formatted).toContain('חלות: 2 יחידות')
    expect(formatted).not.toContain('schnitzel-plate')
    expect(formatted).not.toContain('sides')
  })
})

describe('buildBonFields', () => {
  it('lists the bon in kitchen order and keeps every stored detail', () => {
    const fields = buildBonFields({
      id: 'bon-1', date: '2099-08-14', name: 'לקוחה', phone: '050-1234567',
      place: 'מלון אמיתי', address: 'קומה 7', time: '12:30', group: 'משפחות לוי',
      meals: 2, aricha: 4, challot: 4,
      salads: { מטבוחה: { o: 2, p: 1 } }, firsts: { 'פילה מרוקאי': 2 }, heat: 'חריף',
      firstsNote: 'בלי כוסברה', mains: { 'עוף ביתי': 1 }, mainsNote: 'לחתוך',
      sides: { קוסקוס: 1 }, desserts: { סופלה: 2 },
      extras: { אורז: { q: 2, note: 'בנפרד' } },
      lunch: { 'schnitzel-plate': { q: 1, v: 'family' } },
      notes: 'להתקשר בהגעה', total: '500', deposit: '100', paid: 'מקדמה',
    })

    expect(fields.map((field) => field.label)).toEqual([
      'שם מלא', 'טלפון', 'לאן המשלוח', 'קבוצה', 'ארוחה זוגית', 'עריכה', 'חלות',
      'סלטים', 'מנה ראשונה', 'מנה עיקרית', 'תוספת', 'קינוח', 'אקסטרות',
      'תפריט צהריים', 'הערות',
    ])
    const value = (label: string) => fields.find((field) => field.label === label)
    expect(value('לאן המשלוח')).toEqual({
      label: 'לאן המשלוח', value: 'מלון אמיתי',
      notes: ['שעת הגעה: 12:30', 'כתובת: קומה 7'],
    })
    // עריכה is the number of diners the table is laid for.
    expect(value('עריכה')?.value).toBe('4 סועדים')
    expect(buildBonFields({ id: 'one', aricha: 1 }).find((field) => field.label === 'עריכה')?.value)
      .toBe('סועד אחד')
    expect(value('סלטים')?.value).toBe('מטבוחה ×2, מטבוחה — פינוק')
    expect(value('מנה ראשונה')?.notes).toEqual(['חריפות הדג: חריף', 'בלי כוסברה'])
    expect(value('אקסטרות')?.value).toBe('אורז ×2 (בנפרד)')
    // Money never appears twice: the bon prints the amount as its own block.
    expect(fields.some((field) => field.label.includes('תשלום'))).toBe(false)
  })

  it('drops empty rows and still shows notes whose course was never chosen', () => {
    const fields = buildBonFields({ id: 'bon-2', name: 'רות', pickup: true, heat: 'חריף', mainsNote: 'לחתוך' })

    expect(fields.map((field) => field.label)).toEqual(['שם מלא', 'לאן המשלוח', 'הערות למנות'])
    expect(fields[1]).toEqual({ label: 'לאן המשלוח', value: 'איסוף עצמי', notes: [] })
    expect(fields[2]?.value).toBe('חריפות הדג: חריף · לחתוך')
  })

  it('reads the service date and the payment lines', () => {
    expect(bonServiceDate({ id: 'bon-3', date: '2099-08-14' })).toContain('14.08.2099')
    expect(bonServiceDate({ id: 'bon-4', date: 'לא תאריך' })).toBe('לא תאריך')
    expect(bonServiceDate({ id: 'bon-5' })).toBe('ללא תאריך')
    expect(bonPaymentFields({ id: 'bon-6', deposit: '100', payMethod: 'לינק', paid: 'מקדמה' }))
      .toEqual([
        { label: 'מקדמה', value: '100', notes: [] },
        { label: 'דרך תשלום', value: 'לינק', notes: [] },
        { label: 'שולם', value: 'מקדמה', notes: [] },
      ])
    expect(bonPaymentFields({ id: 'bon-7' })).toEqual([{ label: 'שולם', value: 'לא', notes: [] }])
  })
})
