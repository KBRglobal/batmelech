import { checkedAdd, usdFromMinorUnits, type UsdMoney } from './money.ts'
import { parseLegacyUsdAmount } from './customers-finance.ts'
import {
  PositiveDecimalQuantitySchema,
  StableCatalogIdSchema,
  type DecimalQuantity,
} from './recipes.ts'
import type { LegacyOrder } from './store.ts'

export const PREPARATION_ITEM_CATEGORIES = [
  'salads',
  'firsts',
  'mains',
  'sides',
  'desserts',
  'extras',
  'custom',
  'lunch',
] as const

const STANDARD_CATEGORIES = ['firsts', 'mains', 'sides', 'desserts'] as const
const CATALOG_CATEGORIES = [
  'salads',
  'firsts',
  'mains',
  'sides',
  'desserts',
  'extras',
  'custom',
] as const

export const CANCELLED_STATUS_ALIASES = ['בוטלה', 'cancelled', 'canceled'] as const

export type PreparationItemCategory = (typeof PREPARATION_ITEM_CATEGORIES)[number]
export type PreparationCatalogCategory = (typeof CATALOG_CATEGORIES)[number]

export type ProcurementPolicy =
  | { readonly kind: 'recipe' }
  | {
      readonly kind: 'direct'
      readonly ingredientId: string
      readonly ingredientName: string
      readonly unit: string
      readonly quantityPerItem: DecimalQuantity
    }
  | { readonly kind: 'none' }

export interface PreparationCatalogItem {
  readonly id: string
  readonly category: PreparationCatalogCategory
  readonly name: string
  readonly legacyNames?: readonly string[]
  readonly procurement: ProcurementPolicy
}

export interface LunchCatalogVariant {
  readonly key: string
  readonly itemId: string
  readonly name: string
  readonly procurement: ProcurementPolicy
}

export interface LunchCatalogAddon {
  readonly itemId: string
  readonly name: string
  readonly procurement: ProcurementPolicy
}

export type LunchCatalogItem = Readonly<{
  key: string
  name: string
  legacyKeys?: readonly string[]
  allowsSides?: boolean
  addon?: LunchCatalogAddon
}> &
  (
    | {
        readonly itemId: string
        readonly procurement: ProcurementPolicy
        readonly variants?: undefined
      }
    | {
        readonly variants: readonly [LunchCatalogVariant, ...LunchCatalogVariant[]]
        readonly itemId?: undefined
        readonly procurement?: undefined
      }
  )

export interface PreparationCatalog {
  readonly items: readonly PreparationCatalogItem[]
  readonly lunchItems: readonly LunchCatalogItem[]
}

export class PreparationCatalogError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    super('Preparation catalog is invalid')
    this.name = 'PreparationCatalogError'
    this.issues = [...issues]
  }
}

export interface SaladPreparationQuantity {
  readonly ordered: number
  readonly gift: number
  readonly total: number
}

export interface PreparationCategoryGroups {
  readonly salads: Readonly<Record<string, SaladPreparationQuantity>>
  readonly firsts: Readonly<Record<string, number>>
  readonly mains: Readonly<Record<string, number>>
  readonly sides: Readonly<Record<string, number>>
  readonly desserts: Readonly<Record<string, number>>
  readonly extras: Readonly<Record<string, number>>
  readonly custom: Readonly<Record<string, number>>
  readonly lunch: Readonly<Record<string, number>>
}

export interface PreparationItemDemand {
  readonly serviceDate: string
  readonly category: PreparationItemCategory
  readonly itemId: string
  readonly itemName: string
  readonly quantity: number
  readonly procurement: ProcurementPolicy
  readonly orderedQuantity?: number
  readonly giftQuantity?: number
}

type LegacyOrderId = string | number | null

interface CustomerSpecificDetail {
  readonly serviceDate: string
  readonly orderId: LegacyOrderId
  readonly orderGroup: string
  readonly customerName: string
}

export interface PreparationExtraDetail extends CustomerSpecificDetail {
  readonly source: 'extra' | 'custom'
  readonly itemName: string
  readonly quantity: number
  readonly note: string
  readonly unitPrice?: string | number
}

export interface PreparationLunchSide {
  readonly itemName: string
  readonly quantity: number
}

export interface PreparationLunchDetail extends CustomerSpecificDetail {
  readonly itemKey: string
  readonly itemName: string
  readonly preparationKey: string
  readonly quantity: number
  readonly variantKey?: string
  readonly sides: readonly PreparationLunchSide[]
  readonly addonQuantity: number
}

export interface PreparationHeatNote extends CustomerSpecificDetail {
  readonly heat: string
  readonly firstCourseNote: string
  readonly text: string
}

export interface PreparationGeneralNote extends CustomerSpecificDetail {
  readonly source: 'mains' | 'general'
  readonly text: string
}

export interface PreparationFinanceSummary {
  readonly revenue: UsdMoney
  readonly deposits: UsdMoney
  readonly outstanding: UsdMoney
  readonly valid: boolean
}

export type PreparationWarningCode =
  | 'MISSING_ORDER_ID'
  | 'MISSING_SERVICE_DATE'
  | 'INVALID_SERVICE_DATE'
  | 'INVALID_QUANTITY'
  | 'QUANTITY_OVERFLOW'
  | 'INVALID_MONEY'
  | 'MONEY_OVERFLOW'
  | 'UNKNOWN_CATALOG_ITEM'
  | 'UNKNOWN_LUNCH_ITEM'
  | 'LUNCH_VARIANT_FALLBACK'
  | 'UNEXPECTED_LUNCH_FIELD'

export interface PreparationWarning {
  readonly code: PreparationWarningCode
  readonly orderId: LegacyOrderId
  readonly path: string
  readonly message: string
  readonly occurrences: number
  readonly itemCategory?: PreparationCatalogCategory
  readonly itemName?: string
}

