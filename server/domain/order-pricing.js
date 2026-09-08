'use strict';

// How an order's price is built, line by line — the server-side twin of the
// panel's pricing (web/src/domain/order-editor.ts calculateOrderDraftPricing
// + order-total.ts). Same rules, same numbers, so "why did Toni come to 148$"
// gets the same answer here as in the order editor:
//
//   couple meals x couple price
//   + fish fillets beyond 2 per meal (a fish-cake portion counts as 2)
//   + salads beyond 4 per meal (blocks of 4, then singles)
//   + Shabbat extras at their menu price, custom items at their own price
//   + lunch plates by variant, excess lunch sides, lunch add-ons
//   + extra challot beyond 2 per meal, extra mains beyond 1 per meal,
//     extra dessert half-units
//   + delivery (Dubai 15$, Abu Dhabi 55$, free or pickup 0)
//
// The stored total always wins (a manually set price is the price — Moshe,
// 2026-08-18); when it differs from the computed lines the gap is reported
// as its own line, never hidden.

const {
  BAKLAVA_HALF_UNITS_PER_PORTION,
  DESSERT_HALF_UNITS_INCLUDED_PER_MEAL,
  FISH_UNITS_INCLUDED_PER_MEAL,
  MAINS_INCLUDED_PER_MEAL,
  SALADS_INCLUDED_PER_MEAL,
  SOUFFLE_HALF_UNITS_PER_PORTION,
  classifyDessertKind,
} = require('./package-rules');
const { quotePackages } = require('../../shared/rosh-hashanah.mjs');
const { LUNCH_MENU } = require('./lunch-menu');
const { parseMoneyMinorUnits } = require('./business-queries');

const DEFAULTS = Object.freeze({
  couplePriceMinorUnits: 23_000,
  challahPriceMinorUnits: 1_000,
  includedChallot: 2,
  saladBlockPriceMinorUnits: 2_500,
  saladUnitPriceMinorUnits: 700,
  fishExtraPriceMinorUnits: 3_000,
  mainExtraPriceMinorUnits: 10_000,
  dessertExtraPriceMinorUnits: 0,
});
const SALAD_BLOCK_SIZE = 4;
const FISH_CAKE_PORTION_NAME = 'קציצות דגים ברוטב מרוקאי';
const DELIVERY_PRICE_MINOR_UNITS = Object.freeze({ dubai: 1_500, 'abu-dhabi': 5_500 });

// The panel's lunch variants carry side rules the shared catalog does not.
const LUNCH_SIDE_RULES = Object.freeze({
  'schnitzel-plate': {
    single: { includedSides: 1, sidePriceMinorUnits: 1_500 },
    couple: { includedSides: 1, sidePriceMinorUnits: 2_500 },
    family: { includedSides: 2, sidePriceMinorUnits: 2_500 },
  },
});

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function dishCount(value) {
  if (isRecord(value)) return count(value.o ?? value.q ?? value.quantity);
  return count(value);
}

function dollarsToMinorUnits(value, fallback) {
  const parsed = parseMoneyMinorUnits(value);
  return parsed === null ? fallback : parsed;
}

function menuPrices(menu) {
  const m = isRecord(menu) ? menu : {};
  return {
    couplePriceMinorUnits: dollarsToMinorUnits(m.couplePrice, DEFAULTS.couplePriceMinorUnits),
    challahPriceMinorUnits: dollarsToMinorUnits(m.challahPrice, DEFAULTS.challahPriceMinorUnits),
    includedChallot: Number.isInteger(m.includedChallot) && m.includedChallot >= 0 ? m.includedChallot : DEFAULTS.includedChallot,
    saladBlockPriceMinorUnits: dollarsToMinorUnits(m.saladBlockPrice, DEFAULTS.saladBlockPriceMinorUnits),
    saladUnitPriceMinorUnits: dollarsToMinorUnits(m.saladUnitPrice, DEFAULTS.saladUnitPriceMinorUnits),
    fishExtraPriceMinorUnits: dollarsToMinorUnits(m.fishExtraPrice, DEFAULTS.fishExtraPriceMinorUnits),
    mainExtraPriceMinorUnits: dollarsToMinorUnits(m.mainExtraPrice, DEFAULTS.mainExtraPriceMinorUnits),
    dessertExtraPriceMinorUnits: dollarsToMinorUnits(m.dessertExtraPrice, DEFAULTS.dessertExtraPriceMinorUnits),
    extras: (Array.isArray(m.extras) ? m.extras : []).filter((row) => isRecord(row) && typeof row.name === 'string'),
    lunch: Array.isArray(m.lunch) ? m.lunch.filter(isRecord) : [],
  };
}

