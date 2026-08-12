import { useRef, useState } from 'react'
import { generatePath, Link } from 'react-router'
import type { To } from 'react-router'
import { APP_ROUTES } from '../app/routes.ts'
import { LocalIcon } from '../components/local-icon.tsx'
import { ScreenState } from '../components/screen-state.tsx'
import { useStore } from '../data/use-store.ts'
import {
  buildCustomersDirectory,
  type CustomerDirectoryEntry,
  type CustomerFinanceWarning,
  type CustomerOrderHistoryItem,
} from '../domain/customers-finance.ts'
import { formatUsdMinorUnits } from '../domain/today-dashboard.ts'

const compactLinkClassName =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-primary transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

const primaryLinkClassName =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-black text-primary-foreground shadow-[0_8px_24px_rgba(99,33,40,0.12)] transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

function orderRoute(orderId: string): string {
  return generatePath(APP_ROUTES.editOrder, { orderId: encodeURIComponent(orderId) })
}

function repeatOrderRoute(orderId: string): To {
  return {
    pathname: APP_ROUTES.newOrder,
    search: `?${new URLSearchParams({ duplicate: orderId }).toString()}`,
  }
}

function statusClassName(item: CustomerOrderHistoryItem): string {
  if (item.cancelled) return 'border-border bg-muted text-muted-foreground'
  if (item.status === 'נמסרה' || item.status === 'מוכנה') {
    return 'border-emerald-100 bg-emerald-50 text-emerald-700'
  }
  if (item.status === 'אושרה' || item.status === 'במשלוח') {
    return 'border-amber-100 bg-amber-50 text-amber-800'
  }
  return 'border-rose-100 bg-rose-50 text-rose-700'
}

function HistoryRow({ item, customerName }: { item: CustomerOrderHistoryItem; customerName: string }) {
  return (
    <li className="flex flex-col gap-3 rounded-2xl bg-secondary/40 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-black text-muted-foreground">{item.localizedDate}</span>
        <span className={`rounded-full border px-2.5 py-1 text-[0.6875rem] font-black ${statusClassName(item)}`}>
          {item.status}
        </span>
        {item.totalState === 'invalid' ? (
          <span className="text-xs font-black text-destructive">סכום לא תקין</span>
        ) : item.totalState === 'valid' && item.totalMinorUnits !== null ? (
          <strong className="text-xs font-black text-primary" dir="ltr">
            {formatUsdMinorUnits(item.totalMinorUnits)}
          </strong>
        ) : null}
        {item.meals !== null && item.meals > 0 && (
          <span className="text-xs font-bold text-muted-foreground">זוגית ×{item.meals}</span>
        )}
      </div>
      {item.orderId === null ? (
        <span className="text-xs font-bold text-destructive">אין מזהה בטוח לפתיחה</span>
      ) : (
        <Link
          to={orderRoute(item.orderId)}
          className={compactLinkClassName}
          aria-label={`פתיחת ההזמנה של ${customerName} מתאריך ${item.localizedDate}`}
        >
          <LocalIcon name="ph:arrow-left-bold" className="text-base" />
          <span>פתיחה</span>
        </Link>
      )}
    </li>
  )
}

