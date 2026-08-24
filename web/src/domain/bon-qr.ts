import type { LegacyOrder, LegacyStore } from './store.ts'

/**
 * Which QR codes a printed surface should carry for an order.
 *
 * Targets come only from the two links Lin maintains in settings — the
 * customer order form and the payment link. A missing or non-HTTP link means
 * no QR at all: a bon never carries a code that scans to nowhere.
 */
export interface BonQrTargets {
  /** «להזמנה הבאה — סורקים» — the customer order form. */
  readonly orderForm: string | null
  /** «סריקה לתשלום» — only while the order is not marked paid. */
  readonly payment: string | null
}

/** True when the value is a usable http(s) link once trimmed. */
export function validHttpUrl(value: string): boolean {
  return httpUrl(value) !== null
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? trimmed : null
  } catch {
    return null
  }
}

function isPaid(order: Readonly<LegacyOrder>): boolean {
  return typeof order.paid === 'string' && order.paid.trim() === 'כן'
}

// The settings schema is passthrough: payLink/orderFormUrl live in the blob
// without appearing in the inferred type, same as settings-backup.ts reads them.
function settingsRecord(store: Readonly<LegacyStore>): Readonly<Record<string, unknown>> {
  return (store.settings ?? {}) as Readonly<Record<string, unknown>>
}

/** The order-form link from settings, or null when unset/invalid. */
export function orderFormQrTarget(store: Readonly<LegacyStore>): string | null {
  return httpUrl(settingsRecord(store).orderFormUrl)
}

/** The payment link from settings, or null when unset/invalid. */
export function paymentQrTarget(store: Readonly<LegacyStore>): string | null {
  return httpUrl(settingsRecord(store).payLink)
}

export function bonQrTargets(
  order: Readonly<LegacyOrder>,
  store: Readonly<LegacyStore>,
): BonQrTargets {
  return {
    orderForm: orderFormQrTarget(store),
    payment: isPaid(order) ? null : paymentQrTarget(store),
  }
}
