import type { LegacyStore } from './store.ts'

/**
 * Strips every non-digit character from a phone number so that formatted
 * variants (050-123-4567, +972 50 123 4567) compare equal.
 */
export function digitsOnlyPhone(phone: string): string {
  return phone.replace(/\D/g, '')
}

/**
 * Checks whether a phone number appears in the store's blocked list.
 * Both the submitted phone and the stored list are normalized to digits only.
 */
export function isPhoneBlocked(phone: string, store: Readonly<LegacyStore>): boolean {
  const normalized = digitsOnlyPhone(phone)
  if (normalized === '') return false
  const blocked = store.settings?.blockedPhones
  if (!Array.isArray(blocked)) return false
  return blocked.some((entry) => typeof entry === 'string' && digitsOnlyPhone(entry) === normalized)
}
