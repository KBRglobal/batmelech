import { parseLegacyUsdAmount } from './customers-finance.ts'
import { checkedAdd, checkedMultiply, requireNonNegativeSafeInteger } from './money.ts'
import type { OrderEditorMenu } from './order-editor.ts'
import { calculateSaladPricing } from './salad-pricing.ts'
import type { LegacyOrder, LegacyStore } from './store.ts'

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS
const LOOKBACK_WEEKS = 8
const RECENT_CANCELLATION_LIMIT = 6
const TOP_HOTEL_LIMIT = 5
const BUSINESS_TIME_ZONE = 'Asia/Dubai'
const CANCELLED_STATUS_ALIASES = new Set(['בוטלה', 'cancelled', 'canceled'])
const MAX_TEXT_LENGTH = 10_000

export const NO_HOTEL_LABEL = 'ללא מלון'

const WEEKDAY_LABELS = [
  'יום ראשון',
  'יום שני',
  'יום שלישי',
  'יום רביעי',
  'יום חמישי',
  'יום שישי',
  'שבת',
] as const

// ---------------------------------------------------------------------------
// Shared parsing helpers
// ---------------------------------------------------------------------------

function text(value: unknown): string {
  return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH ? value.trim() : ''
}

export function isCancelledInsightsOrder(order: Readonly<LegacyOrder>): boolean {
  return CANCELLED_STATUS_ALIASES.has(text(order.status).toLocaleLowerCase('en-US'))
}

/** Returns the UTC midnight timestamp for a real YYYY-MM-DD string, or null. */
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

/** Today's calendar date in the business time zone (Asia/Dubai) as UTC midnight. */
export function businessTodayUtc(now: Date, timeZone: string = BUSINESS_TIME_ZONE): number {
  if (!Number.isFinite(now.getTime())) throw new RangeError('now must be a valid Date')
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).formatToParts(now)
  const read = (partType: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === partType)?.value
    if (value === undefined || !/^\d+$/.test(value)) {
      throw new RangeError(`Unable to resolve ${partType} in ${timeZone}`)
    }
    return Number(value)
  }
  return Date.UTC(read('year'), read('month') - 1, read('day'))
}

/** The Sunday (UTC midnight) that starts the week containing the given UTC day. */
function sundayOf(utcDayStart: number): number {
  return utcDayStart - new Date(utcDayStart).getUTCDay() * DAY_MS
}

function nonNegativeCount(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim())
    return Number.isSafeInteger(parsed) ? parsed : null
  }
  return null
}

function validTotalMinorUnits(order: Readonly<LegacyOrder>): number | null {
  const parsed = parseLegacyUsdAmount(order.total)
  return parsed.state === 'invalid' ? null : parsed.minorUnits
}

interface DatedOrder {
  readonly order: Readonly<LegacyOrder>
  readonly time: number
  readonly cancelled: boolean
}

function datedOrders(orders: readonly LegacyOrder[]): DatedOrder[] {
  const result: DatedOrder[] = []
  for (const order of orders) {
    const time = utcTimeFromIsoDate(text(order.date))
    if (time === null) continue
    result.push({ order, time, cancelled: isCancelledInsightsOrder(order) })
  }
  return result
}

// ---------------------------------------------------------------------------
// #14 Week vs week comparison
// ---------------------------------------------------------------------------

export interface WeekSlice {
  readonly startIso: string
  readonly endIso: string
  readonly label: string
  readonly orderCount: number
  readonly meals: number
  readonly revenueMinorUnits: number
  readonly invalidTotalCount: number
}

export interface WeekComparison {
  readonly current: WeekSlice
  readonly previous: WeekSlice
  readonly invalidTotalCount: number
}

function emptyWeekSlice(sunday: number): {
  startIso: string
  endIso: string
  label: string
  orderCount: number
  meals: number
  revenueMinorUnits: number
  invalidTotalCount: number
} {
  const saturday = sunday + 6 * DAY_MS
  return {
    startIso: isoFromUtcTime(sunday),
    endIso: isoFromUtcTime(saturday),
    label: `${dayMonthLabel(sunday)}–${dayMonthLabel(saturday)}`,
    orderCount: 0,
    meals: 0,
    revenueMinorUnits: 0,
    invalidTotalCount: 0,
  }
}