function line(name, quantity, unitPriceMinorUnits, kind) {
  return { kind, name, quantity, unitPriceMinorUnits, amountMinorUnits: quantity * unitPriceMinorUnits };
}

function lunchVariantPrice(prices, itemKey, variantKey) {
  const saved = prices.lunch.find((row) => row.key === itemKey);
  const catalog = LUNCH_MENU.find((row) => row.key === itemKey);
  const savedVariant = (Array.isArray(saved?.variants) ? saved.variants : []).find((v) => v.k === variantKey || v.key === variantKey);
  const catalogVariant = catalog?.variants?.find((v) => v.key === variantKey) || null;
  const priceMinorUnits =
    savedVariant && parseMoneyMinorUnits(savedVariant.price) !== null
      ? parseMoneyMinorUnits(savedVariant.price)
      : catalogVariant
        ? catalogVariant.priceUsd * 100
        : null;
  const sideRule = LUNCH_SIDE_RULES[itemKey]?.[variantKey] || { includedSides: 0, sidePriceMinorUnits: 0 };
  const sidePriceMinorUnits =
    savedVariant && parseMoneyMinorUnits(savedVariant.sidePrice) !== null
      ? parseMoneyMinorUnits(savedVariant.sidePrice)
      : sideRule.sidePriceMinorUnits;
  return { priceMinorUnits, label: catalogVariant ? catalogVariant.label : variantKey, includedSides: sideRule.includedSides, sidePriceMinorUnits };
}

function lunchLines(order, prices, warnings) {
  const lines = [];
  const lunch = isRecord(order.lunch) ? order.lunch : {};
  for (const [key, selection] of Object.entries(lunch)) {
    if (!isRecord(selection)) continue;
    const quantity = count(selection.q ?? selection.quantity);
    const addonQuantity = count(selection.addon ?? selection.addonQuantity);
    if (quantity <= 0 && addonQuantity <= 0) continue;
    const catalog = LUNCH_MENU.find((row) => row.key === key);
    const saved = prices.lunch.find((row) => row.key === key);
    const itemName = catalog ? catalog.name : key;
    const hasVariants = (catalog?.variants?.length ?? 0) > 0;

    if (quantity > 0 && hasVariants) {
      const plates = Array.isArray(selection.plates) && selection.plates.length > 0
        ? selection.plates.map((plate) => ({ variantKey: isRecord(plate) ? plate.variantKey : null, sides: isRecord(plate?.sides) ? plate.sides : {} }))
        : Array.from({ length: quantity }, () => ({ variantKey: selection.v ?? selection.variantKey ?? catalog.variants[0].key, sides: null }));
      const byVariant = new Map();
      for (const plate of plates) {
        const variantKey = plate.variantKey || catalog.variants[0].key;
        byVariant.set(variantKey, (byVariant.get(variantKey) ?? 0) + 1);
      }
      let includedSides = 0;
      let maxSidePrice = 0;
      for (const [variantKey, plateCount] of byVariant) {
        const variant = lunchVariantPrice(prices, key, variantKey);
        if (variant.priceMinorUnits === null) {
          warnings.push(`אין מחיר ל${itemName} (${variantKey})`);
          continue;
        }
        lines.push(line(`${itemName} (${variant.label})`, plateCount, variant.priceMinorUnits, 'lunch'));
        includedSides += variant.includedSides * plateCount;
        maxSidePrice = Math.max(maxSidePrice, variant.sidePriceMinorUnits);
      }
      const sideSource = plates.some((plate) => plate.sides !== null)
        ? plates.reduce((sum, plate) => sum + Object.values(plate.sides ?? {}).reduce((s, v) => s + count(v), 0), 0)
        : Object.values(isRecord(selection.sides) ? selection.sides : {}).reduce((s, v) => s + count(v), 0);
      const excessSides = Math.max(0, sideSource - includedSides);
      if (excessSides > 0 && maxSidePrice > 0) lines.push(line(`תוספות ל${itemName}`, excessSides, maxSidePrice, 'lunch'));
    } else if (quantity > 0) {
      const price = saved && parseMoneyMinorUnits(saved.price) !== null ? parseMoneyMinorUnits(saved.price) : catalog ? catalog.priceUsd * 100 : null;
      if (price === null) warnings.push(`אין מחיר ל${itemName}`);
      else lines.push(line(itemName, quantity, price, 'lunch'));
    }

    if (addonQuantity > 0) {
      const addon = catalog?.addon || null;
      const savedAddon = isRecord(saved?.addon) ? saved.addon : null;
      const addonPrice = savedAddon && parseMoneyMinorUnits(savedAddon.price) !== null
        ? parseMoneyMinorUnits(savedAddon.price)
        : addon ? addon.priceUsd * 100 : null;
      if (addonPrice === null) warnings.push(`אין מחיר לתוספת של ${itemName}`);
      else lines.push(line(`${addon ? addon.name : 'תוספת'} (ל${itemName})`, addonQuantity, addonPrice, 'lunch'));
    }
  }
  return lines;
}

