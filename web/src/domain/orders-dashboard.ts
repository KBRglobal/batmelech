import { checkedAdd } from './money.ts'
import type { LegacyOrder, LegacyStore } from './store.ts'

const DEFAULT_LOCALE = 'he-IL'
const DEFAULT_BUSINESS_TIME_ZONE = 'Asia/Dubai'
const MAX_NUMERIC_TOKEN_LENGTH = 64
const MAX_TEXT_FIELD_LENGTH = 10_000
const MAX_SEARCH_TEXT_LENGTH = 100_000
const MAX_ORDER_ID_LENGTH = 256
const MAX_COLLECTION_ENTRIES = 2_000
const CANCELLED_STATUS_ALIASES = new Set(['בוטלה', 'cancelled', 'canceled'])
const USD_AMOUNT_PATTERN = '(?:(?:\\d+|\\d{1,3}(?:,\\d{3})+)(?:\\.\\d{1,2})?|\\.\\d{1,2})'
const LEGACY_USD_FORMAT = new RegExp(`^(?:\\$${USD_AMOUNT_PATTERN}|${USD_AMOUNT_PATTERN}\\$?)$`)

type LegacyOrderId = string | number | null

export type OrdersWarningCode =
  | 'INVALID_SERVICE_DATE'
  | 'MISSING_ORDER_ID'
  | 'INVALID_MONEY'
  | 'MONEY_OVERFLOW'
  | 'INVALID_QUANTITY'
  | 'QUANTITY_OVERFLOW'
  | 'INVALID_CAPACITY'
  | 'INVALID_STRUCTURE'
  | 'TEXT_TOO_LONG'
  | 'DUPLICATE_ORDER_ID'

export interface OrdersWarning {
  readonly code: OrdersWarningCode
  readonly orderId: LegacyOrderId
  readonly customerName: string
  readonly path: string
  readonly message: string
}

export type OrdersCapacity =
  | { readonly kind: 'unconfigured' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'configured'; readonly maximumMeals: number }

export interface OrdersSummaryChips {
  readonly meals: number | null
  readonly orderedSalads: number | null
  readonly complimentarySalads: number | null
  readonly distinctExtras: number | null
  readonly tableSettings: number | null
  readonly challahs: number | null
}

export interface OrdersOrderView {
  readonly sourceIndex: number
  readonly orderId: string | null
  readonly customerName: string
  readonly phone: string
  readonly telephoneHref: string | null
  readonly whatsappHref: string | null
  readonly serviceDate: string | null
  readonly serviceDateValid: boolean
  readonly time: string
  readonly pickup: boolean
  readonly destination: string
  readonly status: string
  readonly paidLabel: string
  readonly cancelled: boolean
  readonly totalState: 'absent' | 'valid' | 'invalid'
  readonly totalMinorUnits: number | null
  readonly formattedText: string
  readonly summary: OrdersSummaryChips
}

export interface OrdersLinkedGroup {
  readonly kind: 'linked-group'
  readonly name: string
  readonly memberCount: number
  readonly activeDestinations: readonly string[]
  readonly activeTotalMinorUnits: number | null
  readonly activeTotalComplete: boolean
  readonly orders: readonly OrdersOrderView[]
}

export interface OrdersSingleOrder {
  readonly kind: 'single-order'
  readonly order: OrdersOrderView
}

export type OrdersDisplayBlock = OrdersLinkedGroup | OrdersSingleOrder

export interface OrdersDateGroup {
  readonly key: string
  readonly dateKind: 'dated' | 'invalid' | 'undated'
  readonly serviceDate: string | null
  readonly localizedDate: string
  readonly orderCount: number
  readonly activeMeals: number | null
  readonly activeRevenueMinorUnits: number | null
  readonly aggregatesComplete: boolean
  readonly capacity: OrdersCapacity
  readonly full: boolean | null
  readonly blocks: readonly OrdersDisplayBlock[]
}

export interface OrdersDashboard {
  readonly todayIso: string
  readonly globallyEmpty: boolean
  readonly query: string
  readonly searchActive: boolean
  readonly matchCount: number
  readonly upcomingGroups: readonly OrdersDateGroup[]
  readonly pastGroups: readonly OrdersDateGroup[]
  readonly searchGroups: readonly OrdersDateGroup[]
  readonly pastOrderCount: number
  readonly warnings: readonly OrdersWarning[]
}

export interface OrdersDashboardOptions {
  readonly query?: string
  readonly now?: Date
  readonly timeZone?: string
  readonly locale?: string
}

interface ParsedMoney {
  readonly state: 'absent' | 'valid' | 'invalid'
  readonly minorUnits: number | null
}

interface OrderContext {
  readonly sourceIndex: number
  readonly source: Readonly<LegacyOrder>
  readonly view: OrdersOrderView
  readonly rawDate: string
  readonly groupName: string
  readonly total: ParsedMoney
  readonly meals: number | null
  readonly searchText: string
}

function text(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.length <= MAX_TEXT_FIELD_LENGTH ? value.trim() : 'ערך ארוך מדי'
}

function safeKey(value: string): string {
  return value.length <= MAX_TEXT_FIELD_LENGTH ? value : 'ערך ארוך מדי'
}

function customerName(order: Readonly<LegacyOrder>): string {
  return text(order.name) || 'ללא שם'
}

