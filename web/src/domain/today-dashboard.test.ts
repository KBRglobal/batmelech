import { describe, expect, it } from 'vitest'
import type { LegacyStore } from './store.ts'
import { buildTodayDashboard, formatUsdMinorUnits } from './today-dashboard.ts'

const UTC_OPTIONS = {
  now: new Date('2026-08-12T08:00:00.000Z'),
  timeZone: 'UTC',
  locale: 'he-IL',
} as const

function store(overrides: Partial<LegacyStore> = {}): LegacyStore {
  return { orders: [], settings: { maxMeals: 0 }, ...overrides }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}

describe('buildTodayDashboard', () => {
  it('excludes cancelled orders, sorts active fulfilments, and caps the first four date groups', () => {
    const result = buildTodayDashboard(
      store({
        settings: { maxMeals: '4' },
        orders: [
          { id: 'fifth', date: '2026-08-16', name: 'Fifth', meals: 1, status: 'אושרה' },
          { id: 'later-today', date: '2026-08-12', name: 'Later', time: '15:00', meals: 2, status: 'אושרה' },
          { id: 'third', date: '2026-08-14', name: 'Third', meals: 8, status: 'אושרה' },
          { id: 'cancelled-he', date: '2026-08-12', name: 'Cancelled Hebrew', time: '08:00', meals: 50, status: 'בוטלה' },
          { id: 'second', date: '2026-08-13', name: 'Second', meals: 4, status: 'אושרה' },
          { id: 'early-today', date: '2026-08-12', name: 'Early', time: '09:00', meals: 1, status: 'אושרה' },
          { id: 'fourth', date: '2026-08-15', name: 'Fourth', meals: 1, status: 'אושרה' },
          { id: 'cancelled-en', date: '2026-08-13', name: 'Cancelled English', meals: 50, status: 'CANCELED' },
        ],
      }),
      UTC_OPTIONS,
    )

    expect(result.fulfillments.map((order) => order.customerName)).toEqual(['Early', 'Later'])
    expect(result.upcomingGroups.map((group) => group.serviceDate)).toEqual([
      '2026-08-12',
      '2026-08-13',
      '2026-08-14',
      '2026-08-15',
    ])
    expect(result.upcomingGroups.map((group) => group.orderCount)).toEqual([2, 1, 1, 1])
    expect(result.upcomingGroups.map((group) => group.meals)).toEqual([3, 4, 8, 1])
    expect(result.upcomingGroups.map((group) => group.capacityPercent)).toEqual([75, 100, 100, 25])
    expect(result.upcomingGroups.map((group) => group.full)).toEqual([false, true, true, false])
    expect(result.capacity).toEqual({ kind: 'configured', maximumMeals: 4 })
  })

  it.each([
    ['2026-08-12T08:00:00.000Z', 'בוקר טוב'],
    ['2026-08-12T14:00:00.000Z', 'צהריים טובים'],
    ['2026-08-12T20:00:00.000Z', 'ערב טוב'],
  ] as const)('uses the configured local clock at %s for %s', (timestamp, greeting) => {
    const now = new Date(timestamp)
    const result = buildTodayDashboard(store(), { now, timeZone: 'UTC', locale: 'he-IL' })
    const expectedDate = new Intl.DateTimeFormat('he-IL', {
      weekday: 'long',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'UTC',
    }).format(now)

    expect(result.greeting).toBe(greeting)
    expect(result.todayIso).toBe('2026-08-12')
    expect(result.localizedDate).toBe(expectedDate)
  })

  it('distinguishes a globally empty store from a store with no active upcoming orders', () => {
    const empty = buildTodayDashboard(store(), UTC_OPTIONS)
    const noUpcoming = buildTodayDashboard(
      store({
        orders: [
          { id: 'past', date: '2026-08-11', status: 'אושרה' },
          { id: 'cancelled', date: '2026-08-13', status: 'בוטלה' },
        ],
      }),
      UTC_OPTIONS,
    )

    expect(empty.globallyEmpty).toBe(true)
    expect(noUpcoming.globallyEmpty).toBe(false)
    expect(noUpcoming.hasUpcomingOrders).toBe(false)
    expect(noUpcoming.upcomingGroups).toEqual([])
  })

  it('builds no-deposit and pending alerts while summing outstanding USD in exact cents', () => {
    const result = buildTodayDashboard(
      store({
        orders: [
          { id: 'ten-cents', date: '2026-08-12', name: 'Ten', total: '0.10', deposit: '', paid: 'לא', status: 'אושרה' },
          { id: 'twenty-cents', date: '2026-08-13', name: 'Twenty', total: '0.20', deposit: 0, paid: 'לא', status: 'אושרה' },
          { id: 'over-deposit', date: '2026-08-13', total: '1.00', deposit: '2.00', paid: 'מקדמה', status: 'אושרה' },
          { id: 'pending', date: '2026-08-14', total: 0, deposit: 0, paid: 'לא' },
          { id: 'paid', date: '2026-08-14', total: '999.99', paid: 'כן', status: 'אושרה' },
          { id: 'partner', date: '2026-08-14', total: '999.99', paid: 'שת"פ', status: 'אושרה' },
          { id: 'past', date: '2026-08-11', total: '999.99', paid: 'לא', status: 'אושרה' },
          { id: 'cancelled', date: '2026-08-15', total: '999.99', paid: 'לא', status: 'בוטלה' },
        ],
      }),
      UTC_OPTIONS,
    )

    expect(result.alerts.filter((alert) => alert.kind === 'no-deposit').map((alert) => alert.orderId)).toEqual([
      'ten-cents',
      'twenty-cents',
    ])
    expect(result.alerts.filter((alert) => alert.kind === 'pending').map((alert) => alert.orderId)).toEqual([
      'pending',
    ])
    expect(result.outstandingMinorUnits).toBe(30)
    expect(result.outstandingComplete).toBe(true)
    expect(formatUsdMinorUnits(result.outstandingMinorUnits!)).toBe('$0.30')
  })

  it('surfaces malformed money and fails the aggregate closed instead of silently coercing it', () => {
    const result = buildTodayDashboard(
      store({
        orders: [
          { id: 'valid', date: '2026-08-12', total: '10.00', deposit: '2.00', paid: 'לא', status: 'אושרה' },
          { id: 'bad-total', date: '2026-08-13', total: '12.3.4', deposit: 0, paid: 'לא', status: 'אושרה' },
          { id: 'bad-deposit', date: '2026-08-14', total: '15.00', deposit: 'five', paid: 'לא', status: 'אושרה' },
        ],
      }),
      UTC_OPTIONS,
    )

    expect(result.warnings.filter((warning) => warning.code === 'INVALID_MONEY')).toEqual([
      expect.objectContaining({ orderId: 'bad-total', path: 'total' }),
      expect.objectContaining({ orderId: 'bad-deposit', path: 'deposit' }),
    ])
    expect(result.outstandingMinorUnits).toBeNull()
    expect(result.outstandingComplete).toBe(false)
    expect(result.alerts.some((alert) => alert.orderId === 'bad-total' && alert.kind === 'no-deposit')).toBe(false)
    expect(result.alerts.some((alert) => alert.orderId === 'bad-deposit' && alert.kind === 'no-deposit')).toBe(false)
  })

  it.each([
    '1,2,3',
    '$1$',
    '1 23',
    '12\t34',
    '1,23.00',
    '1,2345.00',
  ])('rejects malformed money token %j without stripping it into a different value', (total) => {
    const result = buildTodayDashboard(
      store({
        orders: [
          { id: 'malformed', date: '2026-08-12', total, deposit: 0, paid: 'לא', status: 'אושרה' },
        ],
      }),
      UTC_OPTIONS,
    )

    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'INVALID_MONEY', orderId: 'malformed', path: 'total' }),
    ])
    expect(result.outstandingMinorUnits).toBeNull()
  })

  it.each([
    ['1,234.56', 123_456],
    ['$1,234.56', 123_456],
    [' .50 ', 50],
    ['12.34$', 1_234],
    ['$0.05', 5],
  ] as const)('accepts strict legacy-compatible money %j as exact minor units', (total, amount) => {
    const result = buildTodayDashboard(
      store({
        orders: [
          { id: 'valid-money', date: '2026-08-12', total, deposit: 0, paid: 'לא', status: 'אושרה' },
        ],
      }),
      UTC_OPTIONS,
    )

    expect(result.warnings).toEqual([])
    expect(result.outstandingMinorUnits).toBe(amount)
  })

  it('shows the informational backup reminder only at seven whole days or later', () => {
    const now = new Date('2026-08-12T12:00:00.000Z')
    const day = 86_400_000
    const options = { now, timeZone: 'UTC' } as const

    expect(buildTodayDashboard(store(), options).backupReminder).toEqual({
      kind: 'never',
      daysSinceBackup: null,
    })
    expect(
      buildTodayDashboard(store({ lastBackup: now.getTime() - (7 * day - 1) }), options)
        .backupReminder,
    ).toBeNull()
    expect(
      buildTodayDashboard(store({ lastBackup: now.getTime() - 7 * day }), options).backupReminder,
    ).toEqual({ kind: 'stale', daysSinceBackup: 7 })
  })

  it('preserves unknown fields and never mutates the source store', () => {
    const source = deepFreeze<LegacyStore>({
      orders: [
        {
          id: 'future-order',
          date: '2026-08-13',
          name: 'Actual customer',
          status: 'אושרה',
          meals: '2',
          total: '10.25',
          futureOrderField: { nested: ['keep', 42] },
        },
      ],
      settings: { maxMeals: '8', futureSetting: { enabled: true } },
      futureTopLevel: { version: 7 },
    })
    const before = JSON.stringify(source)
    const orderReference = source.orders[0]
    const futureReference = source.futureTopLevel

    buildTodayDashboard(source, UTC_OPTIONS)

    expect(JSON.stringify(source)).toBe(before)
    expect(source.orders[0]).toBe(orderReference)
    expect(source.futureTopLevel).toBe(futureReference)
    expect(source.orders[0]?.futureOrderField).toEqual({ nested: ['keep', 42] })
    expect(source.settings?.futureSetting).toEqual({ enabled: true })
  })

  it('formats safe integer minor units without floating-point money arithmetic', () => {
    expect(formatUsdMinorUnits(123_456)).toBe('$1,234.56')
    expect(() => formatUsdMinorUnits(1.5)).toThrow(RangeError)
  })
})