/**
 * The priced lines of one order plus how they compare to the stored total.
 * Never throws on odd data: unknown prices become warnings, not zeros.
 */
function orderPriceBreakdown(order, menu) {
  const prices = menuPrices(menu);
  const warnings = [];
  const lines = [];
  const meals = count(order.meals);

  if (meals > 0) lines.push(line('ארוחה זוגית', meals, prices.couplePriceMinorUnits, 'couple-meal'));

  // fish
  let fishUnits = 0;
  for (const [name, value] of Object.entries(isRecord(order.firsts) ? order.firsts : {})) {
    fishUnits += dishCount(value) * (name === FISH_CAKE_PORTION_NAME ? FISH_UNITS_INCLUDED_PER_MEAL : 1);
  }
  const extraFish = Math.max(0, fishUnits - meals * FISH_UNITS_INCLUDED_PER_MEAL);
  if (extraFish > 0) lines.push(line('פילה דג אקסטרה', extraFish, prices.fishExtraPriceMinorUnits, 'fish-surcharge'));

  // salads (ordered portions only; gift 'p' portions are free)
  let orderedSalads = 0;
  for (const value of Object.values(isRecord(order.salads) ? order.salads : {})) orderedSalads += dishCount(value);
  const extraSalads = Math.max(0, orderedSalads - meals * SALADS_INCLUDED_PER_MEAL);
  const saladBlocks = Math.floor(extraSalads / SALAD_BLOCK_SIZE);
  const saladSingles = extraSalads % SALAD_BLOCK_SIZE;
  if (saladBlocks > 0) lines.push(line('סלטים אקסטרה (רביעייה)', saladBlocks, prices.saladBlockPriceMinorUnits, 'salad-surcharge'));
  if (saladSingles > 0) lines.push(line('סלט אקסטרה בודד', saladSingles, prices.saladUnitPriceMinorUnits, 'salad-surcharge'));

  // extras
  for (const [name, value] of Object.entries(isRecord(order.extras) ? order.extras : {})) {
    const quantity = dishCount(value);
    if (quantity <= 0) continue;
    const priced = prices.extras.find((row) => row.name === name);
    const price = priced ? parseMoneyMinorUnits(priced.price) : null;
    if (price === null) {
      warnings.push(`אין מחיר בתפריט ל"${name}"`);
      continue;
    }
    lines.push(line(name, quantity, price, 'extra'));
  }

  // custom items
  for (const item of Array.isArray(order.custom) ? order.custom : []) {
    if (!isRecord(item)) continue;
    const quantity = count(item.qty ?? item.q ?? item.quantity);
    const price = parseMoneyMinorUnits(item.price ?? item.unitPrice);
    if (quantity <= 0) continue;
    if (price === null) {
      warnings.push(`לפריט החופשי "${item.name ?? ''}" אין מחיר קריא`);
      continue;
    }
    lines.push(line(String(item.name ?? 'פריט חופשי'), quantity, price, 'custom'));
  }

  lines.push(...lunchLines(order, prices, warnings));

  // delivery
  if (order.pickup !== true) {
    const zone = order.deliveryZone === 'abu-dhabi' ? 'abu-dhabi' : 'dubai';
    const fee = order.freeDelivery === true ? 0 : DELIVERY_PRICE_MINOR_UNITS[zone];
    lines.push(line(zone === 'abu-dhabi' ? 'משלוח לאבו דאבי' : 'משלוח בדובאי', 1, fee, 'delivery'));
  }

  // challot / mains / desserts beyond the package
  const extraChallot = Math.max(0, count(order.challot) - meals * prices.includedChallot);
  if (extraChallot > 0) lines.push(line('חלות נוספות', extraChallot, prices.challahPriceMinorUnits, 'other'));
  let mains = 0;
  for (const value of Object.values(isRecord(order.mains) ? order.mains : {})) mains += dishCount(value);
  const extraMains = Math.max(0, mains - meals * MAINS_INCLUDED_PER_MEAL);
  if (extraMains > 0) lines.push(line('עיקרית נוספת', extraMains, prices.mainExtraPriceMinorUnits, 'other'));
  let dessertHalfUnits = 0;
  for (const [name, value] of Object.entries(isRecord(order.desserts) ? order.desserts : {})) {
    const kind = classifyDessertKind(name);
    const perPortion = kind === 'souffle' ? SOUFFLE_HALF_UNITS_PER_PORTION : kind === 'baklava' ? BAKLAVA_HALF_UNITS_PER_PORTION : 0;
    dessertHalfUnits += dishCount(value) * perPortion;
  }
  const extraDessert = Math.max(0, dessertHalfUnits - meals * DESSERT_HALF_UNITS_INCLUDED_PER_MEAL);
  if (extraDessert > 0 && prices.dessertExtraPriceMinorUnits > 0) {
    lines.push(line('קינוח נוסף', extraDessert, prices.dessertExtraPriceMinorUnits, 'other'));
  }

  try {
    const festive = quotePackages(order.festivePackages);
    lines.push(...festive.lines.map(row => line(row.name, row.quantity, row.unitPrice * 100, 'other')));
    if (!festive.ready) warnings.push('בחירת חבילות החג אינה מלאה');
  } catch { warnings.push('חבילות החג אינן תקינות ולא ניתן לחשב את מחירן'); }

  const computedTotalMinorUnits = lines.reduce((sum, row) => sum + row.amountMinorUnits, 0);
  const storedTotalMinorUnits = parseMoneyMinorUnits(order.total);
  const differenceMinorUnits = storedTotalMinorUnits === null ? null : storedTotalMinorUnits - computedTotalMinorUnits;
  if (differenceMinorUnits !== null && differenceMinorUnits !== 0) {
    lines.push({
      kind: 'manual',
      name: differenceMinorUnits > 0 ? 'התאמה ידנית (הסכום שנקבע גבוה מהחישוב)' : 'הנחה / התאמה ידנית (הסכום שנקבע נמוך מהחישוב)',
      quantity: 1,
      unitPriceMinorUnits: differenceMinorUnits,
      amountMinorUnits: differenceMinorUnits,
    });
  }

  return {
    lines,
    computedTotalMinorUnits,
    storedTotalMinorUnits,
    differenceMinorUnits,
    matchesStoredTotal: differenceMinorUnits === 0,
    warnings,
    note:
      storedTotalMinorUnits === null
        ? 'לסכום ההזמנה אין ערך קריא — השורות הן החישוב לפי המחירון בלבד.'
        : differenceMinorUnits === 0
          ? 'הסכום שנקבע להזמנה שווה לחישוב לפי המחירון.'
          : 'הסכום שנקבע להזמנה הוא הקובע; שורת ההתאמה מראה את הפער מול המחירון.',
  };
}

module.exports = { DELIVERY_PRICE_MINOR_UNITS, orderPriceBreakdown };
