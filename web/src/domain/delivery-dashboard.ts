import { checkedAdd } from './money.ts'
import type { LegacyOrder, LegacyStore } from './store.ts'

const DEFAULT_LOCALE = 'he-IL'
const MAX_TEXT_LENGTH = 10_000
const MAX_ORDER_ID_LENGTH = 256
const MAX_MONEY_TOKEN_LENGTH = 64
const USD_AMOUNT_PATTERN = '(?:(?:\\d+|\\d{1,3}(?:,\\d{3})+)(?:\\.\\d{1,2})?|\\.\\d{1,2})'
const LEGACY_USD_FORMAT = new RegExp(`^(?:\\$${USD_AMOUNT_PATTERN}|${USD_AMOUNT_PATTERN}\\$?)$`)
const INACTIVE_STATUS_ALIASES = new Set([
  'בוטלה',
  'נמסרה',
  'cancelled',
  'canceled',
  'delivered',
  'completed',
  'complete',
])

type LegacyOrderId = string | number | null

export type DeliveryWarningCode =
  | 'MISSING_ORDER_ID'
  | 'DUPLICATE_ORDER_ID'
  | 'INVALID_SERVICE_DATE'
  | 'MISSING_DESTINATION'
  | 'INVALID_PHONE'
  | 'INVALID_MONEY'
  | 'MONEY_OVERFLOW'
  | 'TEXT_TOO_LONG'

export interface DeliveryWarning {
  readonly code: DeliveryWarningCode
  readonly orderId: LegacyOrderId
  readonly customerName: string
  readonly path: string
  readonly message: string
}

export interface DeliveryOrderView {
  readonly sourceIndex: number
  readonly orderId: string | null
  readonly customerName: string
  readonly serviceDate: string | null
  readonly time: string
  readonly pickup: boolean
  readonly destination: string
  readonly address: string
  readonly navigationHref: string | null
  readonly phone: string
  readonly telephoneHref: string | null
  readonly status: string
  readonly groupName: string
  readonly collectionState: 'absent' | 'valid' | 'invalid'
  readonly collectionMinorUnits: number | null
}

export interface DeliveryDestinationGroup {
  readonly key: string
  readonly destination: string
  readonly address: string
  readonly navigationHref: string | null
  readonly orderCount: number
  readonly collectionComplete: boolean
  readonly collectionMinorUnits: number | null
  readonly orders: readonly DeliveryOrderView[]
}

export interface DeliveryDateGroup {
  readonly key: string
  readonly dateKind: 'dated' | 'invalid' | 'undated'
  readonly serviceDate: string | null
  readonly localizedDate: string
  readonly orderCount: number
  readonly deliveryOrderCount: number
  readonly pickupOrderCount: number
  readonly collectionComplete: boolean
  readonly collectionMinorUnits: number | null
  readonly destinations: readonly DeliveryDestinationGroup[]
  readonly pickups: readonly DeliveryOrderView[]
}

export interface DeliveryDashboard {
  readonly globallyEmpty: boolean
  readonly activeEmpty: boolean
  readonly activeOrderCount: number
  readonly excludedOrderCount: number
  readonly groups: readonly DeliveryDateGroup[]
  readonly warnings: readonly DeliveryWarning[]
}

export interface DeliveryDashboardOptions {
  readonly locale?: string
}

interface ParsedMoney {
  readonly state: 'absent' | 'valid' | 'invalid'
  readonly minorUnits: number | null
}

interface MutableDestinationGroup {
  key: string
  destination: string
  address: string
  navigationQuery: string
  navigationHref: string | null
  orders: DeliveryOrderView[]
}

interface MutableDateGroup {
  key: string
  dateKind: 'dated' | 'invalid' | 'undated'
  serviceDate: string | null
  localizedDate: string
  deliveries: Map<string, MutableDestinationGroup>
  pickups: DeliveryOrderView[]
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareWarnings(left: DeliveryWarning, right: DeliveryWarning): number {
  return (
    compareText(left.customerName, right.customerName) ||
    compareText(left.path, right.path) ||
    compareText(left.code, right.code) ||
    compareText(left.message, right.message)
  )
}

function boundedText(value: unknown): string {
  return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH ? value.trim() : ''
}

function customerName(order: Readonly<LegacyOrder>): string {
  return boundedText(order.name) || 'ללא שם'
}

function legacyOrderId(value: unknown): LegacyOrderId {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value !== 'string' || value.length > MAX_ORDER_ID_LENGTH) return null
  const normalized = value.trim()
  return normalized === '' ? null : normalized
}