function legacyOrderId(value: unknown): LegacyOrderId {
  if (typeof value === 'string') {
    if (value.length > MAX_ORDER_ID_LENGTH) return null
    return value.trim() === '' ? null : value.trim()
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  return null
}

function routeOrderId(value: LegacyOrderId): string | null {
  return value === null ? null : String(value)
}

function warningContext(
  order: Readonly<LegacyOrder>,
): Pick<OrdersWarning, 'orderId' | 'customerName'> {
  return { orderId: legacyOrderId(order.id), customerName: customerName(order) }
}

function pushOrderWarning(
  warnings: OrdersWarning[],
  order: Readonly<LegacyOrder>,
  code: OrdersWarningCode,
  path: string,
  message: string,
): void {
  warnings.push({ code, ...warningContext(order), path, message })
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

function zonedToday(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).formatToParts(now)
  const read = (type: Intl.DateTimeFormatPartTypes): string => {
    const value = parts.find((part) => part.type === type)?.value
    if (value === undefined || !/^\d+$/.test(value)) {
      throw new RangeError(`Unable to resolve ${type} in ${timeZone}`)
    }
    return value
  }
  return `${read('year')}-${read('month')}-${read('day')}`
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

function parseCount(
  value: unknown,
  order: Readonly<LegacyOrder>,
  path: string,
  warnings: OrdersWarning[],
): number | null {
  if (value === undefined || value === null || value === '') return 0
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value >= 0) return value
    pushOrderWarning(
      warnings,
      order,
      Number.isFinite(value) ? 'INVALID_QUANTITY' : 'QUANTITY_OVERFLOW',
      path,
      `${path} must be a non-negative safe integer`,
    )
    return null
  }
  if (typeof value === 'string') {
    if (value.length > MAX_NUMERIC_TOKEN_LENGTH) {
      pushOrderWarning(
        warnings,
        order,
        'QUANTITY_OVERFLOW',
        path,
        `${path} exceeds the safe integer range`,
      )
      return null
    }
    const normalized = value.trim()
    if (/^\d+$/.test(normalized)) {
      const parsed = BigInt(normalized)
      if (parsed <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(parsed)
      pushOrderWarning(
        warnings,
        order,
        'QUANTITY_OVERFLOW',
        path,
        `${path} exceeds the safe integer range`,
      )
      return null
    }
  }
  pushOrderWarning(
    warnings,
    order,
    'INVALID_QUANTITY',
    path,
    `${path} must be a non-negative safe integer`,
  )
  return null
}

function parseMoney(
  value: unknown,
  order: Readonly<LegacyOrder>,
  path: 'total' | 'deposit',
  warnings: OrdersWarning[],
): ParsedMoney {
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
    pushOrderWarning(
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
    pushOrderWarning(
      warnings,
      order,
      'MONEY_OVERFLOW',
      path,
      `${path} exceeds the safe USD minor-unit range`,
    )
    return { state: 'invalid', minorUnits: null }
  }

  return { state: 'valid', minorUnits: Number(minorUnits) }
}

function addCounts(
  current: number | null,
  next: number | null,
  order: Readonly<LegacyOrder>,
  path: string,
  warnings: OrdersWarning[],
): number | null {
  if (current === null || next === null) return null
  try {
    return checkedAdd(current, next, path)
  } catch {
    pushOrderWarning(
      warnings,
      order,
      'QUANTITY_OVERFLOW',
      path,
      `${path} exceeds the safe integer range`,
    )
    return null
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function* boundedEntries(
  record: Readonly<Record<string, unknown>>,
): Generator<readonly [string, unknown]> {
  let count = 0
  for (const key in record) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue
    if (count >= MAX_COLLECTION_ENTRIES) return
    count += 1
    yield [key, record[key]] as const
  }
}

function selectedRecordCount(
  record: Readonly<Record<string, unknown>> | undefined,
  nestedKey: string | null,
  order: Readonly<LegacyOrder>,
  path: string,
  warnings: OrdersWarning[],
): number | null {
  if (record === undefined) return 0
  let result: number | null = 0

  for (const [name, rawEntry] of boundedEntries(record)) {
    const safeName = safeKey(name)
    if (nestedKey !== null && !isRecord(rawEntry)) {
      pushOrderWarning(
        warnings,
        order,
        'INVALID_STRUCTURE',
        `${path}.${safeName}`,
        `${path}.${safeName} must be an object`,
      )
      result = null
      continue
    }
    const rawQuantity = nestedKey === null ? rawEntry : isRecord(rawEntry) ? rawEntry[nestedKey] : undefined
    if (rawQuantity === undefined || rawQuantity === null || rawQuantity === '') continue
    const quantity = parseCount(rawQuantity, order, `${path}.${safeName}${nestedKey ? `.${nestedKey}` : ''}`, warnings)
    result = addCounts(result, quantity, order, path, warnings)
  }

  return result
}

function distinctExtrasCount(
  order: Readonly<LegacyOrder>,
  warnings: OrdersWarning[],
): number | null {
  let count: number | null = 0

  for (const [name, value] of boundedEntries(order.extras ?? {})) {
    const safeName = safeKey(name)
    if (!isRecord(value)) {
      pushOrderWarning(
        warnings,
        order,
        'INVALID_STRUCTURE',
        `extras.${safeName}`,
        `extras.${safeName} must be an object`,
      )
      count = null
      continue
    }
    const quantity = parseCount(value.q, order, `extras.${safeName}.q`, warnings)
    if (quantity === null) count = null
    else if (quantity > 0 && count !== null) count = addCounts(count, 1, order, 'extras', warnings)
  }

  const custom = order.custom ?? []
  for (let index = 0; index < Math.min(custom.length, MAX_COLLECTION_ENTRIES); index += 1) {
    const value = custom[index]
    if (!isRecord(value)) {
      pushOrderWarning(
        warnings,
        order,
        'INVALID_STRUCTURE',
        `custom.${index}`,
        `custom.${index} must be an object`,
      )
      count = null
      continue
    }
    if (text(value.name) === '') continue
    const quantity = parseCount(value.qty, order, `custom.${index}.qty`, warnings)
    if (quantity === null) count = null
    else if (quantity > 0 && count !== null) count = addCounts(count, 1, order, 'custom', warnings)
  }

  return count
}

function summaryChips(
  order: Readonly<LegacyOrder>,
  warnings: OrdersWarning[],
): OrdersSummaryChips {
  return {
    meals: parseCount(order.meals, order, 'meals', warnings),
    orderedSalads: selectedRecordCount(order.salads, 'o', order, 'salads', warnings),
    complimentarySalads: selectedRecordCount(order.salads, 'p', order, 'salads', warnings),
    distinctExtras: distinctExtrasCount(order, warnings),
    tableSettings: parseCount(order.aricha, order, 'aricha', warnings),
    challahs: parseCount(order.challot, order, 'challot', warnings),
  }
}

function positiveSelectionLines(
  record: Readonly<Record<string, unknown>> | undefined,
  nestedKey: string | null = null,
): string[] {
  if (record === undefined) return []
  const lines: string[] = []
  for (const [name, value] of boundedEntries(record)) {
    const rawQuantity = nestedKey === null ? value : isRecord(value) ? value[nestedKey] : undefined
    const quantity = displayQuantity(rawQuantity)
    if (quantity > 0) lines.push(`${safeKey(name)}${quantity > 1 ? ` ×${quantity}` : ''}`)
  }
  return lines
}

function displayQuantity(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0
  }
  if (
    typeof value !== 'string' ||
    value.length > MAX_NUMERIC_TOKEN_LENGTH ||
    !/^\d+$/.test(value.trim())
  ) return 0
  const parsed = BigInt(value.trim())
  return parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed) : 0
}

