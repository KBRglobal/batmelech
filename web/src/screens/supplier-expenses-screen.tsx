import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { LocalIcon } from '../components/local-icon.tsx'
import { ScreenState } from '../components/screen-state.tsx'

// Supplier expenses: Lin uploads the invoices she receives (PDF or photo),
// the AI reads every line item and prices it into a category, and the screen
// answers the real question — how much went on fruits, vegetables, meat...
// Files live in the plan's cloud storage and are read only through the
// authenticated API; no public links.

const CATEGORY_LABELS: Record<string, string> = {
  fruits: 'פירות',
  vegetables: 'ירקות',
  meat_fish: 'בשר ודגים',
  dairy: 'מוצרי חלב',
  dry_goods: 'מוצרים יבשים',
  packaging: 'אריזות וחד-פעמי',
  other: 'אחר',
}

const CATEGORY_COLORS: Record<string, string> = {
  fruits: 'bg-orange-400',
  vegetables: 'bg-emerald-500',
  meat_fish: 'bg-rose-500',
  dairy: 'bg-sky-400',
  dry_goods: 'bg-amber-500',
  packaging: 'bg-slate-400',
  other: 'bg-violet-400',
}

const InvoiceItemSchema = z.object({
  name: z.string(),
  quantity: z.number().nullable(),
  unitPriceMinor: z.number().nullable(),
  totalMinor: z.number().nullable(),
  category: z.string(),
})

const SupplierInvoiceSchema = z.object({
  id: z.string(),
  r2Key: z.string(),
  fileName: z.string(),
  status: z.enum(['pending', 'scanned', 'failed']),
  merchant: z.string().nullable(),
  purchasedAt: z.string().nullable(),
  currency: z.string().nullable(),
  totalMinor: z.number().nullable(),
  items: z.array(InvoiceItemSchema),
  scanError: z.string().nullable(),
  createdAt: z.string().nullable(),
})

const ListSchema = z.object({ invoices: z.array(SupplierInvoiceSchema) })

type SupplierInvoice = z.infer<typeof SupplierInvoiceSchema>

const QUERY_KEY = ['bat-melech', 'supplier-invoices'] as const
const MAX_FILE_BYTES = 10 * 1024 * 1024

