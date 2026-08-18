import { describe, expect, it } from 'vitest'
import { computeMissingData, computeMonthlyExpenses, computeOrderCosts, computeWeeklyCosts } from './cost-report.ts'
import type { LegacyStore } from './store.ts'

const CABBAGE_PRODUCT = {
  id: 'cabbage',
  name: 'כרוב לבן',
  category: '',
  kosherOnly: false,
  supplierOverride: null,
  insignificant: false,
  listings: {
    nesto: { packSize: '1', packUnit: 'ק"ג', packPriceMinorUnits: 699, updatedAt: Date.now(), manualPrice: null },
  },
}

function storeWith(overrides: Record<string, unknown>): LegacyStore {
  return { orders: [], ...overrides } as unknown as LegacyStore
}

describe('computeMonthlyExpenses', () => {
  it('groups expenses and non-cancelled revenue by month', () => {
    const store = storeWith({
      orders: [
        { id: 'a', date: '2026-08-07', total: '500', status: 'חדשה' },
        { id: 'b', date: '2026-08-14', total: '250', status: 'בוטלה' },
        { id: 'c', date: '2026-07-10', total: '100', status: 'נמסרה' },
      ],
      expenses: { '2026-08-03': '120.50', '2026-08-10': '80', '2026-07-01': 'junk' },
    })
    const rows = computeMonthlyExpenses(store)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ monthKey: '2026-07', revenueMinorUnits: 10000, expensesMinorUnits: 0, invalidCount: 1 })
    expect(rows[1]).toMatchObject({ monthKey: '2026-08', revenueMinorUnits: 50000, expensesMinorUnits: 20050, invalidCount: 0 })
  })
})

describe('computeWeeklyCosts', () => {
  it('aggregates order rows into calendar weeks and flags incompleteness', () => {
    const rows = computeWeeklyCosts([
      { orderId: 'a', customerName: '', serviceDate: '2026-08-21', costMinorUnits: 1000, complete: true, revenueMinorUnits: 5000, marginMinorUnits: 4000 },
      { orderId: 'b', customerName: '', serviceDate: '2026-08-22', costMinorUnits: 2000, complete: false, revenueMinorUnits: 7000, marginMinorUnits: 5000 },
      { orderId: 'c', customerName: '', serviceDate: '2026-08-28', costMinorUnits: 500, complete: true, revenueMinorUnits: null, marginMinorUnits: null },
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ costMinorUnits: 3000, revenueMinorUnits: 12000, marginMinorUnits: 9000, orderCount: 2, complete: false })
    expect(rows[1]!.complete).toBe(false) // revenue unknown → the week is marked partial
  })
})

describe('computeOrderCosts', () => {
  it('never invents a cost: an order whose items lack recipes is flagged partial', () => {
    const store = storeWith({
      orders: [
        {
          id: 'order-1',
          date: '2026-08-21',
          name: 'חלי',
          status: 'חדשה',
          total: '675',
          meals: 1,
          salads: {},
        },
      ],
      productLibrary: [CABBAGE_PRODUCT],
    })
    const rows = computeOrderCosts(store)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.revenueMinorUnits).toBe(67500)
    expect(rows[0]!.complete).toBe(false)
    expect(rows[0]!.marginMinorUnits).toBe(67500 - rows[0]!.costMinorUnits)
  })

  it('skips cancelled orders entirely', () => {
    const store = storeWith({
      orders: [{ id: 'x', date: '2026-08-21', name: 'בוטלה', status: 'בוטלה', total: '100' }],
    })
    expect(computeOrderCosts(store)).toHaveLength(0)
  })
})

describe('computeMissingData', () => {
  it('reports dishes without recipes and stale product prices', () => {
    const staleAt = Date.now() - 40 * 86_400_000
    const store = storeWith({
      productLibrary: [
        { ...CABBAGE_PRODUCT, id: 'stale', name: 'ישן', listings: { nesto: { ...CABBAGE_PRODUCT.listings.nesto, updatedAt: staleAt } } },
        CABBAGE_PRODUCT,
      ],
    })
    const report = computeMissingData(store, Date.now())
    expect(report.dishesWithoutRecipes.length).toBeGreaterThan(0)
    expect(report.staleProducts).toEqual([{ id: 'stale', name: 'ישן', updatedAt: staleAt }])
  })
})
