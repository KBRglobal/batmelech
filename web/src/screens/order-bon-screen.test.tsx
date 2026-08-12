// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_ROUTES } from '../app/routes.ts'
import { useStore } from '../data/use-store.ts'
import type { LegacyStore } from '../domain/store.ts'
import { OrderBonScreen } from './order-bon-screen.tsx'

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

function renderBon(path = '/orders/live-1/bon') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={APP_ROUTES.orderBon} element={<OrderBonScreen />} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeEach(() => mockedUseStore.mockReset())

describe('OrderBonScreen', () => {
  it('renders loading and retryable error states', async () => {
    mockedUseStore.mockReturnValue(queryResult({ pending: true }))
    const pending = renderBon()
    expect(screen.getByText('טוענת את הבון')).toBeTruthy()
    pending.unmount()

    const refetch = vi.fn()
    mockedUseStore.mockReturnValue(queryResult({ error: true, refetch }))
    renderBon()
    await userEvent.setup().click(screen.getByRole('button', { name: 'ניסיון נוסף' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('renders every populated legacy order section and escapes customer content', () => {
    mockedUseStore.mockReturnValue(queryResult({
      store: {
        orders: [{
          id: 'live-1', date: '2099-08-14', name: '<script>לקוחה</script>', phone: '050-1234567',
          place: 'מלון אמיתי', address: 'קומה 7', time: '12:30', pickup: false,
          status: 'אושרה', group: 'משפחות לוי', meals: 2, aricha: 4, challot: 4,
          salads: { מטבוחה: { o: 2, p: 1 } }, firsts: { 'פילה מרוקאי': 2 }, heat: 'חריף',
          firstsNote: 'אחד בלי כוסברה', mains: { 'עוף ביתי': 1 }, mainsNote: 'לחתוך',
          sides: { 'קוסקוס עננים': 1 }, desserts: { סופלה: 2 },
          extras: { אורז: { q: 2, note: 'בקופסאות נפרדות' } },
          custom: [{ name: 'מנה מיוחדת', qty: 3, price: '12.50', note: 'ללא אגוזים' }],
          lunch: { 'schnitzel-plate': { q: 1, v: 'family', sides: { 'פסטה אדומה': 2 } } },
          notes: 'להתקשר בהגעה', total: '500.25', deposit: '100.25', payMethod: 'לינק', paid: 'מקדמה',
          hotelName: 'Stored Hotel', hotelAddress: 'Stored Address', navigationUrl: 'https://maps.example/saved',
        }],
      },
    }))
    const { container } = renderBon()

    const text = container.querySelector('.bm-order-bon')?.textContent ?? ''
    for (const value of [
      '<script>לקוחה</script>', '050-1234567', 'מלון אמיתי', 'קומה 7', '12:30', 'אושרה',
      'משפחות לוי', 'ארוחה זוגית ×2', 'מטבוחה ×2', 'מטבוחה — פינוק', 'פילה מרוקאי ×2',
      'חריף', 'אחד בלי כוסברה', 'עוף ביתי', 'לחתוך', 'קוסקוס עננים', 'סופלה ×2',
      'אורז ×2 (בקופסאות נפרדות)', 'מנה מיוחדת ×3 (12.50$) — ללא אגוזים',
      'שניצל בצלחת (משפחתית) ×1', 'פסטה אדומה ×2', 'עריכה: 4 איש', 'חלות: 4 יחידות',
      'להתקשר בהגעה', '500.25', '100.25', 'לינק', 'מקדמה', 'Stored Hotel',
      'Stored Address', 'https://maps.example/saved',
    ]) expect(text).toContain(value)
    expect(container.querySelector('script')).toBeNull()
  })

  it('fails closed for malformed, missing, and duplicate IDs', () => {
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [{ id: 7 }, { id: '7' }] } }))
    const duplicate = renderBon('/orders/7/bon')
    expect(screen.getByText('מזהה ההזמנה אינו ייחודי')).toBeTruthy()
    expect(duplicate.container.querySelector('.bm-order-bon')).toBeNull()
    duplicate.unmount()

    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [{ id: '..' }] } }))
    renderBon('/orders/%2E%2E/bon')
    expect(screen.getByText('מזהה ההזמנה אינו תקין')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'הדפסת הבון' })).toBeNull()
  })

  it('renders a bon for a canonical colon ID', () => {
    mockedUseStore.mockReturnValue(queryResult({
      store: { orders: [{ id: 'order:1', name: 'לקוח קנוני' }] },
    }))

    const { container } = renderBon('/orders/order%3A1/bon')

    expect(container.querySelector('.bm-order-bon')?.textContent).toContain('לקוח קנוני')
    expect(screen.getByRole('button', { name: 'הדפסת הבון' })).toBeTruthy()
  })

  it('prints only after the explicit action and performs no data write', async () => {
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [{ id: 'live-1', name: 'לקוחה' }] } }))
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    renderBon()
    expect(print).not.toHaveBeenCalled()
    await userEvent.setup().click(screen.getByRole('button', { name: 'הדפסת הבון' }))
    expect(print).toHaveBeenCalledTimes(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
