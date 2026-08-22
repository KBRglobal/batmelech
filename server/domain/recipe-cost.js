'use strict';

// What a dish actually costs to make — the server-side twin of
// costRecipe() in web/src/domain/recipe-costing.ts, together with the
// product-library lookup rules it depends on
// (web/src/domain/product-library.ts).
//
// Ported line for line, including the exact-rational arithmetic: money
// questions must not answer differently depending on who is asked. מיי
// reads this; the panel reads the TypeScript. tests/recipe-cost.test.js and
// web/src/domain/recipe-cost-parity.test.ts run the SAME fixture
// (tests/fixtures/recipe-cost-cases.json) through both engines, so a drift
// in either one fails loudly rather than quietly repricing the kitchen.
//
// Rationals are exact BigInt fractions, never floats: a cost is divided by a
// yield and multiplied by a waste factor, and float drift there is money.

const SUPPLIER_KEYS = ['nesto', 'lulu', 'rimon'];
const KILOGRAM_UNITS = new Set(['ק"ג', 'ק״ג']);
const GRAM_UNITS = new Set(['גרם']);
const LITER_UNITS = new Set(['ליטר']);
const MILLILITER_UNITS = new Set(['מ"ל', 'מ״ל']);
const GRAMS_PER_KILOGRAM = 1000n;
const THOUSAND = { num: 1000n, den: 1n };
const ZERO = { num: 0n, den: 1n };
const DECIMAL_PATTERN = /^\d{1,12}(?:\.\d{1,6})?$/u;

function decimalParts(value) {
  const text = typeof value === 'string' ? value.trim() : String(value ?? '');
  if (!DECIMAL_PATTERN.test(text)) throw new RangeError(`not a canonical decimal: ${text}`);
  const [integerPart, fractionalPart = ''] = text.split('.');
  return { coefficient: BigInt(`${integerPart}${fractionalPart}`), scale: fractionalPart.length };
}

function ratFromDecimal(value) {
  const { coefficient, scale } = decimalParts(value);
  return { num: coefficient, den: 10n ** BigInt(scale) };
}

function ratMul(left, right) {
  return { num: left.num * right.num, den: left.den * right.den };
}

function ratAdd(left, right) {
  return { num: left.num * right.den + right.num * left.den, den: left.den * right.den };
}

function ratDiv(left, right) {
  if (right.num === 0n) throw new RangeError('division by zero');
  return { num: left.num * right.den, den: left.den * right.num };
}

/** Round half up to a non-negative integer. */
function ratToRoundedInt(value) {
  if (value.num < 0n || value.den <= 0n) throw new RangeError('rational must be non-negative');
  const twice = value.num * 2n;
  const quotient = twice / value.den;
  const roundedTwice = quotient % 2n === 0n ? quotient : quotient + 1n;
  return roundedTwice / 2n;
}

// A quantity in the SAME base as pack pricing: kilograms/litres for weight and
// volume, the literal unit string for anything else (יחידה stays piece-exact).
// null when the two units are not comparable at all (גרם vs יחידה).
function toComparableBaseRational(quantity, unit, packUnit) {
  const isWeight = KILOGRAM_UNITS.has(unit) || GRAM_UNITS.has(unit);
  const packIsWeight = KILOGRAM_UNITS.has(packUnit) || GRAM_UNITS.has(packUnit);
  const isVolume = LITER_UNITS.has(unit) || MILLILITER_UNITS.has(unit);
  const packIsVolume = LITER_UNITS.has(packUnit) || MILLILITER_UNITS.has(packUnit);
  if (isWeight !== packIsWeight || isVolume !== packIsVolume) return null;
  if (!isWeight && !isVolume) return unit === packUnit ? quantity : null;

  if (isWeight) {
    const asKilograms = KILOGRAM_UNITS.has(unit)
      ? quantity
      : ratDiv(quantity, { num: GRAMS_PER_KILOGRAM, den: 1n });
    return KILOGRAM_UNITS.has(packUnit)
      ? asKilograms
      : ratMul(asKilograms, { num: GRAMS_PER_KILOGRAM, den: 1n });
  }
  const asLiters = LITER_UNITS.has(unit) ? quantity : ratDiv(quantity, THOUSAND);
  return LITER_UNITS.has(packUnit) ? asLiters : ratMul(asLiters, THOUSAND);
}

function effectivePriceRational(listing) {
  if (listing.manualPrice && typeof listing.manualPrice.minorUnitsPerBaseUnit === 'number') {
    return { num: BigInt(listing.manualPrice.minorUnitsPerBaseUnit), den: 1n };
  }
  const packPrice = { num: BigInt(listing.packPriceMinorUnits), den: 1n };
  return ratDiv(packPrice, ratFromDecimal(listing.packSize));
}

function effectivePricePerBaseUnit(listing) {
  return Number(ratToRoundedInt(effectivePriceRational(listing)));
}

// Kosher rule wins outright; otherwise a manual override wins; otherwise the
// cheaper available listing wins. null when nothing is priced at all.
function effectiveSupplier(entry) {
  const listings = entry && typeof entry.listings === 'object' && entry.listings !== null ? entry.listings : {};
  if (entry.kosherOnly) return listings.rimon ? 'rimon' : null;
  if (entry.supplierOverride && listings[entry.supplierOverride]) return entry.supplierOverride;
  const available = SUPPLIER_KEYS.filter((supplier) => listings[supplier]);
  if (available.length === 0) return null;
  return available.reduce((cheapest, candidate) =>
    effectivePricePerBaseUnit(listings[candidate]) < effectivePricePerBaseUnit(listings[cheapest])
      ? candidate
      : cheapest,
  );
}

