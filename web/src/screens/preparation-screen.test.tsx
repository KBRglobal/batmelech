// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../data/use-store.ts'
import type { PreparationCatalog } from '../domain/preparation.ts'
import type { LegacyStore } from '../domain/store.ts'
import { PreparationScreen } from './preparation-screen.tsx'

vi.mock('../data/use-store.ts', () => ({ useStore: vi.fn() }))
const mockedUseStore = vi.mocked(useStore)

const CATALOG: PreparationCatalog = {
  items: [
    { id: 'matbucha', category: 'salads', name: 'מטבוחה אמיתית', procurement: { kind: 'recipe' } },
    { id: 'fish', category: 'firsts', name: 'דג אמיתי', procurement: { kind: 'recipe' } },
    { id: 'main', category: 'mains', name: 'עיקרית אמיתית', procurement: { kind: 'recipe' } },
    { id: 'side', category: 'sides', name: 'תוספת אמיתית', procurement: { kind: 'recipe' } },
    { id: 'dessert', category: 'desserts', name: 'קינוח אמיתי', procurement: { kind: 'recipe' } },
    { id: 'extra', category: 'extras', name: 'אקסטרה אמיתית', procurement: { kind: 'none' } },
  ],
  lunchItems: [{
    key: 'couscous',
    name: 'צהריים אמיתי',
    itemId: 'lunch-couscous',
    procurement: { kind: 'none' },
    addon: { itemId: 'lunch-addon', name: 'תוספת אמיתית לצהריים', procurement: { kind: 'none' } },
  }],
}

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

function renderPreparation(path = '/preparation') {
  return render(<MemoryRouter initialEntries={[path]}><PreparationScreen /></MemoryRouter>)
}

afterEach(cleanup)
beforeEach(() => mockedUseStore.mockReset())

describe('PreparationScreen', () => {
  it('renders loading, retryable error, and an honest empty state', async () => {
    mockedUseStore.mockReturnValue(queryResult({ pending: true }))
    const pending = renderPreparation()
    expect(screen.getByText('טוענת את סיכום ההכנות')).toBeTruthy()
    pending.unmount()

    const refetch = vi.fn()
    mockedUseStore.mockReturnValue(queryResult({ error: true, refetch }))
    const failed = renderPreparation()
    await userEvent.setup().click(screen.getByRole('button', { name: 'ניסיון נוסף' }))
    expect(refetch).toHaveBeenCalledTimes(1)
    failed.unmount()

    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [] } }))
    renderPreparation()
    expect(screen.getByText('אין הזמנות פעילות להכנה')).toBeTruthy()
  })

  it('uses the date query and renders real quantities, notes, and exact finance totals', async () => {
    const store = {
      orders: [
        {
          id: 'actual-1',
          date: '2099-08-14',
          name: 'לקוחה אמיתית',
          meals: 2,
          aricha: 4,
          challot: 2,
          salads: { 'מטבוחה אמיתית': { o: 3, p: 1 } },
          firsts: { 'דג אמיתי': 2 },
          mains: { 'עיקרית אמיתית': 2 },
          sides: { 'תוספת אמיתית': 2 },
          desserts: { 'קינוח אמיתי': 2 },
          extras: { 'אקסטרה אמיתית': { q: 1, note: 'לארוז בנפרד' } },
          lunch: { couscous: { q: 1, addon: 2 } },
          heat: 'חריף',
          firstsNote: 'בלי כוסברה',
          mainsNote: 'רוטב בצד',
          notes: 'להתקשר בלובי',
          total: '100.10',
          deposit: '.10',
          paid: 'מקדמה',
        },
        { id: 'actual-2', date: '2099-08-15', name: 'לקוחה ביום אחר', meals: 1, total: '50' },
      ],
      preparationCatalog: CATALOG,
    } as LegacyStore
    mockedUseStore.mockReturnValue(queryResult({ store }))
    renderPreparation('/preparation?date=2099-08-14')

    expect(screen.getAllByText('לקוחה אמיתית:').length).toBeGreaterThan(0)
    expect(screen.queryByText('לקוחה ביום אחר')).toBeNull()
    expect(screen.getByText('3 בהזמנה + 1 פינוק')).toBeTruthy()
    expect(screen.getAllByText('$100.10').length).toBeGreaterThan(0)
    expect(screen.getAllByText('$0.10').length).toBeGreaterThan(0)
    expect(screen.getAllByText('$100.00').length).toBeGreaterThan(0)
    expect(screen.getByText(/חריף · בלי כוסברה/)).toBeTruthy()
    expect(screen.getByText(/רוטב בצד/)).toBeTruthy()
    expect(screen.getByText(/להתקשר בלובי/)).toBeTruthy()
    expect(screen.getByText(/אקסטרה אמיתית ×1 — לארוז בנפרד/)).toBeTruthy()
    expect(screen.getByText(/צהריים אמיתי ×1 — תוספת למנה ×2/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'רשימת קניות לתאריך' }).getAttribute('href')).toBe(
      '/shopping-list?date=2099-08-14',
    )
    expect(screen.getByRole('button', { name: 'סימון הושלם לא זמין' }).hasAttribute('disabled')).toBe(true)

    await userEvent.setup().selectOptions(screen.getByLabelText('תאריך הכנה'), '2099-08-15')
    expect(screen.getByRole('heading', { level: 2, name: 'יום שבת, 15.08.2099' })).toBeTruthy()
    expect(screen.getAllByText('$50.00').length).toBeGreaterThan(0)
    expect(screen.queryByText('מטבוחה אמיתית')).toBeNull()
  })

  it('shows raw preparation totals but explicitly blocks recipe flow when catalog configuration is missing', () => {
    mockedUseStore.mockReturnValue(queryResult({
      store: {
        orders: [{
          id: 'raw', date: '2099-08-14', name: 'לקוחה', firsts: { 'מנה לא מקוטלגת': 3 },
        }],
      },
    }))
    renderPreparation()

    expect(screen.getByText('קטלוג ההכנה עדיין לא נשמר')).toBeTruthy()
    expect(screen.getByText('מנה לא מקוטלגת')).toBeTruthy()
    const alerts = screen.getAllByRole('alert')
    expect(alerts.some((alert) => within(alert).queryByText(/אינו מחובר לקטלוג הכנה יציב/) !== null)).toBe(true)
  })

  it('never presents a coerced finance total when legacy money is malformed', () => {
    mockedUseStore.mockReturnValue(queryResult({
      store: {
        orders: [{ id: 'bad', date: '2099-08-14', name: 'סכום לבדיקה', total: '1,2,3' }],
        preparationCatalog: CATALOG,
      } as LegacyStore,
    }))
    renderPreparation()

    expect(screen.getAllByText('לא מלא').length).toBeGreaterThan(0)
    expect(screen.getByRole('alert').textContent).toContain('הסיכום הכספי אינו מלא')
    expect(screen.queryByText('$123.00')).toBeNull()
  })
})
