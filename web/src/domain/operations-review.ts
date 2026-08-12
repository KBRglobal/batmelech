import type {
  PreparationItemDemand,
  PreparationPlan,
  PreparationWarning,
} from './preparation.ts'
import type { ShoppingListResult, ShoppingListWarning } from './shopping-list.ts'

export const OPERATIONS_WARNING_CODES = [
  'MISSING_ORDER_ID',
  'DUPLICATE_ORDER_ID',
  'MISSING_SERVICE_DATE',
  'INVALID_SERVICE_DATE',
  'MISSING_DESTINATION',
  'INVALID_PHONE',
  'INVALID_MONEY',
  'MONEY_OVERFLOW',
  'TEXT_TOO_LONG',
  'INVALID_QUANTITY',
  'QUANTITY_OVERFLOW',
  'UNKNOWN_CATALOG_ITEM',
  'UNKNOWN_LUNCH_ITEM',
  'LUNCH_VARIANT_FALLBACK',
  'UNEXPECTED_LUNCH_FIELD',
  'INVALID_DEMAND',
  'DEMAND_OVERFLOW',
  'DEMAND_IDENTITY_CONFLICT',
  'MISSING_RECIPE',
  'INVALID_RECIPE',
  'INGREDIENT_IDENTITY_CONFLICT',
] as const

export type OperationsWarningCode = (typeof OPERATIONS_WARNING_CODES)[number]
export type OperationsReviewScope = 'preparation' | 'shopping' | 'delivery'
export type OperationsDemandCategory =
  | PreparationItemDemand['category']
  | 'ingredient'

export interface SanitizedOperationsDemand {
  readonly id: `demand-${number}`
  readonly source: 'preparation' | 'shopping'
  readonly serviceDate: string | null
  readonly category: OperationsDemandCategory
  readonly quantity: string
  readonly procurementKind: 'recipe' | 'direct' | 'none' | 'computed'
  readonly comparisonGroup: `group-${number}` | null
}

export interface SanitizedOperationsWarning {
  readonly id: `warning-${number}`
  readonly source: OperationsReviewScope
  readonly code: OperationsWarningCode
  readonly serviceDate: string | null
  readonly occurrences: number
  readonly relatedDemandIds: readonly `demand-${number}`[]
}

export interface OperationsReviewSnapshot {
  readonly scope: OperationsReviewScope
  readonly selectedServiceDate: string | null
  readonly demands: readonly SanitizedOperationsDemand[]
  readonly warnings: readonly SanitizedOperationsWarning[]
}

export interface OperationsReviewPresentation {
  readonly key: string
  readonly snapshot: OperationsReviewSnapshot
  readonly sourceLabels: Readonly<Record<string, string>>
}

interface LocalDemand {
  readonly identity: string
  readonly label: string
  readonly source: SanitizedOperationsDemand['source']
  readonly serviceDate: string | null
  readonly category: OperationsDemandCategory
  readonly quantity: string
  readonly procurementKind: SanitizedOperationsDemand['procurementKind']
  readonly comparisonIdentity: string | null
}

interface LocalWarning {
  readonly identity: string
  readonly label: string
  readonly source: OperationsReviewScope
  readonly code: OperationsWarningCode
  readonly serviceDate: string | null
  readonly occurrences: number
  readonly relatedDemandIdentities: readonly string[]
}

