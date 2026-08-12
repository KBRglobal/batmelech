import { checkedAdd } from './money.ts'
import type { PreparationItemDemand, ProcurementPolicy } from './preparation.ts'
import {
  MAX_DECIMAL_INTEGER_DIGITS,
  PositiveDecimalQuantitySchema,
  PROCUREMENT_DECIMAL_PLACES,
  StableCatalogIdSchema,
  decimalParts,
  type DecimalQuantity,
  type RecipeDefinition,
  type RecipeIngredient,
  validateRecipeDefinition,
} from './recipes.ts'

export type ShoppingListWarningCode =
  | 'INVALID_DEMAND'
  | 'DEMAND_OVERFLOW'
  | 'DEMAND_IDENTITY_CONFLICT'
  | 'MISSING_RECIPE'
  | 'INVALID_RECIPE'
  | 'INGREDIENT_IDENTITY_CONFLICT'
  | 'QUANTITY_OVERFLOW'

export interface ShoppingListWarning {
  readonly code: ShoppingListWarningCode
  readonly itemId?: string
  readonly serviceDate?: string
  readonly message: string
  readonly issues?: readonly string[]
}

export interface ShoppingListSource {
  readonly itemId: string
  readonly itemName: string
  readonly serviceDate: string
  readonly demandedQuantity: number
  readonly ingredientQuantity: DecimalQuantity
}

export interface ShoppingListItem {
  readonly ingredientId: string
  readonly ingredientName: string
  readonly quantity: DecimalQuantity
  readonly unit: string
  readonly sources: readonly ShoppingListSource[]
}

export interface ShoppingListResult {
  readonly complete: boolean
  readonly items: readonly ShoppingListItem[]
  readonly warnings: readonly ShoppingListWarning[]
}

interface ValidDemand {
  readonly itemId: string
  readonly itemName: string
  readonly serviceDate: string
  readonly quantity: number
  readonly procurement: ProcurementPolicy
}

interface AggregatedDemand {
  readonly itemId: string
  readonly itemName: string
  readonly procurement: ProcurementPolicy
  readonly quantitiesByDate: ReadonlyMap<string, number>
}

interface MutableShoppingListSource {
  itemId: string
  itemName: string
  serviceDate: string
  demandedQuantity: number
  ingredientQuantity: bigint
}

interface MutableShoppingListItem {
  ingredientId: string
  ingredientName: string
  quantity: bigint
  unit: string
  sources: Map<string, MutableShoppingListSource>
}

