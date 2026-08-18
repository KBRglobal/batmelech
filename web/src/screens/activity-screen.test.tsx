// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_ROUTES } from '../app/routes.ts'
import { useStore } from '../data/use-store.ts'
import type { LegacyStore } from '../domain/store.ts'
import { ActivityScreen } from './activity-screen.tsx'

vi.mock('../data/use-store.ts', () => ({ useStore: vi.fn() }))

const mockedUseStore = vi.mocked(useStore)
const HASH = 'a'.repeat(64)

// Fixed instants (UTC). Dubai is UTC+4, so 2099-08-14T08:00Z is 12:00 in
// Dubai and 2099-08-13T21:30Z is already 01:30 on the 14th in Dubai.
const DELIVERED_AT = Date.UTC(2099, 7, 14, 8, 0) // 14 Aug 2099, 12:00 Dubai
const PROOF_AT = Date.UTC(2099, 7, 14, 8, 5) // 14 Aug 2099, 12:05 Dubai
const MEY_AT = Date.UTC(2099, 7, 12, 6, 0) // 12 Aug 2099, 10:00 Dubai

function queryResult(
  options: {
    readonly pending?: boolean
    readonly error?: boolean
    readonly store?: LegacyStore | null
    readonly refetch?: ReturnType<typeof vi.fn>
  } = {},
): ReturnType<typeof useStore> {
  return {
    isPending: options.pending === true,
    isError: options.error === true,
    data:
      options.pending === true || options.error === true
        ? undefined
        : { revision: 1, ts: 1, hash: HASH, data: options.store ?? { orders: [] } },
    refetch: options.refetch ?? vi.fn(),
  } as unknown as ReturnType<typeof useStore>
}

function activityStore(): LegacyStore {
  return {
    orders: [
      {
        id: 'ord-delivered',
        name: 'שרה כהן',
        date: '2099-08-14',
        status: 'נמסרה',
        source: 'site',
        paid: 'כן',
        deliveredAt: DELIVERED_AT,
        deliveryProofAt: PROOF_AT,
      },
      {
        id: 'ord-open',
        name: 'דוד לוי',
        date: '2099-08-20',
        status: 'אושרה',
        source: 'mey-whatsapp',
        paid: 'לא',
      },
      {
        id: 'ord-undatable',
        name: 'רבקה מזרחי',
        date: 'מתישהו',
        status: 'חדשה',
      },
    ],
    settings: {
      meyAuditLog: [
        { id: 'aud1', at: MEY_AT, tool: 'update_order', summary: 'מיי עדכנה כתובת למשפחת לוי', undone: false },
        { id: 'aud2', at: MEY_AT + 60_000, tool: 'update_order', summary: 'מיי שינתה סטטוס בטעות', undone: true },
        { id: 'bad', summary: 'בלי זמן — לא אמור להופיע' },
      ],
    },
  }
}

function renderActivity() {
  return render(
    <MemoryRouter initialEntries={['/activity']}>
      <ActivityScreen />
    </MemoryRouter>,
  )
}

afterEach(cleanup)

beforeEach(() => {
  mockedUseStore.mockReset()
})

