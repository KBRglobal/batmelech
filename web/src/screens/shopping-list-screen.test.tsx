// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfirmedStoreSaveHandler } from '../data/versioned-screen-save.tsx'
import { useStore } from '../data/use-store.ts'
import type { PreparationCatalog } from '../domain/preparation.ts'
import type { LegacyStore } from '../domain/store.ts'
import type { VersionedStateEnvelope } from '../services/state-api.ts'
import { ShoppingListScreen } from './shopping-list-screen.tsx'

vi.mock('../data/use-store.ts', () => ({ useStore: vi.fn() }))
const mockedUseStore = vi.mocked(useStore)
const HASH = 'c'.repeat(64)

function queryResult(options: {
  readonly pending?: boolean
  readonly error?: boolean
  readonly store?: LegacyStore | null
  readonly refetch?: ReturnType<typeof vi.fn>
  readonly revision?: number
} = {}): ReturnType<typeof useStore> {
  return {
    isPending: options.pending === true,
    isError: options.error === true,
    data: options.pending || options.error ? undefined : {
      revision: options.revision ?? 1,
      ts: options.revision ?? 1,
      hash: HASH,
      data: options.store ?? { orders: [] },
    },
    refetch: options.refetch ?? vi.fn(),
  } as unknown as ReturnType<typeof useStore>
}

function renderShopping(path = '/shopping-list', onSave?: ConfirmedStoreSaveHandler) {
  return render(<MemoryRouter initialEntries={[path]}><ShoppingListScreen onSave={onSave} /></MemoryRouter>)
}

function confirmedEnvelope(data: LegacyStore, revision = 2): VersionedStateEnvelope {
  return { revision, ts: revision, hash: HASH, data }
}

