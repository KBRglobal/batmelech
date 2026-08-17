// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../data/use-store.ts'
import type { LegacyOrder, LegacyStore } from '../domain/store.ts'
import {
  computeInsightsKpis,
  computeTopDishes,
  computeWeeklyRevenue,
  InsightsScreen,
} from './insights-screen.tsx'

vi.mock('../data/use-store.ts', () => ({ useStore: vi.fn() }))

const mockedUseStore = vi.mocked(useStore)

function queryResult(
  options: {
    readonly pending?: boolean
    readonly error?: boolean
    readonly store?: LegacyStore | null
    readonly refetch?: ReturnType<typeof vi.fn>
  } = {},
): ReturnType<typeof useStore> {
  return {
    isPending: options.pending === true,
    isError: options.error === true,
    data:
      options.pending === true || options.error === true
        ? undefined
        : { ts: 1, data: options.store ?? { orders: [] } },
    refetch: options.refetch ?? vi.fn(),
  } as unknown as ReturnType<typeof useStore>
}

function renderInsights() {
  return render(<InsightsScreen />)
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

beforeEach(() => {
  mockedUseStore.mockReset()
})

describe('InsightsScreen', () => {
  it('renders the shared loading state while the store query is pending', () => {
    mockedUseStore.mockReturnValue(queryResult({ pending: true }))

    const { container } = renderInsights()

    expect(container.querySelector('[data-state="loading"]')).toBeTruthy()
    expect(screen.getByText('טוענת את התובנות')).toBeTruthy()
  })

  it('renders a retryable error state and retries only after an operator click', async () => {
    const refetch = vi.fn()
    mockedUseStore.mockReturnValue(queryResult({ error: true, refetch }))
    const user = userEvent.setup()

    renderInsights()

    expect(screen.getByText('לא הצלחנו לטעון את התובנות')).toBeTruthy()
    expect(refetch).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'ניסיון נוסף' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('renders the empty state when the store has no orders', () => {
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [] } }))

    const { container } = renderInsights()

    expect(container.querySelector('[data-state="empty"]')).toBeTruthy()
    expect(screen.getByText('עדיין אין הזמנות')).toBeTruthy()
  })

  it('renders KPI money, top dishes, and the invalid-total note from a mixed store', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-18T08:00:00.000Z'))
    mockedUseStore.mockReturnValue(
      queryResult({
        store: {
          orders: [
            {
              id: '1',
              date: '2026-08-16',
              name: 'לקוחה א',
              status: 'אושרה',
              total: '100.10',
              meals: 2,
              salads: { 'סלט חצילים': { o: 2, p: 1 } },
              mains: { 'עוף בתנור': 3 },
            },
            { id: '2', date: '2026-08-10', name: 'לקוחה ב', total: 50, meals: '4' },
            { id: '3', date: '2026-08-10', name: 'לקוחה ג', total: 'abc' },
            { id: '4', date: '2026-08-11', name: 'לקוחה ד', total: '' },
            { id: '5', date: '2026-08-12', name: 'לקוחה ה', status: ' בוטלה ', total: 999 },
          ],
        },
      }),
    )

    renderInsights()

    // KPI row: revenue only from the two valid non-cancelled totals.
    expect(screen.getByText('$150.10')).toBeTruthy()
    expect(screen.getByText('$75.05')).toBeTruthy()
    expect(screen.queryByText('$999.00')).toBeNull()

    // Top dishes aggregated from salads {o,p} and mains numbers.
    expect(screen.getByText('סלט חצילים')).toBeTruthy()
    expect(screen.getByText('עוף בתנור')).toBeTruthy()

    // Two non-cancelled orders inside the 8-week window carry unparsable totals.
    expect(screen.getByText('2 הזמנות עם סכום לא תקין')).toBeTruthy()

    // Peak days include the service dates that carry couple meals.
    expect(screen.getByText('16.08.2026')).toBeTruthy()
    expect(screen.getByText('4 ארוחות זוגיות')).toBeTruthy()
  })
})

describe('computeInsightsKpis', () => {
  it('splits cancelled orders out and averages only over valid totals', () => {
    const kpis = computeInsightsKpis([
      { total: '100.10' },
      { total: 50 },
      { total: 'abc' },
      { total: -5 },
      { status: ' בוטלה ', total: 999 },
    ])

    expect(kpis.activeOrderCount).toBe(4)
    expect(kpis.cancelledOrderCount).toBe(1)
    expect(kpis.revenueMinorUnits).toBe(15_010)
    expect(kpis.averageOrderMinorUnits).toBe(7_505)
  })

  it('returns zeros for an empty order list', () => {
    expect(computeInsightsKpis([])).toEqual({
      activeOrderCount: 0,
      cancelledOrderCount: 0,
      revenueMinorUnits: 0,
      averageOrderMinorUnits: 0,
    })
  })
})

describe('computeTopDishes', () => {
  it('aggregates salads {o,p} with mains numbers and {q} records across orders', () => {
    const result = computeTopDishes([
      {
        salads: { 'סלט גזר': { o: 2, p: 1 }, 'סלט קרוב': { o: 'oops', p: null } },
        mains: { 'עוף בתנור': 3 },
      },
      {
        salads: { 'סלט גזר': { o: 1, p: 0 } },
        mains: { 'עוף בתנור': { q: 2 } },
        extras: { חלות: { q: 5 } },
      },
      { status: 'בוטלה', mains: { 'עוף בתנור': 90 } },
    ])

    expect(result.unreadableFieldCount).toBe(0)
    expect(result.dishes).toEqual([
      { name: 'חלות', quantity: 5 },
      { name: 'עוף בתנור', quantity: 5 },
      { name: 'סלט גזר', quantity: 4 },
    ])
  })

  it('counts a structurally wrong field once and skips bad values silently', () => {
    const malformed = { mains: 'not-a-record' } as unknown as LegacyOrder
    const result = computeTopDishes([
      malformed,
      { desserts: { מוס: { q: 'nope' }, קרמבו: { q: 2 } } },
    ])

    expect(result.unreadableFieldCount).toBe(1)
    expect(result.dishes).toEqual([{ name: 'קרמבו', quantity: 2 }])
  })
})

describe('computeWeeklyRevenue', () => {
  it('buckets the last eight Sunday-based weeks and counts invalid totals', () => {
    const now = new Date('2026-08-18T08:00:00.000Z')
    const result = computeWeeklyRevenue(
      [
        { date: '2026-08-16', total: '100.00' },
        { date: '2026-08-22', total: 25 },
        { date: '2026-06-28', total: 10 },
        { date: '2026-06-27', total: 500 },
        { date: '2026-08-10', total: 'abc' },
        { date: '2026-08-10', status: 'בוטלה', total: 40 },
        { date: 'not-a-date', total: 30 },
      ],
      now,
    )

    expect(result.weeks).toHaveLength(8)
    expect(result.weeks[0]).toEqual({ sundayIso: '2026-06-28', label: '28.06', totalMinorUnits: 1_000 })
    expect(result.weeks[7]).toEqual({ sundayIso: '2026-08-16', label: '16.08', totalMinorUnits: 12_500 })
    expect(result.weeks.slice(1, 7).every((week) => week.totalMinorUnits === 0)).toBe(true)
    expect(result.invalidTotalCount).toBe(1)
  })
})