/** Id match first (exact identity), then name match (what the operator typed). */
function productLibraryMap(entries) {
  const map = new Map();
  for (const entry of entries) map.set(entry.id, entry);
  for (const entry of entries) {
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (name !== '' && !map.has(name)) map.set(name, entry);
  }
  return map;
}

function lookupProduct(library, ingredientId, ingredientName) {
  return library.get(ingredientId) ?? library.get(String(ingredientName ?? '').trim());
}

function wasteAdjustedQuantity(ingredient) {
  const waste = decimalParts(ingredient.wastePercent ?? '0');
  const wasteDen = 10n ** BigInt(waste.scale);
  const wasteFactor = { num: 100n * wasteDen + waste.coefficient, den: 100n * wasteDen };
  return ratMul(ratFromDecimal(ingredient.quantity), wasteFactor);
}

function weightInGrams(quantity, unit) {
  if (GRAM_UNITS.has(unit)) return quantity;
  if (KILOGRAM_UNITS.has(unit)) return ratMul(quantity, { num: GRAMS_PER_KILOGRAM, den: 1n });
  return null;
}

/**
 * Cost one recipe against the product library.
 * `complete` is false when at least one ingredient could not be priced — the
 * totals still sum whatever could be, and `warnings` names every gap, because
 * "I could price 8 of 9 ingredients" is a far more useful answer than silence.
 */
function costRecipe(recipe, library) {
  const warnings = [];
  const ingredientCosts = [];
  let totalCost = ZERO;
  let totalWeight = null;
  let complete = true;

  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  for (const ingredient of ingredients) {
    const adjustedQuantity = wasteAdjustedQuantity(ingredient);
    const grams = weightInGrams(adjustedQuantity, ingredient.unit);
    if (grams !== null) totalWeight = totalWeight === null ? grams : ratAdd(totalWeight, grams);
    const weightGrams = grams === null ? null : Number(ratToRoundedInt(grams));

    const product = lookupProduct(library, ingredient.ingredientId, ingredient.ingredientName);
    if (product === undefined) {
      complete = false;
      warnings.push({
        code: 'MISSING_PRODUCT',
        ingredientId: ingredient.ingredientId,
        message: `${ingredient.ingredientName} אינו קיים במאגר המוצרים.`,
      });
      ingredientCosts.push({
        ingredientId: ingredient.ingredientId,
        ingredientName: ingredient.ingredientName,
        supplier: null,
        minorUnits: null,
        weightGrams,
      });
      continue;
    }

    const supplier = effectiveSupplier(product);
    const listing = supplier === null ? null : (product.listings[supplier] ?? null);
    const comparable =
      listing === null ? null : toComparableBaseRational(adjustedQuantity, ingredient.unit, listing.packUnit);
    if (supplier === null || listing === null || comparable === null) {
      complete = false;
      warnings.push({
        code: supplier === null ? 'UNPRICED_PRODUCT' : 'INCOMPARABLE_UNIT',
        ingredientId: ingredient.ingredientId,
        message:
          supplier === null
            ? `ל${ingredient.ingredientName} אין ספק מתומחר.`
            : `היחידה של ${ingredient.ingredientName} (${ingredient.unit}) לא מתאימה ליחידת האריזה של המוצר.`,
      });
      ingredientCosts.push({
        ingredientId: ingredient.ingredientId,
        ingredientName: ingredient.ingredientName,
        supplier,
        minorUnits: null,
        weightGrams,
      });
      continue;
    }

    const cost = ratMul(comparable, effectivePriceRational(listing));
    totalCost = ratAdd(totalCost, cost);
    ingredientCosts.push({
      ingredientId: ingredient.ingredientId,
      ingredientName: ingredient.ingredientName,
      supplier,
      minorUnits: Number(ratToRoundedInt(cost)),
      weightGrams,
    });
  }

  const totalMinorUnits = Number(ratToRoundedInt(totalCost));
  const perYieldUnitMinorUnits = Number(
    ratToRoundedInt(ratDiv(totalCost, { num: BigInt(recipe.yield), den: 1n })),
  );
  // The stated finished weight wins over summed raw weights: cooked dishes lose
  // water, salads gain dressing — the batch Lin actually boxes is what matters.
  const effectiveWeight =
    recipe.finishedYieldGrams !== undefined && recipe.finishedYieldGrams !== null
      ? { num: BigInt(recipe.finishedYieldGrams), den: 1n }
      : totalWeight;
  const totalWeightGrams = effectiveWeight === null ? null : Number(ratToRoundedInt(effectiveWeight));
  const minorUnitsPer100g =
    effectiveWeight === null || effectiveWeight.num === 0n
      ? null
      : Number(ratToRoundedInt(ratDiv(ratMul(totalCost, { num: 100n, den: 1n }), effectiveWeight)));

  return {
    complete,
    totalMinorUnits,
    perYieldUnitMinorUnits,
    totalWeightGrams,
    minorUnitsPer100g,
    ingredientCosts,
    warnings,
  };
}

/** Profit on one sale, in minor units. Negative means it is sold at a loss. */
function marginMinorUnits(costMinorUnits, saleMinorUnits) {
  return saleMinorUnits - costMinorUnits;
}

module.exports = {
  SUPPLIER_KEYS,
  costRecipe,
  effectivePricePerBaseUnit,
  effectivePriceRational,
  effectiveSupplier,
  lookupProduct,
  marginMinorUnits,
  productLibraryMap,
  toComparableBaseRational,
};
