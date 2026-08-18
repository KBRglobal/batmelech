// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_ROUTES } from '../app/routes.ts'
import { useStore } from '../data/use-store.ts'
import type { StoreSaveHandler } from '../domain/settings-catalog.ts'
import type { LegacyStore } from '../domain/store.ts'
import { downloadTable } from '../services/table-export.ts'
import { OrdersScreen } from './orders-screen.tsx'

vi.mock('../data/use-store.ts', () => ({ useStore: vi.fn() }))
vi.mock('../services/table-export.ts', () => ({ downloadTable: vi.fn() }))

const mockedUseStore = vi.mocked(useStore)
const mockedDownloadTable = vi.mocked(downloadTable)
const HASH = 'c'.repeat(64)

function queryResult(
  options: {
    readonly pending?: boolean
    readonly error?: boolean
    readonly store?: LegacyStore | null
    readonly versioned?: boolean
    readonly refetch?: ReturnType<typeof vi.fn>
  } = {},
): ReturnType<typeof useStore> {
  return {
    isPending: options.pending === true,
    isError: options.error === true,
    data:
      options.pending === true || options.error === true
        ? undefined
        : options.versioned === true
          ? { revision: 1, ts: 1, hash: HASH, data: options.store ?? { orders: [] } }
          : { ts: 1, data: options.store ?? { orders: [] } },
    refetch: options.refetch ?? vi.fn(),
  } as unknown as ReturnType<typeof useStore>
}

