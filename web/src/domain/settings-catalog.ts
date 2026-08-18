import { z } from 'zod'
import { parseLegacyUsdAmount } from './customers-finance.ts'
import {
  CHRAIME_FILLET_NAME,
  FISH_CAKE_PORTION_NAME,
  MOROCCAN_FILLET_NAME,
} from './fish-pricing.ts'
import { canonicalizeChargeName, isAutomaticChargeName } from './order-total.ts'
import {
  PositiveDecimalQuantitySchema,
  StableCatalogIdSchema,
  validateRecipeDefinition,
  type RecipeDefinition,
} from './recipes.ts'
import {
  CANCELLED_STATUS_ALIASES,
  type LunchCatalogAddon,
  type LunchCatalogItem,
  type LunchCatalogVariant,
  type PreparationCatalog,
  type PreparationCatalogItem,
  type ProcurementPolicy,
} from './preparation.ts'
import type { LegacyStore } from './store.ts'
import type { VersionedStateEnvelope } from '../services/state-api.ts'

export const MENU_CATEGORY_KEYS = ['salads', 'firsts', 'mains', 'sides', 'desserts'] as const
export type MenuCategoryKey = (typeof MENU_CATEGORY_KEYS)[number]

export const AUTHORITATIVE_ALLOWANCES = {
  includedSaladsPerCouple: 4,
  includedFishUnitsPerCouple: 2,
  extraFishFilletMinorUnits: 3_000,
  saladBlockSize: 4,
  saladBlockMinorUnits: 2_500,
  saladRemainderMinorUnits: 700,
  soufflesPerCouple: 2,
  baklavaPortionsPerCouple: 1,
} as const

export const SUPERSEDED_MANUAL_EXTRAS = [
  'תוספת 4 סלטים לבחירה',
  'תוספת מנת דג',
  'תוספת קציצות דגים',
] as const

export const NON_RECIPE_EXTRA_NAMES = [
  'מארז הבדלה',
  'סט עריכה',
  'תוספת יין',
] as const

export const AUTHORITATIVE_FIRST_COURSE_ITEMS = [
  { id: 'shabbat-firsts-01', name: MOROCCAN_FILLET_NAME },
  { id: 'shabbat-firsts-02', name: CHRAIME_FILLET_NAME },
  { id: 'shabbat-firsts-03', name: FISH_CAKE_PORTION_NAME },
] as const

const MAX_PRICE_MINOR_UNITS = 100_000_000
const MAX_MENU_ITEMS = 500
const MAX_TEXT_LENGTH = 240

export interface CatalogItem {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly imageUrl: string | null
  /** Free comma-separated text, e.g. "אגוזים, גלוטן, סומסום". Empty when unset. */
  readonly allergens: string
  /** Free text printed on the kitchen bon. Empty when unset. */
  readonly heatingInstructions: string
}

export interface PricedCatalogItem extends CatalogItem {
  readonly priceMinorUnits: number
}

export interface LunchVariant {
  readonly key: string
  readonly itemId: string
  readonly name: string
  readonly priceMinorUnits: number
  readonly weekendOnly: boolean
  readonly includedSides: number
  readonly extraSideMinorUnits: number | null
}

export interface LunchItem {
  readonly key: string
  readonly name: string
  readonly itemId: string | null
  readonly priceMinorUnits: number | null
  readonly variants: readonly LunchVariant[]
  readonly allowsSides: boolean
  readonly addon: PricedCatalogItem | null
}

export interface SettingsCatalog {
  readonly couplePriceMinorUnits: number
  readonly extraChallahMinorUnits: number
  readonly includedChallahs: number
  readonly saladBlockMinorUnits: number
  readonly saladRemainderMinorUnits: number
  readonly extraFishFilletMinorUnits: number
  readonly extraDessertHalfUnitMinorUnits: number
  readonly categories: Readonly<Record<MenuCategoryKey, readonly CatalogItem[]>>
  readonly extras: readonly PricedCatalogItem[]
  readonly lunch: readonly LunchItem[]
  readonly lunchSides: readonly CatalogItem[]
}

export type CatalogWarningCode =
  | 'INVALID_MENU_STRUCTURE'
  | 'INVALID_MENU_ITEM'
  | 'DUPLICATE_ITEM_ID'
  | 'DUPLICATE_ITEM_NAME'
  | 'INVALID_PRICE'
  | 'INVALID_COUNT'
  | 'SUPERSEDED_EXTRA_REMOVED'
  | 'AUTHORITATIVE_FIRST_COURSE_REQUIRED'
  | 'UNSAFE_FIRST_COURSE_ITEM'
  | 'UNKNOWN_LUNCH_OVERRIDE'
  | 'DUPLICATE_LUNCH_OVERRIDE'

export interface CatalogWarning {
  readonly code: CatalogWarningCode
  readonly path: string
  readonly message: string
}

export interface CatalogResult {
  readonly catalog: SettingsCatalog
  readonly warnings: readonly CatalogWarning[]
}

export type PreparationCatalogResolutionState = 'configured' | 'missing' | 'invalid'

export interface PreparationCatalogResolution {
  readonly catalog: PreparationCatalog
  readonly state: PreparationCatalogResolutionState
  readonly issues: readonly string[]
}

export type PreparationCatalogState = PreparationCatalogResolutionState

export interface StoreSaveRequest {
  readonly reason:
    | 'settings'
    | 'menu'
    | 'recipes'
    | 'product-library'
    | 'customers'
    | 'finance'
    | 'deliveries'
    | 'preparation'
    | 'kitchen'
    | 'shopping'
    | 'orders'
  readonly baseEnvelope: Readonly<VersionedStateEnvelope>
  readonly baseStore: Readonly<LegacyStore>
  readonly nextStore: LegacyStore
}

export type StoreSaveHandler = (request: StoreSaveRequest) => Promise<void>

const DEFAULT_CATEGORY_NAMES: Readonly<Record<MenuCategoryKey, readonly string[]>> = {
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
  firsts: AUTHORITATIVE_FIRST_COURSE_ITEMS.map((item) => item.name),
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
}

const DEFAULT_EXTRA_ROWS: readonly [string, number][] = [
  ['צלי בקר פרוס ברוטב פטריות וערמונים (ל־4 אנשים)', 15_000],
  ['מפרום ביתי של אמא (זוגי)', 4_000],
  ['טבחה בשר אדומה עם אפונה ותפו"א (ל־2־3 אנשים)', 10_000],
  ['רולדת בשר פריך ברוטב פטריות עשיר', 10_000],
  ["מגש שניצלים (זוגי, כ־13–15 יח')", 10_000],
  ['מגש תפו"א קריספיים', 3_000],
  ['אורז', 2_500],
  ['פסטה אדומה', 2_500],
  ['קוסקוס', 2_500],
  ['צלחת פתיחה (זיתים וחמוצים)', 1_500],
  ['צלחת חריפים', 1_500],
  ['תוספת חומוס ישראלי לניגוב', 1_500],
  ['מארז הבדלה', 2_000],
  ['סיר קובה סלק בתוספת אורז (ל־4 אנשים)', 12_500],
  ['מנת ילדים — פסטה אדומה ושניצלונים', 3_500],
  ['חלת שניצל (ספיישל סופ"ש)', 2_800],
  ['מנת מפרום ביתי (תוספת)', 2_000],
  ['מרק ירקות לקוסקוס ללא עוף', 7_000],
  ['מרק ירקות לקוסקוס עם עוף', 10_000],
  ['סט עריכה', 1_000],
  ['תוספת יין', 500],
]

const DEFAULT_LUNCH: readonly LunchItem[] = [
  {
    key: 'baguette',
    itemId: 'lunch-tunisian-baguette',
    name: 'בגט טוניסאי אותנטי',
    priceMinorUnits: 2_200,
    variants: [],
    allowsSides: false,
    addon: null,
  },
  {
    key: 'schnitzel-roll',
    itemId: null,
    name: 'בגט/חלת שניצל ישראלי',
    priceMinorUnits: null,
    variants: [
      {
        key: 'baguette',
        itemId: 'lunch-schnitzel-roll-baguette',
        name: 'בבגט',
        priceMinorUnits: 2_500,
        weekendOnly: false,
        includedSides: 0,
        extraSideMinorUnits: null,
      },
      {
        key: 'challah',
        itemId: 'lunch-schnitzel-roll-challah',
        name: 'בחלה — סופ"ש בלבד',
        priceMinorUnits: 2_800,
        weekendOnly: true,
        includedSides: 0,
        extraSideMinorUnits: null,
      },
    ],
    allowsSides: false,
    addon: null,
  },
  {
    key: 'kubeh',
    itemId: 'lunch-beet-kubeh',
    name: 'מנת קובה סלק ביתית',
    priceMinorUnits: 3_500,
    variants: [],
    allowsSides: false,
    addon: null,
  },
  {
    key: 'schnitzel-plate',
    itemId: null,
    name: 'שניצל בצלחת',
    priceMinorUnits: null,
    variants: [
      {
        key: 'single',
        itemId: 'lunch-schnitzel-plate-single',
        name: 'אישית',
        priceMinorUnits: 3_500,
        weekendOnly: false,
        includedSides: 0,
        extraSideMinorUnits: 1_500,
      },
      {
        key: 'couple',
        itemId: 'lunch-schnitzel-plate-couple',
        name: 'זוגית',
        priceMinorUnits: 6_000,
        weekendOnly: false,
        includedSides: 0,
        extraSideMinorUnits: 2_500,
      },
      {
        key: 'family',
        itemId: 'lunch-schnitzel-plate-family',
        name: 'משפחתית — כולל 2 תוספות',
        priceMinorUnits: 14_500,
        weekendOnly: false,
        includedSides: 2,
        extraSideMinorUnits: 2_500,
      },
    ],
    allowsSides: true,
    addon: null,
  },
  {
    key: 'couscous',
    itemId: 'lunch-couscous-special',
    name: 'ספיישל קוסקוס',
    priceMinorUnits: 3_500,
    variants: [],
    allowsSides: false,
    addon: {
      id: 'lunch-couscous-mafrum',
      name: 'מנת מפרום ביתי',
      priceMinorUnits: 2_000,
      description: '',
      imageUrl: null,
      allergens: '',
      heatingInstructions: '',
    },
  },
]

const DEFAULT_LUNCH_SIDES = ['אורז לבן', 'פסטה אדומה', 'פסטה נקיה'] as const

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH ? value.trim() : ''
}

function canonicalCatalogName(value: string): string {
  return canonicalizeChargeName(value).toLocaleLowerCase('he-IL')
}

export function isAuthoritativeFirstCourseItem(
  item: Pick<CatalogItem, 'id' | 'name'>,
): boolean {
  const name = canonicalCatalogName(item.name)
  return AUTHORITATIVE_FIRST_COURSE_ITEMS.some(
    (authoritative) =>
      authoritative.id === item.id || canonicalCatalogName(authoritative.name) === name,
  )
}

function hashText(value: string): string {
  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(value.normalize('NFKC'))) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

function generatedId(scope: string, name: string): string {
  return `${scope}-${hashText(name)}`
}