const LUNCH_ITEM_NAMES: Readonly<Record<string, string>> = {
  baguette: 'בגט טוניסאי אותנטי',
  'schnitzel-roll': 'בגט/חלת שניצל ישראלי',
  kubeh: 'מנת קובה סלק ביתית',
  'schnitzel-plate': 'שניצל בצלחת',
  couscous: 'ספיישל קוסקוס',
}

const LUNCH_VARIANT_LABELS: Readonly<Record<string, string>> = {
  baguette: 'בבגט',
  challah: 'בחלה',
  single: 'אישית',
  couple: 'זוגית',
  family: 'משפחתית',
}

function lunchTextLines(order: Readonly<LegacyOrder>): string[] {
  const lines: string[] = []
  for (const [key, value] of boundedEntries(order.lunch ?? {})) {
    if (!isRecord(value)) continue
    const quantity = displayQuantity(value.q)
    if (quantity === 0) continue
    const variant = text(value.v)
    let line = LUNCH_ITEM_NAMES[key] ?? safeKey(key)
    if (variant) line += ` (${LUNCH_VARIANT_LABELS[variant] ?? variant})`
    line += ` ×${quantity}`

    const sides = isRecord(value.sides) ? positiveSelectionLines(value.sides) : []
    if (sides.length > 0) line += ` — תוספות: ${sides.join(', ')}`
    const addon = displayQuantity(value.addon)
    if (addon > 0) line += ` — מנת מפרום ביתי ×${addon}`
    lines.push(line)
  }
  return lines
}

