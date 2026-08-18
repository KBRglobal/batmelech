import { describe, expect, it } from 'vitest'
import {
  computeCancellationsAnalysis,
  computeCostVsRevenueWeekly,
  computeHotelStats,
  computeQuickQuote,
  computeWeekComparison,
  computeYearlySummary,
  isCancelledInsightsOrder,
  NO_HOTEL_LABEL,
} from './insights.ts'
import { buildOrderEditorMenu } from './order-editor.ts'
import type { LegacyStore } from './store.ts'

// Tuesday 2026-08-18 in Asia/Dubai. Current week: Sun 2026-08-16 .. Sat 2026-08-22.
const NOW = new Date('2026-08-18T08:00:00.000Z')

describe('isCancelledInsightsOrder', () => {
  it('accepts the Hebrew status with surrounding spaces and the English aliases', () => {
    expect(isCancelledInsightsOrder({ status: ' בוטלה ' })).toBe(true)
    expect(isCancelledInsightsOrder({ status: 'Cancelled' })).toBe(true)
    expect(isCancelledInsightsOrder({ status: 'canceled' })).toBe(true)
    expect(isCancelledInsightsOrder({ status: 'אושרה' })).toBe(false)
    expect(isCancelledInsightsOrder({})).toBe(false)
  })
})

describe('computeWeekComparison', () => {
  it('buckets orders into the current and previous Sunday-based weeks', () => {
    const comparison = computeWeekComparison(
      [
        { date: '2026-08-16', total: '100.00', meals: 2 },
        { date: '2026-08-22', total: 50, meals: '1' },
        { date: '2026-08-09', total: 30, meals: 3 },
        { date: '2026-08-15', total: '20.50', meals: 1 },
        { date: '2026-08-08', total: 999 }, // two weeks back — outside both slices
        { date: '2026-08-23', total: 999 }, // next week — outside both slices
        { date: '2026-08-17', status: 'בוטלה', total: 999 },
      ],
      NOW,
    )

    expect(comparison.current.startIso).toBe('2026-08-16')
    expect(comparison.current.endIso).toBe('2026-08-22')
    expect(comparison.previous.startIso).toBe('2026-08-09')
    expect(comparison.current.orderCount).toBe(2)
    expect(comparison.current.meals).toBe(3)
    expect(comparison.current.revenueMinorUnits).toBe(15_000)
    expect(comparison.previous.orderCount).toBe(2)
    expect(comparison.previous.meals).toBe(4)
    expect(comparison.previous.revenueMinorUnits).toBe(5_050)
    expect(comparison.invalidTotalCount).toBe(0)
  })

  it('excludes invalid totals from revenue and counts them honestly', () => {
    const comparison = computeWeekComparison(
      [
        { date: '2026-08-17', total: 'abc', meals: 2 },
        { date: '2026-08-17', total: '10.00' },
        { date: '2026-08-10', total: '12,34' },
      ],
      NOW,
    )

    expect(comparison.current.orderCount).toBe(2)
    expect(comparison.current.revenueMinorUnits).toBe(1_000)
    expect(comparison.current.invalidTotalCount).toBe(1)
    expect(comparison.previous.invalidTotalCount).toBe(1)
    expect(comparison.invalidTotalCount).toBe(2)
  })

  it('resolves the week boundary in Dubai time, not UTC', () => {
    // 21:00 UTC on Saturday 2026-08-15 is already Sunday 2026-08-16 in Asia/Dubai.
    const boundaryNow = new Date('2026-08-15T21:00:00.000Z')
    const comparison = computeWeekComparison(
      [
        { date: '2026-08-16', total: '10.00' },
        { date: '2026-08-15', total: '20.00' },
      ],
      boundaryNow,
    )

    expect(comparison.current.startIso).toBe('2026-08-16')
    expect(comparison.current.revenueMinorUnits).toBe(1_000)
    expect(comparison.previous.startIso).toBe('2026-08-09')
    expect(comparison.previous.revenueMinorUnits).toBe(2_000)
  })
})

