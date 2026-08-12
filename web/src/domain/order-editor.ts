import { z } from 'zod'
import { checkedAdd, checkedMultiply } from './money.ts'
import {
  calculateOrderTotal,
  type ChargeLineInput,
  type OrderTotalResult,
} from './order-total.ts'
import type { LegacyOrder, LegacyStore } from './store.ts'

export const DEFAULT_COUPLE_PRICE_MINOR_UNITS = 23_000
export const DEFAULT_CHALLAH_PRICE_MINOR_UNITS = 1_000

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
  desserts: ['סופלה שוקולד', 'סוכריות בקלאווה'],
} as const

const DEFAULT_EXTRAS_DOLLARS = [
  ['תוספת 4 סלטים לבחירה', 25],
  ['תוספת חלה', 10],
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
  ['משלוח', 15],
  ['מרק ירקות לקוסקוס ללא עוף', 70],
  ['מרק ירקות לקוסקוס עם עוף', 100],
  ['סט עריכה', 10],
  ['תוספת יין', 5],
] as const

export interface MenuExtra {
  readonly name: string
  readonly priceMinorUnits: number
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
        includedSides: 0,
        sidePriceMinorUnits: 1_500,
      },
      {
        key: 'couple',
        label: 'זוגית',
        priceMinorUnits: 6_000,
        includedSides: 0,
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
  readonly ordered: number
  readonly gift: number
}

export interface ExtraDraftSelection {
  readonly quantity: number
  readonly note: string
}

export interface CustomDraftItem {
  readonly name: string
  readonly quantity: number
  readonly unitPrice: string
  readonly note: string
}

export interface LunchDraftSelection {
  readonly quantity: number
  readonly variantKey: string
  readonly sides: Readonly<Record<string, number>>
  readonly addonQuantity: number
}