export const REVIEWED_LEGACY_PREPARATION_ITEMS = [
  {
    id: generatedId('legacy-extra', 'מגש אורז / קוסקוס / פסטה אדומה'),
    category: 'extras',
    name: 'מגש אורז / קוסקוס / פסטה אדומה',
  },
  {
    id: generatedId('legacy-custom', 'חומוס'),
    category: 'custom',
    name: 'חומוס',
  },
  {
    id: generatedId('legacy-custom', 'מרק ירקות קוסקוס פרווה'),
    category: 'custom',
    name: 'מרק ירקות קוסקוס פרווה',
  },
] as const satisfies ReadonlyArray<
  Pick<PreparationCatalogItem, 'id' | 'category' | 'name'>
>

function cloneCatalog(catalog: SettingsCatalog): SettingsCatalog {
  return {
    ...catalog,
    categories: Object.fromEntries(
      MENU_CATEGORY_KEYS.map((category) => [
        category,
        catalog.categories[category].map((item) => ({ ...item })),
      ]),
    ) as Record<MenuCategoryKey, CatalogItem[]>,
    extras: catalog.extras.map((item) => ({ ...item })),
    lunch: catalog.lunch.map((item) => ({
      ...item,
      variants: item.variants.map((variant) => ({ ...variant })),
      addon: item.addon === null ? null : { ...item.addon },
    })),
    lunchSides: catalog.lunchSides.map((item) => ({ ...item })),
  }
}

export const DEFAULT_SETTINGS_CATALOG: SettingsCatalog = {
  couplePriceMinorUnits: 23_000,
  extraChallahMinorUnits: 1_000,
  includedChallahs: 2,
  saladBlockMinorUnits: AUTHORITATIVE_ALLOWANCES.saladBlockMinorUnits,
  saladRemainderMinorUnits: AUTHORITATIVE_ALLOWANCES.saladRemainderMinorUnits,
  extraFishFilletMinorUnits: AUTHORITATIVE_ALLOWANCES.extraFishFilletMinorUnits,
  extraDessertHalfUnitMinorUnits: 0,
  categories: Object.fromEntries(
    MENU_CATEGORY_KEYS.map((category) => [
      category,
      DEFAULT_CATEGORY_NAMES[category].map((name, index) => ({
        id: `shabbat-${category}-${String(index + 1).padStart(2, '0')}`,
        name,
        description: '',
        imageUrl: null,
        allergens: '',
        heatingInstructions: '',
      })),
    ]),
  ) as Record<MenuCategoryKey, CatalogItem[]>,
  extras: DEFAULT_EXTRA_ROWS.map(([name, priceMinorUnits]) => ({
    id: generatedId('extra', name),
    name,
    priceMinorUnits,
    description: '',
    imageUrl: null,
    allergens: '',
    heatingInstructions: '',
  })),
  lunch: DEFAULT_LUNCH,
  lunchSides: DEFAULT_LUNCH_SIDES.map((name) => ({
    id: generatedId('lunch-side', name),
    name,
    description: '',
    imageUrl: null,
    allergens: '',
    heatingInstructions: '',
  })),
}

function menuSource(
  store: Readonly<LegacyStore>,
  warnings?: CatalogWarning[],
): Readonly<Record<string, unknown>> {
  const value = (store as Readonly<Record<string, unknown>>).menu
  if (value === undefined) return {}
  if (isRecord(value)) return value
  warnings?.push({
    code: 'INVALID_MENU_STRUCTURE',
    path: 'menu',
    message: 'menu must be an object',
  })
  return {}
}

function preparationSource(store: Readonly<LegacyStore>): Readonly<Record<string, unknown>> {
  const value = (store as Readonly<Record<string, unknown>>).preparationCatalog
  return isRecord(value) ? value : {}
}

function preservedUnknownFields(
  source: unknown,
  knownKeys: readonly string[],
): Record<string, unknown> {
  if (!isRecord(source)) return {}
  const known = new Set(knownKeys)
  return Object.fromEntries(
    Object.entries(source)
      .filter(([key]) => !known.has(key))
      .map(([key, value]) => [key, structuredClone(value)]),
  )
}

function preservedTextList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const values = value
    .map((item) => text(item))
    .filter(Boolean)
    .slice(0, MAX_MENU_ITEMS)
  return values.length === 0 ? undefined : [...new Set(values)]
}

function parsedProcurement(value: unknown): ProcurementPolicy | null {
  if (!isRecord(value)) return null
  if (value.kind === 'recipe' || value.kind === 'none') return { kind: value.kind }
  if (value.kind !== 'direct') return null
  const ingredientId = StableCatalogIdSchema.safeParse(value.ingredientId)
  const ingredientName = text(value.ingredientName)
  const unit = text(value.unit)
  const quantity = PositiveDecimalQuantitySchema.safeParse(value.quantityPerItem)
  if (!ingredientId.success || ingredientName === '' || unit === '' || !quantity.success) {
    return null
  }
  return {
    kind: 'direct',
    ingredientId: ingredientId.data,
    ingredientName,
    unit,
    quantityPerItem: quantity.data,
  }
}

function preservedProcurement(
  value: unknown,
  fallback: ProcurementPolicy,
): ProcurementPolicy {
  return parsedProcurement(value) ?? fallback
}

function positiveLegacyCount(value: unknown): boolean {
  const raw = isRecord(value) ? value.q : value
  if (typeof raw === 'number') return Number.isSafeInteger(raw) && raw > 0
  if (typeof raw !== 'string') return false
  const normalized = raw.trim()
  if (!/^\d+$/.test(normalized)) return false
  const count = Number(normalized)
  return Number.isSafeInteger(count) && count > 0
}

function activeOrder(order: LegacyStore['orders'][number]): boolean {
  const status = text(order.status)
  const normalized = status.toLocaleLowerCase('en-US')
  return !CANCELLED_STATUS_ALIASES.some((alias) => alias === status || alias === normalized)
}

function positiveSaladCount(value: unknown): boolean {
  if (!isRecord(value)) return positiveLegacyCount(value)
  return positiveLegacyCount(value.o) || positiveLegacyCount(value.p)
}

function persistedItemIsUsed(
  item: Pick<PreparationCatalogItem, 'category' | 'name' | 'legacyNames'>,
  store: Readonly<LegacyStore>,
): boolean {
  const names = new Set([item.name, ...(item.legacyNames ?? [])])
  return store.orders.some((order) => {
    if (!activeOrder(order)) return false
    if (item.category === 'custom') {
      return Array.isArray(order.custom) && order.custom.some(
        (entry) =>
          isRecord(entry) &&
          names.has(text(entry.name)) &&
          positiveLegacyCount(entry.qty),
      )
    }
    const source = (order as Readonly<Record<string, unknown>>)[item.category]
    if (!isRecord(source)) return false
    return [...names].some((name) =>
      item.category === 'salads'
        ? positiveSaladCount(source[name])
        : positiveLegacyCount(source[name]),
    )
  })
}

function reviewedLegacyItemIsUsed(
  item: (typeof REVIEWED_LEGACY_PREPARATION_ITEMS)[number],
  store: Readonly<LegacyStore>,
): boolean {
  return persistedItemIsUsed(item, store)
}

function validPersistedItem(value: unknown): PreparationCatalogItem | null {
  if (!isRecord(value)) return null
  const id = StableCatalogIdSchema.safeParse(value.id)
  const category = value.category
  const name = text(value.name)
  const procurement = parsedProcurement(value.procurement)
  if (
    !id.success ||
    !['salads', 'firsts', 'mains', 'sides', 'desserts', 'extras', 'custom'].includes(
      category as string,
    ) ||
    name === '' ||
    procurement === null
  ) {
    return null
  }
  const legacyNames = preservedTextList(value.legacyNames)
  return {
    id: id.data,
    category: category as PreparationCatalogItem['category'],
    name,
    ...(legacyNames === undefined ? {} : { legacyNames }),
    procurement,
  }
}

function validPersistedLunchItem(value: unknown): LunchCatalogItem | null {
  if (!isRecord(value)) return null
  const key = text(value.key)
  const name = text(value.name)
  if (key === '' || name === '') return null
  const legacyKeys = preservedTextList(value.legacyKeys)
  const allowsSides = value.allowsSides === true
  let addon: LunchCatalogAddon | undefined
  if (value.addon !== undefined) {
    if (!isRecord(value.addon)) return null
    const itemId = StableCatalogIdSchema.safeParse(value.addon.itemId)
    const addonName = text(value.addon.name)
    const procurement = parsedProcurement(value.addon.procurement)
    if (!itemId.success || addonName === '' || procurement === null) return null
    addon = { itemId: itemId.data, name: addonName, procurement }
  }
  const shared = {
    key,
    name,
    ...(legacyKeys === undefined ? {} : { legacyKeys }),
    ...(allowsSides ? { allowsSides: true } : {}),
    ...(addon === undefined ? {} : { addon }),
  }
  if (Array.isArray(value.variants) && value.variants.length > 0) {
    if (value.itemId !== undefined || value.procurement !== undefined) return null
    const keys = new Set<string>()
    const variants: LunchCatalogVariant[] = []
    for (const rawVariant of value.variants) {
      if (!isRecord(rawVariant)) return null
      const variantKey = text(rawVariant.key)
      const itemId = StableCatalogIdSchema.safeParse(rawVariant.itemId)
      const variantName = text(rawVariant.name)
      const procurement = parsedProcurement(rawVariant.procurement)
      if (
        variantKey === '' ||
        keys.has(variantKey) ||
        !itemId.success ||
        variantName === '' ||
        procurement === null
      ) {
        return null
      }
      keys.add(variantKey)
      variants.push({ key: variantKey, itemId: itemId.data, name: variantName, procurement })
    }
    return {
      ...shared,
      variants: variants as [LunchCatalogVariant, ...LunchCatalogVariant[]],
    }
  }
  if (value.variants !== undefined) return null
  const itemId = StableCatalogIdSchema.safeParse(value.itemId)
  const procurement = parsedProcurement(value.procurement)
  if (!itemId.success || procurement === null) return null
  return { ...shared, itemId: itemId.data, procurement }
}

function persistedLunchItemIsUsed(item: LunchCatalogItem, store: Readonly<LegacyStore>): boolean {
  const keys = new Set([item.key, ...(item.legacyKeys ?? [])])
  return store.orders.some(
    (order) =>
      activeOrder(order) &&
      isRecord(order.lunch) &&
      [...keys].some((key) => positiveLegacyCount(order.lunch?.[key])),
  )
}

