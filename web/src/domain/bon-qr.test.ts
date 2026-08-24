import { describe, expect, it } from 'vitest'
import { bonQrTargets, orderFormQrTarget, paymentQrTarget } from './bon-qr.ts'
import type { LegacyOrder, LegacyStore } from './store.ts'

function storeWith(settings: Record<string, unknown>): LegacyStore {
  return { settings } as unknown as LegacyStore
}

function orderWith(fields: Record<string, unknown>): LegacyOrder {
  return { id: 'ord-1', ...fields } as unknown as LegacyOrder
}

const LINKS = { orderFormUrl: 'https://batmelech.ae/', payLink: 'https://pay.ziina.com/batmelech' }

describe('orderFormQrTarget', () => {
  it('returns the settings link', () => {
    expect(orderFormQrTarget(storeWith(LINKS))).toBe('https://batmelech.ae/')
  })

  it('trims surrounding whitespace', () => {
    expect(orderFormQrTarget(storeWith({ orderFormUrl: '  https://batmelech.ae/  ' }))).toBe('https://batmelech.ae/')
  })

  it('rejects a missing, empty, or non-http link', () => {
    expect(orderFormQrTarget(storeWith({}))).toBeNull()
    expect(orderFormQrTarget(storeWith({ orderFormUrl: '' }))).toBeNull()
    expect(orderFormQrTarget(storeWith({ orderFormUrl: 'javascript:alert(1)' }))).toBeNull()
    expect(orderFormQrTarget(storeWith({ orderFormUrl: 'not a url' }))).toBeNull()
    expect(orderFormQrTarget({} as unknown as LegacyStore)).toBeNull()
  })
})

describe('paymentQrTarget', () => {
  it('returns the settings payment link', () => {
    expect(paymentQrTarget(storeWith(LINKS))).toBe('https://pay.ziina.com/batmelech')
  })

  it('rejects a non-http payment link', () => {
    expect(paymentQrTarget(storeWith({ payLink: 'ftp://x' }))).toBeNull()
  })
})

describe('bonQrTargets', () => {
  it('carries both targets for an unpaid order', () => {
    expect(bonQrTargets(orderWith({ paid: 'לא' }), storeWith(LINKS))).toEqual({
      orderForm: 'https://batmelech.ae/',
      payment: 'https://pay.ziina.com/batmelech',
    })
  })

  it('drops the payment QR once the order is paid', () => {
    expect(bonQrTargets(orderWith({ paid: 'כן' }), storeWith(LINKS)).payment).toBeNull()
  })

  it('treats a missing paid field as unpaid', () => {
    expect(bonQrTargets(orderWith({}), storeWith(LINKS)).payment).toBe('https://pay.ziina.com/batmelech')
  })

  it('never invents targets when settings hold no links', () => {
    expect(bonQrTargets(orderWith({}), storeWith({}))).toEqual({ orderForm: null, payment: null })
  })
})
