// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfirmedStoreSaveHandler } from '../data/versioned-screen-save.tsx'
import { useStore } from '../data/use-store.ts'
import type { PreparationCatalog } from '../domain/preparation.ts'
import type { LegacyStore } from '../domain/store.ts'
import { KitchenScreen } from './kitchen-screen.tsx'

vi.mock('../data/use-store.ts', () => ({ useStore: vi.fn() }))
const mockedUseStore = vi.mocked(useStore)
const HASH = 'c'.repeat(64)

const CATALOG: PreparationCatalog = {
  items: [
    { id: 'matbucha', category: 'salads', name: 'מטבוחה', procurement: { kind: 'recipe' } },
    { id: 'fish', category: 'firsts', name: 'דג מרוקאי', procurement: { kind: 'recipe' } },
    { id: 'chicken', category: 'mains', name: 'עוף בתנור', procurement: { kind: 'recipe' } },
  ],
  lunchItems: [],
}

function kitchenStore(overrides: Partial<LegacyStore> = {}): LegacyStore {
  return {
    orders: [
      {
        id: 'k1',
        date: '2099-08-14',
        name: 'לקוחה',
        status: 'אושרה',
        salads: { 'מטבוחה': { o: 3, p: 1 } },
        firsts: { 'דג מרוקאי': 2 },
        mains: { 'עוף בתנור': 4 },
      },
    ],
    settings: { preparationCatalog: CATALOG } as LegacyStore['settings'],
    ...overrides,
  }
}

function queryResult(store: LegacyStore, refetch = vi.fn()): ReturnType<typeof useStore> {
  return {
    isPending: false,
    isError: false,
    data: { revision: 1, ts: 1, hash: HASH, data: store },
    refetch,
  } as unknown as ReturnType<typeof useStore>
}

function renderKitchen(onSave?: ConfirmedStoreSaveHandler) {
  return render(<MemoryRouter initialEntries={['/kitchen']}><KitchenScreen onSave={onSave} /></MemoryRouter>)
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
beforeEach(() => mockedUseStore.mockReset())

describe('KitchenScreen', () => {
  it('shows the prep board in large type with real quantities and progress', () => {
    mockedUseStore.mockReturnValue(queryResult(kitchenStore()))
    renderKitchen()
    expect(screen.getByText('מצב מטבח')).toBeTruthy()
    expect(screen.getByText('מטבוחה')).toBeTruthy()
    expect(screen.getAllByText('×4').length).toBe(2) // salad total 3+1, chicken 4
    expect(screen.getByText('0/3')).toBeTruthy()
  })

  it('marks a dish done through the confirmed save path and reflects it', async () => {
    const store = kitchenStore()
    const saves: LegacyStore[] = []
    const onSave: ConfirmedStoreSaveHandler = async ({ reason, nextStore }) => {
      expect(reason).toBe('kitchen')
      saves.push(nextStore)
      return { revision: 2, ts: 2, hash: HASH, data: nextStore }
    }
    mockedUseStore.mockReturnValue(queryResult(store))
    renderKitchen(onSave)

    await userEvent.setup().click(screen.getByRole('button', { name: /עוף בתנור/u }))
    expect(saves.length).toBe(1)
    const prepDone = (saves[0] as Record<string, unknown>).prepDone as Record<string, Record<string, boolean>>
    expect(prepDone['2099-08-14']['mains|עוף בתנור']).toBe(true)
  })

  it('shows an honest empty state when the date has no prep', () => {
    mockedUseStore.mockReturnValue(queryResult(kitchenStore({ orders: [] })))
    renderKitchen()
    expect(screen.getByText('אין הכנות לתאריך הזה')).toBeTruthy()
  })
})
