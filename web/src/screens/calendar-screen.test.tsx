// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../data/use-store.ts'
import useVersionedScreenSave from '../data/versioned-screen-save.tsx'
import type { LegacyStore } from '../domain/store.ts'
import {
  buildCalendarMonth,
  calendarCapacity,
  CalendarScreen,
  summarizeCalendarDays,
} from './calendar-screen.tsx'

vi.mock('../data/use-store.ts', () => ({ useStore: vi.fn() }))
vi.mock('../data/versioned-screen-save.tsx', () => ({ default: vi.fn() }))
const mockedUseStore = vi.mocked(useStore)
const mockedUseVersionedScreenSave = vi.mocked(useVersionedScreenSave)
const HASH = 'a'.repeat(64)

function queryResult(options: {
  readonly pending?: boolean
  readonly error?: boolean
  readonly store?: LegacyStore | null
} = {}): ReturnType<typeof useStore> {
  return {
    isPending: options.pending === true,
    isError: options.error === true,
    data: options.pending || options.error
      ? undefined
      : { revision: 1, ts: 1, hash: HASH, data: options.store ?? { orders: [] } },
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
  mockedUseVersionedScreenSave.mockReturnValue({ onSave: vi.fn() })
})

describe('calendar domain helpers', () => {
  it('sums orders and couple meals per valid date, skipping cancelled and invalid rows', () => {
    const days = summarizeCalendarDays({
      orders: [
        { id: 'a', date: '2026-08-21', status: 'חדשה', meals: 2 },
        { id: 'b', date: '2026-08-21', status: 'אושרה', meals: '3' },
        { id: 'c', date: '2026-08-21', status: 'בוטלה', meals: 5 },
        { id: 'd', date: 'not-a-date', status: 'חדשה', meals: 1 },
        { id: 'e', date: '2026-08-28', status: 'חדשה', meals: -4 },
      ],
    })
    expect(days.get('2026-08-21')).toEqual({ iso: '2026-08-21', orderCount: 2, meals: 5 })
    expect(days.get('2026-08-28')).toEqual({ iso: '2026-08-28', orderCount: 1, meals: 0 })
    expect(days.size).toBe(2)
  })

  it('reads a positive capacity and rejects zero, negative, or malformed values', () => {
    expect(calendarCapacity({ orders: [], settings: { maxMeals: 15 } })).toBe(15)
    expect(calendarCapacity({ orders: [], settings: { maxMeals: '12' } })).toBe(12)
    expect(calendarCapacity({ orders: [], settings: { maxMeals: 0 } })).toBeNull()
    expect(calendarCapacity({ orders: [], settings: { maxMeals: 'lots' } })).toBeNull()
    expect(calendarCapacity({ orders: [] })).toBeNull()
  })

  it('builds a Sunday-first month grid with correct blanks and full weeks', () => {
    // August 2026 starts on a Saturday and has 31 days.
    const month = buildCalendarMonth(2026, 8)
    expect(month.weeks[0]!.slice(0, 6)).toEqual([null, null, null, null, null, null])
    expect(month.weeks[0]![6]).toBe('2026-08-01')
    expect(month.weeks.every((week) => week.length === 7)).toBe(true)
    expect(month.weeks.flat().filter((iso) => iso !== null)).toHaveLength(31)
    expect(month.weeks.flat().at(-7)).toBe('2026-08-30')
  })
})

describe('CalendarScreen', () => {
  it('renders loading and error states', () => {
    mockedUseStore.mockReturnValue(queryResult({ pending: true }))
    const loading = render(<MemoryRouter><CalendarScreen /></MemoryRouter>)
    expect(screen.getByText('טוענת את לוח השנה')).toBeTruthy()
    loading.unmount()

    mockedUseStore.mockReturnValue(queryResult({ error: true }))
    render(<MemoryRouter><CalendarScreen /></MemoryRouter>)
    expect(screen.getByText('לא הצלחנו לטעון את לוח השנה')).toBeTruthy()
  })

  it('shows day summaries as links to that day of preparation', () => {
    const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date())
    mockedUseStore.mockReturnValue(queryResult({
      store: {
        orders: [{ id: 'a', date: todayIso, status: 'חדשה', meals: 2 }],
        settings: { maxMeals: 15 },
      },
    }))
    render(<MemoryRouter><CalendarScreen /></MemoryRouter>)
    expect(screen.getByText('1 הזמנות')).toBeTruthy()
    expect(screen.getByText('2/15 זוגיות')).toBeTruthy()
    const link = screen.getByRole('link', { name: `פתיחת ההכנות של ${todayIso}` })
    expect(link.getAttribute('href')).toBe(`/preparation?date=${todayIso}`)
  })
})