const OUTPUT_SCALE_FACTOR = 10n ** BigInt(PROCUREMENT_DECIMAL_PLACES)
const MAX_OUTPUT_SCALED_UNITS =
  10n ** BigInt(MAX_DECIMAL_INTEGER_DIGITS + PROCUREMENT_DECIMAL_PLACES) - 1n

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareWarnings(left: ShoppingListWarning, right: ShoppingListWarning): number {
  return (
    compareText(left.itemId ?? '', right.itemId ?? '') ||
    compareText(left.serviceDate ?? '', right.serviceDate ?? '') ||
    compareText(left.code, right.code) ||
    compareText(left.message, right.message) ||
    compareText(JSON.stringify(left.issues ?? []), JSON.stringify(right.issues ?? []))
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonBlankText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
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

function cloneProcurement(policy: ProcurementPolicy): ProcurementPolicy {
  return policy.kind === 'direct' ? { ...policy } : { kind: policy.kind }
}

function procurementKey(policy: ProcurementPolicy): string {
  return policy.kind === 'direct'
    ? JSON.stringify([
        policy.kind,
        policy.ingredientId,
        policy.ingredientName,
        policy.unit,
        policy.quantityPerItem,
      ])
    : policy.kind
}

function validateProcurement(value: unknown): ProcurementPolicy | null {
  if (!isRecord(value)) return null
  if (value.kind === 'recipe' || value.kind === 'none') {
    return Object.keys(value).length === 1 ? { kind: value.kind } : null
  }
  if (value.kind !== 'direct') return null

  const ingredientId = StableCatalogIdSchema.safeParse(value.ingredientId)
  const ingredientName = nonBlankText(value.ingredientName)
  const unit = nonBlankText(value.unit)
  const quantityPerItem = PositiveDecimalQuantitySchema.safeParse(value.quantityPerItem)
  const allowedKeys = new Set([
    'kind',
    'ingredientId',
    'ingredientName',
    'unit',
    'quantityPerItem',
  ])
  if (
    !ingredientId.success ||
    ingredientName === '' ||
    unit === '' ||
    !quantityPerItem.success ||
    Object.keys(value).some((key) => !allowedKeys.has(key))
  ) {
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

function validateDemand(value: unknown, warnings: ShoppingListWarning[]): ValidDemand | null {
  if (!isRecord(value)) {
    warnings.push({ code: 'INVALID_DEMAND', message: 'Preparation demand must be an object.' })
    return null
  }

  const itemId = StableCatalogIdSchema.safeParse(value.itemId)
  const itemName = nonBlankText(value.itemName)
  const serviceDate = nonBlankText(value.serviceDate)
  const procurement = validateProcurement(value.procurement)
  if (!itemId.success) {
    warnings.push({ code: 'INVALID_DEMAND', message: 'Preparation demand is missing an itemId.' })
    return null
  }
  if (itemName === '') {
    warnings.push({
      code: 'INVALID_DEMAND',
      itemId: itemId.data,
      message: `Preparation demand for ${itemId.data} is missing an itemName.`,
    })
    return null
  }
  if (typeof value.quantity !== 'number' || !Number.isSafeInteger(value.quantity) || value.quantity <= 0) {
    warnings.push({
      code: 'INVALID_DEMAND',
      itemId: itemId.data,
      message: `Preparation demand for ${itemId.data} must have a positive safe-integer quantity.`,
    })
    return null
  }
  if (!isRealIsoDate(serviceDate)) {
    warnings.push({
      code: 'INVALID_DEMAND',
      itemId: itemId.data,
      ...(serviceDate === '' ? {} : { serviceDate }),
      message: `Preparation demand for ${itemId.data} must have a real ISO service date.`,
    })
    return null
  }
  if (procurement === null) {
    warnings.push({
      code: 'INVALID_DEMAND',
      itemId: itemId.data,
      serviceDate,
      message: `Preparation demand for ${itemId.data} has invalid procurement metadata.`,
    })
    return null
  }

  return {
    itemId: itemId.data,
    itemName,
    serviceDate,
    quantity: value.quantity,
    procurement,
  }
}

function aggregateDemands(
  demands: readonly PreparationItemDemand[],
  warnings: ShoppingListWarning[],
): AggregatedDemand[] {
  const validDemands = demands
    .map((demand) => validateDemand(demand, warnings))
    .filter((demand): demand is ValidDemand => demand !== null)
    .sort(
      (left, right) =>
        compareText(left.itemId, right.itemId) ||
        compareText(left.serviceDate, right.serviceDate) ||
        compareText(left.itemName, right.itemName) ||
        compareText(procurementKey(left.procurement), procurementKey(right.procurement)),
    )
  const grouped = new Map<string, ValidDemand[]>()
  for (const demand of validDemands) {
    const group = grouped.get(demand.itemId) ?? []
    group.push(demand)
    grouped.set(demand.itemId, group)
  }

  const aggregated: AggregatedDemand[] = []
  for (const [itemId, group] of [...grouped.entries()].sort(([left], [right]) => compareText(left, right))) {
    const names = new Set(group.map((demand) => demand.itemName))
    const procurementPolicies = new Set(group.map((demand) => procurementKey(demand.procurement)))
    if (names.size !== 1 || procurementPolicies.size !== 1) {
      warnings.push({
        code: 'DEMAND_IDENTITY_CONFLICT',
        itemId,
        message: `Preparation demands for ${itemId} disagree on item name or procurement policy.`,
      })
      continue
    }

    const quantitiesByDate = new Map<string, number>()
    let overflow = false
    for (const demand of group) {
      try {
        quantitiesByDate.set(
          demand.serviceDate,
          checkedAdd(
            quantitiesByDate.get(demand.serviceDate) ?? 0,
            demand.quantity,
            `demand ${itemId} on ${demand.serviceDate}`,
          ),
        )
      } catch {
        overflow = true
        warnings.push({
          code: 'DEMAND_OVERFLOW',
          itemId,
          serviceDate: demand.serviceDate,
          message: `Preparation demand for ${itemId} overflows on ${demand.serviceDate}.`,
        })
        break
      }
    }
    if (overflow) continue

    aggregated.push({
      itemId,
      itemName: group[0].itemName,
      procurement: cloneProcurement(group[0].procurement),
      quantitiesByDate,
    })
  }
  return aggregated
}

function invalidRecipeItemId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  return nonBlankText(value.itemId) || undefined
}

function recipeIndex(
  recipes: readonly RecipeDefinition[],
  warnings: ShoppingListWarning[],
): {
  readonly validRecipes: ReadonlyMap<string, RecipeDefinition>
  readonly invalidItemIds: ReadonlySet<string>
} {
  const grouped = new Map<string, unknown[]>()
  const anonymous: unknown[] = []
  for (const recipe of recipes) {
    const itemId = invalidRecipeItemId(recipe)
    if (itemId === undefined) anonymous.push(recipe)
    else {
      const group = grouped.get(itemId) ?? []
      group.push(recipe)
      grouped.set(itemId, group)
    }
  }

  const validRecipes = new Map<string, RecipeDefinition>()
  const invalidItemIds = new Set<string>()
  for (const recipe of anonymous) {
    const validation = validateRecipeDefinition(recipe)
    warnings.push({
      code: 'INVALID_RECIPE',
      message: 'Recipe is invalid.',
      issues: validation.valid ? ['itemId is required'] : [...validation.issues].sort(compareText),
    })
  }

  for (const [itemId, group] of [...grouped.entries()].sort(([left], [right]) => compareText(left, right))) {
    if (group.length > 1) {
      invalidItemIds.add(itemId)
      const validationIssues = group.flatMap((recipe) => {
        const result = validateRecipeDefinition(recipe)
        return result.valid ? [] : result.issues
      })
      warnings.push({
        code: 'INVALID_RECIPE',
        itemId,
        message: `More than one recipe is configured for ${itemId}.`,
        issues: [
          'itemId must uniquely identify one recipe',
          ...[...new Set(validationIssues)].sort(compareText),
        ],
      })
      continue
    }

    const validation = validateRecipeDefinition(group[0])
    if (!validation.valid) {
      invalidItemIds.add(itemId)
      warnings.push({
        code: 'INVALID_RECIPE',
        itemId,
        message: `Recipe for ${itemId} is invalid.`,
        issues: [...validation.issues].sort(compareText),
      })
      continue
    }
    validRecipes.set(itemId, validation.recipe)
  }

  return { validRecipes, invalidItemIds }
}

function ingredientKey(ingredientId: string, unit: string): string {
  return JSON.stringify([ingredientId, unit])
}

function roundedScaledUnits(numerator: bigint, denominator: bigint): bigint | null {
  const scaledNumerator = numerator * OUTPUT_SCALE_FACTOR
  const quotient = scaledNumerator / denominator
  const roundedUp = scaledNumerator % denominator === 0n ? quotient : quotient + 1n
  return roundedUp > 0n && roundedUp <= MAX_OUTPUT_SCALED_UNITS ? roundedUp : null
}

function recipeIngredientQuantity(
  ingredient: Readonly<RecipeIngredient>,
  demandQuantity: number,
  recipeYield: number,
): bigint | null {
  const ingredientValue = decimalParts(ingredient.quantity)
  const wasteValue = decimalParts(ingredient.wastePercent ?? '0')
  const ingredientDenominator = 10n ** BigInt(ingredientValue.scale)
  const wasteDenominator = 10n ** BigInt(wasteValue.scale)
  const wasteFactorNumerator = 100n * wasteDenominator + wasteValue.coefficient
  const numerator = ingredientValue.coefficient * BigInt(demandQuantity) * wasteFactorNumerator
  const denominator =
    ingredientDenominator * BigInt(recipeYield) * 100n * wasteDenominator
  return roundedScaledUnits(numerator, denominator)
}

function directPurchaseQuantity(quantityPerItem: DecimalQuantity, demandQuantity: number): bigint | null {
  const quantity = decimalParts(quantityPerItem)
  return roundedScaledUnits(
    quantity.coefficient * BigInt(demandQuantity),
    10n ** BigInt(quantity.scale),
  )
}

function formatScaledUnits(value: bigint): DecimalQuantity {
  const integerPart = value / OUTPUT_SCALE_FACTOR
  const fractionalPart = (value % OUTPUT_SCALE_FACTOR)
    .toString()
    .padStart(PROCUREMENT_DECIMAL_PLACES, '0')
    .replace(/0+$/, '')
  return fractionalPart === '' ? integerPart.toString() : `${integerPart}.${fractionalPart}`
}

function sourceKey(itemId: string, serviceDate: string): string {
  return JSON.stringify([itemId, serviceDate])
}

function addIngredient(
  items: Map<string, MutableShoppingListItem>,
  conflictedKeys: Map<string, Set<string>>,
  overflowKeys: Set<string>,
  ingredient: {
    readonly ingredientId: string
    readonly ingredientName: string
    readonly unit: string
    readonly quantity: bigint
  },
  source: Omit<MutableShoppingListSource, 'ingredientQuantity'>,
): void {
  const key = ingredientKey(ingredient.ingredientId, ingredient.unit)
  const conflictingNames = conflictedKeys.get(key)
  if (conflictingNames !== undefined) {
    conflictingNames.add(ingredient.ingredientName)
    return
  }
  if (overflowKeys.has(key)) return
  const current = items.get(key)
  if (current !== undefined && current.ingredientName !== ingredient.ingredientName) {
    conflictedKeys.set(key, new Set([current.ingredientName, ingredient.ingredientName]))
    items.delete(key)
    return
  }

  const item =
    current ??
    ({
      ingredientId: ingredient.ingredientId,
      ingredientName: ingredient.ingredientName,
      quantity: 0n,
      unit: ingredient.unit,
      sources: new Map(),
    } satisfies MutableShoppingListItem)
  const nextQuantity = item.quantity + ingredient.quantity
  if (nextQuantity > MAX_OUTPUT_SCALED_UNITS) {
    overflowKeys.add(key)
    items.delete(key)
    return
  }
  item.quantity = nextQuantity

  const keyForSource = sourceKey(source.itemId, source.serviceDate)
  const currentSource = item.sources.get(keyForSource)
  const nextSourceQuantity = (currentSource?.ingredientQuantity ?? 0n) + ingredient.quantity
  if (nextSourceQuantity > MAX_OUTPUT_SCALED_UNITS) {
    overflowKeys.add(key)
    items.delete(key)
    return
  }
  item.sources.set(keyForSource, {
    ...source,
    ingredientQuantity: nextSourceQuantity,
  })
  items.set(key, item)
}

export function buildShoppingList(
  demands: readonly PreparationItemDemand[],
  recipes: readonly RecipeDefinition[],
): ShoppingListResult {
  const warnings: ShoppingListWarning[] = []
  const aggregatedDemands = aggregateDemands(demands, warnings)
  const { validRecipes, invalidItemIds } = recipeIndex(recipes, warnings)
  const items = new Map<string, MutableShoppingListItem>()
  const conflictedKeys = new Map<string, Set<string>>()
  const overflowKeys = new Set<string>()

  for (const demand of aggregatedDemands) {
    if (demand.procurement.kind === 'none') continue

    if (demand.procurement.kind === 'direct') {
      for (const [serviceDate, quantity] of demand.quantitiesByDate) {
        const ingredientQuantity = directPurchaseQuantity(demand.procurement.quantityPerItem, quantity)
        if (ingredientQuantity === null) {
          warnings.push({
            code: 'QUANTITY_OVERFLOW',
            itemId: demand.itemId,
            serviceDate,
            message: `Direct-purchase quantity for ${demand.itemName} exceeds the procurement range.`,
          })
          continue
        }
        addIngredient(
          items,
          conflictedKeys,
          overflowKeys,
          {
            ingredientId: demand.procurement.ingredientId,
            ingredientName: demand.procurement.ingredientName,
            unit: demand.procurement.unit,
            quantity: ingredientQuantity,
          },
          {
            itemId: demand.itemId,
            itemName: demand.itemName,
            serviceDate,
            demandedQuantity: quantity,
          },
        )
      }
      continue
    }

    const recipe = validRecipes.get(demand.itemId)
    if (recipe === undefined) {
      if (!invalidItemIds.has(demand.itemId)) {
        warnings.push({
          code: 'MISSING_RECIPE',
          itemId: demand.itemId,
          message: `No recipe is configured for ${demand.itemName}.`,
        })
      }
      continue
    }

    for (const [serviceDate, quantity] of demand.quantitiesByDate) {
      for (const ingredient of recipe.ingredients) {
        const ingredientQuantity = recipeIngredientQuantity(ingredient, quantity, recipe.yield)
        if (ingredientQuantity === null) {
          warnings.push({
            code: 'QUANTITY_OVERFLOW',
            itemId: demand.itemId,
            serviceDate,
            message: `Recipe quantity for ${demand.itemName} exceeds the procurement range.`,
          })
          continue
        }
        addIngredient(
          items,
          conflictedKeys,
          overflowKeys,
          {
            ingredientId: ingredient.ingredientId,
            ingredientName: ingredient.ingredientName,
            unit: ingredient.unit,
            quantity: ingredientQuantity,
          },
          {
            itemId: demand.itemId,
            itemName: demand.itemName,
            serviceDate,
            demandedQuantity: quantity,
          },
        )
      }
    }
  }

  for (const [key, names] of [...conflictedKeys.entries()].sort(([left], [right]) =>
    compareText(left, right),
  )) {
    const [ingredientId, unit] = JSON.parse(key) as [string, string]
    warnings.push({
      code: 'INGREDIENT_IDENTITY_CONFLICT',
      message: `Ingredient ${ingredientId} in ${unit} has conflicting names: ${[...names].sort(compareText).join(', ')}.`,
      issues: ['ingredientId and unit must identify exactly one canonical ingredient name'],
    })
  }
  for (const key of [...overflowKeys].sort(compareText)) {
    const [ingredientId, unit] = JSON.parse(key) as [string, string]
    warnings.push({
      code: 'QUANTITY_OVERFLOW',
      message: `Aggregated quantity for ingredient ${ingredientId} in ${unit} exceeds the procurement range.`,
    })
  }

  const finalItems = [...items.values()]
    .sort(
      (left, right) =>
        compareText(left.ingredientId, right.ingredientId) ||
        compareText(left.unit, right.unit) ||
        compareText(left.ingredientName, right.ingredientName),
    )
    .map((item) => ({
      ingredientId: item.ingredientId,
      ingredientName: item.ingredientName,
      quantity: formatScaledUnits(item.quantity),
      unit: item.unit,
      sources: [...item.sources.values()]
        .sort(
          (left, right) =>
            compareText(left.serviceDate, right.serviceDate) ||
            compareText(left.itemId, right.itemId) ||
            compareText(left.itemName, right.itemName),
        )
        .map((source) => ({
          itemId: source.itemId,
          itemName: source.itemName,
          serviceDate: source.serviceDate,
          demandedQuantity: source.demandedQuantity,
          ingredientQuantity: formatScaledUnits(source.ingredientQuantity),
        })),
    }))
  const sortedWarnings = [...warnings].sort(compareWarnings)

  return { complete: sortedWarnings.length === 0, items: finalItems, warnings: sortedWarnings }
}
