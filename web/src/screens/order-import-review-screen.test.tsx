// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_ROUTES } from '../app/routes.ts'
import { useStore } from '../data/use-store.ts'
import type { AIReview } from '../domain/order-editor.ts'
import type { LegacyStore } from '../domain/store.ts'
import { OrderImportReviewScreen } from './order-import-review-screen.tsx'

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

function renderReview(message = '') {
  return render(
    <MemoryRouter initialEntries={[{ pathname: APP_ROUTES.orderImportReview, state: { message } }]}>
      <Routes>
        <Route path={APP_ROUTES.orderImportReview} element={<><OrderImportReviewScreen /><LocationProbe /></>} />
        <Route path={APP_ROUTES.newOrder} element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
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
    expect(within(preview).getByText('תוספת יין ×1')).toBeTruthy()
    expect(screen.getByText('שום דבר לא נשמר במסד הנתונים')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'מעבר לטופס והשלמה ידנית' }))
    expect(screen.getByTestId('location').textContent).toContain(`${APP_ROUTES.newOrder}|`)
    expect(screen.getByTestId('location').textContent).toContain('"reviewOnly":true')
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
