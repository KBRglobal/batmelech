// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_ROUTES } from '../app/routes.ts'
import { useStore } from '../data/use-store.ts'
import type { CustomerFinanceSaveHandler } from '../domain/customers-finance.ts'
import type { LegacyStore } from '../domain/store.ts'
import { FinanceScreen } from './finance-screen.tsx'

vi.mock('../data/use-store.ts', () => ({ useStore: vi.fn() }))

const mockedUseStore = vi.mocked(useStore)
const HASH = 'b'.repeat(64)

function queryResult(
  options: {
    readonly pending?: boolean
    readonly error?: boolean
    readonly store?: LegacyStore | null
    readonly refetch?: ReturnType<typeof vi.fn>
    readonly revision?: number
  } = {},
): ReturnType<typeof useStore> {
  return {
    isPending: options.pending === true,
    isError: options.error === true,
    data:
      options.pending === true || options.error === true
        ? undefined
        : {
            revision: options.revision ?? 1,
            ts: options.revision ?? 1,
            hash: HASH,
            data: options.store ?? { orders: [] },
          },
    refetch: options.refetch ?? vi.fn(),
  } as unknown as ReturnType<typeof useStore>
}

function renderFinance(onSave?: CustomerFinanceSaveHandler) {
  return render(
    <MemoryRouter initialEntries={[APP_ROUTES.finance]}>
      <FinanceScreen onSave={onSave} />
    </MemoryRouter>,
  )
}

