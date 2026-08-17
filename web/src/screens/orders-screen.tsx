import { useRef, useState } from 'react'
import { generatePath, Link } from 'react-router'
import type { To } from 'react-router'
import { APP_ROUTES } from '../app/routes.ts'
import { LocalIcon } from '../components/local-icon.tsx'
import { ScreenState } from '../components/screen-state.tsx'
import { useStore } from '../data/use-store.ts'
import {
  applyOrderQuickFields,
  nextOrderStatus,
  QUICK_PAID_OPTIONS,
  type OrderQuickFields,
} from '../domain/order-quick-actions.ts'
import {
  buildOrdersDashboard,
  type OrdersDateGroup,
  type OrdersDisplayBlock,
  type OrdersLinkedGroup,
  type OrdersOrderView,
  type OrdersSummaryChips,
  type OrdersWarning,
} from '../domain/orders-dashboard.ts'
import type { StoreSaveHandler } from '../domain/settings-catalog.ts'
import { formatUsdMinorUnits } from '../domain/today-dashboard.ts'
import { isVersionedStateEnvelope } from '../services/state-api.ts'

export interface OrderQuickActions {
  readonly update: (orderId: string, fields: OrderQuickFields) => void
  readonly savingOrderId: string | null
}

const primaryLinkClassName =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-black text-primary-foreground shadow-[0_10px_30px_rgba(99,33,40,0.12)] transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

const compactLinkClassName =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-primary transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

function orderRoute(pattern: string, orderId: string): string {
  return generatePath(pattern, { orderId })
}

function preparationRoute(serviceDate: string): To {
  return {
    pathname: APP_ROUTES.preparation,
    search: `?${new URLSearchParams({ date: serviceDate }).toString()}`,
  }
}

function duplicateOrderRoute(orderId: string): To {
  return {
    pathname: APP_ROUTES.newOrder,
    search: `?${new URLSearchParams({ duplicate: orderId }).toString()}`,
  }
}

function statusClassName(status: string): string {
  if (status === 'מוכנה') return 'border-emerald-100 bg-emerald-50 text-emerald-700'
  if (status === 'נמסרה') return 'border-border bg-muted text-muted-foreground'
  if (status === 'אושרה' || status === 'במשלוח') {
    return 'border-amber-100 bg-amber-50 text-amber-800'
  }
  return 'border-rose-100 bg-rose-50 text-rose-700'
}

function paidClassName(label: string): string {
  if (label === 'שולם') return 'border-emerald-100 bg-emerald-50 text-emerald-700'
  if (label === 'מקדמה') return 'border-amber-100 bg-amber-50 text-amber-800'
  if (label === 'שת"פ') return 'border-border bg-muted text-muted-foreground'
  return 'border-rose-100 bg-rose-50 text-rose-700'
}

function summaryLabels(summary: OrdersSummaryChips): string[] {
  const labels: string[] = []
  if (summary.meals !== null && summary.meals > 0) labels.push(`זוגית ×${summary.meals}`)
  if (summary.orderedSalads !== null && summary.orderedSalads > 0) {
    labels.push(`${summary.orderedSalads} סלטים`)
  }
  if (summary.complimentarySalads !== null && summary.complimentarySalads > 0) {
    labels.push(`${summary.complimentarySalads} פינוק`)
  }
  if (summary.distinctExtras !== null && summary.distinctExtras > 0) {
    labels.push(`${summary.distinctExtras} אקסטרות`)
  }
  if (summary.tableSettings !== null && summary.tableSettings > 0) {
    labels.push(`עריכה ל־${summary.tableSettings}`)
  }
  if (summary.challahs !== null && summary.challahs > 0) {
    labels.push(`${summary.challahs} חלות`)
  }
  return labels
}

