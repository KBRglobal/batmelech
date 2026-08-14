// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_ROUTES } from '../app/routes.ts'
import { useStore } from '../data/use-store.ts'
import { createVersionedRequestId } from '../data/use-save-order.ts'
import {
  AIReviewSchema,
  buildAIOrderCatalog,
  buildOrderEditorMenu,
  createOrderDraft,
} from '../domain/order-editor.ts'
import type { LegacyStore } from '../domain/store.ts'
import { OrderEditorScreen } from './order-editor-screen.tsx'

vi.mock('../data/use-store.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../data/use-store.ts')>()
  return { ...original, useStore: vi.fn() }
})

const mockedUseStore = vi.mocked(useStore)

vi.mock('../data/use-save-order.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../data/use-save-order.ts')>()
  return {
    ...original,
    createVersionedRequestId: vi.fn(original.createVersionedRequestId),
  }
})

const mockedCreateVersionedRequestId = vi.mocked(createVersionedRequestId)

function queryResult(options: {
  readonly pending?: boolean
  readonly error?: boolean
  readonly store?: LegacyStore
  readonly revision?: number
  readonly hash?: string
  readonly refetch?: ReturnType<typeof vi.fn>
} = {}): ReturnType<typeof useStore> {
  const data = options.store ?? { orders: [] }
  const envelope = {
    revision: options.revision ?? 1,
    ts: 1,
    hash: options.hash ?? 'a'.repeat(64),
    data,
  }
  return {
    isPending: options.pending === true,
    isError: options.error === true,
    data: options.pending || options.error ? undefined : envelope,
    refetch: options.refetch ?? vi.fn().mockResolvedValue({ data: envelope, isError: false }),
  } as unknown as ReturnType<typeof useStore>
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}|${JSON.stringify(location.state)}`}</output>
}

function renderEditor(path: string = APP_ROUTES.newOrder, state?: unknown) {
  const questionMarkIndex = path.indexOf('?')
  const pathname = questionMarkIndex === -1 ? path : path.slice(0, questionMarkIndex)
  const search = questionMarkIndex === -1 ? '' : path.slice(questionMarkIndex)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname, search, state }]}>
        <Routes>
          <Route path={APP_ROUTES.newOrder} element={<><OrderEditorScreen /><LocationProbe /></>} />
          <Route path={APP_ROUTES.editOrder} element={<><OrderEditorScreen /><LocationProbe /></>} />
          <Route path={APP_ROUTES.orderImportReview} element={<LocationProbe />} />
          <Route path={APP_ROUTES.orders} element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

beforeEach(() => {
  mockedUseStore.mockReset()
  mockedCreateVersionedRequestId.mockReset()
  mockedCreateVersionedRequestId.mockReturnValue('web-order-save:123e4567-e89b-42d3-a456-426614174000')
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

  it('keeps the fixed action footer above mobile navigation and resets it on desktop', async () => {
    mockedUseStore.mockReturnValue(queryResult())
    renderEditor()

    const footer = (await screen.findByRole('button', { name: 'שמירת ההזמנה' })).closest('footer')
    expect(footer).toBeTruthy()
    expect(footer?.className).toContain('bottom-[calc(5rem+env(safe-area-inset-bottom))]')
    expect(footer?.className).toContain('md:bottom-0')
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
    const saveButton = screen.getByRole('button', { name: 'שמירת ההזמנה' })
    expect(saveButton.hasAttribute('disabled')).toBe(true)
    expect(screen.queryByText('משפחת אברהמי')).toBeNull()
  })

  it('loads the requested real order without mutating the store and fails closed on ID collision', async () => {
    const order = { id: 'live-1', date: '2099-08-20', name: 'לקוחה אמיתית', phone: '050-1234567', address: 'כתובת שמורה', meals: 2 }
    const store = { orders: [order] }
    const original = structuredClone(store)
    mockedUseStore.mockReturnValue(queryResult({ store }))
    renderEditor('/orders/live-1/edit')

    await waitFor(() => expect(screen.getByRole('heading', { name: 'עריכת הזמנה לקוחה אמיתית' })).toBeTruthy())
    expect((screen.getByLabelText('שם מלא') as HTMLInputElement).value).toBe('לקוחה אמיתית')
    expect(store).toEqual(original)
    cleanup()

    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [{ id: 'nameless-1', date: '2099-08-20' }] } }))
    renderEditor('/orders/nameless-1/edit')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'עריכת הזמנה nameless-1' })).toBeTruthy())
    cleanup()

    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [{ id: 7 }, { id: '7' }] } }))
    renderEditor('/orders/7/edit')
    expect(await screen.findByText('מזהה ההזמנה אינו ייחודי')).toBeTruthy()
    expect(screen.queryByLabelText('שם מלא')).toBeNull()
  })

  it('keeps typed reception instructions but clears stale navigation when the hotel identity changes', async () => {
    mockedUseStore.mockReturnValue(queryResult())
    const user = userEvent.setup()
    renderEditor()
    const address = await screen.findByLabelText('כתובת מלאה')
    const navigation = screen.getByLabelText('קישור ניווט')

    await user.type(address, 'למסור בקבלה')
    await user.type(navigation, 'https://maps.example/typed')
    await user.type(screen.getByLabelText('שם מלון / יעד'), 'Rosewood Abu Dhabi')
    expect((address as HTMLInputElement).value).toBe('למסור בקבלה')
    expect((navigation as HTMLInputElement).value).toBe('')

    await user.click(screen.getByRole('checkbox', { name: 'איסוף עצמי' }))
    expect(screen.queryByLabelText('כתובת מלאה')).toBeNull()
    await user.click(screen.getByRole('checkbox', { name: 'איסוף עצמי' }))
    expect((screen.getByLabelText('כתובת מלאה') as HTMLInputElement).value).toBe('למסור בקבלה')
  })

  it('fetches hotels only after explicit search, selects Abu Dhabi metadata, and keeps typed instructions', async () => {
    const uuidSpy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('123e4567-e89b-42d3-a456-426614174099')
    const hotelResult = {
      id: 'N123',
      name: 'Rosewood Abu Dhabi',
      fullAddress: 'Rosewood Abu Dhabi, Al Maryah Island, Abu Dhabi, United Arab Emirates',
      latitude: 24.5012,
      longitude: 54.3875,
      navigationUrl: 'https://www.google.com/maps/search/?api=1&query=24.5012%2C54.3875',
    }
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, request) => {
      if (String(url).startsWith('/api/hotels/search?')) {
        return new Response(JSON.stringify({
          results: [hotelResult],
          attribution: {
            label: 'OpenStreetMap contributors',
            url: 'https://www.openstreetmap.org/copyright',
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      const command = JSON.parse(String(request?.body)) as { localState: LegacyStore }
      return new Response(JSON.stringify({
        ok: true,
        idempotent: false,
        revision: 2,
        ts: 2,
        hash: 'b'.repeat(64),
        data: command.localState,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    mockedUseStore.mockReturnValue(queryResult())
    const user = userEvent.setup()
    renderEditor()

    const hotelInput = await screen.findByLabelText('שם מלון / יעד')
    await user.type(screen.getByLabelText('שם מלא'), 'לקוחה')
    await user.type(screen.getByLabelText('כתובת מלאה'), 'למסור בקבלה')
    await user.type(hotelInput, 'Rosewood')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'נתוני החיפוש: OpenStreetMap contributors' }).getAttribute('href')).toBe('https://www.openstreetmap.org/copyright')

    await user.click(screen.getByRole('button', { name: 'חיפוש מלון' }))
    expect(await screen.findByRole('button', { name: /Rosewood Abu Dhabi/ })).toBeTruthy()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0]![0]).toBe('/api/hotels/search?q=Rosewood')

    await user.click(screen.getByRole('button', { name: /Rosewood Abu Dhabi/ }))
    expect((hotelInput as HTMLInputElement).value).toBe('Rosewood Abu Dhabi')
    expect((screen.getByLabelText('כתובת מלאה') as HTMLInputElement).value).toBe('למסור בקבלה')
    expect((screen.getByLabelText('קישור ניווט') as HTMLInputElement).value).toBe(hotelResult.navigationUrl)

    await user.click(screen.getByRole('button', { name: 'להשתמש במחיר המוצע' }))
    await user.click(screen.getByRole('button', { name: 'שמירת ההזמנה' }))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2))
    const command = JSON.parse(String(fetchSpy.mock.calls[1]![1]?.body)) as { localState: LegacyStore }
    expect(command.localState.orders[0]).toMatchObject({
      place: hotelResult.name,
      address: 'למסור בקבלה',
      hotelName: hotelResult.name,
      hotelProviderId: hotelResult.id,
      hotelAddress: hotelResult.fullAddress,
      hotelLatitude: hotelResult.latitude,
      hotelLongitude: hotelResult.longitude,
      navigationUrl: hotelResult.navigationUrl,
    })
    uuidSpy.mockRestore()
  })

  it('replaces Hotel A custom navigation with the newly selected provider Hotel B destination', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('123e4567-e89b-42d3-a456-426614174099')
    const hotelA = {
      id: 'N123',
      name: 'Hotel A Dubai',
      fullAddress: 'Hotel A, Dubai, United Arab Emirates',
      latitude: 25.2,
      longitude: 55.3,
      navigationUrl: 'https://www.google.com/maps/search/?api=1&query=25.2%2C55.3',
    }
    const hotelB = {
      id: 'W456',
      name: 'Hotel B Abu Dhabi',
      fullAddress: 'Hotel B, Abu Dhabi, United Arab Emirates',
      latitude: 24.5,
      longitude: 54.4,
      navigationUrl: 'https://www.google.com/maps/search/?api=1&query=24.5%2C54.4',
    }
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, request) => {
      if (request?.method !== 'POST') {
        const result = String(url).includes('Hotel+B') ? hotelB : hotelA
        return new Response(JSON.stringify({
          results: [result],
          attribution: {
            label: 'OpenStreetMap contributors',
            url: 'https://www.openstreetmap.org/copyright',
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      const command = JSON.parse(String(request.body)) as { localState: LegacyStore }
      return new Response(JSON.stringify({
        ok: true,
        idempotent: false,
        revision: 2,
        ts: 2,
        hash: 'b'.repeat(64),
        data: command.localState,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    mockedUseStore.mockReturnValue(queryResult())
    const user = userEvent.setup()
    renderEditor()

    const hotelInput = await screen.findByLabelText('שם מלון / יעד')
    await user.type(screen.getByLabelText('שם מלא'), 'לקוחה')
    await user.type(screen.getByLabelText('כתובת מלאה'), 'למסור בקבלה')
    await user.type(hotelInput, 'Hotel A')
    await user.click(screen.getByRole('button', { name: 'חיפוש מלון' }))
    await user.click(await screen.findByRole('button', { name: /Hotel A Dubai/ }))

    const navigation = screen.getByLabelText('קישור ניווט')
    await user.clear(navigation)
    await user.type(navigation, 'https://www.google.com/maps/search/?api=1&query=25.21%2C55.31')
    expect((navigation as HTMLInputElement).value).toContain('25.21')

    await user.clear(hotelInput)
    await user.type(hotelInput, 'Hotel B')
    expect((navigation as HTMLInputElement).value).toBe('')
    await user.click(screen.getByRole('button', { name: 'חיפוש מלון' }))
    await user.click(await screen.findByRole('button', { name: /Hotel B Abu Dhabi/ }))
    expect((navigation as HTMLInputElement).value).toBe(hotelB.navigationUrl)
    expect((screen.getByLabelText('כתובת מלאה') as HTMLInputElement).value).toBe('למסור בקבלה')

    await user.click(screen.getByRole('button', { name: 'להשתמש במחיר המוצע' }))
    await user.click(screen.getByRole('button', { name: 'שמירת ההזמנה' }))
    await waitFor(() => expect(fetchSpy.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true))
    const postCall = fetchSpy.mock.calls.find(([, options]) => options?.method === 'POST')!
    const command = JSON.parse(String(postCall[1]?.body)) as { localState: LegacyStore }
    expect(command.localState.orders[0]).toMatchObject({
      hotelName: hotelB.name,
      hotelAddress: hotelB.fullAddress,
      hotelProviderId: hotelB.id,
      navigationUrl: hotelB.navigationUrl,
      address: 'למסור בקבלה',
    })
  })

  it('retains the static hotel fallback when provider search fails and does not save', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ error: 'hotel search unavailable' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    ))
    mockedUseStore.mockReturnValue(queryResult())
    const user = userEvent.setup()
    renderEditor()

    await user.type(await screen.findByLabelText('שם מלון / יעד'), 'Atlantis')
    await user.click(screen.getByRole('button', { name: 'חיפוש מלון' }))
    expect(await screen.findByText(/חיפוש המלונות אינו זמין כרגע/)).toBeTruthy()
    await user.selectOptions(screen.getByLabelText('מלון מהרשימה הקבועה'), 'Atlantis The Palm')
    await user.click(screen.getByRole('button', { name: 'בחירת המלון' }))
    expect((screen.getByLabelText('שם מלון / יעד') as HTMLInputElement).value).toBe('Atlantis The Palm')
    expect((screen.getByLabelText('כתובת מלאה') as HTMLInputElement).value).toBe('Crescent Rd, Palm Jumeirah, Dubai')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('blocks unpriced main and Shabbat-side overages in the visible editor', async () => {
    mockedUseStore.mockReturnValue(queryResult())
    const user = userEvent.setup()
    renderEditor()
    await user.type(await screen.findByLabelText('שם מלא'), 'לקוחה')
    await user.click(screen.getByRole('button', { name: 'הוספה לקציצות בשר ברוטב אדום עשיר' }))
    await user.click(screen.getByRole('button', { name: 'הוספה לקציצות בשר עם אפונה וארטישוק' }))
    await user.click(screen.getByRole('button', { name: 'הוספה לאורז לבן' }))
    await user.click(screen.getByRole('button', { name: 'הוספה לאורז לבן' }))

    expect(screen.getByText(/יותר מנות עיקריות ממספר הארוחות/)).toBeTruthy()
    expect(screen.getByText(/יותר תוספות שבת ממספר הארוחות/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'שמירת ההזמנה' }).hasAttribute('disabled')).toBe(true)
  })

  it('synchronizes challahs with meal changes until the operator overrides the challah quantity', async () => {
    mockedUseStore.mockReturnValue(queryResult())
    const user = userEvent.setup()
    renderEditor()

    await screen.findByRole('heading', { name: 'הזמנה חדשה' })
    expect(screen.getByLabelText('כמות חלות').textContent).toBe('2')
    await user.click(screen.getByRole('button', { name: 'הוספה לארוחות זוגיות' }))
    expect(screen.getByLabelText('כמות ארוחות זוגיות').textContent).toBe('2')
    expect(screen.getByLabelText('כמות חלות').textContent).toBe('4')

    await user.click(screen.getByRole('button', { name: 'הוספה לחלות' }))
    expect(screen.getByLabelText('כמות חלות').textContent).toBe('5')
    await user.click(screen.getByRole('button', { name: 'הוספה לארוחות זוגיות' }))
    expect(screen.getByLabelText('כמות ארוחות זוגיות').textContent).toBe('3')
    expect(screen.getByLabelText('כמות חלות').textContent).toBe('5')
  })

  it('clears lunch sides and add-ons when their parent lunch quantity returns to zero', async () => {
    mockedUseStore.mockReturnValue(queryResult())
    const user = userEvent.setup()
    renderEditor()

    await screen.findByRole('heading', { name: 'הזמנה חדשה' })
    await user.click(screen.getByRole('button', { name: 'הוספה לשניצל בצלחת' }))
    let plate = screen.getByText('שניצל בצלחת').parentElement?.parentElement
    expect(plate).toBeTruthy()
    await user.click(within(plate!).getByRole('button', { name: 'הוספה לאורז לבן' }))
    expect(within(plate!).getByLabelText('כמות אורז לבן').textContent).toBe('1')
    await user.click(screen.getByRole('button', { name: 'הפחתה משניצל בצלחת' }))
    expect(within(plate!).queryByLabelText('כמות אורז לבן')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'הוספה לשניצל בצלחת' }))
    plate = screen.getByText('שניצל בצלחת').parentElement?.parentElement
    expect(within(plate!).getByLabelText('כמות אורז לבן').textContent).toBe('0')

    await user.click(screen.getByRole('button', { name: 'הוספה לספיישל קוסקוס' }))
    await user.click(screen.getByRole('button', { name: 'הוספה למנת מפרום ביתי · $20.00' }))
    expect(screen.getByLabelText('כמות מנת מפרום ביתי · $20.00').textContent).toBe('1')
    await user.click(screen.getByRole('button', { name: 'הפחתה מספיישל קוסקוס' }))
    expect(screen.queryByLabelText('כמות מנת מפרום ביתי · $20.00')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'הוספה לספיישל קוסקוס' }))
    expect(screen.getByLabelText('כמות מנת מפרום ביתי · $20.00').textContent).toBe('0')
  })

  it('turns the untouched default into lunch-only and requires explicit approval for a mixed order', async () => {
    mockedUseStore.mockReturnValue(queryResult())
    const user = userEvent.setup()
    renderEditor()

    await user.type(await screen.findByLabelText('שם מלא'), 'לקוחה')
    await user.click(screen.getByRole('button', { name: 'הוספה לבגט טוניסאי אותנטי' }))
    expect(screen.getByLabelText('כמות ארוחות זוגיות').textContent).toBe('0')
    expect(screen.getByLabelText('כמות חלות').textContent).toBe('0')
    expect(screen.queryByText(/ארוחה זוגית ×1/u)).toBeNull()
    expect(screen.getAllByText('$37.00').length).toBeGreaterThan(0)
    expect(screen.queryByRole('checkbox', { name: 'אני מאשרת שזו הזמנה משולבת של שבת וצהריים' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'הוספה לארוחות זוגיות' }))
    expect(screen.getByLabelText('כמות חלות').textContent).toBe('2')
    expect(screen.getByText(/נבחרו יחד פריטי שבת וצהריים/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'להשתמש במחיר המוצע' }))
    const save = screen.getByRole('button', { name: 'שמירת ההזמנה' })
    expect(save.hasAttribute('disabled')).toBe(true)

    await user.click(screen.getByRole('checkbox', { name: 'אני מאשרת שזו הזמנה משולבת של שבת וצהריים' }))
    expect(screen.queryByText(/נבחרו יחד פריטי שבת וצהריים/)).toBeNull()
    expect(save.hasAttribute('disabled')).toBe(false)
  })

  it('loads a safe duplicate as a new draft and saves it with a fresh ID', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 7, 12, 15, 0))
    const sourceOrder = {
      id: 'source-1',
      date: '2026-08-01',
      name: 'לקוחה חוזרת',
      phone: '050-1234567',
      place: 'Rosewood Abu Dhabi',
      address: 'מסירה בקבלה',
      meals: 1,
      status: 'נמסרה',
      paid: 'כן',
      deposit: '100.00',
      total: '245.00',
    }
    const store = { orders: [sourceOrder] }
    const uuidSpy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('123e4567-e89b-42d3-a456-426614174001')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, request) => {
      const command = JSON.parse(String(request?.body)) as { localState: LegacyStore }
      return new Response(JSON.stringify({
        ok: true,
        idempotent: false,
        revision: 2,
        ts: 2,
        hash: 'b'.repeat(64),
        data: command.localState,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    mockedUseStore.mockReturnValue(queryResult({ store }))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderEditor(`${APP_ROUTES.newOrder}?duplicate=source-1`)

    await waitFor(() => expect((screen.getByLabelText('שם מלא') as HTMLInputElement).value).toBe('לקוחה חוזרת'))
    expect((screen.getByLabelText('תאריך ההזמנה') as HTMLInputElement).value).toBe('2026-08-14')
    expect((screen.getByLabelText('מקדמה') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('סטטוס תשלום') as HTMLSelectElement).value).toBe('לא')
    expect((screen.getByLabelText('סטטוס ההזמנה') as HTMLSelectElement).value).toBe('חדשה')
    await user.click(screen.getByRole('button', { name: 'שמירת ההזמנה' }))

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    const command = JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body)) as { localState: LegacyStore }
    expect(command.localState.orders).toHaveLength(2)
    expect(command.localState.orders[0]).toEqual(sourceOrder)
    expect(command.localState.orders[1]).toMatchObject({
      id: 'order-123e4567-e89b-42d3-a456-426614174001',
      name: 'לקוחה חוזרת',
      date: '2026-08-14',
      status: 'חדשה',
      paid: 'לא',
      deposit: '',
    })
    uuidSpy.mockRestore()
  })

  it('fails closed for malformed, missing, or colliding duplicate source IDs', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [{ id: 'source-1' }] } }))
    const malformed = renderEditor(`${APP_ROUTES.newOrder}?duplicate=bad%20id`)
    expect(await screen.findByText('לא ניתן לשכפל את ההזמנה')).toBeTruthy()
    expect(screen.queryByLabelText('שם מלא')).toBeNull()
    malformed.unmount()

    const missing = renderEditor(`${APP_ROUTES.newOrder}?duplicate=missing`)
    expect(await screen.findByText(/הזמנת המקור לא נמצאה/)).toBeTruthy()
    missing.unmount()

    mockedUseStore.mockReturnValue(queryResult({
      store: { orders: [{ id: 'source-1' }, { id: 'source-1' }] },
    }))
    renderEditor(`${APP_ROUTES.newOrder}?duplicate=source-1`)
    expect(await screen.findByText('מזהה ההזמנה אינו ייחודי')).toBeTruthy()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('shows authoritative fish, salad, dessert, and custom-item pricing without auto-writing Total', async () => {
    mockedUseStore.mockReturnValue(queryResult())
    const user = userEvent.setup()
    renderEditor()
    await screen.findByRole('heading', { name: 'הזמנה חדשה' })
    await user.type(screen.getByLabelText('שם מלא'), 'לקוחה')

    await user.click(screen.getByRole('button', { name: 'הוספה לפילה דג ברוטב מרוקאי' }))
    await user.click(screen.getByRole('button', { name: 'הוספה לפילה דג ברוטב מרוקאי' }))
    await user.click(screen.getByRole('button', { name: 'הוספה לפילה דג ברוטב מרוקאי' }))
    for (let index = 0; index < 5; index += 1) {
      await user.click(screen.getByRole('button', { name: 'הוספה לטחינה הוזמן' }))
    }
    await user.click(screen.getByRole('button', { name: 'הוספה לסופלה שוקולד' }))
    await user.click(screen.getByRole('button', { name: 'הוספה לסוכריות בקלוואה' }))

    expect(screen.getAllByText('$282.00').length).toBeGreaterThan(0)
    expect(screen.getByText('$30.00')).toBeTruthy()
    expect(screen.getByText('יש חריגה מזכאות הקינוח. לא הוספנו מחיר שלא אושר.')).toBeTruthy()
    expect((screen.getByLabelText('סך לתשלום') as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('button', { name: 'שמירת ההזמנה' }).hasAttribute('disabled')).toBe(true)

    await user.click(screen.getByRole('button', { name: 'להשתמש במחיר המוצע' }))
    expect((screen.getByLabelText('סך לתשלום') as HTMLInputElement).value).toBe('282.00')
    expect(screen.getByRole('button', { name: 'שמירת ההזמנה' }).hasAttribute('disabled')).toBe(true)

    await user.click(screen.getByRole('button', { name: 'הפחתה מסוכריות בקלוואה' }))
    expect(screen.getByRole('button', { name: 'שמירת ההזמנה' }).hasAttribute('disabled')).toBe(false)

    await user.click(screen.getByRole('button', { name: 'הוספת פריט חופשי' }))
    await user.type(screen.getByLabelText('שם פריט חופשי 1'), 'פריט אמיתי')
    await user.type(screen.getByLabelText('מחיר פריט חופשי 1'), '0.10')
    expect(screen.getAllByText('$282.10').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'שמירת ההזמנה' }).hasAttribute('disabled')).toBe(true)
  })

  it('blocks an arbitrary total and a deposit above the deterministic total', async () => {
    mockedUseStore.mockReturnValue(queryResult())
    const user = userEvent.setup()
    renderEditor()
    await user.type(await screen.findByLabelText('שם מלא'), 'לקוחה')
    const save = screen.getByRole('button', { name: 'שמירת ההזמנה' })

    await user.type(screen.getByLabelText('סך לתשלום'), '1.00')
    expect(save.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('סך התשלום חייב להיות זהה למחיר המחושב.')).toBeTruthy()

    await user.clear(screen.getByLabelText('סך לתשלום'))
    await user.type(screen.getByLabelText('סך לתשלום'), '245.00')
    await user.type(screen.getByLabelText('מקדמה'), '246.00')
    expect(save.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('המקדמה לא יכולה להיות גבוהה מסך התשלום.')).toBeTruthy()

    await user.clear(screen.getByLabelText('מקדמה'))
    await user.type(screen.getByLabelText('מקדמה'), '245.00')
    expect(save.hasAttribute('disabled')).toBe(false)
  })

  it('routes a complete WhatsApp message with manual details preserved and every order or money field reset', async () => {
    mockedUseStore.mockReturnValue(queryResult())
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const user = userEvent.setup()
    renderEditor()
    await user.type(await screen.findByLabelText('שם מלא'), 'שם ידני')
    await user.type(screen.getByLabelText('כתובת מלאה'), 'הוראות ידניות לקבלה')
    await user.type(screen.getByLabelText('הערות כלליות'), 'הערה ידנית')
    await user.type(screen.getByLabelText('קבוצה / יעד משותף'), 'קבוצה ידנית')
    await user.type(screen.getByLabelText('סך לתשלום'), '245.00')
    await user.type(screen.getByLabelText('מקדמה'), '20.00')
    await user.selectOptions(screen.getByLabelText('דרך תשלום'), 'ביט')
    await user.selectOptions(screen.getByLabelText('סטטוס תשלום'), 'כן')
    await user.click(screen.getByRole('button', { name: 'הוספה לטחינה הוזמן' }))
    await user.click(screen.getByRole('button', { name: `הוספה למגש שניצלים (זוגי, כ־13–15 יח') · $100.00` }))
    await user.click(screen.getByRole('button', { name: 'הוספת פריט חופשי' }))
    await user.type(screen.getByLabelText('שם פריט חופשי 1'), 'פריט ידני')
    await user.type(await screen.findByLabelText('הודעת הלקוח'), 'שתי זוגיות')
    await user.click(screen.getByRole('button', { name: 'בניית הזמנה מההודעה' }))

    const location = screen.getByTestId('location').textContent!
    expect(location).toContain(APP_ROUTES.orderImportReview)
    const state = JSON.parse(location.slice(location.indexOf('|') + 1)) as {
      message: string
      baseDraft: ReturnType<typeof createOrderDraft>
    }
    expect(state.message).toBe('שתי זוגיות')
    expect(state.baseDraft).toMatchObject({
      id: null,
      status: 'מתעניין',
      name: 'שם ידני',
      address: 'הוראות ידניות לקבלה',
      notes: 'הערה ידנית',
      group: 'קבוצה ידנית',
      meals: 0,
      aricha: 0,
      challot: 0,
      salads: {},
      firsts: {},
      heat: '',
      firstsNote: '',
      mains: {},
      mainsNote: '',
      sides: {},
      desserts: {},
      extras: {},
      custom: [],
      lunch: {},
      total: '',
      deposit: '',
      payMethod: '',
      paid: 'לא',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('shows the reviewed order as an editable manager, gates save on every finding, and saves only on explicit save', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('123e4567-e89b-42d3-a456-426614174099')
    const store: LegacyStore = { orders: [] }
    const menu = buildOrderEditorMenu(store)
    const catalog = buildAIOrderCatalog(menu)
    const trayName = "מגש שניצלים (זוגי, כ־13–15 יח')"
    const tray = catalog.items.find((item) => item.name === trayName)!
    const reviewedDraft = {
      ...createOrderDraft(menu, new Date(2026, 7, 12)),
      name: 'לקוחה מהוואטסאפ',
      extras: { [trayName]: { quantity: 1, note: '' } },
    }
    const review = AIReviewSchema.parse({
      reviewOnly: true,
      draft: {
        customerName: 'לקוחה מהוואטסאפ',
        customerPhone: null,
        serviceDate: null,
        serviceTime: null,
        fulfillmentMethod: 'unknown',
        deliveryLocation: null,
        items: [
          {
            catalogItemId: 'meal:couple',
            catalogItemName: 'ארוחה זוגית',
            category: 'couple_meal',
            quantity: 1,
            sourceText: 'זוגית אחת',
            confidence: 1,
          },
          {
            catalogItemId: tray.id,
            catalogItemName: 'שם שגוי מהמודל',
            category: tray.category,
            quantity: 1,
            sourceText: 'ומגש שניצלים אחד',
            confidence: 0.95,
          },
        ],
        notes: [],
      },
      corrections: [{
        originalText: 'בעצם שתי זוגיות',
        correctedText: 'זוגית אחת',
        reason: 'Provider correction reason must stay hidden.',
      }],
      ambiguities: [{
        sourceText: 'בשישי',
        question: "Confirm the customer's intended choice.",
        candidateCatalogItemIds: [],
      }],
      paidExtras: [],
      unknownItems: [{
        sourceText: 'וסלט הבית',
        requestedQuantity: 1,
        reason: 'Provider unknown-item reason must stay hidden.',
      }],
      missingFields: [{
        field: 'customer_phone',
        sourceText: null,
        reason: 'Provider missing-field reason must stay hidden.',
      }, {
        field: 'item_choice',
        sourceText: 'בשישי',
        reason: 'Duplicate provider finding must stay hidden.',
      }],
      warnings: [{
        code: 'other',
        severity: 'warning',
        message: 'Provider warning must stay hidden.',
      }],
      overallConfidence: 0.8,
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, request) => {
      const command = JSON.parse(String(request?.body)) as { localState: LegacyStore }
      return new Response(JSON.stringify({
        ok: true,
        idempotent: false,
        revision: 2,
        ts: 2,
        hash: 'b'.repeat(64),
        data: command.localState,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    mockedUseStore.mockReturnValue(queryResult({ store }))
    const user = userEvent.setup()
    renderEditor(APP_ROUTES.newOrder, {
      review,
      reviewedDraft,
      reviewedCatalogSignature: JSON.stringify(catalog.items),
      reviewedRevision: 1,
      reviewedHash: 'a'.repeat(64),
      reviewedTs: 1,
      reviewedStateSignature: JSON.stringify(store),
      reviewedMessage: 'בעצם שתי זוגיות, זוגית אחת ומגש שניצלים אחד בשישי וסלט הבית',
    })

    const manager = await screen.findByRole('region', { name: 'מנהל ההזמנה מוואטסאפ' })
    await user.click(within(manager).getByText('הודעת הלקוח המקורית'))
    expect(within(manager).getByText('בעצם שתי זוגיות, זוגית אחת ומגש שניצלים אחד בשישי וסלט הבית')).toBeTruthy()
    const quotedSourceRows = manager.querySelectorAll('blockquote, q')
    expect(quotedSourceRows.length).toBeGreaterThan(0)
    for (const quotedSourceRow of quotedSourceRows) {
      expect(quotedSourceRow.classList.contains('break-words')).toBe(true)
      expect(quotedSourceRow.classList.contains('[overflow-wrap:anywhere]')).toBe(true)
    }
    expect(within(manager).getByText('ארוחה זוגית · 1')).toBeTruthy()
    expect(within(manager).getAllByText('ומגש שניצלים אחד').length).toBeGreaterThanOrEqual(2)
    expect(within(manager).getByText(`${trayName} · 1 · $100.00`)).toBeTruthy()
    expect(within(manager).getByText(`אישור תוספת בתשלום: ${trayName} · 1 · $100.00`)).toBeTruthy()
    expect(within(manager).getByText('הלקוח תיקן: „בעצם שתי זוגיות” ל„זוגית אחת”')).toBeTruthy()
    expect(within(manager).getByText('צריך לוודא לאיזו מנה הלקוח התכוון')).toBeTruthy()
    expect(within(manager).getByText('חסר מספר טלפון')).toBeTruthy()
    expect(within(manager).getByText('יש פרט נוסף שצריך לבדוק מול הודעת הלקוח')).toBeTruthy()
    expect(within(manager).queryByText(/Provider/)).toBeNull()
    expect((screen.getByLabelText('שם מלא') as HTMLInputElement).value).toBe('לקוחה מהוואטסאפ')

    await user.click(screen.getByRole('button', { name: 'להשתמש במחיר המוצע' }))
    const save = screen.getByRole('button', { name: 'שמירת ההזמנה' })
    expect(save.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('השמירה תיפתח אחרי סימון טופל בכל הבירורים.')).toBeTruthy()
    expect(fetchSpy).not.toHaveBeenCalled()

    const findingButtons = within(manager).getAllByRole('button', { name: /^טופל:/ })
    expect(findingButtons).toHaveLength(6)
    expect(new Set(findingButtons.map((button) => button.getAttribute('aria-label'))).size).toBe(6)
    for (let index = 0; index < findingButtons.length; index += 1) {
      const next = within(manager).getAllByRole('button', { name: /^טופל:/ })
        .find((button) => button.getAttribute('aria-pressed') === 'false')
      expect(next).toBeTruthy()
      await user.click(next!)
      if (index < findingButtons.length - 1) expect(save.hasAttribute('disabled')).toBe(true)
    }
    expect(save.hasAttribute('disabled')).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()

    await user.click(save)
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    const command = JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body)) as { localState: LegacyStore }
    expect(command.localState.orders[0]).toMatchObject({
      name: 'לקוחה מהוואטסאפ',
      meals: 1,
      extras: { [trayName]: { q: 1 } },
    })
  })

  it('keeps a warning-only handoff blocked until its Hebrew fallback is acknowledged', async () => {
    const store: LegacyStore = { orders: [] }
    const menu = buildOrderEditorMenu(store)
    const review = AIReviewSchema.parse({
      reviewOnly: true,
      draft: {
        customerName: 'לקוחה',
        customerPhone: null,
        serviceDate: null,
        serviceTime: null,
        fulfillmentMethod: 'unknown',
        deliveryLocation: null,
        items: [],
        notes: [],
      },
      corrections: [],
      ambiguities: [],
      paidExtras: [],
      unknownItems: [],
      missingFields: [],
      warnings: [{
        code: 'catalog_mismatch',
        severity: 'warning',
        message: 'The provider-only warning must never be shown.',
      }],
      overallConfidence: 0.7,
    })
    mockedUseStore.mockReturnValue(queryResult({ store }))
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const user = userEvent.setup()
    renderEditor(APP_ROUTES.newOrder, {
      review,
      reviewedDraft: {
        ...createOrderDraft(menu, new Date(2026, 7, 12)),
        name: 'לקוחה',
        total: '245.00',
      },
      reviewedCatalogSignature: JSON.stringify(buildAIOrderCatalog(menu).items),
      reviewedRevision: 1,
      reviewedHash: 'a'.repeat(64),
      reviewedTs: 1,
      reviewedStateSignature: JSON.stringify(store),
      reviewedMessage: 'הודעה שלא הותאמה במלואה',
    })

    const manager = await screen.findByRole('region', { name: 'מנהל ההזמנה מוואטסאפ' })
    expect(within(manager).getByText('צריך לבדוק בקשה שלא הותאמה לתפריט')).toBeTruthy()
    expect(within(manager).queryByText(/provider-only/i)).toBeNull()
    const save = screen.getByRole('button', { name: 'שמירת ההזמנה' })
    expect(save.hasAttribute('disabled')).toBe(true)
    await user.click(within(manager).getByRole('button', { name: 'טופל: צריך לבדוק בקשה שלא הותאמה לתפריט' }))
    expect(save.hasAttribute('disabled')).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('applies an AI handoff only when catalog, envelope metadata, and the full state signature match', async () => {
    const store: LegacyStore = { orders: [] }
    const signature = JSON.stringify(buildAIOrderCatalog(buildOrderEditorMenu(store)).items)
    const review = AIReviewSchema.parse({
      reviewOnly: true,
      draft: {
        customerName: 'לקוחה מה-AI',
        customerPhone: null,
        serviceDate: null,
        serviceTime: null,
        fulfillmentMethod: 'unknown',
        deliveryLocation: null,
        items: [],
        notes: [],
      },
      corrections: [], ambiguities: [], paidExtras: [], unknownItems: [], missingFields: [], warnings: [], overallConfidence: 1,
    })
    mockedUseStore.mockReturnValue(queryResult({ store }))
    const exact = renderEditor(APP_ROUTES.newOrder, {
      review,
      reviewedCatalogSignature: signature,
      reviewedRevision: 1,
      reviewedHash: 'a'.repeat(64),
      reviewedTs: 1,
      reviewedStateSignature: JSON.stringify(store),
    })
    expect((await screen.findByLabelText('שם מלא') as HTMLInputElement).value).toBe('לקוחה מה-AI')
    expect(screen.getByLabelText('כמות ארוחות זוגיות').textContent).toBe('0')
    expect(screen.getByLabelText('כמות חלות').textContent).toBe('0')
    exact.unmount()

    const mismatchedState = renderEditor(APP_ROUTES.newOrder, {
      review,
      reviewedCatalogSignature: signature,
      reviewedRevision: 1,
      reviewedHash: 'a'.repeat(64),
      reviewedTs: 1,
      reviewedStateSignature: JSON.stringify({ orders: [], settings: { out: [] } }),
    })
    expect(await screen.findByText('לא ניתן לפתוח את פענוח הוואטסאפ בבטחה')).toBeTruthy()
    expect(screen.queryByLabelText('שם מלא')).toBeNull()
    mismatchedState.unmount()
  })

  it('fails closed when reviewedTs is missing and returns the recoverable message to review without saving', async () => {
    const store: LegacyStore = { orders: [] }
    const menu = buildOrderEditorMenu(store)
    const review = AIReviewSchema.parse({
      reviewOnly: true,
      draft: {
        customerName: 'אסור לפתוח טיוטה',
        customerPhone: null,
        serviceDate: null,
        serviceTime: null,
        fulfillmentMethod: 'unknown',
        deliveryLocation: null,
        items: [],
        notes: [],
      },
      corrections: [], ambiguities: [], paidExtras: [], unknownItems: [], missingFields: [], warnings: [], overallConfidence: 1,
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    mockedUseStore.mockReturnValue(queryResult({ store }))
    const user = userEvent.setup()
    renderEditor(APP_ROUTES.newOrder, {
      review,
      reviewedCatalogSignature: JSON.stringify(buildAIOrderCatalog(menu).items),
      reviewedRevision: 1,
      reviewedHash: 'a'.repeat(64),
      reviewedStateSignature: JSON.stringify(store),
      reviewedMessage: 'הודעה שצריך לבדוק שוב',
    })

    expect(await screen.findByText('לא ניתן לפתוח את פענוח הוואטסאפ בבטחה')).toBeTruthy()
    expect(screen.queryByLabelText('שם מלא')).toBeNull()
    expect(screen.queryByRole('button', { name: 'שמירת ההזמנה' })).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'חזרה לבדיקת הודעת הוואטסאפ' }))
    expect(screen.getByTestId('location').textContent).toBe(
      `${APP_ROUTES.orderImportReview}|${JSON.stringify({ message: 'הודעה שצריך לבדוק שוב' })}`,
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('prefers a canonical reviewed draft and preserves BM1 and base-draft fields through save', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('123e4567-e89b-42d3-a456-426614174099')
    const store: LegacyStore = { orders: [] }
    const menu = buildOrderEditorMenu(store)
    const signature = JSON.stringify(buildAIOrderCatalog(menu).items)
    const review = AIReviewSchema.parse({
      reviewOnly: true,
      draft: {
        customerName: 'שם fallback',
        customerPhone: null,
        serviceDate: null,
        serviceTime: null,
        fulfillmentMethod: 'unknown',
        deliveryLocation: null,
        items: [],
        notes: [],
      },
      corrections: [], ambiguities: [], paidExtras: [], unknownItems: [], missingFields: [], warnings: [], overallConfidence: 1,
    })
    const reviewedDraft = {
      ...createOrderDraft(menu, new Date(2026, 7, 12)),
      name: 'שם BM1',
      group: 'שדה מטיוטת הבסיס',
      notes: 'הערה שנשמרה בטיוטת הבסיס',
      meals: 0,
      challot: 0,
      lunch: {
        baguette: { quantity: 1, variantKey: '', sides: {}, addonQuantity: 0 },
      },
      custom: [{ name: 'פריט בסיס', quantity: 1, unitPrice: '1.00', note: 'לשמור' }],
      bm1PayloadVersion: 1,
    }
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, request) => {
      const command = JSON.parse(String(request?.body)) as { localState: LegacyStore }
      return new Response(JSON.stringify({
        ok: true,
        idempotent: false,
        revision: 2,
        ts: 2,
        hash: 'b'.repeat(64),
        data: command.localState,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    mockedUseStore.mockReturnValue(queryResult({ store }))
    const user = userEvent.setup()
    renderEditor(APP_ROUTES.newOrder, {
      review,
      reviewedDraft,
      reviewedCatalogSignature: signature,
      reviewedRevision: 1,
      reviewedHash: 'a'.repeat(64),
      reviewedTs: 1,
      reviewedStateSignature: JSON.stringify(store),
    })

    expect((await screen.findByLabelText('שם מלא') as HTMLInputElement).value).toBe('שם BM1')
    expect((screen.getByLabelText('קבוצה / יעד משותף') as HTMLInputElement).value).toBe('שדה מטיוטת הבסיס')
    expect((screen.getByLabelText('הערות כלליות') as HTMLTextAreaElement).value).toBe('הערה שנשמרה בטיוטת הבסיס')
    expect(screen.getByLabelText('כמות בגט טוניסאי אותנטי').textContent).toBe('1')
    expect((screen.getByLabelText('שם פריט חופשי 1') as HTMLInputElement).value).toBe('פריט בסיס')

    await user.click(screen.getByRole('button', { name: 'להשתמש במחיר המוצע' }))
    await user.click(screen.getByRole('button', { name: 'שמירת ההזמנה' }))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    const command = JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body)) as { localState: LegacyStore }
    expect(command.localState.orders[0]).toMatchObject({
      name: 'שם BM1',
      group: 'שדה מטיוטת הבסיס',
      notes: 'הערה שנשמרה בטיוטת הבסיס',
      bm1PayloadVersion: 1,
      lunch: { baguette: { q: 1 } },
      custom: [{ name: 'פריט בסיס', qty: 1, price: '1.00', note: 'לשמור' }],
    })
  })

  it('fails closed for a corrupt reviewed draft and returns its recoverable message without saving', async () => {
    const store: LegacyStore = { orders: [] }
    const signature = JSON.stringify(buildAIOrderCatalog(buildOrderEditorMenu(store)).items)
    const review = AIReviewSchema.parse({
      reviewOnly: true,
      draft: {
        customerName: 'אסור להחיל fallback',
        customerPhone: null,
        serviceDate: null,
        serviceTime: null,
        fulfillmentMethod: 'unknown',
        deliveryLocation: null,
        items: [],
        notes: [],
      },
      corrections: [], ambiguities: [], paidExtras: [], unknownItems: [], missingFields: [], warnings: [], overallConfidence: 1,
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    mockedUseStore.mockReturnValue(queryResult({ store }))
    const user = userEvent.setup()
    renderEditor(APP_ROUTES.newOrder, {
      review,
      reviewedDraft: { custom: ['opaque'] },
      reviewedCatalogSignature: signature,
      reviewedRevision: 1,
      reviewedHash: 'a'.repeat(64),
      reviewedTs: 1,
      reviewedStateSignature: JSON.stringify(store),
      reviewedMessage: 'הודעה עם טיוטה פגומה',
    })

    expect(await screen.findByText('לא ניתן לפתוח את פענוח הוואטסאפ בבטחה')).toBeTruthy()
    expect(screen.queryByLabelText('שם מלא')).toBeNull()
    expect(screen.queryByRole('button', { name: 'שמירת ההזמנה' })).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'חזרה לבדיקת הודעת הוואטסאפ' }))
    expect(screen.getByTestId('location').textContent).toBe(
      `${APP_ROUTES.orderImportReview}|${JSON.stringify({ message: 'הודעה עם טיוטה פגומה' })}`,
    )
    expect(fetchSpy).not.toHaveBeenCalled()
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

  it('creates once against the originally loaded version and navigates only after confirmed success', async () => {
    const uuidSpy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('123e4567-e89b-42d3-a456-426614174001')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        idempotent: false,
        revision: 2,
        ts: 2,
        hash: 'b'.repeat(64),
        data: {
          orders: [{
            id: 'order-123e4567-e89b-42d3-a456-426614174001',
            name: 'לקוחה חדשה',
            total: '245.00',
          }],
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    mockedUseStore.mockReturnValue(queryResult())
    const user = userEvent.setup()
    renderEditor()

    await user.type(await screen.findByLabelText('שם מלא'), 'לקוחה חדשה')
    await user.click(screen.getByRole('button', { name: 'להשתמש במחיר המוצע' }))
    const save = screen.getByRole('button', { name: 'שמירת ההזמנה' })
    expect(save.getAttribute('title')).toBeNull()
    expect(save.hasAttribute('disabled')).toBe(false)
    await user.dblClick(save)

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    const [, request] = fetchSpy.mock.calls[0]!
    const command = JSON.parse(String(request?.body)) as {
      baseRevision: number
      baseHash: string
      requestId: string
      baseState: LegacyStore
      localState: LegacyStore
    }
    expect(command.baseRevision).toBe(1)
    expect(command.baseHash).toBe('a'.repeat(64))
    expect(command.requestId).toBe('web-order-save:123e4567-e89b-42d3-a456-426614174000')
    expect(command.baseState).toEqual({ orders: [] })
    expect(command.localState.orders[0]).toMatchObject({
      id: 'order-123e4567-e89b-42d3-a456-426614174001',
      name: 'לקוחה חדשה',
      total: '245.00',
    })
    expect(screen.getByTestId('location').textContent).toBe(`${APP_ROUTES.orders}|null`)
    uuidSpy.mockRestore()
  })

  it('refetches immediately before save and sends no POST when revision, hash, or menu changed', async () => {
    const initialStore: LegacyStore = { orders: [] }
    const newerStore: LegacyStore = {
      orders: [],
      menu: { extras: [{ name: 'פריט שהתעדכן', price: 12 }] },
    }
    const refetch = vi.fn().mockResolvedValue({
      data: {
        revision: 2,
        ts: 2,
        hash: 'b'.repeat(64),
        data: newerStore,
      },
      isError: false,
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    mockedUseStore.mockReturnValue(queryResult({ store: initialStore, refetch }))
    const user = userEvent.setup()
    renderEditor()

    await user.type(await screen.findByLabelText('שם מלא'), 'לקוחה')
    await user.click(screen.getByRole('button', { name: 'להשתמש במחיר המוצע' }))
    await user.click(screen.getByRole('button', { name: 'שמירת ההזמנה' }))

    expect(await screen.findByText(/הנתונים או התפריט השתנו מאז פתיחת הטיוטה/)).toBeTruthy()
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect((screen.getByLabelText('שם מלא') as HTMLInputElement).value).toBe('לקוחה')
  })

  it('edits a valid string ID, preserves unknown fields, and replaces exactly that order', async () => {
    const store: LegacyStore = {
      orders: [
        { id: 'live-1', name: 'לפני', date: '2099-08-20', total: '230.00', futureOrderField: { keep: true } },
        { id: 'live-2', name: 'לא לגעת', date: '2099-08-20', total: '230.00' },
      ],
      futureTopLevel: { keep: true },
    }
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, request) => {
      const command = JSON.parse(String(request?.body)) as { localState: LegacyStore }
      return new Response(JSON.stringify({
        ok: true,
        idempotent: false,
        revision: 2,
        ts: 2,
        hash: 'b'.repeat(64),
        data: command.localState,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    mockedUseStore.mockReturnValue(queryResult({ store }))
    const user = userEvent.setup()
    renderEditor('/orders/live-1/edit')

    const name = await screen.findByLabelText('שם מלא')
    await user.clear(name)
    await user.type(name, 'אחרי')
    await user.click(screen.getByRole('button', { name: 'שמירת השינויים' }))

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    const command = JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body)) as { localState: LegacyStore }
    expect(command.localState.futureTopLevel).toEqual({ keep: true })
    expect(command.localState.orders).toEqual([
      expect.objectContaining({ id: 'live-1', name: 'אחרי', futureOrderField: { keep: true } }),
      { id: 'live-2', name: 'לא לגעת', date: '2099-08-20', total: '230.00' },
    ])
    expect(screen.getByTestId('location').textContent).toBe(`${APP_ROUTES.orders}|null`)
  })

  it('retains the draft on conflict and refuses another submit from the stale screen', async () => {
    const remoteState: LegacyStore = { orders: [{ id: 'live-1', name: 'שינוי ממכשיר אחר' }] }
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        ok: false,
        idempotent: false,
        stage: 'merge',
        conflict: {
          kind: 'merge-conflict',
          conflicts: [{ path: '$.orders[id="live-1"].name' }],
          actualRevision: 2,
          actualHash: 'b'.repeat(64),
          remoteState,
        },
      }), { status: 409, headers: { 'Content-Type': 'application/json' } }),
    )
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [{ id: 'live-1', name: 'לפני', total: '230.00' }] } }))
    const user = userEvent.setup()
    renderEditor('/orders/live-1/edit')
    const name = await screen.findByLabelText('שם מלא')
    await user.clear(name)
    await user.type(name, 'הטיוטה שלי')
    const save = screen.getByRole('button', { name: 'שמירת השינויים' })
    await user.click(save)

    expect(await screen.findByText(/נמצאה התנגשות עם שינוי אחר/)).toBeTruthy()
    expect((screen.getByLabelText('שם מלא') as HTMLInputElement).value).toBe('הטיוטה שלי')
    expect(save.hasAttribute('disabled')).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('location').textContent).toContain('/orders/live-1/edit')
  })

  it('reuses an unknown command exactly, then keeps the collision-safe order ID when an edit needs a new request', async () => {
    const uuidSpy = vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('123e4567-e89b-42d3-a456-426614174001')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('network'))
      .mockRejectedValueOnce(new TypeError('network'))
      .mockRejectedValueOnce(new TypeError('network'))
    mockedCreateVersionedRequestId
      .mockReturnValueOnce('web-order-create:123e4567-e89b-42d3-a456-426614174010')
      .mockReturnValueOnce('web-order-create:123e4567-e89b-42d3-a456-426614174011')
    mockedUseStore.mockReturnValue(queryResult())
    const user = userEvent.setup()
    renderEditor()
    const name = await screen.findByLabelText('שם מלא')
    await user.type(name, 'לקוחה')
    await user.click(screen.getByRole('button', { name: 'להשתמש במחיר המוצע' }))
    const save = screen.getByRole('button', { name: 'שמירת ההזמנה' })

    await user.click(save)
    expect(await screen.findByText(/לא התקבל אישור שמירה מהשרת/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'בדיקת ניסיון השמירה מחדש' }))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2))
    const firstCommand = String(fetchSpy.mock.calls[0]![1]?.body)
    const retryCommand = String(fetchSpy.mock.calls[1]![1]?.body)
    expect(retryCommand).toBe(firstCommand)

    await user.type(name, ' נוספת')
    await user.click(screen.getByRole('button', { name: 'שמירת ההזמנה' }))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3))
    const changedCommand = JSON.parse(String(fetchSpy.mock.calls[2]![1]?.body)) as {
      requestId: string
      localState: LegacyStore
    }
    expect(changedCommand.requestId).toBe('web-order-create:123e4567-e89b-42d3-a456-426614174011')
    expect(changedCommand.localState.orders[0]?.name).toBe('לקוחה נוספת')
    expect(changedCommand.localState.orders[0]?.id).toBe('order-123e4567-e89b-42d3-a456-426614174001')
    expect(uuidSpy).toHaveBeenCalledTimes(1)
    uuidSpy.mockRestore()
  })

  it('replays an applied command before preflight when the first response is lost', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('123e4567-e89b-42d3-a456-426614174001')
    const initialEnvelope = {
      revision: 1,
      ts: 1,
      hash: 'a'.repeat(64),
      data: { orders: [] } satisfies LegacyStore,
    }
    let appliedState: LegacyStore | null = null
    let appliedOrderCount = 0
    const refetch = vi.fn().mockImplementation(async () => {
      if (refetch.mock.calls.length === 1) return { data: initialEnvelope, isError: false }
      return {
        data: {
          revision: 2,
          ts: 2,
          hash: 'b'.repeat(64),
          data: appliedState ?? { orders: [] },
        },
        isError: false,
      }
    })
    const requestBodies: string[] = []
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, request) => {
      const body = String(request?.body)
      requestBodies.push(body)
      const command = JSON.parse(body) as { localState: LegacyStore }
      appliedState = command.localState
      appliedOrderCount = command.localState.orders.length
      if (requestBodies.length === 1) throw new TypeError('response lost after apply')
      return new Response(JSON.stringify({
        ok: true,
        idempotent: true,
        revision: 2,
        ts: 2,
        hash: 'b'.repeat(64),
        data: appliedState,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    mockedUseStore.mockReturnValue(queryResult({ refetch }))
    const user = userEvent.setup()
    renderEditor()

    await user.type(await screen.findByLabelText('שם מלא'), 'לקוחה')
    await user.click(screen.getByRole('button', { name: 'להשתמש במחיר המוצע' }))
    await user.click(screen.getByRole('button', { name: 'שמירת ההזמנה' }))
    expect(await screen.findByText(/לא התקבל אישור שמירה מהשרת/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'בדיקת ניסיון השמירה מחדש' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(`${APP_ROUTES.orders}|null`))
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(requestBodies[1]).toBe(requestBodies[0])
    expect(appliedState).not.toBeNull()
    expect(appliedOrderCount).toBe(1)
  })

  it('shows a clear fail-closed state for numeric or malformed IDs and sends no save', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [{ id: 7, name: 'מספרי' }] } }))
    renderEditor('/orders/7/edit')

    expect(await screen.findByText('מזהה הזמנה שנטען אינו תקין')).toBeTruthy()
    expect(screen.queryByLabelText('שם מלא')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
    cleanup()

    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [{ id: 'bad id', name: 'פגום' }] } }))
    renderEditor('/orders/bad%20id/edit')
    expect(await screen.findByText('מזהה הזמנה שנטען אינו תקין')).toBeTruthy()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refuses to open an edit draft that would drop an opaque legacy collection value', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    mockedUseStore.mockReturnValue(queryResult({
      store: { orders: [{ id: 'legacy-opaque', name: 'לקוחה', total: '230.00', custom: ['opaque'] }] },
    }))
    renderEditor('/orders/legacy-opaque/edit')

    expect(await screen.findByText('ההזמנה כוללת נתון ישן שלא ניתן לערוך בבטחה')).toBeTruthy()
    expect(screen.queryByLabelText('שם מלא')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('OrderEditorScreen delivery proof section', () => {
  const dubaiTimestamp = (value: number) =>
    new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Dubai' })
      .format(new Date(value))

  it('renders the read-only proof of a delivered order without exposing an editable field', async () => {
    const order = {
      id: 'proof-1',
      date: '2099-08-20',
      name: 'לקוחה עם אישור',
      deliveryProofUrl: 'https://pub-abc123.r2.dev/proof.jpg',
      deliveryProofAt: 1_760_000_000_000,
      deliveryProofBy: 'שליח ראשי',
      deliveredAt: 1_760_000_100_000,
      courierCheckinState: 'delayed' as const,
      courierCheckinAt: 1_759_999_000_000,
      courierEtaMinutes: 20,
      courierNote: 'תנועה כבדה',
    }
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [order] } }))
    renderEditor('/orders/proof-1/edit')

    await waitFor(() => expect(screen.getByRole('heading', { name: 'אישור מסירה' })).toBeTruthy())
    const section = document.getElementById('order-proof')!
    const photo = screen.getByAltText('צילום מסירה')
    expect(photo.getAttribute('src')).toBe('https://pub-abc123.r2.dev/proof.jpg')
    const photoLink = photo.closest('a')!
    expect(photoLink.getAttribute('href')).toBe('https://pub-abc123.r2.dev/proof.jpg')
    expect(photoLink.getAttribute('target')).toBe('_blank')
    expect(photoLink.getAttribute('rel')).toBe('noopener noreferrer')
    expect(within(section).getByText(dubaiTimestamp(1_760_000_100_000))).toBeTruthy()
    expect(within(section).getByText(dubaiTimestamp(1_760_000_000_000))).toBeTruthy()
    expect(within(section).getByText('שליח ראשי')).toBeTruthy()
    expect(within(section).getByText(`מתעכב · 20 דק׳ · ${dubaiTimestamp(1_759_999_000_000)}`)).toBeTruthy()
    expect(within(section).getByText('תנועה כבדה')).toBeTruthy()
    expect(section.querySelector('input, textarea, select')).toBeNull()
    expect(screen.getByRole('button', { name: 'אישור מסירה' })).toBeTruthy()
  })

  it('refuses an untrusted proof URL but still reports the rest of the confirmation', async () => {
    mockedUseStore.mockReturnValue(queryResult({
      store: {
        orders: [{
          id: 'proof-2',
          date: '2099-08-20',
          name: 'לקוחה',
          deliveryProofUrl: 'http://pub-abc123.r2.dev/proof.jpg',
          deliveredAt: 1_760_000_100_000,
        }],
      },
    }))
    renderEditor('/orders/proof-2/edit')

    await waitFor(() => expect(screen.getByRole('heading', { name: 'אישור מסירה' })).toBeTruthy())
    expect(screen.queryByAltText('צילום מסירה')).toBeNull()
    expect(within(document.getElementById('order-proof')!).getByText(dubaiTimestamp(1_760_000_100_000))).toBeTruthy()
  })

  it('says there is no confirmation yet for an order without delivery fields and for a new order', async () => {
    mockedUseStore.mockReturnValue(queryResult({
      store: { orders: [{ id: 'plain-1', date: '2099-08-20', name: 'לקוחה רגילה' }] },
    }))
    const edit = renderEditor('/orders/plain-1/edit')
    await waitFor(() => expect(screen.getByText('אין עדיין אישור מסירה')).toBeTruthy())
    expect(screen.queryByAltText('צילום מסירה')).toBeNull()
    edit.unmount()

    mockedUseStore.mockReturnValue(queryResult())
    renderEditor()
    await waitFor(() => expect(screen.getByText('אין עדיין אישור מסירה')).toBeTruthy())
  })

  it('saves the hotplate through its own write, touching nothing else on the order', async () => {
    const order = {
      id: 'plata-1',
      date: '2099-08-14',
      name: 'רותי',
      place: 'Atlantis',
      meals: 1,
      total: '245.00',
      meyToken: 'mey-token',
    }
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, request) => {
      const command = JSON.parse(String(request?.body)) as { localState: LegacyStore }
      return new Response(JSON.stringify({
        ok: true,
        idempotent: false,
        revision: 2,
        ts: 2,
        hash: 'b'.repeat(64),
        data: command.localState,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [order] } }))
    const user = userEvent.setup()
    renderEditor('/orders/plata-1/edit')

    const saveButton = await screen.findByRole('button', { name: 'שמירת הפלטה' })
    expect(saveButton.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('אין פלטה בהזמנה הזאת.')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'הוספה לפלטות' }))
    await user.type(screen.getByLabelText('פיקדון פלטה'), '50')
    await user.selectOptions(screen.getByLabelText('מצב הפלטה'), 'awaitingPickup')
    await user.type(screen.getByLabelText('איפה הפלטה מחכה'), 'בקבלה')
    await user.click(screen.getByRole('button', { name: 'שמירת הפלטה' }))

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    const command = JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body)) as { localState: LegacyStore }
    expect(command.localState.orders).toHaveLength(1)
    expect(command.localState.orders[0]).toEqual({
      ...order,
      plataCount: 1,
      plataDeposit: '50.00',
      plataStatus: 'awaitingPickup',
      plataPickupNote: 'בקבלה',
    })
    expect(await screen.findByText('פרטי הפלטה נשמרו.')).toBeTruthy()
  })

  it('opens on the stored hotplate and blocks a save with an unreadable deposit', async () => {
    const order = {
      id: 'plata-2',
      date: '2099-08-14',
      name: 'קטי',
      place: 'Hilton',
      meals: 1,
      plataCount: 2,
      plataDeposit: '80.00',
      plataStatus: 'collected',
      plataPickupNote: 'בקבלה',
      plataCollectedAt: 1_760_000_000_000,
    }
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [order] } }))
    const user = userEvent.setup()
    renderEditor('/orders/plata-2/edit')

    await waitFor(() => expect(screen.getByLabelText('כמות פלטות').textContent).toBe('2'))
    expect((screen.getByLabelText('פיקדון פלטה') as HTMLInputElement).value).toBe('80.00')
    expect((screen.getByLabelText('מצב הפלטה') as HTMLSelectElement).value).toBe('collected')
    expect((screen.getByLabelText('איפה הפלטה מחכה') as HTMLInputElement).value).toBe('בקבלה')
    expect(screen.getByText('נאספה')).toBeTruthy()

    await user.clear(screen.getByLabelText('פיקדון פלטה'))
    await user.type(screen.getByLabelText('פיקדון פלטה'), 'שמונים')

    expect(screen.getByRole('button', { name: 'שמירת הפלטה' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('הפיקדון חייב להיות סכום תקין. לא נשמר שינוי.')).toBeTruthy()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('offers no hotplate form until the order exists', async () => {
    mockedUseStore.mockReturnValue(queryResult())
    renderEditor()

    await waitFor(() => expect(screen.getByText('אפשר לרשום פלטה אחרי ששומרים את ההזמנה.')).toBeTruthy())
    expect(screen.queryByLabelText('פיקדון פלטה')).toBeNull()
  })
})
