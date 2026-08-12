// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_ROUTES } from '../app/routes.ts'
import { useStore } from '../data/use-store.ts'
import type { LegacyStore } from '../domain/store.ts'
import { FinanceScreen } from './finance-screen.tsx'

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

function renderFinance() {
  return render(
    <MemoryRouter initialEntries={[APP_ROUTES.finance]}>
      <FinanceScreen />
    </MemoryRouter>,
  )
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

  it('renders a genuine empty state and no month selector', () => {
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [], expenses: {} } }))
    renderFinance()

    expect(screen.getByText('עדיין אין נתונים כספיים')).toBeTruthy()
    expect(screen.queryByLabelText('חודש')).toBeNull()
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
    expect(screen.getByText('לקוחה אמיתית')).toBeTruthy()
    expect(screen.getByText('2 הזמנות בחודש')).toBeTruthy()
    expect(screen.queryByText('שרה לוי')).toBeNull()
    expect(container.querySelector('input')).toBeNull()
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
    expect(screen.getByText('ספטמבר')).toBeTruthy()
    expect(screen.queryByText('אוגוסט')).toBeNull()
    expect(screen.getAllByText('$2.00').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText('שומר...')).toBeNull()
    expect(screen.queryByText('נשמר אוטומטית')).toBeNull()
    expect(container.querySelector('input')).toBeNull()
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
})