function OrderNavigation({ order }: { order: OrdersOrderView }) {
  if (order.orderId === null) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-destructive">
          אין מזהה לפתיחה
        </span>
        <button
          type="button"
          disabled
          title="שכפול יופעל רק אחרי חיבור השמירה המוגנת"
          className="min-h-10 cursor-not-allowed rounded-xl border border-border bg-muted px-3 py-2 text-xs font-bold text-muted-foreground opacity-70"
        >
          שכפול לא זמין
        </button>
      </div>
    )
  }

  const editHref = orderRoute(APP_ROUTES.editOrder, order.orderId)
  const bonHref = orderRoute(APP_ROUTES.orderBon, order.orderId)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link to={editHref} className={compactLinkClassName} aria-label={`פתיחת ההזמנה של ${order.customerName}`}>
        <LocalIcon name="ph:arrow-left-bold" className="text-base" />
        <span>פתיחה</span>
      </Link>
      <Link to={editHref} className={compactLinkClassName}>
        <LocalIcon name="ph:pencil-simple-bold" className="text-base" />
        <span>עריכה</span>
      </Link>
      <Link to={bonHref} className={compactLinkClassName}>
        <LocalIcon name="ph:package-bold" className="text-base" />
        <span>בון</span>
      </Link>
      {order.whatsappHref && (
        <a
          href={order.whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className={compactLinkClassName}
        >
          <LocalIcon name="ph:arrow-left-bold" className="text-base" />
          <span>וואטסאפ</span>
        </a>
      )}
      {order.phone && !order.whatsappHref && (
        <button
          type="button"
          disabled
          title="וואטסאפ ייפתח אחרי תיקון הנתונים המסומנים"
          className="min-h-10 cursor-not-allowed rounded-xl border border-border bg-muted px-3 py-2 text-xs font-bold text-muted-foreground opacity-70"
        >
          וואטסאפ לא זמין
        </button>
      )}
      <Link to={duplicateOrderRoute(order.orderId)} className={compactLinkClassName}>
        <LocalIcon name="ph:plus-circle-bold" className="text-base" />
        <span>שכפול</span>
      </Link>
    </div>
  )
}

function OrderQuickBar({ order, quick }: { order: OrdersOrderView; quick?: OrderQuickActions }) {
  if (!quick || order.orderId === null || order.cancelled) return null
  const next = nextOrderStatus(order.status)
  const saving = quick.savingOrderId === order.orderId
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {next !== null && (
        <button
          type="button"
          disabled={saving}
          onClick={() => quick.update(order.orderId!, { status: next })}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary px-4 text-xs font-black text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <LocalIcon name="ph:check-circle-bold" className="text-base" />
          <span>{saving ? 'שומרת...' : `העברה ל"${next}"`}</span>
        </button>
      )}
      <label className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-black text-primary">
        <span>תשלום:</span>
        <select
          aria-label={`סטטוס תשלום — ${order.customerName}`}
          value=""
          disabled={saving}
          onChange={(event) => {
            const value = event.currentTarget.value
            if (value !== '') quick.update(order.orderId!, { paid: value })
          }}
          className="bg-transparent font-black outline-none"
        >
          <option value="">{order.paidLabel}</option>
          {QUICK_PAID_OPTIONS.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </label>
    </div>
  )
}

function OrderCard({ order, quick }: { order: OrdersOrderView; quick?: OrderQuickActions }) {
  const labels = summaryLabels(order.summary)
  const hasInvalidSummary = Object.values(order.summary).some((value) => value === null)

  return (
    <article
      className={`rounded-[2rem] border border-border bg-card p-5 shadow-sm sm:p-6 ${order.cancelled ? 'opacity-60' : ''}`}
      data-cancelled={order.cancelled || undefined}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-black text-primary">{order.customerName}</h3>
            <span className={`rounded-full border px-2.5 py-1 text-[0.6875rem] font-black ${statusClassName(order.status)}`}>
              {order.status}
            </span>
            <span className={`rounded-full border px-2.5 py-1 text-[0.6875rem] font-black ${paidClassName(order.paidLabel)}`}>
              {order.paidLabel}
            </span>
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs font-bold text-muted-foreground">
            <LocalIcon name={order.pickup ? 'ph:storefront-bold' : 'ph:map-pin-bold'} className="text-base text-primary" />
            <span>{order.destination}</span>
            {order.time && <span>· {order.time}</span>}
            {order.telephoneHref && (
              <>
                <span>·</span>
                <a className="text-primary underline underline-offset-4" href={order.telephoneHref}>
                  {order.phone}
                </a>
              </>
            )}
          </p>
        </div>

        {order.totalState === 'valid' && order.totalMinorUnits !== null ? (
          <strong className="text-xl font-black text-primary" dir="ltr">
            {formatUsdMinorUnits(order.totalMinorUnits)}
          </strong>
        ) : order.totalState === 'invalid' ? (
          <strong className="text-sm font-black text-destructive">סכום לא תקין</strong>
        ) : null}
      </div>

      {(labels.length > 0 || hasInvalidSummary) && (
        <div className="mt-4 flex flex-wrap gap-2 rounded-2xl bg-secondary/60 p-3 text-xs font-bold text-primary">
          {labels.map((label) => (
            <span key={label} className="rounded-full border border-border bg-card px-2.5 py-1">
              {label}
            </span>
          ))}
          {hasInvalidSummary && (
            <span className="rounded-full border border-rose-100 bg-rose-50 px-2.5 py-1 text-destructive">
              כמות לא תקינה
            </span>
          )}
        </div>
      )}

      <details className="mt-4 rounded-2xl border border-border bg-background/60 px-4 py-3">
        <summary className="cursor-pointer text-xs font-black text-primary">כרטיס הזמנה מלא</summary>
        <pre className="mt-3 whitespace-pre-wrap font-sans text-xs leading-6 text-muted-foreground">
          {order.formattedText}
        </pre>
      </details>

      <OrderQuickBar order={order} quick={quick} />

      <div className="mt-5 border-t border-border pt-4">
        <OrderNavigation order={order} />
      </div>
    </article>
  )
}

