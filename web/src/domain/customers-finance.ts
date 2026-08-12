import { checkedAdd } from './money.ts'
import { normalizeWhatsAppPhone } from './orders-dashboard.ts'
import type { LegacyOrder, LegacyStore } from './store.ts'

const DEFAULT_LOCALE = 'he-IL'
const DEFAULT_BUSINESS_TIME_ZONE = 'Asia/Dubai'
const MAX_TEXT_LENGTH = 10_000
const MAX_ID_LENGTH = 256
const MAX_NUMERIC_TOKEN_LENGTH = 64
const CANCELLED_STATUS_ALIASES = new Set(['בוטלה', 'cancelled', 'canceled'])
const USD_AMOUNT_PATTERN = '(?:(?:\\d+|\\d{1,3}(?:,\\d{3})+)(?:\\.\\d{1,2})?|\\.\\d{1,2})'
const LEGACY_USD_FORMAT = new RegExp(`^(?:\\$${USD_AMOUNT_PATTERN}|${USD_AMOUNT_PATTERN}\\$?)$`)

type LegacyOrderId = string | number | null

export type CustomerFinanceWarningCode =
  | 'INVALID_SERVICE_DATE'
  | 'MISSING_CUSTOMER_IDENTITY'
  | 'INVALID_PHONE'
  | 'MISSING_ORDER_ID'
  | 'DUPLICATE_ORDER_ID'
  | 'INVALID_MONEY'
  | 'MONEY_OVERFLOW'
  | 'INVALID_QUANTITY'
  | 'QUANTITY_OVERFLOW'
  | 'INVALID_EXPENSE_DATE'
  | 'INVALID_CUSTOMER_META'
  | 'AMBIGUOUS_CUSTOMER_META'
  | 'TEXT_TOO_LONG'

export interface CustomerFinanceWarning {
  readonly code: CustomerFinanceWarningCode
  readonly orderId: LegacyOrderId
  readonly customerName: string
  readonly path: string
  readonly message: string
}

export type ParsedLegacyMoney =
  | { readonly state: 'absent'; readonly minorUnits: 0 }
  | { readonly state: 'valid'; readonly minorUnits: number }
  | { readonly state: 'invalid'; readonly minorUnits: null; readonly reason: 'format' | 'overflow' }

export interface CustomerOrderHistoryItem {
  readonly sourceIndex: number
  readonly orderId: string | null
  readonly serviceDate: string | null
  readonly localizedDate: string
  readonly status: string
  readonly cancelled: boolean
  readonly meals: number | null
  readonly totalState: ParsedLegacyMoney['state']
  readonly totalMinorUnits: number | null
}

export interface CustomerDirectoryEntry {
  readonly key: string
  readonly name: string
  readonly phone: string
  readonly telephoneHref: string | null
  readonly whatsappHref: string | null
  readonly vip: boolean
  readonly notes: string
  readonly orderCount: number
  readonly activeOrderCount: number
  readonly totalSpendMinorUnits: number | null
  readonly spendComplete: boolean
  readonly lastServiceDate: string | null
  readonly localizedLastServiceDate: string
  readonly hasUpcomingOrder: boolean
  readonly repeatOrderId: string | null
  readonly history: readonly CustomerOrderHistoryItem[]
}

export interface CustomersDirectory {
  readonly todayIso: string
  readonly globallyEmpty: boolean
  readonly query: string
  readonly searchActive: boolean
  readonly matchCount: number
  readonly customers: readonly CustomerDirectoryEntry[]
  readonly warnings: readonly CustomerFinanceWarning[]
}

export interface CustomersDirectoryOptions {
  readonly query?: string
  readonly now?: Date
  readonly timeZone?: string
  readonly locale?: string
}

export interface FinanceDaySummary {
  readonly serviceDate: string
  readonly localizedDate: string
  readonly orderCount: number
  readonly revenueMinorUnits: number | null
  readonly depositsMinorUnits: number | null
  readonly outstandingMinorUnits: number | null
  readonly expensesMinorUnits: number | null
  readonly profitMinorUnits: number | null
  readonly meals: number | null
}