export function formatLegacyOrderText(order: Readonly<LegacyOrder>, locale = DEFAULT_LOCALE): string {
  const rawDate = text(order.date)
  const lines = [
    `ההזמנה לתאריך: ${isRealIsoDate(rawDate) ? localizedServiceDate(rawDate, locale) : rawDate || 'ללא תאריך'}`,
    `שם מלא: ${customerName(order)}`,
  ]
  if (text(order.phone)) lines.push(`מספר טלפון: ${text(order.phone)}`)
  lines.push(
    `לאן המשלוח? ${order.pickup === true ? 'איסוף עצמי' : text(order.place) || 'לא צוין יעד'}${order.pickup !== true && text(order.time) ? ` (הגעה: ${text(order.time)})` : ''}`,
  )
  if (order.pickup !== true && text(order.address)) lines.push(`כתובת: ${text(order.address)}`)
  if (text(order.group)) lines.push(`קבוצה: ${text(order.group)}`)

  const meals = displayQuantity(order.meals)
  if (meals > 0) lines.push(`ארוחה זוגית ×${meals}`)

  const orderedSalads = positiveSelectionLines(order.salads, 'o')
  const giftSalads = positiveSelectionLines(order.salads, 'p').map((line) => `${line} — פינוק`)
  if (orderedSalads.length + giftSalads.length > 0) {
    lines.push(`סלטים: ${[...orderedSalads, ...giftSalads].join(', ')}`)
  }

  const categories = [
    ['ראשונה', order.firsts],
    ['עיקרית', order.mains],
    ['תוספת', order.sides],
    ['קינוח', order.desserts],
  ] as const
  for (const [label, values] of categories) {
    const selected = positiveSelectionLines(values)
    if (selected.length > 0) lines.push(`${label}: ${selected.join(', ')}`)
  }
  if (text(order.heat)) lines.push(`חריפות הדג: ${text(order.heat)}`)
  if (text(order.firstsNote)) lines.push(`הערה לראשונה: ${text(order.firstsNote)}`)
  if (text(order.mainsNote)) lines.push(`הערה לעיקרית: ${text(order.mainsNote)}`)

  const extras: string[] = []
  for (const [name, value] of boundedEntries(order.extras ?? {})) {
    if (isRecord(value)) {
      const quantity = displayQuantity(value.q)
      if (quantity > 0) extras.push(`${safeKey(name)}${quantity > 1 ? ` ×${quantity}` : ''}`)
    }
  }
  for (const [name, value] of boundedEntries(order.extras ?? {})) {
    if (!isRecord(value) || displayQuantity(value.q) === 0 || text(value.note) === '') continue
    const index = extras.findIndex((line) => line.startsWith(name))
    if (index >= 0) extras[index] = `${extras[index]} (${text(value.note)})`
  }
  const custom = order.custom ?? []
  for (let index = 0; index < Math.min(custom.length, MAX_COLLECTION_ENTRIES); index += 1) {
    const value = custom[index]
    if (!isRecord(value) || text(value.name) === '') continue
    const quantity = displayQuantity(value.qty)
    let line = `${text(value.name)}${quantity > 0 ? ` ×${quantity}` : ''}`
    const price =
      typeof value.price === 'string'
        ? text(value.price)
        : typeof value.price === 'number'
          ? String(value.price)
          : ''
    if (price) {
      line += ` (${price}$)`
    }
    if (text(value.note)) line += ` — ${text(value.note)}`
    extras.push(line)
  }
  if (extras.length > 0) lines.push(`אקסטרה: ${extras.join(', ')}`)

  const lunch = lunchTextLines(order)
  if (lunch.length > 0) lines.push(`תפריט צהריים: ${lunch.join(', ')}`)
  const tableSettings = displayQuantity(order.aricha)
  if (tableSettings > 0) lines.push(`עריכה: ${tableSettings} איש`)
  const challahs = displayQuantity(order.challot)
  if (challahs > 0) lines.push(`חלות: ${challahs} יחידות`)
  if (text(order.notes)) lines.push(`הערות: ${text(order.notes)}`)
  const totalText = typeof order.total === 'number' ? String(order.total) : text(order.total)
  if (totalText) {
    lines.push(`סך לתשלום: ${totalText}`)
  }
  const depositText = typeof order.deposit === 'number' ? String(order.deposit) : text(order.deposit)
  if (depositText) {
    lines.push(`מקדמה: ${depositText}`)
  }
  if (text(order.payMethod)) lines.push(`דרך תשלום: ${text(order.payMethod)}`)
  lines.push(`שולם: ${text(order.paid) || 'לא'}`)
  return lines.join('\n')
}

export interface BonField {
  readonly label: string
  readonly value: string
  readonly notes: readonly string[]
}

function extraLines(order: Readonly<LegacyOrder>): string[] {
  const extras: string[] = []
  for (const [name, value] of boundedEntries(order.extras ?? {})) {
    if (isRecord(value)) {
      const quantity = displayQuantity(value.q)
      if (quantity > 0) extras.push(`${safeKey(name)}${quantity > 1 ? ` ×${quantity}` : ''}`)
    }
  }
  for (const [name, value] of boundedEntries(order.extras ?? {})) {
    if (!isRecord(value) || displayQuantity(value.q) === 0 || text(value.note) === '') continue
    const index = extras.findIndex((line) => line.startsWith(name))
    if (index >= 0) extras[index] = `${extras[index]} (${text(value.note)})`
  }
  const custom = order.custom ?? []
  for (let index = 0; index < Math.min(custom.length, MAX_COLLECTION_ENTRIES); index += 1) {
    const value = custom[index]
    if (!isRecord(value) || text(value.name) === '') continue
    const quantity = displayQuantity(value.qty)
    let line = `${text(value.name)}${quantity > 0 ? ` ×${quantity}` : ''}`
    const price =
      typeof value.price === 'string'
        ? text(value.price)
        : typeof value.price === 'number'
          ? String(value.price)
          : ''
    if (price) line += ` (${price}$)`
    if (text(value.note)) line += ` — ${text(value.note)}`
    extras.push(line)
  }
  return extras
}

function savedDeliveryNotes(order: Readonly<LegacyOrder>): string[] {
  const record = order as Readonly<Record<string, unknown>>
  const fields = [
    ['שם המלון השמור', record.hotelName],
    ['כתובת המלון השמורה', record.hotelAddress],
    ['קישור ניווט שמור', record.navigationUrl],
  ] as const
  return fields.flatMap(([label, value]) =>
    typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_TEXT_FIELD_LENGTH
      ? [`${label}: ${value.trim()}`]
      : [],
  )
}

/**
 * The bon as labelled rows, in the order the kitchen reads them: who and where
 * first, then the order itself from the table setting down to the extras.
 *
 * This is deliberately its own shape rather than a parse of
 * `formatLegacyOrderText` — that text is what goes out to WhatsApp and the
 * clipboard, and a value there may legitimately carry a colon of its own.
 * The money lines are left out; the bon prints the amount as its own block.
 */
