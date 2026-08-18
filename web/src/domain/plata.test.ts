import { describe, expect, it } from 'vitest'
import {
  applyPlataToStore,
  canonicalPlataDeposit,
  isPlataFormValid,
  plataFormValues,
  readPlata,
  summarizeOutstandingPlata,
  type PlataFormValues,
} from './plata.ts'
import type { LegacyOrder, LegacyStore } from './store.ts'

function order(overrides: Partial<LegacyOrder> = {}): LegacyOrder {
  return { id: 'order-1', date: '2026-08-14', name: 'רותי', place: 'Atlantis', ...overrides }
}

function storeWith(orders: readonly LegacyOrder[]): LegacyStore {
  return { orders: [...orders] }
}

const emptyForm: PlataFormValues = { count: 0, deposit: '', status: 'withCustomer', note: '' }

describe('canonicalPlataDeposit', () => {
  it('normalises every shape an amount arrives in', () => {
    expect(canonicalPlataDeposit('50')).toBe('50.00')
    expect(canonicalPlataDeposit('50.5')).toBe('50.50')
    expect(canonicalPlataDeposit('$1,200.25')).toBe('1200.25')
    expect(canonicalPlataDeposit(37.5)).toBe('37.50')
    expect(canonicalPlataDeposit(0)).toBe('0.00')
  })

  it('refuses anything that is not a safe non-negative amount', () => {
    for (const value of ['', '  ', 'חמישים', '-5', '5.005', 'NaN', null, undefined, {}]) {
      expect(canonicalPlataDeposit(value)).toBeNull()
    }
  })
})

describe('readPlata', () => {
  it('reads a full hotplate record', () => {
    const view = readPlata(order({
      plataCount: 2,
      plataDeposit: '50',
      plataStatus: 'awaitingPickup',
      plataPickupNote: '  בקבלה  ',
      plataCollectedAt: 1_760_000_000_000,
    }))

    expect(view).toMatchObject({
      count: 2,
      deposit: '50.00',
      status: 'awaitingPickup',
      note: 'בקבלה',
      collectedAt: 1_760_000_000_000,
      depositReturnedAt: null,
      present: true,
    })
  })

  it('reports an order with no hotplate as absent, and drops unsafe values', () => {
    expect(readPlata(order()).present).toBe(false)
    expect(readPlata(order({ plataCount: 0 })).count).toBe(0)

    const unsafe = readPlata(order({
      plataCount: 2.5 as unknown as number,
      plataStatus: 'somewhere' as never,
      plataDeposit: 'חמישים',
      plataCollectedAt: -1,
    }))
    expect(unsafe).toMatchObject({ count: 0, status: null, deposit: '', collectedAt: null })
  })
})

describe('plataFormValues and isPlataFormValid', () => {
  it('opens on the stored values, or on an empty hotplate', () => {
    expect(plataFormValues(null)).toEqual(emptyForm)
    expect(plataFormValues(order())).toEqual(emptyForm)
    expect(plataFormValues(order({ plataCount: 1, plataDeposit: '30', plataStatus: 'collected' })))
      .toEqual({ count: 1, deposit: '30.00', status: 'collected', note: '' })
  })

  it('accepts a usable form and refuses an unusable one', () => {
    expect(isPlataFormValid(emptyForm)).toBe(true)
    expect(isPlataFormValid({ ...emptyForm, count: 2, deposit: '50' })).toBe(true)
    expect(isPlataFormValid({ ...emptyForm, count: -1 })).toBe(false)
    expect(isPlataFormValid({ ...emptyForm, count: 21 })).toBe(false)
    expect(isPlataFormValid({ ...emptyForm, count: 1, deposit: 'חמישים' })).toBe(false)
    expect(isPlataFormValid({ ...emptyForm, note: 'א'.repeat(301) })).toBe(false)
  })
})

