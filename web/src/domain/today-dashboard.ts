import { checkedAdd } from './money.ts'
import type { LegacyOrder, LegacyStore } from './store.ts'

const UPCOMING_DATE_LIMIT = 4
const MILLISECONDS_PER_DAY = 86_400_000
const DEFAULT_LOCALE = 'he-IL'
const CANCELLED_STATUS_ALIASES = new Set(['בוטלה', 'cancelled', 'canceled'])
const USD_AMOUNT_PATTERN = '(?:(?:\\d+|\\d{1,3}(?:,\\d{3})+)(?:\\.\\d{1,2})?|\\.\\d{1,2})'
const LEGACY_USD_FORMAT = new RegExp(`^(?:\\$${USD_AMOUNT_PATTERN}|${USD_AMOUNT_PATTERN}\\$?)$`)

type LegacyOrderId = string | number | null

export type TodayWarningCode =
  | 'INVALID_SERVICE_DATE'
  | 'MISSING_ORDER_ID'
  | 'INVALID_MEALS'
  | 'MEALS_OVERFLOW'
  | 'INVALID_CAPACITY'
  | 'INVALID_MONEY'
  | 'MONEY_OVERFLOW'
  | 'INVALID_BACKUP_TIMESTAMP'

export interface TodayWarning {
  readonly code: TodayWarningCode
  readonly orderId: LegacyOrderId
  readonly customerName: string
  readonly path: string
  readonly message: string
}

export interface TodayFulfillment {
  readonly orderId: string | null
  readonly customerName: string
  readonly pickup: boolean
  readonly destination: string
  readonly time: string | null
  readonly status: string
  readonly meals: number | null
}

export type TodayCapacitySetting =
  | { readonly kind: 'unconfigured' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'configured'; readonly maximumMeals: number }

export interface TodayCapacityGroup {
  readonly serviceDate: string
  readonly localizedDate: string
  readonly orderCount: number
  readonly meals: number | null
  readonly capacityPercent: number | null
  readonly full: boolean | null
}

export type TodayAttentionKind = 'no-deposit' | 'pending'

export interface TodayAttentionAlert {
  readonly kind: TodayAttentionKind
  readonly orderId: string | null
  readonly customerName: string
  readonly serviceDate: string
  readonly localizedDate: string
}

export type TodayBackupReminder =
  | { readonly kind: 'never'; readonly daysSinceBackup: null }
  | { readonly kind: 'stale'; readonly daysSinceBackup: number }
  | { readonly kind: 'invalid'; readonly daysSinceBackup: null }

export interface TodayDashboard {
  readonly todayIso: string
  readonly localizedDate: string
  readonly greeting: 'בוקר טוב' | 'צהריים טובים' | 'ערב טוב'
  readonly globallyEmpty: boolean
  readonly fulfillments: readonly TodayFulfillment[]
  readonly capacity: TodayCapacitySetting
  readonly upcomingGroups: readonly TodayCapacityGroup[]
  readonly hasUpcomingOrders: boolean
  readonly alerts: readonly TodayAttentionAlert[]
  readonly outstandingMinorUnits: number | null
  readonly outstandingComplete: boolean
  readonly backupReminder: TodayBackupReminder | null
  readonly warnings: readonly TodayWarning[]
}

export interface TodayDashboardOptions {
  readonly now?: Date
  readonly timeZone?: string
  readonly locale?: string
}