const WARNING_LABELS: Readonly<Record<OperationsWarningCode, string>> = {
  MISSING_ORDER_ID: 'הזמנה ללא מזהה בטוח',
  DUPLICATE_ORDER_ID: 'מזהה הזמנה כפול',
  MISSING_SERVICE_DATE: 'הזמנה ללא תאריך',
  INVALID_SERVICE_DATE: 'תאריך שירות לא תקין',
  MISSING_DESTINATION: 'יעד משלוח חסר',
  INVALID_PHONE: 'טלפון לא תקין',
  INVALID_MONEY: 'סכום לא תקין',
  MONEY_OVERFLOW: 'סכום מחוץ לטווח הבטוח',
  TEXT_TOO_LONG: 'טקסט ארוך מהטווח הבטוח',
  INVALID_QUANTITY: 'כמות לא תקינה',
  QUANTITY_OVERFLOW: 'כמות מחוץ לטווח הבטוח',
  UNKNOWN_CATALOG_ITEM: 'פריט שאינו מחובר לקטלוג',
  UNKNOWN_LUNCH_ITEM: 'פריט צהריים שאינו מחובר לקטלוג',
  LUNCH_VARIANT_FALLBACK: 'וריאציית צהריים לא מוכרת',
  UNEXPECTED_LUNCH_FIELD: 'שדה צהריים לא מוכר',
  INVALID_DEMAND: 'דרישת קנייה לא תקינה',
  DEMAND_OVERFLOW: 'דרישת קנייה מחוץ לטווח הבטוח',
  DEMAND_IDENTITY_CONFLICT: 'סתירה בזהות דרישת קנייה',
  MISSING_RECIPE: 'מתכון חסר',
  INVALID_RECIPE: 'מתכון לא תקין',
  INGREDIENT_IDENTITY_CONFLICT: 'סתירה בזהות או יחידת מצרך',
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function isRealIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value)
  if (match === null) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function selectedDate(value: string): string | null {
  return isRealIsoDate(value) ? value : null
}

function canonicalQuantity(value: number | string): string {
  if (typeof value === 'string') return value
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError('Operations review quantity must be a positive safe integer.')
  }
  return String(value)
}

function localPreparationDemands(
  demands: readonly PreparationItemDemand[],
  requestedDate: string,
): LocalDemand[] {
  return demands
    .filter((demand) => requestedDate === '' || demand.serviceDate === requestedDate)
    .map((demand) => ({
      identity: JSON.stringify(['preparation', demand.serviceDate, demand.category, demand.itemId]),
      label: demand.itemName,
      source: 'preparation' as const,
      serviceDate: demand.serviceDate,
      category: demand.category,
      quantity: canonicalQuantity(demand.quantity),
      procurementKind: demand.procurement.kind,
      comparisonIdentity: JSON.stringify(['preparation', demand.serviceDate, demand.category]),
    }))
    .sort((left, right) => compareText(left.identity, right.identity))
}

function buildPresentation(
  scope: OperationsReviewScope,
  requestedDate: string,
  localDemands: readonly LocalDemand[],
  localWarnings: readonly LocalWarning[],
): OperationsReviewPresentation {
  const comparisonIdentities = [...new Set(
    localDemands
      .map(({ comparisonIdentity }) => comparisonIdentity)
      .filter((identity): identity is string => identity !== null),
  )].sort(compareText)
  const comparisonGroupByIdentity = new Map(
    comparisonIdentities.map((identity, index) => [identity, `group-${index + 1}` as const]),
  )
  const demandIdByIdentity = new Map<string, `demand-${number}`>()
  const sourceLabels: Record<string, string> = {}
  const demands = localDemands.map((demand, index): SanitizedOperationsDemand => {
    const id = `demand-${index + 1}` as const
    demandIdByIdentity.set(demand.identity, id)
    sourceLabels[id] = demand.label
    return {
      id,
      source: demand.source,
      serviceDate: demand.serviceDate,
      category: demand.category,
      quantity: demand.quantity,
      procurementKind: demand.procurementKind,
      comparisonGroup: demand.comparisonIdentity === null
        ? null
        : comparisonGroupByIdentity.get(demand.comparisonIdentity) ?? null,
    }
  })

  const groupedWarnings = new Map<string, { warning: LocalWarning; occurrences: number }>()
  for (const warning of localWarnings) {
    const key = JSON.stringify([
      warning.source,
      warning.code,
      warning.serviceDate,
      [...warning.relatedDemandIdentities].sort(compareText),
    ])
    const existing = groupedWarnings.get(key)
    if (existing === undefined) {
      groupedWarnings.set(key, { warning, occurrences: warning.occurrences })
    } else {
      existing.occurrences += warning.occurrences
    }
  }

  const warnings = [...groupedWarnings.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([, { warning, occurrences }], index): SanitizedOperationsWarning => {
      const id = `warning-${index + 1}` as const
      sourceLabels[id] = warning.label
      return {
        id,
        source: warning.source,
        code: warning.code,
        serviceDate: warning.serviceDate,
        occurrences,
        relatedDemandIds: warning.relatedDemandIdentities
          .map((identity) => demandIdByIdentity.get(identity))
          .filter((demandId): demandId is `demand-${number}` => demandId !== undefined)
          .sort(compareText),
      }
    })

  const snapshot: OperationsReviewSnapshot = {
    scope,
    selectedServiceDate: selectedDate(requestedDate),
    demands,
    warnings,
  }
  return { key: JSON.stringify(snapshot), snapshot, sourceLabels }
}