export function buildPreparationCatalog(
  catalog: SettingsCatalog,
  store: Readonly<LegacyStore> = { orders: [] },
): PreparationCatalog {
  const previous = preparationSource(store)
  const previousItems = Array.isArray(previous.items) ? previous.items : []
  const previousLunch = Array.isArray(previous.lunchItems) ? previous.lunchItems : []
  const findPreviousItem = (
    itemId: string,
    category?: string,
    name?: string,
  ): Readonly<Record<string, unknown>> | undefined =>
    previousItems.find((value) => isRecord(value) && text(value.id) === itemId) as
      | Readonly<Record<string, unknown>>
      | undefined ?? previousItems.find(
        (value) =>
          isRecord(value) &&
          category !== undefined &&
          name !== undefined &&
          value.category === category &&
          text(value.name) === name,
      ) as Readonly<Record<string, unknown>> | undefined

  const items: PreparationCatalogItem[] = [
    ...MENU_CATEGORY_KEYS.flatMap((category) =>
      catalog.categories[category].map((item) => {
        const source = findPreviousItem(item.id)
        const legacyNames = preservedTextList(source?.legacyNames)
        return {
          ...preservedUnknownFields(source, ['id', 'category', 'name', 'legacyNames', 'procurement']),
          id: item.id,
          category,
          name: item.name,
          ...(legacyNames === undefined ? {} : { legacyNames }),
          procurement: preservedProcurement(source?.procurement, { kind: 'recipe' }),
        }
      }),
    ),
    ...catalog.extras.map((item) => {
      const source = findPreviousItem(item.id)
      const legacyNames = preservedTextList(source?.legacyNames)
      const fallback: ProcurementPolicy = (NON_RECIPE_EXTRA_NAMES as readonly string[]).includes(item.name)
        ? { kind: 'none' }
        : { kind: 'recipe' }
      return {
        ...preservedUnknownFields(source, ['id', 'category', 'name', 'legacyNames', 'procurement']),
        id: item.id,
        category: 'extras' as const,
        name: item.name,
        ...(legacyNames === undefined ? {} : { legacyNames }),
        procurement: preservedProcurement(source?.procurement, fallback),
      }
    }),
    ...REVIEWED_LEGACY_PREPARATION_ITEMS.flatMap((item) => {
      const source = findPreviousItem(item.id, item.category, item.name)
      if (source === undefined && !reviewedLegacyItemIsUsed(item, store)) return []
      const legacyNames = preservedTextList(source?.legacyNames)
      return [{
        ...preservedUnknownFields(source, ['id', 'category', 'name', 'legacyNames', 'procurement']),
        id: item.id,
        category: item.category,
        name: item.name,
        ...(legacyNames === undefined ? {} : { legacyNames }),
        procurement: preservedProcurement(source?.procurement, { kind: 'recipe' }),
      }]
    }),
  ]

  const knownItemIds = new Set(items.map((item) => item.id))
  const knownCustomNames = new Set(
    items.filter((item) => item.category === 'custom').map((item) => item.name),
  )
  for (const value of previousItems) {
    const persisted = validPersistedItem(value)
    if (
      persisted?.category !== 'custom' ||
      knownItemIds.has(persisted.id) ||
      knownCustomNames.has(persisted.name)
    ) {
      continue
    }
    const source = value as Readonly<Record<string, unknown>>
    items.push({
      ...preservedUnknownFields(source, ['id', 'category', 'name', 'legacyNames', 'procurement']),
      ...persisted,
    })
    knownItemIds.add(persisted.id)
    knownCustomNames.add(persisted.name)
  }

  const lunchItems = catalog.lunch.map((item) => {
    const source = previousLunch.find(
      (value) => isRecord(value) && text(value.key) === item.key,
    )
    const sourceRecord = isRecord(source) ? source : {}
    const legacyKeys = preservedTextList(sourceRecord.legacyKeys)
    const addonSource = isRecord(sourceRecord.addon) ? sourceRecord.addon : {}
    const addon = item.addon === null
      ? undefined
      : {
          ...preservedUnknownFields(addonSource, ['itemId', 'name', 'procurement']),
          itemId: item.addon.id,
          name: item.addon.name,
          procurement: preservedProcurement(addonSource.procurement, { kind: 'recipe' }),
        }
    const shared = {
      ...preservedUnknownFields(sourceRecord, [
        'key',
        'name',
        'legacyKeys',
        'allowsSides',
        'addon',
        'itemId',
        'procurement',
        'variants',
      ]),
      key: item.key,
      name: item.name,
      ...(legacyKeys === undefined ? {} : { legacyKeys }),
      ...(item.allowsSides ? { allowsSides: true } : {}),
      ...(addon === undefined ? {} : { addon }),
    }
    if (item.itemId !== null) {
      return {
        ...shared,
        itemId: item.itemId,
        procurement: preservedProcurement(sourceRecord.procurement, { kind: 'recipe' }),
      }
    }
    const previousVariants = Array.isArray(sourceRecord.variants) ? sourceRecord.variants : []
    const variants = item.variants.map((variant) => {
      const variantSource = previousVariants.find(
        (value) =>
          isRecord(value) &&
          (text(value.itemId) === variant.itemId || text(value.key) === variant.key),
      )
      return {
        ...preservedUnknownFields(variantSource, ['key', 'itemId', 'name', 'procurement']),
        key: variant.key,
        itemId: variant.itemId,
        name: variant.name,
        procurement: preservedProcurement(
          isRecord(variantSource) ? variantSource.procurement : undefined,
          { kind: 'recipe' },
        ),
      }
    }) as [LunchCatalogVariant, ...LunchCatalogVariant[]]
    return { ...shared, variants }
  })
  return {
    ...preservedUnknownFields(previous, ['items', 'lunchItems']),
    items,
    lunchItems,
  } as PreparationCatalog
}

function itemIdOverrides(menu: Readonly<Record<string, unknown>>, category: MenuCategoryKey) {
  const mappings = isRecord(menu.itemIds) ? menu.itemIds : {}
  return isRecord(mappings[category]) ? mappings[category] : {}
}

// Per-dish description and photo, stored alongside itemIds and keyed the same
// way (by item ID) so a rename never orphans them.
function itemMetaOverrides(menu: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return isRecord(menu.itemMeta) ? menu.itemMeta : {}
}

function itemMetaFor(
  meta: Readonly<Record<string, unknown>>,
  itemId: string,
): {
  readonly description: string
  readonly imageUrl: string | null
  readonly allergens: string
  readonly heatingInstructions: string
} {
  const entry = meta[itemId]
  if (!isRecord(entry)) {
    return { description: '', imageUrl: null, allergens: '', heatingInstructions: '' }
  }
  return {
    description: text(entry.description),
    imageUrl:
      typeof entry.imageUrl === 'string' && entry.imageUrl.trim() !== '' ? entry.imageUrl.trim() : null,
    allergens: text(entry.allergens),
    heatingInstructions: text(entry.heatingInstructions),
  }
}

function validateItemIdStructure(
  menu: Readonly<Record<string, unknown>>,
  warnings: CatalogWarning[],
): void {
  if (menu.itemIds === undefined) return
  if (!isRecord(menu.itemIds)) {
    warnings.push({
      code: 'INVALID_MENU_STRUCTURE',
      path: 'itemIds',
      message: 'itemIds must be an object',
    })
    return
  }
  for (const category of MENU_CATEGORY_KEYS) {
    if (menu.itemIds[category] !== undefined && !isRecord(menu.itemIds[category])) {
      warnings.push({
        code: 'INVALID_MENU_STRUCTURE',
        path: `itemIds.${category}`,
        message: `itemIds.${category} must be an object`,
      })
    }
  }
}

function parsePrice(
  value: unknown,
  fallback: number,
  path: string,
  warnings: CatalogWarning[],
): number {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return fallback
  }
  const parsed = parseLegacyUsdAmount(value)
  if (parsed.state !== 'invalid' && parsed.minorUnits <= MAX_PRICE_MINOR_UNITS) {
    return parsed.minorUnits
  }
  warnings.push({ code: 'INVALID_PRICE', path, message: `${path} has an invalid USD price` })
  return fallback
}

function parseCount(
  value: unknown,
  fallback: number,
  path: string,
  warnings: CatalogWarning[],
): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : Number.NaN
  if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed
  if (value !== undefined) {
    warnings.push({ code: 'INVALID_COUNT', path, message: `${path} must be a non-negative safe integer` })
  }
  return fallback
}

function normalizeCategory(
  category: MenuCategoryKey,
  source: unknown,
  menu: Readonly<Record<string, unknown>>,
  warnings: CatalogWarning[],
): CatalogItem[] {
  const defaults = DEFAULT_SETTINGS_CATALOG.categories[category]
  if (source === undefined) return defaults.map((item) => ({ ...item }))
  if (!Array.isArray(source)) {
    warnings.push({ code: 'INVALID_MENU_STRUCTURE', path: category, message: `${category} must be an array` })
    return defaults.map((item) => ({ ...item }))
  }
  const names: string[] = []
  source.slice(0, MAX_MENU_ITEMS).forEach((value, index) => {
    const name = text(value)
    if (name === '') {
      warnings.push({
        code: 'INVALID_MENU_ITEM',
        path: `${category}.${index}`,
        message: `${category}.${index} must be a nonblank menu item name`,
      })
      return
    }
    names.push(name)
  })
  const ids = itemIdOverrides(menu, category)
  const meta = itemMetaOverrides(menu)
  return names.map((name) => {
    const defaultItem = defaults.find((item) => item.name === name)
    const persistedId = text(ids[name])
    if (ids[name] !== undefined && !StableCatalogIdSchema.safeParse(persistedId).success) {
      warnings.push({
        code: 'INVALID_MENU_ITEM',
        path: `itemIds.${category}.${name}`,
        message: `${name} has an invalid persisted item ID`,
      })
    }
    const id =
      StableCatalogIdSchema.safeParse(persistedId).success
        ? persistedId
        : defaultItem?.id ?? generatedId(`custom-${category}`, name)
    return { id, name, ...itemMetaFor(meta, id) }
  })
}

function normalizeExtras(source: unknown, warnings: CatalogWarning[]): PricedCatalogItem[] {
  if (source === undefined) return DEFAULT_SETTINGS_CATALOG.extras.map((item) => ({ ...item }))
  if (!Array.isArray(source)) {
    warnings.push({ code: 'INVALID_MENU_STRUCTURE', path: 'extras', message: 'extras must be an array' })
    return DEFAULT_SETTINGS_CATALOG.extras.map((item) => ({ ...item }))
  }
  const items: PricedCatalogItem[] = []
  source.slice(0, MAX_MENU_ITEMS).forEach((value, index) => {
    if (!isRecord(value) || text(value.name) === '') {
      warnings.push({ code: 'INVALID_MENU_ITEM', path: `extras.${index}`, message: 'extra must have a name' })
      return
    }
    const name = canonicalizeChargeName(text(value.name))
    if (isAutomaticChargeName(name)) {
      warnings.push({
        code: 'SUPERSEDED_EXTRA_REMOVED',
        path: `extras.${index}`,
        message: `${name} is reserved for automatic pricing and cannot be a menu extra`,
      })
      return
    }
    const fallback = DEFAULT_SETTINGS_CATALOG.extras.find((item) => item.name === name)?.priceMinorUnits ?? 0
    items.push({
      id: text(value.id) || generatedId('extra', name),
      name,
      priceMinorUnits: parsePrice(value.price, fallback, `extras.${index}.price`, warnings),
      description: text(value.description),
      imageUrl: typeof value.imageUrl === 'string' && value.imageUrl.trim() !== '' ? value.imageUrl.trim() : null,
      allergens: text(value.allergens),
      heatingInstructions: text(value.heatingInstructions),
    })
  })
  return items
}

