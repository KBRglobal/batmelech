import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LocalIcon } from '../components/local-icon.tsx'
import { ScreenState } from '../components/screen-state.tsx'
import { loadInvoices, resendInvoice, type Invoice } from '../services/invoices-api.ts'

const INVOICES_QUERY_KEY = ['bat-melech', 'invoices'] as const

const actionClassName =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-primary transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

interface ResendState {
  readonly kind: 'saving' | 'saved' | 'error'
  readonly message: string
}

const dateFormatter = new Intl.DateTimeFormat('he-IL', {
  timeZone: 'Asia/Dubai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function formatDate(value: string | null): string {
  if (value === null) return 'ללא תאריך'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'ללא תאריך'
  return dateFormatter.format(parsed)
}

// The invoice PDF prints amounts the same way, so the panel keeps the currency
// code rather than a localized symbol — AED and USD both appear here.
function formatAmount(totalMinor: number, currency: string): string {
  return `${currency} ${(totalMinor / 100).toFixed(2)}`
}

function StatusBadge({ invoice }: { invoice: Invoice }) {
  const sent = invoice.status === 'sent'
  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[0.6875rem] font-black ${
        sent ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-rose-100 bg-rose-50 text-rose-700'
      }`}
    >
      {sent ? `נשלחה ${formatDate(invoice.sentAt)}` : 'השליחה נכשלה'}
    </span>
  )
}

function InvoiceRow({
  invoice,
  onResend,
  resendState,
  resendBlocked,
}: {
  invoice: Invoice
  onResend: (invoice: Invoice) => void
  resendState?: ResendState
  resendBlocked: boolean
}) {
  return (
    <li className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-black text-muted-foreground" dir="ltr">{invoice.invoiceNumber}</span>
            <h2 className="font-black text-primary">{invoice.customerName || 'ללא שם'}</h2>
            <StatusBadge invoice={invoice} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-bold text-muted-foreground">
            <span>{formatDate(invoice.createdAt)}</span>
            <span dir="ltr">{formatAmount(invoice.totalMinor, invoice.currency)}</span>
            {invoice.customerEmail && <span dir="ltr">{invoice.customerEmail}</span>}
          </div>
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            {invoice.downloadPath === null ? (
              <span className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-destructive">הורדה לא זמינה</span>
            ) : (
              <a
                href={invoice.downloadPath}
                target="_blank"
                rel="noopener noreferrer"
                className={actionClassName}
              >
                <LocalIcon name="ph:receipt-bold" className="text-base" />
                <span>הורדה</span>
              </a>
            )}
            <button
              type="button"
              disabled={resendBlocked || resendState?.kind === 'saving'}
              aria-label={`שליחה חוזרת של חשבונית ${invoice.invoiceNumber}`}
              onClick={() => onResend(invoice)}
              className="min-h-10 rounded-xl border border-primary bg-primary px-3 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60"
            >
              {resendState?.kind === 'saving' ? 'שולחת...' : 'שליחה חוזרת במייל'}
            </button>
          </div>
          {resendState !== undefined && resendState.kind !== 'saving' && (
            <p
              className={`mt-2 text-xs font-black ${resendState.kind === 'error' ? 'text-destructive' : 'text-emerald-700'}`}
              role={resendState.kind === 'error' ? 'alert' : 'status'}
            >
              {resendState.message}
            </p>
          )}
        </div>
      </div>
    </li>
  )
}

export function InvoicesScreen() {
  const queryClient = useQueryClient()
  const [searchTerm, setSearchTerm] = useState('')
  const [resendStates, setResendStates] = useState<Readonly<Record<string, ResendState>>>({})

  const invoicesQuery = useQuery({
    queryKey: [...INVOICES_QUERY_KEY, searchTerm.trim()] as const,
    queryFn: ({ signal }) => loadInvoices(searchTerm, signal),
    placeholderData: (previous) => previous,
  })

  const resendMutation = useMutation({
    mutationFn: (invoice: Invoice) => resendInvoice(invoice.invoiceNumber),
    onMutate: (invoice: Invoice) => {
      setResendStates((current) => ({
        ...current,
        [invoice.invoiceNumber]: { kind: 'saving', message: 'שולחת...' },
      }))
    },
    onSuccess: (_result, invoice) => {
      setResendStates((current) => ({
        ...current,
        [invoice.invoiceNumber]: { kind: 'saved', message: `החשבונית נשלחה שוב אל ${invoice.customerEmail}.` },
      }))
      void queryClient.invalidateQueries({ queryKey: INVOICES_QUERY_KEY })
    },
    onError: (_error, invoice) => {
      setResendStates((current) => ({
        ...current,
        [invoice.invoiceNumber]: {
          kind: 'error',
          message: 'השליחה נכשלה. החשבונית לא נשלחה ואפשר לנסות שוב.',
        },
      }))
    },
  })

  const invoices = invoicesQuery.data ?? []

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-black tracking-tight text-primary sm:text-4xl">חשבוניות</h1>
          <p className="mt-2 text-sm font-bold text-muted-foreground">
            כל החשבוניות שנשלחו ללקוחות, מהחדשה לישנה. אפשר להוריד או לשלוח שוב במייל.
          </p>
        </div>
        <label className="flex flex-col gap-1 text-xs font-black text-muted-foreground">
          חיפוש
          <input
            type="search"
            aria-label="חיפוש חשבונית לפי מספר או שם"
            placeholder="מספר חשבונית או שם לקוח"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.currentTarget.value)}
            className="min-h-11 w-full rounded-xl border border-border bg-card px-4 text-sm font-bold text-primary outline-none focus:ring-2 focus:ring-primary/20 lg:w-72"
          />
        </label>
      </header>

      <div className="mt-8">
        {invoicesQuery.isPending ? (
          <ScreenState kind="loading" title="טוענת את החשבוניות" />
        ) : invoicesQuery.isError ? (
          <ScreenState
            kind="error"
            title="לא הצלחנו לטעון את החשבוניות"
            description="לא בוצע שינוי בחשבוניות. אפשר לנסות שוב."
            retry={() => { void invoicesQuery.refetch() }}
          />
        ) : invoices.length === 0 ? (
          <ScreenState
            kind="empty"
            title={searchTerm.trim() ? 'אין חשבונית שמתאימה לחיפוש' : 'אין עדיין חשבוניות'}
            description={
              searchTerm.trim()
                ? 'אפשר לחפש לפי מספר חשבונית או לפי שם הלקוח.'
                : 'חשבונית נשלחת אוטומטית ללקוח כשהזמנה מסומנת כשולמה.'
            }
          />
        ) : (
          <ul className="space-y-3">
            {invoices.map((invoice) => (
              <InvoiceRow
                key={invoice.invoiceNumber}
                invoice={invoice}
                onResend={(target) => resendMutation.mutate(target)}
                resendState={resendStates[invoice.invoiceNumber]}
                resendBlocked={resendMutation.isPending}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default InvoicesScreen