export function buildBonFields(order: Readonly<LegacyOrder>): readonly BonField[] {
  const fields: BonField[] = []
  const push = (label: string, value: string, notes: readonly string[] = []) => {
    if (value.trim() === '') return
    fields.push({ label, value, notes: notes.filter((note) => note.trim() !== '') })
  }

  push('שם מלא', customerName(order))
  push('טלפון', text(order.phone))
  push(
    'לאן המשלוח',
    order.pickup === true ? 'איסוף עצמי' : text(order.place) || 'לא צוין יעד',
    [
      order.pickup !== true && text(order.time) ? `שעת הגעה: ${text(order.time)}` : '',
      order.pickup !== true && text(order.address) ? `כתובת: ${text(order.address)}` : '',
      ...savedDeliveryNotes(order),
    ],
  )
  push('קבוצה', text(order.group))

  const meals = displayQuantity(order.meals)
  if (meals > 0) push('ארוחה זוגית', `×${meals}`)
  const tableSettings = displayQuantity(order.aricha)
  if (tableSettings > 0) push('עריכה', `${tableSettings} איש`)
  const challahs = displayQuantity(order.challot)
  if (challahs > 0) push('חלות', `${challahs} יחידות`)

  push('סלטים', [
    ...positiveSelectionLines(order.salads, 'o'),
    ...positiveSelectionLines(order.salads, 'p').map((line) => `${line} — פינוק`),
  ].join(', '))
  push('מנה ראשונה', positiveSelectionLines(order.firsts).join(', '), [
    text(order.heat) ? `חריפות הדג: ${text(order.heat)}` : '',
    text(order.firstsNote),
  ])
  push('מנה עיקרית', positiveSelectionLines(order.mains).join(', '), [text(order.mainsNote)])
  push('תוספת', positiveSelectionLines(order.sides).join(', '))
  push('קינוח', positiveSelectionLines(order.desserts).join(', '))
  push('אקסטרות', extraLines(order).join(', '))
  push('תפריט צהריים', lunchTextLines(order).join(', '))
  push('הערות', text(order.notes))

  // A heat level or a note the kitchen must see, on an order that never chose
  // the course it belongs to, would otherwise be dropped from the bon.
  const orphanNotes = [
    fields.some((field) => field.label === 'מנה ראשונה') ? '' : text(order.heat) ? `חריפות הדג: ${text(order.heat)}` : '',
    fields.some((field) => field.label === 'מנה ראשונה') ? '' : text(order.firstsNote),
    fields.some((field) => field.label === 'מנה עיקרית') ? '' : text(order.mainsNote),
  ].filter((note) => note.trim() !== '')
  if (orphanNotes.length > 0) push('הערות למנות', orphanNotes.join(' · '))

  return fields
}

/** The date line a bon leads with, already localized. */
export function bonServiceDate(order: Readonly<LegacyOrder>, locale = DEFAULT_LOCALE): string {
  const rawDate = text(order.date)
  if (rawDate === '') return 'ללא תאריך'
  return isRealIsoDate(rawDate) ? localizedServiceDate(rawDate, locale) : rawDate
}

/** The payment lines the bon prints under the amount. */
export function bonPaymentFields(order: Readonly<LegacyOrder>): readonly BonField[] {
  const fields: BonField[] = []
  const depositText = typeof order.deposit === 'number' ? String(order.deposit) : text(order.deposit)
  if (depositText) fields.push({ label: 'מקדמה', value: depositText, notes: [] })
  if (text(order.payMethod)) fields.push({ label: 'דרך תשלום', value: text(order.payMethod), notes: [] })
  fields.push({ label: 'שולם', value: text(order.paid) || 'לא', notes: [] })
  return fields
}

export function normalizeWhatsAppPhone(phone: string): string | null {
  let digits = phone.replace(/\D/g, '')
  if (digits === '') return null
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith('0')) digits = `972${digits.slice(1)}`
  return /^[1-9]\d{6,14}$/.test(digits) ? digits : null
}

export function buildWhatsAppOrderHref(phone: string, formattedText: string): string | null {
  const normalized = normalizeWhatsAppPhone(phone)
  return normalized === null
    ? null
    : `https://wa.me/${normalized}?text=${encodeURIComponent(formattedText)}`
}

function paidLabel(value: unknown): string {
  const paid = text(value)
  if (paid === 'כן') return 'שולם'
  if (paid === 'לא' || paid === '') return 'לא שולם'
  return paid
}

