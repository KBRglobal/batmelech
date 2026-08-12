// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../data/use-store.ts'
import type { StoreSaveHandler } from '../domain/settings-catalog.ts'
import type { LegacyStore } from '../domain/store.ts'
import { RecipesScreen } from './recipes-screen.tsx'

vi.mock('../data/use-store.ts', () => ({ useStore: vi.fn() }))
const mockedUseStore = vi.mocked(useStore)
const HASH = 'b'.repeat(64)

function queryResult(options: {
  readonly pending?: boolean
  readonly error?: boolean
  readonly store?: LegacyStore | null
  readonly refetch?: ReturnType<typeof vi.fn>
  readonly revision?: number
} = {}): ReturnType<typeof useStore> {
  const revision = options.revision ?? 1
  return {
    isPending: options.pending === true,
    isError: options.error === true,
    data: options.pending || options.error
      ? undefined
      : { revision, ts: revision, hash: HASH, data: options.store ?? { orders: [] } },
    refetch: options.refetch ?? vi.fn(),
  } as unknown as ReturnType<typeof useStore>
}

afterEach(cleanup)
beforeEach(() => mockedUseStore.mockReset())

describe('RecipesScreen', () => {
  it('renders loading and retryable error states without changing data', async () => {
    mockedUseStore.mockReturnValue(queryResult({ pending: true }))
    const pending = render(<RecipesScreen />)
    expect(screen.getByText('טוענת את המתכונים')).toBeTruthy()
    pending.unmount()

    const refetch = vi.fn()
    mockedUseStore.mockReturnValue(queryResult({ error: true, refetch }))
    render(<RecipesScreen />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'ניסיון נוסף' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('shows every missing recipe honestly without inventing quantities', () => {
    mockedUseStore.mockReturnValue(queryResult())
    render(<RecipesScreen />)

    expect(screen.getByText(/חסרים מתכונים ל־63 מנות/)).toBeTruthy()
    expect(screen.getByText(/רשימת הקניות לא תמציא כמויות/)).toBeTruthy()
    expect(screen.getByText('קוסקוס עננים')).toBeTruthy()
    expect(screen.getByText('בגט טוניסאי אותנטי')).toBeTruthy()
    expect(screen.getByText('מנת מפרום ביתי')).toBeTruthy()
    expect(screen.getByText('מרק ירקות לקוסקוס ללא עוף')).toBeTruthy()
    expect(screen.queryByText('משלוח')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'יצירת מתכון' })).toHaveLength(63)
    expect(screen.queryByLabelText('תפוקת המתכון במנות')).toBeNull()
  })

  it('creates a recipe with a stable hidden identity and preserves exact quantity, unit, and waste strings', async () => {
    const store = { orders: [{ id: 'real-order' }], untouched: { exact: true } } as LegacyStore
    const onSave = vi.fn<StoreSaveHandler>().mockResolvedValue(undefined)
    mockedUseStore.mockReturnValue(queryResult({ store }))
    const user = userEvent.setup()
    render(<RecipesScreen onSave={onSave} />)

    await user.click(screen.getAllByRole('button', { name: 'יצירת מתכון' })[0]!)
    expect(screen.getByText(/עריכת מתכון:/)).toBeTruthy()
    expect((screen.getByLabelText('תפוקת המתכון במנות') as HTMLInputElement).value).toBe('')
    await user.type(screen.getByLabelText('תפוקת המתכון במנות'), '4')
    await user.click(screen.getByRole('button', { name: 'הוספת מצרך' }))
    await user.type(screen.getByLabelText('שם מצרך 1'), 'עגבנייה')
    await user.type(screen.getByLabelText('כמות מצרך 1'), '1.250')
    await user.type(screen.getByLabelText('יחידת מצרך 1'), 'ק״ג')
    await user.type(screen.getByLabelText('פחת מצרך 1'), '10.5')
    const stableIdText = screen.getByText(/^ID: ingredient-/).textContent!

    expect(onSave).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'שמירת כל המתכונים' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    const request = onSave.mock.calls[0]![0]
    expect(request.reason).toBe('recipes')
    expect(request.baseEnvelope).toMatchObject({ revision: 1, hash: HASH, data: store })
    expect(request.baseStore).toBe(store)
    expect(request.nextStore.orders).toEqual([{ id: 'real-order' }])
    expect((request.nextStore as Record<string, unknown>).untouched).toEqual({ exact: true })
    const recipes = (request.nextStore as Record<string, unknown>).recipes as Array<Record<string, unknown>>
    const preparationCatalog = (request.nextStore as Record<string, unknown>).preparationCatalog as Record<string, unknown>
    expect(recipes).toHaveLength(1)
    expect(recipes[0]).toMatchObject({
      yield: 4,
      ingredients: [{
        ingredientId: stableIdText.replace('ID: ', ''),
        ingredientName: 'עגבנייה',
        quantity: '1.250',
        unit: 'ק״ג',
        wastePercent: '10.5',
      }],
    })
    expect(preparationCatalog).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ id: recipes[0]!.itemId, procurement: { kind: 'recipe' } }),
      ]),
    })
    expect((preparationCatalog.items as Array<Record<string, unknown>>).some((item) => item.name === 'משלוח')).toBe(false)
    expect(await screen.findByText('המתכונים נשמרו.')).toBeTruthy()
  })

  it('blocks invalid yields, quantities, units, and waste before calling persistence', async () => {
    const onSave = vi.fn<StoreSaveHandler>().mockResolvedValue(undefined)
    mockedUseStore.mockReturnValue(queryResult())
    const user = userEvent.setup()
    render(<RecipesScreen onSave={onSave} />)

    await user.click(screen.getAllByRole('button', { name: 'יצירת מתכון' })[0]!)
    await user.type(screen.getByLabelText('תפוקת המתכון במנות'), '1.5')
    await user.click(screen.getByRole('button', { name: 'הוספת מצרך' }))
    await user.type(screen.getByLabelText('שם מצרך 1'), 'מצרך')
    await user.type(screen.getByLabelText('כמות מצרך 1'), '0')
    await user.type(screen.getByLabelText('יחידת מצרך 1'), 'גרם')
    await user.type(screen.getByLabelText('פחת מצרך 1'), '101')
    await user.click(screen.getByRole('button', { name: 'שמירת כל המתכונים' }))

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes('יש מתכון לא תקין'))).toBe(true)
  })

  it('retains invalid and duplicate source records and refuses a lossy replacement', async () => {
    const recipe = {
      itemId: 'shabbat-mains-01',
      yield: 2,
      ingredients: [{ ingredientId: 'onion', ingredientName: 'בצל', quantity: '1', unit: 'kg' }],
    }
    const store = {
      orders: [],
      recipes: [recipe, { ...recipe }, { itemId: 'bad', yeild: 2, ingredients: [] }],
    } as LegacyStore
    const onSave = vi.fn<StoreSaveHandler>().mockResolvedValue(undefined)
    mockedUseStore.mockReturnValue(queryResult({ store }))
    render(<RecipesScreen onSave={onSave} />)

    expect(screen.getByText('המתכונים השמורים כוללים התנגשות או מבנה לא תקין')).toBeTruthy()
    expect(screen.getByText(/השמירה חסומה כדי שאף רשומה קיימת לא תלך לאיבוד/)).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('button', { name: 'שמירת כל המתכונים' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes('שום רשומה קיימת לא הוחלפה'))).toBe(true)
  })

  it('retains the edited draft when a versioned save conflicts', async () => {
    const store = {
      orders: [],
      recipes: [{
        itemId: 'shabbat-mains-01',
        name: 'קציצות בשר ברוטב אדום עשיר',
        yield: 2,
        ingredients: [{ ingredientId: 'onion', ingredientName: 'בצל', quantity: '1', unit: 'kg' }],
      }],
    } as LegacyStore
    const onSave = vi.fn<StoreSaveHandler>().mockRejectedValue(new Error('version conflict'))
    mockedUseStore.mockReturnValue(queryResult({ store }))
    const user = userEvent.setup()
    render(<RecipesScreen onSave={onSave} />)

    await user.click(screen.getByRole('button', { name: 'עריכת מתכון' }))
    const quantity = screen.getByLabelText('כמות מצרך 1') as HTMLInputElement
    await user.clear(quantity)
    await user.type(quantity, '2.75')
    await user.click(screen.getByRole('button', { name: 'שמירת כל המתכונים' }))

    await waitFor(() => expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes('הטיוטה נשארה כאן'))).toBe(true))
    expect(quantity.value).toBe('2.75')
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('retains a draft across a newer query revision and performs no stale save callback', async () => {
    const initialStore = {
      orders: [],
      marker: 'initial',
      recipes: [{
        itemId: 'shabbat-mains-01',
        name: 'קציצות בשר ברוטב אדום עשיר',
        yield: 2,
        ingredients: [{ ingredientId: 'onion', ingredientName: 'בצל', quantity: '1', unit: 'kg' }],
      }],
    } as LegacyStore
    const refreshedStore = { ...initialStore, marker: 'refreshed' } as LegacyStore
    const onSave = vi.fn<StoreSaveHandler>().mockResolvedValue(undefined)
    mockedUseStore.mockReturnValue(queryResult({ store: initialStore, revision: 10 }))
    const user = userEvent.setup()
    const view = render(<RecipesScreen onSave={onSave} />)

    await user.click(screen.getByRole('button', { name: 'עריכת מתכון' }))
    const quantity = screen.getByLabelText('כמות מצרך 1') as HTMLInputElement
    await user.clear(quantity)
    await user.type(quantity, '3')
    mockedUseStore.mockReturnValue(queryResult({ store: refreshedStore, revision: 11 }))
    view.rerender(<RecipesScreen onSave={onSave} />)
    expect((screen.getByLabelText('כמות מצרך 1') as HTMLInputElement).value).toBe('3')

    await user.click(screen.getByRole('button', { name: 'שמירת כל המתכונים' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes('הנתונים התעדכנו מאז פתיחת הטיוטה'))).toBe(true)
  })

  it('does not claim persistence when the protected save boundary is absent', async () => {
    const store = {
      orders: [],
      recipes: [{
        itemId: 'shabbat-mains-01',
        yield: 1,
        ingredients: [{ ingredientId: 'onion', ingredientName: 'בצל', quantity: '1', unit: 'kg' }],
      }],
    } as LegacyStore
    mockedUseStore.mockReturnValue(queryResult({ store }))
    render(<RecipesScreen />)

    await userEvent.setup().click(screen.getByRole('button', { name: 'שמירת כל המתכונים' }))

    expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes('לא בוצע שינוי בשרת'))).toBe(true)
    expect(screen.queryByText('המתכונים נשמרו.')).toBeNull()
  })
})