export interface FinanceTopCustomer {
  readonly key: string
  readonly name: string
  readonly orderCount: number
  readonly revenueMinorUnits: number
}

export interface FinanceDashboard {
  readonly currentMonth: string
  readonly globallyEmpty: boolean
  readonly availableMonths: readonly string[]
  readonly selectedMonth: string | null
  readonly localizedMonth: string
  readonly orderCount: number
  readonly revenueMinorUnits: number | null
  readonly depositsMinorUnits: number | null
  readonly outstandingMinorUnits: number | null
  readonly expensesMinorUnits: number | null
  readonly profitMinorUnits: number | null
  readonly meals: number | null
  readonly days: readonly FinanceDaySummary[]
  readonly topCustomers: readonly FinanceTopCustomer[]
  readonly warnings: readonly CustomerFinanceWarning[]
}

export interface FinanceDashboardOptions {
  readonly selectedMonth?: string
  readonly now?: Date
  readonly timeZone?: string
  readonly locale?: string
}

interface CustomerIdentity {
  readonly key: string
  readonly normalizedPhone: string | null
  readonly rawPhoneDigits: string
  readonly normalizedName: string
}

interface CustomerOrderContext {
  readonly sourceIndex: number
  readonly source: Readonly<LegacyOrder>
  readonly id: LegacyOrderId
  readonly routeId: string | null
  readonly name: string
  readonly phone: string
  readonly identity: CustomerIdentity
  readonly rawDate: string
  readonly serviceDate: string | null
  readonly cancelled: boolean
  readonly total: ParsedLegacyMoney
  readonly meals: number | null
  readonly status: string
}

interface MutableCustomerGroup {
  readonly key: string
  readonly orders: CustomerOrderContext[]
}

interface ParsedCustomerMeta {
  readonly vip: boolean
  readonly notes: string
}

interface FinanceOrderContext {
  readonly source: Readonly<LegacyOrder>
  readonly sourceIndex: number
  readonly serviceDate: string
  readonly total: ParsedLegacyMoney
  readonly deposit: ParsedLegacyMoney
  readonly outstandingMinorUnits: number | null
  readonly meals: number | null
  readonly identity: CustomerIdentity
  readonly customerName: string
}

interface DatedFinanceOrder {
  readonly source: Readonly<LegacyOrder>
  readonly sourceIndex: number
  readonly serviceDate: string
}

interface MutableFinanceAccumulator {
  revenueMinorUnits: number | null
  depositsMinorUnits: number | null
  outstandingMinorUnits: number | null
  expensesMinorUnits: number | null
  meals: number | null
}

function text(value: unknown): string {
  return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH ? value.trim() : ''
}

function displayName(order: Readonly<LegacyOrder>): string {
  return text(order.name) || 'ללא שם'
}

function normalizedName(value: unknown, locale: string): string {
  return text(value).normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase(locale)
}

function legacyOrderId(value: unknown): LegacyOrderId {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed !== '' && value.length <= MAX_ID_LENGTH ? trimmed : null
  }
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null
}

function isCancelled(order: Readonly<LegacyOrder>): boolean {
  return CANCELLED_STATUS_ALIASES.has(text(order.status).toLocaleLowerCase('en-US'))
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

function zonedIsoDate(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).formatToParts(now)
  const read = (partType: Intl.DateTimeFormatPartTypes): string => {
    const value = parts.find((part) => part.type === partType)?.value
    if (value === undefined || !/^\d+$/.test(value)) {
      throw new RangeError(`Unable to resolve ${partType} in ${timeZone}`)
    }
    return value
  }
  return `${read('year')}-${read('month')}-${read('day')}`
}

function localizedDate(serviceDate: string, locale: string): string {
  const [year, month, day] = serviceDate.split('-').map(Number)
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year!, month! - 1, day)))
}

export function formatFinanceMonth(monthKey: string, locale = DEFAULT_LOCALE): string {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) throw new RangeError('monthKey must use YYYY-MM')
  const [year, month] = monthKey.split('-').map(Number)
  if (month! < 1 || month! > 12) throw new RangeError('monthKey must name a real month')
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year!, month! - 1, 1)))
}