function validateTextLengths(order: Readonly<LegacyOrder>, warnings: OrdersWarning[]): void {
  const directFields = [
    'id',
    'date',
    'name',
    'phone',
    'place',
    'address',
    'time',
    'status',
    'group',
    'heat',
    'firstsNote',
    'mainsNote',
    'notes',
    'payMethod',
    'paid',
  ] as const
  for (const field of directFields) {
    const value = order[field]
    const limit = field === 'id' ? MAX_ORDER_ID_LENGTH : MAX_TEXT_FIELD_LENGTH
    if (typeof value === 'string' && value.length > limit) {
      pushOrderWarning(
        warnings,
        order,
        'TEXT_TOO_LONG',
        field,
        `${field} exceeds the safe display length`,
      )
    }
  }

  const roots: readonly unknown[] = [
    order.salads,
    order.firsts,
    order.mains,
    order.sides,
    order.desserts,
    order.extras,
    order.custom,
    order.lunch,
  ]
  const stack = [...roots]
  const seen = new WeakSet<object>()
  let visited = 0
  while (stack.length > 0 && visited < 2_000) {
    const value = stack.pop()
    visited += 1
    if (typeof value === 'string') {
      if (value.length > MAX_TEXT_FIELD_LENGTH) {
        pushOrderWarning(
          warnings,
          order,
          'TEXT_TOO_LONG',
          'nested',
          'nested order text exceeds the safe display length',
        )
        return
      }
      continue
    }
    if (typeof value !== 'object' || value === null || seen.has(value)) continue
    seen.add(value)
    if (Array.isArray(value)) {
      if (value.length > MAX_COLLECTION_ENTRIES) {
        pushOrderWarning(
          warnings,
          order,
          'INVALID_STRUCTURE',
          'nested',
          'nested order array exceeds the safe item limit',
        )
        return
      }
      for (let index = 0; index < value.length; index += 1) stack.push(value[index])
      continue
    }
    let entryCount = 0
    for (const [key, nested] of boundedEntries(value as Readonly<Record<string, unknown>>)) {
      entryCount += 1
      if (key.length > MAX_TEXT_FIELD_LENGTH) {
        pushOrderWarning(
          warnings,
          order,
          'TEXT_TOO_LONG',
          'nested-key',
          'nested order key exceeds the safe display length',
        )
        return
      }
      stack.push(nested)
    }
    if (entryCount === MAX_COLLECTION_ENTRIES) {
      let actualCount = 0
      for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) actualCount += 1
        if (actualCount > MAX_COLLECTION_ENTRIES) {
          pushOrderWarning(
            warnings,
            order,
            'INVALID_STRUCTURE',
            'nested',
            'nested order object exceeds the safe item limit',
          )
          return
        }
      }
    }
  }
  if (stack.length > 0) {
    pushOrderWarning(
      warnings,
      order,
      'INVALID_STRUCTURE',
      'nested',
      'nested order data exceeds the safe traversal limit',
    )
  }
}

function validateFlatQuantities(
  record: Readonly<Record<string, unknown>> | undefined,
  order: Readonly<LegacyOrder>,
  path: string,
  warnings: OrdersWarning[],
): void {
  for (const [name, value] of boundedEntries(record ?? {})) {
    parseCount(value, order, `${path}.${safeKey(name)}`, warnings)
  }
}

function validateNestedStructures(order: Readonly<LegacyOrder>, warnings: OrdersWarning[]): void {
  validateFlatQuantities(order.firsts, order, 'firsts', warnings)
  validateFlatQuantities(order.mains, order, 'mains', warnings)
  validateFlatQuantities(order.sides, order, 'sides', warnings)
  validateFlatQuantities(order.desserts, order, 'desserts', warnings)

  for (const [key, value] of boundedEntries(order.lunch ?? {})) {
    const safeName = safeKey(key)
    if (!isRecord(value)) {
      pushOrderWarning(warnings, order, 'INVALID_STRUCTURE', `lunch.${safeName}`, `lunch.${safeName} must be an object`)
      continue
    }
    parseCount(value.q, order, `lunch.${safeName}.q`, warnings)
    if (value.addon !== undefined) parseCount(value.addon, order, `lunch.${safeName}.addon`, warnings)
    if (value.sides !== undefined && !isRecord(value.sides)) {
      pushOrderWarning(
        warnings,
        order,
        'INVALID_STRUCTURE',
        `lunch.${safeName}.sides`,
        `lunch.${safeName}.sides must be an object`,
      )
    } else if (isRecord(value.sides)) {
      validateFlatQuantities(value.sides, order, `lunch.${safeName}.sides`, warnings)
    }
  }
}