function overrideLunch(source: unknown, warnings: CatalogWarning[]): LunchItem[] {
  if (source === undefined) return cloneCatalog(DEFAULT_SETTINGS_CATALOG).lunch as LunchItem[]
  if (!Array.isArray(source)) {
    warnings.push({ code: 'INVALID_MENU_STRUCTURE', path: 'lunch', message: 'lunch must be an array' })
    return cloneCatalog(DEFAULT_SETTINGS_CATALOG).lunch as LunchItem[]
  }
  const knownItems = new Map(DEFAULT_SETTINGS_CATALOG.lunch.map((item) => [item.key, item]))
  const seenKeys = new Set<string>()
  for (const [index, value] of source.entries()) {
    if (!isRecord(value)) {
      warnings.push({
        code: 'INVALID_MENU_ITEM',
        path: `lunch.${index}`,
        message: 'lunch override must be an object with a known key',
      })
      continue
    }
    const key = text(value.key)
    if (key === '') {
      warnings.push({
        code: 'INVALID_MENU_ITEM',
        path: `lunch.${index}.key`,
        message: 'lunch override key must be nonblank',
      })
      continue
    }
    if (!knownItems.has(key)) {
      warnings.push({ code: 'UNKNOWN_LUNCH_OVERRIDE', path: `lunch.${index}`, message: `unknown lunch key ${key}` })
      continue
    }
    if (seenKeys.has(key)) {
      warnings.push({
        code: 'DUPLICATE_LUNCH_OVERRIDE',
        path: `lunch.${index}.key`,
        message: `duplicate lunch override key ${key}`,
      })
      continue
    }
    seenKeys.add(key)

    const defaultItem = knownItems.get(key)!
    if (value.variants !== undefined && !Array.isArray(value.variants)) {
      warnings.push({
        code: 'INVALID_MENU_STRUCTURE',
        path: `lunch.${index}.variants`,
        message: 'lunch variants must be an array',
      })
    } else if (Array.isArray(value.variants)) {
      const knownVariants = new Set(defaultItem.variants.map((variant) => variant.key))
      const seenVariants = new Set<string>()
      value.variants.forEach((rawVariant, variantIndex) => {
        const path = `lunch.${index}.variants.${variantIndex}`
        if (!isRecord(rawVariant)) {
          warnings.push({
            code: 'INVALID_MENU_ITEM',
            path,
            message: 'lunch variant override must be an object with a known key',
          })
          return
        }
        const variantKey = text(rawVariant.k ?? rawVariant.key)
        if (variantKey === '') {
          warnings.push({
            code: 'INVALID_MENU_ITEM',
            path: `${path}.key`,
            message: 'lunch variant override key must be nonblank',
          })
        } else if (!knownVariants.has(variantKey)) {
          warnings.push({
            code: 'UNKNOWN_LUNCH_OVERRIDE',
            path,
            message: `unknown lunch variant key ${variantKey}`,
          })
        } else if (seenVariants.has(variantKey)) {
          warnings.push({
            code: 'DUPLICATE_LUNCH_OVERRIDE',
            path: `${path}.key`,
            message: `duplicate lunch variant override key ${variantKey}`,
          })
        }
        seenVariants.add(variantKey)
      })
    }
    if (value.addon !== undefined && !isRecord(value.addon)) {
      warnings.push({
        code: 'INVALID_MENU_STRUCTURE',
        path: `lunch.${index}.addon`,
        message: 'lunch add-on override must be an object',
      })
    }
  }
  return DEFAULT_SETTINGS_CATALOG.lunch.map((defaultItem) => {
    const override = source.find((value) => isRecord(value) && text(value.key) === defaultItem.key)
    if (!isRecord(override)) return cloneCatalog({ ...DEFAULT_SETTINGS_CATALOG, lunch: [defaultItem] }).lunch[0]!
    const priceMinorUnits =
      defaultItem.priceMinorUnits === null
        ? null
        : parsePrice(override.price, defaultItem.priceMinorUnits, `lunch.${defaultItem.key}.price`, warnings)
    const variants = defaultItem.variants.map((defaultVariant) => {
      const values = Array.isArray(override.variants) ? override.variants : []
      const variant = values.find((value) => isRecord(value) && text(value.k ?? value.key) === defaultVariant.key)
      if (!isRecord(variant)) return { ...defaultVariant }
      return {
        ...defaultVariant,
        priceMinorUnits: parsePrice(
          variant.price,
          defaultVariant.priceMinorUnits,
          `lunch.${defaultItem.key}.${defaultVariant.key}.price`,
          warnings,
        ),
        extraSideMinorUnits:
          defaultVariant.extraSideMinorUnits === null
            ? null
            : parsePrice(
                variant.sidePrice,
                defaultVariant.extraSideMinorUnits,
                `lunch.${defaultItem.key}.${defaultVariant.key}.sidePrice`,
                warnings,
              ),
      }
    })
    const addon =
      defaultItem.addon === null
        ? null
        : {
            ...defaultItem.addon,
            priceMinorUnits: parsePrice(
              isRecord(override.addon) ? override.addon.price : undefined,
              defaultItem.addon.priceMinorUnits,
              `lunch.${defaultItem.key}.addon.price`,
              warnings,
            ),
          }
    return { ...defaultItem, priceMinorUnits, variants, addon }
  })
}

function normalizeLunchSides(source: unknown, warnings: CatalogWarning[]): CatalogItem[] {
  if (source === undefined) return DEFAULT_SETTINGS_CATALOG.lunchSides.map((item) => ({ ...item }))
  if (!Array.isArray(source)) {
    warnings.push({
      code: 'INVALID_MENU_STRUCTURE',
      path: 'lunchSides',
      message: 'lunchSides must be an array',
    })
    return DEFAULT_SETTINGS_CATALOG.lunchSides.map((item) => ({ ...item }))
  }
  const names: string[] = []
  source.slice(0, MAX_MENU_ITEMS).forEach((value, index) => {
    const name = text(value)
    if (name === '') {
      warnings.push({
        code: 'INVALID_MENU_ITEM',
        path: `lunchSides.${index}`,
        message: 'lunch side must be a nonblank item name',
      })
      return
    }
    names.push(name)
  })
  return names.map((name) => ({
    id: generatedId('lunch-side', name),
    name,
    description: '',
    imageUrl: null,
    allergens: '',
    heatingInstructions: '',
  }))
}

export function validateSettingsCatalog(catalog: SettingsCatalog): readonly CatalogWarning[] {
  const warnings: CatalogWarning[] = []
  const ids = new Set<string>()
  const prices: Array<readonly [string, number]> = [
    ['couplePriceMinorUnits', catalog.couplePriceMinorUnits],
    ['extraChallahMinorUnits', catalog.extraChallahMinorUnits],
    ['saladBlockMinorUnits', catalog.saladBlockMinorUnits],
    ['saladRemainderMinorUnits', catalog.saladRemainderMinorUnits],
    ['extraFishFilletMinorUnits', catalog.extraFishFilletMinorUnits],
    ['extraDessertHalfUnitMinorUnits', catalog.extraDessertHalfUnitMinorUnits],
  ]
  const register = (item: Pick<CatalogItem, 'id' | 'name'>, path: string): void => {
    if (!StableCatalogIdSchema.safeParse(item.id).success || text(item.name) === '') {
      warnings.push({ code: 'INVALID_MENU_ITEM', path, message: `${path} has an invalid ID or name` })
    }
    if (ids.has(item.id)) {
      warnings.push({ code: 'DUPLICATE_ITEM_ID', path: `${path}.id`, message: `duplicate item ID ${item.id}` })
    }
    ids.add(item.id)
  }
  for (const category of MENU_CATEGORY_KEYS) {
    const names = new Set<string>()
    catalog.categories[category].forEach((item, index) => {
      register(item, `${category}.${index}`)
      const normalized = canonicalCatalogName(item.name)
      if (names.has(normalized)) {
        warnings.push({ code: 'DUPLICATE_ITEM_NAME', path: `${category}.${index}.name`, message: `duplicate ${category} name` })
      }
      names.add(normalized)
    })
  }
  for (const authoritative of AUTHORITATIVE_FIRST_COURSE_ITEMS) {
    const exactMatches = catalog.categories.firsts.filter(
      (item) =>
        item.id === authoritative.id &&
        canonicalCatalogName(item.name) === canonicalCatalogName(authoritative.name),
    )
    if (exactMatches.length !== 1) {
      warnings.push({
        code: 'AUTHORITATIVE_FIRST_COURSE_REQUIRED',
        path: `firsts.${authoritative.id}`,
        message: `${authoritative.name} must retain its authoritative name and ID`,
      })
    }
  }
  catalog.categories.firsts.forEach((item, index) => {
    const exactAuthoritative = AUTHORITATIVE_FIRST_COURSE_ITEMS.some(
      (authoritative) =>
        item.id === authoritative.id &&
        canonicalCatalogName(item.name) === canonicalCatalogName(authoritative.name),
    )
    if (!exactAuthoritative) {
      warnings.push({
        code: 'UNSAFE_FIRST_COURSE_ITEM',
        path: `firsts.${index}`,
        message: `${item.name} is not an authoritative first-course fish row`,
      })
    }
  })
  const extraNames = new Set<string>()
  catalog.extras.forEach((item, index) => {
    register(item, `extras.${index}`)
    const normalized = canonicalCatalogName(item.name)
    if (extraNames.has(normalized)) {
      warnings.push({ code: 'DUPLICATE_ITEM_NAME', path: `extras.${index}.name`, message: 'duplicate extra name' })
    }
    extraNames.add(normalized)
    if (isAutomaticChargeName(item.name)) {
      warnings.push({
        code: 'SUPERSEDED_EXTRA_REMOVED',
        path: `extras.${index}`,
        message: `${item.name} is reserved for automatic pricing and cannot be a menu extra`,
      })
    }
    prices.push([`extras.${index}.price`, item.priceMinorUnits])
  })
  catalog.lunchSides.forEach((item, index) => register(item, `lunchSides.${index}`))
  const lunchKeys = new Set<string>()
  for (const item of catalog.lunch) {
    if (text(item.key) === '' || lunchKeys.has(item.key)) {
      warnings.push({ code: 'INVALID_MENU_ITEM', path: `lunch.${item.key}`, message: 'lunch item key is invalid or duplicated' })
    }
    lunchKeys.add(item.key)
    if (item.itemId !== null) register({ id: item.itemId, name: item.name }, `lunch.${item.key}`)
    if (item.priceMinorUnits !== null) prices.push([`lunch.${item.key}.price`, item.priceMinorUnits])
    for (const variant of item.variants) {
      register({ id: variant.itemId, name: `${item.name} ${variant.name}` }, `lunch.${item.key}.${variant.key}`)
      prices.push([`lunch.${item.key}.${variant.key}.price`, variant.priceMinorUnits])
      if (variant.extraSideMinorUnits !== null) {
        prices.push([`lunch.${item.key}.${variant.key}.sidePrice`, variant.extraSideMinorUnits])
      }
    }
    if (item.addon !== null) {
      register(item.addon, `lunch.${item.key}.addon`)
      prices.push([`lunch.${item.key}.addon.price`, item.addon.priceMinorUnits])
    }
  }
  if (!Number.isSafeInteger(catalog.includedChallahs) || catalog.includedChallahs < 0) {
    warnings.push({ code: 'INVALID_COUNT', path: 'includedChallahs', message: 'includedChallahs is invalid' })
  }
  for (const [path, value] of prices) {
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_PRICE_MINOR_UNITS) {
      warnings.push({ code: 'INVALID_PRICE', path, message: `${path} is invalid` })
    }
  }
  return warnings
}

