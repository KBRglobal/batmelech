// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../data/use-store.ts'
import type { LegacyStore } from '../domain/store.ts'
import { DeliveriesScreen } from './deliveries-screen.tsx'

vi.mock('../data/use-store.ts', () => ({ useStore: vi.fn() }))
const mockedUseStore = vi.mocked(useStore)

function queryResult(options: {
  readonly pending?: boolean
  readonly error?: boolean
  readonly store?: LegacyStore | null
  readonly refetch?: ReturnType<typeof vi.fn>
} = {}): ReturnType<typeof useStore> {
  return {
    isPending: options.pending === true,
    isError: options.error === true,
    data: options.pending || options.error ? undefined : { ts: 1, data: options.store ?? { orders: [] } },
    refetch: options.refetch ?? vi.fn(),
  } as unknown as ReturnType<typeof useStore>
}

function renderDeliveries() {
  return render(<MemoryRouter initialEntries={['/deliveries']}><DeliveriesScreen /></MemoryRouter>)
}

afterEach(cleanup)
beforeEach(() => mockedUseStore.mockReset())

describe('DeliveriesScreen', () => {
  it('renders loading, retryable error, global empty, and no-active states', async () => {
    mockedUseStore.mockReturnValue(queryResult({ pending: true }))
    const pending = renderDeliveries()
    expect(screen.getByText('טוענת את האספקות')).toBeTruthy()
    pending.unmount()

    const refetch = vi.fn()
    mockedUseStore.mockReturnValue(queryResult({ error: true, refetch }))
    const failed = renderDeliveries()
    await userEvent.setup().click(screen.getByRole('button', { name: 'ניסיון נוסף' }))
    expect(refetch).toHaveBeenCalledTimes(1)
    failed.unmount()

    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [] } }))
    const empty = renderDeliveries()
    expect(screen.getByText('אין עדיין אספקות')).toBeTruthy()
    empty.unmount()

    mockedUseStore.mockReturnValue(queryResult({
      store: { orders: [{ id: 'done', date: '2099-08-14', status: 'נמסרה' }] },
    }))
    renderDeliveries()
    expect(screen.getByText('אין אספקות פעילות')).toBeTruthy()
    expect(screen.getByText(/1 הזמנות שבוטלו או נמסרו/)).toBeTruthy()
  })

  it('renders real grouped destinations, pickups, collection, and safe read-only actions', async () => {
    mockedUseStore.mockReturnValue(queryResult({
      store: {
        orders: [
          {
            id: 'delivery-2', date: '2099-08-14', name: 'לקוחה שנייה', place: 'מלון אמיתי',
            address: 'Tower 7, Marina Walk', time: '12:00', status: 'אושרה', phone: '+971501234567',
            total: '100.20', deposit: '.20', paid: 'מקדמה',
          },
          {
            id: 'delivery-1', date: '2099-08-14', name: 'לקוחה ראשונה', place: 'מלון אמיתי',
            address: 'Tower 7, Marina Walk', time: '11:00', status: 'מוכנה', total: '.10', paid: 'לא',
          },
          { id: 'pickup', date: '2099-08-14', name: 'איסוף אמיתי', pickup: true, paid: 'כן' },
          { id: 'other-date', date: '2099-08-15', name: 'מחר אמיתי', place: 'Abu Dhabi Hotel' },
          { id: 'cancelled', date: '2099-08-14', name: 'מבוטלת', status: 'בוטלה', place: 'Hidden' },
        ],
      },
    }))
    renderDeliveries()

    expect(screen.getByText('מלון אמיתי')).toBeTruthy()
    expect(screen.getByText('Tower 7, Marina Walk')).toBeTruthy()
    expect(screen.getByText('לקוחה ראשונה')).toBeTruthy()
    expect(screen.getByText('לקוחה שנייה')).toBeTruthy()
    expect(screen.getByText('איסוף עצמי (1)')).toBeTruthy()
    expect(screen.getByText('איסוף אמיתי')).toBeTruthy()
    expect(screen.getByText('גבייה ביעד:', { exact: false }).textContent).toBe('גבייה ביעד: $100.10')
    expect(screen.queryByText('מבוטלת')).toBeNull()
    expect(screen.queryByText('מחר אמיתי')).toBeNull()
    const navigation = screen.getByRole('link', { name: 'ניווט ליעד' })
    expect(navigation.getAttribute('href')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Tower%207%2C%20Marina%20Walk',
    )
    expect(navigation.getAttribute('target')).toBe('_blank')
    expect(navigation.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getByRole('link', { name: 'טלפון' }).getAttribute('href')).toBe('tel:+971501234567')
    expect(screen.getAllByRole('button', { name: 'עדכון סטטוס לא זמין' }).every((button) => button.hasAttribute('disabled'))).toBe(true)
    expect(
      screen.getAllByRole('link', { name: 'עריכה' }).some((link) =>
        /^\/orders\/delivery-/.test(link.getAttribute('href') ?? ''),
      ),
    ).toBe(true)

    await userEvent.setup().selectOptions(screen.getByLabelText('תאריך אספקה'), '0:2099-08-15')
    expect(screen.getByText('מחר אמיתי')).toBeTruthy()
    expect(screen.queryByText('לקוחה ראשונה')).toBeNull()
    expect(screen.getByRole('link', { name: 'ניווט ליעד' }).getAttribute('href')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Abu%20Dhabi%20Hotel',
    )
  })

  it('keeps unsafe deliveries visible but blocks navigation, phone, edit, and collection', () => {
    mockedUseStore.mockReturnValue(queryResult({
      store: {
        orders: [{
          date: '2099-02-30', name: 'לקוחה לבדיקה', phone: 'javascript:alert(1)', total: '1,2,3',
        }],
      },
    }))
    renderDeliveries()

    expect(screen.getByText('לקוחה לבדיקה')).toBeTruthy()
    expect(screen.getByText('ניווט לא זמין')).toBeTruthy()
    expect(screen.getByText('עריכה לא זמינה')).toBeTruthy()
    expect(screen.getByText('גבייה לא מחושבת')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'טלפון' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'ניווט ליעד' })).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('לא נשמר יעד או כתובת')
    expect(screen.queryByText('$123.00')).toBeNull()
  })
})