interface OrderContext {
  readonly sourceIndex: number
  readonly order: Readonly<LegacyOrder>
  readonly routeOrderId: string | null
  readonly customerName: string
  readonly serviceDate: string
  readonly time: string
  readonly status: string
  readonly meals: number | null
  readonly totalMinorUnits: number | null
  readonly depositMinorUnits: number | null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function orderId(value: unknown): LegacyOrderId {
  if (typeof value === 'string') return value.trim() === '' ? null : value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  return null
}

function routeOrderId(value: LegacyOrderId): string | null {
  return value === null ? null : String(value)
}

function isCancelled(order: Readonly<LegacyOrder>): boolean {
  const status = text(order.status)
  return CANCELLED_STATUS_ALIASES.has(status.toLocaleLowerCase('en-US'))
}

function isRealIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match === null) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function zonedCalendarParts(now: Date, timeZone: string): {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
} {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((candidate) => candidate.type === type)?.value
    if (value === undefined || !/^\d+$/.test(value)) {
      throw new RangeError(`Unable to resolve ${type} in ${timeZone}`)
    }
    return Number(value)
  }

  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
  }
}

function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function localizedServiceDate(serviceDate: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(serviceDate)
  if (match === null) throw new RangeError('serviceDate must be a valid ISO date')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

function customerName(order: Readonly<LegacyOrder>): string {
  return text(order.name) || 'ללא שם'
}

function warningContext(order: Readonly<LegacyOrder>): Pick<TodayWarning, 'orderId' | 'customerName'> {
  return { orderId: orderId(order.id), customerName: customerName(order) }
}

function pushOrderWarning(
  warnings: TodayWarning[],
  order: Readonly<LegacyOrder>,
  code: TodayWarningCode,
  path: string,
  message: string,
): void {
  warnings.push({ code, ...warningContext(order), path, message })
}

function parseCount(value: unknown, onInvalid: () => void): number | null {
  if (value === undefined || value === null || value === '') return 0
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value >= 0) return value
    onInvalid()
    return null
  }
  if (typeof value === 'string') {
    const normalized = value.trim()
    if (/^\d+$/.test(normalized)) {
      const parsed = BigInt(normalized)
      if (parsed <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(parsed)
    }
  }
  onInvalid()
  return null
}

function parseMoneyMinorUnits(
  value: unknown,
  order: Readonly<LegacyOrder>,
  path: 'total' | 'deposit',
  warnings: TodayWarning[],
): number | null {
  if (value === undefined || value === null || value === '') return 0

  const raw =
    typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
  if (!LEGACY_USD_FORMAT.test(raw)) {
    pushOrderWarning(
      warnings,
      order,
      'INVALID_MONEY',
      path,
      `${path} must be a non-negative USD amount with at most two decimal places`,
    )
    return null
  }

  const normalized = raw.replace(/^\$|\$$/g, '').replaceAll(',', '')
  const [dollars, cents = ''] = normalized.split('.')
  const amount = BigInt(dollars || '0') * 100n + BigInt(cents.padEnd(2, '0'))
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    pushOrderWarning(
      warnings,
      order,
      'MONEY_OVERFLOW',
      path,
      `${path} exceeds the safe USD minor-unit range`,
    )
    return null
  }

  return Number(amount)
}

function activeUpcomingOrders(
  orders: readonly LegacyOrder[],
  todayIso: string,
  warnings: TodayWarning[],
): OrderContext[] {
  const contexts: OrderContext[] = []

  orders.forEach((order, sourceIndex) => {
    if (isCancelled(order)) return

    const serviceDate = text(order.date)
    if (serviceDate === '') return
    if (!isRealIsoDate(serviceDate)) {
      pushOrderWarning(
        warnings,
        order,
        'INVALID_SERVICE_DATE',
        'date',
        'date must be a real ISO calendar date',
      )
      return
    }
    if (serviceDate < todayIso) return

    const currentOrderId = orderId(order.id)
    if (currentOrderId === null) {
      pushOrderWarning(
        warnings,
        order,
        'MISSING_ORDER_ID',
        'id',
        'active order is missing a stable ID for edit navigation',
      )
    }

    const meals = parseCount(order.meals, () => {
      pushOrderWarning(
        warnings,
        order,
        'INVALID_MEALS',
        'meals',
        'meals must be a non-negative safe integer',
      )
    })

    contexts.push({
      sourceIndex,
      order,
      routeOrderId: routeOrderId(currentOrderId),
      customerName: customerName(order),
      serviceDate,
      time: text(order.time),
      status: text(order.status) || 'חדשה',
      meals,
      totalMinorUnits: parseMoneyMinorUnits(order.total, order, 'total', warnings),
      depositMinorUnits: parseMoneyMinorUnits(order.deposit, order, 'deposit', warnings),
    })
  })

  return contexts.sort(
    (left, right) =>
      left.serviceDate.localeCompare(right.serviceDate) ||
      (left.time || '99:99').localeCompare(right.time || '99:99') ||
      left.sourceIndex - right.sourceIndex,
  )
}