export function loadSettingsCatalog(store: Readonly<LegacyStore>): CatalogResult {
  const warnings: CatalogWarning[] = []
  const menu = menuSource(store, warnings)
  validateItemIdStructure(menu, warnings)
  const catalog: SettingsCatalog = {
    couplePriceMinorUnits: parsePrice(
      menu.couplePrice,
      DEFAULT_SETTINGS_CATALOG.couplePriceMinorUnits,
      'couplePrice',
      warnings,
    ),
    extraChallahMinorUnits: parsePrice(
      menu.challahPrice,
      DEFAULT_SETTINGS_CATALOG.extraChallahMinorUnits,
      'challahPrice',
      warnings,
    ),
    includedChallahs: parseCount(
      menu.includedChallot,
      DEFAULT_SETTINGS_CATALOG.includedChallahs,
      'includedChallot',
      warnings,
    ),
    saladBlockMinorUnits: parsePrice(
      menu.saladBlockPrice,
      DEFAULT_SETTINGS_CATALOG.saladBlockMinorUnits,
      'saladBlockPrice',
      warnings,
    ),
    saladRemainderMinorUnits: parsePrice(
      menu.saladUnitPrice,
      DEFAULT_SETTINGS_CATALOG.saladRemainderMinorUnits,
      'saladUnitPrice',
      warnings,
    ),
    extraFishFilletMinorUnits: parsePrice(
      menu.fishExtraPrice,
      DEFAULT_SETTINGS_CATALOG.extraFishFilletMinorUnits,
      'fishExtraPrice',
      warnings,
    ),
    extraDessertHalfUnitMinorUnits: parsePrice(
      menu.dessertExtraPrice,
      DEFAULT_SETTINGS_CATALOG.extraDessertHalfUnitMinorUnits,
      'dessertExtraPrice',
      warnings,
    ),
    categories: Object.fromEntries(
      MENU_CATEGORY_KEYS.map((category) => [
        category,
        normalizeCategory(category, menu[category], menu, warnings),
      ]),
    ) as Record<MenuCategoryKey, CatalogItem[]>,
    extras: normalizeExtras(menu.extras, warnings),
    lunch: overrideLunch(menu.lunch, warnings),
    lunchSides: normalizeLunchSides(menu.lunchSides, warnings),
  }
  return { catalog, warnings: [...warnings, ...validateSettingsCatalog(catalog)] }
}

function persistedPreparationIssues(
  value: unknown,
  authoritative: Readonly<PreparationCatalog>,
): string[] {
  if (!isRecord(value)) return ['preparationCatalog must be an object']
  const issues: string[] = []
  const authoritativeItems = new Map(authoritative.items.map((item) => [item.id, item]))
  const authoritativeLunch = new Map(authoritative.lunchItems.map((item) => [item.key, item]))
  const validateAliases = (raw: unknown, path: string): void => {
    if (!Array.isArray(raw) || raw.some((alias) => text(alias) === '')) {
      issues.push(`${path} must contain only nonblank aliases`)
    }
  }
  const validatePolicy = (raw: unknown, path: string): void => {
    if (parsedProcurement(raw) === null) issues.push(`${path} is invalid`)
  }

  if (value.items !== undefined && !Array.isArray(value.items)) {
    issues.push('preparationCatalog.items must be an array')
  } else if (Array.isArray(value.items)) {
    value.items.forEach((rawItem, index) => {
      const path = `preparationCatalog.items.${index}`
      if (!isRecord(rawItem)) {
        issues.push(`${path} must be an object`)
        return
      }
      const id = StableCatalogIdSchema.safeParse(rawItem.id)
      const matched = id.success ? authoritativeItems.get(id.data) : undefined
      if (!id.success) {
        issues.push(`${path}.id is invalid`)
      }
      if (rawItem.category === undefined) {
        if (matched === undefined) issues.push(`${path}.category is invalid`)
      } else if (!['salads', 'firsts', 'mains', 'sides', 'desserts', 'extras', 'custom'].includes(
        String(rawItem.category),
      )) {
        issues.push(`${path}.category is invalid`)
      }
      if (rawItem.name === undefined) {
        if (matched === undefined) issues.push(`${path}.name is invalid`)
      } else if (text(rawItem.name) === '') {
        issues.push(`${path}.name is invalid`)
      }
      if (rawItem.legacyNames !== undefined) validateAliases(rawItem.legacyNames, `${path}.legacyNames`)
      if (rawItem.procurement === undefined) {
        if (matched === undefined) issues.push(`${path}.procurement is invalid`)
      } else {
        validatePolicy(rawItem.procurement, `${path}.procurement`)
      }
    })
  }

  if (value.lunchItems !== undefined && !Array.isArray(value.lunchItems)) {
    issues.push('preparationCatalog.lunchItems must be an array')
  } else if (Array.isArray(value.lunchItems)) {
    value.lunchItems.forEach((rawItem, index) => {
      const path = `preparationCatalog.lunchItems.${index}`
      if (!isRecord(rawItem)) {
        issues.push(`${path} must be an object`)
        return
      }
      const key = text(rawItem.key)
      const matched = authoritativeLunch.get(key)
      if (key === '') issues.push(`${path}.key is invalid`)
      if (rawItem.name === undefined) {
        if (matched === undefined) issues.push(`${path}.name is invalid`)
      } else if (text(rawItem.name) === '') {
        issues.push(`${path}.name is invalid`)
      }
      if (rawItem.legacyKeys !== undefined) validateAliases(rawItem.legacyKeys, `${path}.legacyKeys`)
      if (rawItem.variants !== undefined && !Array.isArray(rawItem.variants)) {
        issues.push(`${path}.variants must be an array`)
      } else if (Array.isArray(rawItem.variants)) {
        if (rawItem.variants.length === 0) issues.push(`${path}.variants must be non-empty`)
        rawItem.variants.forEach((rawVariant, variantIndex) => {
          const variantPath = `${path}.variants.${variantIndex}`
          if (!isRecord(rawVariant)) {
            issues.push(`${variantPath} must be an object`)
            return
          }
          const variantKey = text(rawVariant.key)
          const variantId = StableCatalogIdSchema.safeParse(rawVariant.itemId)
          const matchedVariant = matched?.variants?.find(
            (variant) =>
              (variantKey !== '' && variant.key === variantKey) ||
              (variantId.success && variant.itemId === variantId.data),
          )
          if (rawVariant.key === undefined) {
            if (matchedVariant === undefined) issues.push(`${variantPath}.key is invalid`)
          } else if (variantKey === '') {
            issues.push(`${variantPath}.key is invalid`)
          }
          if (rawVariant.itemId === undefined) {
            if (matchedVariant === undefined) issues.push(`${variantPath}.itemId is invalid`)
          } else if (!variantId.success) {
            issues.push(`${variantPath}.itemId is invalid`)
          }
          if (rawVariant.name === undefined) {
            if (matchedVariant === undefined) issues.push(`${variantPath}.name is invalid`)
          } else if (text(rawVariant.name) === '') {
            issues.push(`${variantPath}.name is invalid`)
          }
          if (rawVariant.procurement === undefined) {
            if (matchedVariant === undefined) issues.push(`${variantPath}.procurement is invalid`)
          } else {
            validatePolicy(rawVariant.procurement, `${variantPath}.procurement`)
          }
        })
      } else {
        if (rawItem.itemId === undefined) {
          if (matched === undefined) issues.push(`${path}.itemId is invalid`)
        } else if (!StableCatalogIdSchema.safeParse(rawItem.itemId).success) {
          issues.push(`${path}.itemId is invalid`)
        }
        if (rawItem.procurement === undefined) {
          if (matched === undefined) issues.push(`${path}.procurement is invalid`)
        } else {
          validatePolicy(rawItem.procurement, `${path}.procurement`)
        }
      }
      if (rawItem.addon !== undefined && !isRecord(rawItem.addon)) {
        issues.push(`${path}.addon must be an object`)
      } else if (isRecord(rawItem.addon)) {
        if (rawItem.addon.itemId === undefined) {
          if (matched?.addon === undefined) issues.push(`${path}.addon.itemId is invalid`)
        } else if (!StableCatalogIdSchema.safeParse(rawItem.addon.itemId).success) {
          issues.push(`${path}.addon.itemId is invalid`)
        }
        if (rawItem.addon.name === undefined) {
          if (matched?.addon === undefined) issues.push(`${path}.addon.name is invalid`)
        } else if (text(rawItem.addon.name) === '') {
          issues.push(`${path}.addon.name is invalid`)
        }
        if (rawItem.addon.procurement === undefined) {
          if (matched?.addon === undefined) issues.push(`${path}.addon.procurement is invalid`)
        } else {
          validatePolicy(rawItem.addon.procurement, `${path}.addon.procurement`)
        }
      }
    })
  }
  return issues
}

function strictRuntimePreparationCatalog(
  projected: PreparationCatalog,
  issues: string[],
): PreparationCatalog {
  const ids = new Set<string>()
  const canonicalNames = new Map<string, string>()
  const aliases = new Map<string, string>()
  const items: PreparationCatalogItem[] = []
  for (const item of projected.items) {
    const canonicalKey = JSON.stringify([item.category, item.name])
    const canonicalOwner = canonicalNames.get(canonicalKey)
    if (ids.has(item.id) || (canonicalOwner !== undefined && canonicalOwner !== item.id)) {
      issues.push(`preparation item ${item.id} conflicts with an existing item identity`)
      continue
    }
    ids.add(item.id)
    canonicalNames.set(canonicalKey, item.id)
    const legacyNames = [...new Set(item.legacyNames ?? [])].filter((alias) => {
      const key = JSON.stringify([item.category, alias])
      const namedOwner = canonicalNames.get(key)
      const aliasOwner = aliases.get(key)
      if (
        (namedOwner !== undefined && namedOwner !== item.id) ||
        (aliasOwner !== undefined && aliasOwner !== item.id)
      ) {
        issues.push(`preparation alias ${alias} conflicts in ${item.category}`)
        return false
      }
      aliases.set(key, item.id)
      return true
    })
    items.push({
      id: item.id,
      category: item.category,
      name: item.name,
      ...(legacyNames.length === 0 ? {} : { legacyNames }),
      procurement: item.procurement.kind === 'direct'
        ? { ...item.procurement }
        : { kind: item.procurement.kind },
    })
  }

  const canonicalLunchKeys = new Map<string, string>()
  const lunchAliases = new Map<string, string>()
  const lunchItems: LunchCatalogItem[] = []
  for (const item of projected.lunchItems) {
    if (canonicalLunchKeys.has(item.key)) {
      issues.push(`preparation lunch key ${item.key} conflicts with an existing item`)
      continue
    }
    const itemIds = [
      ...(item.itemId === undefined ? [] : [item.itemId]),
      ...(item.variants ?? []).map((variant) => variant.itemId),
      ...(item.addon === undefined ? [] : [item.addon.itemId]),
    ]
    if (new Set(itemIds).size !== itemIds.length || itemIds.some((id) => ids.has(id))) {
      issues.push(`preparation lunch item ${item.key} conflicts with an existing catalog ID`)
      continue
    }
    itemIds.forEach((id) => ids.add(id))
    canonicalLunchKeys.set(item.key, item.key)
    const legacyKeys = [...new Set(item.legacyKeys ?? [])].filter((alias) => {
      const namedOwner = canonicalLunchKeys.get(alias)
      const aliasOwner = lunchAliases.get(alias)
      if (
        (namedOwner !== undefined && namedOwner !== item.key) ||
        (aliasOwner !== undefined && aliasOwner !== item.key)
      ) {
        issues.push(`preparation lunch alias ${alias} conflicts`)
        return false
      }
      lunchAliases.set(alias, item.key)
      return true
    })
    const shared = {
      key: item.key,
      name: item.name,
      ...(legacyKeys.length === 0 ? {} : { legacyKeys: [...new Set(legacyKeys)] }),
      ...(item.allowsSides === true ? { allowsSides: true } : {}),
      ...(item.addon === undefined
        ? {}
        : {
            addon: {
              itemId: item.addon.itemId,
              name: item.addon.name,
              procurement: item.addon.procurement.kind === 'direct'
                ? { ...item.addon.procurement }
                : { kind: item.addon.procurement.kind },
            },
          }),
    }
    if (item.itemId !== undefined) {
      lunchItems.push({
        ...shared,
        itemId: item.itemId,
        procurement: item.procurement.kind === 'direct'
          ? { ...item.procurement }
          : { kind: item.procurement.kind },
      })
      continue
    }
    lunchItems.push({
      ...shared,
      variants: item.variants.map((variant) => ({
        key: variant.key,
        itemId: variant.itemId,
        name: variant.name,
        procurement: variant.procurement.kind === 'direct'
          ? { ...variant.procurement }
          : { kind: variant.procurement.kind },
      })) as [LunchCatalogVariant, ...LunchCatalogVariant[]],
    })
  }
  return { items, lunchItems }
}

