import { describe, expect, it } from 'vitest'
import type { LegacyStore } from './store.ts'
import {
  applyNextDeliveryStatus,
  applyPreparationCompletion,
  applyShoppingCompletion,
  isPreparationCompleted,
  isShoppingCompleted,
  nextDeliveryStatus,
  OperationalStateError,
  preparationCompletionKey,
  shoppingCompletionKey,
  shoppingCompletionScope,
} from './operational-state.ts'

function errorCode(action: () => unknown): string | undefined {
  try {
    action()
    return undefined
  } catch (error) {
    return error instanceof OperationalStateError ? error.code : undefined
  }
}

describe('operational state', () => {
  it('advances only the next delivery status and preserves every other field', () => {
    const store = {
      orders: [
        {
          id: 'order-1',
          status: 'מוכנה',
          name: 'לקוחה',
          unknownOrderField: { nested: ['keep'] },
        },
        { id: 'order-2', status: 'אושרה' },
      ],
      unknownStoreField: { untouched: true },
    } satisfies LegacyStore
    const before = structuredClone(store)

    const result = applyNextDeliveryStatus(store, 'order-1')

    expect(result.nextStatus).toBe('במשלוח')
    expect(result.nextStore).toEqual({
      ...store,
      orders: [{ ...store.orders[0], status: 'במשלוח' }, store.orders[1]],
    })
    expect(store).toEqual(before)
    expect(result.nextStore).not.toBe(store)
    expect(result.nextStore.orders[0]).not.toBe(store.orders[0])
  })

  it('supports the complete known sequence but rejects terminal and unknown states', () => {
    expect(nextDeliveryStatus(undefined)).toBe('אושרה')
    expect(nextDeliveryStatus('חדשה')).toBe('אושרה')
    expect(nextDeliveryStatus('אושרה')).toBe('מוכנה')
    expect(nextDeliveryStatus('מוכנה')).toBe('במשלוח')
    expect(nextDeliveryStatus('במשלוח')).toBe('נמסרה')
    expect(nextDeliveryStatus('נמסרה')).toBeNull()
    expect(nextDeliveryStatus('בדרך')).toBeNull()
    expect(
      errorCode(() => applyNextDeliveryStatus({ orders: [{ id: 'x', status: 'בדרך' }] }, 'x')),
    ).toBe('INVALID_DELIVERY_STATUS')
  })

  it('rejects non-canonical, numeric, missing, and duplicate order identities', () => {
    expect(errorCode(() => applyNextDeliveryStatus({ orders: [{ id: ' x ' }] }, 'x'))).toBe(
      'ORDER_ID_NOT_UNIQUE',
    )
    expect(errorCode(() => applyNextDeliveryStatus({ orders: [{ id: 1 }] }, '1'))).toBe(
      'ORDER_ID_NOT_UNIQUE',
    )
    expect(
      errorCode(() => applyNextDeliveryStatus({ orders: [{ id: '1' }, { id: 1 }] }, '1')),
    ).toBe('ORDER_ID_NOT_UNIQUE')
    expect(
      errorCode(() => applyNextDeliveryStatus({ orders: [{ id: 'same' }, { id: 'same' }] }, 'same')),
    ).toBe('ORDER_ID_NOT_UNIQUE')
    expect(errorCode(() => applyNextDeliveryStatus({ orders: [] }, ' bad '))).toBe(
      'INVALID_ORDER_ID',
    )
  })

  it('writes legacy-compatible preparation booleans per date and preserves unknown maps', () => {
    const store = {
      orders: [{ id: 'one' }],
      prepDone: {
        '2099-08-13': { 'mains|old': true },
        '2099-08-14': { 'unknown|keep': { future: true }, 'mains|other': true },
      },
      future: { retained: true },
    } satisfies LegacyStore
    const before = structuredClone(store)
    const key = preparationCompletionKey('mains', 'עיקרית')

    const completed = applyPreparationCompletion(
      store,
      '2099-08-14',
      'mains',
      'עיקרית',
      true,
    )

    expect(key).toBe('mains|עיקרית')
    expect(isPreparationCompleted(completed, '2099-08-14', 'mains', 'עיקרית')).toBe(true)
    expect(completed.prepDone?.['2099-08-13']).toEqual({ 'mains|old': true })
    expect(completed.prepDone?.['2099-08-14']).toEqual({
      'unknown|keep': { future: true },
      'mains|other': true,
      [key]: true,
    })
    const reopened = applyPreparationCompletion(
      completed,
      '2099-08-14',
      'mains',
      'עיקרית',
      false,
    )
    expect(isPreparationCompleted(reopened, '2099-08-14', 'mains', 'עיקרית')).toBe(false)
    expect(reopened.prepDone?.['2099-08-14']).toEqual({
      'unknown|keep': { future: true },
      'mains|other': true,
    })
    expect(store).toEqual(before)
  })

  it('rejects malformed preparation maps and conflicting unknown completion values', () => {
    expect(
      errorCode(() =>
        applyPreparationCompletion(
          { orders: [], prepDone: { '2099-08-14': 'opaque' } },
          '2099-08-14',
          'mains',
          'מנה',
          true,
        ),
      ),
    ).toBe('INVALID_COMPLETION_MAP')
    // Kitchen-board stage strings ('started'/'ready') may be overwritten by
    // the preparation screen's boolean marks — no longer an error.
    expect(
      (applyPreparationCompletion(
        { orders: [], prepDone: { '2099-08-14': { 'mains|מנה': 'started' } } },
        '2099-08-14',
        'mains',
        'מנה',
        true,
      ) as { prepDone?: Record<string, Record<string, unknown>> }).prepDone?.['2099-08-14']?.['mains|מנה'],
    ).toBe(true)
    expect(
      errorCode(() =>
        applyPreparationCompletion(
          { orders: [], prepDone: { '2099-08-14': { 'mains|מנה': 42 } } },
          '2099-08-14',
          'mains',
          'מנה',
          true,
        ),
      ),
    ).toBe('INVALID_COMPLETION_VALUE')
    expect(
      errorCode(() => applyPreparationCompletion({ orders: [] }, '2099-02-30', 'mains', 'מנה', true)),
    ).toBe('INVALID_SERVICE_DATE')
  })

  it('uses stable date/global shopping identities without changing demand data', () => {
    const store = {
      orders: [{ id: 'one', mains: { 'מנה': 2 } }],
      recipes: [{ itemId: 'dish', yield: 1, ingredients: [] }],
      shoppingDone: {
        global: { 'future-key': { preserve: true } },
        '2099-08-13': { '["old","kg"]': true },
      },
    } as unknown as LegacyStore
    const before = structuredClone(store)
    const itemKey = shoppingCompletionKey('real-onion', 'kg')

    const dated = applyShoppingCompletion(store, '2099-08-14', 'real-onion', 'kg', true)
    const global = applyShoppingCompletion(dated, null, 'real-onion', 'kg', true)

    expect(itemKey).toBe('["real-onion","kg"]')
    expect(shoppingCompletionScope(null)).toBe('global')
    expect(shoppingCompletionScope('2099-08-14')).toBe('2099-08-14')
    expect(isShoppingCompleted(global, '2099-08-14', 'real-onion', 'kg')).toBe(true)
    expect(isShoppingCompleted(global, null, 'real-onion', 'kg')).toBe(true)
    expect((global as Record<string, unknown>).shoppingDone).toEqual({
      global: { 'future-key': { preserve: true }, [itemKey]: true },
      '2099-08-13': { '["old","kg"]': true },
      '2099-08-14': { [itemKey]: true },
    })
    expect(global.orders).toEqual(store.orders)
    expect((global as Record<string, unknown>).recipes).toEqual(
      (store as Record<string, unknown>).recipes,
    )
    expect(store).toEqual(before)
  })

  it('rejects malformed shopping identities and preserves opaque values by failing closed', () => {
    expect(errorCode(() => applyShoppingCompletion({ orders: [] }, null, ' id ', 'kg', true))).toBe(
      'INVALID_SHOPPING_ITEM',
    )
    expect(
      errorCode(() =>
        applyShoppingCompletion(
          { orders: [], shoppingDone: { global: { '["id","kg"]': { opaque: true } } } } as unknown as LegacyStore,
          null,
          'id',
          'kg',
          false,
        ),
      ),
    ).toBe('INVALID_COMPLETION_VALUE')
  })
})
