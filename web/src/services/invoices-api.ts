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

export type Invoice = z.infer<typeof InvoiceSchema>

export class InvoicesApiError extends Error {
  constructor(message = 'Invoice request failed.') {
    super(message)
    this.name = 'InvoicesApiError'
  }
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