export function resolvePreparationCatalog(
  store: Readonly<LegacyStore>,
): PreparationCatalogResolution {
  const raw = (store as Readonly<Record<string, unknown>>).preparationCatalog
  const settings = loadSettingsCatalog(store).catalog
  const projected = buildPreparationCatalog(settings, store)
  const issues = raw === undefined || raw === null
    ? []
    : persistedPreparationIssues(raw, projected)
  const menuItemIds = new Set([
    ...MENU_CATEGORY_KEYS.flatMap((category) =>
      settings.categories[category].map((item) => item.id),
    ),
    ...settings.extras.map((item) => item.id),
  ])
  const authoritativeLunchIds = new Set(
    projected.lunchItems.flatMap((item) => [
      ...(item.itemId === undefined ? [] : [item.itemId]),
      ...(item.variants ?? []).map((variant) => variant.itemId),
      ...(item.addon === undefined ? [] : [item.addon.itemId]),
    ]),
  )
  const conflictingPersistedItemIds = new Set<string>()
  const items = projected.items.filter((item) => {
    const used = persistedItemIsUsed(item, store)
    if (!menuItemIds.has(item.id) && used && authoritativeLunchIds.has(item.id)) {
      conflictingPersistedItemIds.add(item.id)
      issues.push(`persisted preparation item ${item.id} conflicts with an authoritative lunch ID`)
      return false
    }
    return menuItemIds.has(item.id) || used
  })
  const lunchItems = [...projected.lunchItems]

  if (isRecord(raw)) {
    if (Array.isArray(raw.items)) {
      for (const value of raw.items) {
        const item = validPersistedItem(value)
        if (
          item !== null &&
          persistedItemIsUsed(item, store) &&
          !authoritativeLunchIds.has(item.id) &&
          !items.some((candidate) => candidate.id === item.id)
        ) {
          items.push(item)
        } else if (
          item !== null &&
          persistedItemIsUsed(item, store) &&
          authoritativeLunchIds.has(item.id) &&
          !conflictingPersistedItemIds.has(item.id)
        ) {
          issues.push(`persisted preparation item ${item.id} conflicts with an authoritative lunch ID`)
        }
      }
    }
    if (Array.isArray(raw.lunchItems)) {
      for (const value of raw.lunchItems) {
        const item = validPersistedLunchItem(value)
        if (item === null || !persistedLunchItemIsUsed(item, store)) continue
        const existingIndex = lunchItems.findIndex((candidate) => candidate.key === item.key)
        if (existingIndex === -1) lunchItems.push(item)
        else lunchItems[existingIndex] = item
      }
    }
  }

  const catalog = strictRuntimePreparationCatalog({ items, lunchItems }, issues)
  return {
    catalog,
    state: issues.length > 0 ? 'invalid' : raw === undefined || raw === null ? 'missing' : 'configured',
    issues,
  }
}

function decimalFromMinorUnits(value: number): number {
  return Number(`${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`)
}

