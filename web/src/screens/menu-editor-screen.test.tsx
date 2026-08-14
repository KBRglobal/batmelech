// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../data/use-store.ts'
import type { StoreSaveHandler } from '../domain/settings-catalog.ts'
import type { LegacyStore } from '../domain/store.ts'
import { MenuEditorScreen } from './menu-editor-screen.tsx'

vi.mock('../data/use-store.ts', () => ({ useStore: vi.fn() }))
const mockedUseStore = vi.mocked(useStore)
const HASH = 'a'.repeat(64)

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

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
beforeEach(() => mockedUseStore.mockReset())

describe('MenuEditorScreen', () => {
  it('renders loading and retryable error states without writing', async () => {
    mockedUseStore.mockReturnValue(queryResult({ pending: true }))
    const loading = render(<MenuEditorScreen />)
    expect(screen.getByText('טוענת את התפריט')).toBeTruthy()
    loading.unmount()

    const refetch = vi.fn()
    mockedUseStore.mockReturnValue(queryResult({ error: true, refetch }))
    render(<MenuEditorScreen />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'ניסיון נוסף' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('shows editable prices for the couple meal, extras, and lunch, and a locked constant fillet price', () => {
    mockedUseStore.mockReturnValue(queryResult())
    render(<MenuEditorScreen />)

    expect((screen.getByLabelText('מחיר ארוחה זוגית') as HTMLInputElement).value).toBe('230')
    expect((screen.getByLabelText('מחיר ארוחה זוגית') as HTMLInputElement).disabled).toBe(false)
    expect((screen.getByLabelText('מחיר חלה נוספת') as HTMLInputElement).disabled).toBe(false)
    expect(screen.getByText('סלטים כלולים בזוגית').parentElement?.textContent).toContain('4')
    expect(screen.getByText('דגים כלולים בזוגית').parentElement?.textContent).toContain('2')
    expect((screen.getByLabelText('מחיר פילה דג נוסף') as HTMLInputElement).value).toBe('30')
    expect((screen.getByLabelText('מחיר פילה דג נוסף') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText('סלטים (17)')).toBeTruthy()
    expect(screen.getByText('ראשונות (3)')).toBeTruthy()
    expect(screen.getByText('עיקריות (8)')).toBeTruthy()
    expect(screen.getByText('תוספות (6)')).toBeTruthy()
    expect(screen.getByText('קינוחים (2)')).toBeTruthy()
    expect((screen.getByLabelText('מחיר מרק ירקות לקוסקוס ללא עוף') as HTMLInputElement).disabled).toBe(false)
    expect((screen.getByLabelText('מחיר בגט טוניסאי אותנטי') as HTMLInputElement).value).toBe('22')
    expect(screen.getAllByText(/משפחתית — כולל 2 תוספות/).length).toBeGreaterThan(0)
    expect(screen.getByText('זמין בסוף שבוע בלבד')).toBeTruthy()
    expect(screen.queryByText('תוספת מנת דג')).toBeNull()
    expect(screen.queryByText('תוספת קציצות דגים')).toBeNull()
    expect(screen.queryByLabelText('הוספת מנה לראשונות')).toBeNull()
    expect(screen.getByLabelText('הוספת מנה לעיקריות')).toBeTruthy()
    expect(screen.getByLabelText('שם אקסטרה חדשה')).toBeTruthy()
  })

  it('locks the firsts category — no rename, no add, no remove', () => {
    mockedUseStore.mockReturnValue(queryResult())
    render(<MenuEditorScreen />)

    const firstsInput = screen.getByLabelText(/שם המנה — .*חריימה/) as HTMLInputElement
    expect(firstsInput.disabled).toBe(true)
    expect(screen.queryByLabelText('הוספת מנה לראשונות')).toBeNull()
  })

  it('renames a category dish and saves the new name', async () => {
    const store = { orders: [] } as LegacyStore
    mockedUseStore.mockReturnValue(queryResult({ store }))
    const onSave = vi.fn<StoreSaveHandler>().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<MenuEditorScreen onSave={onSave} />)

    const input = screen.getByLabelText('שם המנה — סלט ביצים') as HTMLInputElement
    await user.clear(input)
    await user.type(input, 'סלט ביצים חדש')
    await user.tab()
    expect(screen.getByLabelText('שם המנה — סלט ביצים חדש')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'שמירת התפריט' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    const nextMenu = onSave.mock.calls[0]![0].nextStore as unknown as { menu: { salads: string[] } }
    expect(nextMenu.menu.salads).toContain('סלט ביצים חדש')
  })

  it('adds and removes a dish in an unlocked category', async () => {
    mockedUseStore.mockReturnValue(queryResult())
    const user = userEvent.setup()
    render(<MenuEditorScreen />)

    const mainsSection = () => screen.getByText(/^עיקריות \(\d+\)$/).closest('details') as HTMLElement
    await user.type(within(mainsSection()).getByLabelText('הוספת מנה לעיקריות'), 'מנה חדשה לגמרי')
    await user.click(within(mainsSection()).getByRole('button', { name: 'הוספה' }))
    expect(screen.getByText('עיקריות (9)')).toBeTruthy()
    expect(screen.getByLabelText('שם המנה — מנה חדשה לגמרי')).toBeTruthy()

    const removeButtons = within(mainsSection()).getAllByRole('button', { name: 'הסרה' })
    await user.click(removeButtons[removeButtons.length - 1]!)
    expect(screen.getByText('עיקריות (8)')).toBeTruthy()
  })

  it('edits an extra price and saves it', async () => {
    const store = { orders: [] } as LegacyStore
    mockedUseStore.mockReturnValue(queryResult({ store }))
    const onSave = vi.fn<StoreSaveHandler>().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<MenuEditorScreen onSave={onSave} />)

    const price = screen.getByLabelText('מחיר מארז הבדלה') as HTMLInputElement
    await user.clear(price)
    await user.type(price, '25')
    await user.tab()
    expect(price.value).toBe('25')

    await user.click(screen.getByRole('button', { name: 'שמירת התפריט' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    const nextMenu = onSave.mock.calls[0]![0].nextStore as unknown as {
      menu: { extras: Array<{ name: string; price: number }> }
    }
    expect(nextMenu.menu.extras).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'מארז הבדלה', price: 25 }),
    ]))
  })

  it('edits a lunch variant price and saves it', async () => {
    const store = { orders: [] } as LegacyStore
    mockedUseStore.mockReturnValue(queryResult({ store }))
    const onSave = vi.fn<StoreSaveHandler>().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<MenuEditorScreen onSave={onSave} />)

    const price = screen.getByLabelText('מחיר בגט טוניסאי אותנטי') as HTMLInputElement
    await user.clear(price)
    await user.type(price, '24')
    await user.tab()

    await user.click(screen.getByRole('button', { name: 'שמירת התפריט' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    const nextMenu = onSave.mock.calls[0]![0].nextStore as unknown as {
      menu: { lunch: Array<{ key: string; price?: number }> }
    }
    expect(nextMenu.menu.lunch).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'baguette', price: 24 }),
    ]))
  })

  it('shows a rejection message instead of applying an invalid rename, and never calls onSave for it', async () => {
    mockedUseStore.mockReturnValue(queryResult())
    const onSave = vi.fn<StoreSaveHandler>().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<MenuEditorScreen onSave={onSave} />)

    const input = screen.getByLabelText('שם המנה — סלט ביצים') as HTMLInputElement
    await user.clear(input)
    await user.type(input, 'סלט תפו"א')
    await user.tab()

    expect(screen.getByRole('alert').textContent).toContain('already exists')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('blocks loaded duplicate IDs without exposing lunch price mutation controls', async () => {
    const onSave = vi.fn<StoreSaveHandler>().mockResolvedValue(undefined)
    const user = userEvent.setup()
    mockedUseStore.mockReturnValue(queryResult({
      store: {
        orders: [],
        menu: {
          salads: ['סלט א'],
          firsts: ['ראשונה א'],
          itemIds: { salads: { 'סלט א': 'duplicate-id' }, firsts: { 'ראשונה א': 'duplicate-id' } },
        },
      } as LegacyStore,
    }))
    render(<MenuEditorScreen onSave={onSave} />)
    const warning = screen.getByRole('alert')
    expect(within(warning).getAllByText(/duplicate item ID/).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'שמירת התפריט' }))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('keeps its exact initialization envelope and performs no stale callback', async () => {
    const initialStore = { orders: [{ id: 'initial' }], marker: 'initial' } as LegacyStore
    const refreshedStore = { orders: [{ id: 'initial' }], marker: 'refreshed' } as LegacyStore
    const onSave = vi.fn<StoreSaveHandler>().mockResolvedValue(undefined)
    mockedUseStore.mockReturnValue(queryResult({ store: initialStore, revision: 4 }))
    const user = userEvent.setup()
    const view = render(<MenuEditorScreen onSave={onSave} />)

    mockedUseStore.mockReturnValue(queryResult({ store: refreshedStore, revision: 5 }))
    view.rerender(<MenuEditorScreen onSave={onSave} />)
    await user.click(screen.getByRole('button', { name: 'שמירת התפריט' }))

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('הנתונים התעדכנו מאז פתיחת הטיוטה')
  })

  it('blocks malformed loaded prices and exposes no destructive reset repair', async () => {
    const store = {
      orders: [{ id: 'keep-this-order' }],
      menu: { couplePrice: '1.234' },
    } as LegacyStore
    const onSave = vi.fn<StoreSaveHandler>().mockResolvedValue(undefined)
    mockedUseStore.mockReturnValue(queryResult({ store }))
    const user = userEvent.setup()
    render(<MenuEditorScreen onSave={onSave} />)

    await user.click(screen.getByRole('button', { name: 'שמירת התפריט' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes('invalid USD price'))).toBe(true)

    expect(screen.queryByRole('button', { name: 'חזרה לתפריט המקורי' })).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('does not claim persistence when the save boundary is absent', async () => {
    mockedUseStore.mockReturnValue(queryResult())
    render(<MenuEditorScreen />)

    await userEvent.setup().click(screen.getByRole('button', { name: 'שמירת התפריט' }))

    expect(screen.getByRole('alert').textContent).toContain('לא בוצע שינוי בשרת')
    expect(screen.queryByText('נשמר')).toBeNull()
  })
})