function CustomerCard({ customer }: { customer: CustomerDirectoryEntry }) {
  return (
    <article className="relative overflow-hidden rounded-[2.5rem] border border-border bg-card shadow-sm">
      {customer.vip && <div className="absolute inset-y-0 right-0 w-2.5 bg-accent" aria-hidden="true" />}
      <div className="p-6 sm:p-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-black text-primary">{customer.name}</h2>
              {customer.vip && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-secondary px-2.5 py-1 text-[0.6875rem] font-black text-primary">
                  <LocalIcon name="ph:check-circle-bold" className="text-sm" />
                  <span>VIP</span>
                </span>
              )}
              {customer.hasUpcomingOrder && (
                <span className="rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[0.6875rem] font-black text-emerald-700">
                  הזמנה קרובה
                </span>
              )}
            </div>
            <p className="mt-1 text-xs font-bold text-muted-foreground">
              {customer.orderCount} הזמנות · אחרונה: {customer.localizedLastServiceDate}
            </p>
          </div>
          <div>
            <p className="text-[0.6875rem] font-black uppercase tracking-wider text-muted-foreground">
              סה״כ הזמנות פעילות
            </p>
            {customer.spendComplete && customer.totalSpendMinorUnits !== null ? (
              <p className="mt-1 text-2xl font-black text-primary" dir="ltr">
                {formatUsdMinorUnits(customer.totalSpendMinorUnits)}
              </p>
            ) : (
              <p className="mt-1 text-sm font-black text-destructive">לא ניתן לחשב</p>
            )}
          </div>
        </header>

        <div className="mt-7 grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {customer.telephoneHref && (
                <a href={customer.telephoneHref} className={compactLinkClassName}>
                  <LocalIcon name="ph:users-bold" className="text-base" />
                  <span>{customer.phone}</span>
                </a>
              )}
              {customer.whatsappHref && (
                <a
                  href={customer.whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={compactLinkClassName}
                >
                  <LocalIcon name="ph:arrow-left-bold" className="text-base" />
                  <span>וואטסאפ</span>
                </a>
              )}
              {customer.phone && customer.whatsappHref === null && (
                <span className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-bold text-destructive">
                  הטלפון דורש בדיקה
                </span>
              )}
            </div>
            {customer.repeatOrderId === null ? (
              <button
                type="button"
                disabled
                title="אין להזמנה האחרונה מזהה ייחודי ובטוח"
                className="min-h-10 w-full cursor-not-allowed rounded-xl bg-muted px-4 py-2.5 text-xs font-black text-muted-foreground opacity-70"
              >
                הזמנה חוזרת לא זמינה
              </button>
            ) : (
              <Link to={repeatOrderRoute(customer.repeatOrderId)} className={`${primaryLinkClassName} w-full`}>
                <LocalIcon name="ph:plus-circle-bold" className="text-base" />
                <span>הזמנה חדשה כמו הקודמת</span>
              </Link>
            )}
          </div>

          <section aria-label={`הערות על ${customer.name}`}>
            <h3 className="text-[0.6875rem] font-black text-muted-foreground">הערות על הלקוח</h3>
            <div className="mt-2 min-h-24 whitespace-pre-wrap rounded-2xl border border-border bg-secondary/30 p-4 text-xs font-medium leading-6 text-foreground">
              {customer.notes || 'אין הערות שמורות.'}
            </div>
          </section>
        </div>

        <details className="mt-7 border-t border-border pt-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-black text-primary">
            <span className="flex items-center gap-2">
              <LocalIcon name="ph:clock-bold" className="text-lg text-muted-foreground" />
              <span>כל ההזמנות ({customer.orderCount})</span>
            </span>
            <LocalIcon name="ph:arrow-left-bold" className="text-base text-muted-foreground" />
          </summary>
          <ul className="mt-4 space-y-2">
            {customer.history.map((item) => (
              <HistoryRow
                key={`${item.orderId ?? 'missing'}-${item.sourceIndex}`}
                item={item}
                customerName={customer.name}
              />
            ))}
          </ul>
        </details>
      </div>
    </article>
  )
}

function warningText(warning: CustomerFinanceWarning): string {
  const customer = warning.customerName ? `${warning.customerName}: ` : ''
  if (warning.code === 'INVALID_MONEY' || warning.code === 'MONEY_OVERFLOW') {
    return `${customer}סכום הזמנה אינו תקין, ולכן הסכום המצטבר לא מוצג.`
  }
  if (warning.code === 'DUPLICATE_ORDER_ID') return `${customer}מזהה ההזמנה כפול, ולכן הפתיחה נחסמה.`
  if (warning.code === 'MISSING_ORDER_ID') return `${customer}אין להזמנה מזהה שמאפשר פתיחה.`
  if (warning.code === 'INVALID_PHONE') return `${customer}מספר הטלפון אינו מתאים לחיוג או לוואטסאפ.`
  if (warning.code === 'INVALID_SERVICE_DATE') return `${customer}תאריך ההזמנה אינו תקין.`
  if (warning.code === 'INVALID_QUANTITY' || warning.code === 'QUANTITY_OVERFLOW') {
    return `${customer}כמות הזוגיות אינה תקינה.`
  }
  if (warning.code === 'MISSING_CUSTOMER_IDENTITY') return 'קיימת הזמנה ללא שם או טלפון שאפשר לזהות.'
  if (warning.code === 'AMBIGUOUS_CUSTOMER_META') return `${customer}נמצאו כמה הערות שונות ללקוח הזה.`
  if (warning.code === 'INVALID_CUSTOMER_META') return `${customer}אחד מפרטי הלקוח השמורים אינו תקין.`
  return `${customer}אחד משדות הלקוח ארוך מדי.`
}

