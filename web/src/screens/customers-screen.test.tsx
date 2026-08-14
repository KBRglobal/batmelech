// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_ROUTES } from '../app/routes.ts'
import { useStore } from '../data/use-store.ts'
import type { CustomerFinanceSaveHandler } from '../domain/customers-finance.ts'
import type { LegacyStore } from '../domain/store.ts'
import { CustomersScreen } from './customers-screen.tsx'

vi.mock('../data/use-store.ts', () => ({ useStore: vi.fn() }))

const mockedUseStore = vi.mocked(useStore)
const HASH = 'a'.repeat(64)

function queryResult(
  options: {
    readonly pending?: boolean
    readonly error?: boolean
    readonly store?: LegacyStore | null
    readonly refetch?: ReturnType<typeof vi.fn>
    readonly revision?: number
  } = {},
): ReturnType<typeof useStore> {
  return {
    isPending: options.pending === true,
    isError: options.error === true,
    data:
      options.pending === true || options.error === true
        ? undefined
        : {
            revision: options.revision ?? 1,
            ts: options.revision ?? 1,
            hash: HASH,
            data: options.store ?? { orders: [] },
          },
    refetch: options.refetch ?? vi.fn(),
  } as unknown as ReturnType<typeof useStore>
}

function renderCustomers(onSave?: CustomerFinanceSaveHandler) {
  return render(
    <MemoryRouter initialEntries={[APP_ROUTES.customers]}>
      <CustomersScreen onSave={onSave} />
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

  it('builds history and repeat links for a canonical colon ID with one encoding pass', () => {
    mockedUseStore.mockReturnValue(queryResult({
      store: { orders: [{ id: 'order:1', date: '2099-08-14', name: 'לקוח קנוני' }] },
    }))

    renderCustomers()

    expect(screen.getByRole('link', { name: /פתיחת ההזמנה של לקוח קנוני/ }).getAttribute('href'))
      .toBe('/orders/order%3A1/edit')
    expect(screen.getByRole('link', { name: 'הזמנה חדשה כמו הקודמת' }).getAttribute('href'))
      .toBe('/orders/new?duplicate=order%3A1')
  })

  it('drafts a reorder invite from the newest live order and skips a cancelled one', () => {
    mockedUseStore.mockReturnValue(
      queryResult({
        store: {
          orders: [
            {
              id: 'older-live',
              date: '2026-08-07',
              name: 'מיכל',
              phone: '0501234567',
              meals: 2,
              salads: { מטבוחה: { o: 1 } },
            },
            {
              id: 'newest-cancelled',
              date: '2026-08-14',
              name: 'מיכל',
              phone: '0501234567',
              status: 'בוטלה',
              meals: 9,
            },
          ],
        },
      }),
    )

    renderCustomers()

    const invite = screen.getByRole('link', { name: 'הזמנה חוזרת בוואטסאפ למיכל' })
    const message = new URL(invite.getAttribute('href')!).searchParams.get('text')!
    expect(invite.getAttribute('href')!.startsWith('https://wa.me/972501234567?text=')).toBe(true)
    expect(message).toContain('בפעם הקודמת, יום שישי 07.08, הזמנת:')
    expect(message).toContain('· ארוחה זוגית ×2')
    expect(message).toContain('· מטבוחה ×1')
    expect(message).toContain('אפשר להזמין כאן: https://batmelech.ae/site/')
    expect(message).not.toContain('×9')
  })

  it('offers no reorder invite when the phone is unusable or the last order has no items', () => {
    mockedUseStore.mockReturnValue(
      queryResult({
        store: {
          orders: [
            { id: 'bad-phone', date: '2026-08-07', name: 'ללא ואטסאפ', phone: '12', meals: 2 },
            { id: 'no-items', date: '2026-08-07', name: 'בלי פריטים', phone: '0509999999' },
          ],
        },
      }),
    )

    renderCustomers()

    expect(screen.queryByRole('link', { name: /הזמנה חוזרת בוואטסאפ/ })).toBeNull()
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
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe(
      'העדפה אמיתית מהשרת',
    )
    expect(screen.getByRole('button', { name: 'הסרת VIP עבור לקוחה אמיתית' })).toBeTruthy()
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

  it('persists notes only after explicit save and includes the confirmed note in search', async () => {
    const store = {
      orders: [{ id: 'real', name: 'לקוחה אמיתית', phone: '0501234567' }],
      customerMeta: { '0501234567': { notes: 'ישן', unknown: 'keep' } },
      unknownRoot: { exact: true },
    } as LegacyStore
    mockedUseStore.mockReturnValue(queryResult({ store, revision: 7 }))
    const onSave = vi.fn<CustomerFinanceSaveHandler>().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderCustomers(onSave)

    const notes = screen.getByLabelText('הערות על הלקוח')
    await user.clear(notes)
    await user.type(notes, 'רגישות לשומשום')
    expect(onSave).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'שמירת הערות על לקוחה אמיתית' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    const request = onSave.mock.calls[0]![0]
    expect(request.reason).toBe('customers')
    expect(request.baseEnvelope).toMatchObject({ revision: 7, hash: HASH, data: store })
    expect(request.baseStore).toBe(store)
    expect(request.nextStore.orders).toEqual(store.orders)
    expect((request.nextStore as Record<string, unknown>).unknownRoot).toEqual({ exact: true })
    expect(request.nextStore.customerMeta).toMatchObject({
      'phone:972501234567': { notes: 'רגישות לשומשום' },
      '0501234567': { notes: 'רגישות לשומשום', unknown: 'keep' },
    })
    expect(await screen.findByText('פרטי הלקוח נשמרו.')).toBeTruthy()

    const search = screen.getByLabelText('חיפוש לקוחות')
    await user.type(search, 'שומשום')
    expect(screen.getByRole('heading', { name: 'לקוחה אמיתית' })).toBeTruthy()
    expect(screen.getByText('נמצאו 1 לקוחות')).toBeTruthy()
  })

  it('persists an explicit VIP toggle without implicitly saving an unsaved note draft', async () => {
    const store = {
      orders: [{ id: 'real', name: 'לקוחה אמיתית', phone: '0501234567' }],
      customerMeta: { '0501234567': { notes: 'הערה שמורה', vip: false } },
    } as LegacyStore
    mockedUseStore.mockReturnValue(queryResult({ store }))
    const onSave = vi.fn<CustomerFinanceSaveHandler>().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderCustomers(onSave)

    await user.type(screen.getByLabelText('הערות על הלקוח'), ' טיוטה')
    expect(onSave).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'סימון VIP עבור לקוחה אמיתית' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0]![0].nextStore.customerMeta).toMatchObject({
      'phone:972501234567': { vip: true },
      '0501234567': { vip: true, notes: 'הערה שמורה' },
    })
    expect((screen.getByLabelText('הערות על הלקוח') as HTMLTextAreaElement).value).toBe(
      'הערה שמורה טיוטה',
    )
  })

  it('toggles VIP without erasing ambiguous alias notes or saving a blank replacement', async () => {
    const store = {
      orders: [
        { id: 'old', name: 'לקוחה', phone: '050-123-4567' },
        { id: 'new', name: 'לקוחה', phone: '+972 50 123 4567' },
      ],
      customerMeta: {
        '0501234567': { notes: 'הערה מקומית', localOnly: true },
        '972501234567': { notes: 'הערה בינלאומית', internationalOnly: true },
      },
    } as LegacyStore
    mockedUseStore.mockReturnValue(queryResult({ store }))
    const onSave = vi.fn<CustomerFinanceSaveHandler>().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderCustomers(onSave)

    expect((screen.getByLabelText('הערות על הלקוח') as HTMLTextAreaElement).value).toBe('')
    await user.click(screen.getByRole('button', { name: 'סימון VIP עבור לקוחה' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0]![0].nextStore.customerMeta).toMatchObject({
      '0501234567': { vip: true, notes: 'הערה מקומית', localOnly: true },
      '972501234567': { vip: true, notes: 'הערה בינלאומית', internationalOnly: true },
    })
  })

  it('drops the confirmed note overlay after cache acknowledgement so a later remote note is visible', async () => {
    const store = {
      orders: [{ id: 'real', name: 'לקוחה', phone: '0501234567' }],
      customerMeta: { '0501234567': { notes: 'ישן' } },
    } as LegacyStore
    mockedUseStore.mockReturnValue(queryResult({ store, revision: 1 }))
    const onSave = vi.fn<CustomerFinanceSaveHandler>().mockResolvedValue(undefined)
    const user = userEvent.setup()
    const view = renderCustomers(onSave)

    const notes = screen.getByLabelText('הערות על הלקוח')
    await user.clear(notes)
    await user.type(notes, 'נשמר מקומית')
    await user.click(screen.getByRole('button', { name: 'שמירת הערות על לקוחה' }))
    const acknowledgedStore = onSave.mock.calls[0]![0].nextStore

    mockedUseStore.mockReturnValue(queryResult({ store: acknowledgedStore, revision: 2 }))
    view.rerender(
      <MemoryRouter initialEntries={[APP_ROUTES.customers]}>
        <CustomersScreen onSave={onSave} />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect((screen.getByLabelText('הערות על הלקוח') as HTMLTextAreaElement).value).toBe('נשמר מקומית')
    })

    const remoteStore = structuredClone(acknowledgedStore)
    remoteStore.customerMeta = {
      ...remoteStore.customerMeta,
      'phone:972501234567': { notes: 'עודכן מטאב אחר' },
      '0501234567': { notes: 'עודכן מטאב אחר' },
      '972501234567': { notes: 'עודכן מטאב אחר' },
      'שם:לקוחה': { notes: 'עודכן מטאב אחר' },
    }
    mockedUseStore.mockReturnValue(queryResult({ store: remoteStore, revision: 3 }))
    view.rerender(
      <MemoryRouter initialEntries={[APP_ROUTES.customers]}>
        <CustomersScreen onSave={onSave} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect((screen.getByLabelText('הערות על הלקוח') as HTMLTextAreaElement).value).toBe('עודכן מטאב אחר')
    })
  })

  it('retains the note draft and performs zero writes when the loaded envelope becomes stale', async () => {
    const store = { orders: [{ id: 'real', name: 'לקוחה', phone: '0501234567' }] } as LegacyStore
    const onSave = vi.fn<CustomerFinanceSaveHandler>().mockResolvedValue(undefined)
    mockedUseStore.mockReturnValue(queryResult({ store, revision: 1 }))
    const user = userEvent.setup()
    const view = renderCustomers(onSave)
    await user.type(screen.getByLabelText('הערות על הלקוח'), 'טיוטה חשובה')

    mockedUseStore.mockReturnValue(queryResult({ store, revision: 2 }))
    view.rerender(
      <MemoryRouter initialEntries={[APP_ROUTES.customers]}>
        <CustomersScreen onSave={onSave} />
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: 'שמירת הערות על לקוחה' }))

    expect(onSave).not.toHaveBeenCalled()
    expect((screen.getByLabelText('הערות על הלקוח') as HTMLTextAreaElement).value).toBe(
      'טיוטה חשובה',
    )
    expect(screen.getByRole('alert').textContent).toContain('הנתונים התעדכנו')
  })
})
