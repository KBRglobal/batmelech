import { parseLegacyUsdAmount } from './customers-finance.ts'
import { normalizeWhatsAppPhone } from './orders-dashboard.ts'
import type { LegacyOrder } from './store.ts'
import { formatUsdMinorUnits } from './today-dashboard.ts'

// Every message here is drafted for Lin and opened in her own WhatsApp: nothing
// is ever delivered to a customer by the panel. The builders are therefore pure
// text, and the only outbound artifact is a wa.me link she still has to send.

const DEFAULT_LOCALE = 'he-IL'
const MAX_TEXT_LENGTH = 10_000
const MAX_NAME_LENGTH = 200
const MAX_NUMERIC_TOKEN_LENGTH = 64
const MAX_COLLECTION_ENTRIES = 2_000
const DEFAULT_ITEM_LIMIT = 4
const DELIVERED_STATUS = 'נמסרה'
const UNPAID_MARKERS = new Set(['', 'לא'])

export const BATMELECH_SITE_URL = 'https://batmelech.ae/site/'
/** Stands in for settings.paymentRequestDetails so Lin sees what is missing. */
export const PAYMENT_DETAILS_PLACEHOLDER = '[פרטי תשלום]'

export interface OutreachOrderItem {
  readonly name: string
  readonly quantity: number
}

export interface DepositRequestInput {
  readonly customerName: string
  readonly orderDateLabel: string
  readonly amountLabel: string
  readonly paymentRequestDetails: string
}

export interface ReviewRequestInput {
  readonly customerName: string
  readonly googleReviewUrl: string
}

export interface ReorderInviteInput {
  readonly customerName: string
  readonly orderDateLabel: string
  readonly items: readonly OutreachOrderItem[]
  readonly siteUrl?: string
}

function text(value: unknown): string {
  return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH ? value.trim() : ''
}

function itemName(value: unknown): string {
  return typeof value === 'string' && value.length <= MAX_NAME_LENGTH ? value.trim() : ''
}

function quantity(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : 0
  }
  if (typeof value !== 'string' || value.length > MAX_NUMERIC_TOKEN_LENGTH) return 0
  const normalized = value.trim()
  if (!/^\d+$/.test(normalized)) return 0
  const parsed = BigInt(normalized)
  return parsed > 0n && parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed) : 0
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function* boundedEntries(
  record: Readonly<Record<string, unknown>> | undefined,
): Generator<readonly [string, unknown]> {
  if (record === undefined) return
  let count = 0
  for (const key in record) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue
    if (count >= MAX_COLLECTION_ENTRIES) return
    count += 1
    yield [key, record[key]] as const
  }
}

function isRealIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match === null) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

function isSafeHttpUrl(value: string): boolean {
  if (value === '') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/** 'יום שישי 14.08' for a real ISO service date, '' for anything else. */
export function formatOutreachDate(value: unknown, locale = DEFAULT_LOCALE): string {
  const raw = text(value)
  if (!isRealIsoDate(raw)) return ''
  const [year, month, day] = raw.split('-').map(Number)
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year!, month! - 1, day)),
  )
  return `${weekday} ${raw.slice(8, 10)}.${raw.slice(5, 7)}`
}

function pushItem(items: OutreachOrderItem[], name: string, count: number): void {
  if (name === '' || count <= 0) return
  items.push({ name, quantity: count })
}

/** The largest lines of an order, newest-first by quantity, for a reorder nudge. */
export function summarizeOrderItems(
  order: Readonly<LegacyOrder>,
  limit = DEFAULT_ITEM_LIMIT,
): readonly OutreachOrderItem[] {
  const items: OutreachOrderItem[] = []
  pushItem(items, 'ארוחה זוגית', quantity(order.meals))

  for (const [name, value] of boundedEntries(order.salads)) {
    pushItem(items, itemName(name), isRecord(value) ? quantity(value.o) : 0)
  }
  for (const record of [order.firsts, order.mains, order.sides, order.desserts]) {
    for (const [name, value] of boundedEntries(record)) {
      pushItem(items, itemName(name), quantity(value))
    }
  }
  for (const [name, value] of boundedEntries(order.extras)) {
    pushItem(items, itemName(name), isRecord(value) ? quantity(value.q) : 0)
  }

  const custom = order.custom ?? []
  for (let index = 0; index < Math.min(custom.length, MAX_COLLECTION_ENTRIES); index += 1) {
    const value = custom[index]
    if (isRecord(value)) pushItem(items, itemName(value.name), quantity(value.qty))
  }

  pushItem(items, 'חלות', quantity(order.challot))
  pushItem(items, 'עריכת שולחן', quantity(order.aricha))

  return items
    .slice()
    .sort((left, right) => right.quantity - left.quantity)
    .slice(0, Math.max(0, limit))
}

