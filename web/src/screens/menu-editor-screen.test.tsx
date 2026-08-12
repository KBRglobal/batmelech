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

  it('shows every authoritative fish, salad, dessert, extras, and lunch rule', () => {
    mockedUseStore.mockReturnValue(queryResult())
    render(<MenuEditorScreen />)

    expect((screen.getByLabelText('מחיר ארוחה זוגית') as HTMLInputElement).value).toBe('230')
    expect((screen.getByLabelText('מחיר ארוחה זוגית') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('מחיר חלה נוספת') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText(/טופס הלקוחות עדיין משתמש במחירים קבועים/)).toBeTruthy()
    expect(screen.getByText('סלטים כלולים בזוגית').parentElement?.textContent).toContain('4')
    expect(screen.getByText('דגים כלולים בזוגית').parentElement?.textContent).toContain('2')
    expect((screen.getByLabelText('מחיר פילה דג נוסף') as HTMLInputElement).value).toBe('30')
    expect(screen.getByText(/שני פילטים, בכל שילוב של מרוקאי וחריימה/)).toBeTruthy()
    expect(screen.getByText(/מנת קציצות דגים אחת שווה למנת דג זוגית מלאה/)).toBeTruthy()
    expect(screen.getByText(/כל בלוק נוסף של 4 עולה 25\$/)).toBeTruthy()
    expect(screen.getByText(/2 סופלה או מנת סוכריות בקלוואה אחת/)).toBeTruthy()
    expect(screen.getByText('סלטים (17)')).toBeTruthy()
    expect(screen.getByText('ראשונות (3)')).toBeTruthy()
    expect(screen.getByText('עיקריות (8)')).toBeTruthy()
    expect(screen.getByText('תוספות (6)')).toBeTruthy()
    expect(screen.getByText('קינוחים (2)')).toBeTruthy()
    expect((screen.getByLabelText('מחיר מרק ירקות לקוסקוס ללא עוף') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText('מרק ירקות לקוסקוס ללא עוף')).toBeTruthy()
    expect(screen.getByText('אורז')).toBeTruthy()
    expect(screen.getAllByText('פסטה אדומה').length).toBeGreaterThan(0)
    expect(screen.getAllByText('קוסקוס').length).toBeGreaterThan(0)
    expect(screen.getByText('בגט טוניסאי אותנטי')).toBeTruthy()
    expect(screen.getByText('מנת קובה סלק ביתית')).toBeTruthy()
    expect(screen.getAllByText(/משפחתית — כולל 2 תוספות/).length).toBeGreaterThan(0)
    expect(screen.getByText('זמין בסוף שבוע בלבד')).toBeTruthy()
    expect(screen.getByText(/מחירי הצהריים מוצגים בלבד ונעולים למחירון שבטופס הלקוחות/)).toBeTruthy()
    const lunchEditor = screen.getByText('תפריט צהריים (5)').closest('details')
    expect(lunchEditor).not.toBeNull()
    expect(lunchEditor?.querySelector('input, select, textarea, button')).toBeNull()
    expect(within(lunchEditor as HTMLElement).getByText('מחיר בגט טוניסאי אותנטי').parentElement?.textContent).toContain('22$')
    expect(screen.queryByText('תוספת מנת דג')).toBeNull()
    expect(screen.queryByText('תוספת קציצות דגים')).toBeNull()
    expect(screen.queryByText('משלוח')).toBeNull()
    expect(screen.queryByLabelText('מנה חדשה בראשונות')).toBeNull()
    expect(screen.queryByLabelText('מנה חדשה בעיקריות')).toBeNull()
    expect(screen.queryByLabelText('אקסטרה חדשה')).toBeNull()
    expect(screen.queryByRole('button', { name: /מחיקת/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'חזרה לתפריט המקורי' })).toBeNull()
  })

  it('saves unrelated store data without exposing a callback that can change lunch pricing', async () => {
    const store = { orders: [{ id: 'real-order' }], preserved: { exact: true } } as LegacyStore
    mockedUseStore.mockReturnValue(queryResult({ store }))
    const onSave = vi.fn<StoreSaveHandler>().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<MenuEditorScreen onSave={onSave} />)

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'מחיר בגט טוניסאי אותנטי' })).toBeNull()
    const lunchEditor = screen.getByText('תפריט צהריים (5)').closest('details')
    expect(lunchEditor?.querySelectorAll('input, select, textarea, button')).toHaveLength(0)
    expect(onSave).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'שמירת התפריט' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    const request = onSave.mock.calls[0]![0]
    expect(request.reason).toBe('menu')
    expect(request.baseEnvelope).toMatchObject({ revision: 1, hash: HASH, data: store })
    expect(request.baseStore).toBe(store)
    expect(request.nextStore.orders).toEqual([{ id: 'real-order' }])
    expect((request.nextStore as Record<string, unknown>).preserved).toEqual({ exact: true })
    expect((request.nextStore as Record<string, unknown>).menu).toMatchObject({
      couplePrice: 230,
      lunch: expect.arrayContaining([{ key: 'baguette', price: 22 }]),
    })
    expect(await screen.findByText('נשמר')).toBeTruthy()
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

  it('keeps every Shabbat category and extra visible without add, delete, or reset mutations', () => {
    mockedUseStore.mockReturnValue(queryResult())
    render(<MenuEditorScreen />)

    expect(screen.getByText('פילה דג ברוטב מרוקאי')).toBeTruthy()
    expect(screen.getByText('קציצות בשר ברוטב אדום עשיר')).toBeTruthy()
    expect(screen.getByText('מארז הבדלה')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /מחיקת/ })).toBeNull()
    expect(screen.queryByLabelText(/מנה חדשה/)).toBeNull()
    expect(screen.queryByLabelText('אקסטרה חדשה')).toBeNull()
    expect(screen.queryByRole('button', { name: 'חזרה לתפריט המקורי' })).toBeNull()
    expect(screen.getAllByText(/טופס הלקוחות, המחיר/).length).toBeGreaterThan(0)
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
    expect(screen.queryByRole('textbox', { name: 'מחיר בגט טוניסאי אותנטי' })).toBeNull()
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