export interface OrderDraft extends Record<string, unknown> {
  readonly id: string | number | null
  readonly date: string
  readonly name: string
  readonly phone: string
  readonly place: string
  readonly address: string
  readonly hotelName: string
  readonly hotelAddress: string
  readonly navigationUrl: string
  readonly time: string
  readonly pickup: boolean
  readonly status: string
  readonly group: string
  readonly meals: number
  readonly aricha: number
  readonly challot: number
  readonly salads: Readonly<Record<string, SaladDraftSelection>>
  readonly firsts: Readonly<Record<string, number>>
  readonly heat: string
  readonly firstsNote: string
  readonly mains: Readonly<Record<string, number>>
  readonly mainsNote: string
  readonly sides: Readonly<Record<string, number>>
  readonly desserts: Readonly<Record<string, number>>
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

function normalizeSalads(value: unknown): Record<string, SaladDraftSelection> {
  const result: Record<string, SaladDraftSelection> = {}
  if (!isPlainRecord(value)) return result
  for (const [name, rawSelection] of Object.entries(value)) {
    if (!isPlainRecord(rawSelection)) continue
    const ordered = count(rawSelection.o ?? rawSelection.ordered)
    const gift = count(rawSelection.p ?? rawSelection.gift)
    if (ordered > 0 || gift > 0) result[name] = { ordered, gift }
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
    if (quantity > 0 || note.length > 0) result[name] = { quantity, note }
  }
  return result
}

function normalizeCustom(value: unknown): CustomDraftItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((rawItem) => {
    if (!isPlainRecord(rawItem)) return []
    return [
      {
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
    if (quantity > 0 || addonQuantity > 0 || Object.keys(sides).length > 0) {
      result[key] = {
        quantity,
        variantKey: text(rawSelection.v ?? rawSelection.variantKey),
        sides,
        addonQuantity,
      }
    }
  }
  return result
}

function dollarsNumberToMinorUnits(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback
  const minorUnits = Math.round(value * 100)
  return Number.isSafeInteger(minorUnits) ? minorUnits : fallback
}

function stringArray(value: unknown, fallback: readonly string[]): readonly string[] {
  if (!Array.isArray(value)) return [...fallback]
  const sanitized = value.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0,
  )
  return sanitized.length > 0 ? sanitized : [...fallback]
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

export function buildOrderEditorMenu(store: LegacyStore): OrderEditorMenu {
  const rawMenu = isPlainRecord(store.menu) ? store.menu : {}
  const rawExtras = Array.isArray(rawMenu.extras) ? rawMenu.extras : []
  const extras = rawExtras.flatMap((rawExtra): MenuExtra[] => {
    if (!isPlainRecord(rawExtra) || typeof rawExtra.name !== 'string' || !rawExtra.name.trim()) {
      return []
    }
    return [
      {
        name: rawExtra.name,
        priceMinorUnits: dollarsNumberToMinorUnits(rawExtra.price, 0),
      },
    ]
  })

  return {
    salads: stringArray(rawMenu.salads, DEFAULT_MENU_CATEGORIES.salads),
    firsts: stringArray(rawMenu.firsts, DEFAULT_MENU_CATEGORIES.firsts),
    mains: stringArray(rawMenu.mains, DEFAULT_MENU_CATEGORIES.mains),
    sides: stringArray(rawMenu.sides, DEFAULT_MENU_CATEGORIES.sides),
    desserts: stringArray(rawMenu.desserts, DEFAULT_MENU_CATEGORIES.desserts),
    extras:
      extras.length > 0
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
  }
}

export function nextFridayIso(now: Date = new Date()): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const daysUntilFriday = (5 - date.getDay() + 7) % 7
  date.setDate(date.getDate() + daysUntilFriday)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function createOrderDraft(menu: OrderEditorMenu, now: Date = new Date()): OrderDraft {
  return {
    id: null,
    date: nextFridayIso(now),
    name: '',
    phone: '',
    place: '',
    address: '',
    hotelName: '',
    hotelAddress: '',
    navigationUrl: '',
    time: '',
    pickup: false,
    status: 'חדשה',
    group: '',
    meals: 1,
    aricha: 0,
    challot: menu.includedChallahs,
    salads: {},
    firsts: {},
    heat: '',
    firstsNote: '',
    mains: {},
    mainsNote: '',
    sides: {},
    desserts: {},
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
    place: text(order.place),
    address: text(order.address),
    hotelName: text(raw.hotelName) || text(order.place),
    hotelAddress: text(raw.hotelAddress) || text(order.address),
    navigationUrl: text(raw.navigationUrl),
    time: text(order.time),
    pickup: order.pickup === true,
    status: text(order.status) || 'חדשה',
    group: text(order.group),
    meals: countOrFallback(order.meals, defaults.meals),
    aricha: countOrFallback(order.aricha, defaults.aricha),
    challot: countOrFallback(order.challot, defaults.challot),
    salads: normalizeSalads(order.salads),
    firsts: normalizeQuantityMap(order.firsts),
    heat: text(order.heat),
    firstsNote: text(order.firstsNote),
    mains: normalizeQuantityMap(order.mains),
    mainsNote: text(order.mainsNote),
    sides: normalizeQuantityMap(order.sides),
    desserts: normalizeQuantityMap(order.desserts),
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

export function applyHotelSelection(draft: OrderDraft, hotelName: string): OrderDraft {
  const hotel = HOTEL_OPTIONS.find((candidate) => candidate.name === hotelName.trim())
  if (!hotel) return { ...draft, place: hotelName, hotelName }
  return {
    ...draft,
    place: hotel.name,
    hotelName: hotel.name,
    address: draft.address || hotel.fullAddress,
    hotelAddress: draft.hotelAddress || hotel.fullAddress,
    navigationUrl: draft.navigationUrl || hotel.navigationUrl,
  }
}

function strictMinorUnits(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null
    const stringValue = String(value)
    return strictMinorUnits(stringValue)
  }
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  const match = normalized.match(/^(?:0|[1-9]\d*)(?:\.(\d{1,2}))?$/u)
  if (!match) return null
  const [whole, fraction = ''] = normalized.split('.')
  const minorUnits = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(minorUnits) ? minorUnits : null
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
    const normalized = name.normalize('NFKC')
    if (normalized.includes('סופלה')) souffleQuantity = checkedAdd(souffleQuantity, quantity)
    else if (/\u05d1\u05e7\u05dc/u.test(normalized)) baklavaQuantity = checkedAdd(baklavaQuantity, quantity)
    else unclassifiedQuantity = checkedAdd(unclassifiedQuantity, quantity)
  }
  const selectedHalfUnits = checkedAdd(
    souffleQuantity,
    checkedMultiply(baklavaQuantity, 2, 'baklava allowance units'),
    'dessert allowance units',
  )
  const includedHalfUnits = checkedMultiply(draft.meals, 2, 'included dessert units')
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
    | 'INVALID_CUSTOM_ITEM'
    | 'UNKNOWN_LUNCH_VARIANT'
    | 'WEEKDAY_LUNCH_CHALLAH'
    | 'DESSERT_OVERAGE'
    | 'DESSERT_UNCLASSIFIED'
    | 'PRICING_ERROR'
  readonly message: string
  readonly blocking: boolean
}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
  const parsed = new Date(`${value}T00:00:00`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function isWeekendDate(value: string): boolean {
  if (!validIsoDate(value)) return false
  const day = new Date(`${value}T00:00:00`).getDay()
  return day === 5 || day === 6
}

export interface DraftPricing {
  readonly result: OrderTotalResult | null
  readonly issues: readonly DraftIssue[]
  readonly dessert: DessertAllowance
}

export function calculateOrderDraftPricing(
  draft: OrderDraft,
  menu: OrderEditorMenu,
): DraftPricing {
  const issues: DraftIssue[] = []
  const chargeLines: ChargeLineInput[] = []

  for (const extra of menu.extras) {
    const selection = draft.extras[extra.name]
    if (selection && selection.quantity > 0) {
      chargeLines.push({
        source: 'legacy-extra',
        name: extra.name,
        quantity: selection.quantity,
        unitPriceMinorUnits: extra.priceMinorUnits,
      })
    }
  }

  draft.custom.forEach((item, index) => {
    if (item.quantity === 0 && item.name.trim().length === 0 && item.unitPrice.trim().length === 0) return
    const unitPriceMinorUnits = strictMinorUnits(item.unitPrice)
    if (item.name.trim().length === 0 || item.quantity < 1 || unitPriceMinorUnits === null) {
      issues.push({
        code: 'INVALID_CUSTOM_ITEM',
        message: `פריט חופשי ${index + 1} חסר שם, כמות או מחיר תקין.`,
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

  const includedChallahs = checkedMultiply(
    menu.includedChallahs,
    draft.meals,
    'included challahs',
  )
  const extraChallahs = draft.meals > 0 ? Math.max(0, draft.challot - includedChallahs) : 0
  if (extraChallahs > 0) {
    chargeLines.push({
      source: 'other',
      name: 'חלות נוספות',
      quantity: extraChallahs,
      unitPriceMinorUnits: menu.challahPriceMinorUnits,
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
    issues.push({
      code: 'DESSERT_OVERAGE',
      message:
        'בחירת הקינוחים חורגת מהזכאות: שני סופלה או מנת סוכריות בקלאווה לכל זוגית. המחיר לחריגה טרם הוגדר.',
      blocking: false,
    })
  }
  if (dessert.unclassifiedQuantity > 0) {
    issues.push({
      code: 'DESSERT_UNCLASSIFIED',
      message: 'יש קינוח שאי אפשר לשייך בבטחה לזכאות.',
      blocking: false,
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

export function validateOrderDraft(draft: OrderDraft): readonly DraftIssue[] {
  const issues: DraftIssue[] = []
  if (!draft.date) issues.push({ code: 'MISSING_DATE', message: 'חסר תאריך הזמנה.', blocking: true })
  else if (!validIsoDate(draft.date)) {
    issues.push({ code: 'INVALID_DATE', message: 'תאריך ההזמנה אינו תקין.', blocking: true })
  }
  if (!draft.name.trim()) {
    issues.push({ code: 'MISSING_NAME', message: 'חסר שם לקוח.', blocking: true })
  }
  if (draft.total.trim() && strictMinorUnits(draft.total) === null) {
    issues.push({ code: 'INVALID_TOTAL', message: 'סך התשלום אינו תקין.', blocking: true })
  }
  if (draft.deposit.trim() && strictMinorUnits(draft.deposit) === null) {
    issues.push({ code: 'INVALID_DEPOSIT', message: 'המקדמה אינה תקינה.', blocking: true })
  }
  return issues
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

export function applyAIReviewToDraft(
  draft: OrderDraft,
  review: AIReview,
  targetsById: Readonly<Record<string, AICatalogTarget>>,
): OrderDraft {
  let next: OrderDraft = {
    ...draft,
    name: review.draft.customerName ?? draft.name,
    phone: review.draft.customerPhone ?? draft.phone,
    date:
      review.draft.serviceDate && validIsoDate(review.draft.serviceDate)
        ? review.draft.serviceDate
        : draft.date,
    time: review.draft.serviceTime ?? draft.time,
    place: review.draft.deliveryLocation ?? draft.place,
    hotelName: review.draft.deliveryLocation ?? draft.hotelName,
    pickup:
      review.draft.fulfillmentMethod === 'pickup'
        ? true
        : review.draft.fulfillmentMethod === 'delivery'
          ? false
          : draft.pickup,
    notes:
      review.draft.notes.length === 0
        ? draft.notes
        : [draft.notes, ...review.draft.notes].filter(Boolean).join('\n'),
  }

  for (const item of review.draft.items) {
    if (item.quantity === null) continue
    const target = targetsById[item.catalogItemId]
    if (!target) continue
    if (target.kind === 'meals') next = { ...next, meals: item.quantity }
    else if (target.kind === 'challahs') next = { ...next, challot: item.quantity }
    else if (target.kind === 'salad') {
      next = {
        ...next,
        salads: {
          ...next.salads,
          [target.name]: { ordered: item.quantity, gift: next.salads[target.name]?.gift ?? 0 },
        },
      }
    } else if (target.kind === 'first') next = { ...next, firsts: withQuantity(next.firsts, target.name, item.quantity) }
    else if (target.kind === 'main') next = { ...next, mains: withQuantity(next.mains, target.name, item.quantity) }
    else if (target.kind === 'side') next = { ...next, sides: withQuantity(next.sides, target.name, item.quantity) }
    else if (target.kind === 'dessert') next = { ...next, desserts: withQuantity(next.desserts, target.name, item.quantity) }
    else if (target.kind === 'extra') {
      next = {
        ...next,
        extras: {
          ...next.extras,
          [target.name]: { quantity: item.quantity, note: next.extras[target.name]?.note ?? '' },
        },
      }
    } else if (target.kind === 'lunch') {
      const current = next.lunch[target.key] ?? { quantity: 0, variantKey: '', sides: {}, addonQuantity: 0 }
      next = {
        ...next,
        lunch: {
          ...next.lunch,
          [target.key]: { ...current, quantity: item.quantity, variantKey: target.variantKey },
        },
      }
    } else {
      const current = next.lunch[target.key] ?? { quantity: 0, variantKey: '', sides: {}, addonQuantity: 0 }
      next = {
        ...next,
        lunch: {
          ...next.lunch,
          [target.key]: { ...current, addonQuantity: item.quantity },
        },
      }
    }
  }
  return next
}
