import { describe, expect, it } from 'vitest'
import {
  applySettingsToStore,
  createBackupArtifact,
  describeOrderingState,
  readSettingsDraft,
  reviewBackupText,
  toggleOrderingOpen,
  upcomingSundayDubai,
  validateSettingsDraft,
} from './settings-backup.ts'
import { DEFAULT_SETTINGS_CATALOG } from './settings-catalog.ts'
import type { LegacyStore } from './store.ts'

describe('settings backup domain', () => {
  it('exports every field exactly and uses the Dubai business date in the filename', () => {
    const store = {
      orders: [{ id: 'real-1', name: 'לקוחה', privateUnknown: { exact: ['value', 3] } }],
      settings: { maxMeals: 12, custom: true },
      unknownRoot: { nested: { preserved: null } },
    } as LegacyStore
    const snapshot = structuredClone(store)
    const artifact = createBackupArtifact(store, new Date('2026-08-11T20:30:00.000Z'))

    expect(artifact).toEqual({
      filename: 'batmelech-orders-2026-08-12.json',
      content: JSON.stringify(store, null, 2),
      mimeType: 'application/json',
    })
    expect(JSON.parse(artifact.content)).toEqual(snapshot)
    expect(store).toEqual(snapshot)
  })

  it('rejects empty, invalid JSON, wrong schemas, and duplicate numeric/string order IDs', () => {
    const current = { orders: [] } as LegacyStore

    expect(reviewBackupText(' ', current).status).toBe('empty')
    expect(reviewBackupText('{bad', current).status).toBe('invalid-json')
    expect(reviewBackupText('{"orders":{}}', current).status).toBe('wrong-schema')
    const duplicates = reviewBackupText('{"orders":[{"id":7},{"id":"7"}]}', current)
    expect(duplicates.status).toBe('wrong-schema')
    if (duplicates.status === 'wrong-schema') {
      expect(duplicates.issues).toEqual(['orders.1.id duplicates orders.0.id'])
    }
  })

  it('returns a review-only restore payload with the exact source and no mutation', () => {
    const current = { orders: [{ id: 'current' }], keep: 'current' } as LegacyStore
    const incoming = { orders: [{ id: 'incoming' }, { id: 'incoming-2' }], keep: 'incoming', extra: [1, 2] }
    const sourceText = JSON.stringify(incoming, null, 4)
    const snapshot = structuredClone(current)
    const review = reviewBackupText(sourceText, current)

    expect(review).toMatchObject({
      status: 'ready',
      currentOrderCount: 1,
      incomingOrderCount: 2,
      sourceText,
      incomingStore: incoming,
    })
    expect(current).toEqual(snapshot)
  })

  it('validates safe settings and preserves unknown settings plus stale stock names', () => {
    const store = {
      orders: [],
      settings: {
        maxMeals: 4,
        payLink: 'https://old.example',
        orderFormUrl: 'https://form.old.example',
        out: ['כרוב לבן קלאסי', 'מנה היסטורית שכבר לא בתפריט'],
        privateSetting: { keep: true },
      },
    } as LegacyStore
    const draft = readSettingsDraft(store, DEFAULT_SETTINGS_CATALOG)
    expect(draft.outOfStock).toEqual(['כרוב לבן קלאסי'])

    const nextDraft = {
      maxMeals: '20',
      paymentLink: ' https://pay.example/path ',
      customerOrderFormUrl: 'https://order.example',
      outOfStock: ['פילה דג ברוטב מרוקאי', 'פילה דג ברוטב מרוקאי'],
      businessName: '',
      trn: '',
      businessAddress: '',
      invoiceCurrency: 'AED' as const,
      orderingOpen: true,
      orderingClosedUntil: '',
      siteBanner: '',
      paymentRequestDetails: '',
      googleReviewUrl: '',
      minOrderAbuDhabi: '',
    }
    expect(validateSettingsDraft(nextDraft)).toMatchObject({ valid: true, maxMeals: 20 })
    const saved = applySettingsToStore(store, nextDraft, DEFAULT_SETTINGS_CATALOG)

    expect(saved.settings).toEqual({
      maxMeals: 20,
      payLink: 'https://pay.example/path',
      orderFormUrl: 'https://order.example',
      out: ['מנה היסטורית שכבר לא בתפריט', 'פילה דג ברוטב מרוקאי'],
      privateSetting: { keep: true },
      businessName: '',
      trn: '',
      businessAddress: '',
      invoiceCurrency: 'AED',
      orderingOpen: true,
      siteBanner: null,
      paymentRequestDetails: '',
      googleReviewUrl: '',
    })
  })

  it('preserves opaque legacy out-of-stock entries during unrelated settings edits', () => {
    const opaqueEntries = [
      { futureStockRule: { keep: true } },
      7,
      null,
      ['legacy', { nested: 'value' }],
    ]
    const store = {
      orders: [],
      settings: {
        maxMeals: 4,
        out: ['כרוב לבן קלאסי', ...opaqueEntries],
      },
    } as LegacyStore
    const snapshot = structuredClone(store)

    const saved = applySettingsToStore(
      store,
      {
        maxMeals: '5',
        paymentLink: '',
        customerOrderFormUrl: '',
        outOfStock: ['פילה דג ברוטב מרוקאי'],
        businessName: '',
        trn: '',
        businessAddress: '',
        invoiceCurrency: 'AED' as const,
        orderingOpen: true,
        orderingClosedUntil: '',
        siteBanner: '',
        paymentRequestDetails: '',
        googleReviewUrl: '',
        minOrderAbuDhabi: '',
      },
      DEFAULT_SETTINGS_CATALOG,
    )

    expect((saved.settings as { out: unknown[] }).out).toEqual([
      ...opaqueEntries,
      'פילה דג ברוטב מרוקאי',
    ])
    expect(store).toEqual(snapshot)
  })

  it('fails closed on invalid capacity and unsafe URL protocols', () => {
    const result = validateSettingsDraft({
      maxMeals: '-1',
      paymentLink: 'javascript:alert(1)',
      customerOrderFormUrl: 'not a url',
      outOfStock: [],
      businessName: '',
      trn: '',
      businessAddress: '',
      invoiceCurrency: 'AED',
      orderingOpen: true,
      orderingClosedUntil: '',
      siteBanner: '',
      paymentRequestDetails: '',
      googleReviewUrl: '',
      minOrderAbuDhabi: '',
    })

    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.issues).toHaveLength(3)
    expect(() =>
      applySettingsToStore(
        { orders: [] },
        {
          maxMeals: '1.5',
          paymentLink: '',
          customerOrderFormUrl: '',
          outOfStock: [],
          businessName: '',
          trn: '',
          businessAddress: '',
          invoiceCurrency: 'AED',
          orderingOpen: true,
          orderingClosedUntil: '',
          siteBanner: '',
          paymentRequestDetails: '',
          googleReviewUrl: '',
          minOrderAbuDhabi: '',
        },
        DEFAULT_SETTINGS_CATALOG,
      ),
    ).toThrow()
  })

  it('reads and saves the Abu Dhabi minimum order amount in USD minor units', () => {
    const store = {
      orders: [],
      settings: { minOrderAbuDhabiMinorUnits: 12_500 },
    } as LegacyStore
    const draft = readSettingsDraft(store, DEFAULT_SETTINGS_CATALOG)
    expect(draft.minOrderAbuDhabi).toBe('125.00')

    const empty = validateSettingsDraft({ ...draft, minOrderAbuDhabi: '' })
    expect(empty.valid).toBe(true)
    if (empty.valid) expect(empty.minOrderAbuDhabiMinorUnits).toBeUndefined()

    const invalid = validateSettingsDraft({ ...draft, minOrderAbuDhabi: '-5.00' })
    expect(invalid.valid).toBe(false)

    const saved = applySettingsToStore(
      { orders: [] },
      { ...draft, minOrderAbuDhabi: '120.50' },
      DEFAULT_SETTINGS_CATALOG,
    )
    expect(saved.settings?.minOrderAbuDhabiMinorUnits).toBe(12_050)

    const cleared = applySettingsToStore(
      saved,
      { ...draft, minOrderAbuDhabi: '' },
      DEFAULT_SETTINGS_CATALOG,
    )
    expect('minOrderAbuDhabiMinorUnits' in (cleared.settings as object)).toBe(false)
  })
})

