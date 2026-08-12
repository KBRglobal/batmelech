// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_ROUTES } from '../app/routes.ts'
import { useStore } from '../data/use-store.ts'
import type { LegacyStore } from '../domain/store.ts'
import { OrdersScreen } from './orders-screen.tsx'

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

function renderOrders() {
  return render(
    <MemoryRouter initialEntries={[APP_ROUTES.orders]}>
      <OrdersScreen />
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

beforeEach(() => {
  mockedUseStore.mockReset()
})

describe('OrdersScreen', () => {
  it('renders the shared loading state while the read-only store query is pending', () => {
    mockedUseStore.mockReturnValue(queryResult({ pending: true }))

    const { container } = renderOrders()

    expect(container.querySelector('[data-state="loading"]')).toBeTruthy()
    expect(screen.getByText('טוענת את ההזמנות')).toBeTruthy()
  })

  it('renders a retryable error without calling refetch before the operator clicks', async () => {
    const refetch = vi.fn()
    mockedUseStore.mockReturnValue(queryResult({ error: true, refetch }))
    const user = userEvent.setup()

    renderOrders()

    expect(refetch).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'ניסיון נוסף' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('shows the instructional empty state without exposing a meaningless search control', () => {
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [] } }))

    renderOrders()

    expect(screen.getByText('עדיין אין הזמנות')).toBeTruthy()
    expect(screen.queryByLabelText('חיפוש הזמנות')).toBeNull()
    expect(screen.getByRole('link', { name: 'הזמנה חדשה' }).getAttribute('href')).toBe(
      APP_ROUTES.newOrder,
    )
  })

  it('renders only injected store data with linked families, statuses, exact money, and real routes', () => {
    mockedUseStore.mockReturnValue(
      queryResult({
        store: {
          orders: [
            {
              id: 'actual-1',
              date: '2099-08-14',
              name: 'לקוחה מהשרת',
              phone: '050-123-4567',
              place: 'מלון אמיתי',
              time: '12:30',
              group: 'קבוצת אמת',
              status: 'מוכנה',
              paid: 'מקדמה',
              meals: 2,
              salads: { מטבוחה: { o: 2, p: 1 } },
              extras: { משלוח: { q: 1 } },
              total: '100.10',
            },
            {
              id: 'actual-2',
              date: '2099-08-14',
              name: 'משפחה מבוטלת',
              place: 'יעד שלא נספר',
              group: 'קבוצת אמת',
              status: 'בוטלה',
              paid: 'לא',
              meals: 99,
              total: '999.99',
            },
            {
              id: 'past-1',
              date: '2000-08-10',
              name: 'הזמנה ישנה',
              status: 'נמסרה',
              paid: 'כן',
              total: '20.00',
            },
          ],
          settings: { maxMeals: 2 },
        },
      }),
    )

    const { container } = renderOrders()

    expect(screen.getByText('הזמנה קבוצתית: קבוצת אמת')).toBeTruthy()
    expect(screen.getByText('2 משפחות')).toBeTruthy()
    expect(screen.getAllByText('מלון אמיתי')).toHaveLength(2)
    expect(screen.queryByText('יעד שלא נספר · מלון אמיתי')).toBeNull()
    expect(screen.getAllByText('$100.10').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('מוכנה')).toBeTruthy()
    expect(screen.getByText('מקדמה')).toBeTruthy()
    expect(screen.getByText('בוטלה')).toBeTruthy()
    expect(screen.getByText('זוגית ×2')).toBeTruthy()
    expect(screen.getByText('2 סלטים')).toBeTruthy()
    expect(screen.getByText('1 פינוק')).toBeTruthy()
    expect(screen.getByText('1 אקסטרות')).toBeTruthy()
    expect(
      screen
        .getByRole('link', { name: 'פתיחת ההזמנה של לקוחה מהשרת' })
        .getAttribute('href'),
    ).toBe('/orders/actual-1/edit')
    expect(
      screen
        .getAllByRole('link', { name: 'עריכה' })
        .some((link) => link.getAttribute('href') === '/orders/actual-1/edit'),
    ).toBe(true)
    expect(
      screen
        .getAllByRole('link', { name: 'בון' })
        .some((link) => link.getAttribute('href') === '/orders/actual-1/bon'),
    ).toBe(true)
    expect(
      screen
        .getAllByRole('link', { name: 'לסיכום ההכנות' })
        .some((link) => link.getAttribute('href') === '/preparation?date=2099-08-14'),
    ).toBe(true)
    expect(screen.getByRole('link', { name: 'וואטסאפ' }).getAttribute('href')).toMatch(
      /^https:\/\/wa\.me\/972501234567\?text=/,
    )
    expect(
      screen.getAllByRole('button', { name: 'שכפול לא זמין' }).every((button) =>
        button.hasAttribute('disabled'),
      ),
    ).toBe(true)
    const pastDisclosure = screen.getByText('הזמנות שעברו (1)').closest('details')
    expect(pastDisclosure?.hasAttribute('open')).toBe(false)
    expect(screen.queryByText('משפחת אברהמי')).toBeNull()
    expect(screen.queryByText('קבוצת ים')).toBeNull()
    expect(screen.queryByText('כהן יוסף')).toBeNull()
    expect(container.querySelector('button:not([type="button"])')).toBeNull()
  })

  it('searches past and cancelled orders live, reports matches, and clear restores and refocuses', async () => {
    mockedUseStore.mockReturnValue(
      queryResult({
        store: {
          orders: [
            {
              id: 'past-match',
              date: '2000-08-10',
              name: 'לקוח עבר',
              salads: { מטבוחה: { o: 1, p: 0 } },
              status: 'בוטלה',
            },
            { id: 'future-other', date: '2099-08-14', name: 'לקוחה עתידית' },
          ],
        },
      }),
    )
    const user = userEvent.setup()
    renderOrders()
    const input = screen.getByLabelText('חיפוש הזמנות')

    await user.type(input, 'עבר מטבוחה')

    expect(screen.getByText('נמצאו 1 הזמנות, כולל הזמנות שעברו')).toBeTruthy()
    expect(screen.getByText('לקוח עבר')).toBeTruthy()
    expect(screen.queryByText('לקוחה עתידית')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'ניקוי' }))

    expect((input as HTMLInputElement).value).toBe('')
    expect(document.activeElement).toBe(input)
    expect(screen.queryByText('נמצאו 1 הזמנות, כולל הזמנות שעברו')).toBeNull()
    expect(screen.getByText('לקוחה עתידית')).toBeTruthy()
    expect(screen.getByText('הזמנות שעברו (1)')).toBeTruthy()
  })

  it('renders a query-specific no-result state as text rather than markup', async () => {
    mockedUseStore.mockReturnValue(
      queryResult({ store: { orders: [{ id: 'one', date: '2099-01-01', name: 'Existing' }] } }),
    )
    const user = userEvent.setup()
    const { container } = renderOrders()

    await user.type(screen.getByLabelText('חיפוש הזמנות'), '<script>')

    expect(screen.getByText('לא נמצאו הזמנות')).toBeTruthy()
    expect(screen.getByText('אין הזמנות שמתאימות לחיפוש „<script>”.')).toBeTruthy()
    expect(container.querySelector('script')).toBeNull()
  })

  it('surfaces malformed legacy money and never displays a coerced customer amount', () => {
    mockedUseStore.mockReturnValue(
      queryResult({
        store: {
          orders: [
            { id: 'bad-money', date: '2099-01-01', name: 'סכום לבדיקה', phone: '0501234567', total: '1,2,3' },
          ],
        },
      }),
    )

    renderOrders()

    const alert = screen.getByRole('alert')
    expect(within(alert).getByText(/הסכום או המקדמה אינם תקינים/)).toBeTruthy()
    expect(screen.getByText('סכום לא תקין')).toBeTruthy()
    expect(screen.getByText('לא ניתן לחשב הכנסה')).toBeTruthy()
    expect(screen.queryByText('$123.00')).toBeNull()
    expect(screen.queryByRole('link', { name: 'וואטסאפ' })).toBeNull()
    expect(screen.getByRole('button', { name: 'וואטסאפ לא זמין' })).toBeTruthy()
  })

  it('blocks every ambiguous edit and bon route when legacy IDs collide', () => {
    mockedUseStore.mockReturnValue(
      queryResult({
        store: {
          orders: [
            { id: 7, date: '2099-01-01', name: 'Numeric ID' },
            { id: '7', date: '2099-01-01', name: 'String ID' },
          ],
        },
      }),
    )

    renderOrders()

    expect(screen.getAllByText('אין מזהה לפתיחה')).toHaveLength(2)
    expect(screen.queryByRole('link', { name: 'עריכה' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'בון' })).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('המזהה כפול')
  })
})
