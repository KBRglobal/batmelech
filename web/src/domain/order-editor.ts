import { z } from 'zod'
import { EXTRA_FILLET_UNIT_PRICE_MINOR_UNITS } from './fish-pricing.ts'
import {
  BAKLAVA_HALF_UNITS_PER_PORTION,
  classifyDessertKind,
  DESSERT_HALF_UNITS_INCLUDED_PER_MEAL,
  FISH_UNITS_INCLUDED_PER_MEAL,
  MAINS_INCLUDED_PER_MEAL,
  SIDES_INCLUDED_PER_MEAL,
  SOUFFLE_HALF_UNITS_PER_PORTION,
  defaultDessertPortionsForMeals,
} from './package-rules.ts'
import { parseLegacyUsdAmount } from './customers-finance.ts'
import { checkedAdd, checkedMultiply, requireNonNegativeSafeInteger } from './money.ts'
import {
  DELIVERY_EXTRA_NAME,
  calculateOrderTotal,
  isAutomaticChargeName,
  type ChargeLineInput,
  type OrderTotalResult,
} from './order-total.ts'
import {
  EXTRA_SALAD_BLOCK_PRICE_MINOR_UNITS,
  EXTRA_SALAD_SINGLE_PRICE_MINOR_UNITS,
} from './salad-pricing.ts'
import type { LegacyOrder, LegacyStore } from './store.ts'

export const DEFAULT_COUPLE_PRICE_MINOR_UNITS = 23_000
export const DEFAULT_CHALLAH_PRICE_MINOR_UNITS = 1_000
export const DEFAULT_EXTRA_MAIN_PRICE_MINOR_UNITS = 10_000

export const DEFAULT_MENU_CATEGORIES = {
  salads: [
    'כרוב לבן קלאסי',
    'כרוב סגול במיונז',
    'קולסלאו',
    'מטבוחה פיקנטית',
    "צ'ירשי טריפוליטאי",
    'משוויה מרוקאית',
    'מסייר (חמוצים)',
    'טחינה',
    'סלק מבושל',
    'גזר מרוקאי מבושל',
    'חציל במיונז',
    'חציל מטוגן',
    'פלפלים קלויים',
    'עגבניות שרי חריפות',
    'פלפל חריף צלוי',
    'סלט ביצים',
    'סלט תפו"א',
  ],
  firsts: [
    'פילה דג ברוטב מרוקאי',
    'פילה דג ברוטב חריימה',
    'קציצות דגים ברוטב מרוקאי',
  ],
  mains: [
    'קציצות בשר ברוטב אדום עשיר',
    'קציצות בשר עם אפונה וארטישוק',
    'קציצות בשר בריבת בצל וערמונים',
    'טבחה עוף אדומה עם שעועית',
    'תבשיל עוף מרוקאי עם חומוסים',
    'טבחה עוף צהובה עם תפו"א',
    'מגש שניצלים — במקום עיקרית',
    'רולדת בשר — במקום עיקרית',
  ],
  sides: [
    'אורז לבן',
    'אורז מתובל / פרסי עם עשבי תיבול',
    'קוסקוס עננים',
    'פסטה נקיה',
    'פסטה אדומה',
    'מגש תפו"א',
  ],
  desserts: ['סופלה שוקולד', 'סוכריות בקלוואה'],
} as const

const DEFAULT_EXTRAS_DOLLARS = [
  ['צלי בקר פרוס ברוטב פטריות וערמונים (ל־4 אנשים)', 150],
  ['מפרום ביתי של אמא (זוגי)', 40],
  ['טבחה בשר אדומה עם אפונה ותפו"א (ל־2־3 אנשים)', 100],
  ['רולדת בשר פריך ברוטב פטריות עשיר', 100],
  ["מגש שניצלים (זוגי, כ־13–15 יח')", 100],
  ['מגש תפו"א קריספיים', 30],
  ['אורז', 25],
  ['פסטה אדומה', 25],
  ['קוסקוס', 25],
  ['צלחת פתיחה (זיתים וחמוצים)', 15],
  ['צלחת חריפים', 15],
  ['תוספת חומוס ישראלי לניגוב', 15],
  ['מארז הבדלה', 20],
  ['סיר קובה סלק בתוספת אורז (ל־4 אנשים)', 125],
  ['מנת ילדים — פסטה אדומה ושניצלונים', 35],
  ['חלת שניצל (ספיישל סופ"ש)', 28],
  ['מנת מפרום ביתי (תוספת)', 20],
  ['מרק ירקות לקוסקוס ללא עוף', 70],
  ['מרק ירקות לקוסקוס עם עוף', 100],
  ['סט עריכה', 10],
  ['תוספת יין', 5],
] as const

export type DeliveryZone = 'dubai' | 'abu-dhabi'

export const DELIVERY_ZONE_OPTIONS: readonly { readonly value: DeliveryZone; readonly label: string }[] = [
  { value: 'dubai', label: 'דובאי' },
  { value: 'abu-dhabi', label: 'אבו דאבי' },
]

const DELIVERY_PRICE_MINOR_UNITS: Readonly<Record<DeliveryZone, number>> = {
  dubai: 1_500,
  'abu-dhabi': 5_500,
}

function isDeliveryZone(value: unknown): value is DeliveryZone {
  return value === 'dubai' || value === 'abu-dhabi'
}

export interface MenuExtra {
  readonly name: string
  /** null when neither the store nor the kitchen's own table can price it. */
  readonly priceMinorUnits: number | null
}

export interface LunchVariant {
  readonly key: string
  readonly label: string
  readonly priceMinorUnits: number
  readonly weekendOnly?: boolean
  readonly includedSides: number
  readonly sidePriceMinorUnits: number
}

export interface LunchItem {
  readonly key: string
  readonly name: string
  readonly priceMinorUnits: number | null
  readonly variants: readonly LunchVariant[]
  readonly sideChoice: boolean
  readonly addon: { readonly name: string; readonly priceMinorUnits: number } | null
}

export interface OrderEditorMenu {
  readonly salads: readonly string[]
  readonly firsts: readonly string[]
  readonly mains: readonly string[]
  readonly sides: readonly string[]
  readonly desserts: readonly string[]
  readonly extras: readonly MenuExtra[]
  readonly lunch: readonly LunchItem[]
  readonly lunchSides: readonly string[]
  readonly couplePriceMinorUnits: number
  readonly challahPriceMinorUnits: number
  readonly includedChallahs: number
  readonly saladBlockPriceMinorUnits: number
  readonly saladRemainderPriceMinorUnits: number
  readonly extraFishFilletPriceMinorUnits: number
  readonly extraDessertHalfUnitMinorUnits: number
  readonly extraMainPriceMinorUnits: number
}

const DEFAULT_LUNCH: readonly LunchItem[] = [
  {
    key: 'baguette',
    name: 'בגט טוניסאי אותנטי',
    priceMinorUnits: 2_200,
    variants: [],
    sideChoice: false,
    addon: null,
  },
  {
    key: 'schnitzel-roll',
    name: 'בגט/חלת שניצל ישראלי',
    priceMinorUnits: null,
    variants: [
      {
        key: 'baguette',
        label: 'בבגט',
        priceMinorUnits: 2_500,
        includedSides: 0,
        sidePriceMinorUnits: 0,
      },
      {
        key: 'challah',
        label: 'בחלה — סופ"ש בלבד',
        priceMinorUnits: 2_800,
        weekendOnly: true,
        includedSides: 0,
        sidePriceMinorUnits: 0,
      },
    ],
    sideChoice: false,
    addon: null,
  },
  {
    key: 'kubeh',
    name: 'מנת קובה סלק ביתית',
    priceMinorUnits: 3_500,
    variants: [],
    sideChoice: false,
    addon: null,
  },
  {
    key: 'schnitzel-plate',
    name: 'שניצל בצלחת',
    priceMinorUnits: null,
    variants: [
      {
        key: 'single',
        label: 'אישית',
        priceMinorUnits: 3_500,
        includedSides: 1,
        sidePriceMinorUnits: 1_500,
      },
      {
        key: 'couple',
        label: 'זוגית',
        priceMinorUnits: 6_000,
        includedSides: 1,
        sidePriceMinorUnits: 2_500,
      },
      {
        key: 'family',
        label: 'משפחתית — כולל 2 תוספות',
        priceMinorUnits: 14_500,
        includedSides: 2,
        sidePriceMinorUnits: 2_500,
      },
    ],
    sideChoice: true,
    addon: null,
  },
  {
    key: 'couscous',
    name: 'ספיישל קוסקוס',
    priceMinorUnits: 3_500,
    variants: [],
    sideChoice: false,
    addon: { name: 'מנת מפרום ביתי', priceMinorUnits: 2_000 },
  },
]

export interface HotelOption {
  readonly name: string
  readonly city: 'דובאי' | 'אבו דאבי'
  readonly fullAddress: string
  readonly navigationUrl: string
}

export interface HotelSearchResult {
  readonly id: string
  readonly name: string
  readonly fullAddress: string
  readonly latitude: number
  readonly longitude: number
  readonly navigationUrl: string
}

export interface HotelSearchResponse {
  readonly results: readonly HotelSearchResult[]
  readonly attribution: {
    readonly label: 'OpenStreetMap contributors'
    readonly url: 'https://www.openstreetmap.org/copyright'
  }
}

const HOTEL_PROVIDER_ID_PATTERN = /^[NWR][1-9]\d{0,18}$/u
const HOTEL_MINIMUM_LATITUDE = 22.5
const HOTEL_MAXIMUM_LATITUDE = 26.5
const HOTEL_MINIMUM_LONGITUDE = 51
const HOTEL_MAXIMUM_LONGITUDE = 56.6

function coordinateNavigationUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`
}

const HotelSearchResultSchema = z
  .object({
    id: z.string().regex(HOTEL_PROVIDER_ID_PATTERN),
    name: z.string().trim().min(1).max(200),
    fullAddress: z.string().trim().min(1).max(500),
    latitude: z.number().finite().min(HOTEL_MINIMUM_LATITUDE).max(HOTEL_MAXIMUM_LATITUDE),
    longitude: z.number().finite().min(HOTEL_MINIMUM_LONGITUDE).max(HOTEL_MAXIMUM_LONGITUDE),
    navigationUrl: z.string().url().max(500),
  })
  .strict()
  .refine(
    (result) => result.navigationUrl === coordinateNavigationUrl(result.latitude, result.longitude),
    { message: 'Hotel navigation URL does not match its coordinates.' },
  )

const HotelSearchResponseSchema = z
  .object({
    results: z.array(HotelSearchResultSchema).max(10),
    attribution: z
      .object({
        label: z.literal('OpenStreetMap contributors'),
        url: z.literal('https://www.openstreetmap.org/copyright'),
      })
      .strict(),
  })
  .strict()

export function parseHotelSearchResponse(value: unknown): HotelSearchResponse | null {
  const parsed = HotelSearchResponseSchema.safeParse(value)
  if (!parsed.success) return null
  if (new Set(parsed.data.results.map((result) => result.id)).size !== parsed.data.results.length) {
    return null
  }
  return parsed.data
}

const HOTEL_ROWS = [
  ['Atlantis The Palm', 'דובאי', 'Crescent Rd, Palm Jumeirah, Dubai'],
  ['Atlantis The Royal', 'דובאי', 'Crescent Rd, Palm Jumeirah, Dubai'],
  ['Burj Al Arab Jumeirah', 'דובאי', 'Jumeirah Beach Rd, Umm Suqeim, Dubai'],
  ['Jumeirah Beach Hotel', 'דובאי', 'Jumeirah Beach Rd, Umm Suqeim, Dubai'],
  ['Jumeirah Al Naseem', 'דובאי', 'Madinat Jumeirah, Umm Suqeim, Dubai'],
  ['Address Downtown', 'דובאי', 'Downtown Dubai, Sheikh Mohammed bin Rashid Blvd'],
  ['Address Dubai Marina', 'דובאי', 'Dubai Marina, Al Marsa St'],
  ['Address Beach Resort', 'דובאי', 'JBR, The Walk, Dubai'],
  ['Armani Hotel Dubai', 'דובאי', 'Burj Khalifa, Downtown Dubai'],
  ['JW Marriott Marquis Dubai', 'דובאי', 'Business Bay, Sheikh Zayed Rd, Dubai'],
  ['Grand Hyatt Dubai', 'דובאי', 'Oud Metha Rd, Dubai'],
  ['W Dubai – Mina Seyahi', 'דובאי', 'Dubai Marina, Mina Seyahi'],
  ['Five Palm Jumeirah', 'דובאי', 'Palm Jumeirah, Dubai'],
  ['FIVE LUXE JBR', 'דובאי', 'JBR, The Walk, Dubai'],
  ['Paramount Hotel Dubai', 'דובאי', 'Business Bay, Al Abraj St, Dubai'],
  ['Rixos Premium Dubai JBR', 'דובאי', 'JBR, The Walk, Dubai'],
  ['Sofitel Dubai The Palm', 'דובאי', 'East Crescent, Palm Jumeirah, Dubai'],
  ['Fairmont The Palm', 'דובאי', 'Palm Jumeirah, Dubai'],
  ['One&Only Royal Mirage', 'דובאי', 'Al Sufouh Rd, Dubai Marina'],
  ['Four Seasons Resort Dubai at Jumeirah Beach', 'דובאי', 'Jumeirah Beach Rd, Jumeirah 2, Dubai'],
  ['Mandarin Oriental Jumeira', 'דובאי', 'Jumeirah Beach Rd, Jumeirah 1, Dubai'],
  ['Bulgari Resort Dubai', 'דובאי', 'Jumeira Bay Island, Jumeirah 2, Dubai'],
  ['Kempinski Hotel Mall of the Emirates', 'דובאי', 'Sheikh Zayed Rd, Al Barsha, Dubai'],
  ['Rove Downtown', 'דובאי', 'Downtown Dubai, Mohammed bin Rashid Blvd'],
  ['InterContinental Dubai Marina', 'דובאי', 'Dubai Marina, King Salman bin Abdulaziz St'],
  ['The Ritz-Carlton Dubai', 'דובאי', 'JBR, The Walk, Dubai'],
  ['Anantara The Palm Dubai Resort', 'דובאי', 'East Crescent, Palm Jumeirah, Dubai'],
  ['Conrad Dubai', 'דובאי', 'Sheikh Zayed Rd, Trade Centre, Dubai'],
  ['Emirates Palace Mandarin Oriental', 'אבו דאבי', 'West Corniche Rd, Abu Dhabi'],
  ['The St. Regis Abu Dhabi', 'אבו דאבי', 'Nation Towers, Corniche Rd, Abu Dhabi'],
  ['Conrad Abu Dhabi Etihad Towers', 'אבו דאבי', 'Etihad Towers, Corniche Rd, Abu Dhabi'],
  ['Grand Hyatt Abu Dhabi', 'אבו דאבי', 'Emirates Pearl, West Corniche, Abu Dhabi'],
  ['Sofitel Abu Dhabi Corniche', 'אבו דאבי', 'Corniche Rd East, Abu Dhabi'],
  ['InterContinental Abu Dhabi', 'אבו דאבי', 'King Abdullah bin Abdulaziz St, Abu Dhabi'],
  ['Beach Rotana Abu Dhabi', 'אבו דאבי', 'Al Zahiyah, Tourist Club Area, Abu Dhabi'],
  ['Rosewood Abu Dhabi', 'אבו דאבי', 'Al Maryah Island, Abu Dhabi'],
  ['Four Seasons Abu Dhabi at Al Maryah Island', 'אבו דאבי', 'Al Maryah Island, Abu Dhabi'],
  ['Fairmont Bab Al Bahr', 'אבו דאבי', 'Between the Bridges, Khor Al Maqta, Abu Dhabi'],
  ['Park Hyatt Abu Dhabi Hotel & Villas', 'אבו דאבי', 'Saadiyat Island, Abu Dhabi'],
  ['The St. Regis Saadiyat Island Resort', 'אבו דאבי', 'Saadiyat Island, Abu Dhabi'],
  ['Jumeirah at Saadiyat Island Resort', 'אבו דאבי', 'Saadiyat Island, Abu Dhabi'],
  ['W Abu Dhabi – Yas Island', 'אבו דאבי', 'Yas Island, Abu Dhabi'],
  ['Hilton Abu Dhabi Yas Island', 'אבו דאבי', 'Yas Bay, Yas Island, Abu Dhabi'],
] as const satisfies readonly (readonly [string, HotelOption['city'], string])[]

function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}

export const HOTEL_OPTIONS: readonly HotelOption[] = HOTEL_ROWS.map(
  ([name, city, fullAddress]) => ({ name, city, fullAddress, navigationUrl: mapsUrl(fullAddress) }),
)

export interface SaladDraftSelection {
  readonly [key: string]: unknown
  readonly ordered: number
  readonly gift: number
  readonly note: string
}

export interface ExtraDraftSelection {
  readonly [key: string]: unknown
  readonly quantity: number
  readonly note: string
}

export interface CustomDraftItem {
  readonly [key: string]: unknown
  readonly name: string
  readonly quantity: number
  readonly unitPrice: string
  readonly note: string
}

export interface LunchDraftSelection {
  readonly [key: string]: unknown
  readonly quantity: number
  readonly variantKey: string
  readonly sides: Readonly<Record<string, number>>
  readonly addonQuantity: number
  readonly note: string
}

/**
 * One diner's plate inside a lunch selection: its own variant, its own
 * sides, and its own note (e.g. "no sauce"). Stored as `plates` on the
 * persisted selection and read directly by preparation.ts so a mixed
 * baguette/challah order never collapses into one wrong line. The legacy
 * `v`/`sides` fields still carry the first plate's variant and the merged
 * sides, for any older reader that doesn't know plates exist.
 */
export interface LunchPlateDraft {
  readonly variantKey: string
  readonly sides: Readonly<Record<string, number>>
  readonly note: string
}

export interface OrderDraft extends Record<string, unknown> {
  readonly id: string | number | null
  readonly date: string
  readonly name: string
  readonly phone: string
  readonly email: string
  readonly place: string
  readonly address: string
  readonly hotelName: string
  readonly hotelProviderId: string
  readonly hotelAddress: string
  readonly hotelLatitude: number | null
  readonly hotelLongitude: number | null
  readonly navigationUrl: string
  readonly time: string
  readonly pickup: boolean
  readonly deliveryZone: DeliveryZone
  readonly freeDelivery: boolean
  readonly status: string
  readonly group: string
  readonly meals: number
  readonly aricha: number
  readonly challot: number
  readonly salads: Readonly<Record<string, SaladDraftSelection>>
  readonly firsts: Readonly<Record<string, number>>
  readonly firstsNotes: Readonly<Record<string, string>>
  readonly heat: string
  readonly firstsNote: string
  readonly mains: Readonly<Record<string, number>>
  readonly mainsNotes: Readonly<Record<string, string>>
  readonly mainsNote: string
  readonly sides: Readonly<Record<string, number>>
  readonly sidesNotes: Readonly<Record<string, string>>
  readonly desserts: Readonly<Record<string, number>>
  readonly dessertsNotes: Readonly<Record<string, string>>
  readonly extras: Readonly<Record<string, ExtraDraftSelection>>
  readonly custom: readonly CustomDraftItem[]
  readonly lunch: Readonly<Record<string, LunchDraftSelection>>
  readonly notes: string
  readonly total: string
  readonly deposit: string
  readonly payMethod: string
  readonly paid: string
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function count(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  if (typeof value === 'string' && /^(?:0|[1-9]\d*)$/u.test(value)) {
    const parsed = Number(value)
    if (Number.isSafeInteger(parsed)) return parsed
  }
  return 0
}

function countOrFallback(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  if (typeof value === 'string' && /^(?:0|[1-9]\d*)$/u.test(value)) {
    const parsed = Number(value)
    if (Number.isSafeInteger(parsed)) return parsed
  }
  return fallback
}

function cloneJsonRecord(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) return {}
  return structuredClone(value)
}

function normalizeQuantityMap(value: unknown): Record<string, number> {
  const result: Record<string, number> = {}
  if (!isPlainRecord(value)) return result
  for (const [name, rawQuantity] of Object.entries(value)) {
    const quantity = count(rawQuantity)
    if (quantity > 0) result[name] = quantity
  }
  return result
}

function normalizeNoteMap(value: unknown): Record<string, string> {
  const result: Record<string, string> = {}
  if (!isPlainRecord(value)) return result
  for (const [name, rawNote] of Object.entries(value)) {
    const note = text(rawNote)
    if (note.trim().length > 0) result[name] = note
  }
  return result
}

function isValidLegacyCount(value: unknown): boolean {
  return (
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) ||
    (typeof value === 'string' && /^(?:0|[1-9]\d*)$/u.test(value) && Number.isSafeInteger(Number(value)))
  )
}

function hasValidQuantityMap(value: unknown): boolean {
  return value === undefined || (isPlainRecord(value) && Object.values(value).every(isValidLegacyCount))
}

function hasValidNoteMap(value: unknown): boolean {
  return value === undefined || (isPlainRecord(value) && Object.values(value).every((note) => typeof note === 'string'))
}

function hasValidStructuredSelections(
  value: unknown,
  validate: (selection: Record<string, unknown>) => boolean,
): boolean {
  return value === undefined || (
    isPlainRecord(value) &&
    Object.values(value).every((selection) => isPlainRecord(selection) && validate(selection))
  )
}

function isSafeHttpsUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 500) return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

export function legacyOrderEditIssue(order: LegacyOrder): string | null {
  if (![order.meals, order.aricha, order.challot].every((value) => value === undefined || isValidLegacyCount(value))) {
    return 'אחת מכמויות הבסיס נשמרה בפורמט שלא ניתן לערוך בלי לשנות אותה.'
  }
  if (![order.firsts, order.mains, order.sides, order.desserts].every(hasValidQuantityMap)) {
    return 'אחת מקבוצות המנות כוללת כמות ישנה שלא ניתן לשמר בבטחה.'
  }
  if (![order.firstsNotes, order.mainsNotes, order.sidesNotes, order.dessertsNotes].every(hasValidNoteMap)) {
    return 'אחת מהערות המנות נשמרה בפורמט לא תקין.'
  }
  if (!hasValidStructuredSelections(order.salads, (selection) =>
    ['o', 'ordered', 'p', 'gift'].every((key) => !Object.hasOwn(selection, key) || isValidLegacyCount(selection[key])) &&
    (!Object.hasOwn(selection, 'note') || typeof selection.note === 'string')
  )) return 'רשימת הסלטים כוללת ערך ישן שלא ניתן לשמר בבטחה.'
  if (!hasValidStructuredSelections(order.extras, (selection) =>
    ['q', 'quantity'].every((key) => !Object.hasOwn(selection, key) || isValidLegacyCount(selection[key])) &&
    (!Object.hasOwn(selection, 'note') || typeof selection.note === 'string')
  )) return 'רשימת האקסטרות כוללת ערך ישן שלא ניתן לשמר בבטחה.'
  if (order.custom !== undefined) {
    if (!Array.isArray(order.custom)) return 'רשימת הפריטים החופשיים אינה במבנה בטוח לעריכה.'
    for (const item of order.custom) {
      if (!isPlainRecord(item)) return 'רשימת הפריטים החופשיים כוללת ערך ישן שלא ניתן לשמר בבטחה.'
      if (Object.hasOwn(item, 'name') && typeof item.name !== 'string') return 'שם פריט חופשי נשמר בפורמט לא תקין.'
      if (!['qty', 'quantity'].every((key) => !Object.hasOwn(item, key) || isValidLegacyCount(item[key]))) return 'כמות פריט חופשי נשמרה בפורמט לא תקין.'
      if (!['price', 'unitPrice'].every((key) => !Object.hasOwn(item, key) || parseUsdInputMinorUnits(item[key]) !== null)) return 'מחיר פריט חופשי נשמר בפורמט לא תקין.'
      if (Object.hasOwn(item, 'note') && typeof item.note !== 'string') return 'הערת פריט חופשי נשמרה בפורמט לא תקין.'
    }
  }
  if (!hasValidStructuredSelections(order.lunch, (selection) =>
    ['q', 'quantity', 'addon', 'addonQuantity'].every((key) => !Object.hasOwn(selection, key) || isValidLegacyCount(selection[key])) &&
    ['v', 'variantKey', 'note'].every((key) => !Object.hasOwn(selection, key) || typeof selection[key] === 'string') &&
    (!Object.hasOwn(selection, 'sides') || hasValidQuantityMap(selection.sides))
  )) return 'רשימת הצהריים כוללת ערך ישן שלא ניתן לשמר בבטחה.'
  const hotelProviderId = order.hotelProviderId
  const hotelLatitude = order.hotelLatitude
  const hotelLongitude = order.hotelLongitude
  const hasProviderHotel = hotelProviderId !== undefined && hotelProviderId !== ''
  const hasLatitude = hotelLatitude !== undefined && hotelLatitude !== null
  const hasLongitude = hotelLongitude !== undefined && hotelLongitude !== null
  if (hasProviderHotel || hasLatitude || hasLongitude) {
    if (
      typeof hotelProviderId !== 'string' ||
      !HOTEL_PROVIDER_ID_PATTERN.test(hotelProviderId) ||
      typeof hotelLatitude !== 'number' ||
      !Number.isFinite(hotelLatitude) ||
      hotelLatitude < HOTEL_MINIMUM_LATITUDE ||
      hotelLatitude > HOTEL_MAXIMUM_LATITUDE ||
      typeof hotelLongitude !== 'number' ||
      !Number.isFinite(hotelLongitude) ||
      hotelLongitude < HOTEL_MINIMUM_LONGITUDE ||
      hotelLongitude > HOTEL_MAXIMUM_LONGITUDE
    ) return 'קואורדינטות המלון נשמרו בפורמט לא תקין.'
    if (
      !isSafeHttpsUrl(order.navigationUrl) ||
      order.navigationUrl !== coordinateNavigationUrl(hotelLatitude, hotelLongitude)
    ) return 'קישור הניווט של המלון אינו תואם לקואורדינטות השמורות.'
  }
  return null
}

function normalizeSalads(value: unknown): Record<string, SaladDraftSelection> {
  const result: Record<string, SaladDraftSelection> = {}
  if (!isPlainRecord(value)) return result
  for (const [name, rawSelection] of Object.entries(value)) {
    if (!isPlainRecord(rawSelection)) continue
    const ordered = count(rawSelection.o ?? rawSelection.ordered)
    const gift = count(rawSelection.p ?? rawSelection.gift)
    const note = text(rawSelection.note)
    const { o: _orderedLegacy, p: _giftLegacy, ordered: _ordered, gift: _gift, note: _note, ...unknown } = rawSelection
    if (ordered > 0 || gift > 0 || note.length > 0 || Object.keys(unknown).length > 0) {
      result[name] = { ...structuredClone(unknown), ordered, gift, note }
    }
  }
  return result
}

function normalizeExtras(value: unknown): Record<string, ExtraDraftSelection> {
  const result: Record<string, ExtraDraftSelection> = {}
  if (!isPlainRecord(value)) return result
  for (const [name, rawSelection] of Object.entries(value)) {
    if (!isPlainRecord(rawSelection)) continue
    const quantity = count(rawSelection.q ?? rawSelection.quantity)
    const note = text(rawSelection.note)
    const { q: _quantityLegacy, quantity: _quantity, note: _note, ...unknown } = rawSelection
    if (quantity > 0 || note.length > 0 || Object.keys(unknown).length > 0) {
      result[name] = { ...structuredClone(unknown), quantity, note }
    }
  }
  return result
}

function normalizeCustom(value: unknown): CustomDraftItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((rawItem) => {
    if (!isPlainRecord(rawItem)) return []
    const {
      qty: _quantityLegacy,
      quantity: _quantity,
      price: _priceLegacy,
      unitPrice: _unitPrice,
      name: _name,
      note: _note,
      ...unknown
    } = rawItem
    return [
      {
        ...structuredClone(unknown),
        name: text(rawItem.name),
        quantity: count(rawItem.qty ?? rawItem.quantity),
        unitPrice: String(rawItem.price ?? rawItem.unitPrice ?? ''),
        note: text(rawItem.note),
      },
    ]
  })
}

function normalizeLunch(value: unknown): Record<string, LunchDraftSelection> {
  const result: Record<string, LunchDraftSelection> = {}
  if (!isPlainRecord(value)) return result
  for (const [key, rawSelection] of Object.entries(value)) {
    if (!isPlainRecord(rawSelection)) continue
    const quantity = count(rawSelection.q ?? rawSelection.quantity)
    const addonQuantity = count(rawSelection.addon ?? rawSelection.addonQuantity)
    const sides = normalizeQuantityMap(rawSelection.sides)
    const note = text(rawSelection.note)
    const {
      q: _quantityLegacy,
      quantity: _quantity,
      v: _variantLegacy,
      variantKey: _variant,
      addon: _addonLegacy,
      addonQuantity: _addon,
      sides: _sides,
      note: _note,
      ...unknown
    } = rawSelection
    if (quantity > 0 || addonQuantity > 0 || Object.keys(sides).length > 0 || note.length > 0 || Object.keys(unknown).length > 0) {
      result[key] = {
        ...structuredClone(unknown),
        quantity,
        variantKey: text(rawSelection.v ?? rawSelection.variantKey),
        sides,
        addonQuantity,
        note,
      }
    }
  }
  return result
}

/**
 * The per-diner plates of a lunch selection, or null when the selection has
 * no valid plate breakdown (legacy orders, or a stale plates array whose
 * length no longer matches the quantity) — callers fall back to the pooled
 * legacy behaviour in that case, never to a guess.
 */
export function readLunchPlates(
  selection: LunchDraftSelection,
  item: LunchItem,
): readonly LunchPlateDraft[] | null {
  if (item.variants.length === 0 || selection.quantity < 1) return null
  const raw = selection.plates
  if (!Array.isArray(raw) || raw.length !== selection.quantity) return null
  const plates: LunchPlateDraft[] = []
  for (const value of raw) {
    if (!isPlainRecord(value)) return null
    plates.push({
      variantKey: text(value.variantKey ?? value.v) || item.variants[0]!.key,
      sides: normalizeQuantityMap(value.sides),
      note: text(value.note),
    })
  }
  return plates
}

export function mergedLunchPlateSides(
  plates: readonly LunchPlateDraft[],
): Record<string, number> {
  const merged: Record<string, number> = {}
  for (const plate of plates) {
    for (const [name, quantity] of Object.entries(plate.sides)) {
      if (quantity > 0) merged[name] = checkedAdd(merged[name] ?? 0, quantity, 'merged plate sides')
    }
  }
  return merged
}

/** Grows or shrinks the plates array to the requested count, keeping existing plates. */
export function resizeLunchPlates(
  plates: readonly LunchPlateDraft[] | null,
  quantity: number,
  defaultVariantKey: string,
): LunchPlateDraft[] {
  const next: LunchPlateDraft[] = []
  for (let index = 0; index < quantity; index += 1) {
    const existing = plates?.[index]
    next.push(
      existing ?? {
        variantKey: plates?.[plates.length - 1]?.variantKey ?? defaultVariantKey,
        sides: {},
        note: '',
      },
    )
  }
  return next
}

function dollarsNumberToMinorUnits(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback
  const minorUnits = Math.round(value * 100)
  return Number.isSafeInteger(minorUnits) ? minorUnits : fallback
}

function stringArray(value: unknown, fallback: readonly string[]): readonly string[] {
  if (!Array.isArray(value)) return [...fallback]
  return value.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0,
  )
}

function normalizeLunchMenu(value: unknown): readonly LunchItem[] {
  const saved = Array.isArray(value) ? value : []
  return DEFAULT_LUNCH.map((defaultItem) => {
    const rawItem = saved.find(
      (candidate) => isPlainRecord(candidate) && candidate.key === defaultItem.key,
    )
    if (!isPlainRecord(rawItem)) return structuredClone(defaultItem)
    const rawVariants = Array.isArray(rawItem.variants) ? rawItem.variants : []
    return {
      ...defaultItem,
      name: text(rawItem.name).trim() || defaultItem.name,
      priceMinorUnits:
        defaultItem.priceMinorUnits === null
          ? null
          : dollarsNumberToMinorUnits(rawItem.price, defaultItem.priceMinorUnits),
      variants: defaultItem.variants.map((defaultVariant) => {
        const rawVariant = rawVariants.find(
          (candidate) => isPlainRecord(candidate) && candidate.k === defaultVariant.key,
        )
        if (!isPlainRecord(rawVariant)) return { ...defaultVariant }
        return {
          ...defaultVariant,
          priceMinorUnits: dollarsNumberToMinorUnits(
            rawVariant.price,
            defaultVariant.priceMinorUnits,
          ),
          includedSides: count(rawVariant.includedSides ?? defaultVariant.includedSides),
          sidePriceMinorUnits: dollarsNumberToMinorUnits(
            rawVariant.sidePrice,
            defaultVariant.sidePriceMinorUnits,
          ),
        }
      }),
      addon:
        defaultItem.addon === null
          ? null
          : {
              ...defaultItem.addon,
              priceMinorUnits: dollarsNumberToMinorUnits(
                isPlainRecord(rawItem.addon) ? rawItem.addon.price : undefined,
                defaultItem.addon.priceMinorUnits,
              ),
            },
    }
  })
}

const DEFAULT_EXTRA_PRICE_MINOR_UNITS: ReadonlyMap<string, number> = new Map(
  DEFAULT_EXTRAS_DOLLARS.map(([name, price]) => [name, price * 100]),
)

// A stored extra's price is whatever the legacy store happens to hold, and
// it is not always a JS number — a legacy row keeps it as the string the
// operator once typed ("125"). Read it the way the menu editor already
// does (parseLegacyUsdAmount), then fall back to the kitchen's own price
// for that dish. The old code went straight to 0 on anything that was not
// a number, which is how a $125 סיר קובה סלק reached a saved order as a
// $0.00 line: silently priced, silently folded into the suggested total.
function menuExtraPriceMinorUnits(rawPrice: unknown, name: string): number | null {
  const parsed = parseLegacyUsdAmount(rawPrice)
  if (parsed.state === 'valid' && Number.isSafeInteger(parsed.minorUnits)) return parsed.minorUnits
  return DEFAULT_EXTRA_PRICE_MINOR_UNITS.get(name) ?? null
}

export function buildOrderEditorMenu(store: LegacyStore): OrderEditorMenu {
  const rawMenu = isPlainRecord(store.menu) ? store.menu : {}
  const rawExtras = Array.isArray(rawMenu.extras) ? rawMenu.extras : []
  const extras = rawExtras.flatMap((rawExtra): MenuExtra[] => {
    if (!isPlainRecord(rawExtra) || typeof rawExtra.name !== 'string' || !rawExtra.name.trim()) {
      return []
    }
    if (isAutomaticChargeName(rawExtra.name)) return []
    return [
      {
        name: rawExtra.name,
        priceMinorUnits: menuExtraPriceMinorUnits(rawExtra.price, rawExtra.name),
      },
    ]
  })

  return {
    salads: stringArray(rawMenu.salads, DEFAULT_MENU_CATEGORIES.salads),
    firsts: [...DEFAULT_MENU_CATEGORIES.firsts],
    mains: stringArray(rawMenu.mains, DEFAULT_MENU_CATEGORIES.mains),
    sides: stringArray(rawMenu.sides, DEFAULT_MENU_CATEGORIES.sides),
    desserts: stringArray(rawMenu.desserts, DEFAULT_MENU_CATEGORIES.desserts),
    extras:
      Array.isArray(rawMenu.extras)
        ? extras
        : DEFAULT_EXTRAS_DOLLARS.map(([name, price]) => ({
            name,
            priceMinorUnits: price * 100,
          })),
    lunch: normalizeLunchMenu(rawMenu.lunch),
    lunchSides: stringArray(rawMenu.lunchSides, [
      'אורז לבן',
      'פסטה אדומה',
      'פסטה נקיה',
    ]),
    couplePriceMinorUnits: dollarsNumberToMinorUnits(
      rawMenu.couplePrice,
      DEFAULT_COUPLE_PRICE_MINOR_UNITS,
    ),
    challahPriceMinorUnits: dollarsNumberToMinorUnits(
      rawMenu.challahPrice,
      DEFAULT_CHALLAH_PRICE_MINOR_UNITS,
    ),
    includedChallahs: countOrFallback(rawMenu.includedChallot, 2),
    saladBlockPriceMinorUnits: dollarsNumberToMinorUnits(
      rawMenu.saladBlockPrice,
      EXTRA_SALAD_BLOCK_PRICE_MINOR_UNITS,
    ),
    saladRemainderPriceMinorUnits: dollarsNumberToMinorUnits(
      rawMenu.saladUnitPrice,
      EXTRA_SALAD_SINGLE_PRICE_MINOR_UNITS,
    ),
    extraFishFilletPriceMinorUnits: dollarsNumberToMinorUnits(
      rawMenu.fishExtraPrice,
      EXTRA_FILLET_UNIT_PRICE_MINOR_UNITS,
    ),
    extraDessertHalfUnitMinorUnits: dollarsNumberToMinorUnits(rawMenu.dessertExtraPrice, 0),
    extraMainPriceMinorUnits: dollarsNumberToMinorUnits(
      rawMenu.mainExtraPrice,
      DEFAULT_EXTRA_MAIN_PRICE_MINOR_UNITS,
    ),
  }
}

export function nextFridayIso(now: Date = new Date()): string {
  if (!Number.isFinite(now.getTime())) throw new RangeError('now must be a valid Date')
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Dubai',
  }).formatToParts(now)
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value
    if (value === undefined || !/^\d+$/u.test(value)) {
      throw new RangeError(`Unable to resolve ${type} in Asia/Dubai`)
    }
    return Number(value)
  }
  const date = new Date(Date.UTC(read('year'), read('month') - 1, read('day')))
  const daysUntilFriday = (5 - date.getUTCDay() + 7) % 7
  date.setUTCDate(date.getUTCDate() + daysUntilFriday)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

export function createOrderDraft(menu: OrderEditorMenu, now: Date = new Date()): OrderDraft {
  return {
    id: null,
    date: nextFridayIso(now),
    name: '',
    phone: '',
    email: '',
    place: '',
    address: '',
    hotelName: '',
    hotelProviderId: '',
    hotelAddress: '',
    hotelLatitude: null,
    hotelLongitude: null,
    navigationUrl: '',
    time: '',
    pickup: false,
    deliveryZone: 'dubai',
    freeDelivery: false,
    status: 'חדשה',
    group: '',
    meals: 1,
    aricha: 0,
    challot: menu.includedChallahs,
    salads: {},
    firsts: {},
    firstsNotes: {},
    heat: '',
    firstsNote: '',
    mains: {},
    mainsNotes: {},
    mainsNote: '',
    sides: {},
    sidesNotes: {},
    desserts: {},
    dessertsNotes: {},
    extras: {},
    custom: [],
    lunch: {},
    notes: '',
    total: '',
    deposit: '',
    payMethod: '',
    paid: 'לא',
  }
}

export function createOrderDraftFromLegacy(
  order: LegacyOrder,
  menu: OrderEditorMenu,
  now: Date = new Date(),
): OrderDraft {
  const editIssue = legacyOrderEditIssue(order)
  if (editIssue !== null) throw new Error(editIssue)
  const raw = cloneJsonRecord(order)
  const defaults = createOrderDraft(menu, now)
  return {
    ...defaults,
    ...raw,
    id:
      typeof order.id === 'string' || typeof order.id === 'number' || order.id === null
        ? order.id
        : null,
    date: text(order.date) || defaults.date,
    name: text(order.name),
    phone: text(order.phone),
    email: text(order.email),
    place: text(order.place),
    address: text(order.address),
    hotelName: text(raw.hotelName) || text(order.place),
    hotelProviderId: text(raw.hotelProviderId),
    hotelAddress: Object.hasOwn(raw, 'hotelAddress') ? text(raw.hotelAddress) : text(order.address),
    hotelLatitude: typeof raw.hotelLatitude === 'number' ? raw.hotelLatitude : null,
    hotelLongitude: typeof raw.hotelLongitude === 'number' ? raw.hotelLongitude : null,
    navigationUrl: text(raw.navigationUrl),
    time: text(order.time),
    pickup: order.pickup === true,
    deliveryZone: isDeliveryZone(raw.deliveryZone) ? raw.deliveryZone : 'dubai',
    freeDelivery: raw.freeDelivery === true,
    status: text(order.status) || 'חדשה',
    group: text(order.group),
    meals: countOrFallback(order.meals, defaults.meals),
    aricha: countOrFallback(order.aricha, defaults.aricha),
    challot: countOrFallback(order.challot, defaults.challot),
    salads: normalizeSalads(order.salads),
    firsts: normalizeQuantityMap(order.firsts),
    firstsNotes: normalizeNoteMap(order.firstsNotes),
    heat: text(order.heat),
    firstsNote: text(order.firstsNote),
    mains: normalizeQuantityMap(order.mains),
    mainsNotes: normalizeNoteMap(order.mainsNotes),
    mainsNote: text(order.mainsNote),
    sides: normalizeQuantityMap(order.sides),
    sidesNotes: normalizeNoteMap(order.sidesNotes),
    desserts: normalizeQuantityMap(order.desserts),
    dessertsNotes: normalizeNoteMap(order.dessertsNotes),
    extras: normalizeExtras(order.extras),
    custom: normalizeCustom(order.custom),
    lunch: normalizeLunch(order.lunch),
    notes: text(order.notes),
    total: String(order.total ?? ''),
    deposit: String(order.deposit ?? ''),
    payMethod: text(order.payMethod),
    paid: text(order.paid) || 'לא',
  }
}

export function applyHotelSelection(
  draft: OrderDraft,
  hotelSelection: string | HotelSearchResult | HotelOption,
): OrderDraft {
  const hotel = typeof hotelSelection === 'string'
    ? HOTEL_OPTIONS.find((candidate) => candidate.name === hotelSelection.trim())
    : hotelSelection
  if (!hotel) {
    const hotelName = typeof hotelSelection === 'string' ? hotelSelection : ''
    return applyHotelDestinationInput(draft, hotelName)
  }
  const providerHotel = 'id' in hotel ? hotel : null
  const previousGeneratedNavigation =
    draft.hotelLatitude !== null && draft.hotelLongitude !== null
      ? coordinateNavigationUrl(draft.hotelLatitude, draft.hotelLongitude)
      : HOTEL_OPTIONS.find((candidate) => candidate.name === draft.hotelName)?.navigationUrl
  const changedHotelIdentity = hotel.name.trim() !== draft.hotelName.trim()
  const replaceAddress = draft.address === '' || draft.address === draft.hotelAddress
  const replaceNavigation =
    changedHotelIdentity ||
    draft.navigationUrl === '' ||
    draft.navigationUrl === previousGeneratedNavigation
  const retainProviderIdentity = providerHotel !== null && replaceNavigation
  return {
    ...draft,
    place: hotel.name,
    hotelName: hotel.name,
    hotelProviderId: retainProviderIdentity ? providerHotel.id : '',
    address: replaceAddress ? hotel.fullAddress : draft.address,
    hotelAddress: hotel.fullAddress,
    hotelLatitude: retainProviderIdentity ? providerHotel.latitude : null,
    hotelLongitude: retainProviderIdentity ? providerHotel.longitude : null,
    navigationUrl: replaceNavigation ? hotel.navigationUrl : draft.navigationUrl,
  }
}

export function applyHotelDestinationInput(draft: OrderDraft, hotelName: string): OrderDraft {
  const changedSelection = hotelName.trim() !== draft.hotelName.trim()
  const generatedAddress = draft.address === '' || draft.address === draft.hotelAddress
  return {
    ...draft,
    place: hotelName,
    hotelName,
    hotelProviderId: changedSelection ? '' : draft.hotelProviderId,
    hotelAddress: changedSelection ? '' : draft.hotelAddress,
    hotelLatitude: changedSelection ? null : draft.hotelLatitude,
    hotelLongitude: changedSelection ? null : draft.hotelLongitude,
    address: changedSelection && generatedAddress ? '' : draft.address,
    navigationUrl: changedSelection ? '' : draft.navigationUrl,
  }
}

export function applyHotelNavigationInput(draft: OrderDraft, navigationUrl: string): OrderDraft {
  const replacesProviderNavigation = draft.hotelProviderId !== '' && navigationUrl !== draft.navigationUrl
  return {
    ...draft,
    navigationUrl,
    hotelProviderId: replacesProviderNavigation ? '' : draft.hotelProviderId,
    hotelLatitude: replacesProviderNavigation ? null : draft.hotelLatitude,
    hotelLongitude: replacesProviderNavigation ? null : draft.hotelLongitude,
  }
}

export function createDuplicateOrderDraft(
  order: LegacyOrder,
  menu: OrderEditorMenu,
  now: Date = new Date(),
): OrderDraft {
  const source = createOrderDraftFromLegacy(order, menu, now)
  return {
    ...source,
    id: null,
    date: nextFridayIso(now),
    status: 'חדשה',
    deposit: '',
    paid: 'לא',
  }
}

export function parseUsdInputMinorUnits(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null
    const stringValue = String(value)
    return parseUsdInputMinorUnits(stringValue)
  }
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  const match = normalized.match(/^(?:0|[1-9]\d*)(?:\.(\d{1,2}))?$/u)
  if (!match) return null
  const [whole, fraction = ''] = normalized.split('.')
  const minorUnits = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'))
  return minorUnits <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minorUnits) : null
}

export function formatUsdInputMinorUnits(minorUnits: number): string {
  const exactMinorUnits = requireNonNegativeSafeInteger(minorUnits, 'USD input minor units')
  const value = BigInt(exactMinorUnits)
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`
}

