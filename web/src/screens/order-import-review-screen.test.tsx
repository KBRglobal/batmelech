// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_ROUTES } from '../app/routes.ts'
import { useStore } from '../data/use-store.ts'
import {
  buildOrderEditorMenu,
  createOrderDraft,
  type AIReview,
} from '../domain/order-editor.ts'
import type { LegacyStore } from '../domain/store.ts'
import { OrderImportReviewScreen } from './order-import-review-screen.tsx'

vi.mock('../data/use-store.ts', () => ({ useStore: vi.fn() }))

const mockedUseStore = vi.mocked(useStore)

function versionedEnvelope(store: LegacyStore = { orders: [] }, revision = 1) {
  return {
    revision,
    ts: revision,
    hash: (revision === 1 ? 'a' : 'b').repeat(64),
    data: store,
  }
}

function queryResult(options: {
  readonly pending?: boolean
  readonly error?: boolean
  readonly store?: LegacyStore
  readonly refetch?: ReturnType<typeof vi.fn>
} = {}): ReturnType<typeof useStore> {
  const data = options.pending || options.error
    ? undefined
    : versionedEnvelope(options.store)
  return {
    isPending: options.pending === true,
    isError: options.error === true,
    data,
    refetch: options.refetch ?? vi.fn().mockResolvedValue({ data }),
  } as unknown as ReturnType<typeof useStore>
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}|${JSON.stringify(location.state)}`}</output>
}

function renderReview(message = '', extraState: Record<string, unknown> = {}) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: APP_ROUTES.orderImportReview, state: { message, ...extraState } }]}>
      <Routes>
        <Route path={APP_ROUTES.orderImportReview} element={<><OrderImportReviewScreen /><LocationProbe /></>} />
        <Route path={APP_ROUTES.newOrder} element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

function bm1Message(payload: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `הזמנה מהטופס\n#BM1#${btoa(binary)}#`
}

function publicPayload(patch: Record<string, unknown> = {}) {
  return {
    date: '2026-08-14',
    name: 'לקוחה מובנית',
    phone: '050-1111111',
    place: 'מלון בדובאי',
    address: 'Lobby',
    time: '14:00',
    pickup: false,
    meals: 1,
    challot: 2,
    salads: { 'כרוב לבן קלאסי': 1 },
    firsts: { 'פילה דג ברוטב מרוקאי': 1 },
    heat: 'לא חריף',
    mains: { 'קציצות בשר ברוטב אדום עשיר': 1 },
    sides: { 'אורז לבן': 1 },
    desserts: { 'סופלה שוקולד': 2 },
    extras: { 'תוספת יין': { q: 1, note: '' }, 'משלוח': { q: 1, note: '' } },
    notes: 'בלי בצל',
    ...patch,
  }
}