function preparationWarnings(warnings: readonly PreparationWarning[]): LocalWarning[] {
  return warnings.map((warning) => ({
    identity: JSON.stringify(['preparation', warning.code]),
    label: WARNING_LABELS[warning.code],
    source: 'preparation',
    code: warning.code,
    serviceDate: null,
    occurrences: warning.occurrences,
    relatedDemandIdentities: [],
  }))
}

export function buildPreparationOperationsReview(
  plan: PreparationPlan,
  requestedDate: string,
): OperationsReviewPresentation {
  return buildPresentation(
    'preparation',
    requestedDate,
    localPreparationDemands(plan.itemDemands, requestedDate),
    preparationWarnings(plan.warnings),
  )
}

function shoppingWarnings(
  warnings: readonly ShoppingListWarning[],
  demandIdentityByItemId: ReadonlyMap<string, readonly string[]>,
): LocalWarning[] {
  return warnings.map((warning) => ({
    identity: JSON.stringify(['shopping', warning.code, warning.serviceDate ?? null, warning.itemId ?? null]),
    label: WARNING_LABELS[warning.code],
    source: 'shopping',
    code: warning.code,
    serviceDate: warning.serviceDate && isRealIsoDate(warning.serviceDate) ? warning.serviceDate : null,
    occurrences: 1,
    relatedDemandIdentities: warning.itemId === undefined
      ? []
      : demandIdentityByItemId.get(warning.itemId) ?? [],
  }))
}

export function buildShoppingOperationsReview(
  preparationDemands: readonly PreparationItemDemand[],
  result: ShoppingListResult,
  requestedDate: string,
): OperationsReviewPresentation {
  const preparation = localPreparationDemands(preparationDemands, requestedDate)
  const demandIdentityByItemId = new Map<string, string[]>()
  for (const demand of preparationDemands) {
    if (requestedDate !== '' && demand.serviceDate !== requestedDate) continue
    const identity = JSON.stringify(['preparation', demand.serviceDate, demand.category, demand.itemId])
    const identities = demandIdentityByItemId.get(demand.itemId) ?? []
    identities.push(identity)
    demandIdentityByItemId.set(demand.itemId, identities)
  }

  const units = [...new Set(result.items.map(({ unit }) => unit))].sort(compareText)
  const comparisonByUnit = new Map(units.map((unit, index) => [unit, `shopping-unit-${index + 1}`]))
  const shopping: LocalDemand[] = result.items
    .map((item) => ({
      identity: JSON.stringify(['shopping', item.ingredientId, item.unit]),
      label: item.ingredientName,
      source: 'shopping' as const,
      serviceDate: selectedDate(requestedDate),
      category: 'ingredient' as const,
      quantity: canonicalQuantity(item.quantity),
      procurementKind: 'computed' as const,
      comparisonIdentity: comparisonByUnit.get(item.unit) ?? null,
    }))
    .sort((left, right) => compareText(left.identity, right.identity))

  return buildPresentation(
    'shopping',
    requestedDate,
    [...preparation, ...shopping],
    shoppingWarnings(result.warnings, demandIdentityByItemId),
  )
}