function sumCounts(values: readonly number[], label: string): number {
  return values.reduce((total, value) => checkedAdd(total, value, label), 0)
}

export interface DessertAllowance {
  readonly souffleQuantity: number
  readonly baklavaQuantity: number
  readonly unclassifiedQuantity: number
  readonly selectedHalfUnits: number
  readonly includedHalfUnits: number
  readonly excessHalfUnits: number
}

export function calculateDessertAllowance(draft: OrderDraft): DessertAllowance {
  let souffleQuantity = 0
  let baklavaQuantity = 0
  let unclassifiedQuantity = 0
  for (const [name, quantity] of Object.entries(draft.desserts)) {
    const kind = classifyDessertKind(name)
    if (kind === 'souffle') souffleQuantity = checkedAdd(souffleQuantity, quantity)
    else if (kind === 'baklava') baklavaQuantity = checkedAdd(baklavaQuantity, quantity)
    else unclassifiedQuantity = checkedAdd(unclassifiedQuantity, quantity)
  }
  const selectedHalfUnits = checkedAdd(
    checkedMultiply(souffleQuantity, SOUFFLE_HALF_UNITS_PER_PORTION, 'souffle allowance units'),
    checkedMultiply(baklavaQuantity, BAKLAVA_HALF_UNITS_PER_PORTION, 'baklava allowance units'),
    'dessert allowance units',
  )
  const includedHalfUnits = checkedMultiply(
    draft.meals,
    DESSERT_HALF_UNITS_INCLUDED_PER_MEAL,
    'included dessert units',
  )
  return {
    souffleQuantity,
    baklavaQuantity,
    unclassifiedQuantity,
    selectedHalfUnits,
    includedHalfUnits,
    excessHalfUnits: Math.max(0, selectedHalfUnits - includedHalfUnits),
  }
}

