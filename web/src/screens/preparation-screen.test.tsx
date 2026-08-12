// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfirmedStoreSaveHandler } from '../data/versioned-screen-save.tsx'
import { useStore } from '../data/use-store.ts'
import type { PreparationCatalog } from '../domain/preparation.ts'
import type { LegacyStore } from '../domain/store.ts'
import type { VersionedStateEnvelope } from '../services/state-api.ts'
import { PreparationScreen } from './preparation-screen.tsx'

vi.mock('../data/use-store.ts', () => ({ useStore: vi.fn() }))
const mockedUseStore = vi.mocked(useStore)
const HASH = 'b'.repeat(64)

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
  readonly revision?: number
} = {}): ReturnType<typeof useStore> {
  return {
    isPending: options.pending === true,
    isError: options.error === true,
    data: options.pending || options.error ? undefined : {
      revision: options.revision ?? 1,
      ts: options.revision ?? 1,
      hash: HASH,
      data: options.store ?? { orders: [] },
    },
    refetch: options.refetch ?? vi.fn(),
  } as unknown as ReturnType<typeof useStore>
}

function renderPreparation(path = '/preparation', onSave?: ConfirmedStoreSaveHandler) {
  return render(<MemoryRouter initialEntries={[path]}><PreparationScreen onSave={onSave} /></MemoryRouter>)
}

function confirmedEnvelope(data: LegacyStore, revision = 2): VersionedStateEnvelope {
  return { revision, ts: revision, hash: HASH, data }
}