export function applyCatalogToStore(
  store: Readonly<LegacyStore>,
  catalog: SettingsCatalog,
): LegacyStore {
  const issues = validateSettingsCatalog(catalog)
  if (issues.length > 0) throw new Error(issues.map((issue) => issue.message).join('; '))
  const sourceIssues = loadSettingsCatalog(store).warnings.filter(
    (warning) => warning.code !== 'SUPERSEDED_EXTRA_REMOVED',
  )
  if (sourceIssues.length > 0) {
    throw new Error(sourceIssues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
  }
  const previousMenu = menuSource(store)
  const previousItemIds = isRecord(previousMenu.itemIds) ? previousMenu.itemIds : {}
  const itemIds = {
    ...previousItemIds,
    ...Object.fromEntries(
      MENU_CATEGORY_KEYS.map((category) => [
        category,
        Object.fromEntries(catalog.categories[category].map((item) => [item.name, item.id])),
      ]),
    ),
  }
  const previousExtras = Array.isArray(previousMenu.extras) ? previousMenu.extras : []
  const previousLunch = Array.isArray(previousMenu.lunch) ? previousMenu.lunch : []
  const menu = {
    ...previousMenu,
    ...Object.fromEntries(
      MENU_CATEGORY_KEYS.map((category) => [
        category,
        catalog.categories[category].map((item) => item.name),
      ]),
    ),
    extras: catalog.extras.map((item) => {
      const previous = previousExtras.find(
        (value) =>
          isRecord(value) &&
          (text(value.id) === item.id ||
            (text(value.id) === '' &&
              canonicalCatalogName(text(value.name)) === canonicalCatalogName(item.name))),
      )
      const {
        id: _id,
        name: _name,
        price: _price,
        description: _description,
        imageUrl: _imageUrl,
        allergens: _allergens,
        heatingInstructions: _heatingInstructions,
        ...unknown
      } = isRecord(previous) ? previous : {}
      return {
        ...unknown,
        id: item.id,
        name: item.name,
        price: decimalFromMinorUnits(item.priceMinorUnits),
        ...(item.description === '' ? {} : { description: item.description }),
        ...(item.imageUrl === null ? {} : { imageUrl: item.imageUrl }),
        ...(item.allergens === '' ? {} : { allergens: item.allergens }),
        ...(item.heatingInstructions === '' ? {} : { heatingInstructions: item.heatingInstructions }),
      }
    }),
    lunch: catalog.lunch.map((item) => {
      const previous = previousLunch.find(
        (value) => isRecord(value) && text(value.key) === item.key,
      )
      const {
        key: _key,
        price: _price,
        variants: _variants,
        addon: _addon,
        ...unknown
      } = isRecord(previous) ? previous : {}
      const previousVariants = isRecord(previous) && Array.isArray(previous.variants)
        ? previous.variants
        : []
      const previousAddon = isRecord(previous) && isRecord(previous.addon) ? previous.addon : {}
      return {
        ...unknown,
        key: item.key,
        ...(item.priceMinorUnits === null ? {} : { price: decimalFromMinorUnits(item.priceMinorUnits) }),
        ...(item.variants.length === 0
          ? {}
          : {
              variants: item.variants.map((variant) => {
                const previousVariant = previousVariants.find(
                  (value) =>
                    isRecord(value) && text(value.k ?? value.key) === variant.key,
                )
                const {
                  k: _variantK,
                  key: _variantKey,
                  price: _variantPrice,
                  sidePrice: _sidePrice,
                  ...variantUnknown
                } = isRecord(previousVariant) ? previousVariant : {}
                return {
                  ...variantUnknown,
                  k: variant.key,
                  price: decimalFromMinorUnits(variant.priceMinorUnits),
                  ...(variant.extraSideMinorUnits === null
                    ? {}
                    : { sidePrice: decimalFromMinorUnits(variant.extraSideMinorUnits) }),
                }
              }),
            }),
        ...(item.addon === null
          ? {}
          : {
              addon: {
                ...Object.fromEntries(
                  Object.entries(previousAddon).filter(([key]) => key !== 'price'),
                ),
                price: decimalFromMinorUnits(item.addon.priceMinorUnits),
              },
            }),
      }
    }),
    lunchSides: catalog.lunchSides.map((item) => item.name),
    couplePrice: decimalFromMinorUnits(catalog.couplePriceMinorUnits),
    challahPrice: decimalFromMinorUnits(catalog.extraChallahMinorUnits),
    includedChallot: catalog.includedChallahs,
    includedSalads: AUTHORITATIVE_ALLOWANCES.includedSaladsPerCouple,
    includedFish: AUTHORITATIVE_ALLOWANCES.includedFishUnitsPerCouple,
    fishExtraPrice: decimalFromMinorUnits(catalog.extraFishFilletMinorUnits),
    dessertExtraPrice: decimalFromMinorUnits(catalog.extraDessertHalfUnitMinorUnits),
    saladBlockPrice: decimalFromMinorUnits(catalog.saladBlockMinorUnits),
    saladUnitPrice: decimalFromMinorUnits(catalog.saladRemainderMinorUnits),
    itemMeta: (() => {
      const nextMeta: Record<string, unknown> = { ...itemMetaOverrides(previousMenu) }
      for (const category of MENU_CATEGORY_KEYS) {
        for (const item of catalog.categories[category]) {
          if (
            item.description === '' &&
            item.imageUrl === null &&
            item.allergens === '' &&
            item.heatingInstructions === ''
          ) {
            delete nextMeta[item.id]
          } else {
            nextMeta[item.id] = {
              ...(item.description === '' ? {} : { description: item.description }),
              ...(item.imageUrl === null ? {} : { imageUrl: item.imageUrl }),
              ...(item.allergens === '' ? {} : { allergens: item.allergens }),
              ...(item.heatingInstructions === '' ? {} : { heatingInstructions: item.heatingInstructions }),
            }
          }
        }
      }
      return nextMeta
    })(),
    itemIds,
  }
  return {
    ...store,
    menu,
    preparationCatalog: buildPreparationCatalog(catalog, store),
  } as LegacyStore
}

export function nextStableItemId(
  category: MenuCategoryKey | 'extra',
  name: string,
  catalog: SettingsCatalog,
): string {
  const normalized = text(name)
  if (normalized === '') throw new RangeError('name must be nonblank')
  const existingIds = new Set([
    ...MENU_CATEGORY_KEYS.flatMap((key) => catalog.categories[key].map((item) => item.id)),
    ...catalog.extras.map((item) => item.id),
    ...catalog.lunchSides.map((item) => item.id),
    ...catalog.lunch.flatMap((item) => [
      ...(item.itemId === null ? [] : [item.itemId]),
      ...item.variants.map((variant) => variant.itemId),
      ...(item.addon === null ? [] : [item.addon.id]),
    ]),
  ])
  const base = generatedId(`custom-${category}`, normalized)
  if (!existingIds.has(base)) return base
  for (let suffix = 2; suffix <= MAX_MENU_ITEMS; suffix += 1) {
    const candidate = `${base}-${suffix}`
    if (!existingIds.has(candidate)) return candidate
  }
  throw new RangeError('unable to allocate a unique stable item ID')
}

function withCatalogUpdate(
  catalog: SettingsCatalog,
  update: Partial<SettingsCatalog>,
): SettingsCatalog {
  return { ...cloneCatalog(catalog), ...update }
}

export function updateCatalogCorePrice(
  catalog: SettingsCatalog,
  field:
    | 'couplePriceMinorUnits'
    | 'extraChallahMinorUnits'
    | 'saladBlockMinorUnits'
    | 'saladRemainderMinorUnits'
    | 'extraFishFilletMinorUnits'
    | 'extraDessertHalfUnitMinorUnits',
  priceMinorUnits: number,
): SettingsCatalog {
  return withCatalogUpdate(catalog, { [field]: priceMinorUnits })
}

export function addCatalogItem(
  catalog: SettingsCatalog,
  category: MenuCategoryKey,
  rawName: string,
): SettingsCatalog {
  const name = text(rawName)
  if (name === '') throw new RangeError('name must be nonblank')
  if (category === 'firsts') {
    throw new RangeError('first-course fish rows are authoritative and cannot be added')
  }
  const items = catalog.categories[category]
  if (items.some((item) => canonicalCatalogName(item.name) === canonicalCatalogName(name))) {
    throw new RangeError('item name already exists in this category')
  }
  const categories = {
    ...catalog.categories,
    [category]: [
      ...items,
      {
        id: nextStableItemId(category, name, catalog),
        name,
        description: '',
        imageUrl: null,
        allergens: '',
        heatingInstructions: '',
      },
    ],
  }
  return withCatalogUpdate(catalog, { categories })
}

export function renameCatalogItem(
  catalog: SettingsCatalog,
  category: MenuCategoryKey,
  itemId: string,
  rawName: string,
): SettingsCatalog {
  const item = catalog.categories[category].find((candidate) => candidate.id === itemId)
  if (category === 'firsts' && item !== undefined && isAuthoritativeFirstCourseItem(item)) {
    throw new RangeError('authoritative first-course fish rows cannot be renamed')
  }
  const name = text(rawName)
  if (name === '') throw new RangeError('name must be nonblank')
  const items = catalog.categories[category]
  if (items.some((candidate) => candidate.id !== itemId && canonicalCatalogName(candidate.name) === canonicalCatalogName(name))) {
    throw new RangeError('item name already exists in this category')
  }
  const categories = {
    ...catalog.categories,
    [category]: items.map((candidate) => (candidate.id === itemId ? { ...candidate, name } : candidate)),
  }
  return withCatalogUpdate(catalog, { categories })
}

export function removeCatalogItem(
  catalog: SettingsCatalog,
  category: MenuCategoryKey,
  itemId: string,
): SettingsCatalog {
  const item = catalog.categories[category].find((candidate) => candidate.id === itemId)
  if (category === 'firsts' && item !== undefined && isAuthoritativeFirstCourseItem(item)) {
    throw new RangeError('authoritative first-course fish rows cannot be removed')
  }
  const categories = {
    ...catalog.categories,
    [category]: catalog.categories[category].filter((item) => item.id !== itemId),
  }
  return withCatalogUpdate(catalog, { categories })
}

// Drag-to-order: the array order IS the menu order, on the admin screens and
// on the public site catalog alike (the site projection preserves it).
export function moveCatalogItem(
  catalog: SettingsCatalog,
  category: MenuCategoryKey,
  itemId: string,
  targetIndex: number,
): SettingsCatalog {
  const items = catalog.categories[category]
  const fromIndex = items.findIndex((item) => item.id === itemId)
  if (fromIndex < 0) throw new RangeError('unknown catalog item')
  const boundedTarget = Math.max(0, Math.min(items.length - 1, Math.trunc(targetIndex)))
  if (boundedTarget === fromIndex) return catalog
  const reordered = [...items]
  const [moved] = reordered.splice(fromIndex, 1)
  reordered.splice(boundedTarget, 0, moved!)
  return withCatalogUpdate(catalog, {
    categories: { ...catalog.categories, [category]: reordered },
  })
}

export function addCatalogExtra(
  catalog: SettingsCatalog,
  rawName: string,
  priceMinorUnits: number,
): SettingsCatalog {
  const name = canonicalizeChargeName(text(rawName))
  if (name === '') throw new RangeError('name must be nonblank')
  if (isAutomaticChargeName(name)) {
    throw new RangeError('extra name is reserved for automatic pricing')
  }
  if (!Number.isSafeInteger(priceMinorUnits) || priceMinorUnits < 0 || priceMinorUnits > MAX_PRICE_MINOR_UNITS) {
    throw new RangeError('price must be non-negative safe USD minor units')
  }
  if (catalog.extras.some((item) => canonicalCatalogName(item.name) === canonicalCatalogName(name))) {
    throw new RangeError('extra name already exists')
  }
  return withCatalogUpdate(catalog, {
    extras: [
      ...catalog.extras,
      {
        id: nextStableItemId('extra', name, catalog),
        name,
        priceMinorUnits,
        description: '',
        imageUrl: null,
        allergens: '',
        heatingInstructions: '',
      },
    ],
  })
}

export function renameCatalogExtra(
  catalog: SettingsCatalog,
  itemId: string,
  rawName: string,
): SettingsCatalog {
  const name = canonicalizeChargeName(text(rawName))
  if (name === '') throw new RangeError('name must be nonblank')
  if (isAutomaticChargeName(name)) {
    throw new RangeError('extra name is reserved for automatic pricing')
  }
  if (catalog.extras.some((item) => item.id !== itemId && canonicalCatalogName(item.name) === canonicalCatalogName(name))) {
    throw new RangeError('extra name already exists')
  }
  return withCatalogUpdate(catalog, {
    extras: catalog.extras.map((item) => (item.id === itemId ? { ...item, name } : item)),
  })
}

export function updateCatalogExtraPrice(
  catalog: SettingsCatalog,
  itemId: string,
  priceMinorUnits: number,
): SettingsCatalog {
  if (!Number.isSafeInteger(priceMinorUnits) || priceMinorUnits < 0 || priceMinorUnits > MAX_PRICE_MINOR_UNITS) {
    throw new RangeError('price must be non-negative safe USD minor units')
  }
  return withCatalogUpdate(catalog, {
    extras: catalog.extras.map((item) => (item.id === itemId ? { ...item, priceMinorUnits } : item)),
  })
}

export function updateCatalogItemDescription(
  catalog: SettingsCatalog,
  category: MenuCategoryKey,
  itemId: string,
  rawDescription: string,
): SettingsCatalog {
  const description = text(rawDescription)
  const categories = {
    ...catalog.categories,
    [category]: catalog.categories[category].map((item) =>
      item.id === itemId ? { ...item, description } : item,
    ),
  }
  return withCatalogUpdate(catalog, { categories })
}

export function updateCatalogItemImage(
  catalog: SettingsCatalog,
  category: MenuCategoryKey,
  itemId: string,
  imageUrl: string | null,
): SettingsCatalog {
  const categories = {
    ...catalog.categories,
    [category]: catalog.categories[category].map((item) =>
      item.id === itemId ? { ...item, imageUrl } : item,
    ),
  }
  return withCatalogUpdate(catalog, { categories })
}

export function updateCatalogItemAllergens(
  catalog: SettingsCatalog,
  category: MenuCategoryKey,
  itemId: string,
  rawAllergens: string,
): SettingsCatalog {
  const allergens = text(rawAllergens)
  const categories = {
    ...catalog.categories,
    [category]: catalog.categories[category].map((item) =>
      item.id === itemId ? { ...item, allergens } : item,
    ),
  }
  return withCatalogUpdate(catalog, { categories })
}

export function updateCatalogItemHeatingInstructions(
  catalog: SettingsCatalog,
  category: MenuCategoryKey,
  itemId: string,
  rawInstructions: string,
): SettingsCatalog {
  const heatingInstructions = text(rawInstructions)
  const categories = {
    ...catalog.categories,
    [category]: catalog.categories[category].map((item) =>
      item.id === itemId ? { ...item, heatingInstructions } : item,
    ),
  }
  return withCatalogUpdate(catalog, { categories })
}

export function updateCatalogExtraDescription(
  catalog: SettingsCatalog,
  itemId: string,
  rawDescription: string,
): SettingsCatalog {
  const description = text(rawDescription)
  return withCatalogUpdate(catalog, {
    extras: catalog.extras.map((item) => (item.id === itemId ? { ...item, description } : item)),
  })
}

export function updateCatalogExtraImage(
  catalog: SettingsCatalog,
  itemId: string,
  imageUrl: string | null,
): SettingsCatalog {
  return withCatalogUpdate(catalog, {
    extras: catalog.extras.map((item) => (item.id === itemId ? { ...item, imageUrl } : item)),
  })
}

export function updateCatalogExtraAllergens(
  catalog: SettingsCatalog,
  itemId: string,
  rawAllergens: string,
): SettingsCatalog {
  const allergens = text(rawAllergens)
  return withCatalogUpdate(catalog, {
    extras: catalog.extras.map((item) => (item.id === itemId ? { ...item, allergens } : item)),
  })
}

export function updateCatalogExtraHeatingInstructions(
  catalog: SettingsCatalog,
  itemId: string,
  rawInstructions: string,
): SettingsCatalog {
  const heatingInstructions = text(rawInstructions)
  return withCatalogUpdate(catalog, {
    extras: catalog.extras.map((item) =>
      item.id === itemId ? { ...item, heatingInstructions } : item,
    ),
  })
}

export function removeCatalogExtra(catalog: SettingsCatalog, itemId: string): SettingsCatalog {
  return withCatalogUpdate(catalog, {
    extras: catalog.extras.filter((item) => item.id !== itemId),
  })
}

export type LunchPricePath =
  | { readonly kind: 'base'; readonly itemKey: string }
  | { readonly kind: 'variant'; readonly itemKey: string; readonly variantKey: string }
  | { readonly kind: 'side'; readonly itemKey: string; readonly variantKey: string }
  | { readonly kind: 'addon'; readonly itemKey: string }

export function updateLunchPrice(
  catalog: SettingsCatalog,
  path: LunchPricePath,
  priceMinorUnits: number,
): SettingsCatalog {
  if (!Number.isSafeInteger(priceMinorUnits) || priceMinorUnits < 0 || priceMinorUnits > MAX_PRICE_MINOR_UNITS) {
    throw new RangeError('price must be non-negative safe USD minor units')
  }
  let matched = false
  const lunch = catalog.lunch.map((item) => {
    if (item.key !== path.itemKey) return item
    if (path.kind === 'base') {
      if (item.priceMinorUnits === null) throw new RangeError('lunch item has no base price')
      matched = true
      return { ...item, priceMinorUnits }
    }
    if (path.kind === 'addon') {
      if (item.addon === null) throw new RangeError('lunch item has no add-on')
      matched = true
      return { ...item, addon: { ...item.addon, priceMinorUnits } }
    }
    const variants = item.variants.map((variant) => {
      if (variant.key !== path.variantKey) return variant
      if (path.kind === 'side') {
        if (variant.extraSideMinorUnits === null) throw new RangeError('variant has no side price')
        matched = true
        return { ...variant, extraSideMinorUnits: priceMinorUnits }
      }
      matched = true
      return { ...variant, priceMinorUnits }
    })
    return { ...item, variants }
  })
  if (!matched) throw new RangeError('unknown lunch price path')
  return withCatalogUpdate(catalog, {
    lunch,
  })
}

export interface OrderKitchenNotes {
  /** Union of allergens across the order's dishes, deduplicated, in menu order. */
  readonly allergens: readonly string[]
  /** One entry per ordered dish that has heating instructions configured. */
  readonly heating: readonly {
    readonly name: string
    readonly heatingInstructions: string
  }[]
}

export function splitAllergens(value: string): readonly string[] {
  return [
    ...new Set(
      value
        .split(/[,،;؛]/)
        .map((part) => part.trim())
        .filter((part) => part !== ''),
    ),
  ]
}

/**
 * Collects the kitchen-facing metadata for one order's printed bon: the union
 * of allergens across the ordered dishes and the heating instructions of every
 * ordered dish that has them. Dishes are matched to the catalog by canonical
 * name within their own section, and only positive quantities count — an order
 * with no configured metadata yields two empty lists so the bon prints nothing.
 */
export function orderKitchenNotes(
  order: Readonly<LegacyStore['orders'][number]>,
  catalog: SettingsCatalog,
): OrderKitchenNotes {
  const record = order as Readonly<Record<string, unknown>>
  const allergens: string[] = []
  const seenAllergens = new Set<string>()
  const heating: { name: string; heatingInstructions: string }[] = []
  const visit = (orderedName: string, item: CatalogItem | undefined): void => {
    if (item === undefined) return
    for (const allergen of splitAllergens(item.allergens)) {
      if (!seenAllergens.has(allergen)) {
        seenAllergens.add(allergen)
        allergens.push(allergen)
      }
    }
    if (item.heatingInstructions !== '') {
      heating.push({ name: orderedName, heatingInstructions: item.heatingInstructions })
    }
  }
  const sections: readonly {
    readonly key: string
    readonly items: readonly CatalogItem[]
    readonly salads: boolean
  }[] = [
    ...MENU_CATEGORY_KEYS.map((category) => ({
      key: category,
      items: catalog.categories[category],
      salads: category === 'salads',
    })),
    { key: 'extras', items: catalog.extras, salads: false },
  ]
  for (const section of sections) {
    const source = record[section.key]
    if (!isRecord(source)) continue
    const byName = new Map(section.items.map((item) => [canonicalCatalogName(item.name), item]))
    for (const [rawName, value] of Object.entries(source)) {
      const name = text(rawName)
      if (name === '') continue
      const positive = section.salads ? positiveSaladCount(value) : positiveLegacyCount(value)
      if (positive) visit(name, byName.get(canonicalCatalogName(name)))
    }
  }
  return { allergens, heating }
}

export interface RecipeBookRecord {
  readonly sourceIndex: number
  readonly value: unknown
  readonly valid: boolean
  readonly recipe: RecipeDefinition | null
  readonly issues: readonly string[]
}

export interface RecipeBook {
  readonly records: readonly RecipeBookRecord[]
  readonly recipes: readonly RecipeDefinition[]
  readonly missingTargets: readonly Pick<CatalogItem, 'id' | 'name'>[]
  readonly issues: readonly string[]
  readonly saveable: boolean
}

export function recipeTargets(
  catalog: SettingsCatalog,
  store: Readonly<LegacyStore> = { orders: [] },
): readonly Pick<CatalogItem, 'id' | 'name'>[] {
  const preparation = buildPreparationCatalog(catalog, store)
  return [
    ...preparation.items.flatMap((item) =>
      item.procurement.kind === 'recipe' ? [{ id: item.id, name: item.name }] : [],
    ),
    ...preparation.lunchItems.flatMap((item) => [
      ...(item.itemId !== undefined && item.procurement?.kind === 'recipe'
        ? [{ id: item.itemId, name: item.name }]
        : []),
      ...(item.variants !== undefined
        ? item.variants.flatMap((variant) =>
            variant.procurement.kind === 'recipe'
              ? [{ id: variant.itemId, name: `${item.name} — ${variant.name}` }]
              : [],
          )
        : []),
      ...(item.addon?.procurement.kind === 'recipe'
        ? [{ id: item.addon.itemId, name: item.addon.name }]
        : []),
    ]),
  ]
}

export function loadRecipeBook(
  store: Readonly<LegacyStore>,
  catalog: SettingsCatalog,
): RecipeBook {
  const raw = (store as Readonly<Record<string, unknown>>).recipes
  if (raw !== undefined && !Array.isArray(raw)) {
    const targets = recipeTargets(catalog, store)
    return {
      records: [{
        sourceIndex: 0,
        value: raw,
        valid: false,
        recipe: null,
        issues: ['recipes must be an array'],
      }],
      recipes: [],
      missingTargets: targets,
      issues: ['recipes: recipes must be an array'],
      saveable: false,
    }
  }
  const values = raw ?? []
  const records: RecipeBookRecord[] = values.map((value, sourceIndex) => {
    const result = validateRecipeDefinition(value)
    return result.valid
      ? { sourceIndex, value, valid: true, recipe: result.recipe, issues: [] }
      : { sourceIndex, value, valid: false, recipe: null, issues: result.issues }
  })
  const recipes = records.flatMap((record) => (record.recipe === null ? [] : [record.recipe]))
  const counts = new Map<string, number>()
  for (const recipe of recipes) counts.set(recipe.itemId, (counts.get(recipe.itemId) ?? 0) + 1)
  const duplicateIssues = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([itemId]) => `duplicate recipe itemId: ${itemId}`)
  const existing = new Set(recipes.map((recipe) => recipe.itemId))
  const missingTargets = recipeTargets(catalog, store).filter((target) => !existing.has(target.id))
  const issues = [
    ...records.flatMap((record) => record.issues.map((issue) => `recipes.${record.sourceIndex}: ${issue}`)),
    ...duplicateIssues,
  ]
  return { records, recipes, missingTargets, issues, saveable: issues.length === 0 }
}