export interface DraftIssue {
  readonly code:
    | 'MISSING_DATE'
    | 'INVALID_DATE'
    | 'MISSING_NAME'
    | 'INVALID_TOTAL'
    | 'INVALID_DEPOSIT'
    | 'TOTAL_MISMATCH'
    | 'DEPOSIT_EXCEEDS_TOTAL'
    | 'INVALID_CUSTOM_ITEM'
    | 'RESERVED_CUSTOM_ITEM'
    | 'UNKNOWN_LUNCH_VARIANT'
    | 'WEEKDAY_LUNCH_CHALLAH'
    | 'SIDE_OVERAGE'
    | 'MIXED_LUNCH_SHABBAT_UNCONFIRMED'
    | 'DESSERT_OVERAGE'
    | 'DESSERT_UNCLASSIFIED'
    | 'UNPRICED_EXTRA'
    | 'PRICING_ERROR'
  readonly message: string
  readonly blocking: boolean
}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function isWeekendDate(value: string): boolean {
  if (!validIsoDate(value)) return false
  const day = new Date(`${value}T00:00:00Z`).getUTCDay()
  return day === 5 || day === 6
}

export interface DraftPricing {
  readonly result: OrderTotalResult | null
  readonly issues: readonly DraftIssue[]
  readonly dessert: DessertAllowance
}