function safeStringOrderId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_ORDER_ID_LENGTH) return null
  return value !== '' && value.trim() === value ? value : null
}

function warningContext(order: Readonly<LegacyOrder>): Pick<DeliveryWarning, 'orderId' | 'customerName'> {
  return { orderId: legacyOrderId(order.id), customerName: customerName(order) }
}

function pushWarning(
  warnings: DeliveryWarning[],
  order: Readonly<LegacyOrder>,
  code: DeliveryWarningCode,
  path: string,
  message: string,
): void {
  warnings.push({ code, ...warningContext(order), path, message })
}

function validateDirectText(order: Readonly<LegacyOrder>, warnings: DeliveryWarning[]): void {
  for (const field of ['date', 'name', 'phone', 'place', 'address', 'time', 'status', 'group'] as const) {
    const value = order[field]
    if (typeof value === 'string' && value.length > MAX_TEXT_LENGTH) {
      pushWarning(warnings, order, 'TEXT_TOO_LONG', field, `${field} exceeds the safe display length`)
    }
  }
  if (typeof order.id === 'string' && order.id.length > MAX_ORDER_ID_LENGTH) {
    pushWarning(warnings, order, 'TEXT_TOO_LONG', 'id', 'id exceeds the safe route length')
  }
}

function isInactive(order: Readonly<LegacyOrder>): boolean {
  return INACTIVE_STATUS_ALIASES.has(boundedText(order.status).toLocaleLowerCase('en-US'))
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

function localizedServiceDate(serviceDate: string, locale: string): string {
  const [year, month, day] = serviceDate.split('-').map(Number)
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year!, month! - 1, day)))
}

function parseMoney(
  value: unknown,
  order: Readonly<LegacyOrder>,
  path: 'total' | 'deposit',
  warnings: DeliveryWarning[],
): ParsedMoney {
  if (value === undefined || value === null || value === '') {
    return { state: 'absent', minorUnits: 0 }
  }
  const raw =
    typeof value === 'number'
      ? String(value)
      : typeof value === 'string' && value.length <= MAX_MONEY_TOKEN_LENGTH
        ? value.trim()
        : ''
  if (!LEGACY_USD_FORMAT.test(raw)) {
    pushWarning(
      warnings,
      order,
      'INVALID_MONEY',
      path,
      `${path} must be a non-negative USD amount with at most two decimal places`,
    )
    return { state: 'invalid', minorUnits: null }
  }

  const normalized = raw.replace(/^\$|\$$/g, '').replaceAll(',', '')
  const [dollars, cents = ''] = normalized.split('.')
  const minorUnits = BigInt(dollars || '0') * 100n + BigInt(cents.padEnd(2, '0'))
  if (minorUnits > BigInt(Number.MAX_SAFE_INTEGER)) {
    pushWarning(warnings, order, 'MONEY_OVERFLOW', path, `${path} exceeds the safe USD range`)
    return { state: 'invalid', minorUnits: null }
  }
  return { state: 'valid', minorUnits: Number(minorUnits) }
}

function collectionAmount(
  order: Readonly<LegacyOrder>,
  warnings: DeliveryWarning[],
): Pick<DeliveryOrderView, 'collectionState' | 'collectionMinorUnits'> {
  const total = parseMoney(order.total, order, 'total', warnings)
  const deposit = parseMoney(order.deposit, order, 'deposit', warnings)
  const paid = boundedText(order.paid)
  if (paid === 'כן' || paid === 'שת"פ' || paid === 'שת״פ') {
    return { collectionState: 'valid', collectionMinorUnits: 0 }
  }
  if (total.state === 'absent') {
    return { collectionState: 'absent', collectionMinorUnits: null }
  }
  if (total.state === 'invalid' || deposit.state === 'invalid') {
    return { collectionState: 'invalid', collectionMinorUnits: null }
  }
  return {
    collectionState: 'valid',
    collectionMinorUnits: Math.max(0, total.minorUnits! - (deposit.minorUnits ?? 0)),
  }
}

function telephoneHref(phone: string): string | null {
  const compact = phone.replace(/[\s().-]/g, '')
  if (!/^\+?\d{7,15}$/.test(compact)) return null
  return `tel:${compact}`
}

