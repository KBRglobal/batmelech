// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../data/use-store.ts'
import type { StoreSaveHandler } from '../domain/settings-catalog.ts'
import type { LegacyStore } from '../domain/store.ts'
import { ProductLibraryScreen } from './product-library-screen.tsx'

vi.mock('../data/use-store.ts', () => ({ useStore: vi.fn() }))
const mockedUseStore = vi.mocked(useStore)
const HASH = 'c'.repeat(64)
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

afterEach(cleanup)
beforeEach(() => mockedUseStore.mockReset())

describe('ProductLibraryScreen', () => {
  it('renders loading and retryable error states without changing data', async () => {
    mockedUseStore.mockReturnValue(queryResult({ pending: true }))
    const pending = render(<ProductLibraryScreen />)
    expect(screen.getByText('טוענת את ספריית המוצרים')).toBeTruthy()
    pending.unmount()

    const refetch = vi.fn()
    mockedUseStore.mockReturnValue(queryResult({ error: true, refetch }))
    render(<ProductLibraryScreen />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'ניסיון נוסף' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('shows an empty state with no products yet', () => {
    mockedUseStore.mockReturnValue(queryResult())
    render(<ProductLibraryScreen />)
    expect(screen.getByText('אין עדיין מוצרים בספרייה.')).toBeTruthy()
  })

  it('creates a product, prices it at Nesto, and saves it into store.productLibrary', async () => {
    const onSave = vi.fn<StoreSaveHandler>().mockResolvedValue(undefined)
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [] } }))
    const user = userEvent.setup()
    render(<ProductLibraryScreen onSave={onSave} autosaveDelayMs={NO_AUTOSAVE} />)

    await user.click(screen.getByRole('button', { name: /מוצר חדש/ }))
    const nameInput = screen.getByLabelText('שם המוצר') as HTMLInputElement
    await user.clear(nameInput)
    await user.type(nameInput, 'בשר בקר')

    const packSize = screen.getByLabelText('גודל אריזה') as HTMLInputElement
    await user.type(packSize, '5')
    const packPrice = screen.getByLabelText('מחיר לאריזה (AED)') as HTMLInputElement
    await user.type(packPrice, '25')

    await user.click(screen.getByRole('button', { name: 'שמירה' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const call = onSave.mock.calls[0]![0]
    expect(call.reason).toBe('product-library')
    const saved = (call.nextStore as Record<string, unknown>).productLibrary as ReadonlyArray<
      Record<string, unknown>
    >
    expect(saved).toHaveLength(1)
    expect(saved[0]!.name).toBe('בשר בקר')
    const listings = saved[0]!.listings as Record<string, { packPriceMinorUnits: number }>
    expect(listings.nesto!.packPriceMinorUnits).toBe(2500)
  })

  it('locks the default-supplier select when a product is marked kosher-only', async () => {
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [] } }))
    const user = userEvent.setup()
    render(<ProductLibraryScreen autosaveDelayMs={NO_AUTOSAVE} />)

    await user.click(screen.getByRole('button', { name: /מוצר חדש/ }))
    const kosherCheckbox = screen.getByRole('checkbox', { name: /כשר בלבד/ })
    const supplierSelect = screen.getByLabelText('ספק ברירת מחדל') as HTMLSelectElement
    expect(supplierSelect.disabled).toBe(false)
    await user.click(kosherCheckbox)
    expect(supplierSelect.disabled).toBe(true)
  })

  it('filters products by the search box', async () => {
    mockedUseStore.mockReturnValue(
      queryResult({
        store: {
          orders: [],
          productLibrary: [
            {
              id: 'product-a',
              name: 'עגבניות',
              category: 'ירקות',
              kosherOnly: false,
              supplierOverride: null,
              insignificant: false,
              listings: {
                nesto: {
                  packSize: '5',
                  packUnit: 'ק"ג',
                  packPriceMinorUnits: 1000,
                  updatedAt: 1,
                  manualPrice: null,
                },
              },
            },
            {
              id: 'product-b',
              name: 'בשר טלה',
              category: 'meat',
              kosherOnly: true,
              supplierOverride: null,
              insignificant: false,
              listings: {
                rimon: {
                  packSize: '2',
                  packUnit: 'ק"ג',
                  packPriceMinorUnits: 8000,
                  updatedAt: 1,
                  manualPrice: null,
                },
              },
            },
          ],
        } as unknown as LegacyStore,
      }),
    )
    const user = userEvent.setup()
    render(<ProductLibraryScreen autosaveDelayMs={NO_AUTOSAVE} />)

    expect(screen.getByDisplayValue('עגבניות')).toBeTruthy()
    expect(screen.getByDisplayValue('בשר טלה')).toBeTruthy()

    await user.type(screen.getByLabelText('חיפוש מוצר'), 'טלה')
    expect(screen.queryByDisplayValue('עגבניות')).toBeNull()
    expect(screen.getByDisplayValue('בשר טלה')).toBeTruthy()
  })

  it('imports a pasted JSON list through the bulk-import section', async () => {
    const onSave = vi.fn<StoreSaveHandler>().mockResolvedValue(undefined)
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [] } }))
    const user = userEvent.setup()
    render(<ProductLibraryScreen onSave={onSave} autosaveDelayMs={NO_AUTOSAVE} />)

    const payload = JSON.stringify([
      {
        id: 'product-import-a',
        name: 'כרוב מיובא',
        category: 'ירקות',
        kosherOnly: false,
        supplierOverride: null,
        insignificant: false,
        listings: {
          nesto: { packSize: '1', packUnit: 'ק"ג', packPriceMinorUnits: 699, updatedAt: 5, manualPrice: null },
        },
      },
      { broken: true },
    ])
    const textarea = screen.getByLabelText('רשימת מוצרים לייבוא') as HTMLTextAreaElement
    // paste, not type: the JSON braces trip userEvent's keyboard parser
    await user.click(textarea)
    await user.paste(payload)
    await user.click(screen.getByRole('button', { name: 'טעינת הרשימה' }))

    expect(screen.getByDisplayValue('כרוב מיובא')).toBeTruthy()
    expect(screen.getByText(/נטענו 1 מוצרים/)).toBeTruthy()
    expect(screen.getByText(/1 לא תקינים/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'שמירה' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const saved = (onSave.mock.calls[0]![0].nextStore as Record<string, unknown>).productLibrary as ReadonlyArray<
      Record<string, unknown>
    >
    expect(saved).toHaveLength(1)
    expect(saved[0]!.id).toBe('product-import-a')
  })

  it('computes a quick cost estimate once a quantity is typed', async () => {
    mockedUseStore.mockReturnValue(
      queryResult({
        store: {
          orders: [],
          productLibrary: [
            {
              id: 'product-a',
              name: 'עגבניות',
              category: '',
              kosherOnly: false,
              supplierOverride: null,
              insignificant: false,
              listings: {
                nesto: {
                  packSize: '5',
                  packUnit: 'ק"ג',
                  packPriceMinorUnits: 1000,
                  updatedAt: 1,
                  manualPrice: null,
                },
              },
            },
          ],
        } as unknown as LegacyStore,
      }),
    )
    const user = userEvent.setup()
    render(<ProductLibraryScreen autosaveDelayMs={NO_AUTOSAVE} />)

    const card = screen.getByDisplayValue('עגבניות').closest('div.rounded-\\[2rem\\]') as HTMLElement
    const calculator = within(card)
    expect(calculator.getByText('הקלד כמות לחישוב')).toBeTruthy()
    await user.type(calculator.getByLabelText('כמות'), '3')
    expect(calculator.getByText(/≈ 6\.00 AED/)).toBeTruthy()
  })
})