export interface DraftPricingOptions {
  readonly allowMixedLunchAndShabbat?: boolean
}

export type DraftSelectionMode = 'empty' | 'shabbat' | 'lunch' | 'mixed'

function recordHasPositiveQuantity(record: Readonly<Record<string, number>>): boolean {
  return Object.values(record).some((quantity) => quantity > 0)
}

export function classifyDraftSelectionMode(draft: OrderDraft): DraftSelectionMode {
  const hasLunch = Object.values(draft.lunch).some((selection) =>
    selection.quantity > 0 ||
    selection.addonQuantity > 0 ||
    recordHasPositiveQuantity(selection.sides)
  )
  const hasShabbat =
    draft.meals > 0 ||
    draft.challot > 0 ||
    Object.values(draft.salads).some((selection) => selection.ordered > 0 || selection.gift > 0) ||
    recordHasPositiveQuantity(draft.firsts) ||
    recordHasPositiveQuantity(draft.mains) ||
    recordHasPositiveQuantity(draft.sides) ||
    recordHasPositiveQuantity(draft.desserts)

  if (hasLunch && hasShabbat) return 'mixed'
  if (hasLunch) return 'lunch'
  if (hasShabbat) return 'shabbat'
  return 'empty'
}

export function applyCoupleMealQuantity(
  draft: OrderDraft,
  menu: OrderEditorMenu,
  meals: number,
): OrderDraft {
  const nextMeals = requireNonNegativeSafeInteger(meals, 'couple meals')
  const previousAutomaticChallahs = checkedMultiply(
    menu.includedChallahs,
    draft.meals,
    'previous automatic challahs',
  )
  const nextAutomaticChallahs = checkedMultiply(
    menu.includedChallahs,
    nextMeals,
    'next automatic challahs',
  )
  return {
    ...draft,
    meals: nextMeals,
    challot:
      draft.challot === previousAutomaticChallahs
        ? nextAutomaticChallahs
        : draft.challot,
  }
}

export function calculateOrderDraftPricing(
  draft: OrderDraft,
  menu: OrderEditorMenu,
  options: DraftPricingOptions = {},
): DraftPricing {
  const issues: DraftIssue[] = []
  const chargeLines: ChargeLineInput[] = []

  if (
    classifyDraftSelectionMode(draft) === 'mixed' &&
    options.allowMixedLunchAndShabbat !== true
  ) {
    issues.push({
      code: 'MIXED_LUNCH_SHABBAT_UNCONFIRMED',
      message: 'נבחרו יחד פריטי שבת וצהריים. יש לאשר במפורש שזו הזמנה משולבת לפני השמירה.',
      blocking: true,
    })
  }

  // Extra mains beyond the meal's included one are now a confirmed, priced
  // upsell ($100/unit, like fish and salads) — not a blocked state. Sides
  // stay blocked below: no confirmed extra-side price exists yet.
  const includedMains = checkedMultiply(draft.meals, MAINS_INCLUDED_PER_MEAL, 'included mains')
  const selectedMains = sumCounts(Object.values(draft.mains), 'selected mains')
  const extraMains = Math.max(0, selectedMains - includedMains)
  const includedSides = checkedMultiply(draft.meals, SIDES_INCLUDED_PER_MEAL, 'included sides')
  const selectedSides = sumCounts(Object.values(draft.sides), 'selected Shabbat sides')
  if (selectedSides > includedSides) {
    issues.push({
      code: 'SIDE_OVERAGE',
      message: 'נבחרו יותר תוספות שבת ממספר הארוחות הזוגיות. אין מחיר מאושר לחריגה ולכן אי אפשר לשמור.',
      blocking: true,
    })
  }

  for (const extra of menu.extras) {
    const selection = draft.extras[extra.name]
    if (!selection || selection.quantity <= 0) continue
    // An extra nobody can price must never quietly contribute $0 to the
    // total — that reads as "this dish is free", and the suggested total
    // the operator saves is simply short by its price.
    if (extra.priceMinorUnits === null) {
      issues.push({
        code: 'UNPRICED_EXTRA',
        message: `אין מחיר מאושר ל${extra.name} בתפריט. יש לקבוע לו מחיר בעורך התפריט לפני השמירה.`,
        blocking: true,
      })
      continue
    }
    chargeLines.push({
      source: 'legacy-extra',
      name: extra.name,
      quantity: selection.quantity,
      unitPriceMinorUnits: extra.priceMinorUnits,
    })
  }

  draft.custom.forEach((item, index) => {
    if (item.quantity === 0 && item.name.trim().length === 0 && item.unitPrice.trim().length === 0) return
    const unitPriceMinorUnits = parseUsdInputMinorUnits(item.unitPrice)
    if (item.name.trim().length === 0 || item.quantity < 1 || unitPriceMinorUnits === null) {
      issues.push({
        code: 'INVALID_CUSTOM_ITEM',
        message: `פריט חופשי ${index + 1} חסר שם, כמות או מחיר תקין.`,
        blocking: true,
      })
      return
    }
    if (isAutomaticChargeName(item.name)) {
      issues.push({
        code: 'RESERVED_CUSTOM_ITEM',
        message: `הפריט החופשי ${item.name.trim()} מחושב אוטומטית ואסור להוסיף אותו שוב.`,
        blocking: true,
      })
      return
    }
    chargeLines.push({
      source: 'custom',
      name: item.name.trim(),
      quantity: item.quantity,
      unitPriceMinorUnits,
    })
  })

  for (const item of menu.lunch) {
    const selection = draft.lunch[item.key]
    if (!selection || selection.quantity < 1) continue

    const plates = readLunchPlates(selection, item)
    if (plates !== null) {
      const plateVariants: LunchVariant[] = []
      let unknownVariant = false
      for (const plate of plates) {
        const variant = item.variants.find((candidate) => candidate.key === plate.variantKey)
        if (variant === undefined) {
          unknownVariant = true
          break
        }
        plateVariants.push(variant)
      }
      if (unknownVariant) {
        issues.push({
          code: 'UNKNOWN_LUNCH_VARIANT',
          message: `הווריאציה של ${item.name} אינה קיימת בתפריט.`,
          blocking: true,
        })
        continue
      }
      if (plateVariants.some((variant) => variant.weekendOnly) && !isWeekendDate(draft.date)) {
        issues.push({
          code: 'WEEKDAY_LUNCH_CHALLAH',
          message: 'חלת שניצל זמינה בסוף השבוע בלבד.',
          blocking: false,
        })
      }
      for (const variant of item.variants) {
        const plateCount = plateVariants.filter((candidate) => candidate.key === variant.key).length
        if (plateCount === 0) continue
        chargeLines.push({
          source: 'lunch',
          name: `${item.name} (${variant.label})`,
          quantity: plateCount,
          unitPriceMinorUnits: variant.priceMinorUnits,
        })
      }
      if (item.sideChoice) {
        // Sides pool across the plates of one item, exactly like the legacy
        // single-selection behaviour: a family plate's unused included side
        // may cover a single plate's extra one.
        const totalSides = sumCounts(
          plates.map((plate) => sumCounts(Object.values(plate.sides), 'lunch plate sides')),
          'lunch sides',
        )
        const includedSides = plateVariants.reduce(
          (total, variant) => checkedAdd(total, variant.includedSides, 'included lunch sides'),
          0,
        )
        const excessSides = Math.max(0, totalSides - includedSides)
        if (excessSides > 0) {
          chargeLines.push({
            source: 'lunch',
            name: `תוספות ל${item.name}`,
            quantity: excessSides,
            unitPriceMinorUnits: Math.max(
              ...plateVariants.map((variant) => variant.sidePriceMinorUnits),
            ),
          })
        }
      }
      if (item.addon && selection.addonQuantity > 0) {
        chargeLines.push({
          source: 'lunch',
          name: `${item.addon.name} (ל${item.name})`,
          quantity: selection.addonQuantity,
          unitPriceMinorUnits: item.addon.priceMinorUnits,
        })
      }
      continue
    }

    let unitPriceMinorUnits = item.priceMinorUnits
    let selectedVariant: LunchVariant | undefined
    if (item.variants.length > 0) {
      selectedVariant = item.variants.find(
        (variant) => variant.key === (selection.variantKey || item.variants[0]?.key),
      )
      if (!selectedVariant) {
        issues.push({
          code: 'UNKNOWN_LUNCH_VARIANT',
          message: `הווריאציה של ${item.name} אינה קיימת בתפריט.`,
          blocking: true,
        })
        continue
      }
      unitPriceMinorUnits = selectedVariant.priceMinorUnits
      if (selectedVariant.weekendOnly && !isWeekendDate(draft.date)) {
        issues.push({
          code: 'WEEKDAY_LUNCH_CHALLAH',
          message: 'חלת שניצל זמינה בסוף השבוע בלבד.',
          blocking: false,
        })
      }
    }
    if (unitPriceMinorUnits !== null) {
      chargeLines.push({
        source: 'lunch',
        name: selectedVariant ? `${item.name} (${selectedVariant.label})` : item.name,
        quantity: selection.quantity,
        unitPriceMinorUnits,
      })
    }
    if (item.sideChoice && selectedVariant) {
      const selectedSides = sumCounts(Object.values(selection.sides), 'lunch sides')
      const includedSides = checkedMultiply(
        selectedVariant.includedSides,
        selection.quantity,
        'included lunch sides',
      )
      const excessSides = Math.max(0, selectedSides - includedSides)
      if (excessSides > 0) {
        chargeLines.push({
          source: 'lunch',
          name: `תוספות ל${item.name}`,
          quantity: excessSides,
          unitPriceMinorUnits: selectedVariant.sidePriceMinorUnits,
        })
      }
    }
    if (item.addon && selection.addonQuantity > 0) {
      chargeLines.push({
        source: 'lunch',
        name: `${item.addon.name} (ל${item.name})`,
        quantity: selection.addonQuantity,
        unitPriceMinorUnits: item.addon.priceMinorUnits,
      })
    }
  }

  if (!draft.pickup) {
    chargeLines.push({
      source: 'delivery',
      name: DELIVERY_EXTRA_NAME,
      quantity: 1,
      unitPriceMinorUnits: draft.freeDelivery ? 0 : DELIVERY_PRICE_MINOR_UNITS[draft.deliveryZone],
    })
  }

  const includedChallahs = checkedMultiply(
    menu.includedChallahs,
    draft.meals,
    'included challahs',
  )
  const extraChallahs = Math.max(0, draft.challot - includedChallahs)
  if (extraChallahs > 0) {
    chargeLines.push({
      source: 'other',
      name: 'חלות נוספות',
      quantity: extraChallahs,
      unitPriceMinorUnits: menu.challahPriceMinorUnits,
    })
  }

  if (extraMains > 0) {
    chargeLines.push({
      source: 'other',
      name: 'עיקרית נוספת',
      quantity: extraMains,
      unitPriceMinorUnits: menu.extraMainPriceMinorUnits,
    })
  }

  const orderedSalads = sumCounts(
    Object.values(draft.salads).map((selection) => selection.ordered),
    'ordered salads',
  )
  const giftSalads = sumCounts(
    Object.values(draft.salads).map((selection) => selection.gift),
    'gift salads',
  )
  const dessert = calculateDessertAllowance(draft)
  if (dessert.excessHalfUnits > 0) {
    chargeLines.push({
      source: 'other',
      name: 'קינוח נוסף',
      quantity: dessert.excessHalfUnits,
      unitPriceMinorUnits: menu.extraDessertHalfUnitMinorUnits,
    })
  }
  if (dessert.unclassifiedQuantity > 0) {
    issues.push({
      code: 'DESSERT_UNCLASSIFIED',
      message: 'יש קינוח שאי אפשר לשייך בבטחה לזכאות.',
      blocking: true,
    })
  }

  try {
    return {
      result: calculateOrderTotal({
        coupleMeals: draft.meals,
        coupleMealUnitPriceMinorUnits: menu.couplePriceMinorUnits,
        fishQuantities: draft.firsts,
        orderedSalads,
        giftSalads,
        chargeLines,
        extraFilletPriceMinorUnits: menu.extraFishFilletPriceMinorUnits,
        saladBlockPriceMinorUnits: menu.saladBlockPriceMinorUnits,
        saladRemainderPriceMinorUnits: menu.saladRemainderPriceMinorUnits,
      }),
      issues,
      dessert,
    }
  } catch {
    return {
      result: null,
      issues: [
        ...issues,
        {
          code: 'PRICING_ERROR',
          message: 'אי אפשר לחשב מחיר בטוח עד שהכמויות יתוקנו.',
          blocking: true,
        },
      ],
      dessert,
    }
  }
}

