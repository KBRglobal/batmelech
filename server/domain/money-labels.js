'use strict';

// Money the way a model can quote it without arithmetic.
//
// The business bills in USD but lives in Dubai, so "how much did she pay" is
// answered in dollars and immediately followed by "and in dirhams?". Left to
// itself the model converts in its head — and gets it wrong (a 148$ order
// became "143 dirhams" in the staff chat). So every `...MinorUnits` number
// that leaves a read tool is accompanied by two ready-made strings: the USD
// amount and its AED equivalent at the central-bank peg. The model copies;
// it never computes.

const USD_TO_AED = 3.6725; // UAE dirham peg to the US dollar, fixed since 1997

const MINOR_UNITS_SUFFIX = 'MinorUnits';

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function usdLabel(minorUnits) {
  return (minorUnits / 100).toFixed(2);
}

// Integer arithmetic on purpose: 430 * 3.6725 is 1579.175 exactly, but in
// binary floating point it lands a hair under and toFixed would say .17.
const AED_PER_USD_TEN_THOUSANDTHS = Math.round(USD_TO_AED * 10_000);

function aedLabel(minorUnits) {
  const aedMinorUnits = Math.round((minorUnits * AED_PER_USD_TEN_THOUSANDTHS) / 10_000);
  return (aedMinorUnits / 100).toFixed(2);
}

/**
 * Deep-copies `value`, and next to every finite `<name>MinorUnits` number adds
 * `<name>Usd` and `<name>Aed` strings. Nulls (unreadable amounts) stay null and
 * get no labels — an absent label is the honest signal.
 */
function withCurrencyLabels(value) {
  if (Array.isArray(value)) return value.map(withCurrencyLabels);
  if (!isRecord(value)) return value;
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    output[key] = withCurrencyLabels(nested);
    if (!key.endsWith(MINOR_UNITS_SUFFIX) || key.length === MINOR_UNITS_SUFFIX.length) continue;
    if (typeof nested !== 'number' || !Number.isFinite(nested)) continue;
    const base = key.slice(0, -MINOR_UNITS_SUFFIX.length);
    output[`${base}Usd`] = usdLabel(nested);
    output[`${base}Aed`] = aedLabel(nested);
  }
  return output;
}

module.exports = { USD_TO_AED, aedLabel, usdLabel, withCurrencyLabels };
