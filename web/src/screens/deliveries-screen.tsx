import { useRef, useState } from 'react'
import { generatePath, Link } from 'react-router'
import { APP_ROUTES } from '../app/routes.ts'
import { DeliveriesMap, type DeliveryMapStop } from '../components/deliveries-map.tsx'
import { LocalIcon } from '../components/local-icon.tsx'
import { ScreenState } from '../components/screen-state.tsx'
import { useStore } from '../data/use-store.ts'
import {
  isSameVersionedStateEnvelope,
  type ConfirmedStoreSaveHandler,
} from '../data/versioned-screen-save.tsx'
import {
  buildDeliveryDashboard,
  type DeliveryDateGroup,
  type DeliveryDestinationGroup,
  type DeliveryOrderView,
  type DeliveryWarning,
} from '../domain/delivery-dashboard.ts'
import {
  applyNextDeliveryStatus,
  nextDeliveryStatus,
} from '../domain/operational-state.ts'
import {
  PLATA_STATUS_LABELS,
  summarizeOutstandingPlata,
  type PlataStatus,
} from '../domain/plata.ts'
import {
  applyRouteOverride,
  buildMultiStopMapsUrl,
  readRouteOverride,
  stopCoordinates,
  suggestRouteOrder,
} from '../domain/route-order.ts'
import { upcomingServiceDate } from '../domain/service-dates.ts'
import type { LegacyOrder, LegacyStore } from '../domain/store.ts'
import { formatUsdMinorUnits } from '../domain/today-dashboard.ts'
import { isVersionedStateEnvelope, type VersionedStateEnvelope } from '../services/state-api.ts'

const actionClassName =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-primary transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

const navigationActionClassName =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-black text-primary-foreground'

const DELIVERED_STATUS = 'נמסרה'
const IN_TRANSIT_STATUS = 'במשלוח'
const COURIER_LOCATION_MAX_AGE_MS = 3 * 60 * 60 * 1000

interface DeliveriesInitialization {
  readonly baseEnvelope: VersionedStateEnvelope | null
  readonly baseStore: LegacyStore
}

interface DeliverySaveState {
  readonly kind: 'saving' | 'saved' | 'error'
  readonly message: string
}

function editOrderHref(orderId: string): string {
  return generatePath(APP_ROUTES.editOrder, { orderId })
}

function statusClassName(status: string): string {
  if (status === 'מוכנה') return 'border-emerald-100 bg-emerald-50 text-emerald-700'
  if (status === IN_TRANSIT_STATUS || status === 'אושרה') return 'border-amber-100 bg-amber-50 text-amber-800'
  return 'border-rose-100 bg-rose-50 text-rose-700'
}

// A plate still with a customer is the normal state on delivery day; amber is the one that
// needs Felix to do something, and a returned deposit is closed business.
function plataClassName(status: PlataStatus): string {
  if (status === 'awaitingPickup') return 'border-amber-100 bg-amber-50 text-amber-800'
  if (status === 'collected') return 'border-emerald-100 bg-emerald-50 text-emerald-700'
  if (status === 'depositReturned') return 'border-border bg-muted text-muted-foreground'
  return 'border-border bg-secondary text-primary'
}