// Issues that only mean "the ENGINE cannot price this" (an overage with no
// approved price, an unpriceable dessert, a computation failure). When the
// operator typed an explicit manual total, that total IS the price — these
// stop blocking the save and become visible warnings instead (Moshe,
// 2026-08-18: a manually set price must always win). Data-integrity issues
// (bad quantities, unknown variants, reserved items) are NOT in this list
// and always block.
export const PRICE_AVAILABILITY_ISSUE_CODES: ReadonlySet<string> = new Set([
  'SIDE_OVERAGE',
  'DESSERT_UNCLASSIFIED',
  'PRICING_ERROR',
])

export function hasValidManualTotal(draft: OrderDraft): boolean {
  return draft.total.trim() !== '' && parseUsdInputMinorUnits(draft.total) !== null
}

// computedTotalMinorUnits distinguishes a DELIBERATE manual price from the
// auto-filled default: a total equal to the engine's own suggestion is not a
// manual pricing decision, so it never unblocks an unpriced overage.
export function demotePriceAvailabilityIssues(
  issues: readonly DraftIssue[],
  draft: OrderDraft,
  computedTotalMinorUnits: number | null = null,
): readonly DraftIssue[] {
  if (!hasValidManualTotal(draft)) return issues
  if (
    computedTotalMinorUnits !== null &&
    parseUsdInputMinorUnits(draft.total) === computedTotalMinorUnits
  ) {
    return issues
  }
  return issues.map((issue) =>
    issue.blocking && PRICE_AVAILABILITY_ISSUE_CODES.has(issue.code)
      ? {
          ...issue,
          blocking: false,
          message: `${issue.message.replace(' ולכן אי אפשר לשמור', '')} נקבע מחיר ידני, וההזמנה נשמרת עם המחיר שהוקלד.`,
        }
      : issue,
  )
}

export function orderPricingFingerprint(draft: OrderDraft): string {
  return JSON.stringify({
    meals: draft.meals,
    challot: draft.challot,
    pickup: draft.pickup,
    deliveryZone: draft.deliveryZone,
    freeDelivery: draft.freeDelivery,
    salads: draft.salads,
    firsts: draft.firsts,
    mains: draft.mains,
    sides: draft.sides,
    desserts: draft.desserts,
    extras: draft.extras,
    custom: draft.custom,
    lunch: draft.lunch,
  })
}

export function validateOrderDraft(
  draft: OrderDraft,
  expectedTotalMinorUnits?: number,
): readonly DraftIssue[] {
  const issues: DraftIssue[] = []
  if (!draft.date) issues.push({ code: 'MISSING_DATE', message: 'חסר תאריך הזמנה.', blocking: true })
  else if (!validIsoDate(draft.date)) {
    issues.push({ code: 'INVALID_DATE', message: 'תאריך ההזמנה אינו תקין.', blocking: true })
  }
  if (!draft.name.trim()) {
    issues.push({ code: 'MISSING_NAME', message: 'חסר שם לקוח.', blocking: true })
  }
  const totalMinorUnits = parseUsdInputMinorUnits(draft.total)
  if (draft.total.trim() === '' || totalMinorUnits === null) {
    issues.push({ code: 'INVALID_TOTAL', message: 'צריך לאשר את המחיר המחושב לפני השמירה.', blocking: true })
  } else if (
    expectedTotalMinorUnits !== undefined &&
    totalMinorUnits !== expectedTotalMinorUnits
  ) {
    issues.push({ code: 'TOTAL_MISMATCH', message: 'סך התשלום שונה מהמחיר המחושב — התאמה ידנית.', blocking: false })
  }
  const depositMinorUnits = draft.deposit.trim() ? parseUsdInputMinorUnits(draft.deposit) : 0
  if (depositMinorUnits === null) {
    issues.push({ code: 'INVALID_DEPOSIT', message: 'המקדמה אינה תקינה.', blocking: true })
  } else if (totalMinorUnits !== null && depositMinorUnits > totalMinorUnits) {
    issues.push({ code: 'DEPOSIT_EXCEEDS_TOTAL', message: 'המקדמה לא יכולה להיות גבוהה מסך התשלום.', blocking: true })
  }
  return issues
}

export const CANONICAL_ORDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const MAX_ORDER_ID_ATTEMPTS = 32

function browserRandomUuid(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('Secure UUID generation is unavailable.')
  }
  return globalThis.crypto.randomUUID()
}

export function createCanonicalOrderId(
  store: Readonly<LegacyStore>,
  randomUuid: () => string = browserRandomUuid,
): string {
  const existingIds = new Set(store.orders.map((order) => String(order.id)))
  for (let attempt = 0; attempt < MAX_ORDER_ID_ATTEMPTS; attempt += 1) {
    const uuid = randomUuid()
    if (!UUID_PATTERN.test(uuid)) continue
    const candidate = `order-${uuid.toLowerCase()}`
    if (CANONICAL_ORDER_ID_PATTERN.test(candidate) && !existingIds.has(candidate)) {
      return candidate
    }
  }
  throw new Error('Could not generate a collision-free order ID.')
}

export type StoredOrderIdStatus = 'safe' | 'unsafe' | 'collision'

export function classifyStoredOrderIds(orders: readonly LegacyOrder[]): StoredOrderIdStatus {
  const collisionKeys = new Set<string>()
  for (const order of orders) {
    const collisionKey = String(order.id)
    if (collisionKeys.has(collisionKey)) return 'collision'
    collisionKeys.add(collisionKey)
  }
  for (const order of orders) {
    if (typeof order.id !== 'string' || !CANONICAL_ORDER_ID_PATTERN.test(order.id)) {
      return 'unsafe'
    }
  }
  return 'safe'
}

function assertCanonicalStoredOrderIds(orders: readonly LegacyOrder[]): void {
  const status = classifyStoredOrderIds(orders)
  if (status === 'collision') throw new Error('The loaded state contains duplicate order IDs.')
  if (status === 'unsafe') throw new Error('The loaded state contains an unsafe order ID.')
}

function canonicalOptionalUsd(value: string, fieldName: string): string {
  if (value.trim().length === 0) return ''
  const minorUnits = parseUsdInputMinorUnits(value)
  if (minorUnits === null) throw new Error(`${fieldName} is not valid USD input.`)
  return formatUsdInputMinorUnits(minorUnits)
}

