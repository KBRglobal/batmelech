// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../data/use-store.ts'
import type { LegacyStore } from '../domain/store.ts'
import { OrderBonsBatchScreen } from './order-bons-batch-screen.tsx'

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

function renderBatch(path = '/preparation/bons?date=2099-08-14') {
  return render(<MemoryRouter initialEntries={[path]}><OrderBonsBatchScreen /></MemoryRouter>)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete document.body.dataset.bmBonMedia
  document.getElementById('bm-bon-page-rule')?.remove()
})
beforeEach(() => mockedUseStore.mockReset())

describe('OrderBonsBatchScreen', () => {
  it('renders loading, retryable error, and empty states', async () => {
    mockedUseStore.mockReturnValue(queryResult({ pending: true }))
    const pending = renderBatch()
    expect(screen.getByText('טוענת את הבונים')).toBeTruthy()
    pending.unmount()

    const refetch = vi.fn()
    mockedUseStore.mockReturnValue(queryResult({ error: true, refetch }))
    const failed = renderBatch()
    await userEvent.setup().click(screen.getByRole('button', { name: 'ניסיון נוסף' }))
    expect(refetch).toHaveBeenCalledTimes(1)
    failed.unmount()

    mockedUseStore.mockReturnValue(queryResult())
    renderBatch()
    expect(screen.getByText('אין הזמנות לבונים')).toBeTruthy()
  })

  it('builds one bon per active order of the chosen date, in service order', () => {
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [
      { id: 'late', date: '2099-08-14', name: 'מאוחרת', time: '18:00', meals: 1 },
      { id: 'early', date: '2099-08-14', name: 'מוקדמת', time: '09:00', meals: 1 },
      { id: 'cancelled', date: '2099-08-14', name: 'בוטלה', status: 'בוטלה', meals: 1 },
      { id: 'other-day', date: '2099-08-21', name: 'שבוע הבא', meals: 1 },
    ] } }))
    const { container } = renderBatch()

    const bons = [...container.querySelectorAll('.bm-bon-sheet .bm-order-bon')]
    expect(bons.map((bon) => bon.getAttribute('data-order-id'))).toEqual(['early', 'late'])
    expect(screen.getByText('2 בונים להדפסה')).toBeTruthy()
    expect(container.textContent).not.toContain('שבוע הבא')
  })

  it('prints every bon at once and cleans the page rule up afterwards', async () => {
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [
      { id: 'a', date: '2099-08-14', name: 'ראשונה', meals: 1 },
      { id: 'b', date: '2099-08-14', name: 'שנייה', meals: 1 },
    ] } }))
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    renderBatch()

    await userEvent.setup().click(screen.getByRole('button', { name: 'הדפסת כל הבונים' }))

    expect(print).toHaveBeenCalledTimes(1)
    expect(document.body.dataset.bmBonMedia).toBe('roll')
    expect(document.getElementById('bm-bon-page-rule')?.textContent).toContain('size: 62mm')
    fireEvent(window, new Event('afterprint'))
    expect(document.getElementById('bm-bon-page-rule')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refuses a date with no active orders instead of printing an empty run', () => {
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [
      { id: 'other-day', date: '2099-08-21', name: 'שבוע הבא', meals: 1 },
    ] } }))
    const { container } = renderBatch()

    expect(screen.getByText('אין הזמנות פעילות בתאריך שנבחר.')).toBeTruthy()
    expect(container.querySelectorAll('.bm-order-bon')).toHaveLength(0)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'הדפסת כל הבונים' }).disabled).toBe(true)
  })

  it('rejects a malformed date in the address instead of guessing one', () => {
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [
      { id: 'a', date: '2099-08-14', name: 'ראשונה', meals: 1 },
    ] } }))
    renderBatch('/preparation/bons?date=2099-13-40')
    expect(screen.getByText('תאריך הבונים אינו תקין')).toBeTruthy()
  })
})