function PlataBadge({ order }: { order: DeliveryOrderView }) {
  if (order.plataCount === 0 || order.plataStatus === null) return null
  const countText = order.plataCount > 1 ? ` ×${order.plataCount}` : ''
  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[0.6875rem] font-black ${plataClassName(order.plataStatus)}`}
      title={PLATA_STATUS_LABELS[order.plataStatus]}
    >
      {`פלטה${countText} · ${PLATA_STATUS_LABELS[order.plataStatus]}`}
    </span>
  )
}

function checkinClassName(state: NonNullable<DeliveryOrderView['checkinState']>): string {
  if (state === 'onTime') return 'border-emerald-100 bg-emerald-50 text-emerald-700'
  if (state === 'delayed') return 'border-rose-100 bg-rose-50 text-rose-700'
  return 'border-sky-100 bg-sky-50 text-sky-700'
}

interface RoutePlan {
  readonly sequence: readonly DeliveryOrderView[]
  readonly rankByView: ReadonlyMap<DeliveryOrderView, number>
  readonly mapsUrls: readonly string[]
  readonly mapStops: readonly DeliveryMapStop[]
}

// Screen-level plumbing for the manual route reorder controls (drag handle plus
// up/down arrows, same pattern as the menu editor). Stops are identified by their
// string order id because the view objects are rebuilt on every render.
interface RouteReorder {
  readonly draggedId: string | null
  readonly count: number
  readonly busy: boolean
  readonly start: (view: DeliveryOrderView) => void
  readonly cancel: () => void
  readonly dropOn: (target: DeliveryOrderView) => void
  readonly moveTo: (view: DeliveryOrderView, targetIndex: number) => void
}

// The suggested driving sequence needs the stored coordinates, which the dashboard view
// intentionally does not carry, so the plan is derived from the original orders and mapped
// back onto the views by their source index. A manual override saved by the operator is
// applied on top of the suggested order.
function buildRoutePlan(
  store: Readonly<LegacyStore>,
  group: DeliveryDateGroup,
  overrideIds: readonly string[] | null,
): RoutePlan {
  const viewByOrder = new Map<LegacyOrder, DeliveryOrderView>()
  const stops: LegacyOrder[] = []
  for (const destination of group.destinations) {
    for (const view of destination.orders) {
      const order = store.orders[view.sourceIndex]
      if (order === undefined || viewByOrder.has(order)) continue
      viewByOrder.set(order, view)
      stops.push(order)
    }
  }
  const routedStops = applyRouteOverride(suggestRouteOrder(stops), overrideIds)
  const pairs = routedStops.flatMap((order) => {
    const view = viewByOrder.get(order)
    return view === undefined ? [] : [{ order, view }]
  })
  const sequence = pairs.map(({ view }) => view)
  const mapStops = pairs.map(({ order, view }, index): DeliveryMapStop => {
    const coordinates = stopCoordinates(order)
    return {
      key: view.orderId ?? `stop-${view.sourceIndex}`,
      sequence: index + 1,
      customerName: view.customerName,
      destination: view.destination,
      time: view.time,
      latitude: coordinates?.latitude ?? null,
      longitude: coordinates?.longitude ?? null,
    }
  })
  return {
    sequence,
    rankByView: new Map(sequence.map((view, index) => [view, index + 1])),
    mapsUrls: buildMultiStopMapsUrl(routedStops),
    mapStops,
  }
}

function routeRank(plan: RoutePlan, destination: DeliveryDestinationGroup): number {
  const ranks = destination.orders.flatMap((order) => {
    const rank = plan.rankByView.get(order)
    return rank === undefined ? [] : [rank]
  })
  return ranks.length === 0 ? Number.MAX_SAFE_INTEGER : Math.min(...ranks)
}

function deliveredOrderCount(store: Readonly<LegacyStore>, serviceDate: string | null): number {
  if (serviceDate === null) return 0
  return store.orders.filter(
    (order) => order.date === serviceDate && order.status === DELIVERED_STATUS,
  ).length
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

function OrderActions({
  order,
  onAdvance,
  saveState,
  saveBlocked,
}: {
  order: DeliveryOrderView
  onAdvance?: (order: DeliveryOrderView) => void
  saveState?: DeliverySaveState
  saveBlocked: boolean
}) {
  const nextStatus = nextDeliveryStatus(order.status)
  const canAdvance = order.orderId !== null && nextStatus !== null && onAdvance !== undefined
  return (
    <div>
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
          disabled={!canAdvance || saveBlocked || saveState?.kind === 'saving'}
          aria-label={canAdvance ? `עדכון ${order.customerName} לסטטוס ${nextStatus}` : undefined}
          title={canAdvance ? undefined : 'עדכון סטטוס דורש מזהה הזמנה יחיד ושמירה מוגנת'}
          onClick={() => {
            if (canAdvance) onAdvance(order)
          }}
          className={`min-h-10 rounded-xl border px-3 py-2 text-xs font-bold ${
            canAdvance
              ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60'
              : 'cursor-not-allowed border-border bg-muted text-muted-foreground opacity-70'
          }`}
        >
          {saveState?.kind === 'saving'
            ? 'שומרת...'
            : canAdvance
              ? `העברה ל"${nextStatus}"`
              : 'עדכון סטטוס לא זמין'}
        </button>
      </div>
      {saveState !== undefined && saveState.kind !== 'saving' && (
        <p
          className={`mt-2 text-xs font-black ${saveState.kind === 'error' ? 'text-destructive' : 'text-emerald-700'}`}
          role={saveState.kind === 'error' ? 'alert' : 'status'}
        >
          {saveState.message}
        </p>
      )}
    </div>
  )
}

function DeliveryOrder({
  order,
  sequence,
  onAdvance,
  saveState,
  saveBlocked,
  reorder,
}: {
  order: DeliveryOrderView
  sequence: number
  onAdvance?: (order: DeliveryOrderView) => void
  saveState?: DeliverySaveState
  saveBlocked: boolean
  reorder?: RouteReorder
}) {
  const reorderable = reorder !== undefined && order.orderId !== null && reorder.count > 1
  return (
    <li
      onDragOver={(event) => {
        if (reorderable && reorder.draggedId !== null && reorder.draggedId !== order.orderId) {
          event.preventDefault()
        }
      }}
      onDrop={(event) => {
        if (!reorderable) return
        event.preventDefault()
        reorder.dropOn(order)
      }}
      className={`rounded-2xl bg-background/70 p-4 ${reorderable && reorder.draggedId === order.orderId ? 'opacity-50' : ''}`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-black text-primary-foreground">{sequence}</span>
          {reorderable && (
            <>
              <span
                draggable
                role="button"
                aria-label={`גרירת ${order.customerName} לשינוי סדר המסלול`}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move'
                  reorder.start(order)
                }}
                onDragEnd={() => reorder.cancel()}
                className="flex min-h-9 shrink-0 cursor-grab items-center text-muted-foreground active:cursor-grabbing"
              >
                <LocalIcon name="ph:dots-six-vertical-bold" className="text-xl" />
              </span>
              <div className="flex shrink-0 flex-col">
                <button
                  type="button"
                  aria-label={`העברת ${order.customerName} מוקדם יותר במסלול`}
                  disabled={sequence <= 1 || reorder.busy}
                  onClick={() => reorder.moveTo(order, sequence - 2)}
                  className="rounded p-0.5 text-muted-foreground hover:text-primary disabled:opacity-30"
                >
                  <LocalIcon name="ph:caret-up-bold" className="text-sm" />
                </button>
                <button
                  type="button"
                  aria-label={`העברת ${order.customerName} מאוחר יותר במסלול`}
                  disabled={sequence >= reorder.count || reorder.busy}
                  onClick={() => reorder.moveTo(order, sequence)}
                  className="rounded p-0.5 text-muted-foreground hover:text-primary disabled:opacity-30"
                >
                  <LocalIcon name="ph:caret-down-bold" className="text-sm" />
                </button>
              </div>
            </>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {order.time && <span className="text-xs font-black text-muted-foreground">{order.time}</span>}
              <h3 className="font-black text-primary">{order.customerName}</h3>
              <span className={`rounded-full border px-2.5 py-1 text-[0.6875rem] font-black ${statusClassName(order.status)}`}>{order.status}</span>
              {order.checkinState && order.checkinLabel && (
                <span className={`rounded-full border px-2.5 py-1 text-[0.6875rem] font-black ${checkinClassName(order.checkinState)}`}>{order.checkinLabel}</span>
              )}
              <PlataBadge order={order} />
              {order.groupName && <span className="rounded-full bg-secondary px-2.5 py-1 text-[0.6875rem] font-black text-primary">{order.groupName}</span>}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Collection order={order} />
              {order.proofPhotoHref && (
                <a
                  href={order.proofPhotoHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-black text-primary underline"
                >
                  <LocalIcon name="ph:check-circle-bold" className="text-base" />
                  <span>צילום מסירה</span>
                </a>
              )}
            </div>
          </div>
        </div>
        <OrderActions
          order={order}
          onAdvance={onAdvance}
          saveState={saveState}
          saveBlocked={saveBlocked}
        />
      </div>
    </li>
  )
}

function Destination({
  destination,
  routeRanks,
  onAdvance,
  saveStates,
  saveBlocked,
  reorder,
}: {
  destination: DeliveryDestinationGroup
  routeRanks: ReadonlyMap<DeliveryOrderView, number>
  onAdvance?: (order: DeliveryOrderView) => void
  saveStates: Readonly<Record<string, DeliverySaveState>>
  saveBlocked: boolean
  reorder?: RouteReorder
}) {
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
          <DeliveryOrder
            key={`${order.orderId ?? 'missing'}-${order.sourceIndex}`}
            order={order}
            sequence={routeRanks.get(order) ?? index + 1}
            onAdvance={onAdvance}
            saveState={order.orderId === null ? undefined : saveStates[order.orderId]}
            saveBlocked={saveBlocked}
            reorder={reorder}
          />
        ))}
      </ol>
    </article>
  )
}

function Pickups({
  orders,
  onAdvance,
  saveStates,
  saveBlocked,
}: {
  orders: readonly DeliveryOrderView[]
  onAdvance?: (order: DeliveryOrderView) => void
  saveStates: Readonly<Record<string, DeliverySaveState>>
  saveBlocked: boolean
}) {
  if (orders.length === 0) return null
  return (
    <section className="rounded-[2rem] border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex items-center gap-2 border-b border-border pb-4">
        <LocalIcon name="ph:storefront-bold" className="text-xl text-primary" />
        <h2 className="text-xl font-black text-primary">איסוף עצמי ({orders.length})</h2>
      </div>
      <ol className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {orders.map((order, index) => (
          <DeliveryOrder
            key={`${order.orderId ?? 'missing'}-${order.sourceIndex}`}
            order={order}
            sequence={index + 1}
            onAdvance={onAdvance}
            saveState={order.orderId === null ? undefined : saveStates[order.orderId]}
            saveBlocked={saveBlocked}
          />
        ))}
      </ol>
    </section>
  )
}

function CourierLocationLine({ store }: { store: Readonly<LegacyStore> }) {
  const location = store.settings?.meyCourierLocation
  if (location == null) return null
  const ageMinutes = Math.max(0, Math.round((Date.now() - location.at) / 60_000))
  if (Date.now() - location.at > COURIER_LOCATION_MAX_AGE_MS) return null
  if (!Number.isFinite(location.lat) || !Number.isFinite(location.lon)) return null
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs font-black text-muted-foreground">
      <LocalIcon name="ph:map-pin-bold" className="text-base text-primary" />
      <span>עדכון מיקום אחרון לפני {ageMinutes} דק׳</span>
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lon}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline"
      >
        מיקום השליח
      </a>
    </p>
  )
}

// Counted across every order, not the selected date: a plate nobody collected two weeks ago
// is exactly the one worth showing, and its deposit is money Lin still owes back.
function OutstandingPlataLine({ store }: { store: Readonly<LegacyStore> }) {
  const outstanding = summarizeOutstandingPlata(store)
  const out = outstanding.withCustomer + outstanding.awaitingPickup + outstanding.collected
  if (out === 0) return null
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-black text-muted-foreground">
      <span className="flex items-center gap-2 text-primary">
        <LocalIcon name="ph:cooking-pot-bold" className="text-base" />
        <span>פלטות בחוץ: {out}</span>
      </span>
      <span>{outstanding.withCustomer} אצל לקוחות</span>
      <span className={outstanding.awaitingPickup > 0 ? 'text-amber-800' : undefined}>
        {outstanding.awaitingPickup} ממתינות לאיסוף
      </span>
      {outstanding.collected > 0 && <span>{outstanding.collected} נאספו, הפיקדון עוד לא הוחזר</span>}
      <span>
        {outstanding.depositComplete
          ? <>פיקדונות פתוחים: <span dir="ltr">{formatUsdMinorUnits(outstanding.openDepositMinorUnits)}</span></>
          : 'פיקדונות פתוחים: לא מלא'}
      </span>
    </p>
  )
}

function ProgressStrip({
  store,
  group,
  plan,
}: {
  store: Readonly<LegacyStore>
  group: DeliveryDateGroup
  plan: RoutePlan
}) {
  const delivered = deliveredOrderCount(store, group.serviceDate)
  const total = delivered + group.orderCount
  const inTransit = plan.sequence.filter((order) => order.status === IN_TRANSIT_STATUS)
  const currentStop = inTransit.length === 1 ? inTransit[0]! : null
  const currentIndex = currentStop === null ? -1 : plan.sequence.indexOf(currentStop)
  const nextStop = currentStop === null ? plan.sequence[0] : plan.sequence[currentIndex + 1]
  return (
    <div className="flex flex-col gap-3 rounded-[2rem] border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <p className="flex items-center gap-2 text-sm font-black text-primary">
          <LocalIcon name="ph:truck-bold" className="text-xl" />
          <span>נמסרו {delivered} מתוך {total}</span>
        </p>
        <p className="text-xs font-black text-primary">
          {`עצירה נוכחית: ${currentStop === null ? 'אין עצירה בדרך' : currentStop.customerName}`}
        </p>
        <p className="text-xs font-black text-primary">
          {`העצירה הבאה: ${nextStop === undefined ? 'אין עצירה נוספת' : nextStop.customerName}`}
        </p>
      </div>
      <CourierLocationLine store={store} />
      <OutstandingPlataLine store={store} />
    </div>
  )
}

function RouteLinks({ mapsUrls }: { mapsUrls: readonly string[] }) {
  if (mapsUrls.length === 0) return null
  return (
    <div className="flex flex-wrap gap-3">
      {mapsUrls.map((url, index) => (
        <a
          key={url}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={navigationActionClassName}
        >
          <LocalIcon name="ph:map-pin-bold" className="text-lg" />
          <span>
            פתח מסלול מלא בניווט{mapsUrls.length > 1 ? ` · חלק ${index + 1}` : ''}
          </span>
        </a>
      ))}
    </div>
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

export function DeliveriesScreen({ onSave }: { readonly onSave?: ConfirmedStoreSaveHandler }) {
  const storeQuery = useStore()
  const initializationRef = useRef<DeliveriesInitialization | null>(null)
  const acceptedEnvelopeRef = useRef<VersionedStateEnvelope | null>(null)
  const writeInFlightRef = useRef(false)
  const [selectedGroupKey, setSelectedGroupKey] = useState('')
  const [writeInFlight, setWriteInFlight] = useState(false)
  const [saveStates, setSaveStates] = useState<Readonly<Record<string, DeliverySaveState>>>({})
  const [draggedOrderId, setDraggedOrderId] = useState<string | null>(null)
  const [routeSaveState, setRouteSaveState] = useState<DeliverySaveState | null>(null)

  if (initializationRef.current === null && storeQuery.data?.data != null) {
    initializationRef.current = {
      baseEnvelope: isVersionedStateEnvelope(storeQuery.data) ? storeQuery.data : null,
      baseStore: storeQuery.data.data,
    }
  }
  if (
    acceptedEnvelopeRef.current !== null &&
    isSameVersionedStateEnvelope(storeQuery.data, acceptedEnvelopeRef.current)
  ) {
    initializationRef.current = {
      baseEnvelope: acceptedEnvelopeRef.current,
      baseStore: acceptedEnvelopeRef.current.data,
    }
    acceptedEnvelopeRef.current = null
  }

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

  const initialization = initializationRef.current
  if (initialization === null) {
    return <ScreenState kind="error" title="לא הצלחנו לטעון את האספקות" retry={() => void storeQuery.refetch()} />
  }
  const displayStore = initialization.baseStore
  const dashboard = buildDeliveryDashboard(displayStore)
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

  const datedGroups = dashboard.groups.filter(
    (group): group is DeliveryDateGroup & { serviceDate: string } => group.serviceDate !== null,
  )
  const defaultServiceDate = upcomingServiceDate(datedGroups.map(({ serviceDate }) => serviceDate))
  const selectedGroup =
    dashboard.groups.find(({ key }) => key === selectedGroupKey)
    ?? datedGroups.find(({ serviceDate }) => serviceDate === defaultServiceDate)
    ?? dashboard.groups[0]!
  const activeServiceDate = selectedGroup.serviceDate
  const overrideIds = activeServiceDate === null
    ? null
    : readRouteOverride(displayStore.settings?.routeOverrides, activeServiceDate)
  const overrideActive = overrideIds !== null
  const routePlan = buildRoutePlan(displayStore, selectedGroup, overrideIds)
  const routedDestinations = [...selectedGroup.destinations].sort((left, right) => {
    const leftRank = routeRank(routePlan, left)
    const rightRank = routeRank(routePlan, right)
    return leftRank < rightRank ? -1 : leftRank > rightRank ? 1 : 0
  })

  const advanceStatus = onSave === undefined
    ? undefined
    : async (order: DeliveryOrderView) => {
        if (order.orderId === null) return
        const baseEnvelope = initialization.baseEnvelope
        if (
          baseEnvelope === null ||
          acceptedEnvelopeRef.current !== null ||
          writeInFlightRef.current ||
          !isSameVersionedStateEnvelope(storeQuery.data, baseEnvelope)
        ) {
          setSaveStates((current) => ({
            ...current,
            [order.orderId!]: {
              kind: 'error',
              message: 'הנתונים השתנו מאז פתיחת המסך. לא בוצע עדכון; צריך לטעון מחדש.',
            },
          }))
          return
        }

        let nextStore: LegacyStore
        let nextStatus: string
        try {
          const change = applyNextDeliveryStatus(initialization.baseStore, order.orderId)
          nextStore = change.nextStore
          nextStatus = change.nextStatus
        } catch {
          setSaveStates((current) => ({
            ...current,
            [order.orderId!]: {
              kind: 'error',
              message: 'מזהה ההזמנה או הסטטוס אינם בטוחים לעדכון. לא בוצע שינוי.',
            },
          }))
          return
        }

        setSaveStates((current) => ({
          ...current,
          [order.orderId!]: { kind: 'saving', message: 'שומרת...' },
        }))
        writeInFlightRef.current = true
        setWriteInFlight(true)
        try {
          const confirmedEnvelope = await onSave({
            reason: 'deliveries',
            baseEnvelope,
            baseStore: initialization.baseStore,
            nextStore,
          })
          acceptedEnvelopeRef.current = confirmedEnvelope
          initializationRef.current = {
            baseEnvelope: confirmedEnvelope,
            baseStore: confirmedEnvelope.data,
          }
          setSaveStates((current) => ({
            ...current,
            [order.orderId!]: { kind: 'saved', message: `הסטטוס עודכן ל${nextStatus}.` },
          }))
        } catch {
          setSaveStates((current) => ({
            ...current,
            [order.orderId!]: {
              kind: 'error',
              message: 'השמירה נכשלה או התנגשה בעדכון אחר. הסטטוס הקיים נשאר ללא שינוי.',
            },
          }))
        } finally {
          writeInFlightRef.current = false
          setWriteInFlight(false)
        }
      }

  // Persists the operator's manual route order for the selected date inside
  // settings.routeOverrides, through the same guarded versioned save flow as the
  // status updates. 'reset' removes the date's entry and returns to the suggestion.
  const saveRouteOverride = onSave === undefined || activeServiceDate === null
    ? undefined
    : async (action: { readonly ids: readonly string[] } | 'reset') => {
        const baseEnvelope = initialization.baseEnvelope
        if (
          baseEnvelope === null ||
          acceptedEnvelopeRef.current !== null ||
          writeInFlightRef.current ||
          !isSameVersionedStateEnvelope(storeQuery.data, baseEnvelope)
        ) {
          setRouteSaveState({
            kind: 'error',
            message: 'הנתונים השתנו מאז פתיחת המסך. סדר המסלול לא נשמר; צריך לטעון מחדש.',
          })
          return
        }

        const baseStore = initialization.baseStore
        const baseSettings = baseStore.settings ?? {}
        const rawOverrides = baseSettings.routeOverrides
        const currentOverrides: Readonly<Record<string, unknown>> =
          typeof rawOverrides === 'object' && rawOverrides !== null && !Array.isArray(rawOverrides)
            ? (rawOverrides as Record<string, unknown>)
            : {}
        const nextOverrides: Record<string, unknown> = action === 'reset'
          ? Object.fromEntries(
              Object.entries(currentOverrides).filter(([date]) => date !== activeServiceDate),
            )
          : { ...currentOverrides, [activeServiceDate]: [...action.ids] }
        let nextSettings: NonNullable<LegacyStore['settings']>
        if (action === 'reset' && Object.keys(nextOverrides).length === 0) {
          nextSettings = { ...baseSettings }
          delete nextSettings['routeOverrides']
        } else {
          nextSettings = { ...baseSettings, routeOverrides: nextOverrides }
        }
        const nextStore: LegacyStore = { ...baseStore, settings: nextSettings }

        setRouteSaveState({ kind: 'saving', message: 'שומרת...' })
        writeInFlightRef.current = true
        setWriteInFlight(true)
        try {
          const confirmedEnvelope = await onSave({
            reason: 'deliveries',
            baseEnvelope,
            baseStore,
            nextStore,
          })
          acceptedEnvelopeRef.current = confirmedEnvelope
          initializationRef.current = {
            baseEnvelope: confirmedEnvelope,
            baseStore: confirmedEnvelope.data,
          }
          setRouteSaveState({
            kind: 'saved',
            message: action === 'reset' ? 'חזרנו לסדר המוצע.' : 'סדר המסלול נשמר.',
          })
        } catch {
          setRouteSaveState({
            kind: 'error',
            message: 'השמירה נכשלה או התנגשה בעדכון אחר. הסדר הקודם נשאר.',
          })
        } finally {
          writeInFlightRef.current = false
          setWriteInFlight(false)
        }
      }

  const moveStop = saveRouteOverride === undefined
    ? undefined
    : (view: DeliveryOrderView, targetIndex: number) => {
        const from = routePlan.sequence.indexOf(view)
        if (from === -1 || targetIndex < 0 || targetIndex >= routePlan.sequence.length) return
        if (from === targetIndex) return
        const next = [...routePlan.sequence]
        next.splice(from, 1)
        next.splice(targetIndex, 0, view)
        const ids = next.flatMap((stop) => (stop.orderId === null ? [] : [stop.orderId]))
        if (ids.length === 0) return
        void saveRouteOverride({ ids })
      }

  const reorder: RouteReorder | undefined = moveStop === undefined
    ? undefined
    : {
        draggedId: draggedOrderId,
        count: routePlan.sequence.length,
        busy: writeInFlight || acceptedEnvelopeRef.current !== null,
        start: (view) => setDraggedOrderId(view.orderId),
        cancel: () => setDraggedOrderId(null),
        dropOn: (target) => {
          const draggedId = draggedOrderId
          setDraggedOrderId(null)
          if (draggedId === null || draggedId === target.orderId) return
          const dragged = routePlan.sequence.find((stop) => stop.orderId === draggedId)
          const targetIndex = routePlan.sequence.indexOf(target)
          if (dragged === undefined || targetIndex === -1) return
          moveStop(dragged, targetIndex)
        },
        moveTo: moveStop,
      }

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
          <ProgressStrip store={displayStore} group={selectedGroup} plan={routePlan} />
          <RouteLinks mapsUrls={routePlan.mapsUrls} />
          {(overrideActive || routeSaveState !== null || (reorder !== undefined && routePlan.sequence.length > 1)) && (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
              {overrideActive && (
                <span className="rounded-full border border-amber-100 bg-amber-50 px-2.5 py-1 text-[0.6875rem] font-black text-amber-800">סדר ידני</span>
              )}
              {reorder !== undefined && routePlan.sequence.length > 1 && (
                <p className="text-xs font-bold text-muted-foreground">
                  אפשר לגרור את הידית או להזיז עם החצים כדי לקבוע סדר ידני למסלול.
                </p>
              )}
              {overrideActive && saveRouteOverride !== undefined && (
                <button
                  type="button"
                  disabled={writeInFlight || acceptedEnvelopeRef.current !== null}
                  onClick={() => void saveRouteOverride('reset')}
                  className={actionClassName}
                >
                  <LocalIcon name="ph:arrow-counter-clockwise-bold" className="text-base" />
                  <span>חזרה לסדר המוצע</span>
                </button>
              )}
              {routeSaveState !== null && routeSaveState.kind !== 'saving' && (
                <p
                  className={`text-xs font-black ${routeSaveState.kind === 'error' ? 'text-destructive' : 'text-emerald-700'}`}
                  role={routeSaveState.kind === 'error' ? 'alert' : 'status'}
                >
                  {routeSaveState.message}
                </p>
              )}
              {routeSaveState?.kind === 'saving' && (
                <p className="text-xs font-black text-muted-foreground">{routeSaveState.message}</p>
              )}
            </div>
          )}
          <DeliveriesMap stops={routePlan.mapStops} />
          <DateSummary group={selectedGroup} />
          {routedDestinations.map((destination) => (
            <Destination
              key={destination.key}
              destination={destination}
              routeRanks={routePlan.rankByView}
              onAdvance={advanceStatus}
              saveStates={saveStates}
              saveBlocked={writeInFlight || acceptedEnvelopeRef.current !== null}
              reorder={reorder}
            />
          ))}
          <Pickups
            orders={selectedGroup.pickups}
            onAdvance={advanceStatus}
            saveStates={saveStates}
            saveBlocked={writeInFlight || acceptedEnvelopeRef.current !== null}
          />
        </section>
      </div>
    </div>
  )
}

export default DeliveriesScreen
