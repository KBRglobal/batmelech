import { describe, expect, it } from 'vitest'
import {
  applySettingsToStore,
  createBackupArtifact,
  readSettingsDraft,
  reviewBackupText,
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
      siteBanner: '',
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
        siteBanner: '',
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
      siteBanner: '',
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
          siteBanner: '',
        },
        DEFAULT_SETTINGS_CATALOG,
      ),
    ).toThrow()
  })
})