function buildContext(
  order: Readonly<LegacyOrder>,
  sourceIndex: number,
  locale: string,
  warnings: OrdersWarning[],
  ambiguousOrderIds: ReadonlySet<string>,
): OrderContext {
  const warningStart = warnings.length
  validateTextLengths(order, warnings)
  validateNestedStructures(order, warnings)
  const rawDate = text(order.date)
  const dateValid = rawDate !== '' && isRealIsoDate(rawDate)
  if (rawDate !== '' && !dateValid) {
    pushOrderWarning(
      warnings,
      order,
      'INVALID_SERVICE_DATE',
      'date',
      'date must be a real ISO calendar date',
    )
  }

  const id = legacyOrderId(order.id)
  if (id === null) {
    pushOrderWarning(
      warnings,
      order,
      'MISSING_ORDER_ID',
      'id',
      'saved order is missing a stable ID for navigation',
    )
  } else if (ambiguousOrderIds.has(String(id))) {
    pushOrderWarning(
      warnings,
      order,
      'DUPLICATE_ORDER_ID',
      'id',
      'saved order ID collides with another order and cannot be opened safely',
    )
  }

  const total = parseMoney(order.total, order, 'total', warnings)
  const deposit = parseMoney(order.deposit, order, 'deposit', warnings)
  const summary = summaryChips(order, warnings)
  const phone =
    typeof order.phone === 'string' && order.phone.length <= MAX_TEXT_FIELD_LENGTH
      ? order.phone.trim()
      : ''
  const destination =
    order.pickup === true
      ? 'איסוף עצמי'
      : text(order.place) || text(order.address) || 'לא צוין יעד'
  const formattedText = formatLegacyOrderText(order, locale)
  const view: OrdersOrderView = {
    sourceIndex,
    orderId: id !== null && !ambiguousOrderIds.has(String(id)) ? routeOrderId(id) : null,
    customerName: customerName(order),
    phone,
    telephoneHref: phone ? `tel:${phone}` : null,
    whatsappHref: null,
    serviceDate: dateValid ? rawDate : null,
    serviceDateValid: dateValid,
    time: text(order.time),
    pickup: order.pickup === true,
    destination,
    status: text(order.status) || 'חדשה',
    paidLabel: paidLabel(order.paid),
    cancelled: isCancelled(order),
    totalState: total.state,
    totalMinorUnits: total.minorUnits,
    formattedText,
    summary,
  }
  const unsafeOutboundCodes = new Set<OrdersWarningCode>([
    'INVALID_SERVICE_DATE',
    'INVALID_MONEY',
    'MONEY_OVERFLOW',
    'INVALID_QUANTITY',
    'QUANTITY_OVERFLOW',
    'INVALID_STRUCTURE',
    'TEXT_TOO_LONG',
  ])
  const outboundSafe =
    total.state !== 'invalid' &&
    deposit.state !== 'invalid' &&
    !warnings.slice(warningStart).some((warning) => unsafeOutboundCodes.has(warning.code))
  const resolvedView: OrdersOrderView = {
    ...view,
    whatsappHref: phone && outboundSafe ? buildWhatsAppOrderHref(phone, formattedText) : null,
  }
  const searchText = [
    order.name,
    order.phone,
    order.place,
    order.address,
    order.group,
    order.notes,
    formattedText,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLocaleLowerCase(locale)
    .slice(0, MAX_SEARCH_TEXT_LENGTH)

  return {
    sourceIndex,
    source: order,
    view: resolvedView,
    rawDate,
    groupName:
      typeof order.group === 'string' && order.group.length <= MAX_TEXT_FIELD_LENGTH
        ? order.group.trim()
        : '',
    total,
    meals: summary.meals,
    searchText,
  }
}

function readCapacity(store: Readonly<LegacyStore>, warnings: OrdersWarning[]): OrdersCapacity {
  const raw = store.settings?.maxMeals
  if (raw === undefined || raw === null || raw === '' || raw === 0 || raw === '0') {
    return { kind: 'unconfigured' }
  }

  const placeholderOrder: Readonly<LegacyOrder> = {}
  const capacityWarnings: OrdersWarning[] = []
  const parsed = parseCount(raw, placeholderOrder, 'settings.maxMeals', capacityWarnings)
  if (parsed === null) {
    warnings.push({
      code: 'INVALID_CAPACITY',
      orderId: null,
      customerName: '',
      path: 'settings.maxMeals',
      message: 'settings.maxMeals must be a positive safe integer when configured',
    })
    return { kind: 'invalid' }
  }
  if (parsed === 0) return { kind: 'unconfigured' }
  return { kind: 'configured', maximumMeals: parsed }
}

function dateGroupKey(context: OrderContext): string {
  if (context.rawDate === '') return 'undated'
  return context.view.serviceDateValid ? `dated:${context.rawDate}` : `invalid:${context.rawDate}`
}

function compareContexts(left: OrderContext, right: OrderContext): number {
  const dateRank = (context: OrderContext): number =>
    context.view.serviceDateValid ? 0 : context.rawDate === '' ? 2 : 1
  const rankDifference = dateRank(left) - dateRank(right)
  if (rankDifference !== 0) return rankDifference
  const dateDifference = left.rawDate.localeCompare(right.rawDate)
  if (dateDifference !== 0) return dateDifference
  const timeDifference = (left.view.time || '99:99').localeCompare(right.view.time || '99:99')
  return timeDifference || left.sourceIndex - right.sourceIndex
}

function buildDisplayBlocks(
  contexts: readonly OrderContext[],
  warnings: OrdersWarning[],
): OrdersDisplayBlock[] {
  const groupOrder: string[] = []
  const grouped = new Map<string, OrderContext[]>()
  const singles: OrderContext[] = []

  for (const context of contexts) {
    if (context.groupName === '') {
      singles.push(context)
      continue
    }
    const existing = grouped.get(context.groupName)
    if (existing === undefined) {
      grouped.set(context.groupName, [context])
      groupOrder.push(context.groupName)
    } else {
      existing.push(context)
    }
  }

  const groupBlocks: OrdersLinkedGroup[] = groupOrder.map((name) => {
    const members = grouped.get(name) ?? []
    const active = members.filter((context) => !context.view.cancelled)
    const destinations = [...new Set(active.map((context) => context.view.destination).filter(Boolean))]
    let total: number | null = 0
    for (const context of active) {
      if (context.total.state !== 'valid' || context.total.minorUnits === null) {
        total = null
        continue
      }
      if (total === null) continue
      try {
        total = checkedAdd(total, context.total.minorUnits, `${name} revenue`)
      } catch {
        total = null
        pushOrderWarning(
          warnings,
          context.source,
          'MONEY_OVERFLOW',
          'group.total',
          `linked group ${name} revenue exceeds the safe USD minor-unit range`,
        )
      }
    }
    return {
      kind: 'linked-group',
      name,
      memberCount: members.length,
      activeDestinations: destinations,
      activeTotalMinorUnits: total,
      activeTotalComplete: total !== null,
      orders: members.map((context) => context.view),
    }
  })

  return [
    ...groupBlocks,
    ...singles.map((context): OrdersSingleOrder => ({
      kind: 'single-order',
      order: context.view,
    })),
  ]
}

function buildDateGroups(
  contexts: readonly OrderContext[],
  capacity: OrdersCapacity,
  locale: string,
  warnings: OrdersWarning[],
  reverseDates = false,
): OrdersDateGroup[] {
  const grouped = new Map<string, OrderContext[]>()
  for (const context of [...contexts].sort(compareContexts)) {
    const key = dateGroupKey(context)
    const existing = grouped.get(key)
    if (existing === undefined) grouped.set(key, [context])
    else existing.push(context)
  }

  const groups = [...grouped.entries()].map(([key, members]): OrdersDateGroup => {
    const first = members[0]!
    const dateKind =
      first.rawDate === '' ? 'undated' : first.view.serviceDateValid ? 'dated' : 'invalid'
    const serviceDate = dateKind === 'dated' ? first.rawDate : null
    let activeMeals: number | null = 0
    let activeRevenue: number | null = 0

    for (const context of members) {
      if (context.view.cancelled) continue
      if (context.meals === null) activeMeals = null
      else if (activeMeals !== null) {
        try {
          activeMeals = checkedAdd(activeMeals, context.meals, `${key} meals`)
        } catch {
          activeMeals = null
          pushOrderWarning(
            warnings,
            context.source,
            'QUANTITY_OVERFLOW',
            'date.meals',
            `${key} meals exceed the safe integer range`,
          )
        }
      }
      if (context.total.state !== 'valid' || context.total.minorUnits === null) activeRevenue = null
      else if (activeRevenue !== null) {
        try {
          activeRevenue = checkedAdd(activeRevenue, context.total.minorUnits, `${key} revenue`)
        } catch {
          activeRevenue = null
          pushOrderWarning(
            warnings,
            context.source,
            'MONEY_OVERFLOW',
            'date.total',
            `${key} revenue exceeds the safe USD minor-unit range`,
          )
        }
      }
    }

    return {
      key,
      dateKind,
      serviceDate,
      localizedDate:
        dateKind === 'dated'
          ? localizedServiceDate(first.rawDate, locale)
          : dateKind === 'undated'
            ? 'ללא תאריך'
            : `תאריך לא תקין: ${first.rawDate}`,
      orderCount: members.length,
      activeMeals,
      activeRevenueMinorUnits: activeRevenue,
      aggregatesComplete: activeMeals !== null && activeRevenue !== null,
      capacity,
      full:
        dateKind === 'dated' && capacity.kind === 'configured' && activeMeals !== null
          ? activeMeals >= capacity.maximumMeals
          : null,
      blocks: buildDisplayBlocks(members, warnings),
    }
  })

  return reverseDates ? groups.reverse() : groups
}

function queryTerms(query: string, locale: string): string[] {
  const normalized = query.slice(0, MAX_TEXT_FIELD_LENGTH).trim().toLocaleLowerCase(locale)
  return normalized === '' ? [] : normalized.split(/\s+/)
}

export function buildOrdersDashboard(
  store: Readonly<LegacyStore>,
  options: OrdersDashboardOptions = {},
): OrdersDashboard {
  const now = options.now ?? new Date()
  if (!Number.isFinite(now.getTime())) throw new RangeError('now must be a valid Date')
  const timeZone = options.timeZone ?? DEFAULT_BUSINESS_TIME_ZONE
  const locale = options.locale ?? DEFAULT_LOCALE
  const todayIso = zonedToday(now, timeZone)
  const query = (options.query ?? '').slice(0, MAX_TEXT_FIELD_LENGTH).trim()
  const warnings: OrdersWarning[] = []
  const capacity = readCapacity(store, warnings)
  const idCounts = new Map<string, number>()
  for (const order of store.orders) {
    const id = legacyOrderId(order.id)
    if (id !== null) idCounts.set(String(id), (idCounts.get(String(id)) ?? 0) + 1)
  }
  const ambiguousOrderIds = new Set(
    [...idCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id),
  )
  const contexts = store.orders.map((order, index) =>
    buildContext(order, index, locale, warnings, ambiguousOrderIds),
  )
  const terms = queryTerms(query, locale)
  const matches =
    terms.length === 0
      ? []
      : contexts.filter((context) => terms.every((term) => context.searchText.includes(term)))
  const upcoming = contexts.filter(
    (context) => !context.view.serviceDateValid || context.rawDate >= todayIso,
  )
  const past = contexts.filter(
    (context) => context.view.serviceDateValid && context.rawDate < todayIso,
  )

  return {
    todayIso,
    globallyEmpty: store.orders.length === 0,
    query,
    searchActive: terms.length > 0,
    matchCount: matches.length,
    upcomingGroups: buildDateGroups(upcoming, capacity, locale, warnings),
    pastGroups: buildDateGroups(past, capacity, locale, warnings, true),
    searchGroups: buildDateGroups(matches, capacity, locale, warnings),
    pastOrderCount: past.length,
    warnings: warnings.filter(
      (warning, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.code === warning.code &&
            candidate.orderId === warning.orderId &&
            candidate.path === warning.path,
        ) === index,
    ),
  }
}