function CustomerWarnings({ warnings }: { warnings: readonly CustomerFinanceWarning[] }) {
  if (warnings.length === 0) return null
  return (
    <section className="rounded-3xl border border-rose-200 bg-rose-50/70 p-5" role="alert">
      <div className="flex items-start gap-3">
        <LocalIcon name="ph:warning-circle-bold" className="mt-0.5 text-xl text-destructive" />
        <div>
          <h2 className="font-black text-primary">יש נתוני לקוחות שדורשים בדיקה</h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm leading-6 text-rose-800">
            {warnings.map((warning, index) => (
              <li key={`${warning.code}-${String(warning.orderId)}-${warning.path}-${index}`}>
                {warningText(warning)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

export function CustomersScreen() {
  const storeQuery = useStore()
  const [query, setQuery] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)

  if (storeQuery.isPending) return <ScreenState kind="loading" title="טוענת את הלקוחות" />
  if (storeQuery.isError) {
    return (
      <ScreenState
        kind="error"
        title="לא הצלחנו לטעון את הלקוחות"
        description="הנתונים נשארו ללא שינוי. אפשר לנסות שוב."
        retry={() => {
          void storeQuery.refetch()
        }}
      />
    )
  }

  const directory = buildCustomersDirectory(storeQuery.data.data ?? { orders: [] }, { query })
  if (directory.globallyEmpty) {
    return (
      <ScreenState
        kind="empty"
        title="ספר הלקוחות עדיין ריק"
        description="הלקוחות יופיעו כאן אוטומטית אחרי שתישמר ההזמנה הראשונה."
        action={{ label: 'הזמנה חדשה', icon: 'ph:plus-bold', to: APP_ROUTES.newOrder }}
      />
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-black tracking-tight text-primary sm:text-4xl">
            לקוחות
          </h1>
          <p className="mt-2 text-sm font-bold text-muted-foreground">
            ספר לקוחות, הערות והיסטוריית הזמנות מהנתונים השמורים.
          </p>
        </div>
        <div className="flex w-full max-w-md items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm">
          <label className="sr-only" htmlFor="customers-search">
            חיפוש לקוחות
          </label>
          <input
            ref={searchInput}
            id="customers-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="חיפוש לפי שם, טלפון או הערה..."
            className="min-h-11 min-w-0 flex-1 rounded-xl border-0 bg-secondary/50 px-4 text-sm font-bold text-primary outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/20"
          />
          <button
            type="button"
            onClick={() => {
              setQuery('')
              searchInput.current?.focus()
            }}
            disabled={query.length === 0}
            className="min-h-10 rounded-xl px-3 text-xs font-black text-primary hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
          >
            ניקוי
          </button>
        </div>
      </header>

      <div className="mt-8 space-y-7">
        <CustomerWarnings warnings={directory.warnings} />
        {directory.searchActive && directory.matchCount === 0 ? (
          <ScreenState
            kind="empty"
            title="לא נמצא לקוח"
            description={`אין לקוח שמתאים לחיפוש „${directory.query}”.`}
            className="px-0"
          />
        ) : (
          <>
            {directory.searchActive && (
              <p className="text-sm font-bold text-muted-foreground" role="status">
                נמצאו {directory.matchCount} לקוחות
              </p>
            )}
            {directory.customers.map((customer) => (
              <CustomerCard key={customer.key} customer={customer} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

export default CustomersScreen
