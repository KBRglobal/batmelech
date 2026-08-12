// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_ROUTES } from '../app/routes.ts'
import { useStore } from '../data/use-store.ts'
import type { LegacyStore } from '../domain/store.ts'
import { TodayScreen } from './today-screen.tsx'

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

function renderToday() {
  return render(
    <MemoryRouter initialEntries={[APP_ROUTES.today]}>
      <TodayScreen />
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

describe('TodayScreen', () => {
  it('renders the shared loading state while the real store query is pending', () => {
    mockedUseStore.mockReturnValue(queryResult({ pending: true }))

    const { container } = renderToday()

    expect(container.querySelector('[data-state="loading"]')).toBeTruthy()
    expect(screen.getByText('טוענת את מסך היום')).toBeTruthy()
  })

  it('renders a retryable error state and retries only after an operator click', async () => {
    const refetch = vi.fn()
    mockedUseStore.mockReturnValue(queryResult({ error: true, refetch }))
    const user = userEvent.setup()

    renderToday()

    expect(refetch).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'ניסיון נוסף' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('renders the global empty state with a real new-order route', () => {
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [] } }))

    renderToday()

    expect(screen.getByText('עדיין אין הזמנות')).toBeTruthy()
    expect(
      screen
        .getAllByRole('link', { name: 'הזמנה חדשה' })
        .every((link) => link.getAttribute('href') === APP_ROUTES.newOrder),
    ).toBe(true)
    expect(screen.queryByText('אין הזמנות קרובות כרגע')).toBeNull()
  })

  it('builds an edit link for a canonical colon ID with one encoding pass', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-12T08:00:00.000Z'))
    mockedUseStore.mockReturnValue(queryResult({
      store: { orders: [{ id: 'order:1', date: '2026-08-12', name: 'לקוח קנוני' }] },
    }))

    renderToday()

    expect(
      screen.getAllByRole('link', { name: 'עריכה' })
        .every((link) => link.getAttribute('href') === '/orders/order%3A1/edit'),
    ).toBe(true)
  })

  it('renders actual store customers, operational summaries, and router-only actions', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-12T08:00:00.000Z'))
    mockedUseStore.mockReturnValue(
      queryResult({
        store: {
          orders: [
            {
              id: 'actual-1',
              date: '2026-08-12',
              name: 'לקוחה אמיתית',
              place: 'מלון אמיתי',
              time: '12:30',
              status: 'מוכנה',
              meals: 2,
              total: '100.10',
              deposit: '.10',
              paid: 'מקדמה',
            },
            {
              id: 'actual-2',
              date: '2026-08-13',
              name: 'משפחה מהשרת',
              pickup: true,
              meals: 1,
              total: '50.00',
              deposit: 0,
              paid: 'לא',
            },
          ],
          settings: { maxMeals: 4 },
          lastBackup: new Date('2026-08-11T08:00:00.000Z').getTime(),
        },
      }),
    )

    const { container } = renderToday()

    expect(screen.getByText('לקוחה אמיתית')).toBeTruthy()
    expect(screen.getByText('מלון אמיתי')).toBeTruthy()
    expect(screen.getAllByText('משפחה מהשרת · יום חמישי, 13.08.2026')).toHaveLength(2)
    expect(screen.getByText('$150.00')).toBeTruthy()
    expect(screen.getByText('בלי מקדמה')).toBeTruthy()
    expect(screen.getByText('ממתינה לאישור')).toBeTruthy()
    expect(
      screen
        .getAllByRole('link', { name: 'עריכה' })
        .some((link) => link.getAttribute('href') === '/orders/actual-1/edit'),
    ).toBe(true)
    expect(
      screen
        .getByRole('link', { name: 'לסיכום ההכנות של היום' })
        .getAttribute('href'),
    ).toBe('/preparation?date=2026-08-12')
    expect(screen.queryByText('משפחת אברהמי')).toBeNull()
    expect(screen.queryByText('ישראל ישראלי')).toBeNull()
    expect(screen.queryByText('כהן שרה (19.08)')).toBeNull()
    expect(screen.queryByText('הודעת התפריט לשבת')).toBeNull()
    expect(container.querySelector('button:not([type="button"])')).toBeNull()
    expect(container.querySelector('a[href^="http"]')).toBeNull()
  })
})
