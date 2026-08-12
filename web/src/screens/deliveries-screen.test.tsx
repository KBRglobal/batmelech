// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../data/use-store.ts'
import type { ConfirmedStoreSaveHandler } from '../data/versioned-screen-save.tsx'
import type { LegacyStore } from '../domain/store.ts'
import type { VersionedStateEnvelope } from '../services/state-api.ts'
import { DeliveriesScreen } from './deliveries-screen.tsx'

vi.mock('../data/use-store.ts', () => ({ useStore: vi.fn() }))
const mockedUseStore = vi.mocked(useStore)
const HASH = 'a'.repeat(64)

function queryResult(options: {
  readonly pending?: boolean
  readonly error?: boolean
  readonly store?: LegacyStore | null
  readonly refetch?: ReturnType<typeof vi.fn>
  readonly revision?: number
} = {}): ReturnType<typeof useStore> {
  return {
    isPending: options.pending === true,
    isError: options.error === true,
    data: options.pending || options.error ? undefined : {
      revision: options.revision ?? 1,
      ts: options.revision ?? 1,
      hash: HASH,
      data: options.store ?? { orders: [] },
    },
    refetch: options.refetch ?? vi.fn(),
  } as unknown as ReturnType<typeof useStore>
}

function renderDeliveries(onSave?: ConfirmedStoreSaveHandler) {
  return render(<MemoryRouter initialEntries={['/deliveries']}><DeliveriesScreen onSave={onSave} /></MemoryRouter>)
}

function confirmedEnvelope(data: LegacyStore, revision = 2): VersionedStateEnvelope {
  return { revision, ts: revision, hash: HASH, data }
}

