import type { LegacyStore } from './store.ts'

/**
 * One-click actions on an order card — advancing the workflow status and
 * stamping how it was paid — without opening the full editor.
 *
 * The flow deliberately stops at 'נמסרה': cancelling ('בוטלה') and reviving
 * an order stay editor-only actions, too destructive for a single tap.
 */
export const ORDER_STATUS_FLOW = ['מתעניין', 'חדשה', 'אושרה', 'מוכנה', 'במשלוח', 'נמסרה'] as const

export const QUICK_PAID_OPTIONS = ['לא', 'מקדמה', 'כן', 'שת"פ'] as const

export function nextOrderStatus(status: string): string | null {
  const normalized = status.trim()
  const index = (ORDER_STATUS_FLOW as readonly string[]).indexOf(normalized)
  if (index === -1 || index === ORDER_STATUS_FLOW.length - 1) return null
  return ORDER_STATUS_FLOW[index + 1]!
}

export interface OrderQuickFields {
  readonly status?: string
  readonly paid?: string
}

/**
 * Returns a new store with the fields applied to exactly one order, or null
 * when the ID is missing or ambiguous — a quick action must never guess
 * which of two same-ID rows it is editing.
 */
export function applyOrderQuickFields(
  store: Readonly<LegacyStore>,
  orderId: string,
  fields: OrderQuickFields,
): LegacyStore | null {
  const matches = store.orders.filter((order) => String(order.id) === orderId)
  if (matches.length !== 1) return null
  return {
    ...store,
    orders: store.orders.map((order) =>
      String(order.id) === orderId ? { ...order, ...fields } : order,
    ),
  }
}

// The only fields the card-level inline editor may touch. Each maps 1:1 to a
// top-level LegacyOrder key and is written via `{...order, [field]: value}`,
// so every other field — including the server-owned mey*/courier*/
// deliveryProof*/intakeConversation fields — passes through untouched.
export type OrderEditableField = 'name' | 'date' | 'time' | 'total'

export type OrderFieldEditResult =
  | { readonly ok: true; readonly store: LegacyStore }
  | { readonly ok: false; readonly error: 'unknown-order' | 'invalid-value' }

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u
const TOTAL_PATTERN = /^\d{1,10}(?:\.\d{1,2})?$/u
const MAX_NAME_LENGTH = 200

function isRealIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value)
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

const INVALID: unique symbol = Symbol('invalid-field-value')

function normalizeFieldValue(
  field: OrderEditableField,
  value: string,
): string | typeof INVALID {
  const trimmed = value.trim()
  switch (field) {
    case 'name':
      return trimmed !== '' && trimmed.length <= MAX_NAME_LENGTH ? trimmed : INVALID
    case 'date':
      return isRealIsoDate(trimmed) ? trimmed : INVALID
    case 'time':
      return trimmed === '' || TIME_PATTERN.test(trimmed) ? trimmed : INVALID
    case 'total':
      return TOTAL_PATTERN.test(trimmed) ? trimmed : INVALID
  }
}

/**
 * Bounded inline edit of a single order field. Same safety contract as
 * applyOrderQuickFields: exactly one ID match or nothing happens, and a
 * validation failure never produces a store — the caller cannot save a
 * half-checked value by accident.
 */
export function applyOrderFieldEdit(
  store: Readonly<LegacyStore>,
  orderId: string,
  field: OrderEditableField,
  value: string,
): OrderFieldEditResult {
  const matches = store.orders.filter((order) => String(order.id) === orderId)
  if (matches.length !== 1) return { ok: false, error: 'unknown-order' }
  const normalized = normalizeFieldValue(field, value)
  if (normalized === INVALID) return { ok: false, error: 'invalid-value' }
  return {
    ok: true,
    store: {
      ...store,
      orders: store.orders.map((order) =>
        String(order.id) === orderId ? { ...order, [field]: normalized } : order,
      ),
    },
  }
}
