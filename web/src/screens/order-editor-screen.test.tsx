// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_ROUTES } from '../app/routes.ts'
import { useStore } from '../data/use-store.ts'
import type { LegacyStore } from '../domain/store.ts'
import { OrderEditorScreen } from './order-editor-screen.tsx'

vi.mock('../data/use-store.ts', () => ({ useStore: vi.fn() }))

const mockedUseStore = vi.mocked(useStore)

function queryResult(options: {
  readonly pending?: boolean
  readonly error?: boolean
  readonly store?: LegacyStore
  readonly refetch?: ReturnType<typeof vi.fn>
} = {}): ReturnType<typeof useStore> {
  return {
    isPending: options.pending === true,
    isError: options.error === true,
    data: options.pending || options.error ? undefined : { ts: 1, data: options.store ?? { orders: [] } },
    refetch: options.refetch ?? vi.fn(),
  } as unknown as ReturnType<typeof useStore>
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}|${JSON.stringify(location.state)}`}</output>
}

function renderEditor(path: string = APP_ROUTES.newOrder, state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <Routes>
        <Route path={APP_ROUTES.newOrder} element={<><OrderEditorScreen /><LocationProbe /></>} />
        <Route path={APP_ROUTES.editOrder} element={<><OrderEditorScreen /><LocationProbe /></>} />
        <Route path={APP_ROUTES.orderImportReview} element={<LocationProbe />} />
        <Route path={APP_ROUTES.orders} element={<LocationProbe />} />
      </Routes>
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

describe('OrderEditorScreen', () => {
  it('renders shared loading and retryable error states', async () => {
    mockedUseStore.mockReturnValue(queryResult({ pending: true }))
    const first = renderEditor()
    expect(first.container.querySelector('[data-state="loading"]')).toBeTruthy()
    first.unmount()

    const refetch = vi.fn()
    mockedUseStore.mockReturnValue(queryResult({ error: true, refetch }))
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole('button', { name: 'ניסיון נוסף' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('opens a complete fresh draft on the nearest Friday with every operational section', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 7, 12, 15, 0))
    mockedUseStore.mockReturnValue(queryResult())
    renderEditor()

    await waitFor(() => expect(screen.getByRole('heading', { name: 'הזמנה חדשה' })).toBeTruthy())
    expect((screen.getByLabelText('תאריך ההזמנה') as HTMLInputElement).value).toBe('2026-08-14')
    expect(screen.getByLabelText('כמות ארוחות זוגיות').textContent).toBe('1')
    expect(screen.getAllByRole('button', { name: /^(?:פרטים|לקוח|סלטים|ראשונות|עיקריות|תוספות|קינוח|צהריים|אקסטרות|תשלום)$/ })).toHaveLength(10)
    expect(screen.getByText('קוסקוס עננים')).toBeTruthy()
    expect(screen.getByText('בגט טוניסאי אותנטי')).toBeTruthy()
    expect(screen.getByText(/2 סופלה או בקלאווה/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'שמירה תופעל לאחר חיבור מוגן' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByText('משפחת אברהמי')).toBeNull()
  })

  it('loads the requested real order without mutating the store and fails closed on ID collision', async () => {
    const order = { id: 'live-1', date: '2099-08-20', name: 'לקוחה אמיתית', phone: '050-1234567', address: 'כתובת שמורה', meals: 2 }
    const store = { orders: [order] }
    const original = structuredClone(store)
    mockedUseStore.mockReturnValue(queryResult({ store }))
    renderEditor('/orders/live-1/edit')

    await waitFor(() => expect(screen.getByRole('heading', { name: 'עריכת הזמנה live-1' })).toBeTruthy())
    expect((screen.getByLabelText('שם מלא') as HTMLInputElement).value).toBe('לקוחה אמיתית')
    expect(store).toEqual(original)
    cleanup()

    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [{ id: 7 }, { id: '7' }] } }))
    renderEditor('/orders/7/edit')
    expect(await screen.findByText('מזהה ההזמנה אינו ייחודי')).toBeTruthy()
    expect(screen.queryByLabelText('שם מלא')).toBeNull()
  })

  it('keeps typed delivery data while selecting a known Abu Dhabi hotel and while toggling pickup', async () => {
    mockedUseStore.mockReturnValue(queryResult())
    const user = userEvent.setup()
    renderEditor()
    const address = await screen.findByLabelText('כתובת מלאה')
    const navigation = screen.getByLabelText('קישור ניווט')

    await user.type(address, 'למסור בקבלה')
    await user.type(navigation, 'https://maps.example/typed')
    await user.type(screen.getByLabelText('שם מלון / יעד'), 'Rosewood Abu Dhabi')
    expect((address as HTMLInputElement).value).toBe('למסור בקבלה')
    expect((navigation as HTMLInputElement).value).toBe('https://maps.example/typed')

    await user.click(screen.getByRole('checkbox', { name: 'איסוף עצמי' }))
    expect(screen.queryByLabelText('כתובת מלאה')).toBeNull()
    await user.click(screen.getByRole('checkbox', { name: 'איסוף עצמי' }))
    expect((screen.getByLabelText('כתובת מלאה') as HTMLInputElement).value).toBe('למסור בקבלה')
  })

  it('shows authoritative fish, salad, dessert, and custom-item pricing without auto-writing Total', async () => {
    mockedUseStore.mockReturnValue(queryResult())
    const user = userEvent.setup()
    renderEditor()
    await screen.findByRole('heading', { name: 'הזמנה חדשה' })

    await user.click(screen.getByRole('button', { name: 'הוספה לפילה דג ברוטב מרוקאי' }))
    await user.click(screen.getByRole('button', { name: 'הוספה לפילה דג ברוטב מרוקאי' }))
    await user.click(screen.getByRole('button', { name: 'הוספה לפילה דג ברוטב מרוקאי' }))
    for (let index = 0; index < 5; index += 1) {
      await user.click(screen.getByRole('button', { name: 'הוספה לטחינה הוזמן' }))
    }
    await user.click(screen.getByRole('button', { name: 'הוספה לסופלה שוקולד' }))
    await user.click(screen.getByRole('button', { name: 'הוספה לסוכריות בקלאווה' }))

    expect(screen.getAllByText('$267.00').length).toBeGreaterThan(0)
    expect(screen.getByText('$30.00')).toBeTruthy()
    expect(screen.getByText('יש חריגה מזכאות הקינוח. לא הוספנו מחיר שלא אושר.')).toBeTruthy()
    expect((screen.getByLabelText('סך לתשלום') as HTMLInputElement).value).toBe('')

    await user.click(screen.getByRole('button', { name: 'להשתמש במחיר המוצע' }))
    expect((screen.getByLabelText('סך לתשלום') as HTMLInputElement).value).toBe('267.00')

    await user.click(screen.getByRole('button', { name: 'הוספת פריט חופשי' }))
    await user.type(screen.getByLabelText('שם פריט חופשי 1'), 'פריט אמיתי')
    await user.type(screen.getByLabelText('מחיר פריט חופשי 1'), '0.10')
    expect(screen.getAllByText('$267.10').length).toBeGreaterThan(0)
  })

  it('routes a nonempty WhatsApp message to mandatory review and performs no network or save call', async () => {
    mockedUseStore.mockReturnValue(queryResult())
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const user = userEvent.setup()
    renderEditor()
    await user.type(await screen.findByLabelText('הודעת הלקוח'), 'שתי זוגיות')
    await user.click(screen.getByRole('button', { name: 'פענוח ובדיקת ההזמנה' }))

    expect(screen.getByTestId('location').textContent).toContain(APP_ROUTES.orderImportReview)
    expect(screen.getByTestId('location').textContent).toContain('שתי זוגיות')
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('marks real configured out-of-stock items visually without disabling selection', async () => {
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [], settings: { out: ['טחינה'] } } }))
    const user = userEvent.setup()
    renderEditor()
    await screen.findByText('טחינה')
    expect(screen.getByText('אזל מהמלאי — הבחירה עדיין פתוחה')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'הוספה לטחינה הוזמן' }))
    expect(screen.getByLabelText('כמות טחינה הוזמן').textContent).toBe('1')
  })
})
