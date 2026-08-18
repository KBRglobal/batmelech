import { parseLegacyUsdAmount } from './customers-finance.ts'
import { isCancelledInsightsOrder } from './insights.ts'
import { buildPreparationPlan, type PreparationItemDemand } from './preparation.ts'
import {
  effectivePriceRational,
  effectiveSupplier,
  loadProductLibrary,
  ratFromDecimal,
  ratMul,
  ratToRoundedInt,
  toComparableBaseRational,
  type ProductLibraryEntry,
} from './product-library.ts'
import { costRecipe } from './recipe-costing.ts'
import type { RecipeDefinition } from './recipes.ts'
import {
  loadRecipeBook,
  loadSettingsCatalog,
  recipeTargets,
  resolvePreparationCatalog,
  type SettingsCatalog,
} from './settings-catalog.ts'
import type { LegacyOrder, LegacyStore } from './store.ts'

/**
 * דוח עלויות — the costing report. Pure client-side computation from the store,
 * same pattern as insights: never invents a number, marks anything it cannot
 * price as partial instead of guessing.
 */

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS
const STALE_PRICE_DAYS = 30

function utcTimeFromIsoDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (match === null) return null
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isFinite(time) ? time : null
}

function sundayOf(utcDayStart: number): number {
  const weekday = new Date(utcDayStart).getUTCDay()
  return utcDayStart - weekday * DAY_MS
}

function isoFromUtcTime(time: number): string {
  return new Date(time).toISOString().slice(0, 10)
}

function shortDateLabel(time: number): string {
  const date = new Date(time)
  return `${date.getUTCDate()}.${date.getUTCMonth() + 1}`
}

// ---- Costing one preparation demand ----

interface DemandCost {
  readonly minorUnits: number
  readonly complete: boolean
}

function costDemand(
  demand: PreparationItemDemand,
  recipesById: ReadonlyMap<string, RecipeDefinition>,
  productLibrary: ReadonlyMap<string, ProductLibraryEntry>,
): DemandCost {
  if (demand.procurement.kind === 'none') return { minorUnits: 0, complete: true }

  if (demand.procurement.kind === 'direct') {
    const product = productLibrary.get(demand.procurement.ingredientId)
    const supplier = product === undefined ? null : effectiveSupplier(product)
    const listing = product === undefined || supplier === null ? null : product.listings[supplier]!
    const comparable =
      listing === null
        ? null
        : toComparableBaseRational(
            ratFromDecimal(demand.procurement.quantityPerItem),
            demand.procurement.unit,
            listing.packUnit,
          )
    if (listing === null || comparable === null) return { minorUnits: 0, complete: false }
    const perItem = ratMul(comparable, effectivePriceRational(listing))
    return {
      minorUnits: Number(ratToRoundedInt(ratMul(perItem, { num: BigInt(demand.quantity), den: 1n }))),
      complete: true,
    }
  }

  const recipe = recipesById.get(demand.itemId)
  if (recipe === undefined) return { minorUnits: 0, complete: false }
  const cost = costRecipe(recipe, productLibrary)
  return {
    minorUnits: cost.perYieldUnitMinorUnits * demand.quantity,
    complete: cost.complete,
  }
}

// ---- לפי מנה ----

export interface DishCostRow {
  readonly itemId: string
  readonly name: string
  readonly costPerPortionMinorUnits: number
  readonly costPer100gMinorUnits: number | null
  readonly complete: boolean
  readonly salePriceMinorUnits: number | null
  readonly marginMinorUnits: number | null
}

function salePricesById(catalog: SettingsCatalog): ReadonlyMap<string, number> {
  const prices = new Map<string, number>()
  for (const extra of catalog.extras) prices.set(extra.id, extra.priceMinorUnits)
  for (const item of catalog.lunch) {
    if (item.itemId !== null && item.priceMinorUnits !== null) prices.set(item.itemId, item.priceMinorUnits)
    for (const variant of item.variants) prices.set(variant.itemId, variant.priceMinorUnits)
    if (item.addon !== null) prices.set(item.addon.id, item.addon.priceMinorUnits)
  }
  return prices
}

