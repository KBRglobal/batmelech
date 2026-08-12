import { describe, expect, it } from 'vitest'
import {
  buildCustomersDirectory,
  buildFinanceDashboard,
  formatFinanceMonth,
  formatSignedUsdMinorUnits,
  parseLegacyUsdAmount,
} from './customers-finance.ts'
import type { LegacyStore } from './store.ts'

describe('parseLegacyUsdAmount', () => {
  it('parses only exact non-negative USD values into integer minor units', () => {
    expect(parseLegacyUsdAmount(undefined)).toEqual({ state: 'absent', minorUnits: 0 })
    expect(parseLegacyUsdAmount('')).toEqual({ state: 'absent', minorUnits: 0 })
    expect(parseLegacyUsdAmount(0.1)).toEqual({ state: 'valid', minorUnits: 10 })
    expect(parseLegacyUsdAmount('$1,234.5')).toEqual({ state: 'valid', minorUnits: 123_450 })
    expect(parseLegacyUsdAmount('.25$')).toEqual({ state: 'valid', minorUnits: 25 })
  })

  it.each(['1,2,3', '1.001', '-1', '1e2', '1 00', '$1$', {}, Number.NaN])(
    'rejects malformed legacy money %p instead of coercing it',
    (value) => {
      expect(parseLegacyUsdAmount(value)).toEqual({
        state: 'invalid',
        minorUnits: null,
        reason: 'format',
      })
    },
  )

  it('rejects values outside the safe minor-unit range', () => {
    expect(parseLegacyUsdAmount('90071992547409.92')).toEqual({
      state: 'invalid',
      minorUnits: null,
      reason: 'overflow',
    })
  })
})

describe('money and month formatting', () => {
  it('formats positive, zero, and negative exact minor-unit values', () => {
    expect(formatSignedUsdMinorUnits(0)).toBe('$0.00')
    expect(formatSignedUsdMinorUnits(123_456)).toBe('$1,234.56')
    expect(formatSignedUsdMinorUnits(-25)).toBe('-$0.25')
    expect(() => formatSignedUsdMinorUnits(0.5)).toThrow(/safe integer/)
  })

  it('formats real month keys and rejects impossible ones', () => {
    expect(formatFinanceMonth('2026-08', 'en-US')).toBe('August 2026')
    expect(() => formatFinanceMonth('2026-13')).toThrow(/real month/)
    expect(() => formatFinanceMonth('08.2026')).toThrow(/YYYY-MM/)
  })
})

