import { useState } from 'react'
import { generatePath, Link } from 'react-router'
import { APP_ROUTES } from '../app/routes.ts'
import { LocalIcon } from '../components/local-icon.tsx'
import { ScreenState } from '../components/screen-state.tsx'
import { useStore } from '../data/use-store.ts'
import {
  buildDeliveryDashboard,
  type DeliveryDateGroup,
  type DeliveryDestinationGroup,
  type DeliveryOrderView,
  type DeliveryWarning,
} from '../domain/delivery-dashboard.ts'
import { formatUsdMinorUnits } from '../domain/today-dashboard.ts'

const actionClassName =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-primary transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

function editOrderHref(orderId: string): string {
  return generatePath(APP_ROUTES.editOrder, { orderId: encodeURIComponent(orderId) })
}

function statusClassName(status: string): string {
  if (status === 'מוכנה') return 'border-emerald-100 bg-emerald-50 text-emerald-700'
  if (status === 'במשלוח' || status === 'אושרה') return 'border-amber-100 bg-amber-50 text-amber-800'
  return 'border-rose-100 bg-rose-50 text-rose-700'
}

function warningText(warning: DeliveryWarning): string {
  const prefix = warning.customerName ? `${warning.customerName}: ` : ''
  if (warning.code === 'MISSING_ORDER_ID') return `${prefix}אין מזהה בטוח לפתיחת ההזמנה.`
  if (warning.code === 'DUPLICATE_ORDER_ID') return `${prefix}מזהה ההזמנה כפול ולכן פתיחת העריכה נחסמה.`
  if (warning.code === 'INVALID_SERVICE_DATE') return `${prefix}תאריך האספקה חסר או אינו תקין.`
  if (warning.code === 'MISSING_DESTINATION') return `${prefix}לא נשמר יעד או כתובת למשלוח.`
  if (warning.code === 'INVALID_PHONE') return `${prefix}מספר הטלפון אינו בטוח לפתיחה.`
  if (warning.code === 'INVALID_MONEY' || warning.code === 'MONEY_OVERFLOW') {
    return `${prefix}סכום או מקדמה אינם תקינים, ולכן הגבייה לא חושבה.`
  }
  return `${prefix}שדה טקסט ארוך מדי ולכן הפעולה המתאימה נחסמה.`
}