describe('date-aware ordering close', () => {
  // 2026-08-09 is a Sunday; 08-14 is the Friday and 08-16 the Sunday after it.
  const wednesday = new Date('2026-08-12T08:00:00Z')
  const friday = new Date('2026-08-14T08:00:00Z')
  const nextSunday = new Date('2026-08-16T08:00:00Z')

  const draftOf = (store: LegacyStore, now: Date) =>
    readSettingsDraft(store, DEFAULT_SETTINGS_CATALOG, now)

  it('always closes to the next Sunday, including from Friday and from a Sunday', () => {
    expect(upcomingSundayDubai(wednesday)).toBe('2026-08-16')
    expect(upcomingSundayDubai(friday)).toBe('2026-08-16')
    expect(upcomingSundayDubai(nextSunday)).toBe('2026-08-23')
    // 21:00 UTC Saturday is already Sunday in Dubai.
    expect(upcomingSundayDubai(new Date('2026-08-15T21:00:00Z'))).toBe('2026-08-23')
  })

  it('reads a closed store as open again once its reopen day arrives', () => {
    const store = { orders: [], settings: { orderingOpen: false, orderingClosedUntil: '2026-08-16' } } as LegacyStore

    const whileClosed = draftOf(store, friday)
    expect(whileClosed.orderingOpen).toBe(false)
    expect(whileClosed.orderingClosedUntil).toBe('2026-08-16')
    expect(describeOrderingState(whileClosed)).toBe('האתר סגור להזמנות עד יום ראשון 16.08')

    const afterReopen = draftOf(store, nextSunday)
    expect(afterReopen.orderingOpen).toBe(true)
    expect(afterReopen.orderingClosedUntil).toBe('')
    expect(describeOrderingState(afterReopen)).toBe('האתר פתוח להזמנות')
  })

  it('closes for the coming Shabbat when the toggle flips, and clears the day when it opens', () => {
    const open = draftOf({ orders: [], settings: {} } as LegacyStore, wednesday)
    const closed = toggleOrderingOpen(open, wednesday)
    expect(closed).toMatchObject({ orderingOpen: false, orderingClosedUntil: '2026-08-16' })
    expect(toggleOrderingOpen(closed)).toMatchObject({ orderingOpen: true, orderingClosedUntil: '' })
  })

  it('saves the reopen day and preserves it across an unrelated settings edit', () => {
    const store = { orders: [], settings: { orderingOpen: false, orderingClosedUntil: '2026-08-16' } } as LegacyStore
    const draft = draftOf(store, friday)

    const untouched = applySettingsToStore(store, { ...draft, businessName: 'בת מלך' }, DEFAULT_SETTINGS_CATALOG, friday)
    expect(untouched.settings).toMatchObject({ orderingOpen: false, orderingClosedUntil: '2026-08-16' })

    const reopened = applySettingsToStore(store, toggleOrderingOpen(draft), DEFAULT_SETTINGS_CATALOG, friday)
    expect(reopened.settings).toMatchObject({ orderingOpen: true })
    expect('orderingClosedUntil' in (reopened.settings as object)).toBe(false)
  })

  it('gives an old boolean-only close a reopen day when it is saved', () => {
    const store = { orders: [], settings: { orderingOpen: false } } as LegacyStore
    const draft = draftOf(store, wednesday)
    expect(draft.orderingOpen).toBe(false)
    expect(draft.orderingClosedUntil).toBe('')
    expect(describeOrderingState(draft)).toBe('האתר סגור להזמנות')

    const saved = applySettingsToStore(store, draft, DEFAULT_SETTINGS_CATALOG, wednesday)
    expect(saved.settings).toMatchObject({ orderingOpen: false, orderingClosedUntil: '2026-08-16' })
  })
})
