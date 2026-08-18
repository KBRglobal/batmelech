import { LegacyStoreSchema, type LegacyStore } from './store.ts'
import type { SettingsCatalog } from './settings-catalog.ts'
import { parseLegacyUsdAmount } from './customers-finance.ts'

const MAX_BACKUP_BYTES = 10_000_000
const MAX_BACKUP_DEPTH = 64
const MAX_BACKUP_NODES = 500_000
const MAX_LINK_LENGTH = 2_048
const MAX_SITE_BANNER_LENGTH = 200
const MAX_PAYMENT_DETAILS_LENGTH = 500

export interface BackupArtifact {
  readonly filename: string
  readonly content: string
  readonly mimeType: 'application/json'
}

export type BackupReview =
  | { readonly status: 'empty'; readonly message: string }
  | { readonly status: 'invalid-json'; readonly message: string }
  | { readonly status: 'wrong-schema'; readonly message: string; readonly issues: readonly string[] }
  | {
      readonly status: 'ready'
      readonly message: string
      readonly currentOrderCount: number
      readonly incomingOrderCount: number
      readonly incomingStore: LegacyStore
      readonly sourceText: string
    }

export interface RestoreRequest {
  readonly currentStore: Readonly<LegacyStore>
  readonly incomingStore: LegacyStore
  readonly sourceText: string
  readonly currentOrderCount: number
  readonly incomingOrderCount: number
}

export type RestoreRequestHandler = (request: RestoreRequest) => Promise<void>

export type InvoiceCurrency = 'AED' | 'USD'

export interface SettingsDraft {
  readonly maxMeals: string
  readonly paymentLink: string
  readonly customerOrderFormUrl: string
  readonly outOfStock: readonly string[]
  readonly businessName: string
  readonly trn: string
  readonly businessAddress: string
  readonly invoiceCurrency: InvoiceCurrency
  /** Effective openness right now, not the raw stored boolean. */
  readonly orderingOpen: boolean
  /** YYYY-MM-DD (Dubai) ordering reopens on; '' while open. */
  readonly orderingClosedUntil: string
  readonly siteBanner: string
  /** Free text Lin writes once: how a customer actually pays her. */
  readonly paymentRequestDetails: string
  /** The business's Google review link, pasted into the thank-you message. */
  readonly googleReviewUrl: string
  /** Minimum order total in USD for Abu Dhabi deliveries; empty means no minimum. */
  readonly minOrderAbuDhabi: string
}

export type SettingsDraftValidation =
  | {
      readonly valid: true
      readonly maxMeals: number
      readonly paymentLink: string
      readonly customerOrderFormUrl: string
      readonly businessName: string
      readonly trn: string
      readonly businessAddress: string
      readonly invoiceCurrency: InvoiceCurrency
      readonly orderingOpen: boolean
      readonly orderingClosedUntil: string
      readonly siteBanner: string
      readonly paymentRequestDetails: string
      readonly googleReviewUrl: string
      readonly minOrderAbuDhabiMinorUnits?: number
    }
  | { readonly valid: false; readonly issues: readonly string[] }

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function dubaiDate(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new RangeError('now must be a valid Date')
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Dubai',
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((candidate) => candidate.type === type)?.value
    if (part === undefined || !/^\d+$/.test(part)) throw new RangeError(`Unable to resolve ${type}`)
    return part
  }
  return `${value('year')}-${value('month')}-${value('day')}`
}

// Ordering never closes indefinitely: settings.orderingClosedUntil names the
// day it comes back (always a Sunday, exclusive of nothing before it) and every
// read compares it to today, so the site reopens itself.
//
// The rules here intentionally mirror effectiveOrderingOpen /
// upcomingSundayDubai in server/business-actions.js. That file is CommonJS and
// cannot be imported here, so the logic is duplicated: change one, change the
// other, or the panel and the customer site disagree about whether Lin is open.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MILLISECONDS_PER_DAY = 86_400_000

function isoDate(value: unknown): string {
  return typeof value === 'string' && ISO_DATE.test(value.trim()) ? value.trim() : ''
}