function completeReview(): AIReview {
  return {
    reviewOnly: true,
    draft: {
      customerName: 'לקוחה מההודעה',
      customerPhone: '050-2222222',
      serviceDate: '2026-08-14',
      serviceTime: '14:00',
      fulfillmentMethod: 'delivery',
      deliveryLocation: 'Address Downtown',
      items: [
        {
          catalogItemId: 'meal:couple',
          catalogItemName: 'ארוחה זוגית',
          category: 'couple_meal',
          quantity: 2,
          sourceText: '2 זוגיות',
          confidence: 0.96,
        },
        {
          catalogItemId: 'extra:0',
          catalogItemName: 'תוספת יין',
          category: 'extra',
          quantity: 1,
          sourceText: 'יין אחד',
          confidence: 0.9,
        },
      ],
      notes: ['ללא חריף'],
    },
    corrections: [
      { originalText: 'לא מרוקאי', correctedText: 'בעצם חריימה', reason: 'הלקוחה תיקנה את עצמה.' },
    ],
    ambiguities: [
      { sourceText: 'קצת סלטים', question: 'כמה סלטים?', candidateCatalogItemIds: [] },
    ],
    paidExtras: [
      {
        catalogItemId: 'extra:0',
        catalogItemName: 'תוספת יין',
        quantity: 1,
        catalogPrice: 5,
        currency: 'USD',
        sourceText: 'יין אחד',
        reason: 'זו תוספת בתשלום.',
        confidence: 0.9,
      },
    ],
    unknownItems: [
      { sourceText: 'סלט הפתעה', requestedQuantity: null, reason: 'לא נמצא בתפריט.' },
    ],
    missingFields: [
      { field: 'item_quantity', sourceText: 'קצת סלטים', reason: 'חסרה כמות סלטים.' },
    ],
    warnings: [
      { code: 'paid_extra', severity: 'warning', message: 'הלקוחה אולי לא יודעת שהיין בתשלום.' },
    ],
    overallConfidence: 0.91,
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeEach(() => {
  mockedUseStore.mockReset()
})

describe('OrderImportReviewScreen', () => {
  it('renders store loading and retryable error states without calling the AI endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    mockedUseStore.mockReturnValue(queryResult({ pending: true }))
    const first = renderReview('הודעה')
    expect(first.container.querySelector('[data-state="loading"]')).toBeTruthy()
    first.unmount()

    const refetch = vi.fn()
    mockedUseStore.mockReturnValue(queryResult({ error: true, refetch }))
    const user = userEvent.setup()
    renderReview('הודעה')
    await user.click(screen.getByRole('button', { name: 'ניסיון נוסף' }))
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('keeps the fixed review footer above mobile navigation and resets it on desktop', async () => {
    mockedUseStore.mockReturnValue(queryResult())
    renderReview('הודעת בדיקה')

    const footer = screen.getByRole('button', { name: 'החלה על טיוטה בזיכרון' }).closest('footer')
    expect(footer).toBeTruthy()
    expect(footer?.className).toContain('bottom-[calc(5rem+env(safe-area-inset-bottom))]')
    expect(footer?.className).toContain('md:bottom-0')
  })

  it('requires a real message before it performs the review request', async () => {
    mockedUseStore.mockReturnValue(queryResult())
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const user = userEvent.setup()
    renderReview()

    await user.click(screen.getByRole('button', { name: 'פענוח ההזמנה' }))

    expect(screen.getByRole('alert').textContent).toContain('הדביקי קודם')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('posts the message and current real menu catalog to the existing review-only endpoint', async () => {
    mockedUseStore.mockReturnValue(queryResult({
      store: {
        orders: [],
        menu: {
          salads: ['סלט אמיתי'],
          extras: [{ name: 'תוספת יין', price: 5 }],
        },
      },
    }))
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ review: completeReview() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const user = userEvent.setup()
    renderReview('2 זוגיות ויין אחד')

    await user.click(screen.getByRole('button', { name: 'פענוח ההזמנה' }))

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    const [url, request] = fetchSpy.mock.calls[0]!
    expect(url).toBe('/api/ai/order-intake/')
    expect(request).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store' })
    const body = JSON.parse(String(request?.body)) as { message: string; catalog: { name: string; price: number | null }[] }
    expect(body.message).toBe('2 זוגיות ויין אחד')
    expect(body.catalog).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'סלט אמיתי' }),
      expect.objectContaining({ name: 'תוספת יין', price: 5 }),
    ]))
  })

  it('shows corrections, uncertainties, unknowns, and paid extras before enabling explicit application', async () => {
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [], menu: { extras: [{ name: 'תוספת יין', price: 5 }] } } }))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ review: completeReview() }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    const user = userEvent.setup()
    renderReview('2 זוגיות ויין אחד')
    const apply = screen.getByRole('button', { name: 'החלה על טיוטה בזיכרון' })
    expect(apply.hasAttribute('disabled')).toBe(true)

    await user.click(screen.getByRole('button', { name: 'פענוח ההזמנה' }))

    expect(await screen.findByText('תוספות בתשלום שזוהו')).toBeTruthy()
    expect(screen.getByText(/תוספת יין ×1/)).toBeTruthy()
    expect(screen.getByText('תיקונים שזוהו')).toBeTruthy()
    expect(screen.getByText('מה צריך לברר עם הלקוח')).toBeTruthy()
    expect(screen.getByText('דברים שלא נמצאו בתפריט')).toBeTruthy()
    expect(screen.getByText('אזהרות נוספות')).toBeTruthy()
    expect(apply.hasAttribute('disabled')).toBe(false)
    expect(screen.queryByText('הטיוטה שהוחלה בזיכרון בלבד')).toBeNull()
  })

  it('applies only to an in-memory draft, then transfers the reviewed result to the editor route', async () => {
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [], menu: { extras: [{ name: 'תוספת יין', price: 5 }] } } }))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ review: completeReview() }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    const user = userEvent.setup()
    renderReview('2 זוגיות ויין אחד')
    await user.click(screen.getByRole('button', { name: 'פענוח ההזמנה' }))
    await user.click(await screen.findByRole('button', { name: 'החלה על טיוטה בזיכרון' }))

    const preview = screen.getByText('הטיוטה שהוחלה בזיכרון בלבד').closest('section')!
    expect(within(preview).getByText('לקוחה מההודעה')).toBeTruthy()
    expect(within(preview).getByText('ארוחות זוגיות: 2')).toBeTruthy()
    expect(within(preview).getByText('חלות: 4')).toBeTruthy()
    expect(within(preview).getByText('תוספת יין ×1')).toBeTruthy()
    expect(screen.getByText('שום דבר לא נשמר במסד הנתונים')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'מעבר לטופס והשלמה ידנית' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain(`${APP_ROUTES.newOrder}|`))
    expect(screen.getByTestId('location').textContent).toContain('"reviewOnly":true')
    expect(screen.getByTestId('location').textContent).toContain('"reviewedHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"')
    expect(screen.getByTestId('location').textContent).toContain('"challot":4')
  })

  it('rejects application when the state revision or catalog changes after the AI response', async () => {
    const initialStore: LegacyStore = {
      orders: [],
      menu: { extras: [{ name: 'תוספת יין', price: 5 }] },
    }
    mockedUseStore.mockReturnValue(queryResult({ store: initialStore }))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ review: completeReview() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const user = userEvent.setup()
    const rendered = renderReview('2 זוגיות ויין אחד')
    await user.click(screen.getByRole('button', { name: 'פענוח ההזמנה' }))
    expect(await screen.findByRole('button', { name: 'החלה על טיוטה בזיכרון' })).toBeTruthy()

    mockedUseStore.mockReturnValue({
      ...queryResult({
        store: {
          orders: [],
          menu: { extras: [{ name: 'פריט אחר', price: 5 }] },
        },
      }),
      data: {
        revision: 2,
        ts: 2,
        hash: 'b'.repeat(64),
        data: {
          orders: [],
          menu: { extras: [{ name: 'פריט אחר', price: 5 }] },
        },
      },
    } as ReturnType<typeof useStore>)
    rendered.rerender(
      <MemoryRouter initialEntries={[APP_ROUTES.orderImportReview]}>
        <Routes>
          <Route path={APP_ROUTES.orderImportReview} element={<><OrderImportReviewScreen /><LocationProbe /></>} />
          <Route path={APP_ROUTES.newOrder} element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: 'החלה על טיוטה בזיכרון' }))

    expect((await screen.findByRole('alert')).textContent).toContain('הנתונים או התפריט השתנו')
    expect(screen.queryByText('הטיוטה שהוחלה בזיכרון בלבד')).toBeNull()
  })

  it('refetches before application and rejects unseen cross-tab drift with no in-memory application', async () => {
    const initialStore: LegacyStore = {
      orders: [],
      menu: { extras: [{ name: 'תוספת יין', price: 5 }] },
    }
    const changedStore: LegacyStore = {
      orders: [{ id: 'remote-order', name: 'Remote customer' }],
      menu: { extras: [{ name: 'תוספת יין', price: 5 }] },
    }
    const refetch = vi.fn()
      .mockResolvedValueOnce({ data: versionedEnvelope(initialStore) })
      .mockResolvedValueOnce({ data: versionedEnvelope(changedStore, 2) })
    mockedUseStore.mockReturnValue(queryResult({ store: initialStore, refetch }))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ review: completeReview() }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    const user = userEvent.setup()
    renderReview('2 זוגיות ויין אחד')

    await user.click(screen.getByRole('button', { name: 'פענוח ההזמנה' }))
    await user.click(await screen.findByRole('button', { name: 'החלה על טיוטה בזיכרון' }))

    expect(refetch).toHaveBeenCalledTimes(2)
    expect((await screen.findByRole('alert')).textContent).toContain('הנתונים או התפריט השתנו')
    expect(screen.queryByText('הטיוטה שהוחלה בזיכרון בלבד')).toBeNull()
  })

  it('refetches again before editor handoff and rejects state drift after a valid in-memory application', async () => {
    const initialStore: LegacyStore = {
      orders: [],
      menu: { extras: [{ name: 'תוספת יין', price: 5 }] },
    }
    const changedStore: LegacyStore = {
      orders: [{ id: 'remote-order', name: 'Remote customer' }],
      menu: { extras: [{ name: 'תוספת יין', price: 5 }] },
    }
    const refetch = vi.fn()
      .mockResolvedValueOnce({ data: versionedEnvelope(initialStore) })
      .mockResolvedValueOnce({ data: versionedEnvelope(initialStore) })
      .mockResolvedValueOnce({ data: versionedEnvelope(changedStore, 2) })
    mockedUseStore.mockReturnValue(queryResult({ store: initialStore, refetch }))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ review: completeReview() }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    const user = userEvent.setup()
    renderReview('2 זוגיות ויין אחד')

    await user.click(screen.getByRole('button', { name: 'פענוח ההזמנה' }))
    await user.click(await screen.findByRole('button', { name: 'החלה על טיוטה בזיכרון' }))
    expect(await screen.findByText('הטיוטה שהוחלה בזיכרון בלבד')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'מעבר לטופס והשלמה ידנית' }))

    expect(refetch).toHaveBeenCalledTimes(3)
    expect((await screen.findByRole('alert')).textContent).toContain('הנתונים או התפריט השתנו')
    expect(screen.getByTestId('location').textContent).toContain(APP_ROUTES.orderImportReview)
  })

  it('decodes exact public BM1 quantities locally and transfers the reviewed draft without calling AI', async () => {
    mockedUseStore.mockReturnValue(queryResult())
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const user = userEvent.setup()
    renderReview(bm1Message(publicPayload()))

    await user.click(screen.getByRole('button', { name: 'פענוח ההזמנה' }))

    expect(await screen.findByText('הכמויות נקראו ישירות מקוד ההזמנה המובנה ולא הוסקו מטקסט חופשי.')).toBeTruthy()
    expect(screen.getByText(/כרוב לבן קלאסי — 1/)).toBeTruthy()
    expect(screen.getByText(/סופלה שוקולד — 2/)).toBeTruthy()
    expect(fetchSpy).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'החלה על טיוטה בזיכרון' }))
    const preview = await screen.findByText('הטיוטה שהוחלה בזיכרון בלבד')
    expect(within(preview.closest('section')!).getByText('כרוב לבן קלאסי ×1')).toBeTruthy()
    expect(within(preview.closest('section')!).getByText('סופלה שוקולד ×2')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'מעבר לטופס והשלמה ידנית' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain(APP_ROUTES.newOrder))
    expect(screen.getByTestId('location').textContent).toContain('"reviewedDraft"')
    expect(screen.getByTestId('location').textContent).toContain('"ordered":1')
    expect(screen.getByTestId('location').textContent).not.toContain('"משלוח":{"quantity"')
  })

  it('fails closed on malformed or unknown BM1 items instead of dropping a selection', async () => {
    mockedUseStore.mockReturnValue(queryResult())
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const user = userEvent.setup()
    renderReview(bm1Message(publicPayload({ mains: { 'מנה שלא קיימת': 1 } })))

    await user.click(screen.getByRole('button', { name: 'פענוח ההזמנה' }))

    expect((await screen.findByRole('alert')).textContent).toContain('פריט שאינו קיים בתפריט')
    expect(screen.getByRole('button', { name: 'החלה על טיוטה בזיכרון' }).hasAttribute('disabled')).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('starts standalone AI intake from zero couples and preserves explicit fish surcharge intent', async () => {
    mockedUseStore.mockReturnValue(queryResult())
    const standalone = completeReview()
    standalone.draft.items = [{
      catalogItemId: 'first:0',
      catalogItemName: 'פילה דג ברוטב מרוקאי',
      category: 'first',
      quantity: 1,
      sourceText: 'דג מרוקאי אחד בלי זוגית',
      confidence: 1,
    }]
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ review: standalone }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    const user = userEvent.setup()
    renderReview('דג מרוקאי אחד בלי זוגית')

    await user.click(screen.getByRole('button', { name: 'פענוח ההזמנה' }))
    await user.click(await screen.findByRole('button', { name: 'החלה על טיוטה בזיכרון' }))

    const preview = screen.getByText('הטיוטה שהוחלה בזיכרון בלבד').closest('section')!
    expect(within(preview).getByText('ארוחות זוגיות: 0')).toBeTruthy()
    expect(within(preview).getByText('פילה דג ברוטב מרוקאי ×1')).toBeTruthy()
  })

  it('preserves a validated manual base draft through review and editor handoff', async () => {
    const menu = buildOrderEditorMenu({ orders: [] })
    const baseDraft = {
      ...createOrderDraft(menu),
      name: 'שם שכבר הוקלד',
      address: 'הוראות קבלה ידניות',
      notes: 'הערה ידנית',
    }
    const review = completeReview()
    review.draft.customerName = null
    review.draft.customerPhone = null
    review.draft.deliveryLocation = null
    review.draft.items = []
    review.draft.notes = []
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ review }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    mockedUseStore.mockReturnValue(queryResult())
    const user = userEvent.setup()
    renderReview('רק תבדקי את הטקסט', { baseDraft })

    await user.click(screen.getByRole('button', { name: 'פענוח ההזמנה' }))
    await user.click(await screen.findByRole('button', { name: 'החלה על טיוטה בזיכרון' }))
    const preview = screen.getByText('הטיוטה שהוחלה בזיכרון בלבד').closest('section')!
    expect(within(preview).getByText('שם שכבר הוקלד')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'מעבר לטופס והשלמה ידנית' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain(APP_ROUTES.newOrder))
    expect(screen.getByTestId('location').textContent).toContain('הוראות קבלה ידניות')
    expect(screen.getByTestId('location').textContent).toContain('הערה ידנית')
  })

  it('rejects malformed or failed provider responses without rendering or applying a draft', async () => {
    mockedUseStore.mockReturnValue(queryResult())
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ review: { reviewOnly: false } }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    const user = userEvent.setup()
    renderReview('הודעה אמיתית')
    await user.click(screen.getByRole('button', { name: 'פענוח ההזמנה' }))

    expect((await screen.findByRole('alert')).textContent).toContain('ההזמנה לא שונתה')
    expect(screen.getByRole('button', { name: 'החלה על טיוטה בזיכרון' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByText('הטיוטה שהוחלה בזיכרון בלבד')).toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
