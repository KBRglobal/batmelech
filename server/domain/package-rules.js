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
const SALADS_INCLUDED_PER_MEAL = 4;
const MAINS_INCLUDED_PER_MEAL = 1;
const SIDES_INCLUDED_PER_MEAL = 1;
const DESSERT_HALF_UNITS_INCLUDED_PER_MEAL = 2;

// Dessert portions are not equal size: one soufflé serves one person, one
// baklava portion serves two (it's a larger, shared portion) — so a soufflé
// counts as 1 half-unit and a baklava portion counts as 2.
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
