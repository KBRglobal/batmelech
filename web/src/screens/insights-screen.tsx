import { LocalIcon, type LocalIconName } from '../components/local-icon.tsx'
import { ScreenState } from '../components/screen-state.tsx'
import { useStore } from '../data/use-store.ts'
import type { LegacyOrder } from '../domain/store.ts'
import { formatUsdMinorUnits } from '../domain/today-dashboard.ts'

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS
const WEEK_COUNT = 8
const TOP_DISH_LIMIT = 10
const PEAK_DAY_LIMIT = 5
const PEAK_LOOKBACK_DAYS = 30
const CANCELLED_STATUS = 'בוטלה'
const UNREADABLE_LABEL = 'לא ניתן לקרוא'

export interface DishQuantity {
  readonly name: string
  readonly quantity: number
}

export interface TopDishesResult {
  readonly dishes: readonly DishQuantity[]
  readonly unreadableFieldCount: number
}

export interface WeekRevenue {
  readonly sundayIso: string
  readonly label: string
  readonly totalMinorUnits: number
}

export interface WeeklyRevenueResult {
  readonly weeks: readonly WeekRevenue[]
  readonly invalidTotalCount: number
}

export interface PeakDay {
  readonly dateIso: string
  readonly label: string
  readonly meals: number
}

export interface InsightsKpis {
  readonly activeOrderCount: number
  readonly cancelledOrderCount: number
  readonly revenueMinorUnits: number
  readonly averageOrderMinorUnits: number
}

export function isCancelledOrder(order: Readonly<LegacyOrder>): boolean {
  return typeof order.status === 'string' && order.status.trim() === CANCELLED_STATUS
}

export function parseMoneyMinorUnits(value: unknown): number | null {
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  if (text === '') return null
  const parsed = Number(text)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  const minorUnits = Math.round(parsed * 100)
  return Number.isSafeInteger(minorUnits) ? minorUnits : null
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function positiveNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const text = String(value).trim()
  if (text === '') return null
  const parsed = Number(text)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

type DishFieldKind = 'pair' | 'count' | 'q-only'

const DISH_FIELDS = [
  { key: 'salads', kind: 'pair' },
  { key: 'firsts', kind: 'count' },
  { key: 'mains', kind: 'count' },
  { key: 'sides', kind: 'count' },
  { key: 'desserts', kind: 'count' },
  { key: 'extras', kind: 'q-only' },
] as const satisfies ReadonlyArray<{ key: keyof LegacyOrder; kind: DishFieldKind }>

function dishQuantityFromValue(kind: DishFieldKind, value: unknown): number | null {
  if (kind === 'pair') {
    if (!isPlainRecord(value)) return null
    const ordered = positiveNumber(value.o) ?? 0
    const packed = positiveNumber(value.p) ?? 0
    const total = ordered + packed
    return total > 0 ? total : null
  }
  if (kind === 'count' && typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null
  }
  if (!isPlainRecord(value)) return null
  return positiveNumber(value.q)
}

export function computeTopDishes(orders: readonly LegacyOrder[]): TopDishesResult {
  const totals = new Map<string, number>()
  let unreadableFieldCount = 0

  for (const order of orders) {
    if (isCancelledOrder(order)) continue
    for (const { key, kind } of DISH_FIELDS) {
      const field = order[key]
      if (field === undefined || field === null) continue
      if (!isPlainRecord(field)) {
        unreadableFieldCount += 1
        continue
      }
      for (const [rawName, rawValue] of Object.entries(field)) {
        const quantity = dishQuantityFromValue(kind, rawValue)
        if (quantity === null) continue
        const name = rawName.trim()
        if (name === '') continue
        totals.set(name, (totals.get(name) ?? 0) + quantity)
      }
    }
  }

  const dishes = [...totals.entries()]
    .map(([name, quantity]) => ({ name, quantity }))
    .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, 'he'))
    .slice(0, TOP_DISH_LIMIT)

  return { dishes, unreadableFieldCount }
}

function utcTimeFromIsoDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (match === null) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const time = Date.UTC(year, month - 1, day)
  const roundTrip = new Date(time)
  const valid =
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day
  return valid ? time : null
}