function readCapacity(store: Readonly<LegacyStore>, warnings: TodayWarning[]): TodayCapacitySetting {
  const rawCapacity = store.settings?.maxMeals
  const capacity = parseCount(rawCapacity, () => {
    warnings.push({
      code: 'INVALID_CAPACITY',
      orderId: null,
      customerName: '',
      path: 'settings.maxMeals',
      message: 'settings.maxMeals must be a non-negative safe integer',
    })
  })

  if (capacity === null) return { kind: 'invalid' }
  if (capacity === 0) return { kind: 'unconfigured' }
  return { kind: 'configured', maximumMeals: capacity }
}

function buildCapacityGroups(
  orders: readonly OrderContext[],
  capacity: TodayCapacitySetting,
  locale: string,
  warnings: TodayWarning[],
): TodayCapacityGroup[] {
  const dates = [...new Set(orders.map((order) => order.serviceDate))].slice(0, UPCOMING_DATE_LIMIT)

  return dates.map((serviceDate) => {
    const dateOrders = orders.filter((order) => order.serviceDate === serviceDate)
    let meals: number | null = 0

    for (const context of dateOrders) {
      if (context.meals === null) {
        meals = null
        continue
      }
      if (meals === null) continue
      try {
        meals = checkedAdd(meals, context.meals, `${serviceDate} meals`)
      } catch {
        meals = null
        pushOrderWarning(
          warnings,
          context.order,
          'MEALS_OVERFLOW',
          'meals',
          `meal capacity for ${serviceDate} exceeds the safe integer range`,
        )
      }
    }

    const configuredCapacity = capacity.kind === 'configured' ? capacity.maximumMeals : null
    const capacityPercent =
      configuredCapacity !== null && meals !== null
        ? Math.min(100, Math.round((meals / configuredCapacity) * 100))
        : null
    const full =
      configuredCapacity !== null && meals !== null ? meals >= configuredCapacity : null

    return {
      serviceDate,
      localizedDate: localizedServiceDate(serviceDate, locale),
      orderCount: dateOrders.length,
      meals,
      capacityPercent,
      full,
    }
  })
}

function buildFulfillments(orders: readonly OrderContext[], todayIso: string): TodayFulfillment[] {
  return orders
    .filter((context) => context.serviceDate === todayIso)
    .map((context) => ({
      orderId: context.routeOrderId,
      customerName: context.customerName,
      pickup: context.order.pickup === true,
      destination:
        context.order.pickup === true
          ? 'איסוף עצמי'
          : text(context.order.place) || text(context.order.address) || 'לא צוין יעד',
      time: context.time || null,
      status: context.status,
      meals: context.meals,
    }))
}

function buildAlerts(
  orders: readonly OrderContext[],
  locale: string,
): TodayAttentionAlert[] {
  const alert = (
    kind: TodayAttentionKind,
    context: OrderContext,
  ): TodayAttentionAlert => ({
    kind,
    orderId: context.routeOrderId,
    customerName: context.customerName,
    serviceDate: context.serviceDate,
    localizedDate: localizedServiceDate(context.serviceDate, locale),
  })
  const noDeposit = orders
    .filter(
      (context) =>
        context.order.paid === 'לא' &&
        context.depositMinorUnits === 0 &&
        context.totalMinorUnits !== null &&
        context.totalMinorUnits > 0,
    )
    .map((context) => alert('no-deposit', context))
  const pending = orders
    .filter((context) => context.status === 'חדשה')
    .map((context) => alert('pending', context))

  return [...noDeposit, ...pending]
}