describe('buildCustomersDirectory', () => {
  it('normalizes equivalent phones, preserves real metadata, exact spend, history, and Dubai upcoming state', () => {
    const store: LegacyStore = {
      orders: [
        {
          id: 'older',
          date: '2026-08-10',
          name: '  שרה   לוי  ',
          phone: '050-123-4567',
          total: '0.10',
          meals: 1,
          status: 'נמסרה',
        },
        {
          id: 'latest-active',
          date: '2026-08-12',
          name: 'שרה לוי',
          phone: '+972 50 123 4567',
          total: '0.20',
          meals: '2',
          status: 'מוכנה',
        },
        {
          id: 'cancelled',
          date: '2026-08-13',
          name: 'שרה לוי',
          phone: '0501234567',
          total: '99.00',
          status: 'בוטלה',
        },
      ],
      customerMeta: {
        '0501234567': { vip: true, notes: 'אלרגיה לאגוזים' },
      },
    }

    const result = buildCustomersDirectory(store, {
      now: new Date('2026-08-11T20:30:00.000Z'),
    })

    expect(result.todayIso).toBe('2026-08-12')
    expect(result.customers).toHaveLength(1)
    expect(result.customers[0]).toMatchObject({
      name: 'שרה לוי',
      vip: true,
      notes: 'אלרגיה לאגוזים',
      orderCount: 3,
      activeOrderCount: 2,
      totalSpendMinorUnits: 30,
      spendComplete: true,
      hasUpcomingOrder: true,
      repeatOrderId: 'latest-active',
      telephoneHref: 'tel:+972501234567',
      whatsappHref: 'https://wa.me/972501234567',
    })
    expect(result.customers[0]?.history.map((order) => order.orderId)).toEqual([
      'cancelled',
      'latest-active',
      'older',
    ])
  })

  it('normalizes name-only customers but does not merge anonymous or differently malformed phones', () => {
    const result = buildCustomersDirectory(
      {
        orders: [
          { id: 'a', name: 'Ada   Lovelace', total: 1 },
          { id: 'b', name: 'ada lovelace', total: 2 },
          { id: 'c', name: 'Ada Lovelace', phone: '12', total: 3 },
          { id: 'd', name: 'Ada Lovelace', phone: '34', total: 4 },
          { id: 'e', total: 5 },
          { id: 'f', total: 6 },
        ],
      },
      { locale: 'en-US', now: new Date('2026-08-12T00:00:00Z') },
    )

    expect(result.customers).toHaveLength(5)
    expect(result.customers.find((customer) => customer.key === 'name:ada lovelace')).toMatchObject({
      orderCount: 2,
      totalSpendMinorUnits: 300,
    })
    expect(result.warnings.filter((warning) => warning.code === 'INVALID_PHONE')).toHaveLength(2)
    expect(
      result.warnings.filter((warning) => warning.code === 'MISSING_CUSTOMER_IDENTITY'),
    ).toHaveLength(2)
  })

  it('fails closed on malformed amounts and ambiguous IDs without exposing unsafe navigation', () => {
    const result = buildCustomersDirectory({
      orders: [
        { id: 7, date: '2026-08-12', name: 'לקוחה', phone: '0501234567', total: '1,2,3' },
        { id: '7', date: '2026-08-11', name: 'לקוחה', phone: '+972501234567', total: '1.00' },
      ],
    })

    expect(result.customers[0]).toMatchObject({
      totalSpendMinorUnits: null,
      spendComplete: false,
      repeatOrderId: null,
    })
    expect(result.customers[0]?.history.every((order) => order.orderId === null)).toBe(true)
    expect(result.warnings.some((warning) => warning.code === 'INVALID_MONEY')).toBe(true)
    expect(result.warnings.filter((warning) => warning.code === 'DUPLICATE_ORDER_ID')).toHaveLength(2)
  })

  it('reads all real metadata aliases, keeps VIP, and warns instead of choosing conflicting notes silently', () => {
    const result = buildCustomersDirectory({
      orders: [
        { id: 'a', name: 'לקוחה', phone: '0501234567' },
        { id: 'b', name: 'לקוחה', phone: '+972501234567' },
      ],
      customerMeta: {
        '0501234567': { notes: 'הערה מקומית' },
        '972501234567': { vip: true, notes: 'הערה בינלאומית' },
      },
    })

    expect(result.customers[0]).toMatchObject({ vip: true, notes: '' })
    expect(result.warnings.some((warning) => warning.code === 'AMBIGUOUS_CUSTOMER_META')).toBe(true)
  })

  it('ignores malformed metadata fields and reports them', () => {
    const result = buildCustomersDirectory({
      orders: [{ id: 'a', name: 'לקוחה', phone: '0501234567' }],
      customerMeta: {
        '0501234567': { vip: 'yes', notes: 42 },
      },
    })

    expect(result.customers[0]).toMatchObject({ vip: false, notes: '' })
    expect(result.warnings.filter((warning) => warning.code === 'INVALID_CUSTOMER_META')).toHaveLength(2)
  })

  it('searches normalized real name, phone, and notes without changing the source', () => {
    const store: LegacyStore = {
      orders: [
        { id: 'a', name: 'שרה', phone: '0501234567' },
        { id: 'b', name: 'דינה', phone: '0507654321' },
      ],
      customerMeta: { '0501234567': { notes: 'ללא גלוטן' } },
    }
    const snapshot = JSON.stringify(store)

    expect(buildCustomersDirectory(store, { query: 'גלוטן' }).customers.map((c) => c.name)).toEqual([
      'שרה',
    ])
    expect(buildCustomersDirectory(store, { query: '050765' }).customers.map((c) => c.name)).toEqual([
      'דינה',
    ])
    expect(JSON.stringify(store)).toBe(snapshot)
  })

  it('finds a customer through an older equivalent phone after the displayed phone changes', () => {
    const store: LegacyStore = {
      orders: [
        { id: 'old', date: '2026-08-10', name: 'שרה', phone: '050-123-4567' },
        { id: 'new', date: '2026-08-11', name: 'שרה', phone: '+972 50 123 4567' },
      ],
    }

    const result = buildCustomersDirectory(store, { query: '050123' })

    expect(result.customers).toHaveLength(1)
    expect(result.customers[0]?.name).toBe('שרה')
  })

  it('returns a true empty directory for a store with no orders', () => {
    const result = buildCustomersDirectory({ orders: [] })
    expect(result.globallyEmpty).toBe(true)
    expect(result.customers).toEqual([])
    expect(result.warnings).toEqual([])
  })
})

