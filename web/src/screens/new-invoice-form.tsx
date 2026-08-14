import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { formatInvoiceAmount, formatInvoiceDate } from '../domain/invoice-format.ts'
import {
  createManualInvoice,
  InvoicesApiError,
  loadInvoiceableOrders,
  type InvoiceableOrder,
  type IssuedInvoice,
  type ManualInvoiceInput,
} from '../services/invoices-api.ts'

export const INVOICEABLE_ORDERS_QUERY_KEY = ['bat-melech', 'invoiceable-orders'] as const

// The server's plain-English refusals, said the way Lin needs to hear them.
// Anything unmapped falls back to the generic line — a new server message must
// never surface as raw English in the panel.
const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  'this order already has an invoice': 'להזמנה הזאת כבר יש חשבונית.',
  'order not found': 'ההזמנה לא נמצאה. כדאי לרענן ולנסות שוב.',
  'the order has no amount to invoice': 'להזמנה אין סכום לחיוב.',
  'business name and invoice currency must be set first':
    'צריך למלא שם עסק ומטבע חשבונית בהגדרות לפני שמנפיקים.',
  'manual invoicing is not available': 'הנפקה ידנית לא זמינה כרגע.',
  'email sending is not configured': 'שליחת מיילים לא מוגדרת, אז אי אפשר להנפיק עם כתובת מייל.',
  'the invoice was issued but the email could not be sent':
    'החשבונית הונפקה אבל המייל לא נשלח. אפשר לשלוח אותו שוב מהרשימה.',
  'an invoice cannot be dated in the future': 'אי אפשר להנפיק חשבונית בתאריך עתידי.',
  'an invoice can only be dated inside the current year': 'אפשר לתארך חשבונית רק בתוך השנה הנוכחית.',
  'invalid invoice details': 'חסרים פרטים או שאחד מהם לא תקין.',
}

function errorMessage(error: unknown): string {
  const reason = error instanceof InvoicesApiError ? error.reason : null
  if (reason !== null && reason in ERROR_MESSAGES) return ERROR_MESSAGES[reason]!
  return 'ההנפקה נכשלה. לא הונפקה חשבונית ואפשר לנסות שוב.'
}

const fieldClassName =
  'min-h-11 w-full rounded-xl border border-border bg-card px-4 text-sm font-bold text-primary outline-none focus:ring-2 focus:ring-primary/20'
const labelClassName = 'flex flex-col gap-1 text-xs font-black text-muted-foreground'

interface FreeFormDraft {
  readonly customerName: string
  readonly amount: string
  readonly description: string
  readonly email: string
  readonly phone: string
  readonly date: string
}

const EMPTY_DRAFT: FreeFormDraft = {
  customerName: '',
  amount: '',
  description: '',
  email: '',
  phone: '',
  date: '',
}