function outstandingBalance(
  orders: readonly OrderContext[],
  warnings: TodayWarning[],
): { readonly amount: number | null; readonly complete: boolean } {
  let amount = 0
  let complete = true

  for (const context of orders) {
    if (context.order.paid === 'כן' || context.order.paid === 'שת"פ') continue
    if (context.totalMinorUnits === null || context.depositMinorUnits === null) {
      complete = false
      continue
    }

    const orderBalance = Math.max(0, context.totalMinorUnits - context.depositMinorUnits)
    try {
      amount = checkedAdd(amount, orderBalance, 'today outstanding balance')
    } catch {
      complete = false
      pushOrderWarning(
        warnings,
        context.order,
        'MONEY_OVERFLOW',
        'outstanding',
        'today outstanding balance exceeds the safe USD minor-unit range',
      )
    }
  }

  return { amount: complete ? amount : null, complete }
}

function backupReminder(
  lastBackup: LegacyStore['lastBackup'],
  nowTimestamp: number,
  warnings: TodayWarning[],
): TodayBackupReminder | null {
  if (lastBackup === undefined) return { kind: 'never', daysSinceBackup: null }
  if (!Number.isSafeInteger(lastBackup) || lastBackup < 0) {
    warnings.push({
      code: 'INVALID_BACKUP_TIMESTAMP',
      orderId: null,
      customerName: '',
      path: 'lastBackup',
      message: 'lastBackup must be a non-negative safe-integer timestamp',
    })
    return { kind: 'invalid', daysSinceBackup: null }
  }

  const elapsed = nowTimestamp - lastBackup
  if (elapsed < 0) return null
  const wholeDays = Math.floor(elapsed / MILLISECONDS_PER_DAY)
  return wholeDays >= 7 ? { kind: 'stale', daysSinceBackup: wholeDays } : null
}

export function formatUsdMinorUnits(minorUnits: number): string {
  if (!Number.isSafeInteger(minorUnits) || minorUnits < 0) {
    throw new RangeError('minorUnits must be a non-negative safe integer')
  }
  const value = BigInt(minorUnits)
  const dollars = value / 100n
  const cents = String(value % 100n).padStart(2, '0')
  return `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(dollars)}.${cents}`
}

export function buildTodayDashboard(
  store: Readonly<LegacyStore>,
  options: TodayDashboardOptions = {},
): TodayDashboard {
  const now = options.now ?? new Date()
  if (!Number.isFinite(now.getTime())) throw new RangeError('now must be a valid Date')

  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const locale = options.locale ?? DEFAULT_LOCALE
  const calendar = zonedCalendarParts(now, timeZone)
  const todayIso = isoDate(calendar.year, calendar.month, calendar.day)
  const warnings: TodayWarning[] = []
  const activeOrders = activeUpcomingOrders(store.orders, todayIso, warnings)
  const capacity = readCapacity(store, warnings)
  const upcomingGroups = buildCapacityGroups(activeOrders, capacity, locale, warnings)
  const outstanding = outstandingBalance(activeOrders, warnings)

  return {
    todayIso,
    localizedDate: localizedServiceDate(todayIso, locale),
    greeting:
      calendar.hour < 12 ? 'בוקר טוב' : calendar.hour < 18 ? 'צהריים טובים' : 'ערב טוב',
    globallyEmpty: store.orders.length === 0,
    fulfillments: buildFulfillments(activeOrders, todayIso),
    capacity,
    upcomingGroups,
    hasUpcomingOrders: activeOrders.length > 0,
    alerts: buildAlerts(activeOrders, locale),
    outstandingMinorUnits: outstanding.amount,
    outstandingComplete: outstanding.complete,
    backupReminder: backupReminder(store.lastBackup, now.getTime(), warnings),
    warnings,
  }
}