function successfulSave() {
  let revision = 1
  return vi.fn<ConfirmedStoreSaveHandler>().mockImplementation(async ({ nextStore }) => {
    revision += 1
    return confirmedEnvelope(nextStore, revision)
  })
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

  it('builds an edit link for a canonical colon ID with one encoding pass', () => {
    mockedUseStore.mockReturnValue(queryResult({
      store: {
        orders: [{ id: 'order:1', date: '2099-08-14', name: 'לקוח קנוני', place: 'יעד קנוני' }],
      },
    }))

    renderDeliveries()

    expect(screen.getByRole('link', { name: 'עריכה' }).getAttribute('href'))
      .toBe('/orders/order%3A1/edit')
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

  it('writes only the next status after an explicit click and preserves every other field', async () => {
    const store = {
      orders: [{
        id: 'real-delivery',
        date: '2099-08-14',
        name: 'לקוחה לשמירה',
        place: 'מלון',
        status: 'אושרה',
        unknownOrderField: { keep: ['exact'] },
      }],
      unknownStoreField: { keep: true },
    } satisfies LegacyStore
    const onSave = successfulSave()
    mockedUseStore.mockReturnValue(queryResult({ store }))
    const user = userEvent.setup()
    renderDeliveries(onSave)

    expect(onSave).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'עדכון לקוחה לשמירה לסטטוס מוכנה' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    const request = onSave.mock.calls[0]![0]
    expect(request.reason).toBe('deliveries')
    expect(request.baseStore).toBe(store)
    expect(request.baseEnvelope).toMatchObject({ revision: 1, ts: 1, hash: HASH, data: store })
    expect(request.nextStore).toEqual({
      ...store,
      orders: [{ ...store.orders[0], status: 'מוכנה' }],
    })
    expect(screen.getByText('הסטטוס עודכן למוכנה.')).toBeTruthy()
    expect(screen.getByText('מוכנה')).toBeTruthy()
  })

  it('fails closed for duplicate IDs and performs no write', () => {
    const onSave = successfulSave()
    mockedUseStore.mockReturnValue(queryResult({
      store: {
        orders: [
          { id: 'duplicate', date: '2099-08-14', name: 'אחת', place: 'מלון א' },
          { id: 'duplicate', date: '2099-08-14', name: 'שתיים', place: 'מלון ב' },
        ],
      },
    }))
    renderDeliveries(onSave)

    expect(screen.getAllByRole('button', { name: 'עדכון סטטוס לא זמין' })).toHaveLength(2)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('keeps a unique numeric legacy ID visible but exposes no edit or status write', () => {
    const onSave = successfulSave()
    mockedUseStore.mockReturnValue(queryResult({
      store: {
        orders: [{ id: 7, date: '2099-08-14', name: 'לקוחה ישנה', place: 'מלון' }],
      },
    }))
    renderDeliveries(onSave)

    expect(screen.getByText('לקוחה ישנה')).toBeTruthy()
    expect(screen.getByText('עריכה לא זמינה')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'עדכון סטטוס לא זמין' }).hasAttribute('disabled')).toBe(true)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('adopts the exact merged server envelope and allows a second guarded status write', async () => {
    const store = {
      orders: [{
        id: 'merge-delivery',
        date: '2099-08-14',
        name: 'לקוחה ממוזגת',
        place: 'מלון',
        status: 'אושרה',
      }],
    } satisfies LegacyStore
    let mergedStore: LegacyStore | null = null
    const onSave = vi.fn<ConfirmedStoreSaveHandler>()
      .mockImplementationOnce(async ({ nextStore }) => {
        mergedStore = {
          ...nextStore,
          remoteOnly: { keep: true },
          orders: [
            ...nextStore.orders,
            {
              id: 'remote-delivery',
              date: '2099-08-14',
              name: 'לקוחה מרחוק',
              place: 'מלון אחר',
              status: 'חדשה',
            },
          ],
        }
        return confirmedEnvelope(mergedStore, 2)
      })
      .mockImplementationOnce(async ({ nextStore }) => confirmedEnvelope(nextStore, 3))
    mockedUseStore.mockReturnValue(queryResult({ store, revision: 1 }))
    const view = renderDeliveries(onSave)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'עדכון לקוחה ממוזגת לסטטוס מוכנה' }))

    expect(screen.getByText('לקוחה מרחוק')).toBeTruthy()
    expect(mergedStore).not.toBeNull()

    mockedUseStore.mockReturnValue(queryResult({ store: mergedStore!, revision: 2 }))
    view.rerender(
      <MemoryRouter initialEntries={['/deliveries']}>
        <DeliveriesScreen onSave={onSave} />
      </MemoryRouter>,
    )

    const secondButton = screen.getByRole('button', { name: 'עדכון לקוחה ממוזגת לסטטוס במשלוח' })
    expect(secondButton.hasAttribute('disabled')).toBe(false)
    await user.click(secondButton)

    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onSave.mock.calls[1]![0].baseStore).toEqual(mergedStore)
    expect(onSave.mock.calls[1]![0].nextStore).toMatchObject({
      remoteOnly: { keep: true },
      orders: [
        { id: 'merge-delivery', status: 'במשלוח' },
        { id: 'remote-delivery', status: 'חדשה' },
      ],
    })
  })

  it('retains a conflict error and never shows an unconfirmed status', async () => {
    const onSave = vi.fn<ConfirmedStoreSaveHandler>().mockRejectedValue(new Error('conflict'))
    mockedUseStore.mockReturnValue(queryResult({
      store: {
        orders: [{ id: 'conflict', date: '2099-08-14', name: 'לקוח קונפליקט', place: 'מלון', status: 'מוכנה' }],
      },
    }))
    const user = userEvent.setup()
    renderDeliveries(onSave)

    await user.click(screen.getByRole('button', { name: 'עדכון לקוח קונפליקט לסטטוס במשלוח' }))

    expect(screen.getByRole('alert').textContent).toContain('השמירה נכשלה או התנגשה')
    expect(screen.getByText('מוכנה')).toBeTruthy()
    expect(screen.queryByText('במשלוח')).toBeNull()
  })

  it('rejects background envelope drift before calling the save callback', async () => {
    const store = {
      orders: [{ id: 'drift', date: '2099-08-14', name: 'לקוחה דריפט', place: 'מלון', status: 'אושרה' }],
    } satisfies LegacyStore
    const onSave = successfulSave()
    mockedUseStore.mockReturnValue(queryResult({ store, revision: 1 }))
    const view = renderDeliveries(onSave)
    mockedUseStore.mockReturnValue(queryResult({
      store: { ...store, remoteUnknown: true },
      revision: 2,
    }))
    view.rerender(<MemoryRouter initialEntries={['/deliveries']}><DeliveriesScreen onSave={onSave} /></MemoryRouter>)

    await userEvent.setup().click(screen.getByRole('button', { name: 'עדכון לקוחה דריפט לסטטוס מוכנה' }))

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('הנתונים השתנו')
  })
})