/** What Lin should ask for now: the agreed deposit, or the whole order total. */
export function outreachAmountMinorUnits(order: Readonly<LegacyOrder>): number | null {
  const deposit = parseLegacyUsdAmount(order.deposit)
  if (deposit.state === 'valid' && deposit.minorUnits > 0) return deposit.minorUnits
  const total = parseLegacyUsdAmount(order.total)
  return total.state === 'valid' && total.minorUnits > 0 ? total.minorUnits : null
}

export function isAwaitingPayment(order: Readonly<LegacyOrder>): boolean {
  return (
    UNPAID_MARKERS.has(text(order.paid)) && outreachAmountMinorUnits(order) !== null
  )
}

export function isDelivered(order: Readonly<LegacyOrder>): boolean {
  return text(order.status) === DELIVERED_STATUS
}

function greeting(customerName: string): string {
  const name = itemName(customerName)
  return name === '' ? 'היי, כאן בת מלך.' : `היי ${name}, כאן בת מלך.`
}

export function buildDepositRequestMessage(input: Readonly<DepositRequestInput>): string {
  const dateLabel = text(input.orderDateLabel)
  const details = text(input.paymentRequestDetails)
  return [
    greeting(input.customerName),
    dateLabel === ''
      ? 'ההזמנה שלך רשומה אצלנו ומחכה.'
      : `ההזמנה שלך ל${dateLabel} רשומה אצלנו ומחכה.`,
    `נשאר להסדיר תשלום של ${text(input.amountLabel)}.`,
    `אפשר להעביר כך: ${details === '' ? PAYMENT_DETAILS_PLACEHOLDER : details}`,
    'תודה רבה, ושבת שלום.',
  ].join('\n')
}

export function buildReviewRequestMessage(input: Readonly<ReviewRequestInput>): string {
  return [
    greeting(input.customerName),
    'תודה רבה שהזמנת אצלנו, מקווים שנהניתם.',
    'אם בא לך לשמח אותנו, ביקורת קטנה בגוגל עוזרת לנו מאוד:',
    text(input.googleReviewUrl),
    'תודה מכל הלב.',
  ].join('\n')
}

export function buildReorderInviteMessage(input: Readonly<ReorderInviteInput>): string {
  const dateLabel = text(input.orderDateLabel)
  const siteUrl = text(input.siteUrl ?? BATMELECH_SITE_URL) || BATMELECH_SITE_URL
  return [
    greeting(input.customerName),
    dateLabel === '' ? 'בפעם הקודמת הזמנת:' : `בפעם הקודמת, ${dateLabel}, הזמנת:`,
    ...input.items.map((item) => `· ${item.name} ×${item.quantity}`),
    'רוצים לחזור על זה לשבת הקרובה?',
    `אפשר להזמין כאן: ${siteUrl}`,
  ].join('\n')
}

/** The one place a message becomes a link; Lin still presses send herself. */
export function buildOutreachWhatsAppHref(phone: string, message: string): string | null {
  const normalized = normalizeWhatsAppPhone(phone)
  if (normalized === null || message.trim() === '') return null
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`
}

export function depositRequestHref(
  order: Readonly<LegacyOrder>,
  phone: string,
  paymentRequestDetails: string,
  locale = DEFAULT_LOCALE,
): string | null {
  const amount = outreachAmountMinorUnits(order)
  if (amount === null) return null
  return buildOutreachWhatsAppHref(
    phone,
    buildDepositRequestMessage({
      customerName: text(order.name),
      orderDateLabel: formatOutreachDate(order.date, locale),
      amountLabel: formatUsdMinorUnits(amount),
      paymentRequestDetails,
    }),
  )
}

export function reviewRequestHref(
  order: Readonly<LegacyOrder>,
  phone: string,
  googleReviewUrl: string,
): string | null {
  const url = text(googleReviewUrl)
  if (!isSafeHttpUrl(url)) return null
  return buildOutreachWhatsAppHref(
    phone,
    buildReviewRequestMessage({ customerName: text(order.name), googleReviewUrl: url }),
  )
}

export function reorderInviteHref(
  order: Readonly<LegacyOrder>,
  phone: string,
  locale = DEFAULT_LOCALE,
): string | null {
  const items = summarizeOrderItems(order)
  if (items.length === 0) return null
  return buildOutreachWhatsAppHref(
    phone,
    buildReorderInviteMessage({
      customerName: text(order.name),
      orderDateLabel: formatOutreachDate(order.date, locale),
      items,
    }),
  )
}