export function parseLegacyUsdAmount(value: unknown): ParsedLegacyMoney {
  if (value === undefined || value === null || value === '') {
    return { state: 'absent', minorUnits: 0 }
  }
  const raw =
    typeof value === 'number'
      ? String(value)
      : typeof value === 'string' && value.length <= MAX_NUMERIC_TOKEN_LENGTH
        ? value.trim()
        : ''
  if (!LEGACY_USD_FORMAT.test(raw)) {
    return { state: 'invalid', minorUnits: null, reason: 'format' }
  }
  const normalized = raw.replace(/^\$|\$$/g, '').replaceAll(',', '')
  const [dollars, cents = ''] = normalized.split('.')
  const minorUnits = BigInt(dollars || '0') * 100n + BigInt(cents.padEnd(2, '0'))
  if (minorUnits > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { state: 'invalid', minorUnits: null, reason: 'overflow' }
  }
  return { state: 'valid', minorUnits: Number(minorUnits) }
}

export function formatSignedUsdMinorUnits(minorUnits: number): string {
  if (!Number.isSafeInteger(minorUnits)) {
    throw new RangeError('minorUnits must be a safe integer')
  }
  const negative = minorUnits < 0
  const absolute = BigInt(negative ? -minorUnits : minorUnits)
  const dollars = absolute / 100n
  const cents = String(absolute % 100n).padStart(2, '0')
  const formattedDollars = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(
    dollars,
  )
  return `${negative ? '-' : ''}$${formattedDollars}.${cents}`
}

function addWarning(
  warnings: CustomerFinanceWarning[],
  code: CustomerFinanceWarningCode,
  path: string,
  message: string,
  order?: Readonly<LegacyOrder>,
): void {
  warnings.push({
    code,
    orderId: order === undefined ? null : legacyOrderId(order.id),
    customerName: order === undefined ? '' : displayName(order),
    path,
    message,
  })
}

function moneyWithWarning(
  value: unknown,
  path: string,
  warnings: CustomerFinanceWarning[],
  order?: Readonly<LegacyOrder>,
): ParsedLegacyMoney {
  const parsed = parseLegacyUsdAmount(value)
  if (parsed.state === 'invalid') {
    addWarning(
      warnings,
      parsed.reason === 'overflow' ? 'MONEY_OVERFLOW' : 'INVALID_MONEY',
      path,
      parsed.reason === 'overflow'
        ? `${path} exceeds the safe USD minor-unit range`
        : `${path} must be a non-negative USD amount with at most two decimal places`,
      order,
    )
  }
  return parsed
}

function parseCount(
  value: unknown,
  path: string,
  warnings: CustomerFinanceWarning[],
  order: Readonly<LegacyOrder>,
): number | null {
  if (value === undefined || value === null || value === '') return 0
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = BigInt(value.trim())
    if (parsed <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(parsed)
    addWarning(warnings, 'QUANTITY_OVERFLOW', path, `${path} exceeds the safe integer range`, order)
    return null
  }
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    addWarning(warnings, 'QUANTITY_OVERFLOW', path, `${path} exceeds the safe integer range`, order)
    return null
  }
  addWarning(warnings, 'INVALID_QUANTITY', path, `${path} must be a non-negative safe integer`, order)
  return null
}

function identityForOrder(
  order: Readonly<LegacyOrder>,
  sourceIndex: number,
  locale: string,
  warnings: CustomerFinanceWarning[],
): CustomerIdentity {
  const phone = text(order.phone)
  const rawPhoneDigits = phone.replace(/\D/g, '')
  const normalizedPhone = normalizeWhatsAppPhone(phone)
  const name = normalizedName(order.name, locale)
  if (phone !== '' && normalizedPhone === null) {
    addWarning(warnings, 'INVALID_PHONE', 'phone', 'phone cannot be used for telephone or WhatsApp navigation', order)
  }
  if (normalizedPhone !== null) {
    return { key: `phone:${normalizedPhone}`, normalizedPhone, rawPhoneDigits, normalizedName: name }
  }
  if (name !== '') {
    const suffix = rawPhoneDigits === '' ? '' : `|phone:${rawPhoneDigits}`
    return { key: `name:${name}${suffix}`, normalizedPhone: null, rawPhoneDigits, normalizedName: name }
  }
  addWarning(
    warnings,
    'MISSING_CUSTOMER_IDENTITY',
    'customer',
    'order has neither a usable phone nor a customer name',
    order,
  )
  return {
    key: `anonymous:${sourceIndex}`,
    normalizedPhone: null,
    rawPhoneDigits,
    normalizedName: '',
  }
}

