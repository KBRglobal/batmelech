// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../data/use-store.ts'
import type { LegacyStore } from '../domain/store.ts'
import { LabelsScreen } from './labels-screen.tsx'

vi.mock('../data/use-store.ts', () => ({ useStore: vi.fn() }))
const mockedUseStore = vi.mocked(useStore)

function queryResult(options: { readonly pending?: boolean; readonly error?: boolean; readonly store?: LegacyStore; readonly refetch?: ReturnType<typeof vi.fn> } = {}): ReturnType<typeof useStore> {
  return {
    isPending: options.pending === true,
    isError: options.error === true,
    data: options.pending || options.error ? undefined : { ts: 1, data: options.store ?? { orders: [] } },
    refetch: options.refetch ?? vi.fn(),
  } as unknown as ReturnType<typeof useStore>
}

function renderLabels(path = '/preparation/labels?date=2099-08-14') {
  return render(<MemoryRouter initialEntries={[path]}><LabelsScreen /></MemoryRouter>)
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete document.body.dataset.bmPrintKind
})
beforeEach(() => mockedUseStore.mockReset())

describe('LabelsScreen', () => {
  it('renders loading, retryable error, and empty states', async () => {
    mockedUseStore.mockReturnValue(queryResult({ pending: true }))
    const pending = renderLabels()
    expect(screen.getByText('טוענת את המדבקות')).toBeTruthy()
    pending.unmount()

    const refetch = vi.fn()
    mockedUseStore.mockReturnValue(queryResult({ error: true, refetch }))
    const failed = renderLabels()
    await userEvent.setup().click(screen.getByRole('button', { name: 'ניסיון נוסף' }))
    expect(refetch).toHaveBeenCalledTimes(1)
    failed.unmount()

    mockedUseStore.mockReturnValue(queryResult())
    renderLabels()
    expect(screen.getByText('אין הזמנות למדבקות')).toBeTruthy()
  })

  it('uses deterministic 62 by 29 mm QL-800 print CSS and exact legacy bag content', () => {
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [{
      id: 'label-css', date: '2099-08-14', name: 'לקוחה אמיתית', phone: '050-0000000',
      place: 'מלון אמיתי', time: '13:00', address: 'קבלה ראשית', meals: 1,
    }] } }))
    const { container } = renderLabels()
    const css = container.querySelector('style')?.textContent ?? ''
    expect(css).toContain('@page bm-ql800 { size:62mm 29mm; margin:0; }')
    expect(css).toContain('width:62mm; height:29mm')
    expect(css).toContain('page-break-after:always')
    const bag = container.querySelector('[data-label-kind="bag"]')?.textContent ?? ''
    for (const text of ['מטעמי בת מלך', 'מטבח ביתי אותנטי · כשר', 'לקוחה אמיתית', 'מלון אמיתי · 13:00', 'קבלה ראשית', 'טלפון: 050-0000000', 'לשמור בקירור עד החימום · חימום בכלי מכוסה', 'הוכן בתאריך']) expect(bag).toContain(text)
  })

  it('creates preparation labels only from stored quantities, including gifts, extras, custom rows, and lunch', () => {
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [{
      id: 'label-full', date: '2099-08-14', name: 'לקוח מלא', group: 'קבוצה', meals: 1, aricha: 2, challot: 2,
      salads: { מטבוחה: { o: 2, p: 1 } }, firsts: { 'דג מרוקאי': 1 }, heat: 'חריף', firstsNote: 'בלי כוסברה',
      mains: { עוף: 1 }, mainsNote: 'לחתוך', sides: { אורז: 1 }, desserts: { סופלה: 2 },
      extras: { יין: { q: 1, note: 'קר' } }, custom: [{ name: 'מיוחד', qty: 2, price: 8, note: 'ללא אגוזים' }],
      lunch: { 'schnitzel-plate': { q: 1, v: 'family', sides: { 'פסטה אדומה': 2 }, addon: 1 } }, notes: 'הערה כללית',
    }] } }))
    const { container } = renderLabels()
    const preparationLabels = [...container.querySelectorAll('[data-label-kind="preparation"]')]
    const preparationText = preparationLabels.map((node) => node.textContent).join('\n')
    expect(preparationLabels).toHaveLength(20)
    expect(container.querySelectorAll('[data-preparation-item="ערכת שולחן"]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-preparation-item="סופלה"]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-preparation-item="מיוחד"]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-preparation-item="שניצל בצלחת (משפחתית) — פסטה אדומה"]')).toHaveLength(2)
    for (const value of ['ארוחה זוגית', 'ערכת שולחן', 'חלות', 'מטבוחה', 'מטבוחה — פינוק', 'דג מרוקאי', 'חריפות: חריף', 'בלי כוסברה', 'עוף', 'לחתוך', 'אורז', 'סופלה', 'יין', 'קר', 'מיוחד', 'מחיר יחידה: 8$', 'ללא אגוזים', 'שניצל בצלחת (משפחתית)', 'תוספות: פסטה אדומה ×2', 'מנת מפרום ביתי ×1', 'הערה כללית']) expect(preparationText).toContain(value)
    expect(preparationText).toContain('יחידה 2 מתוך 2 · כמות בהזמנה: 2')
    expect(preparationText).not.toContain('מנה שלא נשמרה')
  })

  it('starts with one physical preparation label per whole stored portion and lets the operator adjust copies', async () => {
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [{
      id: 'prep-copy-control', date: '2099-08-14', name: 'לקוח הכנה', mains: { מנה: 3 },
    }] } }))
    const { container } = renderLabels()
    const user = userEvent.setup()
    expect(container.querySelectorAll('[data-label-kind="preparation"]')).toHaveLength(3)
    expect(container.querySelectorAll('[data-label-kind="bag"]')).toHaveLength(1)
    expect(screen.getByLabelText('כמות מדבקות הכנה מנה עבור לקוח הכנה').textContent).toBe('3')

    await user.click(screen.getByRole('button', { name: 'הפחתת מדבקת הכנה מנה עבור לקוח הכנה' }))
    expect(container.querySelectorAll('[data-label-kind="preparation"]')).toHaveLength(2)
    expect(screen.getByLabelText('כמות מדבקות הכנה מנה עבור לקוח הכנה').textContent).toBe('2')
    expect(container.querySelectorAll('[data-label-kind="bag"]')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'הוספת מדבקת הכנה מנה עבור לקוח הכנה' }))
    expect(container.querySelectorAll('[data-label-kind="preparation"]')).toHaveLength(3)
  })

  it('fails closed for fractional, malformed, negative, and overflowing preparation quantities', () => {
    const malformedQuantities: readonly unknown[] = [1.5, '1.5', -1, 501, Number.MAX_SAFE_INTEGER]
    for (const [index, value] of malformedQuantities.entries()) {
      mockedUseStore.mockReturnValue(queryResult({ store: { orders: [{
        id: `malformed-quantity-${index}`, date: '2099-08-14', name: 'כמות לא תקינה', meals: value,
      } as unknown as LegacyStore['orders'][number]] } }))
      const rendered = renderLabels()
      expect(screen.getByText('אי אפשר ליצור מדבקות הכנה בבטחה')).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'הדפסת מדבקות הכנה' })).toBeNull()
      expect(rendered.container.querySelector('[data-label-kind="preparation"]')).toBeNull()
      rendered.unmount()
    }
  })

  it('keeps independent bag-copy counts, clamps at zero, and refuses an empty print with feedback', async () => {
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [{ id: 'copy-a', date: '2099-08-14', name: 'אלף' }, { id: 'copy-b', date: '2099-08-14', name: 'בית' }] } }))
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    const { container } = renderLabels()
    const user = userEvent.setup()
    expect(container.querySelectorAll('[data-label-kind="bag"]')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'הוספת מדבקה לאלף' }))
    expect(screen.getByLabelText('כמות מדבקות לאלף').textContent).toBe('2')
    expect(screen.getByLabelText('כמות מדבקות לבית').textContent).toBe('1')
    expect(container.querySelectorAll('[data-label-kind="bag"]')).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: 'הפחתת מדבקה לאלף' }))
    await user.click(screen.getByRole('button', { name: 'הפחתת מדבקה לאלף' }))
    await user.click(screen.getByRole('button', { name: 'הפחתת מדבקה לאלף' }))
    await user.click(screen.getByRole('button', { name: 'הפחתת מדבקה לבית' }))
    expect(screen.getByLabelText('כמות מדבקות לאלף').textContent).toBe('0')
    expect(container.querySelectorAll('[data-label-kind="bag"]')).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'הדפסת מדבקות לשקיות' }))
    expect(screen.getByRole('alert').textContent).toContain('כל הכמויות על 0')
    expect(print).not.toHaveBeenCalled()
  })

  it('prints bag and preparation sheets in isolation and performs no data write', async () => {
    vi.useFakeTimers()
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [{ id: 'print-only', date: '2099-08-14', name: 'מדפיסה', meals: 1 }] } }))
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    renderLabels()
    fireEvent.click(screen.getByRole('button', { name: 'הדפסת מדבקות לשקיות' }))
    expect(document.body.dataset.bmPrintKind).toBe('bag')
    expect(print).toHaveBeenCalledTimes(1)
    fireEvent(window, new Event('afterprint'))
    expect(document.body.dataset.bmPrintKind).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: 'הדפסת מדבקות הכנה' }))
    expect(document.body.dataset.bmPrintKind).toBe('preparation')
    expect(print).toHaveBeenCalledTimes(2)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fails closed when scoped order identities are malformed or duplicated', () => {
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [{ id: 9, date: '2099-08-14' }, { id: '9', date: '2099-08-14' }] } }))
    renderLabels()
    expect(screen.getByText('אי אפשר לזהות בבטחה את כל ההזמנות')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'הדפסת מדבקות לשקיות' })).toBeNull()
  })
})
