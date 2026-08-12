// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../data/use-store.ts'
import type { PreparationCatalog } from '../domain/preparation.ts'
import type { LegacyStore } from '../domain/store.ts'
import { ShoppingListScreen } from './shopping-list-screen.tsx'

vi.mock('../data/use-store.ts', () => ({ useStore: vi.fn() }))
const mockedUseStore = vi.mocked(useStore)

function queryResult(options: {
  readonly pending?: boolean
  readonly error?: boolean
  readonly store?: LegacyStore | null
  readonly refetch?: ReturnType<typeof vi.fn>
} = {}): ReturnType<typeof useStore> {
  return {
    isPending: options.pending === true,
    isError: options.error === true,
    data: options.pending || options.error ? undefined : { ts: 1, data: options.store ?? { orders: [] } },
    refetch: options.refetch ?? vi.fn(),
  } as unknown as ReturnType<typeof useStore>
}

function renderShopping(path = '/shopping-list') {
  return render(<MemoryRouter initialEntries={[path]}><ShoppingListScreen /></MemoryRouter>)
}

afterEach(cleanup)
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
    expect(screen.getByText('לא חושבו מצרכים בבטחה')).toBeTruthy()
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

  it('rejects malformed persisted configuration instead of coercing it', () => {
    mockedUseStore.mockReturnValue(queryResult({
      store: {
        orders: [{ id: 'one', date: '2099-08-14', mains: { 'מנה': 1 } }],
        preparationCatalog: { items: 'not-an-array' },
        recipes: { itemId: 'not-an-array' },
      } as unknown as LegacyStore,
    }))
    renderShopping()

    expect(screen.getByText('קטלוג ההכנה השמור אינו תקין, ולכן לא נעשה בו שימוש.')).toBeTruthy()
    expect(screen.getByText('הגדרת המתכונים השמורה אינה מערך תקין, ולכן לא נעשה בה שימוש.')).toBeTruthy()
    expect(screen.queryByText('1 kg')).toBeNull()
  })
})