function routeIds(store: Readonly<LegacyStore>): Map<number, string | null> {
  const counts = new Map<string, number>()
  for (const order of store.orders) {
    const id = legacyOrderId(order.id)
    if (id !== null) counts.set(String(id), (counts.get(String(id)) ?? 0) + 1)
  }
  return new Map(
    store.orders.map((order, index) => {
      const id = legacyOrderId(order.id)
      return [index, id !== null && counts.get(String(id)) === 1 ? String(id) : null]
    }),
  )
}

function compareCustomerOrders(left: CustomerOrderContext, right: CustomerOrderContext): number {
  const leftRank = left.serviceDate === null ? 1 : 0
  const rightRank = right.serviceDate === null ? 1 : 0
  return (
    leftRank - rightRank ||
    (right.serviceDate ?? '').localeCompare(left.serviceDate ?? '') ||
    right.sourceIndex - left.sourceIndex
  )
}

function metaCandidates(orders: readonly CustomerOrderContext[]): string[] {
  const candidates: string[] = []
  const append = (value: string): void => {
    if (value !== '' && !candidates.includes(value)) candidates.push(value)
  }
  for (const context of orders) {
    append(context.identity.rawPhoneDigits)
    append(context.identity.normalizedPhone ?? '')
    const originalName = text(context.source.name)
    if (originalName !== '') append(`שם:${originalName}`)
  }
  return candidates
}

function readCustomerMeta(
  store: Readonly<LegacyStore>,
  group: MutableCustomerGroup,
  warnings: CustomerFinanceWarning[],
): ParsedCustomerMeta {
  const source = store.customerMeta
  if (source === undefined) return { vip: false, notes: '' }
  const parsed: ParsedCustomerMeta[] = []
  const representative = group.orders[0]?.source
  for (const key of metaCandidates(group.orders)) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue
    const value = source[key]
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      addWarning(warnings, 'INVALID_CUSTOMER_META', `customerMeta.${key}`, 'customer metadata must be an object', representative)
      continue
    }
    const record = value as Readonly<Record<string, unknown>>
    if (record.vip !== undefined && typeof record.vip !== 'boolean') {
      addWarning(warnings, 'INVALID_CUSTOMER_META', `customerMeta.${key}.vip`, 'vip must be boolean', representative)
    }
    if (record.notes !== undefined && (typeof record.notes !== 'string' || record.notes.length > MAX_TEXT_LENGTH)) {
      addWarning(warnings, 'INVALID_CUSTOMER_META', `customerMeta.${key}.notes`, 'notes must be bounded text', representative)
    }
    parsed.push({
      vip: record.vip === true,
      notes: typeof record.notes === 'string' && record.notes.length <= MAX_TEXT_LENGTH ? record.notes.trim() : '',
    })
  }
  const distinctNotes = [...new Set(parsed.map((meta) => meta.notes).filter(Boolean))]
  if (distinctNotes.length > 1) {
    addWarning(
      warnings,
      'AMBIGUOUS_CUSTOMER_META',
      `customerMeta.${group.key}.notes`,
      'multiple legacy metadata records contain different notes',
      representative,
    )
  }
  return {
    vip: parsed.some((meta) => meta.vip),
    notes: distinctNotes.length === 1 ? distinctNotes[0]! : '',
  }
}

function checkedAggregate(
  current: number | null,
  amount: number,
  path: string,
  warnings: CustomerFinanceWarning[],
  order?: Readonly<LegacyOrder>,
  overflowCode: 'MONEY_OVERFLOW' | 'QUANTITY_OVERFLOW' = 'MONEY_OVERFLOW',
): number | null {
  if (current === null) return null
  try {
    return checkedAdd(current, amount, path)
  } catch {
    addWarning(warnings, overflowCode, path, `${path} exceeds the safe integer range`, order)
    return null
  }
}

