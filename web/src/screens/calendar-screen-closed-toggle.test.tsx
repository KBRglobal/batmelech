// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../data/use-store.ts'
import useVersionedScreenSave from '../data/versioned-screen-save.tsx'
import type { LegacyStore } from '../domain/store.ts'
import { CalendarScreen } from './calendar-screen.tsx'

vi.mock('../data/use-store.ts', () => ({ useStore: vi.fn() }))
vi.mock('../data/versioned-screen-save.tsx', () => ({ default: vi.fn() }))

const mockedUseStore = vi.mocked(useStore)
const mockedUseVersionedScreenSave = vi.mocked(useVersionedScreenSave)
const HASH = 'a'.repeat(64)

function queryResult(store: LegacyStore) {
  return {
    isPending: false,
    isError: false,
    data: { revision: 1, ts: 1, hash: HASH, data: store },
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useStore>
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
beforeEach(() => {
  mockedUseStore.mockReset()
  mockedUseVersionedScreenSave.mockReset()
})

describe('CalendarScreen closed-day toggle', () => {
  it('shows a closed badge and toggling opens the date', async () => {
    const onSave = vi.fn().mockResolvedValue({ revision: 2, ts: 2, hash: HASH, data: {} })
    mockedUseVersionedScreenSave.mockReturnValue({ onSave })

    const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date())
    const store: LegacyStore = {
      orders: [{ id: 'a', date: todayIso, status: 'חדשה', meals: 2 }],
      settings: { closedDates: [todayIso] },
    }
    mockedUseStore.mockReturnValue(queryResult(store))

    render(
      <MemoryRouter>
        <CalendarScreen />
      </MemoryRouter>,
    )

    expect(screen.getByText('סגור')).toBeTruthy()
    const toggle = screen.getByRole('button', { name: `פתיחת יום ${todayIso}` })
    expect(toggle).toBeTruthy()

    await userEvent.click(toggle)
    expect(onSave).toHaveBeenCalledOnce()
    const request = onSave.mock.calls[0][0]
    expect(request.reason).toBe('settings')
    expect(request.nextStore.settings?.closedDates).toEqual([])
  })

  it('shows a close button for an open date', async () => {
    const onSave = vi.fn().mockResolvedValue({ revision: 2, ts: 2, hash: HASH, data: {} })
    mockedUseVersionedScreenSave.mockReturnValue({ onSave })

    const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date())
    const store: LegacyStore = { orders: [], settings: { closedDates: [] } }
    mockedUseStore.mockReturnValue(queryResult(store))

    render(
      <MemoryRouter>
        <CalendarScreen />
      </MemoryRouter>,
    )

    const toggle = screen.getByRole('button', { name: `סגירת יום ${todayIso}` })
    expect(toggle).toBeTruthy()

    await userEvent.click(toggle)
    const request = onSave.mock.calls[0][0]
    expect(request.nextStore.settings?.closedDates).toEqual([todayIso])
  })
})
