'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

// The Hebrew `name` on a customer-site card is not copy — it is the ORDER
// KEY. The panel prices an extra by looking its name up in the menu, so a
// name that drifts by one word is a dish the panel cannot price. That is not
// hypothetical: the site sold "סיר קובה סלק עבודת יד" while the panel knew
// "סיר קובה סלק בתוספת אורז (ל־4 אנשים)", and $125 went unbilled.
//
// Same tripwire style as tests/package-rules.test.js: read the panel's own
// defaults as text, so no TS toolchain is needed to run it.

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

// Quote-aware — a dish name may legitimately contain the other quote
// character ('מגש שניצלים (זוגי, כ־13–15 יח\')', 'סלט תפו"א').
const STRING_LITERAL = /(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/gu;
const NAME_FIELD = /\bname: (?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/gu;
const HEBREW = /[֐-׿]/u;

function literals(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => match[1] ?? match[2] ?? '');
}

function hebrewNames(source, pattern) {
  return literals(source, pattern).filter((name) => HEBREW.test(name));
}

function canonicalNames() {
  const panel = read('web/src/domain/order-editor.ts');
  const between = (start, end) => {
    const from = panel.indexOf(start);
    assert.ok(from > -1, `expected ${start} in the panel menu`);
    const to = panel.indexOf(end, from);
    assert.ok(to > from, `expected ${end} after ${start}`);
    return panel.slice(from, to);
  };
  return new Set([
    ...hebrewNames(between('const DEFAULT_MENU_CATEGORIES', 'const DEFAULT_EXTRAS_DOLLARS'), STRING_LITERAL),
    ...hebrewNames(between('const DEFAULT_EXTRAS_DOLLARS', '] as const'), STRING_LITERAL),
    ...hebrewNames(between('const DEFAULT_LUNCH', 'export function buildOrderEditorMenu'), NAME_FIELD),
  ]);
}

const ORDER_PAGES = ['shabbat-order', 'shabbat-extras', 'weekdays'];

// Names the site sells that the panel has no single matching item for. These
// are STRUCTURAL, not typos — one site card stands for several panel items,
// or for a charge the panel computes itself and refuses as a manual extra.
// Each needs a product decision, not a rename. Listed so the check passes
// today while the debt stays visible: resolving one means deleting its line,
// and a NEW drift can never join the list by accident.
const KNOWN_UNRESOLVED = [
  // One card covering both sauces; the panel keeps פילה דג ברוטב מרוקאי and
  // פילה דג ברוטב חריימה as separate dishes.
  'זוג פילה דג בר טרי (חריימה/מרוקאי)',
  'זוג פילה דג בר-ים טרי',
  // One card covering three separate $25 panel extras: אורז / קוסקוס / פסטה אדומה.
  'מגש אורז / קוסקוס / פסטה אדומה',
  // Reserved automatic-charge names (order-total.ts): the panel prices extra
  // salads and extra challahs itself and strips these from the menu, so an
  // order carrying them as extras can never be priced from them.
  'תוספת 4 סלטים לבחירה',
  'תוספת חלה',
];

test('the panel exposes a plausible canonical menu to read', () => {
  const canonical = canonicalNames();
  assert.ok(canonical.size > 40, `expected a full menu, got ${canonical.size} names`);
  assert.ok(canonical.has('סיר קובה סלק בתוספת אורז (ל־4 אנשים)'));
  assert.ok(canonical.has('מנת קובה סלק ביתית'));
});

for (const page of ORDER_PAGES) {
  test(`customer-site ${page} orders under canonical panel names`, () => {
    const canonical = canonicalNames();
    const names = hebrewNames(read(`customer-site/src/pages/${page}.tsx`), NAME_FIELD);
    assert.ok(names.length > 0, `expected dish names in ${page}`);
    const drifted = [...new Set(names.filter((name) => !canonical.has(name)))]
      .filter((name) => !KNOWN_UNRESOLVED.includes(name));
    assert.deepEqual(drifted, [], `${page} sells names the panel cannot price`);
  });
}

test('the unresolved list carries no stale entries', () => {
  const everySiteName = new Set(
    ORDER_PAGES.flatMap((page) => literals(read(`customer-site/src/pages/${page}.tsx`), NAME_FIELD)),
  );
  for (const name of KNOWN_UNRESOLVED) {
    assert.ok(everySiteName.has(name), `${name} is resolved — remove it from KNOWN_UNRESOLVED`);
  }
});