function uniqueWarnings(warnings: readonly CustomerFinanceWarning[]): CustomerFinanceWarning[] {
  return warnings.filter(
    (warning, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.code === warning.code &&
          candidate.orderId === warning.orderId &&
          candidate.path === warning.path,
      ) === index,
  )
}

export function buildCustomersDirectory(
  store: Readonly<LegacyStore>,
  options: CustomersDirectoryOptions = {},
): CustomersDirectory {
  const now = options.now ?? new Date()
  if (!Number.isFinite(now.getTime())) throw new RangeError('now must be a valid Date')
  const locale = options.locale ?? DEFAULT_LOCALE
  const timeZone = options.timeZone ?? DEFAULT_BUSINESS_TIME_ZONE
  const todayIso = zonedIsoDate(now, timeZone)
  const warnings: CustomerFinanceWarning[] = []
  const safeRouteIds = routeIds(store)
  const rawIdCounts = new Map<string, number>()
  for (const order of store.orders) {
    const id = legacyOrderId(order.id)
    if (id !== null) rawIdCounts.set(String(id), (rawIdCounts.get(String(id)) ?? 0) + 1)
  }

  const contexts = store.orders.map((order, sourceIndex): CustomerOrderContext => {
    const id = legacyOrderId(order.id)
    if (id === null) {
      addWarning(warnings, 'MISSING_ORDER_ID', 'id', 'order does not have a usable route identifier', order)
    } else if ((rawIdCounts.get(String(id)) ?? 0) > 1) {
      addWarning(warnings, 'DUPLICATE_ORDER_ID', 'id', 'order identifier is ambiguous', order)
    }
    const rawDate = text(order.date)
    const serviceDate = isRealIsoDate(rawDate) ? rawDate : null
    if (rawDate !== '' && serviceDate === null) {
      addWarning(warnings, 'INVALID_SERVICE_DATE', 'date', 'date must be a real ISO calendar date', order)
    }
    if (typeof order.name === 'string' && order.name.length > MAX_TEXT_LENGTH) {
      addWarning(warnings, 'TEXT_TOO_LONG', 'name', 'name exceeds the supported text length', order)
    }
    return {
      sourceIndex,
      source: order,
      id,
      routeId: safeRouteIds.get(sourceIndex) ?? null,
      name: displayName(order),
      phone: text(order.phone),
      identity: identityForOrder(order, sourceIndex, locale, warnings),
      rawDate,
      serviceDate,
      cancelled: isCancelled(order),
      total: moneyWithWarning(order.total, 'total', warnings, order),
      meals: parseCount(order.meals, 'meals', warnings, order),
      status: text(order.status) || 'חדשה',
    }
  })

  const groups = new Map<string, MutableCustomerGroup>()
  for (const context of contexts) {
    const group = groups.get(context.identity.key)
    if (group === undefined) {
      groups.set(context.identity.key, { key: context.identity.key, orders: [context] })
    } else {
      group.orders.push(context)
    }
  }

  const entries = [...groups.values()].map((group): CustomerDirectoryEntry => {
    const sorted = [...group.orders].sort(compareCustomerOrders)
    const newest = sorted[0]!
    const latestNamed = sorted.find((context) => text(context.source.name) !== '') ?? newest
    const latestPhoned = sorted.find((context) => text(context.source.phone) !== '')
    const active = sorted.filter((context) => !context.cancelled)
    let spend: number | null = 0
    for (const context of active) {
      if (context.total.state === 'invalid') {
        spend = null
      } else if (spend !== null) {
        spend = checkedAggregate(spend, context.total.minorUnits, 'customer.totalSpend', warnings, context.source)
      }
    }
    const meta = readCustomerMeta(store, group, warnings)
    const repeat = active.find((context) => context.routeId !== null)
    const normalizedPhone = latestPhoned?.identity.normalizedPhone ?? null
    const phone = latestPhoned?.phone ?? ''
    return {
      key: group.key,
      name: latestNamed.name,
      phone,
      telephoneHref: normalizedPhone === null ? null : `tel:+${normalizedPhone}`,
      whatsappHref: normalizedPhone === null ? null : `https://wa.me/${normalizedPhone}`,
      vip: meta.vip,
      notes: meta.notes,
      orderCount: sorted.length,
      activeOrderCount: active.length,
      totalSpendMinorUnits: spend,
      spendComplete: spend !== null,
      lastServiceDate: newest.serviceDate,
      localizedLastServiceDate:
        newest.serviceDate === null ? 'ללא תאריך תקין' : localizedDate(newest.serviceDate, locale),
      hasUpcomingOrder: active.some(
        (context) => context.serviceDate !== null && context.serviceDate >= todayIso,
      ),
      repeatOrderId: repeat?.routeId ?? null,
      history: sorted.map(
        (context): CustomerOrderHistoryItem => ({
          sourceIndex: context.sourceIndex,
          orderId: context.routeId,
          serviceDate: context.serviceDate,
          localizedDate:
            context.serviceDate === null ? 'ללא תאריך תקין' : localizedDate(context.serviceDate, locale),
          status: context.status,
          cancelled: context.cancelled,
          meals: context.meals,
          totalState: context.total.state,
          totalMinorUnits: context.total.minorUnits,
        }),
      ),
    }
  })

  entries.sort(
    (left, right) =>
      Number(right.vip) - Number(left.vip) ||
      (right.lastServiceDate ?? '').localeCompare(left.lastServiceDate ?? '') ||
      left.name.localeCompare(right.name, locale) ||
      left.key.localeCompare(right.key),
  )
  const query = (options.query ?? '').slice(0, MAX_TEXT_LENGTH).trim()
  const normalizedQuery = query.normalize('NFKC').toLocaleLowerCase(locale)
  const customers =
    normalizedQuery === ''
      ? entries
      : entries.filter((entry) => {
          const aliases = groups.get(entry.key)?.orders.flatMap((context) => [
            context.name,
            context.phone,
            context.identity.rawPhoneDigits,
            context.identity.normalizedPhone ?? '',
          ]) ?? []
          return [entry.name, entry.phone, entry.notes, entry.key, ...aliases]
            .join(' ')
            .normalize('NFKC')
            .toLocaleLowerCase(locale)
            .includes(normalizedQuery)
        })

  return {
    todayIso,
    globallyEmpty: store.orders.length === 0,
    query,
    searchActive: normalizedQuery !== '',
    matchCount: customers.length,
    customers,
    warnings: uniqueWarnings(warnings),
  }
}