describe('computeCancellationsAnalysis', () => {
  it('computes count, rate, recent list, and the weekday that cancels most', () => {
    const analysis = computeCancellationsAnalysis(
      [
        { date: '2026-08-17', name: 'רות', status: 'בוטלה' }, // Monday
        { date: '2026-08-10', name: 'שרה', status: 'בוטלה' }, // Monday
        { date: '2026-08-11', status: 'בוטלה' }, // Tuesday, nameless
        { date: '2026-08-12', total: 10 },
        { date: '2026-08-13', total: 10 },
        { date: '2026-08-14', total: 10 },
        { date: '2026-06-01', status: 'בוטלה' }, // before the 8-week window
        { date: 'not-a-date', status: 'בוטלה' },
      ],
      NOW,
    )

    expect(analysis.windowStartIso).toBe('2026-06-28')
    expect(analysis.windowEndIso).toBe('2026-08-22')
    expect(analysis.cancelledCount).toBe(3)
    expect(analysis.totalCount).toBe(6)
    expect(analysis.ratePercent).toBe(50)
    expect(analysis.topWeekday).toEqual({ label: 'יום שני', count: 2 })
    expect(analysis.recent.map((item) => item.name)).toEqual(['רות', 'ללא שם', 'שרה'])
    expect(analysis.recent[0]).toEqual({ name: 'רות', dateIso: '2026-08-17', label: '17.08.2026' })
  })

  it('reports a zero rate and no weekday when nothing was cancelled', () => {
    const analysis = computeCancellationsAnalysis([{ date: '2026-08-17', total: 10 }], NOW)

    expect(analysis.cancelledCount).toBe(0)
    expect(analysis.ratePercent).toBe(0)
    expect(analysis.topWeekday).toBeNull()
    expect(analysis.recent).toEqual([])
  })
})

describe('computeCostVsRevenueWeekly', () => {
  it('pairs weekly revenue with recorded expenses and keeps missing weeks unknown', () => {
    const result = computeCostVsRevenueWeekly(
      {
        orders: [
          { date: '2026-08-17', total: '100.00' },
          { date: '2026-08-10', total: '80.00' },
          { date: '2026-08-10', status: 'בוטלה', total: 999 },
        ],
        expenses: {
          '2026-08-17': '30.00',
          '2026-08-18': '10.00',
          '2020-01-01': '999.00', // outside the window
          'not-a-date': '5.00',
        },
      },
      NOW,
    )

    expect(result.weeks).toHaveLength(8)
    const current = result.weeks[7]!
    expect(current.startIso).toBe('2026-08-16')
    expect(current.revenueMinorUnits).toBe(10_000)
    expect(current.expensesMinorUnits).toBe(4_000)
    expect(current.gapMinorUnits).toBe(6_000)

    const previous = result.weeks[6]!
    expect(previous.revenueMinorUnits).toBe(8_000)
    expect(previous.expensesMinorUnits).toBeNull()
    expect(previous.gapMinorUnits).toBeNull()
    expect(result.weeks[0]!.expensesMinorUnits).toBeNull()
  })

  it('counts invalid totals and invalid expense records instead of guessing', () => {
    const result = computeCostVsRevenueWeekly(
      {
        orders: [
          { date: '2026-08-17', total: 'abc' },
          { date: '2026-08-17', total: '10.00' },
        ],
        expenses: { '2026-08-17': 'oops', '2026-08-18': '2.00' },
      },
      NOW,
    )

    expect(result.invalidTotalCount).toBe(1)
    expect(result.invalidExpenseCount).toBe(1)
    expect(result.weeks[7]!.revenueMinorUnits).toBe(1_000)
    expect(result.weeks[7]!.expensesMinorUnits).toBe(200)
  })

  it('can report expenses for a week that has no orders', () => {
    const result = computeCostVsRevenueWeekly(
      { orders: [], expenses: { '2026-08-16': '7.00' } },
      NOW,
    )

    expect(result.weeks[7]!.revenueMinorUnits).toBe(0)
    expect(result.weeks[7]!.expensesMinorUnits).toBe(700)
    expect(result.weeks[7]!.gapMinorUnits).toBe(-700)
  })
})

