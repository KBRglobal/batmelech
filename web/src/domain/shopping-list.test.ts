import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  buildPreparationPlan,
  type PreparationCatalog,
  type PreparationItemDemand,
  type ProcurementPolicy,
} from './preparation.ts'
import {
  validateRecipeDefinition,
  type RecipeDefinition,
} from './recipes.ts'
import { buildShoppingList } from './shopping-list.ts'

const RECIPE = { kind: 'recipe' } as const
const NONE = { kind: 'none' } as const

function demand(
  itemId: string,
  itemName: string,
  quantity: number,
  serviceDate = '2026-08-15',
  procurement: ProcurementPolicy = RECIPE,
): PreparationItemDemand {
  return {
    serviceDate,
    category: 'mains',
    itemId,
    itemName,
    quantity,
    procurement,
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}

function serializable<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown
}

describe('buildShoppingList', () => {
  it('consumes stable item demands emitted by preparation with injected catalog metadata', () => {
    const catalog = {
      items: [
        { id: 'main-stew', category: 'mains', name: 'Stew', procurement: RECIPE },
      ],
      lunchItems: [],
    } satisfies PreparationCatalog
    const plan = buildPreparationPlan(
      [
        {
          id: 'order-1',
          date: '2026-08-15',
          name: 'Customer',
          mains: { Stew: '2' },
        },
      ],
      catalog,
    )

    const result = buildShoppingList(plan.itemDemands, [
      {
        itemId: 'main-stew',
        yield: 2,
        ingredients: [
          {
            ingredientId: 'onion',
            ingredientName: 'Onion',
            quantity: '1',
            unit: 'kg',
          },
        ],
      },
    ])

    expect(plan.complete).toBe(true)
    expect(result).toEqual({
      complete: true,
      items: [
        {
          ingredientId: 'onion',
          ingredientName: 'Onion',
          quantity: '1',
          unit: 'kg',
          sources: [
            {
              itemId: 'main-stew',
              itemName: 'Stew',
              serviceDate: '2026-08-15',
              demandedQuantity: 2,
              ingredientQuantity: '1',
            },
          ],
        },
      ],
      warnings: [],
    })
  })

  it('scales by explicit yield and aggregates shared ingredients while retaining per-date provenance', () => {
    const demands = [
      demand('main-stew', 'Stew', 4, '2026-08-15'),
      demand('main-stew', 'Stew', 2, '2026-08-22'),
      demand('main-roast', 'Roast', 2, '2026-08-15'),
    ]
    const recipes: RecipeDefinition[] = [
      {
        itemId: 'main-stew',
        name: 'Stew recipe',
        yield: 4,
        ingredients: [
          {
            ingredientId: 'onion',
            ingredientName: 'Onion',
            quantity: '2',
            unit: 'kg',
          },
        ],
      },
      {
        itemId: 'main-roast',
        yield: 2,
        ingredients: [
          {
            ingredientId: 'onion',
            ingredientName: 'Onion',
            quantity: '1',
            unit: 'kg',
          },
        ],
      },
    ]

    expect(buildShoppingList(demands, recipes)).toEqual({
      complete: true,
      items: [
        {
          ingredientId: 'onion',
          ingredientName: 'Onion',
          quantity: '4',
          unit: 'kg',
          sources: [
            {
              itemId: 'main-roast',
              itemName: 'Roast',
              serviceDate: '2026-08-15',
              demandedQuantity: 2,
              ingredientQuantity: '1',
            },
            {
              itemId: 'main-stew',
              itemName: 'Stew',
              serviceDate: '2026-08-15',
              demandedQuantity: 4,
              ingredientQuantity: '2',
            },
            {
              itemId: 'main-stew',
              itemName: 'Stew',
              serviceDate: '2026-08-22',
              demandedQuantity: 2,
              ingredientQuantity: '1',
            },
          ],
        },
      ],
      warnings: [],
    })
  })

  it('keeps incompatible units separate and performs no implicit conversion', () => {
    const result = buildShoppingList(
      [demand('mixed', 'Mixed dish', 1)],
      [
        {
          itemId: 'mixed',
          yield: 1,
          ingredients: [
            { ingredientId: 'salt', ingredientName: 'Salt', quantity: '1', unit: 'kg' },
            { ingredientId: 'salt', ingredientName: 'Salt', quantity: '500', unit: 'g' },
          ],
        },
      ],
    )

    expect(result.items.map(({ ingredientId, quantity, unit }) => ({ ingredientId, quantity, unit })))
      .toEqual([
        { ingredientId: 'salt', quantity: '500', unit: 'g' },
        { ingredientId: 'salt', quantity: '1', unit: 'kg' },
      ])
    expect(result.warnings).toEqual([])
  })

  it('applies waste after yield scaling with deterministic upward rounding', () => {
    const exact = buildShoppingList(
      [demand('stew', 'Stew', 5)],
      [
        {
          itemId: 'stew',
          yield: 10,
          ingredients: [
            {
              ingredientId: 'potato',
              ingredientName: 'Potato',
              quantity: '10',
              unit: 'kg',
              wastePercent: '20',
            },
          ],
        },
      ],
    )
    const rounded = buildShoppingList(
      [demand('third', 'Third', 1)],
      [
        {
          itemId: 'third',
          yield: 3,
          ingredients: [
            { ingredientId: 'flour', ingredientName: 'Flour', quantity: '1', unit: 'kg' },
          ],
        },
      ],
    )

    expect(exact.items[0]?.quantity).toBe('6')
    expect(exact.items[0]?.sources[0]?.ingredientQuantity).toBe('6')
    expect(rounded.items[0]?.quantity).toBe('0.333334')
    expect(exact.warnings).toEqual([])
    expect(rounded.warnings).toEqual([])
  })

  it('adds decimal recipe quantities exactly without binary floating-point artifacts', () => {
    const result = buildShoppingList(
      [demand('decimal-a', 'Decimal A', 1), demand('decimal-b', 'Decimal B', 1)],
      [
        {
          itemId: 'decimal-a',
          yield: 1,
          ingredients: [
            { ingredientId: 'spice', ingredientName: 'Spice', quantity: '0.1', unit: 'kg' },
          ],
        },
        {
          itemId: 'decimal-b',
          yield: 1,
          ingredients: [
            { ingredientId: 'spice', ingredientName: 'Spice', quantity: '0.2', unit: 'kg' },
          ],
        },
      ],
    )

    expect(result.items[0]?.quantity).toBe('0.3')
    expect(result.items[0]?.quantity).not.toContain('00000000000000004')
    expect(result.items[0]?.sources.map(({ ingredientQuantity }) => ingredientQuantity)).toEqual([
      '0.1',
      '0.2',
    ])
  })

  it('classifies recipe, direct-purchase, and non-procurement demands without false missing-recipe warnings', () => {
    const directPolicy = {
      kind: 'direct',
      ingredientId: 'wine-bottle',
      ingredientName: 'Wine bottle',
      unit: 'each',
      quantityPerItem: '0.75',
    } as const
    const result = buildShoppingList(
      [
        demand('delivery', 'Delivery', 1, '2026-08-15', NONE),
        demand('custom-note', 'Custom note', 3, '2026-08-15', NONE),
        demand('wine', 'Wine', 3, '2026-08-15', directPolicy),
      ],
      [],
    )

    expect(result).toEqual({
      complete: true,
      items: [
        {
          ingredientId: 'wine-bottle',
          ingredientName: 'Wine bottle',
          quantity: '2.25',
          unit: 'each',
          sources: [
            {
              itemId: 'wine',
              itemName: 'Wine',
              serviceDate: '2026-08-15',
              demandedQuantity: 3,
              ingredientQuantity: '2.25',
            },
          ],
        },
      ],
      warnings: [],
    })
  })

  it('reports missing recipes and strict recipe failures without emitting partial items for those demands', () => {
    const demands = [
      demand('bad-ingredient', 'Bad ingredient', 1),
      demand('bad-top', 'Bad top', 1),
      demand('bad-waste', 'Bad waste', 1),
      demand('bad-yield', 'Bad yield', 1),
      demand('missing', 'Missing dish', 1),
    ]
    const recipes = [
      {
        itemId: 'bad-yield',
        yield: 0,
        ingredients: [
          { ingredientId: 'onion', ingredientName: 'Onion', quantity: '1', unit: 'kg' },
        ],
      },
      {
        itemId: 'bad-ingredient',
        yield: 1,
        ingredients: [
          {
            ingredientId: 'onion',
            ingredientName: 'Onion',
            quanity: '1',
            unit: 'kg',
          },
        ],
      },
      {
        itemId: 'bad-waste',
        yield: 1,
        ingredients: [
          {
            ingredientId: 'onion',
            ingredientName: 'Onion',
            quantity: '1',
            unit: 'kg',
            wastePercent: '100.000001',
          },
        ],
      },
      {
        itemId: 'bad-top',
        yield: 1,
        ingredients: [
          { ingredientId: 'onion', ingredientName: 'Onion', quantity: '1', unit: 'kg' },
        ],
        yeild: 1,
      },
    ] as unknown as readonly RecipeDefinition[]

    const result = buildShoppingList(demands, recipes)

    expect(result.complete).toBe(false)
    expect(result.items).toEqual([])
    expect(result.warnings.map(({ code, itemId }) => ({ code, itemId }))).toEqual([
      { code: 'INVALID_RECIPE', itemId: 'bad-ingredient' },
      { code: 'INVALID_RECIPE', itemId: 'bad-top' },
      { code: 'INVALID_RECIPE', itemId: 'bad-waste' },
      { code: 'INVALID_RECIPE', itemId: 'bad-yield' },
      { code: 'MISSING_RECIPE', itemId: 'missing' },
    ])
    expect(result.warnings.find(({ itemId }) => itemId === 'bad-ingredient')?.issues?.join(' '))
      .toContain('quanity')
    expect(result.warnings.find(({ itemId }) => itemId === 'bad-top')?.issues?.join(' '))
      .toContain('yeild')
  })

  it('rejects fractional, string, unsafe, non-positive, invalid-date, nameless, and unsafe-procurement demands', () => {
    const invalidDemands = [
      demand('fraction', 'Fraction', 1.5),
      { ...demand('string', 'String', 1), quantity: '2' },
      demand('unsafe', 'Unsafe', Number.MAX_SAFE_INTEGER + 1),
      demand('zero', 'Zero', 0),
      demand('negative', 'Negative', -1),
      demand('date', 'Date', 1, '2026-02-30'),
      { ...demand('nameless', 'Name', 1), itemName: '   ' },
      {
        ...demand('direct-zero', 'Direct zero', 1),
        procurement: {
          kind: 'direct',
          ingredientId: 'item',
          ingredientName: 'Item',
          unit: 'each',
          quantityPerItem: '0',
        },
      },
      { ...demand('policy-extra', 'Policy extra', 1), procurement: { kind: 'none', extra: true } },
    ] as unknown as readonly PreparationItemDemand[]

    const result = buildShoppingList(invalidDemands, [])

    expect(result.items).toEqual([])
    expect(result.warnings).toHaveLength(invalidDemands.length)
    expect(result.warnings.every(({ code }) => code === 'INVALID_DEMAND')).toBe(true)
  })

  it('rejects demand aggregation overflow before recipe calculations', () => {
    const result = buildShoppingList(
      [
        demand('overflow', 'Overflow', Number.MAX_SAFE_INTEGER),
        demand('overflow', 'Overflow', 1),
      ],
      [
        {
          itemId: 'overflow',
          yield: 1,
          ingredients: [
            { ingredientId: 'salt', ingredientName: 'Salt', quantity: '1', unit: 'g' },
          ],
        },
      ],
    )

    expect(result.items).toEqual([])
    expect(result.warnings).toMatchObject([
      { code: 'DEMAND_OVERFLOW', itemId: 'overflow', serviceDate: '2026-08-15' },
    ])
  })

  it('reports recipe and direct-purchase output overflow instead of exposing imprecise quantities', () => {
    const recipeOverflow = buildShoppingList(
      [demand('huge-recipe', 'Huge recipe', 2)],
      [
        {
          itemId: 'huge-recipe',
          yield: 1,
          ingredients: [
            {
              ingredientId: 'huge',
              ingredientName: 'Huge',
              quantity: '999999999999.999999',
              unit: 'kg',
            },
          ],
        },
      ],
    )
    const directOverflow = buildShoppingList(
      [
        demand('huge-direct', 'Huge direct', 2, '2026-08-15', {
          kind: 'direct',
          ingredientId: 'huge',
          ingredientName: 'Huge',
          unit: 'each',
          quantityPerItem: '999999999999.999999',
        }),
      ],
      [],
    )

    for (const result of [recipeOverflow, directOverflow]) {
      expect(result.items).toEqual([])
      expect(result.warnings[0]?.code).toBe('QUANTITY_OVERFLOW')
      expect(result.complete).toBe(false)
    }
  })

  it('rejects canonical ingredient-name conflicts independent of demand and recipe input order', () => {
    const demands = [
      demand('dish-a', 'Dish A', 1),
      demand('dish-b', 'Dish B', 1),
      demand('dish-c', 'Dish C', 1),
    ]
    const recipes: RecipeDefinition[] = [
      {
        itemId: 'dish-a',
        yield: 1,
        ingredients: [
          { ingredientId: 'onion', ingredientName: 'Onion', quantity: '1', unit: 'kg' },
        ],
      },
      {
        itemId: 'dish-b',
        yield: 1,
        ingredients: [
          {
            ingredientId: 'onion',
            ingredientName: 'Yellow onion',
            quantity: '1',
            unit: 'kg',
          },
        ],
      },
      {
        itemId: 'dish-c',
        yield: 1,
        ingredients: [
          {
            ingredientId: 'onion',
            ingredientName: 'Brown onion',
            quantity: '1',
            unit: 'kg',
          },
        ],
      },
    ]
    const forward = buildShoppingList(demands, recipes)
    const reverse = buildShoppingList([...demands].reverse(), [...recipes].reverse())

    expect(reverse).toEqual(forward)
    expect(forward.items).toEqual([])
    expect(forward.warnings).toMatchObject([
      {
        code: 'INGREDIENT_IDENTITY_CONFLICT',
        message: 'Ingredient onion in kg has conflicting names: Brown onion, Onion, Yellow onion.',
      },
    ])
  })

  it('rejects conflicting demand names or procurement policies without selecting the first input', () => {
    const conflicting = [
      demand('same', 'First name', 1),
      demand('same', 'Second name', 1),
      demand('same', 'First name', 1, '2026-08-22', NONE),
    ]
    const forward = buildShoppingList(conflicting, [])
    const reverse = buildShoppingList([...conflicting].reverse(), [])

    expect(reverse).toEqual(forward)
    expect(forward.items).toEqual([])
    expect(forward.warnings).toMatchObject([
      { code: 'DEMAND_IDENTITY_CONFLICT', itemId: 'same' },
    ])
  })

  it('diagnoses duplicate recipe IDs identically for valid/invalid recipe permutations', () => {
    const valid = {
      itemId: 'duplicate',
      yield: 1,
      ingredients: [
        { ingredientId: 'onion', ingredientName: 'Onion', quantity: '1', unit: 'kg' },
      ],
    } satisfies RecipeDefinition
    const invalid = {
      itemId: 'duplicate',
      yield: 0,
      ingredients: [
        { ingredientId: 'onion', ingredientName: 'Onion', quantity: '1', unit: 'kg' },
      ],
    } as unknown as RecipeDefinition

    const validFirst = buildShoppingList([demand('duplicate', 'Duplicate', 1)], [valid, invalid])
    const invalidFirst = buildShoppingList([demand('duplicate', 'Duplicate', 1)], [invalid, valid])

    expect(invalidFirst).toEqual(validFirst)
    expect(validFirst.items).toEqual([])
    expect(validFirst.warnings).toMatchObject([
      {
        code: 'INVALID_RECIPE',
        itemId: 'duplicate',
        message: 'More than one recipe is configured for duplicate.',
      },
    ])
  })

  it('handles prototype-like IDs through maps without changing object prototypes', () => {
    const result = buildShoppingList(
      [demand('toString', 'Constructor dish', 1)],
      [
        {
          itemId: 'toString',
          yield: 1,
          ingredients: [
            {
              ingredientId: '__proto__',
              ingredientName: 'constructor',
              quantity: '1',
              unit: 'hasOwnProperty',
            },
          ],
        },
      ],
    )

    expect(result.items).toMatchObject([
      {
        ingredientId: '__proto__',
        ingredientName: 'constructor',
        quantity: '1',
        unit: 'hasOwnProperty',
      },
    ])
    expect((Object.prototype as { polluted?: unknown }).polluted).toBeUndefined()
  })

  it('does not mutate demands, recipes, ingredients, procurement metadata, or source arrays', () => {
    const demands = [demand('stew', 'Stew', 4)]
    const recipes: RecipeDefinition[] = [
      {
        itemId: 'stew',
        yield: 2,
        ingredients: [
          { ingredientId: 'onion', ingredientName: 'Onion', quantity: '1', unit: 'kg' },
        ],
      },
    ]
    const demandSnapshot = structuredClone(demands)
    const recipeSnapshot = structuredClone(recipes)
    deepFreeze(demands)
    deepFreeze(recipes)

    expect(() => buildShoppingList(demands, recipes)).not.toThrow()
    expect(demands).toEqual(demandSnapshot)
    expect(recipes).toEqual(recipeSnapshot)
  })

  it('is invariant to simultaneous demand and recipe permutations', () => {
    const demands = [
      demand('stew', 'Stew', 2, '2026-08-22'),
      demand('roast', 'Roast', 3, '2026-08-15'),
      demand('stew', 'Stew', 1, '2026-08-15'),
    ]
    const recipes: RecipeDefinition[] = [
      {
        itemId: 'stew',
        yield: 2,
        ingredients: [
          { ingredientId: 'onion', ingredientName: 'Onion', quantity: '0.2', unit: 'kg' },
        ],
      },
      {
        itemId: 'roast',
        yield: 3,
        ingredients: [
          { ingredientId: 'onion', ingredientName: 'Onion', quantity: '0.3', unit: 'kg' },
        ],
      },
    ]
    const expected = serializable(buildShoppingList(demands, recipes))

    fc.assert(
      fc.property(
        fc.tuple(
          fc.shuffledSubarray(demands, { minLength: demands.length, maxLength: demands.length }),
          fc.shuffledSubarray(recipes, { minLength: recipes.length, maxLength: recipes.length }),
        ),
        ([demandPermutation, recipePermutation]) => {
          expect(serializable(buildShoppingList(demandPermutation, recipePermutation))).toEqual(expected)
        },
      ),
      { numRuns: 50 },
    )
  })
})