function resolveFinanceMonth(months: readonly string[], requested: string, current: string): string | null {
  if (months.includes(requested)) return requested
  const ascending = [...months].sort()
  return ascending.filter((month) => month <= current).at(-1) ?? ascending[0] ?? null
}

function createAccumulator(): MutableFinanceAccumulator {
  return {
    revenueMinorUnits: 0,
    depositsMinorUnits: 0,
    outstandingMinorUnits: 0,
    expensesMinorUnits: 0,
    meals: 0,
  }
}

function addFinanceAmount(
  accumulator: MutableFinanceAccumulator,
  field: keyof MutableFinanceAccumulator,
  amount: number | null,
  warnings: CustomerFinanceWarning[],
  path: string,
  order?: Readonly<LegacyOrder>,
): void {
  if (amount === null || accumulator[field] === null) {
    accumulator[field] = null
    return
  }
  accumulator[field] = checkedAggregate(
    accumulator[field],
    amount,
    path,
    warnings,
    order,
    field === 'meals' ? 'QUANTITY_OVERFLOW' : 'MONEY_OVERFLOW',
  )
}

function subtractIfComplete(left: number | null, right: number | null): number | null {
  if (left === null || right === null) return null
  return left - right
}

function datedFinanceOrder(
  order: Readonly<LegacyOrder>,
  sourceIndex: number,
  warnings: CustomerFinanceWarning[],
): DatedFinanceOrder | null {
  if (isCancelled(order)) return null
  const rawDate = text(order.date)
  if (!isRealIsoDate(rawDate)) {
    addWarning(warnings, 'INVALID_SERVICE_DATE', 'date', 'date must be a real ISO calendar date', order)
    return null
  }
  return { source: order, sourceIndex, serviceDate: rawDate }
}

