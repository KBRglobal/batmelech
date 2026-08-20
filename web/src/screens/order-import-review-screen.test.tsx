// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
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

function currentHandoff(): Record<string, unknown> {
  const value = screen.getByTestId('location').textContent ?? ''
  const separator = value.indexOf('|')
  return JSON.parse(value.slice(separator + 1)) as Record<string, unknown>
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
    lunch: {},
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
      { originalText: 'שתי זוגיות', correctedText: 'בעצם 2 זוגיות', reason: 'הלקוחה תיקנה את עצמה.' },
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

  it('requires a message before requesting AI or changing route', async () => {
    mockedUseStore.mockReturnValue(queryResult())
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const user = userEvent.setup()
    renderReview()

    expect(screen.getByRole('heading', { name: 'בניית הזמנה מהודעת וואטסאפ' })).toBeTruthy()
    expect(screen.getAllByText(/שום דבר לא נשמר עד שמירה בטופס/)).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'בניית טופס ההזמנה' }))

    expect(screen.getByRole('alert').textContent).toContain('הדביקי את הודעת הלקוח')
    expect(screen.getByTestId('location').textContent).toContain(APP_ROUTES.orderImportReview)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('automatically hands a successful AI review to the order editor after an exact fresh-state check', async () => {
    const store: LegacyStore = {
      orders: [],
      menu: { extras: [{ name: 'תוספת יין', price: 5 }] },
    }
    const envelope = versionedEnvelope(store)
    const events: string[] = []
    const refetch = vi.fn(async () => {
      events.push('state')
      return { data: envelope }
    })
    mockedUseStore.mockReturnValue(queryResult({ store, refetch }))
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, request) => {
      events.push('ai')
      expect(url).toBe('/api/ai/order-intake/')
      expect(request).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store' })
      return new Response(JSON.stringify({ review: completeReview() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const user = userEvent.setup()
    renderReview('שתי זוגיות, בעצם 2 זוגיות, יין אחד וקצת סלטים')

    expect(screen.queryByRole('button', { name: 'החלה על טיוטה בזיכרון' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'מעבר לטופס והשלמה ידנית' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'בניית טופס ההזמנה' }))

    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain(`${APP_ROUTES.newOrder}|`))
    expect(events).toEqual(['state', 'ai', 'state'])
    expect(refetch).toHaveBeenCalledTimes(2)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls.some(([url, request]) => url === '/api/state' && request?.method === 'POST')).toBe(false)

    const handoff = currentHandoff()
    const draft = handoff.reviewedDraft as Record<string, unknown>
    const review = handoff.review as AIReview
    expect(draft.meals).toBe(2)
    expect(draft.challot).toBe(4)
    expect(draft.name).toBe('לקוחה מההודעה')
    expect(draft.extras).toEqual(expect.objectContaining({
      'תוספת יין': { quantity: 1, note: '' },
    }))
    expect(review.corrections).toHaveLength(1)
    expect(review.ambiguities).toHaveLength(1)
    expect(review.unknownItems).toHaveLength(1)
    expect(review.missingFields).toHaveLength(1)
    expect(review.paidExtras).toHaveLength(1)
    expect(handoff.reviewedRevision).toBe(1)
    expect(handoff.reviewedHash).toBe('a'.repeat(64))
    expect(handoff.reviewedTs).toBe(1)
    expect(handoff.reviewedStateSignature).toBe(JSON.stringify(store))
    expect(handoff.reviewedMessage).toBe('שתי זוגיות, בעצם 2 זוגיות, יין אחד וקצת סלטים')
    expect(typeof handoff.reviewedCatalogSignature).toBe('string')
    expect(refetch).toHaveBeenNthCalledWith(1, { throwOnError: true })
    expect(refetch).toHaveBeenNthCalledWith(2, { throwOnError: true })
  })

  it('uses a zero-couple baseline for standalone self-corrected AI intake', async () => {
    const review = completeReview()
    review.draft.items = [{
      catalogItemId: 'meal:couple',
      catalogItemName: 'ארוחה זוגית',
      category: 'couple_meal',
      quantity: 3,
      sourceText: 'בעצם שלוש זוגיות',
      confidence: 1,
    }]
    review.draft.customerName = null
    review.draft.customerPhone = null
    review.draft.deliveryLocation = null
    review.draft.notes = []
    review.corrections = [{
      originalText: 'זוגית אחת',
      correctedText: 'בעצם שלוש זוגיות',
      reason: 'התיקון האחרון גובר.',
    }]
    mockedUseStore.mockReturnValue(queryResult())
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ review }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const user = userEvent.setup()
    renderReview('זוגית אחת, בעצם שלוש זוגיות')

    await user.click(screen.getByRole('button', { name: 'בניית טופס ההזמנה' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain(APP_ROUTES.newOrder))

    const draft = currentHandoff().reviewedDraft as Record<string, unknown>
    expect(draft.meals).toBe(3)
    expect(draft.challot).toBe(6)
  })

  it('preserves an explicitly supplied validated base draft during automatic handoff', async () => {
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
    mockedUseStore.mockReturnValue(queryResult())
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ review }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const user = userEvent.setup()
    renderReview('רק תבדקי את הטקסט', { baseDraft })

    await user.click(screen.getByRole('button', { name: 'בניית טופס ההזמנה' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain(APP_ROUTES.newOrder))

    const draft = currentHandoff().reviewedDraft as Record<string, unknown>
    expect(draft.name).toBe('שם שכבר הוקלד')
    expect(draft.address).toBe('הוראות קבלה ידניות')
    expect(draft.notes).toBe('הערה ידנית')
  })

  it('blocks automatic handoff when exact state or catalog data changes during AI review', async () => {
    const initialStore: LegacyStore = {
      orders: [],
      menu: { extras: [{ name: 'תוספת יין', price: 5 }] },
    }
    const changedStore: LegacyStore = {
      orders: [],
      menu: { extras: [{ name: 'פריט אחר', price: 5 }] },
    }
    const initialEnvelope = versionedEnvelope(initialStore)
    const changedEnvelope = { ...initialEnvelope, data: changedStore }
    const refetch = vi.fn()
      .mockResolvedValueOnce({ data: initialEnvelope })
      .mockResolvedValueOnce({ data: changedEnvelope })
    mockedUseStore.mockReturnValue(queryResult({ store: initialStore, refetch }))
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ review: completeReview() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const user = userEvent.setup()
    renderReview('2 זוגיות ויין אחד')

    await user.click(screen.getByRole('button', { name: 'בניית טופס ההזמנה' }))

    expect((await screen.findByRole('alert')).textContent).toContain('הנתונים או התפריט השתנו')
    expect(screen.getByTestId('location').textContent).toContain(APP_ROUTES.orderImportReview)
    expect(refetch).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls.some(([url, request]) => url === '/api/state' && request?.method === 'POST')).toBe(false)
  })

  it('blocks stale cached state when the post-review background refetch reports an error', async () => {
    const store: LegacyStore = {
      orders: [],
      menu: { extras: [{ name: 'תוספת יין', price: 5 }] },
    }
    const envelope = versionedEnvelope(store)
    const refetch = vi.fn()
      .mockResolvedValueOnce({
        data: envelope,
        error: null,
        isError: false,
        isRefetchError: false,
      })
      .mockResolvedValueOnce({
        data: envelope,
        error: new Error('background refresh failed'),
        isError: true,
        isRefetchError: true,
      })
    mockedUseStore.mockReturnValue(queryResult({ store, refetch }))
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ review: completeReview() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const user = userEvent.setup()
    renderReview('2 זוגיות ויין אחד')

    await user.click(screen.getByRole('button', { name: 'בניית טופס ההזמנה' }))

    expect((await screen.findByRole('alert')).textContent).toContain('ההזמנה לא שונתה')
    expect(screen.getByTestId('location').textContent).toContain(APP_ROUTES.orderImportReview)
    expect((screen.getByLabelText('הודעת הלקוח') as HTMLTextAreaElement).value).toBe('2 זוגיות ויין אחד')
    expect(refetch).toHaveBeenNthCalledWith(2, { throwOnError: true })
    expect(fetchSpy.mock.calls.some(([url, request]) => url === '/api/state' && request?.method === 'POST')).toBe(false)
  })

  it('decodes BM1 locally and automatically transfers it after the same fresh-state check', async () => {
    const refetch = vi.fn().mockResolvedValue({ data: versionedEnvelope() })
    mockedUseStore.mockReturnValue(queryResult({ refetch }))
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const user = userEvent.setup()
    renderReview(bm1Message(publicPayload()))

    await user.click(screen.getByRole('button', { name: 'בניית טופס ההזמנה' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain(APP_ROUTES.newOrder))

    const handoff = currentHandoff()
    const draft = handoff.reviewedDraft as Record<string, unknown>
    const review = handoff.review as AIReview
    expect(draft.name).toBe('לקוחה מובנית')
    expect(draft.meals).toBe(1)
    expect(draft.challot).toBe(2)
    expect(draft.salads).toEqual(expect.objectContaining({
      'כרוב לבן קלאסי': { ordered: 1, gift: 0, note: '' },
    }))
    expect(draft.extras).not.toEqual(expect.objectContaining({ משלוח: expect.anything() }))
    expect(review.warnings[0]?.message).toContain('קוד ההזמנה המובנה')
    expect(handoff.reviewedStateSignature).toBe(JSON.stringify({ orders: [] }))
    expect(handoff.reviewedMessage).toBe('הזמנה מהטופס')
    expect(refetch).toHaveBeenCalledTimes(2)
    expect(refetch).toHaveBeenNthCalledWith(1, { throwOnError: true })
    expect(refetch).toHaveBeenNthCalledWith(2, { throwOnError: true })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('uses a short display message when a BM1 order contains only its encoded marker', async () => {
    mockedUseStore.mockReturnValue(queryResult())
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const user = userEvent.setup()
    const markerOnly = bm1Message(publicPayload()).replace('הזמנה מהטופס\n', '')
    renderReview(markerOnly)

    await user.click(screen.getByRole('button', { name: 'בניית טופס ההזמנה' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain(APP_ROUTES.newOrder))

    expect(currentHandoff().reviewedMessage).toBe('הזמנה מובנית מטופס הלקוח')
    expect(screen.getByTestId('location').textContent).not.toContain('#BM1#')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('preserves a public midweek lunch-only BM1 order without adding a couple package or challahs', async () => {
    mockedUseStore.mockReturnValue(queryResult())
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const user = userEvent.setup()
    renderReview(bm1Message(publicPayload({
      date: '2026-08-19',
      meals: 0,
      challot: 0,
      salads: {},
      firsts: {},
      mains: {},
      sides: {},
      desserts: {},
      extras: {},
      lunch: {
        'schnitzel-plate': {
          q: 2,
          v: 'family',
          sides: { 'אורז לבן': 2, 'פסטה אדומה': 2 },
          addon: 0,
        },
        couscous: { q: 1, v: '', sides: {}, addon: 1 },
      },
    })))

    await user.click(screen.getByRole('button', { name: 'בניית טופס ההזמנה' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain(APP_ROUTES.newOrder))

    const draft = currentHandoff().reviewedDraft as Record<string, unknown>
    expect(draft.date).toBe('2026-08-19')
    expect(draft.meals).toBe(0)
    expect(draft.challot).toBe(0)
    expect(draft.lunch).toEqual({
      'schnitzel-plate': {
        quantity: 2,
        variantKey: 'family',
        sides: { 'אורז לבן': 2, 'פסטה אדומה': 2 },
        addonQuantity: 0,
        note: '',
      },
      couscous: {
        quantity: 1,
        variantKey: '',
        sides: {},
        addonQuantity: 1,
        note: '',
      },
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fails closed when a public BM1 lunch selection contains an unknown variant or side', async () => {
    mockedUseStore.mockReturnValue(queryResult())
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const user = userEvent.setup()
    renderReview(bm1Message(publicPayload({
      meals: 0,
      challot: 0,
      lunch: {
        'schnitzel-plate': {
          q: 1,
          v: 'unknown-size',
          sides: { 'תוספת לא קיימת': 1 },
          addon: 0,
        },
      },
    })))

    await user.click(screen.getByRole('button', { name: 'בניית טופס ההזמנה' }))

    expect((await screen.findByRole('alert')).textContent).toContain('פריט שאינו קיים בתפריט')
    expect(screen.getByTestId('location').textContent).toContain(APP_ROUTES.orderImportReview)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fails closed on malformed or unknown BM1 items and remains on the intake screen', async () => {
    mockedUseStore.mockReturnValue(queryResult())
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const user = userEvent.setup()
    renderReview(bm1Message(publicPayload({ mains: { 'מנה שלא קיימת': 1 } })))

    await user.click(screen.getByRole('button', { name: 'בניית טופס ההזמנה' }))

    expect((await screen.findByRole('alert')).textContent).toContain('פריט שאינו קיים בתפריט')
    expect(screen.getByTestId('location').textContent).toContain(APP_ROUTES.orderImportReview)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('keeps a failed AI review on screen with no handoff or state write', async () => {
    mockedUseStore.mockReturnValue(queryResult())
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        error: { code: 'invalid_ai_response', message: 'private provider diagnostic' },
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const user = userEvent.setup()
    renderReview('הודעת לקוח אמיתית')

    await user.click(screen.getByRole('button', { name: 'בניית טופס ההזמנה' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('פענוח שלא עבר את בדיקות הבטיחות')
    expect(alert.textContent).not.toContain('private provider diagnostic')
    expect(screen.getByTestId('location').textContent).toContain(APP_ROUTES.orderImportReview)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls.some(([url, request]) => url === '/api/state' && request?.method === 'POST')).toBe(false)
  })

  it('rejects malformed successful provider data without showing a translator report', async () => {
    mockedUseStore.mockReturnValue(queryResult())
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ review: { reviewOnly: false } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const user = userEvent.setup()
    renderReview('הודעה אמיתית')

    await user.click(screen.getByRole('button', { name: 'בניית טופס ההזמנה' }))

    expect((await screen.findByRole('alert')).textContent).toContain('ההזמנה לא שונתה')
    expect(screen.queryByText('מה זוהה בהודעה')).toBeNull()
    expect(screen.queryByText('הטיוטה שהוחלה בזיכרון בלבד')).toBeNull()
    expect(screen.getByTestId('location').textContent).toContain(APP_ROUTES.orderImportReview)
  })
})