describe('applyPlataToStore', () => {
  it('writes only the plata fields of the named order', () => {
    const base = storeWith([order({ id: 'a', notes: 'הערה' }), order({ id: 'b', name: 'קטי' })])
    const next = applyPlataToStore(base, 'a', {
      count: 2,
      deposit: '50',
      status: 'awaitingPickup',
      note: '  בקבלה  ',
    })

    expect(next.orders[0]).toMatchObject({
      id: 'a',
      name: 'רותי',
      notes: 'הערה',
      plataCount: 2,
      plataDeposit: '50.00',
      plataStatus: 'awaitingPickup',
      plataPickupNote: 'בקבלה',
    })
    expect(next.orders[1]).toEqual(base.orders[1])
    expect(base.orders[0]!.plataCount).toBeUndefined()
  })

  it('stamps a collection and a returned deposit once, and never moves them again', () => {
    const base = storeWith([order({ id: 'a', plataCount: 1, plataStatus: 'awaitingPickup' })])
    const collected = applyPlataToStore(base, 'a', { count: 1, deposit: '', status: 'collected', note: '' })
    const collectedAt = collected.orders[0]!.plataCollectedAt
    expect(typeof collectedAt).toBe('number')
    expect(collected.orders[0]!.plataDepositReturnedAt).toBeUndefined()

    const again = applyPlataToStore(collected, 'a', { count: 1, deposit: '', status: 'collected', note: '' })
    expect(again.orders[0]!.plataCollectedAt).toBe(collectedAt)

    const returned = applyPlataToStore(collected, 'a', { count: 1, deposit: '', status: 'depositReturned', note: '' })
    expect(returned.orders[0]!.plataCollectedAt).toBe(collectedAt)
    expect(typeof returned.orders[0]!.plataDepositReturnedAt).toBe('number')
  })

  it('clears the whole lifecycle when the count goes back to zero', () => {
    const base = storeWith([order({
      id: 'a',
      plataCount: 2,
      plataDeposit: '50.00',
      plataStatus: 'collected',
      plataPickupNote: 'בקבלה',
      plataCollectedAt: 1_760_000_000_000,
      plataDepositReturnedAt: 1_760_000_100_000,
    })])
    const next = applyPlataToStore(base, 'a', { count: 0, deposit: '50', status: 'collected', note: 'בקבלה' })

    expect(next.orders[0]).toEqual(order({ id: 'a' }))
  })

  it('refuses to save against an unsafe id, a missing order, or invalid values', () => {
    const base = storeWith([order({ id: 'a' }), order({ id: 'dup' }), order({ id: 'dup' })])
    expect(() => applyPlataToStore(base, '', emptyForm)).toThrow(RangeError)
    expect(() => applyPlataToStore(base, 'missing', emptyForm)).toThrow(RangeError)
    expect(() => applyPlataToStore(base, 'dup', emptyForm)).toThrow(RangeError)
    expect(() => applyPlataToStore(base, 'a', { ...emptyForm, count: 1, deposit: 'חמישים' })).toThrow(RangeError)
  })
})

describe('summarizeOutstandingPlata', () => {
  it('counts what is out and sums the deposits still held', () => {
    const summary = summarizeOutstandingPlata(storeWith([
      order({ id: 'a', plataCount: 2, plataDeposit: '50.00', plataStatus: 'withCustomer' }),
      order({ id: 'b', plataCount: 1, plataDeposit: '30.00', plataStatus: 'awaitingPickup' }),
      order({ id: 'c', plataCount: 1, plataDeposit: '20.00', plataStatus: 'collected' }),
      order({ id: 'd', plataCount: 3, plataDeposit: '90.00', plataStatus: 'depositReturned' }),
      order({ id: 'e' }),
    ]))

    expect(summary).toEqual({
      withCustomer: 2,
      awaitingPickup: 1,
      collected: 1,
      openDepositMinorUnits: 10_000,
      depositComplete: true,
    })
  })

  it('treats a hotplate with no status as still with the customer', () => {
    const summary = summarizeOutstandingPlata(storeWith([order({ id: 'a', plataCount: 1 })]))
    expect(summary.withCustomer).toBe(1)
  })

  it('flags the sum as incomplete when a stored deposit cannot be read', () => {
    const summary = summarizeOutstandingPlata(storeWith([
      order({ id: 'a', plataCount: 1, plataDeposit: '40.00' }),
      order({ id: 'b', plataCount: 1, plataDeposit: 'חמישים' }),
    ]))

    expect(summary.depositComplete).toBe(false)
    expect(summary.openDepositMinorUnits).toBe(4_000)
  })

  it('reports nothing outstanding for an empty store', () => {
    expect(summarizeOutstandingPlata(storeWith([]))).toEqual({
      withCustomer: 0,
      awaitingPickup: 0,
      collected: 0,
      openDepositMinorUnits: 0,
      depositComplete: true,
    })
  })
})
