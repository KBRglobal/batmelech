import { describe, expect, it } from 'vitest'
import {
  applyOrderFieldEdit,
  applyOrderQuickFields,
  nextOrderStatus,
} from './order-quick-actions.ts'
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

describe('applyOrderFieldEdit', () => {
  // A fixture carrying server-owned fields (mey*/courier*/deliveryProof*/
  // intakeConversation) — an inline edit must never touch them.
  function fieldStore(): LegacyStore {
    return {
      orders: [
        {
          id: 'a',
          name: 'לקוחה ראשונה',
          date: '2099-08-14',
          time: '12:00',
          total: '50.00',
          status: 'חדשה',
          paid: 'לא',
          notes: 'keep',
          meyToken: 'mey-token',
          meyLeadNudgeAt: 123,
          courierNote: 'courier says hi',
          courierCheckinState: 'onTheWay',
          deliveryProofUrl: 'https://example.com/proof.jpg',
          intakeConversation: 'original whatsapp thread',
        },
        { id: 'b', name: 'אחרת', date: '2099-08-15' },
      ],
    }
  }

  it('edits each allowed field in isolation and preserves every other field', () => {
    const store = fieldStore()

    const name = applyOrderFieldEdit(store, 'a', 'name', '  שם חדש  ')
    expect(name).toEqual({ ok: true, store: expect.anything() })
    if (!name.ok) throw new Error('unreachable')
    expect(name.store.orders[0]).toEqual({ ...store.orders[0], name: 'שם חדש' })
    expect(name.store.orders[1]).toBe(store.orders[1])

    const date = applyOrderFieldEdit(store, 'a', 'date', '2099-12-31')
    if (!date.ok) throw new Error('date edit failed')
    expect(date.store.orders[0]).toEqual({ ...store.orders[0], date: '2099-12-31' })

    const time = applyOrderFieldEdit(store, 'a', 'time', '23:59')
    if (!time.ok) throw new Error('time edit failed')
    expect(time.store.orders[0]).toEqual({ ...store.orders[0], time: '23:59' })

    const clearedTime = applyOrderFieldEdit(store, 'a', 'time', '')
    if (!clearedTime.ok) throw new Error('time clear failed')
    expect(clearedTime.store.orders[0]).toEqual({ ...store.orders[0], time: '' })

    const total = applyOrderFieldEdit(store, 'a', 'total', '120.5')
    if (!total.ok) throw new Error('total edit failed')
    expect(total.store.orders[0]).toEqual({ ...store.orders[0], total: '120.5' })

    // The protected server-owned fields survive verbatim.
    expect(total.store.orders[0]).toMatchObject({
      meyToken: 'mey-token',
      meyLeadNudgeAt: 123,
      courierNote: 'courier says hi',
      courierCheckinState: 'onTheWay',
      deliveryProofUrl: 'https://example.com/proof.jpg',
      intakeConversation: 'original whatsapp thread',
    })

    // The input store itself is never mutated.
    expect(store).toEqual(fieldStore())
  })

  it('rejects every invalid value without producing a store', () => {
    const store = fieldStore()
    const invalid: readonly (readonly ['name' | 'date' | 'time' | 'total', string])[] = [
      ['name', ''],
      ['name', '   '],
      ['name', 'א'.repeat(201)],
      ['date', '2099-02-30'],
      ['date', '2099-13-01'],
      ['date', '2099-1-1'],
      ['date', 'מחר'],
      ['date', ''],
      ['time', '24:00'],
      ['time', '9:5'],
      ['time', '12:60'],
      ['time', 'noon'],
      ['total', '-1'],
      ['total', 'abc'],
      ['total', '1.234'],
      ['total', '10,000'],
      ['total', ''],
    ]
    for (const [field, value] of invalid) {
      expect(applyOrderFieldEdit(store, 'a', field, value)).toEqual({
        ok: false,
        error: 'invalid-value',
      })
    }
    expect(store).toEqual(fieldStore())
  })

  it('accepts boundary values', () => {
    const store = fieldStore()
    expect(applyOrderFieldEdit(store, 'a', 'name', 'א'.repeat(200)).ok).toBe(true)
    expect(applyOrderFieldEdit(store, 'a', 'total', '0').ok).toBe(true)
    expect(applyOrderFieldEdit(store, 'a', 'time', '00:00').ok).toBe(true)
    expect(applyOrderFieldEdit(store, 'a', 'date', '2024-02-29').ok).toBe(true)
    expect(applyOrderFieldEdit(store, 'a', 'date', '2023-02-29').ok).toBe(false)
  })

  it('refuses missing and duplicate order IDs', () => {
    const store = fieldStore()
    expect(applyOrderFieldEdit(store, 'missing', 'name', 'שם')).toEqual({
      ok: false,
      error: 'unknown-order',
    })
    const duplicated: LegacyStore = { orders: [{ id: 'x' }, { id: 'x' }] }
    expect(applyOrderFieldEdit(duplicated, 'x', 'name', 'שם')).toEqual({
      ok: false,
      error: 'unknown-order',
    })
    expect(store).toEqual(fieldStore())
  })
})