export function computeDishCosts(store: Readonly<LegacyStore>): readonly DishCostRow[] {
  const catalog = loadSettingsCatalog(store).catalog
  const book = loadRecipeBook(store, catalog)
  const productLibrary = new Map(loadProductLibrary(store).entries.map((entry) => [entry.id, entry]))
  const namesById = new Map(recipeTargets(catalog, store).map((target) => [target.id, target.name]))
  const prices = salePricesById(catalog)

  return book.recipes.map((recipe) => {
    const cost = costRecipe(recipe, productLibrary)
    const salePrice = prices.get(recipe.itemId) ?? null
    return {
      itemId: recipe.itemId,
      name: namesById.get(recipe.itemId) ?? recipe.name ?? recipe.itemId,
      costPerPortionMinorUnits: cost.perYieldUnitMinorUnits,
      costPer100gMinorUnits: cost.minorUnitsPer100g,
      complete: cost.complete,
      salePriceMinorUnits: salePrice,
      marginMinorUnits: salePrice === null ? null : salePrice - cost.perYieldUnitMinorUnits,
    }
  })
}

// ---- לפי הזמנה ----

export interface OrderCostRow {
  readonly orderId: string
  readonly customerName: string
  readonly serviceDate: string
  readonly costMinorUnits: number
  readonly complete: boolean
  readonly revenueMinorUnits: number | null
  readonly marginMinorUnits: number | null
}

export function computeOrderCosts(store: Readonly<LegacyStore>): readonly OrderCostRow[] {
  const resolution = resolvePreparationCatalog(store)
  const recipeBook = loadRecipeBook(store, loadSettingsCatalog(store).catalog)
  const recipesById = new Map(recipeBook.recipes.map((recipe) => [recipe.itemId, recipe]))
  const productLibrary = new Map(loadProductLibrary(store).entries.map((entry) => [entry.id, entry]))

  const rows: OrderCostRow[] = []
  for (const order of store.orders) {
    if (isCancelledInsightsOrder(order)) continue
    const orderId = typeof order.id === 'string' || typeof order.id === 'number' ? String(order.id) : ''
    const serviceDate = typeof order.date === 'string' ? order.date.trim() : ''
    if (orderId === '' || utcTimeFromIsoDate(serviceDate) === null) continue

    // Building a single-order plan keeps the per-order attribution that the
    // shared plan deliberately drops when it aggregates a whole date.
    const demands = buildPreparationPlan([order as LegacyOrder], resolution.catalog).itemDemands
    let costMinorUnits = 0
    let complete = resolution.state === 'configured'
    for (const demand of demands) {
      const cost = costDemand(demand, recipesById, productLibrary)
      costMinorUnits += cost.minorUnits
      if (!cost.complete) complete = false
    }

    const revenue = parseLegacyUsdAmount(order.total)
    const revenueMinorUnits = revenue.state === 'valid' ? revenue.minorUnits : null
    rows.push({
      orderId,
      customerName: typeof order.name === 'string' ? order.name : '',
      serviceDate,
      costMinorUnits,
      complete,
      revenueMinorUnits,
      marginMinorUnits: revenueMinorUnits === null ? null : revenueMinorUnits - costMinorUnits,
    })
  }
  return rows.sort((left, right) => (left.serviceDate < right.serviceDate ? -1 : left.serviceDate > right.serviceDate ? 1 : 0))
}

// ---- לפי שבוע ----

export interface WeeklyCostRow {
  readonly weekStartIso: string
  readonly label: string
  readonly costMinorUnits: number
  readonly revenueMinorUnits: number
  readonly marginMinorUnits: number
  readonly orderCount: number
  readonly complete: boolean
}

export function computeWeeklyCosts(orderRows: readonly OrderCostRow[]): readonly WeeklyCostRow[] {
  const byWeek = new Map<number, { cost: number; revenue: number; count: number; complete: boolean }>()
  for (const row of orderRows) {
    const time = utcTimeFromIsoDate(row.serviceDate)
    if (time === null) continue
    const sunday = sundayOf(time)
    const bucket = byWeek.get(sunday) ?? { cost: 0, revenue: 0, count: 0, complete: true }
    bucket.cost += row.costMinorUnits
    bucket.revenue += row.revenueMinorUnits ?? 0
    bucket.count += 1
    if (!row.complete || row.revenueMinorUnits === null) bucket.complete = false
    byWeek.set(sunday, bucket)
  }
  return [...byWeek.entries()]
    .sort(([left], [right]) => left - right)
    .map(([sunday, bucket]) => ({
      weekStartIso: isoFromUtcTime(sunday),
      label: `${shortDateLabel(sunday)}–${shortDateLabel(sunday + WEEK_MS - DAY_MS)}`,
      costMinorUnits: bucket.cost,
      revenueMinorUnits: bucket.revenue,
      marginMinorUnits: bucket.revenue - bucket.cost,
      orderCount: bucket.count,
      complete: bucket.complete,
    }))
}

