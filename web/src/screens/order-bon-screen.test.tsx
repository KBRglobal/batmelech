// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_ROUTES } from '../app/routes.ts'
import { useStore } from '../data/use-store.ts'
import type { LegacyStore } from '../domain/store.ts'
import { bonPageRule, measureRollLengthMm } from '../services/bon-print.ts'
import { OrderBonScreen } from './order-bon-screen.tsx'

vi.mock('../data/use-store.ts', () => ({ useStore: vi.fn() }))
const mockedUseStore = vi.mocked(useStore)

function queryResult(options: {
  readonly pending?: boolean
  readonly error?: boolean
  readonly store?: LegacyStore
  readonly refetch?: ReturnType<typeof vi.fn>
} = {}): ReturnType<typeof useStore> {
  return {
    isPending: options.pending === true,
    isError: options.error === true,
    data: options.pending || options.error ? undefined : { ts: 1, data: options.store ?? { orders: [] } },
    refetch: options.refetch ?? vi.fn(),
  } as unknown as ReturnType<typeof useStore>
}

function renderBon(path = '/orders/live-1/bon') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={APP_ROUTES.orderBon} element={<OrderBonScreen />} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeEach(() => mockedUseStore.mockReset())

describe('OrderBonScreen', () => {
  it('renders loading and retryable error states', async () => {
    mockedUseStore.mockReturnValue(queryResult({ pending: true }))
    const pending = renderBon()
    expect(screen.getByText('טוענת את הבון')).toBeTruthy()
    pending.unmount()

    const refetch = vi.fn()
    mockedUseStore.mockReturnValue(queryResult({ error: true, refetch }))
    renderBon()
    await userEvent.setup().click(screen.getByRole('button', { name: 'ניסיון נוסף' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('renders every populated legacy order section and escapes customer content', () => {
    mockedUseStore.mockReturnValue(queryResult({
      store: {
        orders: [{
          id: 'live-1', date: '2099-08-14', name: '<script>לקוחה</script>', phone: '050-1234567',
          place: 'מלון אמיתי', address: 'קומה 7', time: '12:30', pickup: false,
          status: 'אושרה', group: 'משפחות לוי', meals: 2, aricha: 4, challot: 4,
          salads: { מטבוחה: { o: 2, p: 1 } }, firsts: { 'פילה מרוקאי': 2 }, heat: 'חריף',
          firstsNote: 'אחד בלי כוסברה', mains: { 'עוף ביתי': 1 }, mainsNote: 'לחתוך',
          sides: { 'קוסקוס עננים': 1 }, desserts: { סופלה: 2 },
          extras: { אורז: { q: 2, note: 'בקופסאות נפרדות' } },
          custom: [{ name: 'מנה מיוחדת', qty: 3, price: '12.50', note: 'ללא אגוזים' }],
          lunch: { 'schnitzel-plate': { q: 1, v: 'family', sides: { 'פסטה אדומה': 2 } } },
          notes: 'להתקשר בהגעה', total: '500.25', deposit: '100.25', payMethod: 'לינק', paid: 'מקדמה',
          hotelName: 'Stored Hotel', hotelAddress: 'Stored Address', navigationUrl: 'https://maps.example/saved',
        }],
      },
    }))
    const { container } = renderBon()

    const rows = [...container.querySelectorAll('.bm-bon-row')].map((row) => ({
      label: row.querySelector('dt')?.textContent ?? '',
      value: row.querySelector('dd')?.firstChild?.textContent ?? '',
      notes: [...row.querySelectorAll('.bm-bon-note')].map((note) => note.textContent),
    }))

    expect(rows.map((row) => row.label)).toEqual([
      'שם מלא:', 'טלפון:', 'לאן המשלוח:', 'קבוצה:', 'ארוחה זוגית:', 'עריכה:', 'חלות:',
      'סלטים:', 'מנה ראשונה:', 'מנה עיקרית:', 'תוספת:', 'קינוח:', 'אקסטרות:',
      'תפריט צהריים:', 'הערות:',
    ])
    expect(rows.map((row) => row.value)).toEqual([
      '<script>לקוחה</script>', '050-1234567', 'מלון אמיתי', 'משפחות לוי', '×2', '4 סועדים',
      '4 יחידות', 'מטבוחה ×2, מטבוחה — פינוק', 'פילה מרוקאי ×2', 'עוף ביתי', 'קוסקוס עננים',
      'סופלה ×2', 'אורז ×2 (בקופסאות נפרדות), מנה מיוחדת ×3 (12.50$) — ללא אגוזים',
      'שניצל בצלחת (משפחתית) ×1 — תוספות: פסטה אדומה ×2', 'להתקשר בהגעה',
    ])
    expect(rows[2]?.notes).toEqual(['שעת הגעה: 12:30', 'כתובת: קומה 7'])
    expect(rows[8]?.notes).toEqual(['חריפות הדג: חריף', 'אחד בלי כוסברה'])
    expect(rows[9]?.notes).toEqual(['לחתוך'])

    const bon = container.querySelector('.bm-order-bon')?.textContent ?? ''
    expect(container.querySelector('.bm-bon-date')?.textContent).toContain('14.08.2099')
    expect(container.querySelector('.bm-bon-total')?.textContent).toBe('סכום לתשלום: $500.25')
    expect(container.querySelector('.bm-bon-payment')?.textContent).toBe('מקדמה:100.25דרך תשלום:לינקשולם:מקדמה')
    expect(bon).toContain('אושרה')
    expect(container.querySelector('script')).toBeNull()
  })

  it('prints a kitchen strip with the allergen union and per-dish heating instructions', () => {
    mockedUseStore.mockReturnValue(queryResult({
      store: {
        orders: [{
          id: 'live-1', name: 'לקוחה',
          salads: { טחינה: { o: 1 } },
          mains: { 'קציצות בשר ברוטב אדום עשיר': 1 },
          extras: { 'אקסטרה עם אגוזים': { q: 2 } },
        }],
        menu: {
          salads: ['טחינה'],
          mains: ['קציצות בשר ברוטב אדום עשיר'],
          itemMeta: {
            'shabbat-salads-08': { allergens: 'סומסום' },
            'shabbat-mains-01': { allergens: 'גלוטן, סומסום', heatingInstructions: 'לחמם 20 דקות בתנור' },
          },
          extras: [{ name: 'אקסטרה עם אגוזים', price: 10, allergens: 'אגוזים', heatingInstructions: 'לחמם קלות' }],
        },
      } as LegacyStore,
    }))
    const { container } = renderBon()

    // The kitchen strip is part of the printable sheet and carries the roll
    // sizing hooks, so it prints exactly like the customer bon.
    const kitchen = container.querySelector('.bm-bon-sheet .bm-order-bon.bm-kitchen-bon')
    expect(kitchen).not.toBeNull()
    expect(kitchen?.querySelector('.bm-bon-allergens')?.textContent).toBe(
      'אלרגנים בהזמנה: סומסום, גלוטן, אגוזים',
    )
    const heatingRows = [...(kitchen?.querySelectorAll('.bm-bon-row') ?? [])].map((row) => ({
      label: row.querySelector('dt')?.textContent ?? '',
      value: row.querySelector('dd')?.textContent ?? '',
    }))
    expect(heatingRows).toEqual([
      { label: 'קציצות בשר ברוטב אדום עשיר:', value: 'חימום: לחמם 20 דקות בתנור' },
      { label: 'אקסטרה עם אגוזים:', value: 'חימום: לחמם קלות' },
    ])
  })

  it('prints no kitchen strip when no ordered dish has allergens or heating instructions', () => {
    mockedUseStore.mockReturnValue(queryResult({
      store: {
        orders: [{
          id: 'live-1', name: 'לקוחה',
          salads: { טחינה: { o: 1 } },
          mains: { 'קציצות בשר ברוטב אדום עשיר': 1 },
        }],
      },
    }))
    const { container } = renderBon()

    expect(container.querySelector('.bm-kitchen-bon')).toBeNull()
    expect(container.querySelector('.bm-bon-allergens')).toBeNull()
    expect(container.querySelector('.bm-order-bon')).not.toBeNull()
  })

  it('prints a stored amount it cannot parse verbatim rather than dropping it', () => {
    mockedUseStore.mockReturnValue(queryResult({
      store: { orders: [{ id: 'live-1', name: 'לקוחה', total: 'בערך 500 דולר' }] },
    }))
    const { container } = renderBon()
    expect(container.querySelector('.bm-bon-total')?.textContent).toBe('סכום לתשלום: בערך 500 דולר')
  })

  it('fails closed for malformed, missing, and duplicate IDs', () => {
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [{ id: 7 }, { id: '7' }] } }))
    const duplicate = renderBon('/orders/7/bon')
    expect(screen.getByText('מזהה ההזמנה אינו ייחודי')).toBeTruthy()
    expect(duplicate.container.querySelector('.bm-order-bon')).toBeNull()
    duplicate.unmount()

    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [{ id: '..' }] } }))
    renderBon('/orders/%2E%2E/bon')
    expect(screen.getByText('מזהה ההזמנה אינו תקין')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'הדפסת הבון' })).toBeNull()
  })

  it('renders a bon for a canonical colon ID', () => {
    mockedUseStore.mockReturnValue(queryResult({
      store: { orders: [{ id: 'order:1', name: 'לקוח קנוני' }] },
    }))

    const { container } = renderBon('/orders/order%3A1/bon')

    expect(container.querySelector('.bm-order-bon')?.textContent).toContain('לקוח קנוני')
    expect(screen.getByRole('button', { name: 'הדפסת הבון' })).toBeTruthy()
  })

  it('prints only after the explicit action and performs no data write', async () => {
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [{ id: 'live-1', name: 'לקוחה' }] } }))
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    renderBon()
    expect(print).not.toHaveBeenCalled()
    await userEvent.setup().click(screen.getByRole('button', { name: 'הדפסת הבון' }))
    expect(print).toHaveBeenCalledTimes(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('builds a QL-800 roll page of the measured length and a plain page otherwise', () => {
    // `size: 62mm auto` is not valid CSS and silently falls back to Letter, so
    // the roll length has to be a real number in the rule.
    expect(bonPageRule('roll', 161)).toBe('@page { size: 62mm 161mm; margin: 0; }')
    expect(bonPageRule('page', 161)).toBe('@page { size: auto; margin: 12mm; }')
    expect(measureRollLengthMm(null)).toBe(150)
    expect(measureRollLengthMm(document.createElement('article'))).toBe(150)
  })

  it('prints on the 62 mm roll by default and cleans the page rule up afterwards', async () => {
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [{ id: 'live-1', name: 'לקוחה' }] } }))
    vi.spyOn(window, 'print').mockImplementation(() => undefined)
    renderBon()

    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'גליל 62 מ"מ' }).checked).toBe(true)
    await userEvent.setup().click(screen.getByRole('button', { name: 'הדפסת הבון' }))

    expect(document.body.dataset.bmBonMedia).toBe('roll')
    expect(document.getElementById('bm-bon-page-rule')?.textContent).toContain('size: 62mm')
    fireEvent(window, new Event('afterprint'))
    expect(document.getElementById('bm-bon-page-rule')).toBeNull()
    expect(document.body.dataset.bmBonMedia).toBeUndefined()
  })

  it('switches the bon to a plain page when that media is chosen', async () => {
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [{ id: 'live-1', name: 'לקוחה' }] } }))
    vi.spyOn(window, 'print').mockImplementation(() => undefined)
    renderBon()
    const user = userEvent.setup()

    await user.click(screen.getByRole('radio', { name: 'דף רגיל' }))
    await user.click(screen.getByRole('button', { name: 'הדפסת הבון' }))

    expect(document.body.dataset.bmBonMedia).toBe('page')
    expect(document.getElementById('bm-bon-page-rule')?.textContent).toBe('@page { size: auto; margin: 12mm; }')
    fireEvent(window, new Event('afterprint'))

    // The choice is remembered for the next bon in the same printing round.
    cleanup()
    renderBon()
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'דף רגיל' }).checked).toBe(true)

    await user.click(screen.getByRole('radio', { name: 'גליל 62 מ"מ' }))
  })
})