export function upcomingSundayDubai(now = new Date()): string {
  const midnightUtc = Date.parse(`${dubaiDate(now)}T00:00:00Z`)
  if (!Number.isFinite(midnightUtc)) throw new RangeError('now must be a valid Date')
  const daysAhead = 7 - new Date(midnightUtc).getUTCDay() // Sunday closes for a full week
  return new Date(midnightUtc + daysAhead * MILLISECONDS_PER_DAY).toISOString().slice(0, 10)
}

function orderingOpenOn(settings: Readonly<Record<string, unknown>>, today: string): boolean {
  const closedUntil = isoDate(settings.orderingClosedUntil)
  if (closedUntil === '') return settings.orderingOpen !== false // pre-date state blobs
  return today >= closedUntil
}

function reopenDayLabel(closedUntil: string, locale = 'he-IL'): string {
  const day = new Date(`${closedUntil}T00:00:00Z`)
  if (!Number.isFinite(day.getTime())) return ''
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(day)
  return `${weekday} ${closedUntil.slice(8, 10)}.${closedUntil.slice(5, 7)}`
}

/** The sentence shown above the toggle: open, or closed with the day it returns. */
export function describeOrderingState(draft: SettingsDraft, locale = 'he-IL'): string {
  if (draft.orderingOpen) return 'האתר פתוח להזמנות'
  const label = reopenDayLabel(isoDate(draft.orderingClosedUntil), locale)
  return label === '' ? 'האתר סגור להזמנות' : `האתר סגור להזמנות עד ${label}`
}

/** Closing always closes for the coming Shabbat only; opening returns at once. */
export function toggleOrderingOpen(draft: SettingsDraft, now = new Date()): SettingsDraft {
  return draft.orderingOpen
    ? { ...draft, orderingOpen: false, orderingClosedUntil: upcomingSundayDubai(now) }
    : { ...draft, orderingOpen: true, orderingClosedUntil: '' }
}

export function createBackupArtifact(
  store: Readonly<LegacyStore>,
  now = new Date(),
): BackupArtifact {
  const content = JSON.stringify(store, null, 2)
  if (content === undefined) throw new TypeError('store could not be serialized')
  return {
    filename: `batmelech-orders-${dubaiDate(now)}.json`,
    content,
    mimeType: 'application/json',
  }
}

function structuralIssues(value: unknown): string[] {
  const issues: string[] = []
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  let nodes = 0
  while (stack.length > 0) {
    const current = stack.pop()!
    nodes += 1
    if (nodes > MAX_BACKUP_NODES) {
      issues.push('backup contains too many values')
      break
    }
    if (current.depth > MAX_BACKUP_DEPTH) {
      issues.push('backup nesting is too deep')
      break
    }
    if (Array.isArray(current.value)) {
      for (const item of current.value) stack.push({ value: item, depth: current.depth + 1 })
    } else if (isRecord(current.value)) {
      for (const item of Object.values(current.value)) {
        stack.push({ value: item, depth: current.depth + 1 })
      }
    }
  }
  return issues
}

function duplicateOrderIdIssues(store: Readonly<LegacyStore>): string[] {
  const seen = new Map<string, number>()
  const issues: string[] = []
  store.orders.forEach((order, index) => {
    const id = order.id
    if (id === undefined || id === null || (typeof id === 'string' && id.trim() === '')) return
    const canonical = String(id)
    const previous = seen.get(canonical)
    if (previous !== undefined) {
      issues.push(`orders.${index}.id duplicates orders.${previous}.id`)
    } else {
      seen.set(canonical, index)
    }
  })
  return issues
}