describe('buildFinanceDashboard', () => {
  it('calculates exact revenue, deposits, outstanding, expenses, profit, meals, days, and top customers', () => {
    const result = buildFinanceDashboard(
      {
        orders: [
          {
            id: 'a',
            date: '2026-08-12',
            name: 'שרה',
            phone: '0501234567',
            total: '0.10',
            deposit: '0.05',
            paid: 'לא',
            meals: 1,
          },
          {
            id: 'b',
            date: '2026-08-12',
            name: 'שרה',
            phone: '+972501234567',
            total: '0.20',
            deposit: 0,
            paid: 'כן',
            meals: '2',
          },
          {
            id: 'cancelled',
            date: '2026-08-12',
            name: 'לא נספרת',
            total: 100,
            status: 'cancelled',
          },
          { id: 'later', date: '2026-09-01', name: 'חודש אחר', total: 2 },
        ],
        expenses: { '2026-08-12': '0.10', '2026-08-13': '0.05' },
      },
      { selectedMonth: '2026-08', now: new Date('2026-08-12T00:00:00Z') },
    )

    expect(result).toMatchObject({
      selectedMonth: '2026-08',
      orderCount: 2,
      revenueMinorUnits: 30,
      depositsMinorUnits: 5,
      outstandingMinorUnits: 5,
      expensesMinorUnits: 15,
      profitMinorUnits: 15,
      meals: 3,
    })
    expect(result.days).toHaveLength(2)
    expect(result.days[0]).toMatchObject({
      serviceDate: '2026-08-12',
      orderCount: 2,
      revenueMinorUnits: 30,
      depositsMinorUnits: 5,
      outstandingMinorUnits: 5,
      expensesMinorUnits: 10,
      profitMinorUnits: 20,
      meals: 3,
    })
    expect(result.days[1]).toMatchObject({
      serviceDate: '2026-08-13',
      orderCount: 0,
      revenueMinorUnits: 0,
      expensesMinorUnits: 5,
      profitMinorUnits: -5,
    })
    expect(result.topCustomers).toEqual([
      { key: 'phone:972501234567', name: 'שרה', orderCount: 2, revenueMinorUnits: 30 },
    ])
  })

  it('uses Dubai calendar boundaries when choosing the default month', () => {
    const result = buildFinanceDashboard(
      {
        orders: [
          { id: 'july', date: '2026-07-31', name: 'יולי', total: 1 },
          { id: 'august', date: '2026-08-01', name: 'אוגוסט', total: 2 },
        ],
      },
      { now: new Date('2026-07-31T21:00:00.000Z') },
    )

    expect(result.currentMonth).toBe('2026-08')
    expect(result.selectedMonth).toBe('2026-08')
    expect(result.revenueMinorUnits).toBe(200)
    expect(result.availableMonths).toEqual(['2026-08', '2026-07'])
  })

  it('reports malformed amounts only for the selected month while keeping unassignable dates visible', () => {
    const result = buildFinanceDashboard(
      {
        orders: [
          { date: '2026-08-12', name: 'אוגוסט', total: 1 },
          { date: '2026-09-12', name: 'ספטמבר', total: '1,2,3' },
          { date: 'not-a-date', name: 'בלי חודש', total: 2 },
        ],
      },
      { selectedMonth: '2026-08' },
    )

    expect(result.revenueMinorUnits).toBe(100)
    expect(result.warnings.some((warning) => warning.customerName === 'ספטמבר')).toBe(false)
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'INVALID_SERVICE_DATE', customerName: 'בלי חודש' }),
    )
  })

  it('chooses the latest available past month, or the earliest future month', () => {
    const historical = buildFinanceDashboard(
      {
        orders: [
          { date: '2024-01-01', name: 'א', total: 1 },
          { date: '2025-02-01', name: 'ב', total: 2 },
        ],
      },
      { now: new Date('2026-01-01T00:00:00Z') },
    )
    const future = buildFinanceDashboard(
      {
        orders: [
          { date: '2030-05-01', name: 'א', total: 1 },
          { date: '2030-06-01', name: 'ב', total: 2 },
        ],
      },
      { now: new Date('2026-01-01T00:00:00Z') },
    )

    expect(historical.selectedMonth).toBe('2025-02')
    expect(future.selectedMonth).toBe('2030-05')
  })

  it('fails each affected total closed when money, expenses, dates, or meals are malformed', () => {
    const result = buildFinanceDashboard(
      {
        orders: [
          {
            id: 'bad',
            date: '2026-08-12',
            name: 'סכום לא תקין',
            total: '1,2,3',
            deposit: '0.10',
            meals: '1.5',
          },
          { id: 'invalid-date', date: '2026-02-30', name: 'תאריך לא תקין', total: 100 },
          { id: 'cancelled', date: 'not-a-date', name: 'מבוטלת', total: 'also-bad', status: 'בוטלה' },
        ],
        expenses: { '2026-08-12': '2.999', '2026-02-30': 5 },
      },
      { selectedMonth: '2026-08' },
    )

    expect(result).toMatchObject({
      revenueMinorUnits: null,
      depositsMinorUnits: 10,
      outstandingMinorUnits: null,
      expensesMinorUnits: null,
      profitMinorUnits: null,
      meals: null,
    })
    expect(result.topCustomers).toEqual([])
    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        'INVALID_MONEY',
        'INVALID_QUANTITY',
        'INVALID_SERVICE_DATE',
        'INVALID_EXPENSE_DATE',
      ]),
    )
    expect(result.warnings.filter((warning) => warning.customerName === 'מבוטלת')).toEqual([])
  })

  it('fails closed when otherwise valid sums overflow safe minor units', () => {
    const result = buildFinanceDashboard(
      {
        orders: [
          { date: '2026-08-12', name: 'א', total: '90071992547409.91' },
          { date: '2026-08-12', name: 'ב', total: '0.01' },
        ],
      },
      { selectedMonth: '2026-08' },
    )

    expect(result.revenueMinorUnits).toBeNull()
    expect(result.profitMinorUnits).toBeNull()
    expect(result.warnings.some((warning) => warning.code === 'MONEY_OVERFLOW')).toBe(true)
  })

  it('classifies aggregate meal overflow as quantity overflow, not money overflow', () => {
    const result = buildFinanceDashboard(
      {
        orders: [
          { date: '2026-08-12', name: 'א', meals: Number.MAX_SAFE_INTEGER },
          { date: '2026-08-12', name: 'ב', meals: 1 },
        ],
      },
      { selectedMonth: '2026-08' },
    )

    expect(result.meals).toBeNull()
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'QUANTITY_OVERFLOW', path: 'finance.meals' }),
    )
    expect(
      result.warnings.some(
        (warning) => warning.code === 'MONEY_OVERFLOW' && warning.path === 'finance.meals',
      ),
    ).toBe(false)
  })

  it('keeps paid and partnership orders at zero outstanding while retaining recorded deposits', () => {
    const result = buildFinanceDashboard(
      {
        orders: [
          { date: '2026-08-12', name: 'שולמה', total: 10, deposit: 2, paid: 'כן' },
          { date: '2026-08-12', name: 'שתפ', total: 20, deposit: 3, paid: 'שת"פ' },
          { date: '2026-08-12', name: 'מקדמה גדולה', total: 5, deposit: 7, paid: 'לא' },
        ],
      },
      { selectedMonth: '2026-08' },
    )

    expect(result.revenueMinorUnits).toBe(3_500)
    expect(result.depositsMinorUnits).toBe(1_200)
    expect(result.outstandingMinorUnits).toBe(0)
  })

  it('returns a genuine empty report without mutating the store', () => {
    const store: LegacyStore = { orders: [], expenses: {} }
    const snapshot = JSON.stringify(store)
    const result = buildFinanceDashboard(store)

    expect(result.globallyEmpty).toBe(true)
    expect(result.selectedMonth).toBeNull()
    expect(result.days).toEqual([])
    expect(JSON.stringify(store)).toBe(snapshot)
  })
})