describe('recipe validation', () => {
  const validRecipe = {
    itemId: 'bounded',
    name: 'Bounded recipe',
    yield: 1,
    ingredients: [
      {
        ingredientId: 'ingredient',
        ingredientName: 'Ingredient',
        quantity: '999999999999.999999',
        unit: 'kg',
        wastePercent: '100',
      },
    ],
  }

  it('accepts canonical bounded decimal strings and returns parsed immutable-compatible data', () => {
    const result = validateRecipeDefinition(validRecipe)

    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.recipe.ingredients[0]?.quantity).toBe('999999999999.999999')
      expect(result.recipe.ingredients[0]?.wastePercent).toBe('100')
    }
  })

  it.each([
    ['numeric quantity', { ...validRecipe, ingredients: [{ ...validRecipe.ingredients[0], quantity: 1 }] }],
    ['zero quantity', { ...validRecipe, ingredients: [{ ...validRecipe.ingredients[0], quantity: '0' }] }],
    ['leading zero', { ...validRecipe, ingredients: [{ ...validRecipe.ingredients[0], quantity: '01' }] }],
    ['scientific quantity', { ...validRecipe, ingredients: [{ ...validRecipe.ingredients[0], quantity: '1e-3' }] }],
    ['too many decimals', { ...validRecipe, ingredients: [{ ...validRecipe.ingredients[0], quantity: '0.0000001' }] }],
    ['too many integer digits', { ...validRecipe, ingredients: [{ ...validRecipe.ingredients[0], quantity: '1000000000000' }] }],
    ['waste above 100', { ...validRecipe, ingredients: [{ ...validRecipe.ingredients[0], wastePercent: '100.000001' }] }],
    ['fractional yield', { ...validRecipe, yield: 1.5 }],
    ['unsafe yield', { ...validRecipe, yield: Number.MAX_SAFE_INTEGER + 1 }],
    ['unknown recipe key', { ...validRecipe, yeild: 1 }],
    ['unknown ingredient key', { ...validRecipe, ingredients: [{ ...validRecipe.ingredients[0], unt: 'kg' }] }],
    [
      'conflicting ingredient identity',
      {
        ...validRecipe,
        ingredients: [
          validRecipe.ingredients[0],
          { ...validRecipe.ingredients[0], ingredientName: 'Different name' },
        ],
      },
    ],
  ])('rejects %s', (_name, recipe) => {
    const result = validateRecipeDefinition(recipe)

    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.issues.length).toBeGreaterThan(0)
  })
})