// ---- הוצאות לפי חודש ----

export interface MonthlyExpenseRow {
  readonly monthKey: string
  readonly label: string
  readonly expensesMinorUnits: number
  readonly revenueMinorUnits: number
  readonly invalidCount: number
}

const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
] as const

export function computeMonthlyExpenses(
  store: Readonly<Pick<LegacyStore, 'orders' | 'expenses'>>,
): readonly MonthlyExpenseRow[] {
  const months = new Map<string, { expenses: number; revenue: number; invalid: number }>()
  const bucket = (key: string) => {
    const existing = months.get(key) ?? { expenses: 0, revenue: 0, invalid: 0 }
    months.set(key, existing)
    return existing
  }

  for (const [rawDate, rawValue] of Object.entries(store.expenses ?? {})) {
    const time = utcTimeFromIsoDate(rawDate)
    if (time === null) continue
    const key = rawDate.slice(0, 7)
    const parsed = parseLegacyUsdAmount(rawValue)
    if (parsed.state === 'valid') bucket(key).expenses += parsed.minorUnits
    else if (parsed.state === 'invalid') bucket(key).invalid += 1
  }
  for (const order of store.orders) {
    if (isCancelledInsightsOrder(order)) continue
    const date = typeof order.date === 'string' ? order.date.trim() : ''
    if (utcTimeFromIsoDate(date) === null) continue
    const revenue = parseLegacyUsdAmount(order.total)
    if (revenue.state === 'valid') bucket(date.slice(0, 7)).revenue += revenue.minorUnits
  }

  return [...months.entries()]
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([monthKey, totals]) => {
      const [year, month] = monthKey.split('-')
      return {
        monthKey,
        label: `${HEBREW_MONTHS[Number(month) - 1] ?? monthKey} ${year}`,
        expensesMinorUnits: totals.expenses,
        revenueMinorUnits: totals.revenue,
        invalidCount: totals.invalid,
      }
    })
}

// ---- חוסרים ----

export interface MissingDataReport {
  readonly dishesWithoutRecipes: readonly { readonly id: string; readonly name: string }[]
  readonly unpricedIngredients: readonly { readonly ingredientId: string; readonly ingredientName: string }[]
  readonly staleProducts: readonly { readonly id: string; readonly name: string; readonly updatedAt: number }[]
}

export function computeMissingData(store: Readonly<LegacyStore>, now: number): MissingDataReport {
  const catalog = loadSettingsCatalog(store).catalog
  const book = loadRecipeBook(store, catalog)
  const productLibrary = new Map(loadProductLibrary(store).entries.map((entry) => [entry.id, entry]))

  const unpriced = new Map<string, string>()
  for (const recipe of book.recipes) {
    const cost = costRecipe(recipe, productLibrary)
    for (const warning of cost.warnings) {
      const named = cost.ingredientCosts.find((ingredient) => ingredient.ingredientId === warning.ingredientId)
      unpriced.set(warning.ingredientId, named?.ingredientName ?? warning.ingredientId)
    }
  }

  const staleBefore = now - STALE_PRICE_DAYS * DAY_MS
  const staleProducts = [...productLibrary.values()].flatMap((product) => {
    const timestamps = Object.values(product.listings).map(
      (listing) => listing.manualPrice?.at ?? listing.updatedAt,
    )
    if (timestamps.length === 0) return []
    const newest = Math.max(...timestamps)
    return newest < staleBefore ? [{ id: product.id, name: product.name, updatedAt: newest }] : []
  })

  return {
    dishesWithoutRecipes: book.missingTargets.map((target) => ({ id: target.id, name: target.name })),
    unpricedIngredients: [...unpriced.entries()].map(([ingredientId, ingredientName]) => ({
      ingredientId,
      ingredientName,
    })),
    staleProducts,
  }
}