function formatMoney(minor: number | null, currency: string | null): string {
  if (minor === null) return '—'
  const amount = (minor / 100).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${amount} ${currency ?? 'AED'}`
}

function invoiceMonth(invoice: SupplierInvoice): string {
  const source = invoice.purchasedAt ?? invoice.createdAt ?? ''
  return source.slice(0, 7)
}

function monthTitle(month: string): string {
  const [year, monthNumber] = month.split('-')
  const names = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']
  return `${names[Number(monthNumber) - 1] ?? monthNumber} ${year}`
}

async function loadSupplierInvoices(): Promise<readonly SupplierInvoice[]> {
  const response = await fetch('/api/settings/supplier-invoices', { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`load failed: ${response.status}`)
  return ListSchema.parse(await response.json()).invoices
}

function CategoryBreakdown({ invoices }: { invoices: readonly SupplierInvoice[] }) {
  const byCategory = new Map<string, number>()
  let total = 0
  for (const invoice of invoices) {
    for (const item of invoice.items) {
      if (item.totalMinor === null) continue
      byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + item.totalMinor)
      total += item.totalMinor
    }
  }
  if (total === 0) return null
  const currency = invoices.find((entry) => entry.currency)?.currency ?? 'AED'
  const rows = [...byCategory.entries()].sort((a, b) => b[1] - a[1])

  return (
    <div className="mt-4 space-y-2">
      {rows.map(([category, minor]) => (
        <div key={category} className="flex items-center gap-3">
          <span className="w-28 shrink-0 text-xs font-black text-primary">{CATEGORY_LABELS[category] ?? category}</span>
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-secondary/60">
            <div
              className={`h-full rounded-full ${CATEGORY_COLORS[category] ?? 'bg-primary'}`}
              style={{ width: `${Math.max((minor / total) * 100, 2)}%` }}
            />
          </div>
          <span className="w-28 shrink-0 text-end text-xs font-bold text-muted-foreground" dir="ltr">
            {formatMoney(minor, currency)}
          </span>
        </div>
      ))}
    </div>
  )
}

function InvoiceCard({
  invoice,
  onDelete,
  onRescan,
  busy,
}: {
  invoice: SupplierInvoice
  onDelete: (invoice: SupplierInvoice) => void
  onRescan: (invoice: SupplierInvoice) => void
  busy: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <li className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-black text-primary">{invoice.merchant ?? 'ספק לא מזוהה'}</h3>
            {invoice.status === 'failed' && (
              <span className="rounded-full border border-rose-100 bg-rose-50 px-2.5 py-1 text-[0.6875rem] font-black text-rose-700">
                הסריקה נכשלה
              </span>
            )}
            {invoice.status === 'pending' && (
              <span className="rounded-full border border-amber-100 bg-amber-50 px-2.5 py-1 text-[0.6875rem] font-black text-amber-700">
                בסריקה
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-bold text-muted-foreground">
            {invoice.purchasedAt && <span>{invoice.purchasedAt.split('-').reverse().join('.')}</span>}
            <span dir="ltr">{formatMoney(invoice.totalMinor, invoice.currency)}</span>
            <span className="truncate" dir="ltr">{invoice.fileName}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {invoice.items.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen((current) => !current)}
              className="inline-flex min-h-9 items-center gap-1 rounded-xl border border-border bg-card px-3 text-xs font-bold text-primary transition-colors hover:bg-secondary"
            >
              <LocalIcon name={open ? 'ph:caret-up-bold' : 'ph:caret-down-bold'} className="text-sm" />
              {invoice.items.length} פריטים
            </button>
          )}
          <a
            href={`/api/settings/supplier-invoices/file?key=${encodeURIComponent(invoice.r2Key)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-9 items-center rounded-xl border border-border bg-card px-3 text-xs font-bold text-primary transition-colors hover:bg-secondary"
          >
            צפייה
          </a>
          {invoice.status === 'failed' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onRescan(invoice)}
              className="inline-flex min-h-9 items-center rounded-xl border border-primary bg-primary px-3 text-xs font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              סריקה חוזרת
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm('למחוק את החשבונית מהארכיון? פעולה זו אינה ניתנת לביטול.')) onDelete(invoice)
            }}
            className="inline-flex min-h-9 items-center rounded-xl border border-rose-100 bg-rose-50 px-3 text-xs font-bold text-rose-700 transition-colors hover:bg-rose-100"
          >
            מחיקה
          </button>
        </div>
      </div>

      {open && invoice.items.length > 0 && (
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-secondary/20">
          {invoice.items.map((item, index) => (
            <li key={index} className="flex items-center justify-between gap-3 px-4 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${CATEGORY_COLORS[item.category] ?? 'bg-primary'}`} />
                <span className="min-w-0 truncate text-xs font-bold text-primary">{item.name}</span>
                <span className="shrink-0 text-[0.6875rem] font-bold text-muted-foreground">
                  {CATEGORY_LABELS[item.category] ?? item.category}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-xs font-bold text-muted-foreground" dir="ltr">
                {item.quantity !== null && <span>×{item.quantity}</span>}
                <span>{formatMoney(item.totalMinor, invoice.currency)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export function SupplierExpensesScreen() {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)

  const invoicesQuery = useQuery({ queryKey: QUERY_KEY, queryFn: loadSupplierInvoices })

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const fileBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('read failed'))
        reader.readAsDataURL(file)
      })
      const response = await fetch('/api/settings/supplier-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ fileBase64, fileName: file.name }),
      })
      if (response.status === 413) {
        throw new Error('חבילת האחסון מלאה — יש לרכוש הרחבה במסך ההגדרות')
      }
      if (!response.ok) throw new Error('ההעלאה נכשלה, נסי שוב')
      return SupplierInvoiceSchema.parse((await response.json()).invoice)
    },
    onSuccess: (invoice) => {
      setMessage(
        invoice.status === 'scanned'
          ? { kind: 'success', text: `נסרקה: ${invoice.merchant ?? invoice.fileName} — ${invoice.items.length} פריטים` }
          : { kind: 'error', text: 'הקובץ נשמר אך הסריקה נכשלה — אפשר לנסות סריקה חוזרת' }
      )
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    },
    onError: (error: Error) => setMessage({ kind: 'error', text: error.message }),
  })

  const rescanMutation = useMutation({
    mutationFn: async (invoice: SupplierInvoice) => {
      const response = await fetch(`/api/settings/supplier-invoices/${invoice.id}/rescan`, {
        method: 'POST',
        credentials: 'same-origin',
      })
      if (!response.ok) throw new Error('הסריקה החוזרת נכשלה')
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: (error: Error) => setMessage({ kind: 'error', text: error.message }),
  })

  const deleteMutation = useMutation({
    mutationFn: async (invoice: SupplierInvoice) => {
      const response = await fetch(`/api/settings/supplier-invoices/${invoice.id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      if (!response.ok) throw new Error('המחיקה נכשלה')
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: (error: Error) => setMessage({ kind: 'error', text: error.message }),
  })

  const invoices = invoicesQuery.data ?? []
  const byMonth = useMemo(() => {
    const map = new Map<string, SupplierInvoice[]>()
    for (const invoice of invoices) {
      const month = invoiceMonth(invoice)
      map.set(month, [...(map.get(month) ?? []), invoice])
    }
    return map
  }, [invoices])
  const months = [...byMonth.keys()].sort().reverse()
  const busy = uploadMutation.isPending || rescanMutation.isPending || deleteMutation.isPending

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-black tracking-tight text-primary sm:text-4xl">הוצאות ספקים</h1>
          <p className="mt-2 text-sm font-bold text-muted-foreground">
            מעלים חשבונית — והמערכת קוראת את הפריטים, מתמחרת ומסווגת: כמה יצא על פירות, ירקות, בשר ועוד.
          </p>
        </div>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              setMessage(null)
              if (!file) return
              if (file.size > MAX_FILE_BYTES) {
                setMessage({ kind: 'error', text: 'הקובץ גדול מדי — עד 10MB' })
                return
              }
              uploadMutation.mutate(file)
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
            className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-primary px-5 text-sm font-black text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <LocalIcon name="ph:cloud-arrow-up-bold" className="text-lg" />
            {uploadMutation.isPending ? 'סורקת את החשבונית…' : 'העלאת חשבונית'}
          </button>
        </div>
      </header>

      {message !== null && (
        <p
          className={`mt-4 rounded-2xl border-2 p-3 text-xs font-black ${
            message.kind === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-100 bg-emerald-50 text-emerald-700'
          }`}
          role={message.kind === 'error' ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      )}

      <div className="mt-8">
        {invoicesQuery.isPending ? (
          <ScreenState kind="loading" title="טוענת את ההוצאות" />
        ) : invoicesQuery.isError ? (
          <ScreenState
            kind="error"
            title="לא הצלחנו לטעון את ההוצאות"
            description="אפשר לנסות שוב."
            retry={() => { void invoicesQuery.refetch() }}
          />
        ) : invoices.length === 0 ? (
          <ScreenState
            kind="empty"
            title="אין עדיין חשבוניות ספקים"
            description="ההעלאה הראשונה תיסרק אוטומטית ותופיע כאן עם פירוט לפי קטגוריות."
          />
        ) : (
          <div className="space-y-8">
            {months.map((month) => {
              const monthInvoices = byMonth.get(month) ?? []
              const monthTotal = monthInvoices.reduce((sum, entry) => sum + (entry.totalMinor ?? 0), 0)
              const currency = monthInvoices.find((entry) => entry.currency)?.currency ?? null
              return (
                <section key={month} className="rounded-[2.5rem] border border-border bg-card p-6 shadow-sm sm:p-8">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-xl font-black text-primary">{monthTitle(month)}</h2>
                    <span className="text-sm font-black text-muted-foreground" dir="ltr">
                      {formatMoney(monthTotal, currency)}
                    </span>
                  </div>
                  <CategoryBreakdown invoices={monthInvoices} />
                  <ul className="mt-5 space-y-3">
                    {monthInvoices.map((invoice) => (
                      <InvoiceCard
                        key={invoice.id}
                        invoice={invoice}
                        busy={busy}
                        onDelete={(target) => deleteMutation.mutate(target)}
                        onRescan={(target) => rescanMutation.mutate(target)}
                      />
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default SupplierExpensesScreen