describe('computeYearlySummary', () => {
  it('summarizes the current calendar year with best month and busiest weekday', () => {
    const summary = computeYearlySummary(
      [
        { date: '2026-02-06', total: '100.00' }, // Friday
        { date: '2026-02-13', total: '50.00' }, // Friday
        { date: '2026-08-17', total: '120.00' }, // Monday
        { date: '2026-08-18', total: 'abc' },
        { date: '2026-03-01', status: 'בוטלה', total: 999 },
        { date: '2025-12-31', total: 999 }, // previous year
      ],
      NOW,
    )

    expect(summary.year).toBe(2026)
    expect(summary.orderCount).toBe(4)
    expect(summary.revenueMinorUnits).toBe(27_000)
    expect(summary.invalidTotalCount).toBe(1)
    expect(summary.bestMonth?.month).toBe(2)
    expect(summary.bestMonth?.revenueMinorUnits).toBe(15_000)
    expect(summary.busiestWeekday).toEqual({ label: 'יום שישי', count: 2 })
  })

  it('returns nulls when the year has no usable data', () => {
    const summary = computeYearlySummary([{ date: '2019-01-01', total: 10 }], NOW)

    expect(summary.orderCount).toBe(0)
    expect(summary.revenueMinorUnits).toBe(0)
    expect(summary.bestMonth).toBeNull()
    expect(summary.busiestWeekday).toBeNull()
  })
})

describe('computeHotelStats', () => {
  it('groups by trimmed hotelName with place fallback and an explicit no-hotel bucket', () => {
    const stats = computeHotelStats([
      { hotelName: ' Address Marina ', total: '100.00' },
      { place: 'Address Marina', total: '50.00' },
      { place: 'Ritz', total: 'abc' },
      { name: 'ללא מקום', total: '10.00' },
      { hotelName: 'Ritz', status: 'בוטלה', total: 999 },
    ])

    expect(stats).toEqual([
      {
        name: 'Address Marina',
        orderCount: 2,
        revenueMinorUnits: 15_000,
        invalidTotalCount: 0,
      },
      { name: NO_HOTEL_LABEL, orderCount: 1, revenueMinorUnits: 1_000, invalidTotalCount: 0 },
      { name: 'Ritz', orderCount: 1, revenueMinorUnits: 0, invalidTotalCount: 1 },
    ])
  })

  it('honors the limit after sorting by order count then revenue', () => {
    const stats = computeHotelStats(
      [
        { place: 'A', total: '10.00' },
        { place: 'A', total: '10.00' },
        { place: 'B', total: '90.00' },
        { place: 'C', total: '5.00' },
      ],
      2,
    )

    expect(stats.map((stat) => stat.name)).toEqual(['A', 'B'])
  })
})

describe('computeQuickQuote', () => {
  const fixtureStore: LegacyStore = {
    orders: [],
    menu: {
      couplePrice: 200,
      challahPrice: 12,
      saladBlockPrice: 30,
      saladUnitPrice: 8,
      fishExtraPrice: 25,
    },
  }
  const menu = buildOrderEditorMenu(fixtureStore)

  it('prices every stepper from the live menu, including salad block math', () => {
    const quote = computeQuickQuote(menu, {
      couples: 2,
      extraChallahs: 3,
      extraSalads: 6,
      extraFirsts: 2,
    })

    expect(quote.lines).toEqual([
      { label: 'ארוחות זוגיות', quantity: 2, amountMinorUnits: 40_000 },
      { label: 'חלות נוספות', quantity: 3, amountMinorUnits: 3_600 },
      // 6 extra salads = one block of 4 ($30) + 2 singles ($8 each).
      { label: 'סלטים נוספים', quantity: 6, amountMinorUnits: 4_600 },
      { label: 'מנות ראשונות נוספות', quantity: 2, amountMinorUnits: 5_000 },
    ])
    expect(quote.totalMinorUnits).toBe(53_200)
  })

  it('uses the default menu prices when the store has no saved menu', () => {
    const defaultMenu = buildOrderEditorMenu({ orders: [] })
    const quote = computeQuickQuote(defaultMenu, {
      couples: 1,
      extraChallahs: 1,
      extraSalads: 0,
      extraFirsts: 1,
    })

    expect(quote.totalMinorUnits).toBe(23_000 + 1_000 + 3_000)
  })

  it('returns an empty estimate for zero quantities and rejects invalid counts', () => {
    const empty = computeQuickQuote(menu, {
      couples: 0,
      extraChallahs: 0,
      extraSalads: 0,
      extraFirsts: 0,
    })
    expect(empty.lines).toEqual([])
    expect(empty.totalMinorUnits).toBe(0)

    expect(() =>
      computeQuickQuote(menu, { couples: -1, extraChallahs: 0, extraSalads: 0, extraFirsts: 0 }),
    ).toThrow(RangeError)
    expect(() =>
      computeQuickQuote(menu, { couples: 1.5, extraChallahs: 0, extraSalads: 0, extraFirsts: 0 }),
    ).toThrow(RangeError)
  })
})
