'use strict';

const {
  classifyDessertKind,
  dessertHalfUnitsPerPortion,
  packageAllowances,
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
  // The other two package kinds (add-on diner joining a couple meal, solo
  // diner alone): a named one with no digit is one diner. A solo diner with
  // dishes listed is NOT evidence of a couple meal, so the "at least one
  // meal once a dish is named" assumption only applies when neither is named.
  const dinerCount = (category) => {
    const item = reviewItems.find((row) => categoryOf(row.catalogItemId) === category);
    return item ? item.quantity ?? 1 : 0;
  };
  const addons = dinerCount('addon_diner');
  const solos = dinerCount('solo_diner');
  const assumedMeals = statedMeals ??
    (hasSelections && addons + solos === 0 ? Math.max(currentMeals, 1) : currentMeals);
  const allowances = packageAllowances({ couples: assumedMeals, addons, solos });

  const defaultQuantityFor = (category, name) => {
    if (category === 'couple_meal') return assumedMeals;
    if (category === 'addon_diner' || category === 'solo_diner') return 1;
    if (category === 'first') return allowances.fishUnits;
    if (category === 'salad' || category === 'main' || category === 'side') return 1;
    if (category === 'dessert') {
      const perPortion = dessertHalfUnitsPerPortion(classifyDessertKind(name));
      return perPortion === 0 ? 0 : Math.max(1, Math.floor(allowances.dessertHalfUnits / perPortion));
    }
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