function serializeSalads(
  selections: OrderDraft['salads'],
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {}
  for (const [name, selection] of Object.entries(selections)) {
    const { ordered, gift, note: rawNote, o: _ordered, p: _gift, ...unknown } = selection
    const note = text(rawNote)
    if (ordered > 0 || gift > 0 || note.trim().length > 0 || Object.keys(unknown).length > 0) {
      result[name] = { ...unknown, o: ordered, p: gift, note }
    }
  }
  return result
}

function serializeExtras(
  selections: OrderDraft['extras'],
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {}
  for (const [name, selection] of Object.entries(selections)) {
    const { quantity, note, q: _quantity, ...unknown } = selection
    if (quantity > 0 || note.trim().length > 0 || Object.keys(unknown).length > 0) {
      result[name] = { ...unknown, q: quantity, note }
    }
  }
  return result
}

function serializeCustom(items: OrderDraft['custom']): Record<string, unknown>[] {
  return items.map((item) => {
    const {
      quantity,
      unitPrice,
      qty: _quantity,
      price: _price,
      ...unknown
    } = item
    return {
      ...unknown,
      qty: quantity,
      price: canonicalOptionalUsd(unitPrice, 'custom item price'),
    }
  })
}

function serializeLunch(
  selections: OrderDraft['lunch'],
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {}
  for (const [key, selection] of Object.entries(selections)) {
    const {
      quantity,
      variantKey,
      sides,
      addonQuantity,
      note: rawNote,
      q: _quantity,
      v: _variant,
      addon: _addon,
      ...unknown
    } = selection
    const note = text(rawNote)
    if (quantity > 0 || addonQuantity > 0 || Object.keys(sides).length > 0 || note.trim().length > 0 || Object.keys(unknown).length > 0) {
      result[key] = {
        ...unknown,
        q: quantity,
        v: variantKey,
        sides: structuredClone(sides),
        addon: addonQuantity,
        note,
      }
    }
  }
  return result
}

export function serializeOrderDraft(draft: OrderDraft, orderId: string): LegacyOrder {
  if (!CANONICAL_ORDER_ID_PATTERN.test(orderId)) throw new Error('Order ID is not canonical.')
  if (draft.hotelProviderId) {
    if (
      !HOTEL_PROVIDER_ID_PATTERN.test(draft.hotelProviderId) ||
      typeof draft.hotelLatitude !== 'number' ||
      !Number.isFinite(draft.hotelLatitude) ||
      draft.hotelLatitude < HOTEL_MINIMUM_LATITUDE ||
      draft.hotelLatitude > HOTEL_MAXIMUM_LATITUDE ||
      typeof draft.hotelLongitude !== 'number' ||
      !Number.isFinite(draft.hotelLongitude) ||
      draft.hotelLongitude < HOTEL_MINIMUM_LONGITUDE ||
      draft.hotelLongitude > HOTEL_MAXIMUM_LONGITUDE ||
      draft.navigationUrl !== coordinateNavigationUrl(draft.hotelLatitude, draft.hotelLongitude)
    ) throw new Error('Hotel provider identity is inconsistent.')
  } else if (draft.hotelLatitude !== null || draft.hotelLongitude !== null) {
    throw new Error('Hotel provider coordinates require a provider ID.')
  }
  const raw = cloneJsonRecord(draft)
  delete raw.hotelProviderId
  delete raw.hotelLatitude
  delete raw.hotelLongitude
  // The hotplate lifecycle has two other writers — מיי over Telegram and the editor's own
  // plata section — and the draft only holds whatever they had said when it was opened.
  // Dropping the fields here is what makes the merge in applyOrderDraftToStore keep the
  // stored values instead of writing a stale copy back over them.
  for (const field of [
    'plataCount',
    'plataDeposit',
    'plataStatus',
    'plataPickupNote',
    'plataCollectedAt',
    'plataDepositReturnedAt',
  ]) delete raw[field]
  return {
    ...raw,
    id: orderId,
    date: draft.date,
    name: draft.name,
    phone: draft.phone,
    email: draft.email,
    place: draft.place,
    address: draft.address,
    hotelName: draft.hotelName,
    hotelAddress: draft.hotelAddress,
    ...(draft.hotelProviderId
      ? {
          hotelProviderId: draft.hotelProviderId,
          hotelLatitude: draft.hotelLatitude,
          hotelLongitude: draft.hotelLongitude,
        }
      : {}),
    navigationUrl: draft.navigationUrl,
    time: draft.time,
    pickup: draft.pickup,
    deliveryZone: draft.deliveryZone,
    freeDelivery: draft.freeDelivery,
    status: draft.status,
    group: draft.group,
    meals: draft.meals,
    aricha: draft.aricha,
    challot: draft.challot,
    salads: serializeSalads(draft.salads),
    firsts: structuredClone(draft.firsts),
    firstsNotes: structuredClone(draft.firstsNotes),
    heat: draft.heat,
    firstsNote: draft.firstsNote,
    mains: structuredClone(draft.mains),
    mainsNotes: structuredClone(draft.mainsNotes),
    mainsNote: draft.mainsNote,
    sides: structuredClone(draft.sides),
    sidesNotes: structuredClone(draft.sidesNotes),
    desserts: structuredClone(draft.desserts),
    dessertsNotes: structuredClone(draft.dessertsNotes),
    extras: serializeExtras(draft.extras),
    custom: serializeCustom(draft.custom),
    lunch: serializeLunch(draft.lunch),
    notes: draft.notes,
    total: canonicalOptionalUsd(draft.total, 'order total'),
    deposit: canonicalOptionalUsd(draft.deposit, 'order deposit'),
    payMethod: draft.payMethod,
    paid: draft.paid,
  }
}

export type OrderDraftSaveTarget =
  | { readonly mode: 'new'; readonly orderId: string }
  | { readonly mode: 'edit'; readonly orderId: string }

export function applyOrderDraftToStore(
  baseState: Readonly<LegacyStore>,
  draft: OrderDraft,
  target: OrderDraftSaveTarget,
): LegacyStore {
  assertCanonicalStoredOrderIds(baseState.orders)
  const localState = structuredClone(baseState)
  if (target.mode === 'new') {
    if (localState.orders.some((order) => order.id === target.orderId)) {
      throw new Error('Order ID already exists.')
    }
    localState.orders.push(serializeOrderDraft(draft, target.orderId))
    return localState
  }

  const matchingIndexes = localState.orders.flatMap((order, index) =>
    order.id === target.orderId ? [index] : [],
  )
  if (matchingIndexes.length !== 1) throw new Error('The edited order is not unique in the base state.')
  const index = matchingIndexes[0]!
  localState.orders[index] = {
    ...localState.orders[index],
    ...serializeOrderDraft(draft, target.orderId),
  }
  return localState
}

// Hard delete of one order. The versioned save history is the safety net: a
// deleted order can always be brought back with a restore from Settings.
export function deleteOrderFromStore(
  baseState: Readonly<LegacyStore>,
  orderId: string,
): LegacyStore {
  assertCanonicalStoredOrderIds(baseState.orders)
  if (typeof orderId !== 'string' || orderId.trim() === '') {
    throw new Error('The deleted order identity is unsafe.')
  }
  const localState = structuredClone(baseState)
  const matchingIndexes = localState.orders.flatMap((order, index) =>
    order.id === orderId ? [index] : [],
  )
  if (matchingIndexes.length !== 1) throw new Error('The deleted order is not unique in the base state.')
  localState.orders.splice(matchingIndexes[0]!, 1)
  return localState
}

const AIReviewTextSchema = z.string().trim().min(1).max(500)
const AIReviewNullableTextSchema = AIReviewTextSchema.nullable()
const AIReviewConfidenceSchema = z.number().min(0).max(1)
const AIReviewQuantitySchema = z.number().int().min(1).max(1000)

export const AIReviewSchema = z
  .object({
    reviewOnly: z.literal(true),
    draft: z
      .object({
        customerName: AIReviewNullableTextSchema,
        customerPhone: AIReviewNullableTextSchema,
        serviceDate: AIReviewNullableTextSchema,
        serviceTime: AIReviewNullableTextSchema,
        fulfillmentMethod: z.enum(['delivery', 'pickup', 'unknown']),
        deliveryLocation: AIReviewNullableTextSchema,
        items: z.array(
          z.object({
            catalogItemId: z.string().trim().min(1).max(100),
            catalogItemName: z.string().trim().min(1).max(200),
            category: z.string().trim().min(1).max(100),
            quantity: AIReviewQuantitySchema.nullable(),
            sourceText: AIReviewTextSchema,
            confidence: AIReviewConfidenceSchema,
          }).strict(),
        ).max(100),
        notes: z.array(AIReviewTextSchema).max(50),
      }).strict(),
    corrections: z.array(
      z.object({
        originalText: AIReviewTextSchema,
        correctedText: AIReviewTextSchema,
        reason: AIReviewTextSchema,
      }).strict(),
    ).max(50),
    ambiguities: z.array(
      z.object({
        sourceText: AIReviewTextSchema,
        question: AIReviewTextSchema,
        candidateCatalogItemIds: z.array(z.string().trim().min(1).max(100)).max(20),
      }).strict(),
    ).max(50),
    paidExtras: z.array(
      z.object({
        catalogItemId: z.string().trim().min(1).max(100),
        catalogItemName: z.string().trim().min(1).max(200),
        quantity: AIReviewQuantitySchema.nullable(),
        catalogPrice: z.number().finite().nonnegative().nullable(),
        currency: z.string().trim().min(1).max(10).nullable(),
        sourceText: AIReviewTextSchema,
        reason: AIReviewTextSchema,
        confidence: AIReviewConfidenceSchema,
      }).strict(),
    ).max(100),
    unknownItems: z.array(
      z.object({
        sourceText: AIReviewTextSchema,
        requestedQuantity: AIReviewQuantitySchema.nullable(),
        reason: AIReviewTextSchema,
      }).strict(),
    ).max(50),
    missingFields: z.array(
      z.object({
        field: z.enum([
          'customer_name',
          'customer_phone',
          'service_date',
          'service_time',
          'fulfillment_method',
          'delivery_location',
          'item_quantity',
          'item_choice',
          'other',
        ]),
        sourceText: AIReviewNullableTextSchema,
        reason: AIReviewTextSchema,
      }).strict(),
    ).max(50),
    warnings: z.array(z.object({
      code: z.enum([
        'paid_extra',
        'quantity_missing',
        'catalog_mismatch',
        'ambiguous_intent',
        'missing_field',
        'other',
      ]),
      severity: z.enum(['info', 'warning']),
      message: AIReviewTextSchema,
    }).strict()).max(100),
    overallConfidence: AIReviewConfidenceSchema,
  })
  .strict()

export type AIReview = z.infer<typeof AIReviewSchema>

export interface AIRequestCatalogItem {
  readonly id: string
  readonly name: string
  readonly category: string
  readonly aliases: readonly string[]
  readonly isPaidExtra: boolean
  readonly price: number | null
  readonly currency: 'USD' | null
}

export type AICatalogTarget =
  | { readonly kind: 'meals' }
  | { readonly kind: 'challahs' }
  | { readonly kind: 'salad'; readonly name: string }
  | { readonly kind: 'first'; readonly name: string }
  | { readonly kind: 'main'; readonly name: string }
  | { readonly kind: 'side'; readonly name: string }
  | { readonly kind: 'dessert'; readonly name: string }
  | { readonly kind: 'extra'; readonly name: string }
  | { readonly kind: 'lunch'; readonly key: string; readonly variantKey: string }
  | { readonly kind: 'lunch-addon'; readonly key: string }