function utcTodayStart(now: Date): number {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function isoFromUtcTime(time: number): string {
  const date = new Date(time)
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`
}

function dayMonthLabel(time: number): string {
  const date = new Date(time)
  return `${pad2(date.getUTCDate())}.${pad2(date.getUTCMonth() + 1)}`
}

function fullDateLabel(time: number): string {
  const date = new Date(time)
  return `${pad2(date.getUTCDate())}.${pad2(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`
}

export function computeWeeklyRevenue(
  orders: readonly LegacyOrder[],
  now: Date = new Date(),
): WeeklyRevenueResult {
  const todayUtc = utcTodayStart(now)
  const currentSunday = todayUtc - new Date(todayUtc).getUTCDay() * DAY_MS
  const firstSunday = currentSunday - (WEEK_COUNT - 1) * WEEK_MS
  const rangeEnd = currentSunday + WEEK_MS

  const totals: number[] = new Array<number>(WEEK_COUNT).fill(0)
  let invalidTotalCount = 0

  for (const order of orders) {
    if (isCancelledOrder(order)) continue
    if (typeof order.date !== 'string') continue
    const time = utcTimeFromIsoDate(order.date)
    if (time === null || time < firstSunday || time >= rangeEnd) continue
    const minorUnits = parseMoneyMinorUnits(order.total)
    if (minorUnits === null) {
      invalidTotalCount += 1
      continue
    }
    const index = Math.floor((time - firstSunday) / WEEK_MS)
    totals[index] += minorUnits
  }

  const weeks = totals.map((totalMinorUnits, index) => {
    const sunday = firstSunday + index * WEEK_MS
    return {
      sundayIso: isoFromUtcTime(sunday),
      label: dayMonthLabel(sunday),
      totalMinorUnits,
    }
  })

  return { weeks, invalidTotalCount }
}

export function computePeakDays(
  orders: readonly LegacyOrder[],
  now: Date = new Date(),
): readonly PeakDay[] {
  const rangeStart = utcTodayStart(now) - PEAK_LOOKBACK_DAYS * DAY_MS
  const totals = new Map<number, number>()

  for (const order of orders) {
    if (isCancelledOrder(order)) continue
    if (typeof order.date !== 'string') continue
    const time = utcTimeFromIsoDate(order.date)
    if (time === null || time < rangeStart) continue
    const meals = positiveNumber(order.meals)
    if (meals === null) continue
    totals.set(time, (totals.get(time) ?? 0) + meals)
  }

  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, PEAK_DAY_LIMIT)
    .map(([time, meals]) => ({
      dateIso: isoFromUtcTime(time),
      label: fullDateLabel(time),
      meals,
    }))
}

export function computeInsightsKpis(orders: readonly LegacyOrder[]): InsightsKpis {
  let activeOrderCount = 0
  let cancelledOrderCount = 0
  let revenueMinorUnits = 0
  let validTotalCount = 0

  for (const order of orders) {
    if (isCancelledOrder(order)) {
      cancelledOrderCount += 1
      continue
    }
    activeOrderCount += 1
    const minorUnits = parseMoneyMinorUnits(order.total)
    if (minorUnits === null) continue
    revenueMinorUnits += minorUnits
    validTotalCount += 1
  }

  return {
    activeOrderCount,
    cancelledOrderCount,
    revenueMinorUnits,
    averageOrderMinorUnits:
      validTotalCount === 0 ? 0 : Math.round(revenueMinorUnits / validTotalCount),
  }
}

interface KpiItem {
  readonly icon: LocalIconName
  readonly label: string
  readonly value: string
  readonly ltr?: boolean
}

function KpiRow({ kpis }: { kpis: InsightsKpis }) {
  const items: readonly KpiItem[] = [
    {
      icon: 'ph:shopping-cart-bold',
      label: 'סך ההזמנות',
      value: String(kpis.activeOrderCount),
    },
    {
      icon: 'ph:coins-bold',
      label: 'סך ההכנסות',
      value: formatUsdMinorUnits(kpis.revenueMinorUnits),
      ltr: true,
    },
    {
      icon: 'ph:receipt-bold',
      label: 'ממוצע להזמנה',
      value: formatUsdMinorUnits(kpis.averageOrderMinorUnits),
      ltr: true,
    },
    {
      icon: 'ph:x-bold',
      label: 'הזמנות שבוטלו',
      value: String(kpis.cancelledOrderCount),
    },
  ]

  return (
    <section aria-label="נתונים מרכזיים" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-[2rem] border border-border bg-card p-5 shadow-sm sm:p-6">
          <span className="flex size-10 items-center justify-center rounded-2xl bg-secondary text-primary">
            <LocalIcon name={item.icon} className="text-xl" />
          </span>
          <p className="mt-3 text-xs font-bold text-muted-foreground">{item.label}</p>
          <p className="mt-1 text-2xl font-black text-primary" dir={item.ltr === true ? 'ltr' : undefined}>
            {item.value}
          </p>
        </div>
      ))}
    </section>
  )
}

function WeeklyRevenueCard({ weekly }: { weekly: WeeklyRevenueResult }) {
  const maxTotal = Math.max(0, ...weekly.weeks.map((week) => week.totalMinorUnits))

  return (
    <section className="rounded-[2rem] border border-border bg-card p-6 shadow-sm sm:p-8">
      <h2 className="flex items-center gap-2 text-xl font-black text-primary">
        <LocalIcon name="ph:chart-pie-slice-bold" className="text-xl" />
        <span>הכנסות לפי שבוע</span>
      </h2>

      <div className="mt-6 flex items-end gap-2 sm:gap-3">
        {weekly.weeks.map((week) => {
          const percent = maxTotal === 0 ? 0 : Math.round((week.totalMinorUnits / maxTotal) * 100)
          return (
            <div key={week.sundayIso} className="flex flex-1 flex-col items-center gap-2">
              <div
                className="flex h-36 w-full items-end sm:h-44"
                role="meter"
                aria-valuemin={0}
                aria-valuemax={maxTotal}
                aria-valuenow={week.totalMinorUnits}
                aria-label={`שבוע ${week.label}: ${formatUsdMinorUnits(week.totalMinorUnits)}`}
              >
                <div
                  className="w-full rounded-t-lg bg-primary"
                  style={percent === 0 ? { height: '2px' } : { height: `${percent}%` }}
                />
              </div>
              <span className="text-[0.6875rem] font-black text-muted-foreground" dir="ltr">
                {week.label}
              </span>
            </div>
          )
        })}
      </div>

      {weekly.invalidTotalCount > 0 && (
        <p className="mt-4 text-xs font-bold text-destructive">
          {weekly.invalidTotalCount} הזמנות עם סכום לא תקין
        </p>
      )}
    </section>
  )
}

function TopDishesCard({ topDishes }: { topDishes: TopDishesResult }) {
  const maxQuantity = Math.max(0, ...topDishes.dishes.map((dish) => dish.quantity))

  return (
    <section className="rounded-[2rem] border border-border bg-card p-6 shadow-sm sm:p-8">
      <h2 className="flex items-center gap-2 text-xl font-black text-primary">
        <LocalIcon name="ph:cooking-pot-bold" className="text-xl" />
        <span>המנות המבוקשות</span>
      </h2>

      {topDishes.dishes.length === 0 ? (
        <p className="mt-6 text-sm leading-6 text-muted-foreground">
          אין עדיין נתוני מנות להצגה.
        </p>
      ) : (
        <ul className="mt-6 space-y-4">
          {topDishes.dishes.map((dish) => {
            const percent = maxQuantity === 0 ? 0 : Math.round((dish.quantity / maxQuantity) * 100)
            return (
              <li key={dish.name}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-bold text-primary">{dish.name}</span>
                  <span className="text-sm font-black text-primary">{dish.quantity}</span>
                </div>
                <div
                  className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-secondary"
                  role="meter"
                  aria-valuemin={0}
                  aria-valuemax={maxQuantity}
                  aria-valuenow={dish.quantity}
                  aria-label={`${dish.name}: ${dish.quantity} מנות`}
                >
                  <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {topDishes.unreadableFieldCount > 0 && (
        <p className="mt-4 flex items-center justify-between gap-3 text-xs font-bold text-destructive">
          <span>{UNREADABLE_LABEL}</span>
          <span>{topDishes.unreadableFieldCount}</span>
        </p>
      )}
    </section>
  )
}

function PeakDaysCard({ peakDays }: { peakDays: readonly PeakDay[] }) {
  return (
    <section className="rounded-[2rem] border border-border bg-card p-6 shadow-sm sm:p-8">
      <h2 className="flex items-center gap-2 text-xl font-black text-primary">
        <LocalIcon name="ph:calendar-bold" className="text-xl" />
        <span>ימי השיא</span>
      </h2>

      {peakDays.length === 0 ? (
        <p className="mt-6 text-sm leading-6 text-muted-foreground">
          אין תאריכים עם ארוחות זוגיות בטווח הזמן הזה.
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {peakDays.map((day) => (
            <li
              key={day.dateIso}
              className="flex items-center justify-between gap-3 rounded-3xl border border-border bg-background/70 p-4"
            >
              <span className="flex items-center gap-2 text-sm font-black text-primary">
                <LocalIcon name="ph:calendar-bold" className="text-lg" />
                <span dir="ltr">{day.label}</span>
              </span>
              <span className="rounded-full bg-secondary px-3 py-1 text-xs font-black text-primary">
                {day.meals} ארוחות זוגיות
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function InsightsScreen() {
  const storeQuery = useStore()

  if (storeQuery.isPending) {
    return <ScreenState kind="loading" title="טוענת את התובנות" />
  }

  if (storeQuery.isError) {
    return (
      <ScreenState
        kind="error"
        title="לא הצלחנו לטעון את התובנות"
        description="הנתונים נשארו ללא שינוי. אפשר לנסות שוב."
        retry={() => {
          void storeQuery.refetch()
        }}
      />
    )
  }

  const store = storeQuery.data.data ?? { orders: [] }
  const orders = store.orders

  const kpis = computeInsightsKpis(orders)
  const topDishes = computeTopDishes(orders)
  const weekly = computeWeeklyRevenue(orders)
  const peakDays = computePeakDays(orders)

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      <header>
        <h1 className="font-heading text-3xl font-black tracking-tight text-primary sm:text-4xl">
          תובנות
        </h1>
        <p className="mt-2 text-sm font-bold text-muted-foreground">
          מבט שבועי על ההזמנות, ההכנסות והמנות המבוקשות.
        </p>
      </header>

      {orders.length === 0 ? (
        <ScreenState
          kind="empty"
          title="עדיין אין הזמנות"
          description="כשההזמנות הראשונות ייכנסו, התובנות יופיעו כאן."
          className="px-0"
        />
      ) : (
        <div className="mt-8 space-y-8">
          <KpiRow kpis={kpis} />
          <WeeklyRevenueCard weekly={weekly} />
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <TopDishesCard topDishes={topDishes} />
            <PeakDaysCard peakDays={peakDays} />
          </div>
        </div>
      )}
    </div>
  )
}

export default InsightsScreen