describe('ActivityScreen', () => {
  it('renders the shared loading state', () => {
    mockedUseStore.mockReturnValue(queryResult({ pending: true }))
    const { container } = renderActivity()

    expect(container.querySelector('[data-state="loading"]')).toBeTruthy()
    expect(screen.getByText('טוענת את יומן הפעילות')).toBeTruthy()
  })

  it('renders a retryable error without retrying automatically', async () => {
    const refetch = vi.fn()
    mockedUseStore.mockReturnValue(queryResult({ error: true, refetch }))
    const user = userEvent.setup()
    renderActivity()

    expect(refetch).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'ניסיון נוסף' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('shows a real empty state when there are no orders at all', () => {
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [] } }))
    renderActivity()

    expect(screen.getByText('אין עדיין פעילות')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'הזמנה חדשה' }).getAttribute('href')).toBe(
      APP_ROUTES.newOrder,
    )
  })

  it('shows timestamped events newest-first, grouped by Dubai day, with order links', () => {
    mockedUseStore.mockReturnValue(queryResult({ store: activityStore() }))
    renderActivity()

    // Real-timestamp events only on the timeline: delivery, proof, מיי.
    const titles = [
      'צורפה תמונת מסירה — שרה כהן',
      'ההזמנה של שרה כהן נמסרה',
      'מיי שינתה סטטוס בטעות',
      'מיי עדכנה כתובת למשפחת לוי',
    ]
    const positions = titles.map((title) => {
      const element = screen.getByText(title)
      expect(element).toBeTruthy()
      return element
    })
    // DOM order is newest first: proof (12:05) before delivered (12:00),
    // both before מיי's older entries from the 12th.
    for (let i = 1; i < positions.length; i += 1) {
      expect(
        positions[i - 1]!.compareDocumentPosition(positions[i]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    }

    // Two distinct day groups exist (14 Aug and 12 Aug 2099, Dubai time).
    const proofDay = screen.getByText('צורפה תמונת מסירה — שרה כהן').closest('section')!
    const meyDay = screen.getByText('מיי עדכנה כתובת למשפחת לוי').closest('section')!
    expect(proofDay).not.toBe(meyDay)
    expect(within(proofDay).getByText('ההזמנה של שרה כהן נמסרה')).toBeTruthy()

    // The audit entry with no timestamp never appears anywhere.
    expect(screen.queryByText('בלי זמן — לא אמור להופיע')).toBeNull()
    // An undone מיי entry is honestly marked.
    expect(screen.getByText('השינוי בוטל')).toBeTruthy()

    // Delivery events link to the order edit screen.
    const links = screen.getAllByRole('link', { name: /פתיחת ההזמנה של/ })
    expect(
      links.some((link) => link.getAttribute('href') === '/orders/ord-delivered/edit'),
    ).toBe(true)
  })

  it('is honest about orders without timestamps: they appear under the no-exact-time section by service date', () => {
    mockedUseStore.mockReturnValue(queryResult({ store: activityStore() }))
    renderActivity()

    const section = screen.getByText('ללא זמן מדויק').closest('section')!
    // Every order appears once here, source and payment stated plainly.
    expect(within(section).getByText('דוד לוי')).toBeTruthy()
    expect(within(section).getByText(/נקלטה דרך מיי בוואטסאפ · סטטוס: אושרה · לא שולם/)).toBeTruthy()
    expect(within(section).getByText(/נקלטה מהאתר · סטטוס: נמסרה · שולם/)).toBeTruthy()
    // A garbage service date is not silently parsed — the order is listed as dateless.
    const dateless = within(section).getByText('רבקה מזרחי').closest('li')!
    expect(within(dateless).getByText(/ללא תאריך/)).toBeTruthy()
    expect(within(dateless).getByText(/נרשמה בפאנל · סטטוס: חדשה · לא שולם/)).toBeTruthy()
    // Later service date (20th) is listed before the earlier one (14th).
    const david = within(section).getByText('דוד לוי')
    const sarah = within(section).getByText('שרה כהן')
    expect(david.compareDocumentPosition(sarah) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('filters the feed by category chips', async () => {
    mockedUseStore.mockReturnValue(queryResult({ store: activityStore() }))
    const user = userEvent.setup()
    renderActivity()

    // מיי filter: only audit entries; deliveries and the undated section hide.
    await user.click(screen.getByRole('button', { name: 'מיי' }))
    expect(screen.getByText('מיי עדכנה כתובת למשפחת לוי')).toBeTruthy()
    expect(screen.queryByText('ההזמנה של שרה כהן נמסרה')).toBeNull()
    expect(screen.queryByText('ללא זמן מדויק')).toBeNull()

    // משלוחים filter: delivery + proof events only.
    await user.click(screen.getByRole('button', { name: 'משלוחים' }))
    expect(screen.getByText('ההזמנה של שרה כהן נמסרה')).toBeTruthy()
    expect(screen.getByText('צורפה תמונת מסירה — שרה כהן')).toBeTruthy()
    expect(screen.queryByText('מיי עדכנה כתובת למשפחת לוי')).toBeNull()
    expect(screen.queryByText('ללא זמן מדויק')).toBeNull()

    // הזמנות filter: the undated orders section only.
    await user.click(screen.getByRole('button', { name: 'הזמנות' }))
    expect(screen.getByText('ללא זמן מדויק')).toBeTruthy()
    expect(screen.queryByText('ההזמנה של שרה כהן נמסרה')).toBeNull()
    expect(screen.queryByText('מיי עדכנה כתובת למשפחת לוי')).toBeNull()

    // Back to everything.
    await user.click(screen.getByRole('button', { name: 'הכל' }))
    expect(screen.getByText('ההזמנה של שרה כהן נמסרה')).toBeTruthy()
    expect(screen.getByText('ללא זמן מדויק')).toBeTruthy()
  })
})