export function computeWeekComparison(
  orders: readonly LegacyOrder[],
  now: Date = new Date(),
): WeekComparison {
  const currentSunday = sundayOf(businessTodayUtc(now))
  const previousSunday = currentSunday - WEEK_MS
  const current = emptyWeekSlice(currentSunday)
  const previous = emptyWeekSlice(previousSunday)

  for (const { order, time, cancelled } of datedOrders(orders)) {
    if (cancelled) continue
    const slice =
      time >= currentSunday && time < currentSunday + WEEK_MS
        ? current
        : time >= previousSunday && time < currentSunday
          ? previous
          : null
    if (slice === null) continue
    slice.orderCount += 1
    const meals = nonNegativeCount(order.meals)
    if (meals !== null) slice.meals = checkedAdd(slice.meals, meals, 'week meals')
    const total = validTotalMinorUnits(order)
    if (total === null) {
      slice.invalidTotalCount += 1
    } else {
      slice.revenueMinorUnits = checkedAdd(slice.revenueMinorUnits, total, 'week revenue')
    }
  }

  return {
    current,
    previous,
    invalidTotalCount: current.invalidTotalCount + previous.invalidTotalCount,
  }
}

// ---------------------------------------------------------------------------
// #20 Cancellations analysis
// ---------------------------------------------------------------------------

export interface RecentCancellation {
  readonly name: string
  readonly dateIso: string
  readonly label: string
}

export interface CancellationsAnalysis {
  readonly windowStartIso: string
  readonly windowEndIso: string
  readonly cancelledCount: number
  readonly totalCount: number
  /** Cancellation rate in percent, rounded to one decimal. Zero when no orders. */
  readonly ratePercent: number
  readonly recent: readonly RecentCancellation[]
  readonly topWeekday: { readonly label: string; readonly count: number } | null
}

export function computeCancellationsAnalysis(
  orders: readonly LegacyOrder[],
  now: Date = new Date(),
): CancellationsAnalysis {
  const currentSunday = sundayOf(businessTodayUtc(now))
  const windowStart = currentSunday - (LOOKBACK_WEEKS - 1) * WEEK_MS
  const windowEnd = currentSunday + WEEK_MS

  let cancelledCount = 0
  let totalCount = 0
  const weekdayCounts = new Array<number>(7).fill(0)
  const cancelled: { name: string; time: number }[] = []

  for (const { order, time, cancelled: isCancelled } of datedOrders(orders)) {
    if (time < windowStart || time >= windowEnd) continue
    totalCount += 1
    if (!isCancelled) continue
    cancelledCount += 1
    weekdayCounts[new Date(time).getUTCDay()] += 1
    cancelled.push({ name: text(order.name) || 'ללא שם', time })
  }

  cancelled.sort((left, right) => right.time - left.time)

  let topWeekday: CancellationsAnalysis['topWeekday'] = null
  for (let day = 0; day < 7; day += 1) {
    const count = weekdayCounts[day]!
    if (count > 0 && (topWeekday === null || count > topWeekday.count)) {
      topWeekday = { label: WEEKDAY_LABELS[day]!, count }
    }
  }

  return {
    windowStartIso: isoFromUtcTime(windowStart),
    windowEndIso: isoFromUtcTime(windowEnd - DAY_MS),
    cancelledCount,
    totalCount,
    ratePercent: totalCount === 0 ? 0 : Math.round((cancelledCount / totalCount) * 1000) / 10,
    recent: cancelled.slice(0, RECENT_CANCELLATION_LIMIT).map((item) => ({
      name: item.name,
      dateIso: isoFromUtcTime(item.time),
      label: fullDateLabel(item.time),
    })),
    topWeekday,
  }
}

// ---------------------------------------------------------------------------
// #23 Cost vs revenue per week
// ---------------------------------------------------------------------------

export interface CostRevenueWeek {
  readonly startIso: string
  readonly label: string
  readonly revenueMinorUnits: number
  /** Null when no expense is recorded for any day of the week — unknown, not zero. */
  readonly expensesMinorUnits: number | null
  /** revenue minus expenses; null while expenses are unknown. */
  readonly gapMinorUnits: number | null
}

export interface CostRevenueResult {
  readonly weeks: readonly CostRevenueWeek[]
  readonly invalidTotalCount: number
  readonly invalidExpenseCount: number
}

