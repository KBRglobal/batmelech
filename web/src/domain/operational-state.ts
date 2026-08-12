import { z } from 'zod'
import { StableCatalogIdSchema } from './recipes.ts'
import type { LegacyOrder, LegacyStore } from './store.ts'

const MAX_ORDER_ID_LENGTH = 256
const MAX_ITEM_NAME_LENGTH = 240
const MAX_UNIT_LENGTH = 80

const CanonicalOrderIdSchema = z
  .string()
  .min(1)
  .max(MAX_ORDER_ID_LENGTH)
  .refine((value) => value.trim() === value)

const PreparationItemNameSchema = z
  .string()
  .min(1)
  .max(MAX_ITEM_NAME_LENGTH)
  .refine((value) => value.trim() === value)

const ShoppingUnitSchema = z
  .string()
  .min(1)
  .max(MAX_UNIT_LENGTH)
  .refine((value) => value.trim() === value)

export const DELIVERY_STATUS_SEQUENCE = [
  'חדשה',
  'אושרה',
  'מוכנה',
  'במשלוח',
  'נמסרה',
] as const

export type DeliveryStatus = (typeof DELIVERY_STATUS_SEQUENCE)[number]

export const PREPARATION_COMPLETION_CATEGORIES = [
  'salads',
  'firsts',
  'mains',
  'sides',
  'desserts',
  'extras',
  'custom',
  'lunch',
] as const

export type PreparationCompletionCategory =
  (typeof PREPARATION_COMPLETION_CATEGORIES)[number]

const PreparationCompletionCategorySchema = z.enum(PREPARATION_COMPLETION_CATEGORIES)

export type OperationalStateErrorCode =
  | 'INVALID_ORDER_ID'
  | 'ORDER_ID_NOT_UNIQUE'
  | 'INVALID_DELIVERY_STATUS'
  | 'INVALID_SERVICE_DATE'
  | 'INVALID_PREPARATION_ITEM'
  | 'INVALID_SHOPPING_ITEM'
  | 'INVALID_COMPLETION_MAP'
  | 'INVALID_COMPLETION_VALUE'

export class OperationalStateError extends Error {
  readonly code: OperationalStateErrorCode

