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
  'טחינה',
  'גזר מרוקאי מבושל',
  "צ'ירשי טריפוליטאי",
  'סלק מבושל',
  'מסייר (חמוצים)',
  'קולסלאו',
  'כרוב סגול במיונז',
  'כרוב לבן קלאסי',
  'כרוב לבן עם תירס',
  'סלט תפו"א',
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
// ---------------------------------------------------------------------------
// Diner model (Lin, 2026-09-15). The single source of truth for who eats what.
//
//   couple  — the couple meal (ארוחה זוגית): 2 diners. Price lives in the menu
//             settings (couplePrice, $299) and INCLUDES Dubai delivery.
//   addon   — an extra diner joining an order that has a couple meal
//             (סועד נוסף): $149 (menu.addonDinerPrice), half of everything:
//             1 fish unit, half a main, half a side, 1 dessert half-unit,
//             1 challah, 6 salads (half a box).
//   solo    — one person eating alone, no couple meal in the order
//             (סועד בודד): $169 (menu.soloDinerPrice), includes delivery:
//             1 fish unit, half a main, half a side, 1 dessert half-unit,
//             2 challot and the FULL 12-salad box.
//
// Mains and sides are counted in HALF units here so a diner's allowance is a
// whole number; a "main" on the order form (a portion for two) is 2 half-units.
// ---------------------------------------------------------------------------
export const ADDON_DINER_PRICE_MINOR_UNITS_DEFAULT = 14_900
export const SOLO_DINER_PRICE_MINOR_UNITS_DEFAULT = 16_900
export const ADDON_DINER_SALADS = 6
export const SOLO_DINER_SALADS = SALAD_BOX_SIZE
export const HALF_UNITS_PER_MAIN = 2
export const HALF_UNITS_PER_SIDE = 2

export interface DinerCounts {
  readonly couples: number
  readonly addons: number
  readonly solos: number
}

export interface PackageAllowances {
  readonly diners: number
  readonly fishUnits: number
  readonly mainHalfUnits: number
  readonly sideHalfUnits: number
  readonly dessertHalfUnits: number
  readonly challot: number
  /** Salads the kitchen prepares for the order; never priced. */
  readonly salads: number
  /** Dubai delivery is included whenever the order holds any package. */
  readonly deliveryIncluded: boolean
}

export function packageAllowances({ couples, addons, solos }: DinerCounts): PackageAllowances {
  const c = Math.max(0, Math.floor(couples))
  const a = Math.max(0, Math.floor(addons))
  const s = Math.max(0, Math.floor(solos))
  const diners = 2 * c + a + s
  return {
    diners,
    fishUnits: diners * (FISH_UNITS_INCLUDED_PER_MEAL / 2),
    mainHalfUnits: diners,
    sideHalfUnits: diners,
    dessertHalfUnits: diners * (DESSERT_HALF_UNITS_INCLUDED_PER_MEAL / 2),
    challot: 2 * c + a + 2 * s,
    salads: SALAD_BOX_SIZE * c + ADDON_DINER_SALADS * a + SOLO_DINER_SALADS * s,
    deliveryIncluded: diners > 0,
  }
}

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