export function reviewBackupText(
  sourceText: string,
  currentStore: Readonly<LegacyStore>,
): BackupReview {
  if (sourceText.trim() === '') {
    return { status: 'empty', message: 'אין מה לשחזר — קודם לבחור קובץ או להדביק טקסט.' }
  }
  if (new TextEncoder().encode(sourceText).byteLength > MAX_BACKUP_BYTES) {
    return {
      status: 'wrong-schema',
      message: 'הקובץ לא נראה כמו גיבוי של המערכת.',
      issues: ['backup exceeds the maximum review size'],
    }
  }
  let value: unknown
  try {
    value = JSON.parse(sourceText)
  } catch {
    return { status: 'invalid-json', message: 'הטקסט לא תקין — זה לא קובץ גיבוי.' }
  }
  const structure = structuralIssues(value)
  if (structure.length > 0) {
    return {
      status: 'wrong-schema',
      message: 'הקובץ לא נראה כמו גיבוי של המערכת.',
      issues: structure,
    }
  }
  const result = LegacyStoreSchema.safeParse(value)
  if (!result.success) {
    return {
      status: 'wrong-schema',
      message: 'הקובץ לא נראה כמו גיבוי של המערכת.',
      issues: result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    }
  }
  const duplicates = duplicateOrderIdIssues(result.data)
  if (duplicates.length > 0) {
    return {
      status: 'wrong-schema',
      message: 'הקובץ לא נראה כמו גיבוי בטוח של המערכת.',
      issues: duplicates,
    }
  }
  return {
    status: 'ready',
    message: `הגיבוי מוכן לבדיקה: ${result.data.orders.length} הזמנות.`,
    currentOrderCount: currentStore.orders.length,
    incomingOrderCount: result.data.orders.length,
    incomingStore: result.data,
    sourceText,
  }
}

function settingsRecord(store: Readonly<LegacyStore>): Readonly<Record<string, unknown>> {
  return isRecord(store.settings) ? store.settings : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalPositiveDollarsText(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    const amount = BigInt(value)
    const dollars = amount / 100n
    const cents = String(amount % 100n).padStart(2, '0')
    return `${dollars}.${cents}`
  }
  return ''
}

function nonNegativeIntegerText(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value)
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return value.trim()
  return '0'
}

export function readSettingsDraft(
  store: Readonly<LegacyStore>,
  catalog: SettingsCatalog,
  now = new Date(),
): SettingsDraft {
  const settings = settingsRecord(store)
  const orderingOpen = orderingOpenOn(settings, dubaiDate(now))
  const validItems = new Set(
    Object.values(catalog.categories).flatMap((items) => items.map((item) => item.name)),
  )
  const out = Array.isArray(settings.out)
    ? settings.out.filter((value): value is string => typeof value === 'string')
    : []
  const currency = settings.invoiceCurrency
  return {
    maxMeals: nonNegativeIntegerText(settings.maxMeals),
    paymentLink: stringValue(settings.payLink),
    customerOrderFormUrl: stringValue(settings.orderFormUrl),
    outOfStock: out.filter((name) => validItems.has(name)),
    businessName: stringValue(settings.businessName),
    trn: stringValue(settings.trn),
    businessAddress: stringValue(settings.businessAddress),
    invoiceCurrency: currency === 'USD' ? 'USD' : 'AED',
    orderingOpen,
    // A reopen day already behind us is spent; the draft shows an open site.
    orderingClosedUntil: orderingOpen ? '' : isoDate(settings.orderingClosedUntil),
    siteBanner: stringValue(settings.siteBanner),
    paymentRequestDetails: stringValue(settings.paymentRequestDetails),
    googleReviewUrl: stringValue(settings.googleReviewUrl),
    minOrderAbuDhabi: optionalPositiveDollarsText(settings.minOrderAbuDhabiMinorUnits),
  }
}