export interface PreparationDateGroup {
  readonly serviceDate: string
  readonly orderCount: number
  readonly meals: number
  readonly aricha: number
  readonly challot: number
  readonly finance: PreparationFinanceSummary
  readonly categories: PreparationCategoryGroups
  readonly extraDetails: readonly PreparationExtraDetail[]
  readonly lunchDetails: readonly PreparationLunchDetail[]
  readonly heatNotes: readonly PreparationHeatNote[]
  readonly generalNotes: readonly PreparationGeneralNote[]
  readonly itemDemands: readonly PreparationItemDemand[]
}

export interface PreparationPlan {
  readonly complete: boolean
  readonly dates: readonly PreparationDateGroup[]
  readonly finance: PreparationFinanceSummary
  readonly itemDemands: readonly PreparationItemDemand[]
  readonly warnings: readonly PreparationWarning[]
}

interface CatalogSelection {
  readonly id: string
  readonly name: string
  readonly procurement: ProcurementPolicy
}

interface IndexedLunchItem {
  readonly key: string
  readonly name: string
  readonly allowsSides: boolean
  readonly variants?: readonly LunchCatalogVariant[]
  readonly selection?: CatalogSelection
  readonly addon?: LunchCatalogAddon
}

interface CatalogIndex {
  readonly categories: ReadonlyMap<PreparationCatalogCategory, ReadonlyMap<string, CatalogSelection>>
  readonly lunch: ReadonlyMap<string, IndexedLunchItem>
}

interface MutableSaladQuantity {
  ordered: number
  gift: number
}

interface MutableCategoryGroups {
  salads: Map<string, MutableSaladQuantity>
  firsts: Map<string, number>
  mains: Map<string, number>
  sides: Map<string, number>
  desserts: Map<string, number>
  extras: Map<string, number>
  custom: Map<string, number>
  lunch: Map<string, number>
}

interface MutableDemand {
  serviceDate: string
  category: PreparationItemCategory
  itemId: string
  itemName: string
  quantity: number
  procurement: ProcurementPolicy
  orderedQuantity?: number
  giftQuantity?: number
}

interface MutableFinanceSummary {
  revenue: number
  deposits: number
  outstanding: number
  valid: boolean
}

interface MutableDateGroup {
  serviceDate: string
  orderCount: number
  meals: number
  aricha: number
  challot: number
  finance: MutableFinanceSummary
  categories: MutableCategoryGroups
  demands: Map<string, MutableDemand>
  extraDetails: PreparationExtraDetail[]
  lunchDetails: PreparationLunchDetail[]
  heatNotes: PreparationHeatNote[]
  generalNotes: PreparationGeneralNote[]
}

