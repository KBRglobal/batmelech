import { describe, expect, it } from 'vitest'
import { applyOrderQuickFields, nextOrderStatus } from './order-quick-actions.ts'
import type { LegacyStore } from './store.ts'

describe('order quick actions', () => {
  it('advances along the workflow and stops at delivered, cancelled, or unknown statuses', () => {
    expect(nextOrderStatus('מתעניין')).toBe('חדשה')
    expect(nextOrderStatus('חדשה')).toBe('אושרה')
    expect(nextOrderStatus('אושרה')).toBe('מוכנה')
    expect(nextOrderStatus('מוכנה')).toBe('במשלוח')
    expect(nextOrderStatus('במשלוח')).toBe('נמסרה')
    expect(nextOrderStatus('נמסרה')).toBeNull()
    expect(nextOrderStatus('בוטלה')).toBeNull()
    expect(nextOrderStatus('')).toBeNull()
  })

  it('updates exactly one order and refuses missing or duplicate IDs', () => {
    const store: LegacyStore = {
      orders: [
        { id: 'a', status: 'חדשה', paid: 'לא', notes: 'keep' },
        { id: 'b', status: 'חדשה' },
      ],
    }
    const updated = applyOrderQuickFields(store, 'a', { status: 'אושרה', paid: 'מקדמה' })
    expect(updated?.orders[0]).toMatchObject({ id: 'a', status: 'אושרה', paid: 'מקדמה', notes: 'keep' })
    expect(updated?.orders[1]).toMatchObject({ id: 'b', status: 'חדשה' })
    expect(store.orders[0]).toMatchObject({ status: 'חדשה' })

    expect(applyOrderQuickFields(store, 'missing', { status: 'אושרה' })).toBeNull()
    const duplicated: LegacyStore = { orders: [{ id: 'x' }, { id: 'x' }] }
    expect(applyOrderQuickFields(duplicated, 'x', { status: 'אושרה' })).toBeNull()
  })
})
