import { describe, expect, it } from 'vitest'
import {
  BAKLAVA_HALF_UNITS_PER_PORTION,
  classifyDessertKind,
  defaultDessertPortionsForMeals,
  DESSERT_HALF_UNITS_INCLUDED_PER_MEAL,
  dessertHalfUnitsPerPortion,
  FISH_UNITS_INCLUDED_PER_MEAL,
  MAINS_INCLUDED_PER_MEAL,
  SALADS_INCLUDED_PER_MEAL,
  SIDES_INCLUDED_PER_MEAL,
  SOUFFLE_HALF_UNITS_PER_PORTION,
} from './package-rules.ts'

describe('classifyDessertKind', () => {
  it('recognizes soufflé and baklava regardless of exact suffix', () => {
    expect(classifyDessertKind('סופלה שוקולד')).toBe('souffle')
    expect(classifyDessertKind('סוכריות בקלוואה')).toBe('baklava')
    expect(classifyDessertKind('עוגת שוקולד')).toBe('unclassified')
  })
})

describe('dessertHalfUnitsPerPortion', () => {
  it('gives baklava twice the weight of a soufflé — one portion serves two', () => {
    expect(dessertHalfUnitsPerPortion('souffle')).toBe(SOUFFLE_HALF_UNITS_PER_PORTION)
    expect(dessertHalfUnitsPerPortion('baklava')).toBe(BAKLAVA_HALF_UNITS_PER_PORTION)
    expect(dessertHalfUnitsPerPortion('baklava')).toBe(dessertHalfUnitsPerPortion('souffle') * 2)
    expect(dessertHalfUnitsPerPortion('unclassified')).toBe(0)
  })
})

describe('defaultDessertPortionsForMeals', () => {
  it('gives one soufflé per person and one baklava portion per couple', () => {
    // 1 couple meal = 2 included half-units: 2 soufflés (1/person), or 1 baklava (serves 2).
    expect(defaultDessertPortionsForMeals('souffle', 1)).toBe(2)
    expect(defaultDessertPortionsForMeals('baklava', 1)).toBe(1)
    // 2 couple meals = 4 half-units: 4 soufflés, or 2 baklava portions.
    expect(defaultDessertPortionsForMeals('souffle', 2)).toBe(4)
    expect(defaultDessertPortionsForMeals('baklava', 2)).toBe(2)
  })

  it('never defaults to zero portions for a real dish, even at zero meals', () => {
    expect(defaultDessertPortionsForMeals('souffle', 0)).toBe(1)
    expect(defaultDessertPortionsForMeals('baklava', 0)).toBe(1)
  })

  it('gives zero for an unclassified dessert — nothing to default to', () => {
    expect(defaultDessertPortionsForMeals('unclassified', 2)).toBe(0)
  })
})

describe('package rule constants', () => {
  it('match what Lin confirmed on 2026-08-19', () => {
    expect(FISH_UNITS_INCLUDED_PER_MEAL).toBe(2)
    expect(SALADS_INCLUDED_PER_MEAL).toBe(4)
    expect(MAINS_INCLUDED_PER_MEAL).toBe(1)
    expect(SIDES_INCLUDED_PER_MEAL).toBe(1)
    expect(DESSERT_HALF_UNITS_INCLUDED_PER_MEAL).toBe(2)
  })
})