function renderOrders(onSave?: StoreSaveHandler) {
  return render(
    <MemoryRouter initialEntries={[APP_ROUTES.orders]}>
      <OrdersScreen onSave={onSave} />
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

beforeEach(() => {
  mockedUseStore.mockReset()
  mockedDownloadTable.mockReset()
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

  it('builds canonical colon ID links with exactly one encoding pass', () => {
    mockedUseStore.mockReturnValue(queryResult({
      store: { orders: [{ id: 'order:1', date: '2099-08-14', name: 'לקוח קנוני' }] },
    }))

    renderOrders()

    expect(screen.getByRole('link', { name: 'פתיחת ההזמנה של לקוח קנוני' }).getAttribute('href'))
      .toBe('/orders/order%3A1/edit')
    expect(screen.getByRole('link', { name: 'עריכה' }).getAttribute('href'))
      .toBe('/orders/order%3A1/edit')
    expect(screen.getByRole('link', { name: 'בון' }).getAttribute('href'))
      .toBe('/orders/order%3A1/bon')
    expect(screen.getByRole('link', { name: 'שכפול' }).getAttribute('href'))
      .toBe('/orders/new?duplicate=order%3A1')
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
    expect(screen.getAllByText('מוכנה').length).toBeGreaterThanOrEqual(1)
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
      screen
        .getAllByRole('link', { name: 'שכפול' })
        .some((link) => link.getAttribute('href') === '/orders/new?duplicate=actual-1'),
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
    expect(screen.queryByRole('link', { name: 'שכפול' })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'שכפול לא זמין' })).toHaveLength(2)
    expect(screen.getByRole('alert').textContent).toContain('המזהה כפול')
  })

  function editableStore(): LegacyStore {
    return {
      orders: [
        {
          id: 'edit-1',
          date: '2099-08-14',
          name: 'לקוחה לעריכה',
          time: '12:00',
          total: '50.00',
          status: 'חדשה',
          paid: 'לא',
          source: 'whatsapp',
          meyToken: 'mey-token',
          courierNote: 'courier note',
          intakeConversation: 'thread',
        },
        {
          id: 'edit-2',
          date: '2099-08-15',
          name: 'הזמנה שנמסרה',
          status: 'נמסרה',
          paid: 'כן',
          total: '20.00',
        },
      ],
    }
  }

  it('turns a card value into an in-place input with confirm and cancel controls', async () => {
    mockedUseStore.mockReturnValue(queryResult({ store: editableStore(), versioned: true }))
    const user = userEvent.setup()
    renderOrders(vi.fn())

    expect(screen.queryByLabelText('שעה — לקוחה לעריכה')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'עריכת שעה — לקוחה לעריכה' }))

    const input = screen.getByLabelText('שעה — לקוחה לעריכה') as HTMLInputElement
    expect(input.value).toBe('12:00')
    expect(screen.getByRole('button', { name: 'אישור שעה — לקוחה לעריכה' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'ביטול שעה — לקוחה לעריכה' })).toBeTruthy()
  })

  it('commits a time edit through the versioned save and leaves protected fields untouched', async () => {
    const store = editableStore()
    mockedUseStore.mockReturnValue(queryResult({ store, versioned: true }))
    const saves: Parameters<StoreSaveHandler>[0][] = []
    const onSave: StoreSaveHandler = async (request) => {
      saves.push(request)
    }
    const user = userEvent.setup()
    renderOrders(onSave)

    await user.click(screen.getByRole('button', { name: 'עריכת שעה — לקוחה לעריכה' }))
    const input = screen.getByLabelText('שעה — לקוחה לעריכה')
    fireEvent.change(input, { target: { value: '13:45' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(saves).toHaveLength(1)
    expect(saves[0]!.reason).toBe('orders')
    expect(saves[0]!.baseStore).toEqual(store)
    expect(saves[0]!.nextStore.orders[0]).toEqual({ ...store.orders[0], time: '13:45' })
    expect(saves[0]!.nextStore.orders[0]).toMatchObject({
      meyToken: 'mey-token',
      courierNote: 'courier note',
      intakeConversation: 'thread',
    })
    expect(saves[0]!.nextStore.orders[1]).toEqual(store.orders[1])
    await screen.findByText('· 12:00') // editor closed; store mock unchanged so old value shows
    expect(screen.queryByLabelText('שעה — לקוחה לעריכה')).toBeNull()
  })

  it('cancels an edit on escape without saving', async () => {
    mockedUseStore.mockReturnValue(queryResult({ store: editableStore(), versioned: true }))
    const onSave = vi.fn()
    const user = userEvent.setup()
    renderOrders(onSave)

    await user.click(screen.getByRole('button', { name: 'עריכת שם — לקוחה לעריכה' }))
    const input = screen.getByLabelText('שם — לקוחה לעריכה')
    fireEvent.change(input, { target: { value: 'שם אחר לגמרי' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('שם — לקוחה לעריכה')).toBeNull()
    expect(screen.getByRole('heading', { name: 'לקוחה לעריכה' })).toBeTruthy()
  })

  it('rejects an invalid inline value, keeps the editor open, and never saves', async () => {
    mockedUseStore.mockReturnValue(queryResult({ store: editableStore(), versioned: true }))
    const onSave = vi.fn()
    const user = userEvent.setup()
    renderOrders(onSave)

    await user.click(screen.getByRole('button', { name: 'עריכת שם — לקוחה לעריכה' }))
    const input = screen.getByLabelText('שם — לקוחה לעריכה')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByLabelText('שם — לקוחה לעריכה')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('השם לא נשמר')
  })

  it('exports exactly the currently filtered rows as a CSV table', async () => {
    mockedUseStore.mockReturnValue(queryResult({ store: editableStore() }))
    const user = userEvent.setup()
    renderOrders()

    await user.click(screen.getByRole('button', { name: 'חדשה' }))
    await user.click(screen.getByRole('button', { name: 'ייצוא לאקסל' }))

    expect(mockedDownloadTable).toHaveBeenCalledTimes(1)
    const [filename, headers, rows] = mockedDownloadTable.mock.calls[0]!
    expect(filename).toBe('orders')
    expect(headers).toEqual(['תאריך', 'שעה', 'שם', 'טלפון', 'יעד', 'סטטוס', 'שולם', 'סה"כ ($)', 'מקור'])
    expect(rows).toEqual([
      ['2099-08-14', '12:00', 'לקוחה לעריכה', '', 'לא צוין יעד', 'חדשה', 'לא שולם', '50.00', 'whatsapp'],
    ])

    // Without the filter both displayed orders export.
    mockedDownloadTable.mockClear()
    await user.click(screen.getByRole('button', { name: 'הכל' }))
    await user.click(screen.getByRole('button', { name: 'ייצוא לאקסל' }))
    expect(mockedDownloadTable.mock.calls[0]![2]).toEqual([
      ['2099-08-14', '12:00', 'לקוחה לעריכה', '', 'לא צוין יעד', 'חדשה', 'לא שולם', '50.00', 'whatsapp'],
      ['2099-08-15', '', 'הזמנה שנמסרה', '', 'לא צוין יעד', 'נמסרה', 'שולם', '20.00', ''],
    ])
  })

  it('gives linked groups the soft pink group frame', () => {
    mockedUseStore.mockReturnValue(
      queryResult({
        store: {
          orders: [
            { id: 'g1', date: '2099-08-14', name: 'משפחה א', group: 'קבוצת צבע' },
            { id: 'g2', date: '2099-08-14', name: 'משפחה ב', group: 'קבוצת צבע' },
          ],
        },
      }),
    )

    renderOrders()

    const section = screen.getByText('הזמנה קבוצתית: קבוצת צבע').closest('section')
    expect(section).toBeTruthy()
    // One simple light pink frame — clearly separated from regular cards.
    expect(section!.className).toContain('border-rose-200')
    expect(section!.className).toContain('bg-rose-50')
    const header = section!.querySelector('div')
    expect(header!.className).toContain('bg-rose-100')
  })
})