interface OrderContext {
  readonly orderId: LegacyOrderId
  readonly orderGroup: string
  readonly customerName: string
  readonly serviceDate: string
  readonly warnings: PreparationWarning[]
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareNumbers(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function primitiveKey(value: string | number | undefined): string {
  if (value === undefined) return '0:'
  return typeof value === 'number' ? `1:${String(value)}` : `2:${value}`
}

function orderIdKey(orderId: LegacyOrderId): string {
  return orderId === null ? '0:' : typeof orderId === 'number' ? `1:${orderId}` : `2:${orderId}`
}

function compareCustomerDetails(left: CustomerSpecificDetail, right: CustomerSpecificDetail): number {
  return (
    compareText(left.serviceDate, right.serviceDate) ||
    compareText(orderIdKey(left.orderId), orderIdKey(right.orderId)) ||
    compareText(left.orderGroup, right.orderGroup) ||
    compareText(left.customerName, right.customerName)
  )
}

function compareWarnings(left: PreparationWarning, right: PreparationWarning): number {
  return (
    compareText(left.itemCategory ?? '', right.itemCategory ?? '') ||
    compareText(left.itemName ?? '', right.itemName ?? '') ||
    compareText(orderIdKey(left.orderId), orderIdKey(right.orderId)) ||
    compareText(left.path, right.path) ||
    compareText(left.code, right.code) ||
    compareText(left.message, right.message)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function nonBlankText(value: unknown): string {
  return text(value).trim()
}

function cloneProcurement(policy: ProcurementPolicy): ProcurementPolicy {
  return policy.kind === 'direct' ? { ...policy } : { kind: policy.kind }
}

function reportUnexpectedKeys(
  value: Readonly<Record<string, unknown>>,
  allowedKeys: readonly string[],
  path: string,
  issues: string[],
): void {
  const allowed = new Set(allowedKeys)
  for (const key of Object.keys(value).sort(compareText)) {
    if (!allowed.has(key)) issues.push(`${path}.${key} is not supported`)
  }
}

function validateProcurementPolicy(value: unknown, path: string, issues: string[]): ProcurementPolicy | null {
  if (!isRecord(value) || (value.kind !== 'recipe' && value.kind !== 'direct' && value.kind !== 'none')) {
    issues.push(`${path}.procurement must declare recipe, direct, or none`)
    return null
  }

  if (value.kind !== 'direct') {
    reportUnexpectedKeys(value, ['kind'], `${path}.procurement`, issues)
    return { kind: value.kind }
  }

  reportUnexpectedKeys(
    value,
    ['kind', 'ingredientId', 'ingredientName', 'unit', 'quantityPerItem'],
    `${path}.procurement`,
    issues,
  )

  const ingredientId = StableCatalogIdSchema.safeParse(value.ingredientId)
  const ingredientName = typeof value.ingredientName === 'string' ? value.ingredientName.trim() : ''
  const unit = typeof value.unit === 'string' ? value.unit.trim() : ''
  const quantityPerItem = PositiveDecimalQuantitySchema.safeParse(value.quantityPerItem)
  if (!ingredientId.success || ingredientName === '' || unit === '' || !quantityPerItem.success) {
    issues.push(`${path}.procurement has invalid direct-purchase metadata`)
    return null
  }

  return {
    kind: 'direct',
    ingredientId: ingredientId.data,
    ingredientName,
    unit,
    quantityPerItem: quantityPerItem.data,
  }
}

function buildCatalogIndex(catalog: PreparationCatalog): CatalogIndex {
  const issues: string[] = []
  const ids = new Set<string>()
  const categories = new Map<PreparationCatalogCategory, Map<string, CatalogSelection>>(
    CATALOG_CATEGORIES.map((category) => [category, new Map()]),
  )
  const lunch = new Map<string, IndexedLunchItem>()

  const registerId = (rawId: unknown, path: string): string | null => {
    const parsed = StableCatalogIdSchema.safeParse(rawId)
    if (!parsed.success) {
      issues.push(`${path} must be a nonblank stable catalog ID`)
      return null
    }
    if (ids.has(parsed.data)) {
      issues.push(`${path} duplicates catalog ID ${parsed.data}`)
      return null
    }
    ids.add(parsed.data)
    return parsed.data
  }

  const registerAlias = (
    target: Map<string, CatalogSelection>,
    rawAlias: unknown,
    selection: CatalogSelection,
    path: string,
  ): void => {
    const alias = typeof rawAlias === 'string' ? rawAlias.trim() : ''
    if (alias === '') {
      issues.push(`${path} must be a nonblank alias`)
      return
    }
    const existing = target.get(alias)
    if (existing !== undefined && existing.id !== selection.id) {
      issues.push(`${path} conflicts with catalog item ${existing.id}`)
      return
    }
    target.set(alias, selection)
  }

  if (!isRecord(catalog) || !Array.isArray(catalog.items) || !Array.isArray(catalog.lunchItems)) {
    throw new PreparationCatalogError(['catalog must contain items and lunchItems arrays'])
  }
  reportUnexpectedKeys(catalog, ['items', 'lunchItems'], 'catalog', issues)

  catalog.items.forEach((rawItem, index) => {
    const path = `items.${index}`
    if (!isRecord(rawItem) || !CATALOG_CATEGORIES.includes(rawItem.category as PreparationCatalogCategory)) {
      issues.push(`${path} has an invalid category`)
      return
    }
    reportUnexpectedKeys(
      rawItem,
      ['id', 'category', 'name', 'legacyNames', 'procurement'],
      path,
      issues,
    )
    if (rawItem.legacyNames !== undefined && !Array.isArray(rawItem.legacyNames)) {
      issues.push(`${path}.legacyNames must be an array`)
    }
    const category = rawItem.category as PreparationCatalogCategory
    const id = registerId(rawItem.id, `${path}.id`)
    const name = typeof rawItem.name === 'string' ? rawItem.name.trim() : ''
    const procurement = validateProcurementPolicy(rawItem.procurement, path, issues)
    if (id === null || name === '' || procurement === null) {
      if (name === '') issues.push(`${path}.name must be nonblank`)
      return
    }

    const selection = { id, name, procurement }
    const aliases = [name, ...(Array.isArray(rawItem.legacyNames) ? rawItem.legacyNames : [])]
    for (const [aliasIndex, alias] of aliases.entries()) {
      registerAlias(categories.get(category)!, alias, selection, `${path}.legacyNames.${aliasIndex}`)
    }
  })

  const canonicalLunchKeys = new Set<string>()
  catalog.lunchItems.forEach((rawItem, index) => {
    const path = `lunchItems.${index}`
    if (!isRecord(rawItem)) {
      issues.push(`${path} must be an object`)
      return
    }
    const key = typeof rawItem.key === 'string' ? rawItem.key.trim() : ''
    const name = typeof rawItem.name === 'string' ? rawItem.name.trim() : ''
    if (key === '' || name === '') {
      issues.push(`${path} must have nonblank key and name`)
      return
    }
    if (canonicalLunchKeys.has(key)) issues.push(`${path}.key duplicates lunch item ${key}`)
    canonicalLunchKeys.add(key)
    reportUnexpectedKeys(
      rawItem,
      ['key', 'name', 'legacyKeys', 'allowsSides', 'addon', 'itemId', 'procurement', 'variants'],
      path,
      issues,
    )
    if (rawItem.legacyKeys !== undefined && !Array.isArray(rawItem.legacyKeys)) {
      issues.push(`${path}.legacyKeys must be an array`)
    }
    if (rawItem.allowsSides !== undefined && typeof rawItem.allowsSides !== 'boolean') {
      issues.push(`${path}.allowsSides must be a boolean`)
    }

    const variants: LunchCatalogVariant[] = []
    let selection: CatalogSelection | undefined
    if (Array.isArray(rawItem.variants) && rawItem.variants.length > 0) {
      if (rawItem.itemId !== undefined || rawItem.procurement !== undefined) {
        issues.push(`${path} cannot declare itemId or procurement together with variants`)
      }
      const variantKeys = new Set<string>()
      rawItem.variants.forEach((rawVariant, variantIndex) => {
        const variantPath = `${path}.variants.${variantIndex}`
        if (!isRecord(rawVariant)) {
          issues.push(`${variantPath} must be an object`)
          return
        }
        reportUnexpectedKeys(
          rawVariant,
          ['key', 'itemId', 'name', 'procurement'],
          variantPath,
          issues,
        )
        const variantKey = typeof rawVariant.key === 'string' ? rawVariant.key.trim() : ''
        const variantName = typeof rawVariant.name === 'string' ? rawVariant.name.trim() : ''
        const itemId = registerId(rawVariant.itemId, `${variantPath}.itemId`)
        const procurement = validateProcurementPolicy(rawVariant.procurement, variantPath, issues)
        if (
          variantKey === '' ||
          variantName === '' ||
          itemId === null ||
          procurement === null ||
          variantKeys.has(variantKey)
        ) {
          if (variantKeys.has(variantKey)) issues.push(`${variantPath}.key is duplicated`)
          return
        }
        variantKeys.add(variantKey)
        variants.push({ key: variantKey, itemId, name: variantName, procurement })
      })
    } else {
      if (rawItem.variants !== undefined) {
        issues.push(`${path}.variants must be a non-empty array when provided`)
      }
      const itemId = registerId(rawItem.itemId, `${path}.itemId`)
      const procurement = validateProcurementPolicy(rawItem.procurement, path, issues)
      if (itemId !== null && procurement !== null) selection = { id: itemId, name, procurement }
    }

    let addon: LunchCatalogAddon | undefined
    if (rawItem.addon !== undefined) {
      const addonPath = `${path}.addon`
      if (isRecord(rawItem.addon)) {
        reportUnexpectedKeys(
          rawItem.addon,
          ['itemId', 'name', 'procurement'],
          addonPath,
          issues,
        )
        const itemId = registerId(rawItem.addon.itemId, `${addonPath}.itemId`)
        const addonName = typeof rawItem.addon.name === 'string' ? rawItem.addon.name.trim() : ''
        const procurement = validateProcurementPolicy(rawItem.addon.procurement, addonPath, issues)
        if (itemId !== null && addonName !== '' && procurement !== null) {
          addon = { itemId, name: addonName, procurement }
        } else if (addonName === '') {
          issues.push(`${addonPath}.name must be nonblank`)
        }
      } else {
        issues.push(`${addonPath} must be an object`)
      }
    }

    const indexed: IndexedLunchItem = {
      key,
      name,
      allowsSides: rawItem.allowsSides === true,
      ...(variants.length > 0 ? { variants } : {}),
      ...(selection === undefined ? {} : { selection }),
      ...(addon === undefined ? {} : { addon }),
    }
    const aliases = [key, ...(Array.isArray(rawItem.legacyKeys) ? rawItem.legacyKeys : [])]
    for (const [aliasIndex, rawAlias] of aliases.entries()) {
      const alias = typeof rawAlias === 'string' ? rawAlias.trim() : ''
      if (alias === '') {
        issues.push(`${path}.legacyKeys.${aliasIndex} must be nonblank`)
        continue
      }
      const existing = lunch.get(alias)
      if (existing !== undefined && existing.key !== key) {
        issues.push(`${path}.legacyKeys.${aliasIndex} conflicts with lunch item ${existing.key}`)
        continue
      }
      lunch.set(alias, indexed)
    }
  })

  if (issues.length > 0) throw new PreparationCatalogError(issues.sort(compareText))
  return { categories, lunch }
}

function isCancelled(order: Readonly<LegacyOrder>): boolean {
  const status = nonBlankText(order.status)
  const normalized = status.toLocaleLowerCase('en-US')
  return CANCELLED_STATUS_ALIASES.some((alias) => alias === status || alias === normalized)
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

function orderId(order: Readonly<LegacyOrder>): LegacyOrderId {
  return typeof order.id === 'string' || typeof order.id === 'number' ? order.id : null
}

function pushWarning(
  warnings: PreparationWarning[],
  context: Pick<OrderContext, 'orderId'>,
  code: PreparationWarningCode,
  path: string,
  message: string,
  item?: {
    readonly category: PreparationCatalogCategory
    readonly name: string
  },
): void {
  warnings.push({
    code,
    orderId: context.orderId,
    path,
    message,
    occurrences: 1,
    ...(item === undefined ? {} : { itemCategory: item.category, itemName: item.name }),
  })
}

function readCount(
  value: unknown,
  context: OrderContext,
  path: string,
  missingMeansZero = true,
): number | null {
  if (value === undefined || value === null) return missingMeansZero ? 0 : null

  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value >= 0) return value
  } else if (typeof value === 'string') {
    const normalized = value.trim()
    if (/^\d+$/.test(normalized)) {
      const canonical = normalized.replace(/^0+(?=\d)/, '')
      const maximum = String(Number.MAX_SAFE_INTEGER)
      if (
        canonical.length < maximum.length ||
        (canonical.length === maximum.length && canonical <= maximum)
      ) {
        return Number(canonical)
      }
    }
  }

  pushWarning(
    context.warnings,
    context,
    'INVALID_QUANTITY',
    path,
    `${path} must be a non-negative safe integer count`,
  )
  return null
}

function checkedCountAdd(
  current: number,
  quantity: number,
  context: OrderContext,
  path: string,
): number | null {
  try {
    return checkedAdd(current, quantity, path)
  } catch {
    pushWarning(
      context.warnings,
      context,
      'QUANTITY_OVERFLOW',
      path,
      `${path} exceeds the safe integer range`,
    )
    return null
  }
}

function addNumber(
  target: Map<string, number>,
  itemName: string,
  quantity: number,
  context: OrderContext,
  path: string,
): boolean {
  if (itemName === '' || quantity === 0) return false
  const next = checkedCountAdd(target.get(itemName) ?? 0, quantity, context, path)
  if (next === null) return false
  target.set(itemName, next)
  return true
}

function selectionFor(
  catalog: CatalogIndex,
  category: PreparationCatalogCategory,
  itemName: string,
  context: OrderContext,
  path: string,
): CatalogSelection | null {
  const selection = catalog.categories.get(category)?.get(itemName)
  if (selection !== undefined) return selection
  pushWarning(
    context.warnings,
    context,
    'UNKNOWN_CATALOG_ITEM',
    path,
    `${path} has no stable catalog identity or procurement classification`,
    { category, name: itemName },
  )
  return null
}

function addDemand(
  group: MutableDateGroup,
  category: PreparationItemCategory,
  selection: CatalogSelection,
  quantity: number,
  context: OrderContext,
  path: string,
  salad?: { readonly ordered: number; readonly gift: number },
): void {
  if (quantity === 0) return
  const current = group.demands.get(selection.id)
  const nextQuantity = checkedCountAdd(current?.quantity ?? 0, quantity, context, path)
  if (nextQuantity === null) return

  const demand: MutableDemand = {
    serviceDate: group.serviceDate,
    category,
    itemId: selection.id,
    itemName: selection.name,
    quantity: nextQuantity,
    procurement: cloneProcurement(selection.procurement),
  }
  if (salad === undefined) {
    group.demands.set(selection.id, demand)
    return
  }

  const nextOrdered = checkedCountAdd(
    current?.orderedQuantity ?? 0,
    salad.ordered,
    context,
    `${path}.ordered`,
  )
  const nextGift = checkedCountAdd(
    current?.giftQuantity ?? 0,
    salad.gift,
    context,
    `${path}.gift`,
  )
  if (nextOrdered === null || nextGift === null) return
  group.demands.set(selection.id, {
    ...demand,
    orderedQuantity: nextOrdered,
    giftQuantity: nextGift,
  })
}

function addStandardCategory(
  group: MutableDateGroup,
  category: (typeof STANDARD_CATEGORIES)[number],
  source: unknown,
  context: OrderContext,
  catalog: CatalogIndex,
): void {
  if (!isRecord(source)) return

  for (const [rawName, rawQuantity] of Object.entries(source)) {
    const itemName = rawName.trim()
    const path = `${category}.${rawName}`
    const quantity = readCount(rawQuantity, context, path, false)
    if (itemName === '' || quantity === null || quantity === 0) continue
    if (!addNumber(group.categories[category], itemName, quantity, context, path)) continue
    const selection = selectionFor(catalog, category, itemName, context, path)
    if (selection !== null) addDemand(group, category, selection, quantity, context, path)
  }
}

function addSalads(
  group: MutableDateGroup,
  source: unknown,
  context: OrderContext,
  catalog: CatalogIndex,
): void {
  if (!isRecord(source)) return

  for (const [rawName, rawValue] of Object.entries(source)) {
    const itemName = rawName.trim()
    const path = `salads.${rawName}`
    if (itemName === '') continue
    const ordered = readCount(isRecord(rawValue) ? rawValue.o : rawValue, context, `${path}.ordered`)
    const gift = readCount(isRecord(rawValue) ? rawValue.p : undefined, context, `${path}.gift`)
    if (ordered === null || gift === null || (ordered === 0 && gift === 0)) continue

    const current = group.categories.salads.get(itemName) ?? { ordered: 0, gift: 0 }
    const nextOrdered = checkedCountAdd(current.ordered, ordered, context, `${path}.ordered`)
    const nextGift = checkedCountAdd(current.gift, gift, context, `${path}.gift`)
    if (nextOrdered === null || nextGift === null) continue
    const nextTotal = checkedCountAdd(nextOrdered, nextGift, context, `${path}.total`)
    if (nextTotal === null) continue
    const orderTotal = checkedCountAdd(ordered, gift, context, `${path}.total`)
    if (orderTotal === null) continue
    group.categories.salads.set(itemName, { ordered: nextOrdered, gift: nextGift })

    const selection = selectionFor(catalog, 'salads', itemName, context, path)
    if (selection !== null) {
      addDemand(group, 'salads', selection, orderTotal, context, path, { ordered, gift })
    }
  }
}

function detailBase(context: OrderContext): CustomerSpecificDetail {
  return {
    serviceDate: context.serviceDate,
    orderId: context.orderId,
    orderGroup: context.orderGroup,
    customerName: context.customerName,
  }
}

function addExtras(
  group: MutableDateGroup,
  order: Readonly<LegacyOrder>,
  context: OrderContext,
  catalog: CatalogIndex,
): void {
  if (!isRecord(order.extras)) return

  for (const [rawName, rawValue] of Object.entries(order.extras)) {
    const itemName = rawName.trim()
    const path = `extras.${rawName}`
    const quantity = readCount(isRecord(rawValue) ? rawValue.q : rawValue, context, `${path}.quantity`, false)
    if (itemName === '' || quantity === null || quantity === 0) continue
    if (!addNumber(group.categories.extras, itemName, quantity, context, path)) continue

    const selection = selectionFor(catalog, 'extras', itemName, context, path)
    if (selection !== null) addDemand(group, 'extras', selection, quantity, context, path)
    group.extraDetails.push({
      ...detailBase(context),
      source: 'extra',
      itemName,
      quantity,
      note: isRecord(rawValue) ? text(rawValue.note) : '',
    })
  }
}

function primitivePrice(value: unknown): string | number | undefined {
  return typeof value === 'string' || typeof value === 'number' ? value : undefined
}

function addCustomItems(
  group: MutableDateGroup,
  order: Readonly<LegacyOrder>,
  context: OrderContext,
  catalog: CatalogIndex,
): void {
  if (!Array.isArray(order.custom)) return

  order.custom.forEach((rawValue, index) => {
    if (!isRecord(rawValue)) return
    const itemName = nonBlankText(rawValue.name)
    const path = `custom.${index}`
    const quantity = readCount(rawValue.qty, context, `${path}.quantity`, false)
    if (itemName === '' || quantity === null || quantity === 0) return
    if (!addNumber(group.categories.custom, itemName, quantity, context, path)) return

    const selection = selectionFor(catalog, 'custom', itemName, context, path)
    if (selection !== null) addDemand(group, 'custom', selection, quantity, context, path)
    const unitPrice = primitivePrice(rawValue.price)
    group.extraDetails.push({
      ...detailBase(context),
      source: 'custom',
      itemName,
      quantity,
      note: text(rawValue.note),
      ...(unitPrice === undefined ? {} : { unitPrice }),
    })
  })
}

export function lunchPreparationKey(itemKey: string, variantKey?: string): string {
  return variantKey ? `${itemKey}::${variantKey}` : itemKey
}

export function lunchAddonPreparationKey(itemKey: string): string {
  return `${itemKey}::addon`
}

function addLunch(
  group: MutableDateGroup,
  order: Readonly<LegacyOrder>,
  context: OrderContext,
  catalog: CatalogIndex,
): void {
  if (!isRecord(order.lunch)) return

  for (const [rawKey, rawValue] of Object.entries(order.lunch)) {
    const inputKey = rawKey.trim()
    const path = `lunch.${rawKey}`
    if (inputKey === '') {
      pushWarning(
        context.warnings,
        context,
        'UNKNOWN_LUNCH_ITEM',
        path,
        `${path} has a blank lunch key`,
      )
      continue
    }
    if (!isRecord(rawValue)) {
      pushWarning(
        context.warnings,
        context,
        'UNEXPECTED_LUNCH_FIELD',
        path,
        `${path} must be a lunch selection object`,
      )
      continue
    }
    const quantity = readCount(rawValue.q, context, `${path}.quantity`, false)
    if (quantity === null || quantity === 0) continue

    const item = catalog.lunch.get(inputKey)
    if (item === undefined) {
      pushWarning(
        context.warnings,
        context,
        'UNKNOWN_LUNCH_ITEM',
        path,
        `${path} has no stable lunch catalog identity`,
      )
      continue
    }

    let selection = item.selection
    let variantKey: string | undefined
    let itemName = item.name
    if (item.variants !== undefined) {
      const requestedVariant = nonBlankText(rawValue.v)
      const variant = item.variants.find((candidate) => candidate.key === requestedVariant) ?? item.variants[0]
      if (requestedVariant !== '' && variant.key !== requestedVariant) {
        pushWarning(
          context.warnings,
          context,
          'LUNCH_VARIANT_FALLBACK',
          `${path}.variant`,
          `${path}.variant ${requestedVariant} is unknown; using ${variant.key}`,
        )
      }
      variantKey = variant.key
      itemName = `${item.name} (${variant.name})`
      selection = { id: variant.itemId, name: itemName, procurement: variant.procurement }
    }
    if (selection === undefined) continue

    const sides: PreparationLunchSide[] = []
    if (rawValue.sides !== undefined && !isRecord(rawValue.sides)) {
      pushWarning(
        context.warnings,
        context,
        'UNEXPECTED_LUNCH_FIELD',
        `${path}.sides`,
        `${path}.sides must be a quantity map`,
      )
    } else if (isRecord(rawValue.sides)) {
      if (!item.allowsSides && Object.keys(rawValue.sides).length > 0) {
        pushWarning(
          context.warnings,
          context,
          'UNEXPECTED_LUNCH_FIELD',
          `${path}.sides`,
          `${path} does not allow side selections`,
        )
      } else if (item.allowsSides) {
        for (const [rawSideName, rawSideQuantity] of Object.entries(rawValue.sides)) {
          const sideName = rawSideName.trim()
          const sidePath = `${path}.sides.${rawSideName}`
          const sideQuantity = readCount(rawSideQuantity, context, sidePath, false)
          if (sideName === '' || sideQuantity === null || sideQuantity === 0) continue
          if (!addNumber(group.categories.sides, sideName, sideQuantity, context, sidePath)) continue
          const sideSelection = selectionFor(catalog, 'sides', sideName, context, sidePath)
          if (sideSelection !== null) {
            addDemand(group, 'sides', sideSelection, sideQuantity, context, sidePath)
          }
          sides.push({ itemName: sideName, quantity: sideQuantity })
        }
      }
    }

    const addonQuantity = readCount(rawValue.addon, context, `${path}.addon`) ?? 0
    if (addonQuantity > 0 && item.addon === undefined) {
      pushWarning(
        context.warnings,
        context,
        'UNEXPECTED_LUNCH_FIELD',
        `${path}.addon`,
        `${path} does not allow an add-on`,
      )
    }

    addNumber(group.categories.lunch, selection.id, quantity, context, path)
    addDemand(group, 'lunch', selection, quantity, context, path)
    if (addonQuantity > 0 && item.addon !== undefined) {
      const addonSelection = {
        id: item.addon.itemId,
        name: item.addon.name,
        procurement: item.addon.procurement,
      }
      addNumber(group.categories.lunch, addonSelection.id, addonQuantity, context, `${path}.addon`)
      addDemand(group, 'lunch', addonSelection, addonQuantity, context, `${path}.addon`)
    }

    group.lunchDetails.push({
      ...detailBase(context),
      itemKey: item.key,
      itemName,
      preparationKey: selection.id,
      quantity,
      ...(variantKey === undefined ? {} : { variantKey }),
      sides: sides.sort((left, right) => compareText(left.itemName, right.itemName)),
      addonQuantity: item.addon === undefined ? 0 : addonQuantity,
    })
  }
}

function addNotes(group: MutableDateGroup, order: Readonly<LegacyOrder>, context: OrderContext): void {
  const heat = text(order.heat)
  const firstCourseNote = text(order.firstsNote)
  if (heat !== '' || firstCourseNote !== '') {
    group.heatNotes.push({
      ...detailBase(context),
      heat,
      firstCourseNote,
      text: [heat, firstCourseNote].filter((value) => value !== '').join(' · '),
    })
  }

  const mainsNote = text(order.mainsNote)
  if (mainsNote !== '') {
    group.generalNotes.push({
      ...detailBase(context),
      source: 'mains',
      text: mainsNote,
    })
  }

  const generalNote = text(order.notes)
  if (generalNote !== '') {
    group.generalNotes.push({
      ...detailBase(context),
      source: 'general',
      text: generalNote,
    })
  }
}

function parseLegacyUsdMinorUnits(
  value: unknown,
  context: OrderContext,
  path: 'total' | 'deposit',
): number | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  const hasLeadingDollar = raw.startsWith('$')
  const hasTrailingDollar = raw.endsWith('$')
  const numericBody = hasLeadingDollar ? raw.slice(1) : hasTrailingDollar ? raw.slice(0, -1) : raw
  if (
    raw.length > 64 &&
    !(hasLeadingDollar && hasTrailingDollar) &&
    /^\d+(?:\.\d{1,2})?$/.test(numericBody)
  ) {
    pushWarning(
      context.warnings,
      context,
      'MONEY_OVERFLOW',
      path,
      `${path} exceeds the safe USD minor-unit range`,
    )
    return null
  }
  const parsed = parseLegacyUsdAmount(value)
  if (parsed.state === 'absent') return 0
  if (parsed.state === 'invalid') {
    const overflow = parsed.reason === 'overflow'
    pushWarning(
      context.warnings,
      context,
      overflow ? 'MONEY_OVERFLOW' : 'INVALID_MONEY',
      path,
      overflow
        ? `${path} exceeds the safe USD minor-unit range`
        : `${path} must be a non-negative USD amount with at most two decimal places`,
    )
    return null
  }
  return parsed.minorUnits
}

function collapseUnknownCatalogWarnings(
  warnings: readonly PreparationWarning[],
): PreparationWarning[] {
  const ordered = [...warnings].sort(compareWarnings)
  const collapsed = new Map<string, number>()
  const output: PreparationWarning[] = []

  for (const warning of ordered) {
    if (
      warning.code !== 'UNKNOWN_CATALOG_ITEM' ||
      warning.itemCategory === undefined ||
      warning.itemName === undefined
    ) {
      output.push(warning)
      continue
    }
    const key = JSON.stringify([warning.itemCategory, warning.itemName])
    const existingIndex = collapsed.get(key)
    if (existingIndex === undefined) {
      collapsed.set(key, output.length)
      output.push(warning)
      continue
    }
    const existing = output[existingIndex]!
    const merged = { ...existing, occurrences: existing.occurrences + warning.occurrences }
    output[existingIndex] = merged
  }

  return output.sort(compareWarnings)
}

function addMoneyValue(
  finance: MutableFinanceSummary,
  field: keyof Pick<MutableFinanceSummary, 'revenue' | 'deposits' | 'outstanding'>,
  amount: number,
): boolean {
  try {
    finance[field] = checkedAdd(finance[field], amount, `finance.${field}`)
    return true
  } catch {
    finance.valid = false
    return false
  }
}

function addFinance(
  targets: readonly MutableFinanceSummary[],
  order: Readonly<LegacyOrder>,
  context: OrderContext,
): void {
  const addToTargets = (
    field: keyof Pick<MutableFinanceSummary, 'revenue' | 'deposits' | 'outstanding'>,
    amount: number,
  ): void => {
    let overflowed = false
    for (const target of targets) {
      if (!addMoneyValue(target, field, amount)) overflowed = true
    }
    if (overflowed) {
      pushWarning(
        context.warnings,
        context,
        'MONEY_OVERFLOW',
        `finance.${field}`,
        `finance.${field} exceeds the safe USD minor-unit range`,
      )
    }
  }

  const total = parseLegacyUsdMinorUnits(order.total, context, 'total')
  const deposit = parseLegacyUsdMinorUnits(order.deposit, context, 'deposit')
  if (total === null || deposit === null) {
    for (const target of targets) target.valid = false
  }
  if (total !== null) addToTargets('revenue', total)
  if (deposit !== null) addToTargets('deposits', deposit)
  if (total !== null && deposit !== null) {
    const paid = nonBlankText(order.paid)
    const outstanding = paid === 'כן' || paid === 'שת"פ' ? 0 : Math.max(0, total - deposit)
    addToTargets('outstanding', outstanding)
  }
}

function createMutableFinanceSummary(): MutableFinanceSummary {
  return { revenue: 0, deposits: 0, outstanding: 0, valid: true }
}

function createMutableDateGroup(serviceDate: string): MutableDateGroup {
  return {
    serviceDate,
    orderCount: 0,
    meals: 0,
    aricha: 0,
    challot: 0,
    finance: createMutableFinanceSummary(),
    categories: {
      salads: new Map(),
      firsts: new Map(),
      mains: new Map(),
      sides: new Map(),
      desserts: new Map(),
      extras: new Map(),
      custom: new Map(),
      lunch: new Map(),
    },
    demands: new Map(),
    extraDetails: [],
    lunchDetails: [],
    heatNotes: [],
    generalNotes: [],
  }
}

function sortedNumberRecord(source: ReadonlyMap<string, number>): Record<string, number> {
  return Object.fromEntries([...source.entries()].sort(([left], [right]) => compareText(left, right)))
}

function sortedSaladRecord(
  source: ReadonlyMap<string, MutableSaladQuantity>,
): Record<string, SaladPreparationQuantity> {
  return Object.fromEntries(
    [...source.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([itemName, quantity]) => [
        itemName,
        {
          ordered: quantity.ordered,
          gift: quantity.gift,
          total: checkedAdd(quantity.ordered, quantity.gift, `salads.${itemName}.total`),
        },
      ]),
  )
}

function finalizeFinance(finance: MutableFinanceSummary): PreparationFinanceSummary {
  return {
    revenue: usdFromMinorUnits(finance.revenue),
    deposits: usdFromMinorUnits(finance.deposits),
    outstanding: usdFromMinorUnits(finance.outstanding),
    valid: finance.valid,
  }
}

function finalizeGroup(group: MutableDateGroup): PreparationDateGroup {
  const categories: PreparationCategoryGroups = {
    salads: sortedSaladRecord(group.categories.salads),
    firsts: sortedNumberRecord(group.categories.firsts),
    mains: sortedNumberRecord(group.categories.mains),
    sides: sortedNumberRecord(group.categories.sides),
    desserts: sortedNumberRecord(group.categories.desserts),
    extras: sortedNumberRecord(group.categories.extras),
    custom: sortedNumberRecord(group.categories.custom),
    lunch: sortedNumberRecord(group.categories.lunch),
  }

  const itemDemands = [...group.demands.values()]
    .sort(
      (left, right) =>
        PREPARATION_ITEM_CATEGORIES.indexOf(left.category) -
          PREPARATION_ITEM_CATEGORIES.indexOf(right.category) || compareText(left.itemId, right.itemId),
    )
    .map((demand) => ({ ...demand, procurement: cloneProcurement(demand.procurement) }))

  return {
    serviceDate: group.serviceDate,
    orderCount: group.orderCount,
    meals: group.meals,
    aricha: group.aricha,
    challot: group.challot,
    finance: finalizeFinance(group.finance),
    categories,
    extraDetails: [...group.extraDetails].sort(
      (left, right) =>
        compareCustomerDetails(left, right) ||
        compareText(left.source, right.source) ||
        compareText(left.itemName, right.itemName) ||
        compareText(left.note, right.note) ||
        compareNumbers(left.quantity, right.quantity) ||
        compareText(primitiveKey(left.unitPrice), primitiveKey(right.unitPrice)),
    ),
    lunchDetails: [...group.lunchDetails].sort(
      (left, right) =>
        compareCustomerDetails(left, right) ||
        compareText(left.preparationKey, right.preparationKey) ||
        compareText(left.itemKey, right.itemKey) ||
        compareText(left.itemName, right.itemName) ||
        compareNumbers(left.quantity, right.quantity) ||
        compareText(left.variantKey ?? '', right.variantKey ?? '') ||
        compareText(JSON.stringify(left.sides), JSON.stringify(right.sides)) ||
        compareNumbers(left.addonQuantity, right.addonQuantity),
    ),
    heatNotes: [...group.heatNotes].sort(
      (left, right) => compareCustomerDetails(left, right) || compareText(left.text, right.text),
    ),
    generalNotes: [...group.generalNotes].sort(
      (left, right) =>
        compareCustomerDetails(left, right) ||
        compareText(left.source, right.source) ||
        compareText(left.text, right.text),
    ),
    itemDemands,
  }
}

export function buildPreparationPlan(
  orders: readonly LegacyOrder[],
  catalog: PreparationCatalog,
): PreparationPlan {
  const catalogIndex = buildCatalogIndex(catalog)
  const groupsByDate = new Map<string, MutableDateGroup>()
  const warnings: PreparationWarning[] = []
  const finance = createMutableFinanceSummary()

  for (const order of orders) {
    if (isCancelled(order)) continue
    const currentOrderId = orderId(order)
    const baseContext = { orderId: currentOrderId }
    if (currentOrderId === null) {
      pushWarning(warnings, baseContext, 'MISSING_ORDER_ID', 'id', 'active order is missing a stable ID')
    }

    const serviceDate = nonBlankText(order.date)
    if (serviceDate === '') {
      pushWarning(
        warnings,
        baseContext,
        'MISSING_SERVICE_DATE',
        'date',
        'active order is omitted because its service date is blank',
      )
      continue
    }
    if (!isRealIsoDate(serviceDate)) {
      pushWarning(
        warnings,
        baseContext,
        'INVALID_SERVICE_DATE',
        'date',
        `active order is omitted because ${serviceDate} is not a real ISO calendar date`,
      )
      continue
    }

    const group = groupsByDate.get(serviceDate) ?? createMutableDateGroup(serviceDate)
    groupsByDate.set(serviceDate, group)
    const context: OrderContext = {
      orderId: currentOrderId,
      orderGroup: nonBlankText(order.group),
      customerName: text(order.name),
      serviceDate,
      warnings,
    }

    const nextOrderCount = checkedCountAdd(group.orderCount, 1, context, 'orderCount')
    if (nextOrderCount !== null) group.orderCount = nextOrderCount
    for (const field of ['meals', 'aricha', 'challot'] as const) {
      const quantity = readCount(order[field], context, field)
      if (quantity === null) continue
      const next = checkedCountAdd(group[field], quantity, context, field)
      if (next !== null) group[field] = next
    }

    addSalads(group, order.salads, context, catalogIndex)
    for (const category of STANDARD_CATEGORIES) {
      addStandardCategory(group, category, order[category], context, catalogIndex)
    }
    addExtras(group, order, context, catalogIndex)
    addCustomItems(group, order, context, catalogIndex)
    addLunch(group, order, context, catalogIndex)
    addNotes(group, order, context)
    addFinance([group.finance, finance], order, context)
  }

  const dates = [...groupsByDate.values()]
    .sort((left, right) => compareText(left.serviceDate, right.serviceDate))
    .map(finalizeGroup)
  const sortedWarnings = collapseUnknownCatalogWarnings(warnings)

  return {
    complete: sortedWarnings.length === 0,
    dates,
    finance: finalizeFinance(finance),
    itemDemands: dates.flatMap((group) => group.itemDemands),
    warnings: sortedWarnings,
  }
}

export const aggregatePreparation = buildPreparationPlan