function successfulSave() {
  let revision = 1
  return vi.fn<ConfirmedStoreSaveHandler>().mockImplementation(async ({ nextStore }) => {
    revision += 1
    return confirmedEnvelope(nextStore, revision)
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
beforeEach(() => mockedUseStore.mockReset())

describe('ShoppingListScreen', () => {
  it('renders loading, retryable error, and empty states without calculating fake ingredients', async () => {
    mockedUseStore.mockReturnValue(queryResult({ pending: true }))
    const pending = renderShopping()
    expect(screen.getByText('טוענת את רשימת הקניות')).toBeTruthy()
    pending.unmount()

    const refetch = vi.fn()
    mockedUseStore.mockReturnValue(queryResult({ error: true, refetch }))
    const failed = renderShopping()
    await userEvent.setup().click(screen.getByRole('button', { name: 'ניסיון נוסף' }))
    expect(refetch).toHaveBeenCalledTimes(1)
    failed.unmount()

    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [] } }))
    renderShopping()
    expect(screen.getByText('אין עדיין מה לקנות')).toBeTruthy()
    expect(screen.queryByText('עגבניות שרי')).toBeNull()
  })

  it('calculates only persisted recipes and filters demand by the selected date', async () => {
    const catalog: PreparationCatalog = {
      items: [
        { id: 'real-main', category: 'mains', name: 'מנה אמיתית', procurement: { kind: 'recipe' } },
        { id: 'other-main', category: 'mains', name: 'מנה ביום אחר', procurement: { kind: 'recipe' } },
      ],
      lunchItems: [],
    }
    const store = {
      orders: [
        { id: 'one', date: '2099-08-14', meals: 2, mains: { 'מנה אמיתית': 3 } },
        { id: 'two', date: '2099-08-15', meals: 1, mains: { 'מנה ביום אחר': 1 } },
      ],
      preparationCatalog: catalog,
      recipes: [
        {
          itemId: 'real-main',
          name: 'מנה אמיתית',
          yield: 1,
          ingredients: [{ ingredientId: 'real-onion', ingredientName: 'בצל אמיתי', quantity: '0.2', unit: 'kg' }],
        },
        {
          itemId: 'other-main',
          name: 'מנה ביום אחר',
          yield: 1,
          ingredients: [{ ingredientId: 'other', ingredientName: 'מצרך אחר', quantity: '1', unit: 'kg' }],
        },
      ],
    } as LegacyStore
    mockedUseStore.mockReturnValue(queryResult({ store }))
    renderShopping('/shopping-list?date=2099-08-14')

    expect(screen.getByText('בצל אמיתי')).toBeTruthy()
    expect(screen.getByText('0.6 kg')).toBeTruthy()
    expect(screen.getByText(/מנה אמיתית ×3 · 0.6 kg/)).toBeTruthy()
    expect(screen.queryByText('מצרך אחר')).toBeNull()
    expect(screen.queryByText('עגבניות שרי')).toBeNull()
    expect(screen.getByRole('button', { name: 'סימון נקנה לא זמין' }).hasAttribute('disabled')).toBe(true)

    await userEvent.setup().selectOptions(screen.getByLabelText('תאריך רשימת קניות'), '2099-08-15')
    expect(screen.getByText('מצרך אחר')).toBeTruthy()
    expect(screen.queryByText('בצל אמיתי')).toBeNull()
  })

  it('uses the effective menu catalog when none was persisted and performs no read-time write', () => {
    const onSave = successfulSave()
    mockedUseStore.mockReturnValue(queryResult({
      store: {
        orders: [{ id: 'menu-demand', date: '2099-08-14', sides: { 'אורז מהתפריט': 3 } }],
        menu: {
          sides: ['אורז מהתפריט'],
          itemIds: { sides: { 'אורז מהתפריט': 'menu-side-rice' } },
        },
        recipes: [{
          itemId: 'menu-side-rice',
          yield: 1,
          ingredients: [{
            ingredientId: 'default-rice',
            ingredientName: 'אורז לקנייה',
            quantity: '0.25',
            unit: 'kg',
          }],
        }],
      } as LegacyStore,
    }))
    renderShopping('/shopping-list?date=2099-08-14', onSave)

    expect(screen.getByText('אורז לקנייה')).toBeTruthy()
    expect(screen.getByText('0.75 kg')).toBeTruthy()
    expect(screen.queryByText(/לא נשמר קטלוג הכנה/)).toBeNull()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('completes an empty persisted catalog from the effective default menu', () => {
    mockedUseStore.mockReturnValue(queryResult({
      store: {
        orders: [{ id: 'empty-catalog-demand', date: '2099-08-14', sides: { 'אורז לבן': 2 } }],
        preparationCatalog: { items: [], lunchItems: [] },
        recipes: [{
          itemId: 'shabbat-sides-01',
          yield: 1,
          ingredients: [{
            ingredientId: 'empty-catalog-rice',
            ingredientName: 'אורז מהקטלוג המשלים',
            quantity: '0.5',
            unit: 'kg',
          }],
        }],
      } as LegacyStore,
    }))
    renderShopping('/shopping-list?date=2099-08-14')

    expect(screen.getByText('אורז מהקטלוג המשלים')).toBeTruthy()
    expect(screen.getByText('1 kg')).toBeTruthy()
    expect(screen.queryByText('קטלוג ההכנה השמור אינו תקין')).toBeNull()
  })

  it('preserves a valid procurement rule from a partial persisted catalog', () => {
    mockedUseStore.mockReturnValue(queryResult({
      store: {
        orders: [{ id: 'partial-catalog-demand', date: '2099-08-14', sides: { 'אורז לבן': 2 } }],
        preparationCatalog: {
          items: [{
            id: 'shabbat-sides-01',
            category: 'sides',
            name: 'אורז לבן',
            procurement: {
              kind: 'direct',
              ingredientId: 'partial-rice',
              ingredientName: 'שקית אורז',
              quantityPerItem: '1.5',
              unit: 'שקיות',
            },
          }],
        },
      } as LegacyStore,
    }))
    renderShopping('/shopping-list?date=2099-08-14')

    expect(screen.getByText('שקית אורז')).toBeTruthy()
    expect(screen.getByText('3 שקיות')).toBeTruthy()
    expect(screen.queryByText('קטלוג ההכנה השמור אינו תקין')).toBeNull()
  })

  it('keeps ingredient and customer text local during advisory AI review', async () => {
    const privateValues = [
      'PRIVATE SHOPPER',
      '+971511111111',
      'PRIVATE ORDER NOTE',
      'PRIVATE MENU ITEM',
      'PRIVATE INGREDIENT',
      'PRIVATE UNIT',
    ]
    const catalog: PreparationCatalog = {
      items: [{
        id: 'private-menu-id',
        category: 'mains',
        name: privateValues[3]!,
        procurement: { kind: 'recipe' },
      }],
      lunchItems: [],
    }
    const store = {
      orders: [{
        id: 'private-order-id',
        date: '2099-08-14',
        name: privateValues[0],
        phone: privateValues[1],
        notes: privateValues[2],
        mains: { [privateValues[3]!]: 2 },
      }],
      preparationCatalog: catalog,
      recipes: [{
        itemId: 'private-menu-id',
        yield: 1,
        ingredients: [{
          ingredientId: 'private-ingredient-id',
          ingredientName: privateValues[4],
          quantity: '0.5',
          unit: privateValues[5],
        }],
      }],
    } as LegacyStore
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      review: {
        reviewOnly: true,
        overview: 'הבדיקה הייעוצית הסתיימה על נתונים מצטברים בלבד.',
        findings: [],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const onSave = successfulSave()
    mockedUseStore.mockReturnValue(queryResult({ store }))
    renderShopping('/shopping-list?date=2099-08-14', onSave)

    await userEvent.setup().click(screen.getByRole('button', { name: 'קבלת ייעוץ' }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const bodyText = String((fetchMock.mock.calls[0]![1] as RequestInit).body)
    const body = JSON.parse(bodyText)
    expect(body.snapshot.scope).toBe('shopping')
    expect(body.snapshot.selectedServiceDate).toBe('2099-08-14')
    expect(body.snapshot.demands).toEqual([
      {
        id: 'demand-1',
        source: 'preparation',
        serviceDate: '2099-08-14',
        category: 'mains',
        quantity: '2',
        procurementKind: 'recipe',
        comparisonGroup: 'group-1',
      },
      {
        id: 'demand-2',
        source: 'shopping',
        serviceDate: '2099-08-14',
        category: 'ingredient',
        quantity: '1',
        procurementKind: 'computed',
        comparisonGroup: 'group-2',
      },
    ])
    for (const privateValue of privateValues) expect(bodyText).not.toContain(privateValue)
    expect(bodyText).not.toContain('private-order-id')
    expect(bodyText).not.toContain('private-menu-id')
    expect(bodyText).not.toContain('private-ingredient-id')
    expect(onSave).not.toHaveBeenCalled()
    expect(await screen.findByText(/הבדיקה הייעוצית הסתיימה/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /החל|שמור|בצע/ })).toBeNull()
  })

  it('shows exact missing configuration and recipe warnings without inventing quantities', () => {
    const catalog: PreparationCatalog = {
      items: [{ id: 'missing-recipe', category: 'mains', name: 'מנה ללא מתכון', procurement: { kind: 'recipe' } }],
      lunchItems: [],
    }
    mockedUseStore.mockReturnValue(queryResult({
      store: {
        orders: [{ id: 'one', date: '2099-08-14', mains: { 'מנה ללא מתכון': 2 } }],
        preparationCatalog: catalog,
      } as LegacyStore,
    }))
    renderShopping()

    expect(screen.getByText('לא נשמרו מתכונים, ולכן לא הומצאו מצרכים או כמויות חסרות.')).toBeTruthy()
    expect(screen.getByText('למנה מנה ללא מתכון אין מתכון שמור, ולכן המצרכים שלה לא חושבו.')).toBeTruthy()
    expect(screen.getByText('אין עדיין מתכונים מוגדרים לתפריט')).toBeTruthy()
    expect(screen.getByText('רשימת הקניות תתמלא אוטומטית לאחר הזנת מתכונים למנות.')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'מצרכים לקנייה' })).toBeNull()
  })

  it('honors an explicit direct-purchase rule even when no recipes are stored', () => {
    const catalog: PreparationCatalog = {
      items: [{
        id: 'wine',
        category: 'extras',
        name: 'בקבוק שמור',
        procurement: {
          kind: 'direct', ingredientId: 'bottle', ingredientName: 'בקבוק יין', unit: 'יחידות', quantityPerItem: '2.5',
        },
      }],
      lunchItems: [],
    }
    mockedUseStore.mockReturnValue(queryResult({
      store: {
        orders: [{ id: 'one', date: '2099-08-14', extras: { 'בקבוק שמור': { q: 2 } } }],
        preparationCatalog: catalog,
      } as LegacyStore,
    }))
    renderShopping()

    expect(screen.getByText('בקבוק יין')).toBeTruthy()
    expect(screen.getByText('5 יחידות')).toBeTruthy()
  })

  it('flags malformed persisted catalog data while calculating from its safe authoritative projection', () => {
    mockedUseStore.mockReturnValue(queryResult({
      store: {
        orders: [{ id: 'one', date: '2099-08-14', sides: { 'אורז לבן': 2 } }],
        preparationCatalog: { items: 'not-an-array', lunchItems: [] },
        recipes: [{
          itemId: 'shabbat-sides-01',
          yield: 1,
          ingredients: [{
            ingredientId: 'safe-rice',
            ingredientName: 'אורז בטוח',
            quantity: '0.5',
            unit: 'kg',
          }],
        }],
      } as unknown as LegacyStore,
    }))
    renderShopping()

    expect(screen.getByText(/קטלוג ההכנה השמור אינו תקין/)).toBeTruthy()
    expect(screen.getByText('אורז בטוח')).toBeTruthy()
    expect(screen.getByText('1 kg')).toBeTruthy()
  })

  it('rejects a malformed persisted recipe collection instead of inventing quantities', () => {
    mockedUseStore.mockReturnValue(queryResult({
      store: {
        orders: [{ id: 'one', date: '2099-08-14', sides: { 'אורז לבן': 1 } }],
        recipes: { itemId: 'not-an-array' },
      } as unknown as LegacyStore,
    }))
    renderShopping()

    expect(screen.getByText('הגדרת המתכונים השמורה אינה מערך תקין, ולכן לא נעשה בה שימוש.')).toBeTruthy()
    expect(screen.queryByText('1 kg')).toBeNull()
  })

  it('persists and reloads a checked dated row without changing its calculated quantity', async () => {
    const catalog: PreparationCatalog = {
      items: [{ id: 'real-main', category: 'mains', name: 'מנה אמיתית', procurement: { kind: 'recipe' } }],
      lunchItems: [],
    }
    const store = {
      orders: [{ id: 'one', date: '2099-08-14', mains: { 'מנה אמיתית': 3 } }],
      preparationCatalog: catalog,
      recipes: [{
        itemId: 'real-main',
        name: 'מנה אמיתית',
        yield: 1,
        ingredients: [{ ingredientId: 'real-onion', ingredientName: 'בצל אמיתי', quantity: '0.2', unit: 'kg' }],
      }],
      shoppingDone: {
        global: { 'future-key': { keep: true } },
        '2099-08-13': { '["old","kg"]': true },
      },
      unknownStoreField: { retained: true },
    } as unknown as LegacyStore
    const onSave = successfulSave()
    mockedUseStore.mockReturnValue(queryResult({ store }))
    const user = userEvent.setup()
    const first = renderShopping('/shopping-list?date=2099-08-14', onSave)

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('0.6 kg')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'סימון בצל אמיתי כנקנה' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    const request = onSave.mock.calls[0]![0]
    expect(request.reason).toBe('shopping')
    expect(request.baseStore).toBe(store)
    expect((request.nextStore as Record<string, unknown>).shoppingDone).toEqual({
      global: { 'future-key': { keep: true } },
      '2099-08-13': { '["old","kg"]': true },
      '2099-08-14': { '["real-onion","kg"]': true },
    })
    expect(request.nextStore.orders).toEqual(store.orders)
    expect((request.nextStore as Record<string, unknown>).recipes).toEqual(
      (store as Record<string, unknown>).recipes,
    )
    expect((request.nextStore as Record<string, unknown>).unknownStoreField).toEqual({ retained: true })
    expect(screen.getByText('0.6 kg')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'פתיחת קניית בצל אמיתי' })).toBeTruthy()
    expect(screen.getByText('המצרך סומן כנקנה.')).toBeTruthy()

    first.unmount()
    onSave.mockClear()
    mockedUseStore.mockReturnValue(queryResult({ store: request.nextStore, revision: 2 }))
    renderShopping('/shopping-list?date=2099-08-14', onSave)
    expect(screen.getByRole('button', { name: 'פתיחת קניית בצל אמיתי' })).toBeTruthy()
  })

  it('uses the explicit global scope when all dates are selected', async () => {
    const catalog: PreparationCatalog = {
      items: [{
        id: 'wine',
        category: 'extras',
        name: 'בקבוק שמור',
        procurement: {
          kind: 'direct', ingredientId: 'bottle', ingredientName: 'בקבוק יין', unit: 'יחידות', quantityPerItem: '1',
        },
      }],
      lunchItems: [],
    }
    const store = {
      orders: [{ id: 'one', date: '2099-08-14', extras: { 'בקבוק שמור': { q: 2 } } }],
      preparationCatalog: catalog,
    } as LegacyStore
    const onSave = successfulSave()
    mockedUseStore.mockReturnValue(queryResult({ store }))
    renderShopping('/shopping-list', onSave)

    await userEvent.setup().click(screen.getByRole('button', { name: 'סימון בקבוק יין כנקנה' }))

    expect((onSave.mock.calls[0]![0].nextStore as Record<string, unknown>).shoppingDone).toEqual({
      global: { '["bottle","יחידות"]': true },
    })
  })

  it('retains a failed shopping write and reports the conflict', async () => {
    const catalog: PreparationCatalog = {
      items: [{
        id: 'wine',
        category: 'extras',
        name: 'בקבוק שמור',
        procurement: {
          kind: 'direct', ingredientId: 'bottle', ingredientName: 'בקבוק יין', unit: 'יחידות', quantityPerItem: '1',
        },
      }],
      lunchItems: [],
    }
    const onSave = vi.fn<ConfirmedStoreSaveHandler>().mockRejectedValue(new Error('conflict'))
    mockedUseStore.mockReturnValue(queryResult({
      store: {
        orders: [{ id: 'one', date: '2099-08-14', extras: { 'בקבוק שמור': { q: 1 } } }],
        preparationCatalog: catalog,
      } as LegacyStore,
    }))
    renderShopping('/shopping-list?date=2099-08-14', onSave)

    await userEvent.setup().click(screen.getByRole('button', { name: 'סימון בקבוק יין כנקנה' }))

    expect(screen.getByText(/השמירה נכשלה או התנגשה/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'סימון בקבוק יין כנקנה' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('adopts merged server shopping demand and allows a second guarded completion write', async () => {
    const catalog: PreparationCatalog = {
      items: [{
        id: 'wine',
        category: 'extras',
        name: 'בקבוק שמור',
        procurement: {
          kind: 'direct', ingredientId: 'bottle', ingredientName: 'בקבוק יין', unit: 'יחידות', quantityPerItem: '1',
        },
      }],
      lunchItems: [],
    }
    const store = {
      orders: [{ id: 'shopping-merge', date: '2099-08-14', extras: { 'בקבוק שמור': { q: 1 } } }],
      preparationCatalog: catalog,
    } as LegacyStore
    let mergedStore: LegacyStore | null = null
    const onSave = vi.fn<ConfirmedStoreSaveHandler>()
      .mockImplementationOnce(async ({ nextStore }) => {
        mergedStore = {
          ...nextStore,
          remoteOnly: { keep: true },
          orders: [
            ...nextStore.orders,
            { id: 'shopping-remote', date: '2099-08-14', extras: { 'בקבוק שמור': { q: 2 } } },
          ],
        }
        return confirmedEnvelope(mergedStore, 2)
      })
      .mockImplementationOnce(async ({ nextStore }) => confirmedEnvelope(nextStore, 3))
    mockedUseStore.mockReturnValue(queryResult({ store, revision: 1 }))
    const view = renderShopping('/shopping-list?date=2099-08-14', onSave)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'סימון בקבוק יין כנקנה' }))

    expect(screen.getByText('3 יחידות')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'פתיחת קניית בקבוק יין' }).hasAttribute('disabled')).toBe(true)

    mockedUseStore.mockReturnValue(queryResult({ store: mergedStore!, revision: 2 }))
    view.rerender(
      <MemoryRouter initialEntries={['/shopping-list?date=2099-08-14']}>
        <ShoppingListScreen onSave={onSave} />
      </MemoryRouter>,
    )

    const reopenButton = screen.getByRole('button', { name: 'פתיחת קניית בקבוק יין' })
    expect(reopenButton.hasAttribute('disabled')).toBe(false)
    await user.click(reopenButton)

    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onSave.mock.calls[1]![0].baseStore).toEqual(mergedStore)
    expect(onSave.mock.calls[1]![0].nextStore.orders).toHaveLength(2)
    expect((onSave.mock.calls[1]![0].nextStore as Record<string, unknown>).remoteOnly).toEqual({ keep: true })
    expect((onSave.mock.calls[1]![0].nextStore as Record<string, unknown>).shoppingDone).toEqual({
      '2099-08-14': {},
    })
  })

  it('blocks a checked-row write when the loaded envelope drifts in the background', async () => {
    const catalog: PreparationCatalog = {
      items: [{
        id: 'wine',
        category: 'extras',
        name: 'בקבוק שמור',
        procurement: {
          kind: 'direct', ingredientId: 'bottle', ingredientName: 'בקבוק יין', unit: 'יחידות', quantityPerItem: '1',
        },
      }],
      lunchItems: [],
    }
    const store = {
      orders: [{ id: 'one', date: '2099-08-14', extras: { 'בקבוק שמור': { q: 1 } } }],
      preparationCatalog: catalog,
    } as LegacyStore
    const onSave = successfulSave()
    mockedUseStore.mockReturnValue(queryResult({ store, revision: 1 }))
    const view = renderShopping('/shopping-list?date=2099-08-14', onSave)
    mockedUseStore.mockReturnValue(queryResult({
      store: { ...store, remoteUnknown: true },
      revision: 2,
    }))
    view.rerender(
      <MemoryRouter initialEntries={['/shopping-list?date=2099-08-14']}>
        <ShoppingListScreen onSave={onSave} />
      </MemoryRouter>,
    )

    await userEvent.setup().click(screen.getByRole('button', { name: 'סימון בקבוק יין כנקנה' }))

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText(/הנתונים השתנו/)).toBeTruthy()
  })
})
