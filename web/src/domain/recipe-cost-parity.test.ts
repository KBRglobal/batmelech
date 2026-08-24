import { describe, expect, it } from 'vitest'

import fixtureJson from '../../../tests/fixtures/recipe-cost-cases.json'
import { productLibraryMap, type ProductLibraryEntry } from './product-library.ts'
import { costRecipe } from './recipe-costing.ts'
import type { RecipeDefinition } from './recipes.ts'

// The panel half of the costing parity check. server/domain/recipe-cost.js is
// a line-for-line port of costRecipe(), and tests/recipe-cost.test.js runs
// THIS fixture through it. Both must land on the same numbers: when Lin asks
// מיי "כמה עלה לי המנה" and then opens the panel, one of them being a cent
// off is a bug, not a rounding detail.
//
// The fixture is JSON so neither side owns it. If a costing rule changes on
// purpose, update the fixture and make both suites green.

interface CostCase {
  readonly name: string
  readonly recipe: RecipeDefinition
  readonly expected: {
    readonly complete: boolean
    readonly totalMinorUnits: number
    readonly perYieldUnitMinorUnits: number
    readonly totalWeightGrams: number | null
    readonly minorUnitsPer100g: number | null
    readonly supplierByIngredient: Readonly<Record<string, string | null>>
    readonly warningCodes: readonly string[]
  }
}

const fixture = fixtureJson as unknown as {
  readonly productLibrary: readonly ProductLibraryEntry[]
  readonly cases: readonly CostCase[]
}

describe('recipe costing parity with the server engine', () => {
  const library = productLibraryMap(fixture.productLibrary)

  it('has a fixture with real cases in it', () => {
    expect(fixture.cases.length).toBeGreaterThan(4)
  })

  it.each(fixture.cases.map((testCase) => [testCase.name, testCase] as const))('%s', (_name, testCase) => {
    const result = costRecipe(testCase.recipe, library)
    const { expected } = testCase

    expect(result.complete).toBe(expected.complete)
    expect(result.totalMinorUnits).toBe(expected.totalMinorUnits)
    expect(result.perYieldUnitMinorUnits).toBe(expected.perYieldUnitMinorUnits)
    expect(result.totalWeightGrams).toBe(expected.totalWeightGrams)
    expect(result.minorUnitsPer100g).toBe(expected.minorUnitsPer100g)

    expect(
      Object.fromEntries(result.ingredientCosts.map((row) => [row.ingredientId, row.supplier])),
    ).toEqual(expected.supplierByIngredient)
    expect([...result.warnings.map((warning) => warning.code)].sort()).toEqual([...expected.warningCodes].sort())
  })
})
