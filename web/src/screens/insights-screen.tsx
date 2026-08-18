import { useState } from 'react'
import { Link } from 'react-router'
import { APP_ROUTES } from '../app/routes.ts'
import { LocalIcon, type LocalIconName } from '../components/local-icon.tsx'
import { ScreenState } from '../components/screen-state.tsx'
import { useStore } from '../data/use-store.ts'
import { formatSignedUsdMinorUnits } from '../domain/customers-finance.ts'
import {
  computeCancellationsAnalysis,
  computeCostVsRevenueWeekly,
  computeHotelStats,
  computeQuickQuote,
  computeWeekComparison,
  computeYearlySummary,
  type CancellationsAnalysis,
  type CostRevenueResult,
  type HotelStat,
  type WeekComparison,
  type WeekSlice,
  type YearlySummary,
} from '../domain/insights.ts'
import { buildOrderEditorMenu, type OrderEditorMenu } from '../domain/order-editor.ts'
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

function invalidTotalsNote(count: number): string {
  return `לא כולל ${count} הזמנות עם סכום לא תקין`
}

function ComparisonBars({
  label,
  currentValue,
  previousValue,
  currentText,
  previousText,
}: {
  label: string
  currentValue: number
  previousValue: number
  currentText: string
  previousText: string
}) {
  const max = Math.max(currentValue, previousValue)
  const rows = [
    { key: 'current', title: 'השבוע', value: currentValue, text: currentText, bar: 'bg-primary' },
    {
      key: 'previous',
      title: 'שבוע שעבר',
      value: previousValue,
      text: previousText,
      bar: 'bg-primary/40',
    },
  ] as const
  return (
    <div>
      <p className="text-sm font-black text-primary">{label}</p>
      <div className="mt-2 space-y-2">
        {rows.map((row) => {
          const percent = max === 0 ? 0 : Math.round((row.value / max) * 100)
          return (
            <div key={row.key} className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-xs font-bold text-muted-foreground">
                {row.title}
              </span>
              <div
                className="h-2.5 flex-1 overflow-hidden rounded-full bg-secondary"
                role="meter"
                aria-valuemin={0}
                aria-valuemax={max}
                aria-valuenow={row.value}
                aria-label={`${label} — ${row.title}: ${row.text}`}
              >
                <div
                  className={`h-full rounded-full ${row.bar}`}
                  style={{ width: `${percent}%` }}
                />
              </div>
              <span className="w-20 shrink-0 text-end text-xs font-black text-primary" dir="ltr">
                {row.text}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function WeekComparisonCard({ comparison }: { comparison: WeekComparison }) {
  const { current, previous } = comparison
  const rangeLabel = (slice: WeekSlice) => slice.label
  return (
    <section
      aria-label="השוואת שבועות"
      className="rounded-[2rem] border border-border bg-card p-6 shadow-sm sm:p-8"
    >
      <h2 className="flex items-center gap-2 text-xl font-black text-primary">
        <LocalIcon name="ph:chart-bar-bold" className="text-xl" />
        <span>השבוע מול שבוע שעבר</span>
      </h2>
      <p className="mt-2 text-xs font-bold text-muted-foreground">
        <span dir="ltr">{rangeLabel(current)}</span>
        <span> לעומת </span>
        <span dir="ltr">{rangeLabel(previous)}</span>
      </p>

      <div className="mt-6 space-y-5">
        <ComparisonBars
          label="הזמנות"
          currentValue={current.orderCount}
          previousValue={previous.orderCount}
          currentText={String(current.orderCount)}
          previousText={String(previous.orderCount)}
        />
        <ComparisonBars
          label="ארוחות זוגיות"
          currentValue={current.meals}
          previousValue={previous.meals}
          currentText={String(current.meals)}
          previousText={String(previous.meals)}
        />
        <ComparisonBars
          label="הכנסות"
          currentValue={current.revenueMinorUnits}
          previousValue={previous.revenueMinorUnits}
          currentText={formatUsdMinorUnits(current.revenueMinorUnits)}
          previousText={formatUsdMinorUnits(previous.revenueMinorUnits)}
        />
      </div>

      {comparison.invalidTotalCount > 0 && (
        <p className="mt-4 text-xs font-bold text-destructive">
          {invalidTotalsNote(comparison.invalidTotalCount)}
        </p>
      )}
    </section>
  )
}

function CancellationsCard({ analysis }: { analysis: CancellationsAnalysis }) {
  return (
    <section
      aria-label="ניתוח ביטולים"
      className="rounded-[2rem] border border-border bg-card p-6 shadow-sm sm:p-8"
    >
      <h2 className="flex items-center gap-2 text-xl font-black text-primary">
        <LocalIcon name="ph:x-circle-bold" className="text-xl" />
        <span>ביטולים בשמונה השבועות האחרונים</span>
      </h2>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-secondary px-4 py-1.5 text-sm font-black text-primary">
          {analysis.cancelledCount} ביטולים מתוך {analysis.totalCount} הזמנות
        </span>
        <span className="rounded-full bg-secondary px-4 py-1.5 text-sm font-black text-primary">
          <span dir="ltr">{analysis.ratePercent}%</span> שיעור ביטול
        </span>
      </div>

      {analysis.topWeekday !== null && (
        <p className="mt-4 text-sm font-bold text-muted-foreground">
          היום עם הכי הרבה ביטולים: <span className="text-primary">{analysis.topWeekday.label}</span>{' '}
          ({analysis.topWeekday.count} ביטולים)
        </p>
      )}

      {analysis.recent.length === 0 ? (
        <p className="mt-6 text-sm leading-6 text-muted-foreground">
          אין ביטולים בטווח הזמן הזה.
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {analysis.recent.map((item) => (
            <li
              key={`${item.dateIso}:${item.name}`}
              className="flex items-center justify-between gap-3 rounded-3xl border border-border bg-background/70 p-4"
            >
              <span className="min-w-0 truncate text-sm font-black text-primary">{item.name}</span>
              <span className="text-xs font-bold text-muted-foreground" dir="ltr">
                {item.label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function CostRevenueCard({ result }: { result: CostRevenueResult }) {
  const max = Math.max(
    0,
    ...result.weeks.flatMap((week) => [week.revenueMinorUnits, week.expensesMinorUnits ?? 0]),
  )
  const weeksWithoutExpenses = result.weeks.filter((week) => week.expensesMinorUnits === null).length

  return (
    <section
      aria-label="הכנסות מול הוצאות"
      className="rounded-[2rem] border border-border bg-card p-6 shadow-sm sm:p-8"
    >
      <h2 className="flex items-center gap-2 text-xl font-black text-primary">
        <LocalIcon name="ph:scales-bold" className="text-xl" />
        <span>הכנסות מול הוצאות לפי שבוע</span>
      </h2>

      <div className="mt-4 flex items-center gap-4 text-xs font-bold text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-primary" aria-hidden />
          הכנסות
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-primary/40" aria-hidden />
          הוצאות
        </span>
      </div>

      <div className="mt-4 flex items-end gap-2 sm:gap-3">
        {result.weeks.map((week) => {
          const revenuePercent = max === 0 ? 0 : Math.round((week.revenueMinorUnits / max) * 100)
          const expensePercent =
            week.expensesMinorUnits === null || max === 0
              ? 0
              : Math.round((week.expensesMinorUnits / max) * 100)
          const expenseText =
            week.expensesMinorUnits === null
              ? 'אין הוצאות רשומות'
              : formatUsdMinorUnits(week.expensesMinorUnits)
          const gapText =
            week.gapMinorUnits === null ? '' : `, פער ${formatSignedUsdMinorUnits(week.gapMinorUnits)}`
          return (
            <div key={week.startIso} className="flex flex-1 flex-col items-center gap-2">
              <div
                className="flex h-36 w-full items-end justify-center gap-1 sm:h-44"
                role="img"
                aria-label={`שבוע ${week.label}: הכנסות ${formatUsdMinorUnits(week.revenueMinorUnits)}, הוצאות ${expenseText}${gapText}`}
              >
                <div
                  className="w-1/2 rounded-t-lg bg-primary"
                  style={revenuePercent === 0 ? { height: '2px' } : { height: `${revenuePercent}%` }}
                />
                <div
                  className="w-1/2 rounded-t-lg bg-primary/40"
                  style={
                    week.expensesMinorUnits === null
                      ? { height: '0px' }
                      : expensePercent === 0
                        ? { height: '2px' }
                        : { height: `${expensePercent}%` }
                  }
                />
              </div>
              <span className="text-[0.6875rem] font-black text-muted-foreground" dir="ltr">
                {week.label}
              </span>
            </div>
          )
        })}
      </div>

      {weeksWithoutExpenses > 0 && (
        <p className="mt-4 text-xs font-bold text-muted-foreground">
          {weeksWithoutExpenses === result.weeks.length
            ? 'אין הוצאות רשומות בטווח הזמן הזה — הפער לא חושב.'
            : `ב-${weeksWithoutExpenses} שבועות אין הוצאות רשומות — הפער חושב רק לשבועות עם נתונים.`}
        </p>
      )}
      {result.invalidTotalCount > 0 && (
        <p className="mt-2 text-xs font-bold text-destructive">
          {invalidTotalsNote(result.invalidTotalCount)}
        </p>
      )}
      {result.invalidExpenseCount > 0 && (
        <p className="mt-2 text-xs font-bold text-destructive">
          {result.invalidExpenseCount} רישומי הוצאות עם סכום לא תקין לא נכללו
        </p>
      )}
    </section>
  )
}

function YearlySummaryCard({ summary }: { summary: YearlySummary }) {
  const items: readonly KpiItem[] = [
    {
      icon: 'ph:shopping-cart-bold',
      label: 'הזמנות השנה',
      value: String(summary.orderCount),
    },
    {
      icon: 'ph:coins-bold',
      label: 'הכנסות השנה',
      value: formatUsdMinorUnits(summary.revenueMinorUnits),
      ltr: true,
    },
    {
      icon: 'ph:trophy-bold',
      label: 'החודש החזק',
      value:
        summary.bestMonth === null
          ? 'אין נתונים'
          : `${summary.bestMonth.label} · ${formatUsdMinorUnits(summary.bestMonth.revenueMinorUnits)}`,
    },
    {
      icon: 'ph:calendar-bold',
      label: 'היום העמוס',
      value:
        summary.busiestWeekday === null
          ? 'אין נתונים'
          : `${summary.busiestWeekday.label} · ${summary.busiestWeekday.count} הזמנות`,
    },
  ]

  return (
    <section
      aria-label="סיכום שנתי"
      className="rounded-[2rem] border border-border bg-card p-6 shadow-sm sm:p-8"
    >
      <h2 className="flex items-center gap-2 text-xl font-black text-primary">
        <LocalIcon name="ph:trophy-bold" className="text-xl" />
        <span>סיכום שנת {summary.year}</span>
      </h2>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="rounded-3xl border border-border bg-background/70 p-4">
            <span className="flex size-9 items-center justify-center rounded-2xl bg-secondary text-primary">
              <LocalIcon name={item.icon} className="text-lg" />
            </span>
            <p className="mt-3 text-xs font-bold text-muted-foreground">{item.label}</p>
            <p
              className="mt-1 text-sm font-black text-primary"
              dir={item.ltr === true ? 'ltr' : undefined}
            >
              {item.value}
            </p>
          </div>
        ))}
      </div>

      {summary.invalidTotalCount > 0 && (
        <p className="mt-4 text-xs font-bold text-destructive">
          {invalidTotalsNote(summary.invalidTotalCount)}
        </p>
      )}
    </section>
  )
}

function HotelStatsCard({ hotels }: { hotels: readonly HotelStat[] }) {
  const maxCount = Math.max(0, ...hotels.map((hotel) => hotel.orderCount))
  return (
    <section
      aria-label="סטטיסטיקת מלונות"
      className="rounded-[2rem] border border-border bg-card p-6 shadow-sm sm:p-8"
    >
      <h2 className="flex items-center gap-2 text-xl font-black text-primary">
        <LocalIcon name="ph:buildings-bold" className="text-xl" />
        <span>המלונות שמזמינים הכי הרבה</span>
      </h2>

      {hotels.length === 0 ? (
        <p className="mt-6 text-sm leading-6 text-muted-foreground">אין עדיין הזמנות פעילות.</p>
      ) : (
        <ul className="mt-6 space-y-4">
          {hotels.map((hotel) => {
            const percent = maxCount === 0 ? 0 : Math.round((hotel.orderCount / maxCount) * 100)
            return (
              <li key={hotel.name}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-bold text-primary">
                    {hotel.name}
                  </span>
                  <span className="shrink-0 text-xs font-black text-primary">
                    {hotel.orderCount} הזמנות ·{' '}
                    <span dir="ltr">{formatUsdMinorUnits(hotel.revenueMinorUnits)}</span>
                  </span>
                </div>
                <div
                  className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-secondary"
                  role="meter"
                  aria-valuemin={0}
                  aria-valuemax={maxCount}
                  aria-valuenow={hotel.orderCount}
                  aria-label={`${hotel.name}: ${hotel.orderCount} הזמנות`}
                >
                  <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
                </div>
                {hotel.invalidTotalCount > 0 && (
                  <p className="mt-1 text-xs font-bold text-destructive">
                    {invalidTotalsNote(hotel.invalidTotalCount)}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function QuoteStepper({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (next: number) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-3xl border border-border bg-background/70 p-4">
      <span className="text-sm font-bold text-primary">{label}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`הפחתת ${label}`}
          disabled={value === 0}
          onClick={() => onChange(Math.max(0, value - 1))}
          className="flex size-9 items-center justify-center rounded-2xl bg-secondary text-primary disabled:opacity-40"
        >
          <LocalIcon name="ph:minus-bold" className="text-base" />
        </button>
        <span className="w-8 text-center text-base font-black text-primary" aria-label={`כמות ${label}`}>
          {value}
        </span>
        <button
          type="button"
          aria-label={`הוספת ${label}`}
          onClick={() => onChange(Math.min(999, value + 1))}
          className="flex size-9 items-center justify-center rounded-2xl bg-secondary text-primary"
        >
          <LocalIcon name="ph:plus-bold" className="text-base" />
        </button>
      </div>
    </div>
  )
}

function QuickQuoteCard({ menu }: { menu: OrderEditorMenu }) {
  const [couples, setCouples] = useState(0)
  const [extraChallahs, setExtraChallahs] = useState(0)
  const [extraSalads, setExtraSalads] = useState(0)
  const [extraFirsts, setExtraFirsts] = useState(0)

  const quote = computeQuickQuote(menu, { couples, extraChallahs, extraSalads, extraFirsts })

  return (
    <section
      aria-label="מחשבון הצעת מחיר"
      className="rounded-[2rem] border border-border bg-card p-6 shadow-sm sm:p-8"
    >
      <h2 className="flex items-center gap-2 text-xl font-black text-primary">
        <LocalIcon name="ph:calculator-bold" className="text-xl" />
        <span>מחשבון הצעת מחיר</span>
      </h2>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <QuoteStepper label="ארוחות זוגיות" value={couples} onChange={setCouples} />
        <QuoteStepper label="חלות נוספות" value={extraChallahs} onChange={setExtraChallahs} />
        <QuoteStepper label="סלטים נוספים" value={extraSalads} onChange={setExtraSalads} />
        <QuoteStepper label="מנות ראשונות נוספות" value={extraFirsts} onChange={setExtraFirsts} />
      </div>

      {quote.lines.length > 0 && (
        <ul className="mt-6 space-y-2">
          {quote.lines.map((line) => (
            <li
              key={line.label}
              className="flex items-center justify-between gap-3 text-sm font-bold text-primary"
            >
              <span>
                {line.label} × {line.quantity}
              </span>
              <span dir="ltr">{formatUsdMinorUnits(line.amountMinorUnits)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 flex items-center justify-between gap-3 rounded-3xl bg-secondary p-4">
        <span className="text-sm font-black text-primary">סה"כ הערכה</span>
        <span className="text-xl font-black text-primary" dir="ltr">
          {formatUsdMinorUnits(quote.totalMinorUnits)}
        </span>
      </div>

      <p className="mt-4 text-xs font-bold text-muted-foreground">
        זה מחיר הערכה — ההזמנה עצמה נסגרת בטופס.
      </p>
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
  const weekComparison = computeWeekComparison(orders)
  const cancellations = computeCancellationsAnalysis(orders)
  const costRevenue = computeCostVsRevenueWeekly(store)
  const yearly = computeYearlySummary(orders)
  const hotels = computeHotelStats(orders)
  const menu = buildOrderEditorMenu(store)

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-black tracking-tight text-primary sm:text-4xl">
            תובנות
          </h1>
          <p className="mt-2 text-sm font-bold text-muted-foreground">
            מבט שבועי על ההזמנות, ההכנסות והמנות המבוקשות.
          </p>
        </div>
        <Link
          to={APP_ROUTES.costReport}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card px-5 text-sm font-black text-primary transition-colors hover:bg-secondary"
        >
          <LocalIcon name="ph:calculator-bold" />
          <span>דוח עלויות ורווחיות</span>
        </Link>
      </header>

      {orders.length === 0 ? (
        <div className="mt-8 space-y-8">
          <ScreenState
            kind="empty"
            title="עדיין אין הזמנות"
            description="כשההזמנות הראשונות ייכנסו, התובנות יופיעו כאן."
            className="px-0"
          />
          <QuickQuoteCard menu={menu} />
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          <KpiRow kpis={kpis} />
          <WeekComparisonCard comparison={weekComparison} />
          <WeeklyRevenueCard weekly={weekly} />
          <CostRevenueCard result={costRevenue} />
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <TopDishesCard topDishes={topDishes} />
            <PeakDaysCard peakDays={peakDays} />
          </div>
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <CancellationsCard analysis={cancellations} />
            <HotelStatsCard hotels={hotels} />
          </div>
          <YearlySummaryCard summary={yearly} />
          <QuickQuoteCard menu={menu} />
        </div>
      )}
    </div>
  )
}

export default InsightsScreen
