import { useState } from 'react'
import { generatePath, Link } from 'react-router'
import type { To } from 'react-router'
import { APP_ROUTES } from '../app/routes.ts'
import { LocalIcon } from '../components/local-icon.tsx'
import { ScreenState } from '../components/screen-state.tsx'
import { useStore } from '../data/use-store.ts'
import { applyOrderQuickFields, nextOrderStatus } from '../domain/order-quick-actions.ts'
import type { StoreSaveHandler } from '../domain/settings-catalog.ts'
import {
  buildTodayDashboard,
  formatUsdMinorUnits,
  type TodayAttentionAlert,
  type TodayBackupReminder,
  type TodayCapacitySetting,
  type TodayFulfillment,
  type TodayWarning,
} from '../domain/today-dashboard.ts'
import { isVersionedStateEnvelope } from '../services/state-api.ts'

interface TodayQuickActions {
  readonly advance: (orderId: string, nextStatus: string) => void
  readonly savingOrderId: string | null
}

const primaryLinkClassName =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-black text-primary-foreground shadow-[0_10px_30px_rgba(99,33,40,0.12)] transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

const secondaryLinkClassName =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-border bg-card px-5 py-3 text-sm font-bold text-primary transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

const compactLinkClassName =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-primary transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

function preparationRoute(serviceDate?: string): To {
  if (serviceDate === undefined) return APP_ROUTES.preparation
  return {
    pathname: APP_ROUTES.preparation,
    search: `?${new URLSearchParams({ date: serviceDate }).toString()}`,
  }
}

function editOrderRoute(orderId: string): string {
  return generatePath(APP_ROUTES.editOrder, { orderId })
}

function statusClassName(status: string): string {
  if (status === 'מוכנה') return 'border-emerald-100 bg-emerald-50 text-emerald-700'
  if (status === 'נמסרה') return 'border-border bg-muted text-muted-foreground'
  if (status === 'אושרה' || status === 'במשלוח') {
    return 'border-amber-100 bg-amber-50 text-amber-800'
  }
  return 'border-rose-100 bg-rose-50 text-rose-700'
}

function EditOrderLink({ orderId }: { orderId: string | null }) {
  if (orderId === null) {
    return <span className="text-xs font-bold text-destructive">אין מזהה לפתיחה</span>
  }

  return (
    <Link to={editOrderRoute(orderId)} className={compactLinkClassName}>
      <LocalIcon name="ph:pencil-simple-bold" className="text-base" />
      <span>עריכה</span>
    </Link>
  )
}

function TodayHeader({ greeting, localizedDate }: { greeting: string; localizedDate: string }) {
  return (
    <header className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h1 className="font-heading text-3xl font-black tracking-tight text-primary sm:text-4xl">
          {greeting}
        </h1>
        <p className="mt-2 flex items-center gap-2 text-sm font-bold text-muted-foreground">
          <LocalIcon name="ph:calendar-bold" className="text-lg text-primary" />
          <span>{localizedDate}</span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Link to={APP_ROUTES.newOrder} className={primaryLinkClassName}>
          <LocalIcon name="ph:plus-bold" className="text-lg" />
          <span>הזמנה חדשה</span>
        </Link>
        <Link to={APP_ROUTES.preparation} className={secondaryLinkClassName}>
          <LocalIcon name="ph:cooking-pot-bold" className="text-lg" />
          <span>סיכום הכנות</span>
        </Link>
        <Link to={APP_ROUTES.preparationBons} className={secondaryLinkClassName}>
          <LocalIcon name="ph:receipt-bold" className="text-lg" />
          <span>הדפסת בונים</span>
        </Link>
      </div>
    </header>
  )
}

function BackupReminder({ reminder }: { reminder: TodayBackupReminder }) {
  const title =
    reminder.kind === 'never'
      ? 'עוד לא נשמר קובץ גיבוי'
      : reminder.kind === 'stale'
        ? `עברו ${reminder.daysSinceBackup} ימים מהגיבוי האחרון`
        : 'תאריך הגיבוי האחרון אינו תקין'
  const description =
    reminder.kind === 'invalid'
      ? 'כדאי לבדוק את מצב הגיבוי בהגדרות.'
      : 'מומלץ לשמור גיבוי באופן קבוע כדי להגן על נתוני ההזמנות.'

  return (
    <section className="flex flex-col gap-5 rounded-3xl border border-amber-200 bg-amber-50/60 p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-card text-primary shadow-sm">
          <LocalIcon name="ph:cloud-arrow-up-bold" className="text-2xl" />
        </span>
        <div>
          <h2 className="font-black text-primary">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
      </div>
      <Link to={APP_ROUTES.settings} className={compactLinkClassName}>
        <LocalIcon name="ph:gear-six-bold" className="text-base" />
        <span>להגדרות הגיבוי</span>
      </Link>
    </section>
  )
}