  constructor(code: OperationalStateErrorCode) {
    super(code)
    this.name = 'OperationalStateError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

function canonicalOrderIdentity(order: Readonly<LegacyOrder>): string | null {
  if (typeof order.id === 'number' && Number.isSafeInteger(order.id)) return String(order.id)
  const result = CanonicalOrderIdSchema.safeParse(order.id)
  return result.success ? result.data : null
}

function currentDeliveryStatus(value: unknown): DeliveryStatus | null {
  if (value === undefined || value === null || value === '') return DELIVERY_STATUS_SEQUENCE[0]
  if (typeof value !== 'string') return null
  return DELIVERY_STATUS_SEQUENCE.find((status) => status === value) ?? null
}

export function nextDeliveryStatus(value: unknown): DeliveryStatus | null {
  const current = currentDeliveryStatus(value)
  if (current === null) return null
  const index = DELIVERY_STATUS_SEQUENCE.indexOf(current)
  return DELIVERY_STATUS_SEQUENCE[index + 1] ?? null
}

export interface DeliveryStatusChange {
  readonly nextStore: LegacyStore
  readonly nextStatus: DeliveryStatus
}

export function applyNextDeliveryStatus(
  store: Readonly<LegacyStore>,
  orderId: string,
): DeliveryStatusChange {
  const parsedId = CanonicalOrderIdSchema.safeParse(orderId)
  if (!parsedId.success) throw new OperationalStateError('INVALID_ORDER_ID')

  const matchingIdentityCount = store.orders.reduce(
    (count, order) => count + (canonicalOrderIdentity(order) === parsedId.data ? 1 : 0),
    0,
  )
  const exactIndex = store.orders.findIndex(
    (order) => typeof order.id === 'string' && order.id === parsedId.data,
  )
  if (matchingIdentityCount !== 1 || exactIndex < 0) {
    throw new OperationalStateError('ORDER_ID_NOT_UNIQUE')
  }

  const order = store.orders[exactIndex]!
  const nextStatus = nextDeliveryStatus(order.status)
  if (nextStatus === null) throw new OperationalStateError('INVALID_DELIVERY_STATUS')

  const nextStore = structuredClone(store) as LegacyStore
  nextStore.orders[exactIndex] = { ...nextStore.orders[exactIndex]!, status: nextStatus }
  return { nextStore, nextStatus }
}

function validatedServiceDate(value: string): string {
  if (!isRealIsoDate(value)) throw new OperationalStateError('INVALID_SERVICE_DATE')
  return value
}

export function preparationCompletionKey(
  category: PreparationCompletionCategory,
  itemName: string,
): string {
  const parsedCategory = PreparationCompletionCategorySchema.safeParse(category)
  const parsedName = PreparationItemNameSchema.safeParse(itemName)
  if (!parsedCategory.success || !parsedName.success) {
    throw new OperationalStateError('INVALID_PREPARATION_ITEM')
  }
  return `${parsedCategory.data}|${parsedName.data}`
}

function completionMap(
  store: Readonly<LegacyStore>,
  rootKey: 'prepDone' | 'shoppingDone',
  scopeKey: string,
): Readonly<Record<string, unknown>> | null {
  const root = (store as Readonly<Record<string, unknown>>)[rootKey]
  if (root === undefined) return null
  if (!isRecord(root)) return null
  const scope = root[scopeKey]
  if (scope === undefined) return null
  return isRecord(scope) ? scope : null
}

function updateCompletionMap(
  store: Readonly<LegacyStore>,
  rootKey: 'prepDone' | 'shoppingDone',
  scopeKey: string,
  itemKey: string,
  completed: boolean,
): LegacyStore {
  const nextStore = structuredClone(store) as LegacyStore
  const nextRecord = nextStore as Record<string, unknown>
  const existingRoot = nextRecord[rootKey]
  if (existingRoot !== undefined && !isRecord(existingRoot)) {
    throw new OperationalStateError('INVALID_COMPLETION_MAP')
  }
  const root = existingRoot ?? {}
  const existingScope = root[scopeKey]
  if (existingScope !== undefined && !isRecord(existingScope)) {
    throw new OperationalStateError('INVALID_COMPLETION_MAP')
  }
  const scope = existingScope ?? {}
  const existingValue = scope[itemKey]
  if (existingValue !== undefined && typeof existingValue !== 'boolean') {
    throw new OperationalStateError('INVALID_COMPLETION_VALUE')
  }

  if (completed) scope[itemKey] = true
  else delete scope[itemKey]
  root[scopeKey] = scope
  nextRecord[rootKey] = root
  return nextStore
}

export function isPreparationCompleted(
  store: Readonly<LegacyStore>,
  serviceDate: string,
  category: PreparationCompletionCategory,
  itemName: string,
): boolean {
  try {
    const scope = completionMap(store, 'prepDone', validatedServiceDate(serviceDate))
    return scope?.[preparationCompletionKey(category, itemName)] === true
  } catch {
    return false
  }
}

export function applyPreparationCompletion(
  store: Readonly<LegacyStore>,
  serviceDate: string,
  category: PreparationCompletionCategory,
  itemName: string,
  completed: boolean,
): LegacyStore {
  const date = validatedServiceDate(serviceDate)
  const itemKey = preparationCompletionKey(category, itemName)
  return updateCompletionMap(store, 'prepDone', date, itemKey, completed)
}

export const GLOBAL_SHOPPING_SCOPE = 'global'

export function shoppingCompletionScope(serviceDate: string | null): string {
  return serviceDate === null ? GLOBAL_SHOPPING_SCOPE : validatedServiceDate(serviceDate)
}

export function shoppingCompletionKey(ingredientId: string, unit: string): string {
  const parsedId = StableCatalogIdSchema.safeParse(ingredientId)
  const parsedUnit = ShoppingUnitSchema.safeParse(unit)
  if (
    !parsedId.success ||
    parsedId.data !== ingredientId ||
    !parsedUnit.success ||
    parsedUnit.data !== unit
  ) {
    throw new OperationalStateError('INVALID_SHOPPING_ITEM')
  }
  return JSON.stringify([parsedId.data, parsedUnit.data])
}

export function isShoppingCompleted(
  store: Readonly<LegacyStore>,
  serviceDate: string | null,
  ingredientId: string,
  unit: string,
): boolean {
  try {
    const scope = completionMap(store, 'shoppingDone', shoppingCompletionScope(serviceDate))
    return scope?.[shoppingCompletionKey(ingredientId, unit)] === true
  } catch {
    return false
  }
}

export function applyShoppingCompletion(
  store: Readonly<LegacyStore>,
  serviceDate: string | null,
  ingredientId: string,
  unit: string,
  completed: boolean,
): LegacyStore {
  const scope = shoppingCompletionScope(serviceDate)
  const itemKey = shoppingCompletionKey(ingredientId, unit)
  return updateCompletionMap(store, 'shoppingDone', scope, itemKey, completed)
}