function LinkedGroup({ group, quick }: { group: OrdersLinkedGroup; quick?: OrderQuickActions }) {
  return (
    <section className="rounded-[2rem] border-2 border-primary/10 bg-card p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-col gap-3 rounded-2xl bg-secondary/60 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-xs font-black text-primary">
            <LocalIcon name="ph:users-bold" className="text-lg" />
            <span>הזמנה קבוצתית: {group.name}</span>
          </p>
          <h3 className="mt-1 text-lg font-black text-primary">{group.memberCount} משפחות</h3>
          {group.activeDestinations.length > 0 && (
            <p className="mt-1 text-xs font-bold text-muted-foreground">
              {group.activeDestinations.join(' · ')}
            </p>
          )}
        </div>
        {group.activeTotalComplete && group.activeTotalMinorUnits !== null ? (
          <span className="text-sm font-black text-primary" dir="ltr">
            {formatUsdMinorUnits(group.activeTotalMinorUnits)}
          </span>
        ) : (
          <span className="text-xs font-black text-destructive">לא ניתן לחשב סה״כ קבוצה</span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {group.orders.map((order) => (
          <OrderCard key={`${order.orderId ?? 'missing'}-${order.sourceIndex}`} order={order} quick={quick} />
        ))}
      </div>
    </section>
  )
}

function DisplayBlock({ block, quick }: { block: OrdersDisplayBlock; quick?: OrderQuickActions }) {
  return block.kind === 'linked-group' ? (
    <LinkedGroup group={block} quick={quick} />
  ) : (
    <OrderCard order={block.order} quick={quick} />
  )
}

function DateGroup({ group, quick, blockFilter }: {
  group: OrdersDateGroup
  quick?: OrderQuickActions
  blockFilter?: (order: OrdersOrderView) => boolean
}) {
  const blocks = blockFilter === undefined
    ? group.blocks
    : group.blocks.filter((block) =>
        block.kind === 'linked-group'
          ? block.orders.some((order) => blockFilter(order))
          : blockFilter(block.order),
      )
  if (blocks.length === 0) return null
  return <DateGroupBody group={group} quick={quick} blocks={blocks} />
}

function DateGroupBody({ group, quick, blocks }: {
  group: OrdersDateGroup
  quick?: OrderQuickActions
  blocks: readonly OrdersDisplayBlock[]
}) {
  const capacityText =
    group.activeMeals === null
      ? 'לא ניתן לחשב זוגיות'
      : group.capacity.kind === 'configured' && group.dateKind === 'dated'
        ? `${group.activeMeals}/${group.capacity.maximumMeals} זוגיות${group.full === true ? ' · מלא' : ''}`
        : `${group.activeMeals} זוגיות`

  return (
    <section className="space-y-5" data-date-group={group.key}>
      <header className="flex flex-col gap-4 border-b border-border py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-black text-primary">
            <LocalIcon name="ph:calendar-bold" className="text-xl" />
            <span>{group.localizedDate}</span>
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-black text-muted-foreground">
            <span>{group.orderCount} הזמנות</span>
            <span>·</span>
            <span className={group.full === true ? 'text-destructive' : ''}>{capacityText}</span>
            <span>·</span>
            {group.activeRevenueMinorUnits === null ? (
              <span className="text-destructive">לא ניתן לחשב הכנסה</span>
            ) : (
              <span className="text-primary" dir="ltr">
                {formatUsdMinorUnits(group.activeRevenueMinorUnits)}
              </span>
            )}
          </div>
        </div>
        {group.serviceDate && (
          <Link to={preparationRoute(group.serviceDate)} className={compactLinkClassName}>
            <LocalIcon name="ph:cooking-pot-bold" className="text-base" />
            <span>לסיכום ההכנות</span>
          </Link>
        )}
      </header>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {blocks.map((block) => (
          <div
            key={block.kind === 'linked-group' ? `group-${block.name}` : `single-${block.order.orderId ?? block.order.sourceIndex}`}
            className={block.kind === 'linked-group' ? 'lg:col-span-2' : ''}
          >
            <DisplayBlock block={block} quick={quick} />
          </div>
        ))}
      </div>
    </section>
  )
}

function Warnings({ warnings }: { warnings: readonly OrdersWarning[] }) {
  if (warnings.length === 0) return null
  return (
    <section className="rounded-3xl border border-rose-200 bg-rose-50/70 p-5" role="alert">
      <div className="flex items-start gap-3">
        <LocalIcon name="ph:warning-circle-bold" className="mt-0.5 text-xl text-destructive" />
        <div>
          <h2 className="font-black text-primary">יש הזמנות עם נתונים שדורשים בדיקה</h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm leading-6 text-rose-800">
            {warnings.map((warning, index) => (
              <li key={`${warning.code}-${String(warning.orderId)}-${warning.path}-${index}`}>
                {warning.customerName ? `${warning.customerName}: ` : ''}
                {warning.code === 'INVALID_MONEY' || warning.code === 'MONEY_OVERFLOW'
                  ? 'הסכום או המקדמה אינם תקינים.'
                  : warning.code === 'INVALID_SERVICE_DATE'
                    ? 'התאריך אינו תקין.'
                    : warning.code === 'MISSING_ORDER_ID'
                      ? 'אין מזהה שמאפשר לפתוח את ההזמנה.'
                      : warning.code === 'DUPLICATE_ORDER_ID'
                        ? 'המזהה כפול, ולכן פעולות פתיחה נחסמו.'
                      : warning.code === 'INVALID_CAPACITY'
                        ? 'תקרת הזוגיות אינה תקינה.'
                        : warning.code === 'TEXT_TOO_LONG'
                          ? 'אחד משדות הטקסט ארוך מדי.'
                          : warning.code === 'INVALID_STRUCTURE'
                            ? 'מבנה אחד הפריטים אינו תקין.'
                        : 'אחת הכמויות אינה תקינה.'}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

const STATUS_FILTERS = ['הכל', 'פעילות', 'חדשה', 'אושרה', 'מוכנה', 'במשלוח', 'נמסרה'] as const
const PAYMENT_FILTERS = ['הכל', 'לא שולם', 'שולם'] as const

export function OrdersScreen({ onSave }: { readonly onSave?: StoreSaveHandler } = {}) {
  const storeQuery = useStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('הכל')
  const [paymentFilter, setPaymentFilter] = useState<(typeof PAYMENT_FILTERS)[number]>('הכל')
  const [savingOrderId, setSavingOrderId] = useState<string | null>(null)
  const [quickError, setQuickError] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)

  const quick: OrderQuickActions | undefined = onSave === undefined
    ? undefined
    : {
        savingOrderId,
        update: (orderId, fields) => {
          void (async () => {
            const envelope = storeQuery.data
            if (envelope === undefined || !isVersionedStateEnvelope(envelope)) {
              setQuickError('השמירה המהירה אינה זמינה כרגע — הנתונים עדיין נטענים.')
              return
            }
            const nextStore = applyOrderQuickFields(envelope.data, orderId, fields)
            if (nextStore === null) {
              setQuickError('אי אפשר לעדכן את ההזמנה — המזהה חסר או כפול.')
              return
            }
            setSavingOrderId(orderId)
            setQuickError('')
            try {
              await onSave({
                reason: 'orders',
                baseEnvelope: envelope,
                baseStore: envelope.data,
                nextStore,
              })
            } catch {
              setQuickError('העדכון המהיר נכשל — ההזמנה לא שונתה. אפשר לנסות שוב.')
            } finally {
              setSavingOrderId(null)
            }
          })()
        },
      }

  const blockFilter = statusFilter === 'הכל' && paymentFilter === 'הכל'
    ? undefined
    : (order: OrdersOrderView): boolean => {
        if (statusFilter === 'פעילות') {
          if (order.cancelled || order.status === 'נמסרה') return false
        } else if (statusFilter !== 'הכל' && order.status !== statusFilter) {
          return false
        }
        if (paymentFilter === 'שולם' && order.paidLabel !== 'שולם') return false
        if (paymentFilter === 'לא שולם' && order.paidLabel === 'שולם') return false
        return true
      }

  if (storeQuery.isPending) {
    return <ScreenState kind="loading" title="טוענת את ההזמנות" />
  }
  if (storeQuery.isError) {
    return (
      <ScreenState
        kind="error"
        title="לא הצלחנו לטעון את ההזמנות"
        description="הנתונים נשארו ללא שינוי. אפשר לנסות שוב."
        retry={() => {
          void storeQuery.refetch()
        }}
      />
    )
  }

  const dashboard = buildOrdersDashboard(storeQuery.data.data ?? { orders: [] }, {
    query: searchQuery,
  })

  if (dashboard.globallyEmpty) {
    return (
      <ScreenState
        kind="empty"
        title="עדיין אין הזמנות"
        description="לוחצים על הזמנה חדשה ומתחילים."
        action={{ label: 'הזמנה חדשה', icon: 'ph:plus-bold', to: APP_ROUTES.newOrder }}
      />
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-black tracking-tight text-primary sm:text-4xl">
            הזמנות
          </h1>
          <p className="mt-2 text-sm font-bold text-muted-foreground">
            כל ההזמנות, הקבוצות והתאריכים במקום אחד.
          </p>
        </div>
        <Link to={APP_ROUTES.newOrder} className={primaryLinkClassName}>
          <LocalIcon name="ph:plus-bold" className="text-lg" />
          <span>הזמנה חדשה</span>
        </Link>
      </header>

      <div className="mt-7 flex items-center gap-3 rounded-3xl border border-border bg-card p-3 shadow-sm">
        <label className="sr-only" htmlFor="orders-search">
          חיפוש הזמנות
        </label>
        <input
          ref={searchInput}
          id="orders-search"
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.currentTarget.value)}
          placeholder="חיפוש: שם, מלון, טלפון, סלט, כל דבר..."
          className="min-h-11 min-w-0 flex-1 rounded-full border-0 bg-secondary/60 px-5 text-sm font-bold text-primary outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/20"
        />
        <button
          type="button"
          onClick={() => {
            setSearchQuery('')
            searchInput.current?.focus()
          }}
          disabled={searchQuery.length === 0}
          className="min-h-11 rounded-full border border-border bg-card px-4 text-xs font-black text-primary transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
        >
          ניקוי
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setStatusFilter(value)}
            className={`min-h-9 rounded-full border px-3.5 text-xs font-black transition-colors ${
              statusFilter === value
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-primary hover:bg-secondary'
            }`}
          >
            {value}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        {PAYMENT_FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setPaymentFilter(value)}
            className={`min-h-9 rounded-full border px-3.5 text-xs font-black transition-colors ${
              paymentFilter === value
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-primary hover:bg-secondary'
            }`}
          >
            {value === 'הכל' ? 'כל תשלום' : value}
          </button>
        ))}
      </div>

      {quickError !== '' && (
        <p role="alert" className="mt-4 rounded-2xl bg-rose-50 p-4 text-sm font-black text-destructive">{quickError}</p>
      )}

      <div className="mt-8 space-y-9">
        <Warnings warnings={dashboard.warnings} />

        {dashboard.searchActive ? (
          dashboard.matchCount === 0 ? (
            <ScreenState
              kind="empty"
              title="לא נמצאו הזמנות"
              description={`אין הזמנות שמתאימות לחיפוש „${dashboard.query}”.`}
              className="px-0"
            />
          ) : (
            <section className="space-y-8">
              <p className="text-sm font-bold text-muted-foreground" role="status">
                נמצאו {dashboard.matchCount} הזמנות, כולל הזמנות שעברו
              </p>
              {dashboard.searchGroups.map((group) => (
                <DateGroup key={group.key} group={group} quick={quick} blockFilter={blockFilter} />
              ))}
            </section>
          )
        ) : (
          <>
            {dashboard.upcomingGroups.length === 0 ? (
              <section className="rounded-3xl border border-border bg-card p-8 text-center shadow-sm">
                <LocalIcon name="ph:package-bold" className="text-3xl text-primary" />
                <h2 className="mt-3 font-black text-primary">אין הזמנות קרובות</h2>
              </section>
            ) : (
              dashboard.upcomingGroups.map((group) => <DateGroup key={group.key} group={group} quick={quick} blockFilter={blockFilter} />)
            )}

            {dashboard.pastGroups.length > 0 && (
              <details className="rounded-[2rem] border border-border bg-card p-5 shadow-sm">
                <summary className="cursor-pointer text-lg font-black text-muted-foreground">
                  הזמנות שעברו ({dashboard.pastOrderCount})
                </summary>
                <div className="mt-6 space-y-9">
                  {dashboard.pastGroups.map((group) => (
                    <DateGroup key={group.key} group={group} quick={quick} blockFilter={blockFilter} />
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default OrdersScreen
