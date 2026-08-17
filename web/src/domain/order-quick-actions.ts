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