export function buildGoogleMapsSearchHref(destination: string): string | null {
  const query = destination.trim()
  if (query === '' || query.length > MAX_TEXT_LENGTH) return null
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

function validatedNavigationHref(value: unknown): string | null {
  const raw = boundedText(value)
  if (raw === '') return null
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'https:') return null
    const hostname = parsed.hostname.toLocaleLowerCase('en-US')
    if (hostname !== 'google.com' && hostname !== 'www.google.com' && !hostname.endsWith('.google.com')) {
      return null
    }
    return parsed.toString()
  } catch {
    return null
  }
}

function validOrderIds(orders: readonly LegacyOrder[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const order of orders) {
    const id = legacyOrderId(order.id)
    if (id === null) continue
    const key = String(id)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function dateIdentity(
  order: Readonly<LegacyOrder>,
  locale: string,
  warnings: DeliveryWarning[],
): Pick<MutableDateGroup, 'key' | 'dateKind' | 'serviceDate' | 'localizedDate'> {
  const rawDate = boundedText(order.date)
  if (rawDate === '') {
    pushWarning(warnings, order, 'INVALID_SERVICE_DATE', 'date', 'active order has no service date')
    return { key: '2:undated', dateKind: 'undated', serviceDate: null, localizedDate: 'ללא תאריך' }
  }
  if (!isRealIsoDate(rawDate)) {
    pushWarning(warnings, order, 'INVALID_SERVICE_DATE', 'date', 'service date is not a real ISO date')
    return {
      key: `1:invalid:${rawDate}`,
      dateKind: 'invalid',
      serviceDate: null,
      localizedDate: `תאריך לא תקין: ${rawDate}`,
    }
  }
  return {
    key: `0:${rawDate}`,
    dateKind: 'dated',
    serviceDate: rawDate,
    localizedDate: localizedServiceDate(rawDate, locale),
  }
}

function compareOrders(left: DeliveryOrderView, right: DeliveryOrderView): number {
  return (
    compareText(left.time, right.time) ||
    compareText(left.destination, right.destination) ||
    compareText(left.customerName, right.customerName) ||
    compareText(left.orderId ?? '', right.orderId ?? '') ||
    left.sourceIndex - right.sourceIndex
  )
}

function sumCollection(
  orders: readonly DeliveryOrderView[],
  warnings: DeliveryWarning[],
): { complete: boolean; minorUnits: number | null } {
  let total = 0
  let complete = true
  for (const order of orders) {
    if (order.collectionState !== 'valid' || order.collectionMinorUnits === null) {
      complete = false
      continue
    }
    try {
      total = checkedAdd(total, order.collectionMinorUnits, 'delivery.collection')
    } catch {
      complete = false
      warnings.push({
        code: 'MONEY_OVERFLOW',
        orderId: order.orderId,
        customerName: order.customerName,
        path: 'collection',
        message: 'delivery collection total exceeds the safe USD range',
      })
    }
  }
  return { complete, minorUnits: complete ? total : null }
}

export function buildDeliveryDashboard(
  store: Readonly<LegacyStore>,
  options: DeliveryDashboardOptions = {},
): DeliveryDashboard {
  const locale = options.locale ?? DEFAULT_LOCALE
  const warnings: DeliveryWarning[] = []
  const groups = new Map<string, MutableDateGroup>()
  const idCounts = validOrderIds(store.orders)
  let excludedOrderCount = 0

  store.orders.forEach((order, sourceIndex) => {
    if (isInactive(order)) {
      excludedOrderCount += 1
      return
    }
    validateDirectText(order, warnings)
    const id = legacyOrderId(order.id)
    const routeIdCandidate = safeStringOrderId(order.id)
    if (id === null || routeIdCandidate === null) {
      pushWarning(warnings, order, 'MISSING_ORDER_ID', 'id', 'active order is missing a safe route ID')
    }
    if (id !== null && (idCounts.get(String(id)) ?? 0) > 1) {
      pushWarning(warnings, order, 'DUPLICATE_ORDER_ID', 'id', 'order ID collides with another order')
    }

    const date = dateIdentity(order, locale, warnings)
    const mutableGroup: MutableDateGroup =
      groups.get(date.key) ??
      { ...date, deliveries: new Map(), pickups: [] }
    groups.set(date.key, mutableGroup)

    const phone = boundedText(order.phone)
    const phoneHref = phone === '' ? null : telephoneHref(phone)
    if (phone !== '' && phoneHref === null) {
      pushWarning(warnings, order, 'INVALID_PHONE', 'phone', 'phone cannot be opened safely')
    }
    const place = boundedText(order.place)
    const address = boundedText(order.address)
    const hotelName = boundedText(order.hotelName)
    const hotelAddress = boundedText(order.hotelAddress)
    const storedNavigationHref = validatedNavigationHref(order.navigationUrl)
    const navigationQuery = hotelAddress || hotelName || address || place
    const navigationIdentity = storedNavigationHref || navigationQuery
    if (order.pickup !== true && navigationIdentity === '') {
      pushWarning(
        warnings,
        order,
        'MISSING_DESTINATION',
        'place',
        'delivery has no stored destination or address',
      )
    }
    const routeId =
      routeIdCandidate !== null && (idCounts.get(routeIdCandidate) ?? 0) === 1
        ? routeIdCandidate
        : null
    const view: DeliveryOrderView = {
      sourceIndex,
      orderId: routeId,
      customerName: customerName(order),
      serviceDate: date.serviceDate,
      time: boundedText(order.time),
      pickup: order.pickup === true,
      destination: order.pickup === true ? 'איסוף עצמי' : place || address || 'יעד לא צוין',
      address: order.pickup === true || address === place ? '' : address,
      navigationHref: order.pickup === true ? null : storedNavigationHref || buildGoogleMapsSearchHref(navigationQuery),
      phone,
      telephoneHref: phoneHref,
      status: boundedText(order.status) || 'חדשה',
      groupName: boundedText(order.group),
      ...collectionAmount(order, warnings),
    }

    if (view.pickup) {
      mutableGroup.pickups.push(view)
      return
    }

    const destinationKey =
      navigationIdentity === ''
        ? `missing:${routeId ?? `${sourceIndex}:${view.customerName}`}`
        : navigationIdentity.toLocaleLowerCase('en-US')
    const destinationGroup =
      mutableGroup.deliveries.get(destinationKey) ??
      ({
        key: destinationKey,
        destination: view.destination,
        address: view.address,
        navigationQuery,
        navigationHref: view.navigationHref,
        orders: [],
      } satisfies MutableDestinationGroup)
    if (compareText(view.destination, destinationGroup.destination) < 0) {
      destinationGroup.destination = view.destination
    }
    if (destinationGroup.address === '' || (view.address !== '' && compareText(view.address, destinationGroup.address) < 0)) {
      destinationGroup.address = view.address
    }
    if (
      destinationGroup.navigationQuery === '' ||
      (navigationQuery !== '' && compareText(navigationQuery, destinationGroup.navigationQuery) < 0)
    ) {
      destinationGroup.navigationQuery = navigationQuery
      destinationGroup.navigationHref = storedNavigationHref || buildGoogleMapsSearchHref(navigationQuery)
    }
    destinationGroup.orders.push(view)
    mutableGroup.deliveries.set(destinationKey, destinationGroup)
  })

  const finalizedGroups = [...groups.values()]
    .sort((left, right) => compareText(left.key, right.key))
    .map((group): DeliveryDateGroup => {
      const pickups = [...group.pickups].sort(compareOrders)
      const destinations = [...group.deliveries.values()]
        .map((destination): DeliveryDestinationGroup => {
          const orders = [...destination.orders].sort(compareOrders)
          const collection = sumCollection(orders, warnings)
          return {
            key: destination.key,
            destination: destination.destination,
            address: destination.address,
            navigationHref: destination.navigationHref,
            orderCount: orders.length,
            collectionComplete: collection.complete,
            collectionMinorUnits: collection.minorUnits,
            orders,
          }
        })
        .sort(
          (left, right) =>
            compareText(left.destination, right.destination) || compareText(left.key, right.key),
        )
      const allOrders = [...destinations.flatMap((destination) => destination.orders), ...pickups]
      const collection = sumCollection(allOrders, warnings)
      return {
        key: group.key,
        dateKind: group.dateKind,
        serviceDate: group.serviceDate,
        localizedDate: group.localizedDate,
        orderCount: allOrders.length,
        deliveryOrderCount: destinations.reduce((count, destination) => count + destination.orderCount, 0),
        pickupOrderCount: pickups.length,
        collectionComplete: collection.complete,
        collectionMinorUnits: collection.minorUnits,
        destinations,
        pickups,
      }
    })

  return {
    globallyEmpty: store.orders.length === 0,
    activeEmpty: finalizedGroups.length === 0,
    activeOrderCount: finalizedGroups.reduce((count, group) => count + group.orderCount, 0),
    excludedOrderCount,
    groups: finalizedGroups,
    warnings: [...warnings].sort(compareWarnings),
  }
}
