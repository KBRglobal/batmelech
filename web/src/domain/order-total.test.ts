import { describe, expect, it } from 'vitest'
import {
  CHRAIME_FILLET_NAME,
  FISH_CAKE_PORTION_NAME,
  MOROCCAN_FILLET_NAME,
} from './fish-pricing.ts'
import { getUsdMinorUnits } from './money.ts'
import {
  LEGACY_FISH_CAKE_EXTRA_NAME,
  LEGACY_FISH_DISH_EXTRA_NAME,
  LEGACY_SALAD_BLOCK_EXTRA_NAME,
  LEGACY_CHALLAH_EXTRA_NAME,
  DELIVERY_EXTRA_NAME,
  calculateOrderTotal,
  type ChargeLineInput,
  type OrderTotalInput,
} from './order-total.ts'

const COUPLE_MEAL_PRICE_MINOR_UNITS = 23_000

function orderInput(overrides: Partial<OrderTotalInput> = {}): OrderTotalInput {
  return {
    coupleMeals: 0,
    coupleMealUnitPriceMinorUnits: COUPLE_MEAL_PRICE_MINOR_UNITS,
    fishQuantities: {},
    orderedSalads: 0,
    ...overrides,
  }
}

describe('calculateOrderTotal', () => {
  it('uses the mixed fish and salad allowances inside one couple-meal total', () => {
    const result = calculateOrderTotal(
      orderInput({
        coupleMeals: 1,
        fishQuantities: {
          [MOROCCAN_FILLET_NAME]: 1,
          [CHRAIME_FILLET_NAME]: 1,
        },
        orderedSalads: 4,
      }),
    )

    expect(result.fish).toEqual(
      expect.objectContaining({ selectedUnits: 2, includedUnits: 2, extraUnits: 0 }),
    )
    expect(result.salads).toEqual(
      expect.objectContaining({ orderedSalads: 4, allowanceSalads: 4, extraSalads: 0 }),
    )
    expect(result.lines).toEqual([
      expect.objectContaining({
        kind: 'couple-meal',
        quantity: 1,
        unitPriceMinorUnits: COUPLE_MEAL_PRICE_MINOR_UNITS,
        amountMinorUnits: COUPLE_MEAL_PRICE_MINOR_UNITS,
      }),
    ])
    expect(result.totalMinorUnits).toBe(COUPLE_MEAL_PRICE_MINOR_UNITS)
    expect(getUsdMinorUnits(result.totalMoney)).toBe(result.totalMinorUnits)
  })

  it('adds one extra fish unit and one extra salad exactly once', () => {
    const result = calculateOrderTotal(
      orderInput({
        coupleMeals: 1,
        fishQuantities: {
          [MOROCCAN_FILLET_NAME]: 2,
          [CHRAIME_FILLET_NAME]: 1,
        },
        orderedSalads: 5,
      }),
    )

    expect(result.fish.surchargeMinorUnits).toBe(3_000)
    expect(result.salads.surchargeMinorUnits).toBe(700)
    expect(result.lines.filter((line) => line.kind === 'fish-surcharge')).toHaveLength(1)
    expect(result.lines.filter((line) => line.kind === 'salad-surcharge')).toEqual([
      expect.objectContaining({ quantity: 1, unitPriceMinorUnits: 700, amountMinorUnits: 700 }),
    ])
    expect(result.totalMinorUnits).toBe(23_000 + 3_000 + 700)
  })

  it('charges standalone fish and salads when there is no couple meal', () => {
    const result = calculateOrderTotal(
      orderInput({
        fishQuantities: { [MOROCCAN_FILLET_NAME]: 1 },
        orderedSalads: 4,
      }),
    )

    expect(result.fish.surchargeMinorUnits).toBe(3_000)
    expect(result.salads.surchargeMinorUnits).toBe(2_500)
    expect(result.totalMinorUnits).toBe(5_500)
  })

  it('treats a fish-cake portion as two fish units in the combined total', () => {
    expect(
      calculateOrderTotal(
        orderInput({
          coupleMeals: 1,
          fishQuantities: { [FISH_CAKE_PORTION_NAME]: 1 },
        }),
      ).fish.surchargeMinorUnits,
    ).toBe(0)
    expect(
      calculateOrderTotal(
        orderInput({ fishQuantities: { [FISH_CAKE_PORTION_NAME]: 1 } }),
      ).totalMinorUnits,
    ).toBe(6_000)
  })

  it('excludes every superseded legacy automatic-extra row from charging', () => {
    const result = calculateOrderTotal(
      orderInput({
        coupleMeals: 1,
        fishQuantities: { [MOROCCAN_FILLET_NAME]: 3 },
        orderedSalads: 8,
        chargeLines: [
          {
            source: 'legacy-extra',
            name: `  ${LEGACY_FISH_DISH_EXTRA_NAME}  `,
            quantity: 1,
            unitPriceMinorUnits: 3_500,
          },
          {
            source: 'legacy-extra',
            name: LEGACY_FISH_CAKE_EXTRA_NAME,
            quantity: 1,
            unitPriceMinorUnits: 7_000,
          },
          {
            source: 'legacy-extra',
            name: LEGACY_SALAD_BLOCK_EXTRA_NAME,
            quantity: 1,
            unitPriceMinorUnits: 2_500,
          },
        ],
      }),
    )

    expect(result.fish.surchargeMinorUnits).toBe(3_000)
    expect(result.salads.surchargeMinorUnits).toBe(2_500)
    expect(result.totalMinorUnits).toBe(23_000 + 3_000 + 2_500)
    expect(result.excludedLegacyExtras.map((line) => line.name)).toEqual([
      LEGACY_FISH_DISH_EXTRA_NAME,
      LEGACY_FISH_CAKE_EXTRA_NAME,
      LEGACY_SALAD_BLOCK_EXTRA_NAME,
    ])
    expect(result.lines.filter((line) => line.kind === 'manual')).toHaveLength(0)
  })

  it('continues to charge explicit non-automatic menu, lunch, and custom lines', () => {
    const result = calculateOrderTotal(
      orderInput({
        chargeLines: [
          {
            source: 'delivery',
            name: DELIVERY_EXTRA_NAME,
            quantity: 1,
            unitPriceMinorUnits: 1_500,
          },
          {
            source: 'lunch',
            name: 'בגט טוניסאי אותנטי',
            quantity: 2,
            unitPriceMinorUnits: 2_200,
          },
          {
            source: 'custom',
            name: 'פריט מותאם',
            quantity: 3,
            unitPriceMinorUnits: 125,
          },
        ],
      }),
    )

    expect(result.totalMinorUnits).toBe(1_500 + 4_400 + 375)
    expect(result.lines.map((line) => line.amountMinorUnits)).toEqual([1_500, 4_400, 375])
  })

  it('excludes automatic-name aliases from custom and legacy rows but permits the one generated delivery line', () => {
    const result = calculateOrderTotal(orderInput({
      chargeLines: [
        { source: 'custom', name: '  תוספת   מנת דג ', quantity: 1, unitPriceMinorUnits: 99_900 },
        { source: 'custom', name: 'משלוח', quantity: 1, unitPriceMinorUnits: 99_900 },
        { source: 'legacy-extra', name: `  ${LEGACY_CHALLAH_EXTRA_NAME} `, quantity: 1, unitPriceMinorUnits: 1_000 },
        { source: 'delivery', name: DELIVERY_EXTRA_NAME, quantity: 1, unitPriceMinorUnits: 1_500 },
      ],
    }))

    expect(result.totalMinorUnits).toBe(1_500)
    expect(result.excludedLegacyExtras).toHaveLength(3)
  })

  it('does not mutate the order or any nested pricing input', () => {
    const fishQuantities = Object.freeze({ [MOROCCAN_FILLET_NAME]: 3 })
    const chargeLines = Object.freeze([
      Object.freeze({
        source: 'legacy-extra' as const,
        name: LEGACY_FISH_DISH_EXTRA_NAME,
        quantity: 1,
        unitPriceMinorUnits: 3_500,
      }),
    ])
    const input = Object.freeze(
      orderInput({
        coupleMeals: 1,
        fishQuantities,
        orderedSalads: 5,
        chargeLines,
      }),
    )

    calculateOrderTotal(input)

    expect(input.fishQuantities).toBe(fishQuantities)
    expect(input.chargeLines).toBe(chargeLines)
    expect(chargeLines[0]?.name).toBe(LEGACY_FISH_DISH_EXTRA_NAME)
  })

  it.each([
    { name: 'fractional meals', overrides: { coupleMeals: 1.5 } },
    { name: 'string meal price', overrides: { coupleMealUnitPriceMinorUnits: '23000' } },
    { name: 'non-array lines', overrides: { chargeLines: {} } },
    {
      name: 'unknown line source',
      overrides: {
        chargeLines: [{ source: 'unknown', name: 'x', quantity: 1, unitPriceMinorUnits: 1 }],
      },
    },
    {
      name: 'blank line name',
      overrides: {
        chargeLines: [{ source: 'other', name: ' ', quantity: 1, unitPriceMinorUnits: 1 }],
      },
    },
    {
      name: 'fractional line quantity',
      overrides: {
        chargeLines: [{ source: 'other', name: 'x', quantity: 1.5, unitPriceMinorUnits: 1 }],
      },
    },
    {
      name: 'unsafe unit price',
      overrides: {
        chargeLines: [
          {
            source: 'other',
            name: 'x',
            quantity: 1,
            unitPriceMinorUnits: Number.MAX_SAFE_INTEGER + 1,
          },
        ],
      },
    },
  ])('rejects $name instead of silently changing the total', ({ overrides }) => {
    expect(() =>
      calculateOrderTotal(orderInput(overrides as Partial<OrderTotalInput>)),
    ).toThrow()
  })

  it('rejects line multiplication and total addition overflow', () => {
    expect(() =>
      calculateOrderTotal(
        orderInput({
          chargeLines: [
            {
              source: 'other',
              name: 'overflowing line',
              quantity: 2,
              unitPriceMinorUnits: Number.MAX_SAFE_INTEGER,
            },
          ],
        }),
      ),
    ).toThrow(RangeError)

    expect(() =>
      calculateOrderTotal(
        orderInput({
          chargeLines: [
            {
              source: 'other',
              name: 'first',
              quantity: 1,
              unitPriceMinorUnits: Number.MAX_SAFE_INTEGER,
            },
            { source: 'other', name: 'second', quantity: 1, unitPriceMinorUnits: 1 },
          ],
        }),
      ),
    ).toThrow(RangeError)
  })

  it('rejects non-plain and inherited charge-line fields', () => {
    expect(() =>
      calculateOrderTotal(
        orderInput({
          chargeLines: [new Date() as unknown as ChargeLineInput],
        }),
      ),
    ).toThrow(TypeError)

    const inheritedLine = Object.create({
      source: 'other',
      name: 'inherited',
      quantity: 1,
      unitPriceMinorUnits: 100,
    }) as ChargeLineInput

    expect(() =>
      calculateOrderTotal(orderInput({ chargeLines: [inheritedLine] })),
    ).toThrow(TypeError)
  })

  it('accepts a null-prototype charge line without losing its own fields', () => {
    const line = Object.assign(Object.create(null) as Record<string, unknown>, {
      source: 'other',
      name: 'פריט בטוח',
      quantity: 2,
      unitPriceMinorUnits: 125,
    }) as unknown as ChargeLineInput

    expect(calculateOrderTotal(orderInput({ chargeLines: [line] })).totalMinorUnits).toBe(250)
  })
})