function parseAmount(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

function OrderPicker({
  selectedOrderId,
  onSelect,
}: {
  selectedOrderId: string | null
  onSelect: (orderId: string) => void
}) {
  const [search, setSearch] = useState('')
  const ordersQuery = useQuery({
    queryKey: INVOICEABLE_ORDERS_QUERY_KEY,
    queryFn: ({ signal }) => loadInvoiceableOrders(signal),
  })

  const matching = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const orders: readonly InvoiceableOrder[] = ordersQuery.data?.orders ?? []
    if (needle === '') return orders
    return orders.filter(
      (order) => order.name.toLowerCase().includes(needle) || order.date.includes(needle),
    )
  }, [ordersQuery.data, search])

  if (ordersQuery.isPending) {
    return <p className="text-xs font-bold text-muted-foreground">טוענת הזמנות...</p>
  }
  if (ordersQuery.isError) {
    return (
      <p className="text-xs font-black text-destructive" role="alert">
        {errorMessage(ordersQuery.error)}
      </p>
    )
  }

  const currency = ordersQuery.data.currency

  return (
    <div className="flex flex-col gap-3">
      <label className={labelClassName}>
        חיפוש הזמנה
        <input
          type="search"
          aria-label="חיפוש הזמנה לפי שם או תאריך"
          placeholder="שם לקוח או תאריך"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          className={fieldClassName}
        />
      </label>

      {matching.length === 0 ? (
        <p className="text-xs font-bold text-muted-foreground">
          {ordersQuery.data.orders.length === 0
            ? 'לכל ההזמנות כבר יש חשבונית.'
            : 'אין הזמנה שמתאימה לחיפוש.'}
        </p>
      ) : (
        <ul className="max-h-64 space-y-2 overflow-y-auto">
          {matching.map((order) => {
            const selected = order.id === selectedOrderId
            return (
              <li key={order.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelect(order.id)}
                  className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-start text-xs font-bold transition-colors ${
                    selected ? 'border-primary bg-secondary text-primary' : 'border-border bg-card text-primary hover:bg-secondary'
                  }`}
                >
                  <span className="font-black">{order.name || 'ללא שם'}</span>
                  <span className="text-muted-foreground">{formatInvoiceDate(order.date)}</span>
                  <span dir="ltr" className="text-muted-foreground">
                    {formatInvoiceAmount(order.totalMinor, currency)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export function NewInvoiceForm({
  onIssued,
  onSettled,
  onCancel,
}: {
  onIssued: (result: IssuedInvoice) => void
  // Called after every attempt, not only a successful one: an invoice whose
  // email failed was still issued and still has to show up in the list.
  onSettled: () => void
  onCancel: () => void
}) {
  const [mode, setMode] = useState<'order' | 'free'>('order')
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [draft, setDraft] = useState<FreeFormDraft>(EMPTY_DRAFT)
  const [failure, setFailure] = useState<string | null>(null)

  const issueMutation = useMutation({
    mutationFn: (input: ManualInvoiceInput) => createManualInvoice(input),
    onMutate: () => { setFailure(null) },
    onSuccess: (result) => { onIssued(result) },
    onError: (error: unknown) => { setFailure(errorMessage(error)) },
    onSettled: () => { onSettled() },
  })

  const amount = parseAmount(draft.amount)
  const readyToIssue =
    mode === 'order'
      ? selectedOrderId !== null
      : draft.customerName.trim() !== '' && draft.description.trim() !== '' && amount !== null

  function submit() {
    if (!readyToIssue || issueMutation.isPending) return
    if (mode === 'order') {
      issueMutation.mutate({ orderId: selectedOrderId! })
      return
    }
    issueMutation.mutate({
      customerName: draft.customerName.trim(),
      amount: amount!,
      description: draft.description.trim(),
      ...(draft.email.trim() ? { email: draft.email.trim() } : {}),
      ...(draft.phone.trim() ? { phone: draft.phone.trim() } : {}),
      ...(draft.date ? { date: draft.date } : {}),
    })
  }

  return (
    <section
      aria-label="חשבונית חדשה"
      className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        {(['order', 'free'] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={mode === option}
            onClick={() => { setMode(option); setFailure(null) }}
            className={`min-h-10 rounded-xl border px-3 py-2 text-xs font-black transition-colors ${
              mode === option
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-primary hover:bg-secondary'
            }`}
          >
            {option === 'order' ? 'להזמנה קיימת' : 'ידנית'}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {mode === 'order' ? (
          <OrderPicker
            selectedOrderId={selectedOrderId}
            onSelect={(orderId) => { setSelectedOrderId(orderId); setFailure(null) }}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClassName}>
              שם הלקוח
              <input
                type="text"
                aria-label="שם הלקוח"
                value={draft.customerName}
                onChange={(event) => setDraft({ ...draft, customerName: event.currentTarget.value })}
                className={fieldClassName}
              />
            </label>
            <label className={labelClassName}>
              סכום
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                aria-label="סכום החשבונית"
                value={draft.amount}
                onChange={(event) => setDraft({ ...draft, amount: event.currentTarget.value })}
                className={fieldClassName}
              />
            </label>
            <label className={`${labelClassName} sm:col-span-2`}>
              תיאור
              <input
                type="text"
                aria-label="תיאור החשבונית"
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.currentTarget.value })}
                className={fieldClassName}
              />
            </label>
            <label className={labelClassName}>
              מייל (לא חובה)
              <input
                type="email"
                dir="ltr"
                aria-label="מייל הלקוח"
                value={draft.email}
                onChange={(event) => setDraft({ ...draft, email: event.currentTarget.value })}
                className={fieldClassName}
              />
            </label>
            <label className={labelClassName}>
              טלפון (לא חובה)
              <input
                type="tel"
                dir="ltr"
                aria-label="טלפון הלקוח"
                value={draft.phone}
                onChange={(event) => setDraft({ ...draft, phone: event.currentTarget.value })}
                className={fieldClassName}
              />
            </label>
            <label className={labelClassName}>
              תאריך (לא חובה)
              <input
                type="date"
                aria-label="תאריך החשבונית"
                value={draft.date}
                onChange={(event) => setDraft({ ...draft, date: event.currentTarget.value })}
                className={fieldClassName}
              />
            </label>
          </div>
        )}
      </div>

      <p className="mt-4 text-xs font-bold text-muted-foreground">
        המספר נקבע אוטומטית, אחרי החשבונית האחרונה שהונפקה. אם יש מייל — היא נשלחת אליו.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!readyToIssue || issueMutation.isPending}
          onClick={submit}
          className="min-h-10 rounded-xl border border-primary bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {issueMutation.isPending ? 'מנפיקה...' : 'הנפקת חשבונית'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-10 rounded-xl border border-border bg-card px-4 py-2 text-xs font-bold text-primary hover:bg-secondary"
        >
          ביטול
        </button>
      </div>

      {failure !== null && (
        <p className="mt-3 text-xs font-black text-destructive" role="alert">
          {failure}
        </p>
      )}
    </section>
  )
}