// Mirrors the screen's business-time-zone month bucketing (Asia/Dubai).
function businessMonthKey(offsetMonths: number): string {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    year: 'numeric',
    month: '2-digit',
    timeZone: 'Asia/Dubai',
  }).formatToParts(new Date())
  const year = Number(parts.find((part) => part.type === 'year')!.value)
  const month = Number(parts.find((part) => part.type === 'month')!.value)
  const date = new Date(Date.UTC(year, month - 1 + offsetMonths, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

afterEach(cleanup)

beforeEach(() => {
  mockedUseStore.mockReset()
})

describe('FinanceScreen', () => {
  it('renders the shared loading state', () => {
    mockedUseStore.mockReturnValue(queryResult({ pending: true }))
    const { container } = renderFinance()

    expect(container.querySelector('[data-state="loading"]')).toBeTruthy()
    expect(screen.getByText('טוענת את הנתונים הכספיים')).toBeTruthy()
  })

  it('renders a retryable error without retrying automatically', async () => {
    const refetch = vi.fn()
    mockedUseStore.mockReturnValue(queryResult({ error: true, refetch }))
    const user = userEvent.setup()
    renderFinance()

    expect(refetch).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'ניסיון נוסף' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('renders a genuine empty state with a current-month expense editor', () => {
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [], expenses: {} } }))
    renderFinance()

    expect(screen.getByText('עדיין אין נתונים כספיים')).toBeTruthy()
    expect(screen.getByLabelText('חודש')).toBeTruthy()
    expect(screen.getByLabelText('תאריך ההוצאה')).toBeTruthy()
    expect(screen.getByLabelText('סכום ההוצאה בדולרים')).toBeTruthy()

    const overview = screen.getByRole('region', { name: 'תמונת מצב כללית' })
    expect(within(overview).getAllByText('$0.00')).toHaveLength(3)
    expect(within(overview).getByText('0')).toBeTruthy()
    expect(screen.getByText('אין יתרות פתוחות — כל ההזמנות הפעילות שולמו.')).toBeTruthy()
  })

  it('renders exact injected month and day financials, deposits, expenses, and normalized top customers', () => {
    mockedUseStore.mockReturnValue(
      queryResult({
        store: {
          orders: [
            {
              id: 'a',
              date: '2099-08-12',
              name: 'לקוחה אמיתית',
              phone: '0501234567',
              total: '0.10',
              deposit: '0.05',
              paid: 'לא',
              meals: 1,
            },
            {
              id: 'b',
              date: '2099-08-12',
              name: 'לקוחה אמיתית',
              phone: '+972501234567',
              total: '0.20',
              deposit: 0,
              paid: 'כן',
              meals: 2,
            },
          ],
          expenses: { '2099-08-12': '0.10' },
        },
      }),
    )

    const { container } = renderFinance()
    const summary = screen.getByRole('region', { name: 'סיכום חודשי' })

    expect(screen.getByRole('heading', { name: /כספים — אוגוסט 2099/ })).toBeTruthy()
    expect(within(summary).getByText('$0.30')).toBeTruthy()
    expect(within(summary).getAllByText('$0.05')).toHaveLength(2)
    expect(within(summary).getByText('$0.10')).toBeTruthy()
    expect(within(summary).getByText('$0.20')).toBeTruthy()
    expect(within(summary).getByText('3')).toBeTruthy()
    expect(screen.getAllByText('לקוחה אמיתית').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('2 הזמנות בחודש')).toBeTruthy()
    expect(screen.queryByText('שרה לוי')).toBeNull()
    expect(container.querySelectorAll('input')).toHaveLength(2)
    expect(container.querySelectorAll('select')).toHaveLength(1)
  })

  it('changes the visible report locally without writing or showing fake save feedback', async () => {
    mockedUseStore.mockReturnValue(
      queryResult({
        store: {
          orders: [
            { date: '2099-08-12', name: 'אוגוסט', total: 1 },
            { date: '2099-09-12', name: 'ספטמבר', total: 2 },
          ],
        },
      }),
    )
    const user = userEvent.setup()
    const { container } = renderFinance()
    const select = screen.getByLabelText('חודש')

    expect((select as HTMLSelectElement).value).toBe('2099-08')
    await user.selectOptions(select, '2099-09')

    expect(screen.getByRole('heading', { name: /כספים — ספטמבר 2099/ })).toBeTruthy()
    const topCustomers = screen.getByRole('region', { name: 'הלקוחות הגדולים' })
    expect(within(topCustomers).getByText('ספטמבר')).toBeTruthy()
    expect(within(topCustomers).queryByText('אוגוסט')).toBeNull()
    expect(screen.getAllByText('$2.00').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText('שומר...')).toBeNull()
    expect(screen.queryByText('נשמר אוטומטית')).toBeNull()
    expect(container.querySelectorAll('input')).toHaveLength(2)
    expect((screen.getByLabelText('תאריך ההוצאה') as HTMLInputElement).value).toBe('2099-09-01')
  })

  it('shows negative profit exactly instead of clamping or hiding it', () => {
    mockedUseStore.mockReturnValue(
      queryResult({
        store: {
          orders: [{ date: '2099-08-12', name: 'לקוחה', total: '0.10' }],
          expenses: { '2099-08-12': '0.25' },
        },
      }),
    )
    renderFinance()

    expect(screen.getAllByText('-$0.15').length).toBeGreaterThanOrEqual(2)
  })

  it('fails malformed finance values closed and surfaces warnings without displaying coerced amounts', () => {
    mockedUseStore.mockReturnValue(
      queryResult({
        store: {
          orders: [
            {
              id: 'bad',
              date: '2099-08-12',
              name: 'סכום לבדיקה',
              total: '1,2,3',
              deposit: '0.10',
              meals: '1.5',
            },
          ],
          expenses: { '2099-08-12': '2.999' },
        },
      }),
    )
    renderFinance()

    const alert = screen.getByRole('alert')
    expect(within(alert).getAllByText(/סכום כספי אינו בפורמט תקין/)).toHaveLength(2)
    expect(within(alert).getByText(/כמות הזוגיות אינה תקינה/)).toBeTruthy()
    expect(screen.getAllByText('דורש בדיקה').length).toBeGreaterThanOrEqual(4)
    expect(screen.queryByText('$123.00')).toBeNull()
    expect(screen.queryByText('$3.00')).toBeNull()
    expect(screen.getByText('אין עדיין מחזור לקוחות תקין להצגה בחודש הזה.')).toBeTruthy()
  })

  it('shows an expense-only day and zero revenue rather than hiding real stored costs', () => {
    mockedUseStore.mockReturnValue(
      queryResult({ store: { orders: [], expenses: { '2099-08-12': 10 } } }),
    )
    renderFinance()

    expect(screen.getByText('0 הזמנות · 0 זוגיות')).toBeTruthy()
    expect(screen.getAllByText('$0.00').length).toBeGreaterThanOrEqual(4)
    expect(screen.getAllByText('$10.00').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('-$10.00').length).toBeGreaterThanOrEqual(2)
  })

  it('persists one exact daily expense only after explicit save and preserves unknown state', async () => {
    const store = {
      orders: [{ id: 'real', date: '2099-08-12', name: 'לקוחה', total: '20.00' }],
      expenses: { '2099-08-11': '1.00', metadata: { keep: true } },
      unknownRoot: { exact: true },
    } as LegacyStore
    mockedUseStore.mockReturnValue(queryResult({ store, revision: 9 }))
    const onSave = vi.fn<CustomerFinanceSaveHandler>().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderFinance(onSave)

    const date = screen.getByLabelText('תאריך ההוצאה')
    const amount = screen.getByLabelText('סכום ההוצאה בדולרים')
    fireEvent.change(date, { target: { value: '2099-08-12' } })
    await user.type(amount, '12.34')
    expect(onSave).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'שמירת הוצאה' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    const request = onSave.mock.calls[0]![0]
    expect(request.reason).toBe('finance')
    expect(request.baseEnvelope).toMatchObject({ revision: 9, hash: HASH, data: store })
    expect(request.baseStore).toBe(store)
    expect(request.nextStore.expenses).toEqual({
      '2099-08-11': '1.00',
      '2099-08-12': '12.34',
      metadata: { keep: true },
    })
    expect(request.nextStore.orders).toEqual(store.orders)
    expect((request.nextStore as Record<string, unknown>).unknownRoot).toEqual({ exact: true })
    expect(await screen.findByText('ההוצאה נשמרה.')).toBeTruthy()
    expect(screen.getByText('$12.34')).toBeTruthy()
    expect(screen.getAllByText('$13.34').length).toBeGreaterThanOrEqual(1)
  })

  it('clears only the selected existing expense key', async () => {
    const store = {
      orders: [{ date: '2099-08-12', name: 'לקוחה', total: 1 }],
      expenses: {
        '2099-08-12': '10.00',
        '2099-08-13': '20.00',
        unknownExpenseField: 'keep',
      },
    } as LegacyStore
    mockedUseStore.mockReturnValue(queryResult({ store }))
    const onSave = vi.fn<CustomerFinanceSaveHandler>().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderFinance(onSave)

    await user.click(screen.getAllByRole('button', { name: /עריכת הוצאה עבור/ })[0]!)
    expect((screen.getByLabelText('סכום ההוצאה בדולרים') as HTMLInputElement).value).toBe('10.00')
    await user.click(screen.getByRole('button', { name: 'ניקוי הוצאה' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0]![0].nextStore.expenses).toEqual({
      '2099-08-13': '20.00',
      unknownExpenseField: 'keep',
    })
  })

  it('drops the confirmed expense overlay after cache acknowledgement so a later remote amount is visible', async () => {
    const store = {
      orders: [{ date: '2099-08-12', name: 'לקוחה', total: '20.00' }],
      expenses: {},
    } as LegacyStore
    mockedUseStore.mockReturnValue(queryResult({ store, revision: 1 }))
    const onSave = vi.fn<CustomerFinanceSaveHandler>().mockResolvedValue(undefined)
    const user = userEvent.setup()
    const view = renderFinance(onSave)

    fireEvent.change(screen.getByLabelText('תאריך ההוצאה'), { target: { value: '2099-08-12' } })
    await user.type(screen.getByLabelText('סכום ההוצאה בדולרים'), '12.34')
    await user.click(screen.getByRole('button', { name: 'שמירת הוצאה' }))
    const acknowledgedStore = onSave.mock.calls[0]![0].nextStore

    mockedUseStore.mockReturnValue(queryResult({ store: acknowledgedStore, revision: 2 }))
    view.rerender(
      <MemoryRouter initialEntries={[APP_ROUTES.finance]}>
        <FinanceScreen onSave={onSave} />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getAllByText('$12.34').length).toBeGreaterThanOrEqual(2))

    const remoteStore = structuredClone(acknowledgedStore)
    remoteStore.expenses = { ...remoteStore.expenses, '2099-08-12': '99.00' }
    mockedUseStore.mockReturnValue(queryResult({ store: remoteStore, revision: 3 }))
    view.rerender(
      <MemoryRouter initialEntries={[APP_ROUTES.finance]}>
        <FinanceScreen onSave={onSave} />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getAllByText('$99.00').length).toBeGreaterThanOrEqual(2))
    expect(screen.queryByText('$12.34')).toBeNull()
  })

  it('rejects malformed expense input and retains a stale draft with zero writes', async () => {
    const store = {
      orders: [{ date: '2099-08-12', name: 'לקוחה', total: 1 }],
    } as LegacyStore
    const onSave = vi.fn<CustomerFinanceSaveHandler>().mockResolvedValue(undefined)
    mockedUseStore.mockReturnValue(queryResult({ store, revision: 1 }))
    const user = userEvent.setup()
    const view = renderFinance(onSave)
    const amount = screen.getByLabelText('סכום ההוצאה בדולרים')
    await user.type(amount, '1.001')
    await user.click(screen.getByRole('button', { name: 'שמירת הוצאה' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('עד שתי ספרות')

    await user.clear(amount)
    await user.type(amount, '5.25')
    mockedUseStore.mockReturnValue(queryResult({ store, revision: 2 }))
    view.rerender(
      <MemoryRouter initialEntries={[APP_ROUTES.finance]}>
        <FinanceScreen onSave={onSave} />
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: 'שמירת הוצאה' }))

    expect(onSave).not.toHaveBeenCalled()
    expect((screen.getByLabelText('סכום ההוצאה בדולרים') as HTMLInputElement).value).toBe('5.25')
    expect(screen.getByRole('alert').textContent).toContain('הנתונים התעדכנו')
  })

  it('does not claim persistence when the injected save boundary is absent', async () => {
    mockedUseStore.mockReturnValue(
      queryResult({ store: { orders: [{ date: '2099-08-12', name: 'לקוחה', total: 1 }] } }),
    )
    const user = userEvent.setup()
    renderFinance()
    await user.type(screen.getByLabelText('סכום ההוצאה בדולרים'), '5.00')
    await user.click(screen.getByRole('button', { name: 'שמירת הוצאה' }))

    expect(screen.getByRole('alert').textContent).toContain('לא בוצע שינוי בשרת')
    expect(screen.queryByText('ההוצאה נשמרה.')).toBeNull()
  })

  it('shows overview KPI cards for this month, last month, outstanding total, and unpaid count', () => {
    const currentMonth = businessMonthKey(0)
    const previousMonth = businessMonthKey(-1)
    mockedUseStore.mockReturnValue(
      queryResult({
        store: {
          orders: [
            { id: 'paid-now', date: `${currentMonth}-15`, name: 'שולמה', total: '10.00', paid: 'כן' },
            {
              id: 'prev',
              date: `${previousMonth}-10`,
              name: 'קודמת',
              total: '5.00',
              deposit: '2.00',
              paid: 'לא',
            },
            { id: 'no-date', date: 'בלי תאריך', name: 'ללא תאריך', total: '7.25' },
            { id: 'gone', date: `${currentMonth}-16`, name: 'בוטלה', total: '99.00', status: 'בוטלה' },
          ],
        },
      }),
    )
    renderFinance()

    const overview = screen.getByRole('region', { name: 'תמונת מצב כללית' })
    expect(within(overview).getByText('$10.00')).toBeTruthy()
    expect(within(overview).getByText('$5.00')).toBeTruthy()
    expect(within(overview).getByText('$10.25')).toBeTruthy()
    expect(within(overview).getByText('2')).toBeTruthy()
    expect(within(overview).queryByText('$99.00')).toBeNull()
    expect(screen.getByRole('note').textContent).toContain('1 עם תאריך לא תקין')

    const outstanding = screen.getByRole('region', { name: 'יתרות פתוחות לגבייה' })
    const link = within(outstanding).getByRole('link', { name: 'פתיחת ההזמנה של קודמת' })
    expect(link.getAttribute('href')).toBe('/orders/prev/edit')
    expect(within(outstanding).getByText('$3.00')).toBeTruthy()
    expect(within(outstanding).queryByText('שולמה')).toBeNull()
    expect(within(outstanding).queryByText('בוטלה')).toBeNull()
  })

  it('lists every unpaid non-cancelled order sorted by date descending with exact remaining amounts', () => {
    mockedUseStore.mockReturnValue(
      queryResult({
        store: {
          orders: [
            { id: 'x1', date: '2099-08-12', name: 'רות', total: '30.00', deposit: '10.00', paid: 'לא' },
            { id: 'x2', date: '2099-09-01', name: 'חנה', total: '50.00', paid: 'מקדמה' },
            { id: 'x3', date: '2099-08-20', name: 'שולמית', total: '20.00', paid: 'כן' },
            { id: 'x4', date: '2099-08-21', name: 'שרה', total: '15.00', paid: 'שת"פ' },
            { date: '2099-08-01', name: 'בלי מזהה', total: '5.00' },
            { id: 'bad', date: '2099-08-05', name: 'סכום שבור', total: '1,2,3', paid: 'לא' },
          ],
        },
      }),
    )
    renderFinance()

    const outstanding = screen.getByRole('region', { name: 'יתרות פתוחות לגבייה' })
    const names = within(outstanding)
      .getAllByRole('rowheader')
      .map((cell) => cell.textContent)
    expect(names).toEqual(['חנה', 'רות', 'סכום שבור', 'בלי מזהה'])
    expect(within(outstanding).queryByText('שולמית')).toBeNull()
    expect(within(outstanding).queryByText('שרה')).toBeNull()
    expect(within(outstanding).getByText('$20.00')).toBeTruthy()
    expect(within(outstanding).getAllByText('$50.00')).toHaveLength(2)
    expect(within(outstanding).getAllByText('סכום לא תקין')).toHaveLength(2)
    expect(within(outstanding).getByText('אין מזהה לפתיחה')).toBeTruthy()
    expect(
      within(outstanding)
        .getByRole('link', { name: 'פתיחת ההזמנה של רות' })
        .getAttribute('href'),
    ).toBe('/orders/x1/edit')

    const overview = screen.getByRole('region', { name: 'תמונת מצב כללית' })
    expect(within(overview).getByText('$75.00')).toBeTruthy()
    expect(within(overview).getByText('4')).toBeTruthy()
    expect(screen.getByRole('note').textContent).toContain('1 עם סכום לא תקין')
  })
})