function validOptionalUrl(value: string): boolean {
  if (value === '') return true
  if (value.length > MAX_LINK_LENGTH) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export function validateSettingsDraft(draft: SettingsDraft): SettingsDraftValidation {
  const issues: string[] = []
  const validCountText = /^\d+$/.test(draft.maxMeals.trim())
  if (!validCountText) issues.push('תקרת העומס חייבת להיות מספר שלם ולא שלילי.')
  const maxMeals = validCountText ? Number(draft.maxMeals.trim()) : Number.NaN
  if (validCountText && !Number.isSafeInteger(maxMeals)) issues.push('תקרת העומס גדולה מדי.')
  const paymentLink = draft.paymentLink.trim()
  const customerOrderFormUrl = draft.customerOrderFormUrl.trim()
  if (!validOptionalUrl(paymentLink)) issues.push('לינק התשלום חייב להיות כתובת HTTP או HTTPS תקינה.')
  if (!validOptionalUrl(customerOrderFormUrl)) {
    issues.push('הקישור לטופס הלקוחות חייב להיות כתובת HTTP או HTTPS תקינה.')
  }
  const businessName = draft.businessName.trim()
  const trn = draft.trn.trim()
  const businessAddress = draft.businessAddress.trim()
  const siteBanner = draft.siteBanner.trim()
  if (siteBanner.length > MAX_SITE_BANNER_LENGTH) {
    issues.push(`הודעת האתר ארוכה מדי (עד ${MAX_SITE_BANNER_LENGTH} תווים).`)
  }
  const paymentRequestDetails = draft.paymentRequestDetails.trim()
  if (paymentRequestDetails.length > MAX_PAYMENT_DETAILS_LENGTH) {
    issues.push(`פרטי התשלום ארוכים מדי (עד ${MAX_PAYMENT_DETAILS_LENGTH} תווים).`)
  }
  const googleReviewUrl = draft.googleReviewUrl.trim()
  if (!validOptionalUrl(googleReviewUrl)) {
    issues.push('קישור הביקורות בגוגל חייב להיות כתובת HTTP או HTTPS תקינה.')
  }
  const minOrderParsed = parseLegacyUsdAmount(draft.minOrderAbuDhabi)
  if (minOrderParsed.state === 'invalid') {
    issues.push('מינימום הזמנה לאבו דאבי חייב להיות סכום בדולרים חיובי עם עד שתי ספרות אחרי הנקודה.')
  } else if (minOrderParsed.state === 'valid' && minOrderParsed.minorUnits <= 0) {
    issues.push('מינימום הזמנה לאבו דאבי חייב להיות גדול מ-0.')
  }
  return issues.length > 0
    ? { valid: false, issues }
    : {
        valid: true,
        maxMeals,
        paymentLink,
        customerOrderFormUrl,
        businessName,
        trn,
        businessAddress,
        invoiceCurrency: draft.invoiceCurrency,
        orderingOpen: draft.orderingOpen,
        orderingClosedUntil: draft.orderingOpen ? '' : isoDate(draft.orderingClosedUntil),
        siteBanner,
        paymentRequestDetails,
        googleReviewUrl,
        minOrderAbuDhabiMinorUnits:
          minOrderParsed.state === 'valid' && minOrderParsed.minorUnits > 0
            ? minOrderParsed.minorUnits
            : undefined,
      }
}

export function applySettingsToStore(
  store: Readonly<LegacyStore>,
  draft: SettingsDraft,
  catalog: SettingsCatalog,
  now = new Date(),
): LegacyStore {
  const result = validateSettingsDraft(draft)
  if (!result.valid) throw new Error(result.issues.join('; '))
  const previous = settingsRecord(store)
  const knownStockNames = new Set(
    Object.values(catalog.categories).flatMap((items) => items.map((item) => item.name)),
  )
  const preservedOut = Array.isArray(previous.out)
    ? previous.out.filter(
        (value) => typeof value !== 'string' || !knownStockNames.has(value),
      )
    : []
  const currentOut = [...new Set(draft.outOfStock.map((name) => name.trim()).filter(Boolean))]
  const settings: Record<string, unknown> = {
    ...previous,
    maxMeals: result.maxMeals,
    payLink: result.paymentLink,
    orderFormUrl: result.customerOrderFormUrl,
    out: [...preservedOut, ...currentOut],
    businessName: result.businessName,
    trn: result.trn,
    businessAddress: result.businessAddress,
    invoiceCurrency: result.invoiceCurrency,
    orderingOpen: result.orderingOpen,
    siteBanner: result.siteBanner === '' ? null : result.siteBanner,
    paymentRequestDetails: result.paymentRequestDetails,
    googleReviewUrl: result.googleReviewUrl,
  }
  if (result.minOrderAbuDhabiMinorUnits !== undefined) {
    settings.minOrderAbuDhabiMinorUnits = result.minOrderAbuDhabiMinorUnits
  } else {
    delete settings.minOrderAbuDhabiMinorUnits
  }
  if (result.orderingOpen) {
    delete settings.orderingClosedUntil
  } else {
    // A draft closed but carrying no reopen day is either a fresh close or an
    // old boolean-only close; either way it closes for the coming Shabbat.
    settings.orderingClosedUntil =
      result.orderingClosedUntil === '' ? upcomingSundayDubai(now) : result.orderingClosedUntil
  }
  return { ...store, settings } as LegacyStore
}

export function formatLastBackup(value: unknown, locale = 'he-IL'): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return 'עוד לא נעשה'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'עוד לא נעשה'
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Dubai',
  }).format(date)
}
