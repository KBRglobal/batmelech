'use strict';

const {
  FISH_UNITS_INCLUDED_PER_MEAL,
  classifyDessertKind,
  defaultDessertPortionsForMeals,
} = require('./package-rules');

// Server-side twin of resolveReviewItemQuantities in
// web/src/domain/order-editor.ts — same resolution rules, adapted to the
// catalog `category` field instead of the web's AICatalogTarget map (the
// panel and Mey build catalogs with the same id/category scheme; see
// buildAIOrderCatalog and buildIntakeCatalog).
//
// A selection named with no explicit digit resolves via the couple-meal
// structure, not a private guess — mirrors the panel exactly so an order
// מיי creates and one built from the same message in the panel never
// disagree on quantities.
function resolveReviewItemQuantities(reviewItems, catalogById, currentMeals) {
  const categoryOf = (catalogItemId) => catalogById.get(catalogItemId)?.category ?? null;
  const nameOf = (catalogItemId) => catalogById.get(catalogItemId)?.name ?? '';

  const hasSelections = reviewItems.some((item) => {
    const category = categoryOf(item.catalogItemId);
    return category === 'salad' || category === 'first' || category === 'main' ||
      category === 'side' || category === 'dessert';
  });
  const statedMeals = reviewItems.find(
    (item) => categoryOf(item.catalogItemId) === 'couple_meal' && item.quantity !== null,
  )?.quantity;
  const assumedMeals = statedMeals ?? (hasSelections ? Math.max(currentMeals, 1) : currentMeals);

  const defaultQuantityFor = (category, name) => {
    if (category === 'couple_meal') return assumedMeals;
    if (category === 'first') return assumedMeals * FISH_UNITS_INCLUDED_PER_MEAL;
    if (category === 'salad' || category === 'main' || category === 'side') return 1;
    if (category === 'dessert') return defaultDessertPortionsForMeals(classifyDessertKind(name), assumedMeals);
    if (category === 'extra') return 1;
    // A weekday lunch dish is a standalone plate: naming it IS ordering one
    // of it. Leaving it unresolved dropped the dish out of the order
    // entirely and the customer was never charged for it.
    if (category === 'lunch' || category === 'lunch_addon') return 1;
    return null; // challahs follow the meal count automatically
  };

  const resolved = new Map();
  for (const item of reviewItems) {
    const catalogItem = catalogById.get(item.catalogItemId);
    if (!catalogItem) continue;
    const quantity = item.quantity ?? defaultQuantityFor(catalogItem.category, catalogItem.name);
    if (quantity === null || quantity === 0) continue;
    resolved.set(item.catalogItemId, quantity);
  }
  return resolved;
}

module.exports = { resolveReviewItemQuantities };