function successfulSave() {
  let revision = 1
  return vi.fn<ConfirmedStoreSaveHandler>().mockImplementation(async ({ nextStore }) => {
    revision += 1
    return confirmedEnvelope(nextStore, revision)
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
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
    const labelsLink = screen.getByRole('link', { name: 'מדבקות הכנה' })
    expect(labelsLink.getAttribute('href')).toBe('/preparation/labels')
    expect(labelsLink.querySelector('[aria-hidden="true"]')?.getAttribute('style')).toContain(
      'ph-package-bold.svg',
    )
    expect(screen.getByRole('button', { name: 'סימון הושלם לא זמין' }).hasAttribute('disabled')).toBe(true)

    await userEvent.setup().selectOptions(screen.getByLabelText('תאריך הכנה'), '2099-08-15')
    expect(screen.getByRole('heading', { level: 2, name: 'יום שבת, 15.08.2099' })).toBeTruthy()
    expect(screen.getAllByText('$50.00').length).toBeGreaterThan(0)
    expect(screen.queryByText('מטבוחה אמיתית')).toBeNull()
  })

  it('sends only sanitized aggregates for advisory AI and never invokes the save path', async () => {
    const privateValues = [
      'PRIVATE CUSTOMER',
      '+971500000000',
      'PRIVATE HOTEL ADDRESS',
      'PRIVATE CUSTOMER NOTE',
      'PRIVATE DISH NAME',
    ]
    const catalog: PreparationCatalog = {
      items: [{
        id: 'private-main-id',
        category: 'mains',
        name: privateValues[4]!,
        procurement: { kind: 'recipe' },
      }],
      lunchItems: [],
    }
    const store = {
      orders: [{
        id: 'private-order-id',
        date: '2099-08-14',
        name: privateValues[0],
        phone: privateValues[1],
        address: privateValues[2],
        notes: privateValues[3],
        mains: { [privateValues[4]!]: 3 },
      }],
      preparationCatalog: catalog,
    } as LegacyStore
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      review: {
        reviewOnly: true,
        overview: 'נמצאה נקודה תפעולית שמקורה בנתונים המצטברים.',
        findings: [{
          kind: 'unusual_quantity',
          priority: 'medium',
          sourceIds: ['demand-1'],
          explanation: 'הדפוס המצטבר שונה מהקבוצה המקבילה ודורש תשומת לב אנושית.',
        }],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const onSave = successfulSave()
    mockedUseStore.mockReturnValue(queryResult({ store }))
    renderPreparation('/preparation?date=2099-08-14', onSave)

    await userEvent.setup().click(screen.getByRole('button', { name: 'קבלת ייעוץ' }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/ai/operations-review/')
    expect(request.method).toBe('POST')
    const bodyText = String(request.body)
    const body = JSON.parse(bodyText)
    expect(body).toEqual({
      snapshot: {
        scope: 'preparation',
        selectedServiceDate: '2099-08-14',
        demands: [{
          id: 'demand-1',
          source: 'preparation',
          serviceDate: '2099-08-14',
          category: 'mains',
          quantity: '3',
          procurementKind: 'recipe',
          comparisonGroup: 'group-1',
        }],
        warnings: [],
      },
    })
    for (const privateValue of privateValues) expect(bodyText).not.toContain(privateValue)
    expect(bodyText).not.toContain('private-order-id')
    expect(bodyText).not.toContain('customerName')
    expect(bodyText).not.toContain('notes')
    expect(onSave).not.toHaveBeenCalled()
    expect(await screen.findByText(/הדפוס המצטבר שונה/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /החל|שמור|בצע/ })).toBeNull()
  })

  it('uses the effective default catalog when no preparation catalog was persisted and performs no read-time write', () => {
    const onSave = successfulSave()
    mockedUseStore.mockReturnValue(queryResult({
      store: {
        orders: [{
          id: 'default-catalog', date: '2099-08-14', name: 'לקוחה', sides: { 'אורז לבן': 3 },
        }],
      },
    }))
    renderPreparation('/preparation', onSave)

    expect(screen.getByText('אורז לבן')).toBeTruthy()
    expect(screen.queryByText('קטלוג ההכנה עדיין לא נשמר')).toBeNull()
    expect(screen.queryByText(/אינו מחובר לקטלוג ההכנה/)).toBeNull()
    expect(onSave).not.toHaveBeenCalled()
  })

  it.each([
    ['empty', { items: [], lunchItems: [] }],
    ['partial', { items: [] }],
  ])('completes a valid %s persisted catalog from the effective default menu', (_label, preparationCatalog) => {
    mockedUseStore.mockReturnValue(queryResult({
      store: {
        orders: [{ id: 'completed-catalog', date: '2099-08-14', mains: { 'תבשיל עוף מרוקאי עם חומוסים': 2 } }],
        preparationCatalog,
      } as LegacyStore,
    }))
    renderPreparation()

    expect(screen.getByText('תבשיל עוף מרוקאי עם חומוסים')).toBeTruthy()
    expect(screen.queryByText(/אינו מחובר לקטלוג ההכנה/)).toBeNull()
    expect(screen.queryByText('קטלוג ההכנה השמור אינו תקין')).toBeNull()
  })

  it('collapses repeated unknown catalog warnings by exact item without hiding other validation warnings', () => {
    mockedUseStore.mockReturnValue(queryResult({
      store: {
        orders: [
          {
            id: 'custom-a-1',
            date: '2099-08-14',
            meals: 'not-a-count',
            custom: [{ name: 'מנה סודית', qty: 1 }],
          },
          { id: 'custom-a-2', date: '2099-08-14', custom: [{ name: 'מנה סודית', qty: 2 }] },
          { id: 'custom-b', date: '2099-08-14', custom: [{ name: 'מנה אחרת', qty: 1 }] },
        ],
      } as LegacyStore,
    }))
    renderPreparation()

    expect(screen.getAllByText(/הפריט מנה סודית.*2 הופעות/)).toHaveLength(1)
    expect(screen.getAllByText(/הפריט מנה אחרת.*הופעה אחת/)).toHaveLength(1)
    expect(screen.getAllByText('כמות לא תקינה בשדה meals.')).toHaveLength(1)
    const settingsLinks = screen.getAllByRole('link', { name: 'להוספה בהגדרות' })
    expect(settingsLinks).toHaveLength(2)
    settingsLinks.forEach((link) => expect(link.getAttribute('href')).toBe('/settings/recipes'))
  })

  it('flags an invalid persisted catalog while using the safe authoritative projection', () => {
    mockedUseStore.mockReturnValue(queryResult({
      store: {
        orders: [{ id: 'invalid-catalog', date: '2099-08-14', sides: { 'אורז לבן': 2 } }],
        preparationCatalog: { items: 'not-an-array', lunchItems: [] },
      } as unknown as LegacyStore,
    }))
    renderPreparation()

    expect(screen.getByText('קטלוג ההכנה השמור אינו תקין')).toBeTruthy()
    expect(screen.getByText('אורז לבן')).toBeTruthy()
    expect(screen.queryByText(/הפריט אורז לבן אינו מחובר/)).toBeNull()
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

  it('persists and reloads one legacy-compatible completion key without touching another date', async () => {
    const store = {
      orders: [{
        id: 'prep-order',
        date: '2099-08-14',
        name: 'לקוחה',
        mains: { 'עיקרית אמיתית': 2 },
      }],
      preparationCatalog: CATALOG,
      prepDone: {
        '2099-08-13': { 'mains|יום קודם': true },
        '2099-08-14': { 'future|opaque': { keep: true } },
      },
      unknownStoreField: { keep: ['exact'] },
    } as unknown as LegacyStore
    const onSave = successfulSave()
    mockedUseStore.mockReturnValue(queryResult({ store }))
    const user = userEvent.setup()
    const first = renderPreparation('/preparation?date=2099-08-14', onSave)

    expect(onSave).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'סיום הכנת עיקרית אמיתית' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    const firstRequest = onSave.mock.calls[0]![0]
    expect(firstRequest.reason).toBe('preparation')
    expect(firstRequest.baseStore).toBe(store)
    expect(firstRequest.nextStore.prepDone).toEqual({
      '2099-08-13': { 'mains|יום קודם': true },
      '2099-08-14': { 'future|opaque': { keep: true }, 'mains|עיקרית אמיתית': true },
    })
    expect((firstRequest.nextStore as Record<string, unknown>).unknownStoreField).toEqual({ keep: ['exact'] })
    expect(screen.getByRole('button', { name: 'פתיחת הכנת עיקרית אמיתית' })).toBeTruthy()
    expect(screen.getByText('סומן כהושלם.')).toBeTruthy()

    first.unmount()
    onSave.mockClear()
    mockedUseStore.mockReturnValue(queryResult({ store: firstRequest.nextStore, revision: 2 }))
    renderPreparation('/preparation?date=2099-08-14', onSave)
    expect(screen.getByRole('button', { name: 'פתיחת הכנת עיקרית אמיתית' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'פתיחת הכנת עיקרית אמיתית' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0]![0].nextStore.prepDone).toEqual({
      '2099-08-13': { 'mains|יום קודם': true },
      '2099-08-14': { 'future|opaque': { keep: true } },
    })
    expect(screen.getByText('הסימון נפתח מחדש.')).toBeTruthy()
  })

  it('retains an unsuccessful completion and reports the conflict', async () => {
    const onSave = vi.fn<ConfirmedStoreSaveHandler>().mockRejectedValue(new Error('conflict'))
    mockedUseStore.mockReturnValue(queryResult({
      store: {
        orders: [{ id: 'prep-conflict', date: '2099-08-14', mains: { 'עיקרית אמיתית': 1 } }],
        preparationCatalog: CATALOG,
      } as LegacyStore,
    }))
    renderPreparation('/preparation?date=2099-08-14', onSave)

    await userEvent.setup().click(screen.getByRole('button', { name: 'סיום הכנת עיקרית אמיתית' }))

    expect(screen.getByRole('alert').textContent).toContain('השמירה נכשלה או התנגשה')
    expect(screen.getByRole('button', { name: 'סיום הכנת עיקרית אמיתית' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('adopts merged server preparation data and allows a second guarded completion write', async () => {
    const store = {
      orders: [{
        id: 'prep-merge',
        date: '2099-08-14',
        mains: { 'עיקרית אמיתית': 1 },
      }],
      preparationCatalog: CATALOG,
    } as LegacyStore
    let mergedStore: LegacyStore | null = null
    const onSave = vi.fn<ConfirmedStoreSaveHandler>()
      .mockImplementationOnce(async ({ nextStore }) => {
        mergedStore = {
          ...nextStore,
          remoteOnly: { keep: true },
          orders: [
            ...nextStore.orders,
            {
              id: 'prep-remote',
              date: '2099-08-14',
              mains: { 'עיקרית אמיתית': 3 },
            },
          ],
        }
        return confirmedEnvelope(mergedStore, 2)
      })
      .mockImplementationOnce(async ({ nextStore }) => confirmedEnvelope(nextStore, 3))
    mockedUseStore.mockReturnValue(queryResult({ store, revision: 1 }))
    const view = renderPreparation('/preparation?date=2099-08-14', onSave)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'סיום הכנת עיקרית אמיתית' }))

    const itemRow = screen.getByText('עיקרית אמיתית').closest('li')
    expect(itemRow).not.toBeNull()
    expect(within(itemRow!).getByText('4')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'פתיחת הכנת עיקרית אמיתית' }).hasAttribute('disabled')).toBe(true)

    mockedUseStore.mockReturnValue(queryResult({ store: mergedStore!, revision: 2 }))
    view.rerender(
      <MemoryRouter initialEntries={['/preparation?date=2099-08-14']}>
        <PreparationScreen onSave={onSave} />
      </MemoryRouter>,
    )

    const reopenButton = screen.getByRole('button', { name: 'פתיחת הכנת עיקרית אמיתית' })
    expect(reopenButton.hasAttribute('disabled')).toBe(false)
    await user.click(reopenButton)

    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onSave.mock.calls[1]![0].baseStore).toEqual(mergedStore)
    expect(onSave.mock.calls[1]![0].nextStore.orders).toHaveLength(2)
    expect((onSave.mock.calls[1]![0].nextStore as Record<string, unknown>).remoteOnly).toEqual({ keep: true })
    expect(onSave.mock.calls[1]![0].nextStore.prepDone?.['2099-08-14']).toEqual({})
  })

  it('rejects a background state change with zero operational write', async () => {
    const store = {
      orders: [{ id: 'prep-drift', date: '2099-08-14', mains: { 'עיקרית אמיתית': 1 } }],
      preparationCatalog: CATALOG,
    } as LegacyStore
    const onSave = successfulSave()
    mockedUseStore.mockReturnValue(queryResult({ store, revision: 1 }))
    const view = renderPreparation('/preparation?date=2099-08-14', onSave)
    mockedUseStore.mockReturnValue(queryResult({
      store: { ...store, remoteUnknown: true },
      revision: 2,
    }))
    view.rerender(
      <MemoryRouter initialEntries={['/preparation?date=2099-08-14']}>
        <PreparationScreen onSave={onSave} />
      </MemoryRouter>,
    )

    await userEvent.setup().click(screen.getByRole('button', { name: 'סיום הכנת עיקרית אמיתית' }))

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('הנתונים השתנו')
  })
})