function FulfillmentRow({ fulfillment, quick }: {
  fulfillment: TodayFulfillment
  quick?: TodayQuickActions
}) {
  const locationIcon = fulfillment.pickup ? 'ph:storefront-bold' : 'ph:map-pin-bold'
  const next = nextOrderStatus(fulfillment.status)
  const saving = quick !== undefined && quick.savingOrderId === fulfillment.orderId

  return (
    <li className="flex flex-col gap-4 rounded-3xl border border-border bg-background/70 p-4 sm:flex-row sm:items-center">
      <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-border bg-secondary text-sm font-black text-primary">
        {fulfillment.time ?? <LocalIcon name="ph:truck-bold" className="text-xl" />}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-black text-primary">{fulfillment.customerName}</h3>
          <span
            className={`rounded-full border px-2.5 py-1 text-[0.6875rem] font-black ${statusClassName(fulfillment.status)}`}
          >
            {fulfillment.status}
          </span>
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-bold text-muted-foreground">
          <LocalIcon name={locationIcon} className="text-base text-primary" />
          <span>{fulfillment.destination}</span>
          {fulfillment.meals !== null && <span>· {fulfillment.meals} ארוחות זוגיות</span>}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {quick !== undefined && fulfillment.orderId !== null && next !== null && (
          <button
            type="button"
            disabled={saving}
            onClick={() => quick.advance(fulfillment.orderId!, next)}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary px-4 text-xs font-black text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <LocalIcon name="ph:check-circle-bold" className="text-base" />
            <span>{saving ? 'שומרת...' : `העברה ל"${next}"`}</span>
          </button>
        )}
        <EditOrderLink orderId={fulfillment.orderId} />
      </div>
    </li>
  )
}

function TodayFulfillments({ fulfillments, todayIso, quick }: {
  fulfillments: readonly TodayFulfillment[]
  todayIso: string
  quick?: TodayQuickActions
}) {
  if (fulfillments.length === 0) return null

  return (
    <section className="rounded-[2rem] border border-border bg-card p-6 shadow-sm sm:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xl font-black text-primary">
          <LocalIcon name="ph:clock-bold" className="text-xl" />
          <span>אספקות היום</span>
        </h2>
        <span className="rounded-full bg-secondary px-3 py-1 text-xs font-black text-primary">
          {fulfillments.length} הזמנות פעילות
        </span>
      </div>

      <ul className="space-y-3">
        {fulfillments.map((fulfillment, index) => (
          <FulfillmentRow
            key={`${fulfillment.orderId ?? 'missing'}-${fulfillment.time ?? 'no-time'}-${index}`}
            fulfillment={fulfillment}
            quick={quick}
          />
        ))}
      </ul>

      <Link
        to={preparationRoute(todayIso)}
        className="mt-6 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-secondary px-5 py-3 text-sm font-black text-primary transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span>לסיכום ההכנות של היום</span>
        <LocalIcon name="ph:arrow-left-bold" className="text-lg" />
      </Link>
    </section>
  )
}

function CapacitySettingNote({ capacity }: { capacity: TodayCapacitySetting }) {
  if (capacity.kind === 'configured') return null

  return (
    <div className="mt-6 rounded-2xl bg-secondary p-4 text-sm leading-6 text-muted-foreground">
      {capacity.kind === 'invalid'
        ? 'תקרת הארוחות אינה תקינה, ולכן מד הקיבולת לא מוצג.'
        : 'אפשר להגדיר תקרת ארוחות כדי לראות כאן כמה מקום נשאר לכל תאריך.'}{' '}
      <Link to={APP_ROUTES.settings} className="font-black text-primary underline underline-offset-4">
        להגדרות
      </Link>
    </div>
  )
}

