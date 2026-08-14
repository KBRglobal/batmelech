// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InvoicesScreen } from './invoices-screen.tsx'

const TOKEN = 'a'.repeat(48)

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    invoiceNumber: 'BM-2026-000001',
    orderId: 'order-1',
    customerName: 'לין כהן',
    customerEmail: 'lin@example.com',
    currency: 'AED',
    totalMinor: 30_000,
    status: 'sent',
    createdAt: '2026-08-07T09:00:00.000Z',
    sentAt: '2026-08-07T09:00:00.000Z',
    downloadPath: `/invoices/BM-2026-000001/${TOKEN}.pdf`,
    ...overrides,
  }
}

const SECOND_INVOICE = invoice({
  invoiceNumber: 'BM-2026-000002',
  customerName: 'דנה לוי',
  customerEmail: 'dana@example.com',
  totalMinor: 12_550,
})

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <InvoicesScreen />
    </QueryClientProvider>,
  )
}

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/invoices?')) {
      const query = new URL(url, 'http://localhost').searchParams.get('query') ?? ''
      const needle = query.toLowerCase()
      return jsonResponse({
        invoices: [invoice(), SECOND_INVOICE].filter(
          (row) =>
            row.invoiceNumber.toLowerCase().includes(needle)
            || row.customerName.toLowerCase().includes(needle),
        ),
      })
    }
    if (url === '/api/invoices') return jsonResponse({ invoices: [invoice(), SECOND_INVOICE] })
    if (url.endsWith('/resend')) return jsonResponse({ ok: true })
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('InvoicesScreen', () => {
  it('lists issued invoices with their amount, date and download link', async () => {
    renderScreen()

    const rows = await screen.findAllByRole('listitem')
    expect(rows).toHaveLength(2)

    const first = within(rows[0]!)
    expect(first.getByText('BM-2026-000001')).toBeTruthy()
    expect(first.getByText('לין כהן')).toBeTruthy()
    expect(first.getByText('AED 300.00')).toBeTruthy()
    expect(first.getByText('07.08.2026')).toBeTruthy()
    expect(first.getByText('נשלחה 07.08.2026')).toBeTruthy()
    expect(first.getByRole('link', { name: 'הורדה' }).getAttribute('href')).toBe(
      `/invoices/BM-2026-000001/${TOKEN}.pdf`,
    )
    expect(within(rows[1]!).getByText('AED 125.50')).toBeTruthy()
  })

  it('marks an invoice whose email failed and hides its download link', async () => {
    fetchSpy.mockImplementation(async () =>
      jsonResponse({ invoices: [invoice({ status: 'failed', sentAt: null, downloadPath: null })] }),
    )
    renderScreen()

    expect(await screen.findByText('השליחה נכשלה')).toBeTruthy()
    expect(screen.getByText('הורדה לא זמינה')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'הורדה' })).toBeNull()
  })

  it('searches the server by free text and shows only the matching invoice', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findAllByRole('listitem')

    await user.type(screen.getByLabelText('חיפוש חשבונית לפי מספר או שם'), 'דנה')

    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(1)
    })
    expect(screen.getByText('דנה לוי')).toBeTruthy()
    expect(screen.queryByText('לין כהן')).toBeNull()
    expect(fetchSpy.mock.calls.at(-1)![0]).toBe(`/api/invoices?query=${encodeURIComponent('דנה')}`)
  })

  it('reports an empty search without claiming there are no invoices at all', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findAllByRole('listitem')

    await user.type(screen.getByLabelText('חיפוש חשבונית לפי מספר או שם'), 'zzz')

    expect(await screen.findByText('אין חשבונית שמתאימה לחיפוש')).toBeTruthy()
  })

  it('resends a single invoice and confirms which address it went to', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findAllByRole('listitem')

    await user.click(screen.getByRole('button', { name: 'שליחה חוזרת של חשבונית BM-2026-000001' }))

    expect((await screen.findByRole('status')).textContent).toBe('החשבונית נשלחה שוב אל lin@example.com.')
    const resendCall = fetchSpy.mock.calls.find(([url]) => String(url).endsWith('/resend'))
    expect(resendCall![0]).toBe('/api/invoices/BM-2026-000001/resend')
    expect((resendCall![1] as RequestInit).method).toBe('POST')
  })

  it('keeps the invoice untouched and explains when the resend fails', async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/resend')) return new Response('no', { status: 502 })
      return jsonResponse({ invoices: [invoice()] })
    })
    const user = userEvent.setup()
    renderScreen()
    await screen.findAllByRole('listitem')

    await user.click(screen.getByRole('button', { name: 'שליחה חוזרת של חשבונית BM-2026-000001' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'השליחה נכשלה. החשבונית לא נשלחה ואפשר לנסות שוב.',
    )
  })

  it('explains a load failure instead of showing an empty list', async () => {
    fetchSpy.mockImplementation(async () => new Response('no', { status: 500 }))
    renderScreen()

    expect(await screen.findByText('לא הצלחנו לטעון את החשבוניות')).toBeTruthy()
    expect(screen.queryByRole('listitem')).toBeNull()
  })
})
