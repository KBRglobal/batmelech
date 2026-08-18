import { z } from 'zod'

export const InvoiceSchema = z.object({
  invoiceNumber: z.string().min(1),
  orderId: z.string(),
  customerName: z.string(),
  customerEmail: z.string(),
  currency: z.enum(['AED', 'USD']),
  totalMinor: z.number().int().nonnegative(),
  status: z.enum(['sent', 'failed']),
  createdAt: z.string().nullable(),
  sentAt: z.string().nullable(),
  downloadPath: z.string().nullable(),
}).strict()

const InvoiceListSchema = z.object({ invoices: z.array(InvoiceSchema) }).strict()

export const InvoiceableOrderSchema = z.object({
  id: z.string(),
  name: z.string(),
  date: z.string(),
  totalMinor: z.number().int().nonnegative(),
  email: z.string(),
}).strict()

const InvoiceableOrdersSchema = z.object({
  currency: z.enum(['AED', 'USD']),
  orders: z.array(InvoiceableOrderSchema),
}).strict()

const IssuedInvoiceSchema = z.object({
  invoice: InvoiceSchema,
  emailed: z.boolean(),
}).strict()

export type Invoice = z.infer<typeof InvoiceSchema>
export type InvoiceableOrder = z.infer<typeof InvoiceableOrderSchema>
export type InvoiceableOrders = z.infer<typeof InvoiceableOrdersSchema>
export type IssuedInvoice = z.infer<typeof IssuedInvoiceSchema>

export type ManualInvoiceInput =
  | { readonly orderId: string }
  | {
      readonly customerName: string
      readonly amount: number
      readonly description: string
      readonly email?: string
      readonly phone?: string
      readonly date?: string
    }

// The server's own words for what went wrong travel with the error: issuing an
// invoice can fail in ways the panel has to say out loud (the order already has
// one, the invoice went out but the mail did not), not just "try again".
export class InvoicesApiError extends Error {
  readonly reason: string | null

  constructor(message = 'Invoice request failed.', reason: string | null = null) {
    super(message)
    this.name = 'InvoicesApiError'
    this.reason = reason
  }
}

async function readErrorReason(response: Response): Promise<string | null> {
  const body: unknown = await response.json().catch(() => null)
  if (body !== null && typeof body === 'object' && 'error' in body) {
    const { error } = body as { error: unknown }
    if (typeof error === 'string') return error
  }
  return null
}

export async function loadInvoices(query: string, signal?: AbortSignal): Promise<readonly Invoice[]> {
  const search = query.trim() ? `?${new URLSearchParams({ query: query.trim() }).toString()}` : ''
  let response: Response
  try {
    response = await fetch(`/api/invoices${search}`, { cache: 'no-store', signal })
  } catch {
    throw new InvoicesApiError()
  }
  if (!response.ok) throw new InvoicesApiError()
  const parsed = InvoiceListSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw new InvoicesApiError()
  return parsed.data.invoices
}

export async function loadInvoiceableOrders(signal?: AbortSignal): Promise<InvoiceableOrders> {
  let response: Response
  try {
    response = await fetch('/api/invoices/manual/orders', { cache: 'no-store', signal })
  } catch {
    throw new InvoicesApiError()
  }
  if (!response.ok) throw new InvoicesApiError('Invoice request failed.', await readErrorReason(response))
  const parsed = InvoiceableOrdersSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw new InvoicesApiError()
  return parsed.data
}

export async function createManualInvoice(input: ManualInvoiceInput): Promise<IssuedInvoice> {
  let response: Response
  try {
    response = await fetch('/api/invoices/manual', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  } catch {
    throw new InvoicesApiError()
  }
  if (!response.ok) throw new InvoicesApiError('Invoice request failed.', await readErrorReason(response))
  const parsed = IssuedInvoiceSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw new InvoicesApiError()
  return parsed.data
}

export async function resendInvoice(invoiceNumber: string): Promise<void> {
  let response: Response
  try {
    response = await fetch(`/api/invoices/${encodeURIComponent(invoiceNumber)}/resend`, {
      method: 'POST',
      cache: 'no-store',
    })
  } catch {
    throw new InvoicesApiError()
  }
  if (!response.ok) throw new InvoicesApiError()
}
