import { describe, expect, it } from 'vitest'
import { usdFromMinorUnits } from './money.ts'
import {
  buildPreparationOperationsReview,
} from './operations-review.ts'
import type {
  PreparationPlan,
  PreparationWarning,
} from './preparation.ts'

function preparationPlan(
  warnings: readonly PreparationWarning[],
): PreparationPlan {
  const zero = usdFromMinorUnits(0)
  return {
    complete: warnings.length === 0,
    dates: [],
    finance: {
      revenue: zero,
      deposits: zero,
      outstanding: zero,
      valid: true,
    },
    itemDemands: [],
    warnings,
  }
}

describe('buildPreparationOperationsReview', () => {
  it('sums source occurrence counts while keeping warning details out of the advisory payload', () => {
    const presentation = buildPreparationOperationsReview(
      preparationPlan([
        {
          code: 'UNKNOWN_CATALOG_ITEM',
          orderId: 'private-order-a',
          path: 'orders[0].mains.Private dish',
          message: 'Private customer A selected Private dish',
          occurrences: 3,
        },
        {
          code: 'UNKNOWN_CATALOG_ITEM',
          orderId: 'private-order-b',
          path: 'orders[1].mains.Other private dish',
          message: 'Private customer B selected Other private dish',
          occurrences: 2,
        },
        {
          code: 'INVALID_QUANTITY',
          orderId: 'private-order-c',
          path: 'orders[2].quantity',
          message: 'Private customer C supplied a private value',
          occurrences: 4,
        },
      ]),
      '2026-08-15',
    )

    expect(presentation.snapshot.warnings).toHaveLength(2)
    expect(
      presentation.snapshot.warnings.find(({ code }) => code === 'UNKNOWN_CATALOG_ITEM'),
    ).toMatchObject({
      source: 'preparation',
      serviceDate: null,
      occurrences: 5,
      relatedDemandIds: [],
    })
    expect(
      presentation.snapshot.warnings.find(({ code }) => code === 'INVALID_QUANTITY'),
    ).toMatchObject({ occurrences: 4 })

    for (const warning of presentation.snapshot.warnings) {
      expect(Object.keys(warning).sort()).toEqual([
        'code',
        'id',
        'occurrences',
        'relatedDemandIds',
        'serviceDate',
        'source',
      ])
    }

    const serialized = JSON.stringify(presentation)
    expect(serialized).not.toContain('private-order')
    expect(serialized).not.toContain('Private customer')
    expect(serialized).not.toContain('Private dish')
    expect(presentation.key).toBe(JSON.stringify(presentation.snapshot))
  })
})