export function applyRecipesToStore(
  store: Readonly<LegacyStore>,
  recipes: readonly RecipeDefinition[],
  catalog?: SettingsCatalog,
): LegacyStore {
  const issues: string[] = []
  const ids = new Set<string>()
  const parsed = recipes.map((recipe, index) => {
    const result = validateRecipeDefinition(recipe)
    if (!result.valid) {
      issues.push(...result.issues.map((issue) => `recipes.${index}: ${issue}`))
      return null
    }
    if (ids.has(result.recipe.itemId)) issues.push(`duplicate recipe itemId: ${result.recipe.itemId}`)
    ids.add(result.recipe.itemId)
    return result.recipe
  })
  if (issues.length > 0) throw new Error(issues.join('; '))
  return {
    ...store,
    recipes: parsed.filter((recipe): recipe is RecipeDefinition => recipe !== null),
    ...(catalog === undefined ? {} : { preparationCatalog: buildPreparationCatalog(catalog, store) }),
  } as LegacyStore
}

export const RecipeDraftSchema = z
  .object({
    itemId: StableCatalogIdSchema,
    name: z.string().trim().min(1).max(240).optional(),
    yield: z.string().trim().regex(/^[1-9]\d*$/),
    finishedYieldGrams: z.string().trim().regex(/^$|^[1-9]\d*$/).optional(),
    ingredients: z.array(
      z.object({
        ingredientId: StableCatalogIdSchema,
        ingredientName: z.string().trim().min(1).max(240),
        quantity: z.string(),
        unit: z.string().trim().min(1).max(80),
        wastePercent: z.string().optional(),
      }),
    ),
  })
  .strict()

export type RecipeDraft = z.infer<typeof RecipeDraftSchema>

export function createRecipeDraft(target: Pick<CatalogItem, 'id' | 'name'>): RecipeDraft {
  const itemId = StableCatalogIdSchema.parse(target.id)
  const name = text(target.name)
  if (name === '') throw new RangeError('recipe target name must be nonblank')
  return { itemId, name, yield: '', ingredients: [] }
}

export function nextStableIngredientId(
  recipeItemId: string,
  ingredients: readonly { readonly ingredientId: string }[],
): string {
  const targetId = StableCatalogIdSchema.parse(recipeItemId)
  const existing = new Set(ingredients.map((ingredient) => ingredient.ingredientId))
  const base = generatedId('ingredient', targetId)
  if (!existing.has(base)) return base
  for (let suffix = 2; suffix <= MAX_MENU_ITEMS; suffix += 1) {
    const candidate = `${base}-${suffix}`
    if (!existing.has(candidate)) return candidate
  }
  throw new RangeError('unable to allocate a unique stable ingredient ID')
}

export function validateRecipeDrafts(drafts: readonly RecipeDraft[]): {
  readonly valid: boolean
  readonly recipes: readonly RecipeDefinition[]
  readonly issues: readonly string[]
} {
  const recipes: RecipeDefinition[] = []
  const issues: string[] = []
  const ids = new Set<string>()
  drafts.forEach((draft, index) => {
    const draftResult = RecipeDraftSchema.safeParse(draft)
    if (!draftResult.success) {
      issues.push(...draftResult.error.issues.map((issue) => `recipes.${index}.${issue.path.join('.')}: ${issue.message}`))
      return
    }
    const value = {
      itemId: draft.itemId.trim(),
      ...(draft.name?.trim() ? { name: draft.name.trim() } : {}),
      yield: Number(draft.yield),
      ...(draft.finishedYieldGrams?.trim()
        ? { finishedYieldGrams: Number(draft.finishedYieldGrams.trim()) }
        : {}),
      ingredients: draft.ingredients.map((ingredient) => ({
        ingredientId: ingredient.ingredientId.trim(),
        ingredientName: ingredient.ingredientName.trim(),
        quantity: ingredient.quantity.trim(),
        unit: ingredient.unit.trim(),
        ...(ingredient.wastePercent?.trim()
          ? { wastePercent: ingredient.wastePercent.trim() }
          : {}),
      })),
    }
    const result = validateRecipeDefinition(value)
    if (!result.valid) {
      issues.push(...result.issues.map((issue) => `recipes.${index}: ${issue}`))
      return
    }
    if (ids.has(result.recipe.itemId)) {
      issues.push(`duplicate recipe itemId: ${result.recipe.itemId}`)
      return
    }
    ids.add(result.recipe.itemId)
    recipes.push(result.recipe)
  })
  return { valid: issues.length === 0, recipes, issues }
}
