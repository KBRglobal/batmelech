// The kitchen's single source of truth for what one couple meal (זוגית)
// includes. Every quantity here is "per couple meal" (per 2 people).
//
// Two independent systems must agree with these numbers, or the business
// drifts silently without anyone noticing:
//   1. Pricing (fish/salad/main-pricing + calculateOrderDraftPricing) —
//      anything beyond these amounts is an extra, priced automatically.
//   2. AI order-intake resolution (resolveReviewItemQuantities) — a dish
//      the customer names with no explicit digit defaults to exactly this
//      many units, because choosing it inside a couple meal states no
//      number; the package structure IS the number.
//
// Confirmed with Lin (2026-08-19). Changing a value here changes both the
// price and what the AI assumes — that is the point: one place, one truth.

// Salads changed on 2026-09-15 (Lin): no more choosing. Every order gets one
// fixed box of 12 salads, included in the price regardless of how many
// couple meals it holds. The list below IS the box — the kitchen's prep
// tickets are built from it, so a change here changes what gets prepared.
export const SALAD_BOX_ITEMS: readonly string[] = Object.freeze([
  'מטבוחה פיקנטית',
  'טחינה ביתית',
  'גזר מרוקאי',
  'צ׳ירשי',
  'סלק מבושל',
  'מסייר (חמוצים)',
  'קולסלאו',
  'כרוב סגול במיונז',
  'כרוב לבן קלאסי',
  'כרוב לבן עם תירס',
  'סלט תפו״א',
  'סלט ביצים',
])
export const SALAD_BOX_SIZE = SALAD_BOX_ITEMS.length

export const FISH_UNITS_INCLUDED_PER_MEAL = 2 // 2 fillets (one per person), or the fish-cake portion counts the same
export const SALADS_INCLUDED_PER_MEAL = 4
export const MAINS_INCLUDED_PER_MEAL = 1
export const SIDES_INCLUDED_PER_MEAL = 1
export const DESSERT_HALF_UNITS_INCLUDED_PER_MEAL = 2

// Dessert portions are not equal size: one soufflé serves one person, one
// baklava portion serves two (it's a larger, shared portion) — so a soufflé
// counts as 1 half-unit and a baklava portion counts as 2.
export const SOUFFLE_HALF_UNITS_PER_PORTION = 1
export const BAKLAVA_HALF_UNITS_PER_PORTION = 2

export type DessertKind = 'souffle' | 'baklava' | 'unclassified'

export function classifyDessertKind(name: string): DessertKind {
  const normalized = name.normalize('NFKC')
  if (normalized.includes('סופלה')) return 'souffle'
  if (/בקל/u.test(normalized)) return 'baklava'
  return 'unclassified'
}

export function dessertHalfUnitsPerPortion(kind: DessertKind): number {
  if (kind === 'souffle') return SOUFFLE_HALF_UNITS_PER_PORTION
  if (kind === 'baklava') return BAKLAVA_HALF_UNITS_PER_PORTION
  return 0
}

// The default portion count an AI-recognized dessert selection with no
// stated digit resolves to, for the given number of couple meals — e.g. 2
// couple meals include 4 dessert half-units: 4 soufflés, or 2 baklava
// portions, or a mix. A whole-number default is only possible for a single
// dish kind; the caller decides how to split when the customer named more
// than one dessert.
export function defaultDessertPortionsForMeals(kind: DessertKind, meals: number): number {
  const perPortion = dessertHalfUnitsPerPortion(kind)
  if (perPortion === 0) return 0
  const includedHalfUnits = meals * DESSERT_HALF_UNITS_INCLUDED_PER_MEAL
  return Math.max(1, Math.floor(includedHalfUnits / perPortion))
}