export interface AIOrderCatalog {
  readonly items: readonly AIRequestCatalogItem[]
  readonly targetsById: Readonly<Record<string, AICatalogTarget>>
}

function dollarsFromMinorUnits(minorUnits: number): number {
  return minorUnits / 100
}

const AUTHORITATIVE_EXTRA_ALIASES: Readonly<Record<string, readonly string[]>> = {
  ["מגש שניצלים (זוגי, כ־13–15 יח')"]: ['מגש שניצלים'],
}

export function buildAIOrderCatalog(menu: OrderEditorMenu): AIOrderCatalog {
  const items: AIRequestCatalogItem[] = []
  const targetsById: Record<string, AICatalogTarget> = {}
  const add = (
    id: string,
    name: string,
    category: string,
    target: AICatalogTarget,
    options: { aliases?: readonly string[]; paid?: boolean; priceMinorUnits?: number | null } = {},
  ) => {
    items.push({
      id,
      name,
      category,
      aliases: options.aliases ?? [],
      isPaidExtra: options.paid ?? false,
      price:
        options.priceMinorUnits === undefined || options.priceMinorUnits === null
          ? null
          : dollarsFromMinorUnits(options.priceMinorUnits),
      currency: options.priceMinorUnits === undefined || options.priceMinorUnits === null ? null : 'USD',
    })
    targetsById[id] = target
  }

  add('meal:couple', 'ארוחה זוגית', 'couple_meal', { kind: 'meals' }, {
    aliases: ['זוגית', 'ארוחה לזוג'],
    priceMinorUnits: menu.couplePriceMinorUnits,
  })
  add('selection:challahs', 'חלות', 'challahs', { kind: 'challahs' }, { aliases: ['חלה'] })
  const categoryRows: readonly [
    string,
    readonly string[],
    (name: string) => AICatalogTarget,
  ][] = [
    ['salad', menu.salads, (name) => ({ kind: 'salad', name })],
    ['first', menu.firsts, (name) => ({ kind: 'first', name })],
    ['main', menu.mains, (name) => ({ kind: 'main', name })],
    ['side', menu.sides, (name) => ({ kind: 'side', name })],
    ['dessert', menu.desserts, (name) => ({ kind: 'dessert', name })],
  ]
  for (const [category, names, target] of categoryRows) {
    names.forEach((name, index) => {
      const aliases = name === 'קוסקוס עננים' ? ['קוסקוס', 'קוסקוס אוורירי'] : []
      add(`${category}:${index}`, name, category, target(name), { aliases })
    })
  }
  menu.extras.forEach((extra, index) => {
    add(`extra:${index}`, extra.name, 'extra', { kind: 'extra', name: extra.name }, {
      aliases: AUTHORITATIVE_EXTRA_ALIASES[extra.name],
      paid: true,
      priceMinorUnits: extra.priceMinorUnits,
    })
  })
  menu.lunch.forEach((item, itemIndex) => {
    if (item.variants.length === 0) {
      add(`lunch:${itemIndex}`, item.name, 'lunch', { kind: 'lunch', key: item.key, variantKey: '' }, {
        paid: true,
        priceMinorUnits: item.priceMinorUnits,
      })
    } else {
      item.variants.forEach((variant, variantIndex) => {
        add(
          `lunch:${itemIndex}:${variantIndex}`,
          `${item.name} (${variant.label})`,
          'lunch',
          { kind: 'lunch', key: item.key, variantKey: variant.key },
          { paid: true, priceMinorUnits: variant.priceMinorUnits },
        )
      })
    }
    if (item.addon) {
      add(`lunch-addon:${itemIndex}`, item.addon.name, 'lunch_addon', { kind: 'lunch-addon', key: item.key }, {
        paid: true,
        priceMinorUnits: item.addon.priceMinorUnits,
      })
    }
  })
  return { items, targetsById }
}

function withQuantity(record: Readonly<Record<string, number>>, name: string, quantity: number) {
  return { ...record, [name]: quantity }
}

// A couple-meal SELECTION carries no quantity in the customer's words —
// choosing it is the whole statement; the meal structure defines amounts.
// The AI grounds quantities to explicit digits only, so most selections
// arrive null. Resolve them with the meal's own logic instead of dropping
// them (dropping produced empty, useless drafts) — shared by the actual
// apply step and by any UI that previews what the review will produce, so
// the two never disagree about what "recognized" means.
export function resolveReviewItemQuantities(
  reviewItems: AIReview['draft']['items'],
  targetsById: Readonly<Record<string, AICatalogTarget>>,
  currentMeals: number,
): ReadonlyMap<string, number> {
  const hasSelections = reviewItems.some((item) => {
    const kind = targetsById[item.catalogItemId]?.kind
    return kind === 'salad' || kind === 'first' || kind === 'main' || kind === 'side' || kind === 'dessert'
  })
  const statedMeals = reviewItems.find(
    (item) => targetsById[item.catalogItemId]?.kind === 'meals' && item.quantity !== null,
  )?.quantity
  const assumedMeals = statedMeals ?? (hasSelections ? Math.max(currentMeals, 1) : currentMeals)

  // The one place this resolver disagrees with a flat "1 unit chosen" is
  // dessert: portions are not equal size (a soufflé serves one person, a
  // baklava portion serves two), so the default must reflect the included
  // half-unit budget for the SPECIFIC dish the customer named, via the same
  // classifier the pricing engine uses — never a second, drifting guess.
  const defaultQuantityFor = (target: AICatalogTarget): number | null => {
    if (target.kind === 'meals') return assumedMeals
    // Each fillet's unit count comes from the package rule, not a private
    // "* 2" here — a rule change updates pricing and this default together.
    if (target.kind === 'first') return assumedMeals * FISH_UNITS_INCLUDED_PER_MEAL
    // Salad, main, and side selections are named one dish at a time (the
    // customer lists each kind separately, e.g. 4 salad names for the
    // included 4) — a mention is one portion of that specific dish, however
    // many kinds the package includes in total.
    if (target.kind === 'salad' || target.kind === 'main' || target.kind === 'side') return 1
    if (target.kind === 'dessert') {
      return defaultDessertPortionsForMeals(classifyDessertKind(target.name), assumedMeals)
    }
    if (target.kind === 'extra') return 1
    // A weekday lunch dish is a standalone plate: naming it IS ordering one
    // of it. Leaving it unresolved dropped the dish out of the order
    // entirely and the customer was never charged for it.
    if (target.kind === 'lunch' || target.kind === 'lunch-addon') return 1
    return null // challahs follow the meal count automatically
  }

  const resolved = new Map<string, number>()
  for (const item of reviewItems) {
    const target = targetsById[item.catalogItemId]
    if (!target) continue
    const quantity = item.quantity ?? defaultQuantityFor(target)
    if (quantity === null || quantity === 0) continue
    resolved.set(item.catalogItemId, quantity)
  }
  return resolved
}

export function applyAIReviewToDraft(
  draft: OrderDraft,
  review: AIReview,
  targetsById: Readonly<Record<string, AICatalogTarget>>,
  menu?: OrderEditorMenu,
): OrderDraft {
  const reviewedDeliveryLocation = review.draft.deliveryLocation
  let next: OrderDraft = reviewedDeliveryLocation === null
    ? { ...draft }
    : applyHotelDestinationInput(draft, reviewedDeliveryLocation)
  next = {
    ...draft,
    ...next,
    name: review.draft.customerName ?? draft.name,
    phone: review.draft.customerPhone ?? draft.phone,
    date:
      review.draft.serviceDate && validIsoDate(review.draft.serviceDate)
        ? review.draft.serviceDate
        : draft.date,
    time: review.draft.serviceTime ?? draft.time,
    pickup:
      review.draft.fulfillmentMethod === 'pickup'
        ? true
        : review.draft.fulfillmentMethod === 'delivery' || reviewedDeliveryLocation !== null
          ? false
          : draft.pickup,
    notes:
      review.draft.notes.length === 0
        ? draft.notes
        : [draft.notes, ...review.draft.notes].filter(Boolean).join('\n'),
  }

  const itemsInDependencyOrder = [
    ...review.draft.items.filter((item) => targetsById[item.catalogItemId]?.kind !== 'lunch-addon'),
    ...review.draft.items.filter((item) => targetsById[item.catalogItemId]?.kind === 'lunch-addon'),
  ]

  const resolvedQuantities = resolveReviewItemQuantities(review.draft.items, targetsById, draft.meals)

  for (const item of itemsInDependencyOrder) {
    const target = targetsById[item.catalogItemId]
    if (!target) continue
    const quantity = resolvedQuantities.get(item.catalogItemId)
    if (quantity === undefined) continue
    if (target.kind === 'meals') {
      next = menu
        ? applyCoupleMealQuantity(next, menu, quantity)
        : { ...next, meals: quantity }
    }
    else if (target.kind === 'challahs') next = { ...next, challot: quantity }
    else if (target.kind === 'salad') {
      next = {
        ...next,
        salads: {
          ...next.salads,
          [target.name]: {
            ordered: quantity,
            gift: next.salads[target.name]?.gift ?? 0,
            note: next.salads[target.name]?.note ?? '',
          },
        },
      }
    } else if (target.kind === 'first') next = { ...next, firsts: withQuantity(next.firsts, target.name, quantity) }
    else if (target.kind === 'main') next = { ...next, mains: withQuantity(next.mains, target.name, quantity) }
    else if (target.kind === 'side') next = { ...next, sides: withQuantity(next.sides, target.name, quantity) }
    else if (target.kind === 'dessert') next = { ...next, desserts: withQuantity(next.desserts, target.name, quantity) }
    else if (target.kind === 'extra') {
      next = {
        ...next,
        extras: {
          ...next.extras,
          [target.name]: { quantity: quantity, note: next.extras[target.name]?.note ?? '' },
        },
      }
    } else if (target.kind === 'lunch') {
      const current = next.lunch[target.key] ?? { quantity: 0, variantKey: '', sides: {}, addonQuantity: 0 }
      const updated = quantity === 0
        ? { ...current, quantity: 0, sides: {}, addonQuantity: 0 }
        : { ...current, quantity: quantity, variantKey: target.variantKey }
      const lunch = { ...next.lunch }
      const {
        quantity: _quantity,
        variantKey: _variantKey,
        sides: _sides,
        addonQuantity: _addonQuantity,
        ...unknown
      } = updated
      if (updated.quantity === 0 && Object.keys(unknown).length === 0) delete lunch[target.key]
      else lunch[target.key] = updated
      next = {
        ...next,
        lunch,
      }
    } else {
      const current = next.lunch[target.key] ?? { quantity: 0, variantKey: '', sides: {}, addonQuantity: 0 }
      const updated = {
        ...current,
        addonQuantity: current.quantity > 0 ? quantity : 0,
      }
      const lunch = { ...next.lunch }
      const hasKnownSelection =
        updated.quantity > 0 ||
        updated.addonQuantity > 0 ||
        Object.keys(updated.sides).length > 0
      const {
        quantity: _quantity,
        variantKey: _variantKey,
        sides: _sides,
        addonQuantity: _addonQuantity,
        ...unknown
      } = updated
      if (!hasKnownSelection && Object.keys(unknown).length === 0) delete lunch[target.key]
      else lunch[target.key] = updated
      next = {
        ...next,
        lunch,
      }
    }
  }
  return next
}
