// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_ROUTES } from '../app/routes.ts'
import { useStore } from '../data/use-store.ts'
import type { LegacyStore } from '../domain/store.ts'
import { CustomersScreen } from './customers-screen.tsx'

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

function renderCustomers() {
  return render(
    <MemoryRouter initialEntries={[APP_ROUTES.customers]}>
      <CustomersScreen />
    </MemoryRouter>,
  )
}

afterEach(cleanup)

beforeEach(() => {
  mockedUseStore.mockReset()
})

describe('CustomersScreen', () => {
  it('renders the shared loading state', () => {
    mockedUseStore.mockReturnValue(queryResult({ pending: true }))
    const { container } = renderCustomers()

    expect(container.querySelector('[data-state="loading"]')).toBeTruthy()
    expect(screen.getByText('טוענת את הלקוחות')).toBeTruthy()
  })

  it('renders a retryable error without retrying automatically', async () => {
    const refetch = vi.fn()
    mockedUseStore.mockReturnValue(queryResult({ error: true, refetch }))
    const user = userEvent.setup()
    renderCustomers()

    expect(refetch).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'ניסיון נוסף' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('shows a real empty state without a meaningless search control', () => {
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [] } }))
    renderCustomers()

    expect(screen.getByText('ספר הלקוחות עדיין ריק')).toBeTruthy()
    expect(screen.queryByLabelText('חיפוש לקוחות')).toBeNull()
    expect(screen.getByRole('link', { name: 'הזמנה חדשה' }).getAttribute('href')).toBe(
      APP_ROUTES.newOrder,
    )
  })

  it('renders only injected customer history, metadata, exact spend, and navigation', () => {
    mockedUseStore.mockReturnValue(
      queryResult({
        store: {
          orders: [
            {
              id: 'actual-old',
              date: '2099-08-12',
              name: 'לקוחה אמיתית',
              phone: '050-123-4567',
              total: '0.10',
              meals: 1,
              status: 'נמסרה',
            },
            {
              id: 'actual-latest',
              date: '2099-08-13',
              name: 'לקוחה אמיתית',
              phone: '+972 50 123 4567',
              total: '0.20',
              meals: 2,
              status: 'מוכנה',
            },
          ],
          customerMeta: {
            '0501234567': { vip: true, notes: 'העדפה אמיתית מהשרת' },
          },
        },
      }),
    )

    const { container } = renderCustomers()

    expect(screen.getByRole('heading', { name: 'לקוחה אמיתית' })).toBeTruthy()
    expect(screen.getByText('VIP')).toBeTruthy()
    expect(screen.getByText('הזמנה קרובה')).toBeTruthy()
    expect(screen.getByText('העדפה אמיתית מהשרת')).toBeTruthy()
    expect(screen.getByText('$0.30')).toBeTruthy()
    expect(screen.getByRole('link', { name: '+972 50 123 4567' }).getAttribute('href')).toBe(
      'tel:+972501234567',
    )
    expect(screen.getByRole('link', { name: 'וואטסאפ' }).getAttribute('href')).toBe(
      'https://wa.me/972501234567',
    )
    expect(
      screen.getByRole('link', { name: 'הזמנה חדשה כמו הקודמת' }).getAttribute('href'),
    ).toBe('/orders/new?duplicate=actual-latest')
    expect(
      screen
        .getAllByRole('link', { name: /פתיחת ההזמנה של לקוחה אמיתית/ })
        .every((link) => /^\/orders\/actual-/.test(link.getAttribute('href') ?? '')),
    ).toBe(true)
    expect(screen.queryByText('שרה לוי')).toBeNull()
    expect(screen.queryByText('אברהם שלום')).toBeNull()
    expect(container.querySelector('textarea')).toBeNull()
    expect(screen.queryByRole('button', { name: /VIP/ })).toBeNull()
  })

  it('searches real names, phones, and customer notes and restores focus on clear', async () => {
    mockedUseStore.mockReturnValue(
      queryResult({
        store: {
          orders: [
            { id: 'a', name: 'שרה מהשרת', phone: '0501111111' },
            { id: 'b', name: 'דינה מהשרת', phone: '0502222222' },
          ],
          customerMeta: { '0501111111': { notes: 'ללא גלוטן' } },
        },
      }),
    )
    const user = userEvent.setup()
    renderCustomers()
    const search = screen.getByLabelText('חיפוש לקוחות')

    await user.type(search, 'גלוטן')
    expect(screen.getByText('נמצאו 1 לקוחות')).toBeTruthy()
    expect(screen.getByText('שרה מהשרת')).toBeTruthy()
    expect(screen.queryByText('דינה מהשרת')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'ניקוי' }))
    expect((search as HTMLInputElement).value).toBe('')
    expect(document.activeElement).toBe(search)
    expect(screen.getByText('דינה מהשרת')).toBeTruthy()
  })

  it('renders a query-specific empty state as text rather than markup', async () => {
    mockedUseStore.mockReturnValue(
      queryResult({ store: { orders: [{ id: 'a', name: 'לקוחה קיימת' }] } }),
    )
    const user = userEvent.setup()
    const { container } = renderCustomers()

    await user.type(screen.getByLabelText('חיפוש לקוחות'), '<script>')

    expect(screen.getByText('לא נמצא לקוח')).toBeTruthy()
    expect(screen.getByText('אין לקוח שמתאים לחיפוש „<script>”.')).toBeTruthy()
    expect(container.querySelector('script')).toBeNull()
  })

  it('surfaces malformed money, phone, and duplicate IDs while blocking unsafe routes', () => {
    mockedUseStore.mockReturnValue(
      queryResult({
        store: {
          orders: [
            { id: 7, date: '2099-01-01', name: 'לקוחה לבדיקה', phone: '12', total: '1,2,3' },
            { id: '7', date: '2099-01-02', name: 'לקוחה לבדיקה', phone: '12', total: 1 },
          ],
        },
      }),
    )

    renderCustomers()

    const alert = screen.getByRole('alert')
    expect(within(alert).getAllByText(/מזהה ההזמנה כפול/)).toHaveLength(2)
    expect(within(alert).getByText(/סכום הזמנה אינו תקין/)).toBeTruthy()
    expect(within(alert).getAllByText(/מספר הטלפון אינו מתאים/)).toHaveLength(2)
    expect(screen.getByText('לא ניתן לחשב')).toBeTruthy()
    expect(screen.queryByText('$123.00')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'הזמנה חוזרת לא זמינה' }).hasAttribute('disabled'),
    ).toBe(true)
    expect(screen.queryByRole('link', { name: 'וואטסאפ' })).toBeNull()
    expect(screen.queryByRole('link', { name: /פתיחת ההזמנה/ })).toBeNull()
  })
})