function UpcomingCapacity({
  groups,
  hasUpcomingOrders,
  capacity,
}: {
  groups: ReturnType<typeof buildTodayDashboard>['upcomingGroups']
  hasUpcomingOrders: boolean
  capacity: TodayCapacitySetting
}) {
  return (
    <section className="rounded-[2rem] border border-border bg-card p-6 shadow-sm sm:p-8">
      <h2 className="flex items-center gap-2 text-xl font-black text-primary">
        <LocalIcon name="ph:chart-pie-slice-bold" className="text-xl" />
        <span>העומס הקרוב</span>
      </h2>

      {!hasUpcomingOrders ? (
        <div className="mt-8 flex min-h-48 flex-col items-center justify-center text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-secondary text-primary">
            <LocalIcon name="ph:package-bold" className="text-2xl" />
          </span>
          <h3 className="mt-4 font-black text-primary">אין הזמנות קרובות כרגע</h3>
          <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
            הזמנות עתידיות פעילות יופיעו כאן לפי תאריך.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {groups.map((group) => (
            <article key={group.serviceDate} className="border-b border-border pb-6 last:border-0 last:pb-0">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-sm font-black text-primary">{group.localizedDate}</h3>
                  <p className="mt-1 text-xs font-bold text-muted-foreground">
                    {group.orderCount} הזמנות
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <span className="text-xs font-black text-primary">
                    {group.meals === null
                      ? 'לא ניתן לחשב זוגיות'
                      : capacity.kind === 'configured'
                        ? `${group.meals}/${capacity.maximumMeals} זוגיות`
                        : `${group.meals} זוגיות`}
                  </span>
                  {group.full === true && (
                    <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[0.6875rem] font-black text-rose-700">
                      מלא
                    </span>
                  )}
                  <Link to={preparationRoute(group.serviceDate)} className={compactLinkClassName}>
                    <LocalIcon name="ph:cooking-pot-bold" className="text-base" />
                    <span>מה מכינים</span>
                  </Link>
                </div>
              </div>

              {group.capacityPercent !== null && (
                <div
                  className="mt-3 h-2.5 overflow-hidden rounded-full bg-secondary"
                  role="meter"
                  aria-label={`קיבולת ל${group.localizedDate}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={group.capacityPercent}
                >
                  <div
                    className={`h-full rounded-full ${group.full === true ? 'bg-rose-600' : 'bg-primary'}`}
                    style={{ width: `${group.capacityPercent}%` }}
                  />
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {hasUpcomingOrders && <CapacitySettingNote capacity={capacity} />}
    </section>
  )
}

function AttentionAlertRow({ alert }: { alert: TodayAttentionAlert }) {
  const noDeposit = alert.kind === 'no-deposit'

  return (
    <li
      className={`flex flex-col gap-3 rounded-3xl border p-4 sm:flex-row sm:items-center sm:justify-between ${
        noDeposit ? 'border-rose-100 bg-rose-50/60' : 'border-amber-100 bg-amber-50/60'
      }`}
    >
      <div>
        <h3 className="text-sm font-black text-primary">
          {alert.customerName} · {alert.localizedDate}
        </h3>
        <p className={`mt-1 text-xs font-bold ${noDeposit ? 'text-rose-700' : 'text-amber-800'}`}>
          {noDeposit ? 'בלי מקדמה' : 'ממתינה לאישור'}
        </p>
      </div>
      <EditOrderLink orderId={alert.orderId} />
    </li>
  )
}

function AttentionCard({
  alerts,
  outstandingMinorUnits,
}: {
  alerts: readonly TodayAttentionAlert[]
  outstandingMinorUnits: number | null
}) {
  return (
    <section className="flex flex-col rounded-[2rem] border border-border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xl font-black text-primary">
          <LocalIcon name="ph:warning-circle-bold" className="text-xl text-rose-600" />
          <span>דורש טיפול</span>
        </h2>
        <span className="text-xs font-black text-muted-foreground">{alerts.length} התראות</span>
      </div>

      {alerts.length > 0 ? (
        <ul className="mt-6 flex-1 space-y-3">
          {alerts.map((alert, index) => (
            <AttentionAlertRow
              key={`${alert.kind}-${alert.orderId ?? 'missing'}-${alert.serviceDate}-${index}`}
              alert={alert}
            />
          ))}
        </ul>
      ) : (
        <div className="mt-8 flex flex-1 flex-col items-center justify-center py-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
            <LocalIcon name="ph:check-circle-bold" className="text-2xl" />
          </span>
          <p className="mt-3 text-sm font-bold text-muted-foreground">הכול מסודר — אין התראות.</p>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
        <span className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
          <LocalIcon name="ph:coins-bold" className="text-lg text-primary" />
          <span>סה״כ נשאר לגבות</span>
        </span>
        {outstandingMinorUnits === null ? (
          <span className="max-w-xs text-sm font-black text-destructive">
            לא ניתן לחשב עד לתיקון הסכומים המסומנים
          </span>
        ) : (
          <strong className="text-xl font-black text-primary" dir="ltr">
            {formatUsdMinorUnits(outstandingMinorUnits)}
          </strong>
        )}
      </div>
    </section>
  )
}

function warningText(warning: TodayWarning): string {
  const customer = warning.customerName ? ` בהזמנה של ${warning.customerName}` : ''
  if (warning.code === 'INVALID_MONEY' || warning.code === 'MONEY_OVERFLOW') {
    return `אי אפשר לחשב את היתרה${customer} כי הסכום או המקדמה אינם תקינים.`
  }
  if (warning.code === 'INVALID_MEALS' || warning.code === 'MEALS_OVERFLOW') {
    return `אי אפשר לחשב את כמות הארוחות${customer}.`
  }
  if (warning.code === 'INVALID_SERVICE_DATE') return `תאריך ההזמנה${customer} אינו תקין.`
  if (warning.code === 'MISSING_ORDER_ID') return `אי אפשר לפתוח לעריכה את ההזמנה${customer}.`
  if (warning.code === 'INVALID_CAPACITY') return 'תקרת הארוחות בהגדרות אינה תקינה.'
  return 'תאריך הגיבוי האחרון אינו תקין.'
}

function DataWarnings({ warnings }: { warnings: readonly TodayWarning[] }) {
  if (warnings.length === 0) return null

  return (
    <section className="rounded-3xl border border-rose-200 bg-rose-50/70 p-5" role="alert">
      <div className="flex items-start gap-3">
        <LocalIcon name="ph:warning-circle-bold" className="mt-0.5 text-xl text-destructive" />
        <div>
          <h2 className="font-black text-primary">יש נתונים שדורשים בדיקה</h2>
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

export function TodayScreen({ onSave }: { readonly onSave?: StoreSaveHandler } = {}) {
  const storeQuery = useStore()
  const [savingOrderId, setSavingOrderId] = useState<string | null>(null)
  const [quickError, setQuickError] = useState('')

  const quick: TodayQuickActions | undefined = onSave === undefined
    ? undefined
    : {
        savingOrderId,
        advance: (orderId, nextStatus) => {
          void (async () => {
            const envelope = storeQuery.data
            if (envelope === undefined || !isVersionedStateEnvelope(envelope)) {
              setQuickError('השמירה המהירה אינה זמינה כרגע — הנתונים עדיין נטענים.')
              return
            }
            const nextStore = applyOrderQuickFields(envelope.data, orderId, { status: nextStatus })
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

  if (storeQuery.isPending) {
    return <ScreenState kind="loading" title="טוענת את מסך היום" />
  }

  if (storeQuery.isError) {
    return (
      <ScreenState
        kind="error"
        title="לא הצלחנו לטעון את מסך היום"
        description="הנתונים נשארו ללא שינוי. אפשר לנסות שוב."
        retry={() => {
          void storeQuery.refetch()
        }}
      />
    )
  }

  const dashboard = buildTodayDashboard(storeQuery.data.data ?? { orders: [] })

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      <TodayHeader greeting={dashboard.greeting} localizedDate={dashboard.localizedDate} />

      {dashboard.globallyEmpty ? (
        <ScreenState
          kind="empty"
          title="עדיין אין הזמנות"
          description="יוצרים הזמנה ראשונה, והיא תופיע כאן עם ההכנות והאספקה שלה."
          action={{
            label: 'הזמנה חדשה',
            icon: 'ph:plus-bold',
            to: APP_ROUTES.newOrder,
          }}
          className="px-0"
        />
      ) : (
        <div className="mt-8 space-y-8">
          <DataWarnings warnings={dashboard.warnings} />
          {dashboard.backupReminder && <BackupReminder reminder={dashboard.backupReminder} />}
          {quickError !== '' && (
            <p role="alert" className="rounded-2xl bg-rose-50 p-4 text-sm font-black text-destructive">{quickError}</p>
          )}
          <TodayFulfillments
            fulfillments={dashboard.fulfillments}
            todayIso={dashboard.todayIso}
            quick={quick}
          />
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <UpcomingCapacity
              groups={dashboard.upcomingGroups}
              hasUpcomingOrders={dashboard.hasUpcomingOrders}
              capacity={dashboard.capacity}
            />
            <AttentionCard
              alerts={dashboard.alerts}
              outstandingMinorUnits={dashboard.outstandingMinorUnits}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default TodayScreen
