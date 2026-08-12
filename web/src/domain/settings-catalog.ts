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
import type {
  LunchCatalogVariant,
  PreparationCatalog,
  ProcurementPolicy,
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

export interface StoreSaveRequest {
  readonly reason:
    | 'settings'
    | 'menu'
    | 'recipes'
    | 'customers'
    | 'finance'
    | 'deliveries'
    | 'preparation'
    | 'shopping'
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
  categories: Object.fromEntries(
    MENU_CATEGORY_KEYS.map((category) => [
      category,
      DEFAULT_CATEGORY_NAMES[category].map((name, index) => ({
        id: `shabbat-${category}-${String(index + 1).padStart(2, '0')}`,
        name,
      })),
    ]),
  ) as Record<MenuCategoryKey, CatalogItem[]>,
  extras: DEFAULT_EXTRA_ROWS.map(([name, priceMinorUnits]) => ({
    id: generatedId('extra', name),
    name,
    priceMinorUnits,
  })),
  lunch: DEFAULT_LUNCH,
  lunchSides: DEFAULT_LUNCH_SIDES.map((name) => ({ id: generatedId('lunch-side', name), name })),
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

function preservedProcurement(
  value: unknown,
  fallback: ProcurementPolicy,
): ProcurementPolicy {
  if (!isRecord(value)) return fallback
  if (value.kind === 'recipe' || value.kind === 'none') return { kind: value.kind }
  if (value.kind !== 'direct') return fallback
  const ingredientId = StableCatalogIdSchema.safeParse(value.ingredientId)
  const ingredientName = text(value.ingredientName)
  const unit = text(value.unit)
  const quantity = PositiveDecimalQuantitySchema.safeParse(value.quantityPerItem)
  if (!ingredientId.success || ingredientName === '' || unit === '' || !quantity.success) {
    return fallback
  }
  return {
    kind: 'direct',
    ingredientId: ingredientId.data,
    ingredientName,
    unit,
    quantityPerItem: quantity.data,
  }
}

export function buildPreparationCatalog(
  catalog: SettingsCatalog,
  store: Readonly<LegacyStore> = { orders: [] },
): PreparationCatalog {
  const previous = preparationSource(store)
  const previousItems = Array.isArray(previous.items) ? previous.items : []
  const previousLunch = Array.isArray(previous.lunchItems) ? previous.lunchItems : []
  const findPreviousItem = (itemId: string): Readonly<Record<string, unknown>> | undefined =>
    previousItems.find((value) => isRecord(value) && text(value.id) === itemId) as
      | Readonly<Record<string, unknown>>
      | undefined

  const items = [
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
  ]

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
    return {
      id:
        StableCatalogIdSchema.safeParse(persistedId).success
          ? persistedId
          : defaultItem?.id ?? generatedId(`custom-${category}`, name),
      name,
    }
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
  return (names.length === 0 ? DEFAULT_LUNCH_SIDES : names).map((name) => ({
    id: generatedId('lunch-side', name),
    name,
  }))
}

export function validateSettingsCatalog(catalog: SettingsCatalog): readonly CatalogWarning[] {
  const warnings: CatalogWarning[] = []
  const ids = new Set<string>()
  const prices: Array<readonly [string, number]> = [
    ['couplePriceMinorUnits', catalog.couplePriceMinorUnits],
    ['extraChallahMinorUnits', catalog.extraChallahMinorUnits],
  ]
  const register = (item: CatalogItem, path: string): void => {
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
      const { id: _id, name: _name, price: _price, ...unknown } = isRecord(previous) ? previous : {}
      return {
        ...unknown,
        id: item.id,
        name: item.name,
        price: decimalFromMinorUnits(item.priceMinorUnits),
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
    fishExtraPrice: decimalFromMinorUnits(AUTHORITATIVE_ALLOWANCES.extraFishFilletMinorUnits),
    saladBlockPrice: decimalFromMinorUnits(AUTHORITATIVE_ALLOWANCES.saladBlockMinorUnits),
    saladUnitPrice: decimalFromMinorUnits(AUTHORITATIVE_ALLOWANCES.saladRemainderMinorUnits),
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
  field: 'couplePriceMinorUnits' | 'extraChallahMinorUnits',
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
  const categories = { ...catalog.categories, [category]: [...items, { id: nextStableItemId(category, name, catalog), name }] }
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
    extras: [...catalog.extras, { id: nextStableItemId('extra', name, catalog), name, priceMinorUnits }],
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
  readonly missingTargets: readonly CatalogItem[]
  readonly issues: readonly string[]
  readonly saveable: boolean
}

export function recipeTargets(
  catalog: SettingsCatalog,
  store: Readonly<LegacyStore> = { orders: [] },
): readonly CatalogItem[] {
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

export function createRecipeDraft(target: CatalogItem): RecipeDraft {
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