function financeContext(
  datedOrder: DatedFinanceOrder,
  locale: string,
  warnings: CustomerFinanceWarning[],
): FinanceOrderContext {
  const { source: order, sourceIndex, serviceDate } = datedOrder
  const total = moneyWithWarning(order.total, 'total', warnings, order)
  const deposit = moneyWithWarning(order.deposit, 'deposit', warnings, order)
  const outstandingMinorUnits =
    total.state === 'invalid' || deposit.state === 'invalid'
      ? null
      : text(order.paid) === 'כן' || text(order.paid) === 'שת"פ'
        ? 0
        : Math.max(0, total.minorUnits - deposit.minorUnits)
  return {
    source: order,
    sourceIndex,
    serviceDate,
    total,
    deposit,
    outstandingMinorUnits,
    meals: parseCount(order.meals, 'meals', warnings, order),
    identity: identityForOrder(order, sourceIndex, locale, warnings),
    customerName: displayName(order),
  }
}

export function buildFinanceDashboard(
  store: Readonly<LegacyStore>,
  options: FinanceDashboardOptions = {},
): FinanceDashboard {
  const now = options.now ?? new Date()
  if (!Number.isFinite(now.getTime())) throw new RangeError('now must be a valid Date')
  const locale = options.locale ?? DEFAULT_LOCALE
  const timeZone = options.timeZone ?? DEFAULT_BUSINESS_TIME_ZONE
  const currentMonth = zonedIsoDate(now, timeZone).slice(0, 7)
  const warnings: CustomerFinanceWarning[] = []
  const datedOrders = store.orders
    .map((order, index) => datedFinanceOrder(order, index, warnings))
    .filter((context): context is DatedFinanceOrder => context !== null)
  const expenses = store.expenses ?? {}
  const expenseDates: string[] = []
  for (const date of Object.keys(expenses)) {
    if (!isRealIsoDate(date)) {
      addWarning(warnings, 'INVALID_EXPENSE_DATE', `expenses.${date}`, 'expense key must be a real ISO calendar date')
    } else {
      expenseDates.push(date)
    }
  }
  const availableMonths = [
    ...new Set([
      ...datedOrders.map((context) => context.serviceDate.slice(0, 7)),
      ...expenseDates.map((date) => date.slice(0, 7)),
    ]),
  ].sort((left, right) => right.localeCompare(left))
  const selectedMonth = resolveFinanceMonth(
    availableMonths,
    options.selectedMonth ?? '',
    currentMonth,
  )
  if (selectedMonth === null) {
    return {
      currentMonth,
      globallyEmpty: true,
      availableMonths,
      selectedMonth: null,
      localizedMonth: '',
      orderCount: 0,
      revenueMinorUnits: 0,
      depositsMinorUnits: 0,
      outstandingMinorUnits: 0,
      expensesMinorUnits: 0,
      profitMinorUnits: 0,
      meals: 0,
      days: [],
      topCustomers: [],
      warnings: uniqueWarnings(warnings),
    }
  }

  const monthOrders = datedOrders
    .filter((context) => context.serviceDate.slice(0, 7) === selectedMonth)
    .map((context) => financeContext(context, locale, warnings))
  const dates = [
    ...new Set([
      ...monthOrders.map((context) => context.serviceDate),
      ...expenseDates.filter((date) => date.slice(0, 7) === selectedMonth),
    ]),
  ].sort()
  const month = createAccumulator()
  const dayAccumulators = new Map<string, MutableFinanceAccumulator>(
    dates.map((date) => [date, createAccumulator()]),
  )

  for (const context of monthOrders) {
    const day = dayAccumulators.get(context.serviceDate)!
    const total = context.total.state === 'invalid' ? null : context.total.minorUnits
    const deposit = context.deposit.state === 'invalid' ? null : context.deposit.minorUnits
    for (const accumulator of [month, day]) {
      addFinanceAmount(accumulator, 'revenueMinorUnits', total, warnings, 'finance.revenue', context.source)
      addFinanceAmount(accumulator, 'depositsMinorUnits', deposit, warnings, 'finance.deposits', context.source)
      addFinanceAmount(
        accumulator,
        'outstandingMinorUnits',
        context.outstandingMinorUnits,
        warnings,
        'finance.outstanding',
        context.source,
      )
      addFinanceAmount(accumulator, 'meals', context.meals, warnings, 'finance.meals', context.source)
    }
  }

  for (const date of dates) {
    if (!Object.prototype.hasOwnProperty.call(expenses, date)) continue
    const parsed = moneyWithWarning(expenses[date], `expenses.${date}`, warnings)
    const amount = parsed.state === 'invalid' ? null : parsed.minorUnits
    addFinanceAmount(month, 'expensesMinorUnits', amount, warnings, 'finance.expenses')
    addFinanceAmount(dayAccumulators.get(date)!, 'expensesMinorUnits', amount, warnings, `finance.days.${date}.expenses`)
  }

  const customerTotals = new Map<
    string,
    { name: string; orderCount: number; revenueMinorUnits: number | null }
  >()
  for (const context of monthOrders) {
    const existing = customerTotals.get(context.identity.key) ?? {
      name: context.customerName,
      orderCount: 0,
      revenueMinorUnits: 0,
    }
    existing.name = context.customerName
    existing.orderCount += 1
    existing.revenueMinorUnits =
      context.total.state === 'invalid'
        ? null
        : checkedAggregate(
            existing.revenueMinorUnits,
            context.total.minorUnits,
            'finance.topCustomers',
            warnings,
            context.source,
          )
    customerTotals.set(context.identity.key, existing)
  }
  const topCustomers = [...customerTotals.entries()]
    .filter((entry): entry is [string, { name: string; orderCount: number; revenueMinorUnits: number }] =>
      entry[1].revenueMinorUnits !== null && entry[1].revenueMinorUnits > 0,
    )
    .map(([key, value]) => ({ key, ...value }))
    .sort(
      (left, right) =>
        right.revenueMinorUnits - left.revenueMinorUnits ||
        right.orderCount - left.orderCount ||
        left.name.localeCompare(right.name, locale) ||
        left.key.localeCompare(right.key),
    )
    .slice(0, 5)

  const dayOrderCounts = new Map<string, number>()
  for (const context of monthOrders) {
    dayOrderCounts.set(context.serviceDate, (dayOrderCounts.get(context.serviceDate) ?? 0) + 1)
  }
  const days = dates.map((date): FinanceDaySummary => {
    const accumulator = dayAccumulators.get(date)!
    return {
      serviceDate: date,
      localizedDate: localizedDate(date, locale),
      orderCount: dayOrderCounts.get(date) ?? 0,
      revenueMinorUnits: accumulator.revenueMinorUnits,
      depositsMinorUnits: accumulator.depositsMinorUnits,
      outstandingMinorUnits: accumulator.outstandingMinorUnits,
      expensesMinorUnits: accumulator.expensesMinorUnits,
      profitMinorUnits: subtractIfComplete(
        accumulator.revenueMinorUnits,
        accumulator.expensesMinorUnits,
      ),
      meals: accumulator.meals,
    }
  })

  return {
    currentMonth,
    globallyEmpty: false,
    availableMonths,
    selectedMonth,
    localizedMonth: formatFinanceMonth(selectedMonth, locale),
    orderCount: monthOrders.length,
    revenueMinorUnits: month.revenueMinorUnits,
    depositsMinorUnits: month.depositsMinorUnits,
    outstandingMinorUnits: month.outstandingMinorUnits,
    expensesMinorUnits: month.expensesMinorUnits,
    profitMinorUnits: subtractIfComplete(month.revenueMinorUnits, month.expensesMinorUnits),
    meals: month.meals,
    days,
    topCustomers,
    warnings: uniqueWarnings(warnings),
  }
}