function Warnings({ warnings }: { warnings: readonly DeliveryWarning[] }) {
  if (warnings.length === 0) return null
  return (
    <section className="rounded-3xl border border-rose-200 bg-rose-50/70 p-5" role="alert">
      <div className="flex items-start gap-3">
        <LocalIcon name="ph:warning-circle-bold" className="mt-0.5 text-2xl text-destructive" />
        <div>
          <h2 className="font-black text-primary">יש אספקות שדורשות בדיקה</h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm leading-6 text-rose-900">
            {warnings.map((warning, index) => (
              <li key={`${warning.code}-${String(warning.orderId)}-${warning.path}-${index}`}>{warningText(warning)}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

function Collection({ order }: { order: DeliveryOrderView }) {
  if (order.collectionState === 'invalid') {
    return <span className="text-xs font-black text-destructive">גבייה לא מחושבת</span>
  }
  if (order.collectionState === 'absent' || order.collectionMinorUnits === null) {
    return <span className="text-xs font-black text-muted-foreground">סכום לא הוזן</span>
  }
  if (order.collectionMinorUnits === 0) {
    return <span className="text-xs font-black text-emerald-700">שולם</span>
  }
  return (
    <span className="text-xs font-black text-destructive">
      לגבות <span dir="ltr">{formatUsdMinorUnits(order.collectionMinorUnits)}</span>
    </span>
  )
}

function OrderActions({ order }: { order: DeliveryOrderView }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {order.telephoneHref && (
        <a href={order.telephoneHref} className={actionClassName}>
          <span>טלפון</span>
        </a>
      )}
      {order.orderId === null ? (
        <span className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-destructive">עריכה לא זמינה</span>
      ) : (
        <Link to={editOrderHref(order.orderId)} className={actionClassName}>
          <LocalIcon name="ph:pencil-simple-bold" className="text-base" />
          <span>עריכה</span>
        </Link>
      )}
      <button
        type="button"
        disabled
        title="עדכון סטטוס יופעל רק אחרי חיבור השמירה המוגנת"
        className="min-h-10 cursor-not-allowed rounded-xl border border-border bg-muted px-3 py-2 text-xs font-bold text-muted-foreground opacity-70"
      >
        עדכון סטטוס לא זמין
      </button>
    </div>
  )
}

function DeliveryOrder({ order, sequence }: { order: DeliveryOrderView; sequence: number }) {
  return (
    <li className="rounded-2xl bg-background/70 p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-black text-primary-foreground">{sequence}</span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {order.time && <span className="text-xs font-black text-muted-foreground">{order.time}</span>}
              <h3 className="font-black text-primary">{order.customerName}</h3>
              <span className={`rounded-full border px-2.5 py-1 text-[0.6875rem] font-black ${statusClassName(order.status)}`}>{order.status}</span>
              {order.groupName && <span className="rounded-full bg-secondary px-2.5 py-1 text-[0.6875rem] font-black text-primary">{order.groupName}</span>}
            </div>
            <div className="mt-2"><Collection order={order} /></div>
          </div>
        </div>
        <OrderActions order={order} />
      </div>
    </li>
  )
}

function Destination({ destination }: { destination: DeliveryDestinationGroup }) {
  return (
    <article className="rounded-[2rem] border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-xs font-black text-muted-foreground">
            <LocalIcon name="ph:map-pin-bold" className="text-lg text-primary" />
            <span>{destination.orderCount} משלוחים ליעד</span>
          </p>
          <h2 className="mt-1 text-xl font-black text-primary">{destination.destination}</h2>
          {destination.address && <p className="mt-1 text-sm font-bold text-muted-foreground">{destination.address}</p>}
          <p className={`mt-2 text-xs font-black ${destination.collectionComplete ? 'text-primary' : 'text-destructive'}`}>
            {destination.collectionComplete && destination.collectionMinorUnits !== null
              ? <>גבייה ביעד: <span dir="ltr">{formatUsdMinorUnits(destination.collectionMinorUnits)}</span></>
              : 'הגבייה ביעד אינה מלאה'}
          </p>
        </div>
        {destination.navigationHref ? (
          <a href={destination.navigationHref} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-black text-primary-foreground">
            <LocalIcon name="ph:map-pin-bold" className="text-lg" />
            <span>ניווט ליעד</span>
          </a>
        ) : (
          <span className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-destructive">ניווט לא זמין</span>
        )}
      </div>
      <ol className="mt-5 space-y-3">
        {destination.orders.map((order, index) => (
          <DeliveryOrder key={`${order.orderId ?? 'missing'}-${order.sourceIndex}`} order={order} sequence={index + 1} />
        ))}
      </ol>
    </article>
  )
}

function Pickups({ orders }: { orders: readonly DeliveryOrderView[] }) {
  if (orders.length === 0) return null
  return (
    <section className="rounded-[2rem] border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex items-center gap-2 border-b border-border pb-4">
        <LocalIcon name="ph:storefront-bold" className="text-xl text-primary" />
        <h2 className="text-xl font-black text-primary">איסוף עצמי ({orders.length})</h2>
      </div>
      <ol className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {orders.map((order, index) => (
          <DeliveryOrder key={`${order.orderId ?? 'missing'}-${order.sourceIndex}`} order={order} sequence={index + 1} />
        ))}
      </ol>
    </section>
  )
}

function DateSummary({ group }: { group: DeliveryDateGroup }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[
        ['אספקות', group.orderCount],
        ['משלוחים', group.deliveryOrderCount],
        ['איסופים', group.pickupOrderCount],
      ].map(([label, value]) => (
        <div key={label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <span className="text-[0.6875rem] font-black text-muted-foreground">{label}</span>
          <strong className="mt-1 block text-xl font-black text-primary">{value}</strong>
        </div>
      ))}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <span className="text-[0.6875rem] font-black text-muted-foreground">גבייה</span>
        <strong className={`mt-1 block text-lg font-black ${group.collectionComplete ? 'text-primary' : 'text-destructive'}`} dir={group.collectionComplete ? 'ltr' : undefined}>
          {group.collectionComplete && group.collectionMinorUnits !== null
            ? formatUsdMinorUnits(group.collectionMinorUnits)
            : 'לא מלאה'}
        </strong>
      </div>
    </div>
  )
}

export function DeliveriesScreen() {
  const storeQuery = useStore()
  const [selectedGroupKey, setSelectedGroupKey] = useState('')

  if (storeQuery.isPending) return <ScreenState kind="loading" title="טוענת את האספקות" />
  if (storeQuery.isError) {
    return (
      <ScreenState
        kind="error"
        title="לא הצלחנו לטעון את האספקות"
        description="הנתונים נשארו ללא שינוי. אפשר לנסות שוב."
        retry={() => { void storeQuery.refetch() }}
      />
    )
  }

  const dashboard = buildDeliveryDashboard(storeQuery.data.data ?? { orders: [] })
  if (dashboard.globallyEmpty) {
    return (
      <ScreenState
        kind="empty"
        title="אין עדיין אספקות"
        description="משלוחים ואיסופים יופיעו כאן מתוך ההזמנות הפעילות."
        action={{ label: 'לכל ההזמנות', icon: 'ph:list-checks-bold', to: APP_ROUTES.orders }}
      />
    )
  }
  if (dashboard.activeEmpty) {
    return (
      <ScreenState
        kind="empty"
        title="אין אספקות פעילות"
        description={`${dashboard.excludedOrderCount} הזמנות שבוטלו או נמסרו אינן מוצגות בלוח הפעיל.`}
        action={{ label: 'לכל ההזמנות', icon: 'ph:list-checks-bold', to: APP_ROUTES.orders }}
      />
    )
  }

  const selectedGroup = dashboard.groups.find(({ key }) => key === selectedGroupKey) ?? dashboard.groups[0]!

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-black tracking-tight text-primary sm:text-4xl">משלוחים ואיסופים</h1>
          <p className="mt-2 text-sm font-bold text-muted-foreground">יעדים, זמני אספקה וגבייה מתוך ההזמנות הפעילות.</p>
        </div>
        <label className="flex flex-col gap-1 text-xs font-black text-muted-foreground">
          תאריך אספקה
          <select
            aria-label="תאריך אספקה"
            value={selectedGroup.key}
            onChange={(event) => setSelectedGroupKey(event.currentTarget.value)}
            className="min-h-11 rounded-xl border border-border bg-card px-4 text-sm font-bold text-primary outline-none focus:ring-2 focus:ring-primary/20"
          >
            {dashboard.groups.map((group) => <option key={group.key} value={group.key}>{group.localizedDate}</option>)}
          </select>
        </label>
      </header>

      <div className="mt-8 space-y-8">
        <Warnings warnings={dashboard.warnings} />
        <section aria-label={selectedGroup.localizedDate} className="space-y-6">
          <h2 className="flex items-center gap-2 text-xl font-black text-primary">
            <LocalIcon name="ph:calendar-bold" className="text-xl" />
            <span>{selectedGroup.localizedDate}</span>
          </h2>
          <DateSummary group={selectedGroup} />
          {selectedGroup.destinations.map((destination) => <Destination key={destination.key} destination={destination} />)}
          <Pickups orders={selectedGroup.pickups} />
        </section>
      </div>
    </div>
  )
}

export default DeliveriesScreen
