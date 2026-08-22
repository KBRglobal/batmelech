'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { costRecipe, productLibraryMap, marginMinorUnits } = require('../server/domain/recipe-cost');

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'recipe-cost-cases.json'), 'utf8'),
);
const library = productLibraryMap(fixture.productLibrary);

// The same fixture runs through the panel's TypeScript engine in
// web/src/domain/recipe-cost-parity.test.ts. Both must land on these exact
// numbers — that is what makes "כמה עלה לי" one answer instead of two.
for (const testCase of fixture.cases) {
  test(`recipe cost: ${testCase.name}`, () => {
    const result = costRecipe(testCase.recipe, library);
    const { expected } = testCase;

    assert.equal(result.complete, expected.complete);
    assert.equal(result.totalMinorUnits, expected.totalMinorUnits);
    assert.equal(result.perYieldUnitMinorUnits, expected.perYieldUnitMinorUnits);
    assert.equal(result.totalWeightGrams, expected.totalWeightGrams);
    assert.equal(result.minorUnitsPer100g, expected.minorUnitsPer100g);

    assert.deepEqual(
      Object.fromEntries(result.ingredientCosts.map((row) => [row.ingredientId, row.supplier])),
      expected.supplierByIngredient,
    );
    assert.deepEqual(
      result.warnings.map((warning) => warning.code).sort(),
      [...expected.warningCodes].sort(),
    );
  });
}

test('margin is the sale minus the cost, and goes negative on a loss', () => {
  assert.equal(marginMinorUnits(1_000, 2_500), 1_500);
  assert.equal(marginMinorUnits(3_000, 2_500), -500);
});

test('an unpriceable ingredient never silently costs zero — it is named', () => {
  const result = costRecipe(
    {
      itemId: 'x',
      yield: 1,
      ingredients: [{ ingredientId: 'nope', ingredientName: 'לא קיים', quantity: '1', unit: 'ק"ג' }],
    },
    library,
  );
  assert.equal(result.complete, false);
  assert.equal(result.totalMinorUnits, 0);
  assert.equal(result.warnings[0].code, 'MISSING_PRODUCT');
  assert.match(result.warnings[0].message, /לא קיים/u);
});
