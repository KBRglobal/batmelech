'use strict';

// The kitchen's single source of truth for what one couple meal (זוגית)
// includes. Every quantity here is "per couple meal" (per 2 people).
//
// This is the server-side twin of web/src/domain/package-rules.ts — kept
// numerically and behaviorally identical on purpose, because the web app
// (browser bundle) and this server (plain Node, no build step) cannot
// currently share one physical file. If you change a number here, change
// it there too, and vice versa. Confirmed with Lin (2026-08-19).

const FISH_UNITS_INCLUDED_PER_MEAL = 2; // 2 fillets (one per person), or the fish-cake portion counts the same
// Salads changed on 2026-09-15 (Lin): every order carries one fixed box of
// 12 salads, included in the price whatever the meal count. Salads are never
// priced any more; the list mirrors web/src/domain/package-rules.ts.
const SALAD_BOX_ITEMS = Object.freeze([
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
]);
const SALAD_BOX_SIZE = SALAD_BOX_ITEMS.length;
const SALADS_INCLUDED_PER_MEAL = 4; // legacy allowance, no longer used for pricing
const MAINS_INCLUDED_PER_MEAL = 1;
const SIDES_INCLUDED_PER_MEAL = 1;
const DESSERT_HALF_UNITS_INCLUDED_PER_MEAL = 2;

// Dessert portions are not equal size: one soufflé serves one person, one
// baklava portion serves two (it's a larger, shared portion) — so a soufflé
// counts as 1 half-unit and a baklava portion counts as 2.
// Diner model (Lin, 2026-09-15) — mirror of web/src/domain/package-rules.ts.
// couple = 2 diners ($299 incl. Dubai delivery); addon = an extra diner on an
// order with a couple meal ($149, half of everything, 6 salads, 1 challah);
// solo = one person alone ($169 incl. delivery, half main/side, 1 fish unit,
// 1 dessert half-unit, 2 challot and the full 12-salad box).
const ADDON_DINER_PRICE_MINOR_UNITS_DEFAULT = 14_900;
const SOLO_DINER_PRICE_MINOR_UNITS_DEFAULT = 16_900;
const ADDON_DINER_SALADS = 6;
const SOLO_DINER_SALADS = SALAD_BOX_SIZE;
const HALF_UNITS_PER_MAIN = 2;
const HALF_UNITS_PER_SIDE = 2;
function packageAllowances({ couples, addons, solos }) {
  const c = Math.max(0, Math.floor(Number(couples) || 0));
  const a = Math.max(0, Math.floor(Number(addons) || 0));
  const s = Math.max(0, Math.floor(Number(solos) || 0));
  const diners = 2 * c + a + s;
  return {
    diners,
    fishUnits: diners * (FISH_UNITS_INCLUDED_PER_MEAL / 2),
    mainHalfUnits: diners,
    sideHalfUnits: diners,
    dessertHalfUnits: diners * (DESSERT_HALF_UNITS_INCLUDED_PER_MEAL / 2),
    challot: 2 * c + a + 2 * s,
    salads: SALAD_BOX_SIZE * c + ADDON_DINER_SALADS * a + SOLO_DINER_SALADS * s,
    deliveryIncluded: diners > 0,
  };
}
const SOUFFLE_HALF_UNITS_PER_PORTION = 1;
const BAKLAVA_HALF_UNITS_PER_PORTION = 2;

function classifyDessertKind(name) {
  const normalized = String(name).normalize('NFKC');
  if (normalized.includes('סופלה')) return 'souffle';
  if (/בקל/u.test(normalized)) return 'baklava';
  return 'unclassified';
}

function dessertHalfUnitsPerPortion(kind) {
  if (kind === 'souffle') return SOUFFLE_HALF_UNITS_PER_PORTION;
  if (kind === 'baklava') return BAKLAVA_HALF_UNITS_PER_PORTION;
  return 0;
}

// The default portion count a recognized dessert selection with no stated
// digit resolves to, for the given number of couple meals — e.g. 2 couple
// meals include 4 dessert half-units: 4 soufflés, or 2 baklava portions.
function defaultDessertPortionsForMeals(kind, meals) {
  const perPortion = dessertHalfUnitsPerPortion(kind);
  if (perPortion === 0) return 0;
  const includedHalfUnits = meals * DESSERT_HALF_UNITS_INCLUDED_PER_MEAL;
  return Math.max(1, Math.floor(includedHalfUnits / perPortion));
}

module.exports = {
  ADDON_DINER_PRICE_MINOR_UNITS_DEFAULT,
  SOLO_DINER_PRICE_MINOR_UNITS_DEFAULT,
  ADDON_DINER_SALADS,
  SOLO_DINER_SALADS,
  HALF_UNITS_PER_MAIN,
  HALF_UNITS_PER_SIDE,
  packageAllowances,
  SALAD_BOX_ITEMS,
  SALAD_BOX_SIZE,
  FISH_UNITS_INCLUDED_PER_MEAL,
  SALADS_INCLUDED_PER_MEAL,
  MAINS_INCLUDED_PER_MEAL,
  SIDES_INCLUDED_PER_MEAL,
  DESSERT_HALF_UNITS_INCLUDED_PER_MEAL,
  SOUFFLE_HALF_UNITS_PER_PORTION,
  BAKLAVA_HALF_UNITS_PER_PORTION,
  classifyDessertKind,
  dessertHalfUnitsPerPortion,
  defaultDessertPortionsForMeals,
};
