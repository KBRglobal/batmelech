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

// Autosave stays out of the way unless a test opts in with a short delay.
const NO_AUTOSAVE = 600_000

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

function currentIngredientId(): string {
  const row = document.querySelector('[data-ingredient-id]')
  expect(row).not.toBeNull()
  return row!.getAttribute('data-ingredient-id')!
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

  it('shows honest completion progress, groups size variants, and never invents quantities', () => {
    mockedUseStore.mockReturnValue(queryResult())
    render(<RecipesScreen />)

    expect(screen.getByText('יש מתכון ל־0 מתוך 63 מנות')).toBeTruthy()
    expect(screen.getByText(/מנה בלי מתכון לא נכנסת לרשימת הקניות/)).toBeTruthy()
    expect(screen.getByText('קוסקוס עננים')).toBeTruthy()
    expect(screen.getByText('בגט טוניסאי אותנטי')).toBeTruthy()
    expect(screen.getByText('מנת מפרום ביתי')).toBeTruthy()
    expect(screen.getByText('מרק ירקות לקוסקוס ללא עוף')).toBeTruthy()
    expect(screen.queryByText('משלוח')).toBeNull()
    expect(screen.getAllByRole('button', { name: /^יצירת מתכון/ })).toHaveLength(63)
    expect(screen.queryByLabelText('כמה מנות במוצר אחד?')).toBeNull()
    // The same dish sold in two sizes sits together under one group header.
    expect(screen.getByText('כמה גדלים של פסטה אדומה:')).toBeTruthy()
    // Source metadata: menu category chips next to dishes.
    expect(screen.getAllByText('סלטים').length).toBeGreaterThan(0)
    expect(screen.getAllByText('אקסטרות').length).toBeGreaterThan(0)
  })

  it('creates a recipe with a stable hidden identity and preserves exact quantity, unit, and waste strings', async () => {
    const store = { orders: [{ id: 'real-order' }], untouched: { exact: true } } as LegacyStore
    const onSave = vi.fn<StoreSaveHandler>().mockResolvedValue(undefined)
    mockedUseStore.mockReturnValue(queryResult({ store }))
    const user = userEvent.setup()
    render(<RecipesScreen onSave={onSave} autosaveDelayMs={NO_AUTOSAVE} />)

    await user.click(screen.getByRole('button', { name: 'יצירת מתכון — קוסקוס עננים' }))
    expect(screen.getByText('המתכון של קוסקוס עננים')).toBeTruthy()
    expect(screen.getByText(/רושמים כל מצרך משמעותי/)).toBeTruthy()
    expect(screen.getByText('עוד אין מתכון — מוסיפים מצרך ראשון')).toBeTruthy()

    // Yield starts at one whole product and steps up without typing.
    expect((screen.getByLabelText('כמה מנות במוצר אחד?') as HTMLInputElement).value).toBe('1')
    await user.click(screen.getByRole('button', { name: 'עוד מנה' }))
    await user.click(screen.getByRole('button', { name: 'עוד מנה' }))
    await user.click(screen.getByRole('button', { name: 'עוד מנה' }))
    expect((screen.getByLabelText('כמה מנות במוצר אחד?') as HTMLInputElement).value).toBe('4')
    expect(screen.getByText('הכמויות במתכון הן למוצר שלם אחד — 4 מנות.')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'הוספת מצרך' }))
    await user.type(screen.getByLabelText('שם מצרך 1'), 'עגבנייה')
    await user.type(screen.getByLabelText('כמות מצרך 1'), '1.250')
    await user.click(screen.getByRole('button', { name: 'ק״ג למצרך 1' }))
    await user.click(screen.getByRole('button', { name: 'פחת למצרך 1' }))
    await user.type(screen.getByLabelText('פחת מצרך 1'), '10.5')
    const stableId = currentIngredientId()

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
        ingredientId: stableId,
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

  it('suggests the whole-batch yield from the dish name for empty recipes only', async () => {
    mockedUseStore.mockReturnValue(queryResult())
    const user = userEvent.setup()
    render(<RecipesScreen autosaveDelayMs={NO_AUTOSAVE} />)

    await user.click(screen.getByRole('button', { name: 'יצירת מתכון — סיר קובה סלק בתוספת אורז (ל־4 אנשים)' }))
    expect((screen.getByLabelText('כמה מנות במוצר אחד?') as HTMLInputElement).value).toBe('4')
    expect(screen.getByText(/נמכרת כיחידה של 4/)).toBeTruthy()
    expect(screen.getByText('הכמויות במתכון הן למוצר שלם אחד — 4 מנות.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'סגירה' }))

    await user.click(screen.getByRole('button', { name: 'יצירת מתכון — מפרום ביתי של אמא (זוגי)' }))
    expect((screen.getByLabelText('כמה מנות במוצר אחד?') as HTMLInputElement).value).toBe('2')
    expect(screen.getByText(/נמכרת כזוג/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'סגירה' }))

    await user.click(screen.getByRole('button', { name: 'יצירת מתכון — מגש תפו"א' }))
    expect((screen.getByLabelText('כמה מנות במוצר אחד?') as HTMLInputElement).value).toBe('1')
    expect(screen.getByText(/למגש כולו/)).toBeTruthy()
  })

  it('explains invalid yields, quantities, units, and waste in plain words and never persists them', async () => {
    const onSave = vi.fn<StoreSaveHandler>().mockResolvedValue(undefined)
    mockedUseStore.mockReturnValue(queryResult())
    const user = userEvent.setup()
    render(<RecipesScreen onSave={onSave} autosaveDelayMs={NO_AUTOSAVE} />)

    await user.click(screen.getAllByRole('button', { name: /^יצירת מתכון/ })[0]!)
    const yieldInput = screen.getByLabelText('כמה מנות במוצר אחד?')
    await user.clear(yieldInput)
    await user.type(yieldInput, '1.5')
    expect(screen.getByText('צריך מספר שלם של מנות — למשל 4')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'הוספת מצרך' }))
    await user.type(screen.getByLabelText('שם מצרך 1'), 'מצרך')
    await user.type(screen.getByLabelText('כמות מצרך 1'), '0')
    expect(screen.getByText('כמות צריכה להיות מספר גדול מאפס — למשל 2 או 0.5')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'גרם למצרך 1' }))
    await user.click(screen.getByRole('button', { name: 'פחת למצרך 1' }))
    await user.type(screen.getByLabelText('פחת מצרך 1'), '101')
    expect(screen.getByText('פחת הוא אחוז בין 0 ל־100')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'שמירת כל המתכונים' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes('עוד אי אפשר לשמור'))).toBe(true)
  })

  it('keeps an untouched recipe byte-identical while a different dish is edited and saved', async () => {
    const untouchedRecipe = {
      itemId: 'other-dish',
      name: 'מנה אחרת',
      yield: 7,
      ingredients: [{
        ingredientId: 'legacy-ingredient',
        ingredientName: 'בצל',
        quantity: '0.50',
        unit: 'kg',
        wastePercent: '12.5',
      }],
    }
    const store = {
      orders: [],
      recipes: [
        {
          itemId: 'shabbat-mains-01',
          yield: 2,
          ingredients: [{ ingredientId: 'onion', ingredientName: 'בצל', quantity: '1', unit: 'kg' }],
        },
        untouchedRecipe,
      ],
    } as LegacyStore
    const onSave = vi.fn<StoreSaveHandler>().mockResolvedValue(undefined)
    mockedUseStore.mockReturnValue(queryResult({ store }))
    const user = userEvent.setup()
    render(<RecipesScreen onSave={onSave} autosaveDelayMs={NO_AUTOSAVE} />)

    // Tapping the dish row itself opens the editor — no extra chrome.
    await user.click(screen.getByText('קציצות בשר ברוטב אדום עשיר'))
    // A legacy free-text unit renders as-is, without conversion or rewriting.
    expect((screen.getByLabelText('יחידת מצרך 1') as HTMLInputElement).value).toBe('kg')
    const quantity = screen.getByLabelText('כמות מצרך 1') as HTMLInputElement
    await user.clear(quantity)
    await user.type(quantity, '2.75')
    await user.click(screen.getByRole('button', { name: 'שמירת כל המתכונים' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    const recipes = (onSave.mock.calls[0]![0].nextStore as Record<string, unknown>).recipes as Array<Record<string, unknown>>
    expect(recipes).toHaveLength(2)
    const edited = recipes.find((recipe) => recipe.itemId === 'shabbat-mains-01')!
    expect(edited.ingredients).toMatchObject([{ quantity: '2.75', unit: 'kg' }])
    const survivor = recipes.find((recipe) => recipe.itemId === 'other-dish')
    expect(JSON.stringify(survivor)).toBe(JSON.stringify(untouchedRecipe))
  })

  it('warns when an ingredient is typed with a different unit than other recipes use, and autocompletes the known unit', async () => {
    const store = {
      orders: [],
      recipes: [{
        itemId: 'shabbat-mains-01',
        yield: 2,
        ingredients: [{ ingredientId: 'onion', ingredientName: 'בצל', quantity: '1', unit: 'ק״ג' }],
      }],
    } as LegacyStore
    mockedUseStore.mockReturnValue(queryResult({ store }))
    const user = userEvent.setup()
    render(<RecipesScreen autosaveDelayMs={NO_AUTOSAVE} />)

    await user.click(screen.getByRole('button', { name: 'יצירת מתכון — קוסקוס עננים' }))
    await user.click(screen.getByRole('button', { name: 'הוספת מצרך' }))
    await user.type(screen.getByLabelText('שם מצרך 1'), 'בצל')
    // The known unit is filled in automatically once the name matches.
    expect(screen.getByRole('button', { name: 'ק״ג למצרך 1', pressed: true })).toBeTruthy()
    expect(screen.queryByText(/כבר רשום ב/)).toBeNull()

    await user.click(screen.getByRole('button', { name: 'גרם למצרך 1' }))
    expect(screen.getByText(/המצרך הזה כבר רשום בק״ג במתכונים אחרים/)).toBeTruthy()
  })

  it('duplicates a sibling recipe into an empty one with fresh stable ingredient identities', async () => {
    const store = {
      orders: [],
      recipes: [{
        itemId: 'shabbat-mains-01',
        yield: 2,
        ingredients: [{ ingredientId: 'onion', ingredientName: 'בצל', quantity: '1', unit: 'kg', wastePercent: '10' }],
      }],
    } as LegacyStore
    mockedUseStore.mockReturnValue(queryResult({ store }))
    const user = userEvent.setup()
    render(<RecipesScreen autosaveDelayMs={NO_AUTOSAVE} />)

    await user.click(screen.getByRole('button', { name: 'יצירת מתכון — קוסקוס עננים' }))
    await user.selectOptions(screen.getByLabelText('שכפול מתכון מ...'), 'shabbat-mains-01')

    expect((screen.getByLabelText('שם מצרך 1') as HTMLInputElement).value).toBe('בצל')
    expect((screen.getByLabelText('כמות מצרך 1') as HTMLInputElement).value).toBe('1')
    expect((screen.getByLabelText('כמה מנות במוצר אחד?') as HTMLInputElement).value).toBe('2')
    const copiedId = currentIngredientId()
    expect(copiedId).not.toBe('onion')
    expect(copiedId.startsWith('ingredient-')).toBe(true)
  })

  it('filters to dishes without a recipe and back', async () => {
    const store = {
      orders: [],
      recipes: [{
        itemId: 'shabbat-mains-01',
        yield: 2,
        ingredients: [{ ingredientId: 'onion', ingredientName: 'בצל', quantity: '1', unit: 'kg' }],
      }],
    } as LegacyStore
    mockedUseStore.mockReturnValue(queryResult({ store }))
    const user = userEvent.setup()
    render(<RecipesScreen autosaveDelayMs={NO_AUTOSAVE} />)

    expect(screen.getByText('יש מתכון ל־1 מתוך 63 מנות')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'עריכת מתכון' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'רק בלי מתכון' }))
    expect(screen.queryByRole('button', { name: 'עריכת מתכון' })).toBeNull()
    expect(screen.getAllByRole('button', { name: /^יצירת מתכון/ }).length).toBe(62)

    await user.click(screen.getByRole('button', { name: 'רק בלי מתכון' }))
    expect(screen.getByRole('button', { name: 'עריכת מתכון' })).toBeTruthy()
  })

  it('autosaves a valid edit after the debounce and never autosaves an invalid row', async () => {
    const store = {
      orders: [],
      recipes: [{
        itemId: 'shabbat-mains-01',
        yield: 2,
        ingredients: [{ ingredientId: 'onion', ingredientName: 'בצל', quantity: '1', unit: 'kg' }],
      }],
    } as LegacyStore
    const onSave = vi.fn<StoreSaveHandler>().mockResolvedValue(undefined)
    mockedUseStore.mockReturnValue(queryResult({ store }))
    const user = userEvent.setup()
    render(<RecipesScreen onSave={onSave} autosaveDelayMs={40} />)

    await user.click(screen.getByText('קציצות בשר ברוטב אדום עשיר'))
    const quantity = screen.getByLabelText('כמות מצרך 1') as HTMLInputElement

    // An invalid quantity stays a dirty draft — the debounce passes, nothing is sent.
    await user.clear(quantity)
    await user.type(quantity, '0')
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(onSave).not.toHaveBeenCalled()

    await user.clear(quantity)
    await user.type(quantity, '2.75')
    await waitFor(() => {
      const lastCall = onSave.mock.calls.at(-1)
      expect(lastCall).toBeTruthy()
      const recipes = (lastCall![0].nextStore as Record<string, unknown>).recipes as Array<Record<string, unknown>>
      expect(recipes[0]!.ingredients).toMatchObject([{ quantity: '2.75' }])
    })
    expect(await screen.findByText(/נשמר אוטומטית/)).toBeTruthy()
  })

  it('continues saving after the confirmed envelope lands in the query cache', async () => {
    const store = {
      orders: [],
      recipes: [{
        itemId: 'shabbat-mains-01',
        yield: 2,
        ingredients: [{ ingredientId: 'onion', ingredientName: 'בצל', quantity: '1', unit: 'kg' }],
      }],
    } as LegacyStore
    const onSave = vi.fn<StoreSaveHandler>().mockResolvedValue(undefined)
    mockedUseStore.mockReturnValue(queryResult({ store, revision: 1 }))
    const user = userEvent.setup()
    const view = render(<RecipesScreen onSave={onSave} autosaveDelayMs={NO_AUTOSAVE} />)

    await user.click(screen.getByText('קציצות בשר ברוטב אדום עשיר'))
    const quantity = screen.getByLabelText('כמות מצרך 1') as HTMLInputElement
    await user.clear(quantity)
    await user.type(quantity, '2')
    await user.click(screen.getByRole('button', { name: 'שמירת כל המתכונים' }))
    expect(onSave).toHaveBeenCalledTimes(1)

    // The versioned mutation writes the confirmed envelope into the cache.
    const savedStore = onSave.mock.calls[0]![0].nextStore
    mockedUseStore.mockReturnValue(queryResult({ store: savedStore, revision: 2 }))
    view.rerender(<RecipesScreen onSave={onSave} autosaveDelayMs={NO_AUTOSAVE} />)

    await user.clear(screen.getByLabelText('כמות מצרך 1'))
    await user.type(screen.getByLabelText('כמות מצרך 1'), '3')
    await user.click(screen.getByRole('button', { name: 'שמירת כל המתכונים' }))

    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onSave.mock.calls[1]![0].baseEnvelope).toMatchObject({ revision: 2 })
    expect(screen.queryByText(/הנתונים התעדכנו/)).toBeNull()
    expect(await screen.findByText('המתכונים נשמרו.')).toBeTruthy()
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
    render(<RecipesScreen onSave={onSave} autosaveDelayMs={NO_AUTOSAVE} />)

    expect(screen.getByText('יש בעיה במתכונים השמורים')).toBeTruthy()
    expect(screen.getByText(/אף מתכון קיים לא ילך לאיבוד/)).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('button', { name: 'שמירת כל המתכונים' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes('שום מתכון קיים לא הוחלף'))).toBe(true)
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
    render(<RecipesScreen onSave={onSave} autosaveDelayMs={NO_AUTOSAVE} />)

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
    const view = render(<RecipesScreen onSave={onSave} autosaveDelayMs={NO_AUTOSAVE} />)

    await user.click(screen.getByRole('button', { name: 'עריכת מתכון' }))
    const quantity = screen.getByLabelText('כמות מצרך 1') as HTMLInputElement
    await user.clear(quantity)
    await user.type(quantity, '3')
    mockedUseStore.mockReturnValue(queryResult({ store: refreshedStore, revision: 11 }))
    view.rerender(<RecipesScreen onSave={onSave} autosaveDelayMs={NO_AUTOSAVE} />)
    expect((screen.getByLabelText('כמות מצרך 1') as HTMLInputElement).value).toBe('3')

    await user.click(screen.getByRole('button', { name: 'שמירת כל המתכונים' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes('הנתונים התעדכנו'))).toBe(true)
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
    const user = userEvent.setup()
    render(<RecipesScreen autosaveDelayMs={NO_AUTOSAVE} />)

    await user.click(screen.getByRole('button', { name: 'עריכת מתכון' }))
    const quantity = screen.getByLabelText('כמות מצרך 1') as HTMLInputElement
    await user.clear(quantity)
    await user.type(quantity, '2')
    await user.click(screen.getByRole('button', { name: 'שמירת כל המתכונים' }))

    expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes('לא השתנה בשרת'))).toBe(true)
    expect(screen.queryByText('המתכונים נשמרו.')).toBeNull()
  })
})