export function computeCostVsRevenueWeekly(
  store: Readonly<Pick<LegacyStore, 'orders' | 'expenses'>>,
  now: Date = new Date(),
): CostRevenueResult {
  const currentSunday = sundayOf(businessTodayUtc(now))
  const firstSunday = currentSunday - (LOOKBACK_WEEKS - 1) * WEEK_MS
  const windowEnd = currentSunday + WEEK_MS

  const revenue = new Array<number>(LOOKBACK_WEEKS).fill(0)
  const expenses = new Array<number | null>(LOOKBACK_WEEKS).fill(null)
  let invalidTotalCount = 0
  let invalidExpenseCount = 0

  for (const { order, time, cancelled } of datedOrders(store.orders)) {
    if (cancelled || time < firstSunday || time >= windowEnd) continue
    const index = Math.floor((time - firstSunday) / WEEK_MS)
    const total = validTotalMinorUnits(order)
    if (total === null) {
      invalidTotalCount += 1
    } else {
      revenue[index] = checkedAdd(revenue[index]!, total, 'weekly revenue')
    }
  }

  for (const [rawDate, rawValue] of Object.entries(store.expenses ?? {})) {
    const time = utcTimeFromIsoDate(rawDate)
    if (time === null || time < firstSunday || time >= windowEnd) continue
    const index = Math.floor((time - firstSunday) / WEEK_MS)
    const parsed = parseLegacyUsdAmount(rawValue)
    if (parsed.state === 'invalid') {
      invalidExpenseCount += 1
      continue
    }
    expenses[index] = checkedAdd(expenses[index] ?? 0, parsed.minorUnits, 'weekly expenses')
  }

  const weeks = revenue.map((revenueMinorUnits, index): CostRevenueWeek => {
    const sunday = firstSunday + index * WEEK_MS
    const expensesMinorUnits = expenses[index] ?? null
    return {
      startIso: isoFromUtcTime(sunday),
      label: dayMonthLabel(sunday),
      revenueMinorUnits,
      expensesMinorUnits,
      gapMinorUnits: expensesMinorUnits === null ? null : revenueMinorUnits - expensesMinorUnits,
    }
  })

  return { weeks, invalidTotalCount, invalidExpenseCount }
}

// ---------------------------------------------------------------------------
// #26 Yearly summary
// ---------------------------------------------------------------------------

export interface YearlySummary {
  readonly year: number
  readonly orderCount: number
  readonly revenueMinorUnits: number
  readonly invalidTotalCount: number
  readonly bestMonth: {
    readonly month: number
    readonly label: string
    readonly revenueMinorUnits: number
  } | null
  readonly busiestWeekday: { readonly label: string; readonly count: number } | null
}

function hebrewMonthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat('he-IL', {
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

export function computeYearlySummary(
  orders: readonly LegacyOrder[],
  now: Date = new Date(),
): YearlySummary {
  const year = new Date(businessTodayUtc(now)).getUTCFullYear()

  let orderCount = 0
  let revenueMinorUnits = 0
  let invalidTotalCount = 0
  const monthRevenue = new Array<number>(12).fill(0)
  const monthHasRevenue = new Array<boolean>(12).fill(false)
  const weekdayCounts = new Array<number>(7).fill(0)

  for (const { order, time, cancelled } of datedOrders(orders)) {
    if (cancelled) continue
    const date = new Date(time)
    if (date.getUTCFullYear() !== year) continue
    orderCount += 1
    weekdayCounts[date.getUTCDay()] += 1
    const total = validTotalMinorUnits(order)
    if (total === null) {
      invalidTotalCount += 1
      continue
    }
    revenueMinorUnits = checkedAdd(revenueMinorUnits, total, 'yearly revenue')
    const monthIndex = date.getUTCMonth()
    monthRevenue[monthIndex] = checkedAdd(monthRevenue[monthIndex]!, total, 'monthly revenue')
    monthHasRevenue[monthIndex] = true
  }

  let bestMonth: YearlySummary['bestMonth'] = null
  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    if (!monthHasRevenue[monthIndex]) continue
    const value = monthRevenue[monthIndex]!
    if (bestMonth === null || value > bestMonth.revenueMinorUnits) {
      bestMonth = {
        month: monthIndex + 1,
        label: hebrewMonthLabel(year, monthIndex + 1),
        revenueMinorUnits: value,
      }
    }
  }

  let busiestWeekday: YearlySummary['busiestWeekday'] = null
  for (let day = 0; day < 7; day += 1) {
    const count = weekdayCounts[day]!
    if (count > 0 && (busiestWeekday === null || count > busiestWeekday.count)) {
      busiestWeekday = { label: WEEKDAY_LABELS[day]!, count }
    }
  }

  return { year, orderCount, revenueMinorUnits, invalidTotalCount, bestMonth, busiestWeekday }
}

// ---------------------------------------------------------------------------
// #11 Hotel statistics
// ---------------------------------------------------------------------------

export interface HotelStat {
  readonly name: string
  readonly orderCount: number
  readonly revenueMinorUnits: number
  readonly invalidTotalCount: number
}

export function computeHotelStats(
  orders: readonly LegacyOrder[],
  limit: number = TOP_HOTEL_LIMIT,
): readonly HotelStat[] {
  const groups = new Map<
    string,
    { orderCount: number; revenueMinorUnits: number; invalidTotalCount: number }
  >()

  for (const order of orders) {
    if (isCancelledInsightsOrder(order)) continue
    const name = text(order['hotelName']) || text(order.place) || NO_HOTEL_LABEL
    const group = groups.get(name) ?? { orderCount: 0, revenueMinorUnits: 0, invalidTotalCount: 0 }
    group.orderCount += 1
    const total = validTotalMinorUnits(order)
    if (total === null) {
      group.invalidTotalCount += 1
    } else {
      group.revenueMinorUnits = checkedAdd(group.revenueMinorUnits, total, 'hotel revenue')
    }
    groups.set(name, group)
  }

  return [...groups.entries()]
    .map(([name, group]) => ({ name, ...group }))
    .sort(
      (left, right) =>
        right.orderCount - left.orderCount ||
        right.revenueMinorUnits - left.revenueMinorUnits ||
        left.name.localeCompare(right.name, 'he'),
    )
    .slice(0, limit)
}

// ---------------------------------------------------------------------------
// #27 Quick quote calculator
// ---------------------------------------------------------------------------

export interface QuickQuoteInput {
  readonly couples: number
  readonly extraChallahs: number
  readonly extraSalads: number
  readonly extraFirsts: number
}

export interface QuickQuoteLine {
  readonly label: string
  readonly quantity: number
  readonly amountMinorUnits: number
}

export interface QuickQuote {
  readonly lines: readonly QuickQuoteLine[]
  readonly totalMinorUnits: number
}

/**
 * Prices an estimate from the live menu (couple price, challah price, and the
 * existing salad-overage block/remainder and first-course overage fields).
 * The menu must come from buildOrderEditorMenu so edited prices are honored.
 */
export function computeQuickQuote(
  menu: Readonly<OrderEditorMenu>,
  input: Readonly<QuickQuoteInput>,
): QuickQuote {
  const couples = requireNonNegativeSafeInteger(input.couples, 'couples')
  const extraChallahs = requireNonNegativeSafeInteger(input.extraChallahs, 'extra challahs')
  const extraSalads = requireNonNegativeSafeInteger(input.extraSalads, 'extra salads')
  const extraFirsts = requireNonNegativeSafeInteger(input.extraFirsts, 'extra firsts')

  const saladPricing = calculateSaladPricing({
    coupleMeals: 0,
    orderedSalads: extraSalads,
    blockPriceMinorUnits: menu.saladBlockPriceMinorUnits,
    remainderPriceMinorUnits: menu.saladRemainderPriceMinorUnits,
  })

  const candidates: QuickQuoteLine[] = [
    {
      label: 'ארוחות זוגיות',
      quantity: couples,
      amountMinorUnits: checkedMultiply(couples, menu.couplePriceMinorUnits, 'couple charge'),
    },
    {
      label: 'חלות נוספות',
      quantity: extraChallahs,
      amountMinorUnits: checkedMultiply(
        extraChallahs,
        menu.challahPriceMinorUnits,
        'challah charge',
      ),
    },
    {
      label: 'סלטים נוספים',
      quantity: extraSalads,
      amountMinorUnits: saladPricing.surchargeMinorUnits,
    },
    {
      label: 'מנות ראשונות נוספות',
      quantity: extraFirsts,
      amountMinorUnits: checkedMultiply(
        extraFirsts,
        menu.extraFishFilletPriceMinorUnits,
        'first course charge',
      ),
    },
  ]

  const lines = candidates.filter((line) => line.quantity > 0)
  let totalMinorUnits = 0
  for (const line of lines) {
    totalMinorUnits = checkedAdd(totalMinorUnits, line.amountMinorUnits, 'quote total')
  }
  return { lines, totalMinorUnits }
}
