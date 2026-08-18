import { describe, expect, it } from 'vitest'
import {
  BATMELECH_SITE_URL,
  PAYMENT_DETAILS_PLACEHOLDER,
  buildDepositRequestMessage,
  buildOutreachWhatsAppHref,
  buildReorderInviteMessage,
  buildReviewRequestMessage,
  depositRequestHref,
  formatOutreachDate,
  isAwaitingPayment,
  isDelivered,
  outreachAmountMinorUnits,
  reorderInviteHref,
  reviewRequestHref,
  summarizeOrderItems,
} from './outreach-messages.ts'
import type { LegacyOrder } from './store.ts'

const REVIEW_URL = 'https://g.page/r/batmelech/review'

function decodeMessage(href: string): string {
  const text = new URL(href).searchParams.get('text')
  expect(text).not.toBeNull()
  return text!
}

describe('outreach message templates', () => {
  it('asks for payment with the customer, the day, the amount and the saved details', () => {
    const message = buildDepositRequestMessage({
      customerName: 'שרה',
      orderDateLabel: 'יום שישי 14.08',
      amountLabel: '$120.00',
      paymentRequestDetails: 'ביט למספר 050-1234567',
    })

    expect(message).toBe(
      [
        'היי שרה, כאן בת מלך.',
        'ההזמנה שלך ליום שישי 14.08 רשומה אצלנו ומחכה.',
        'נשאר להסדיר תשלום של $120.00.',
        'אפשר להעביר כך: ביט למספר 050-1234567',
        'תודה רבה, ושבת שלום.',
      ].join('\n'),
    )
  })

  it('leaves a visible placeholder when the payment details were never filled in', () => {
    const message = buildDepositRequestMessage({
      customerName: '',
      orderDateLabel: '',
      amountLabel: '$40.00',
      paymentRequestDetails: '   ',
    })

    expect(message).toContain(`אפשר להעביר כך: ${PAYMENT_DETAILS_PLACEHOLDER}`)
    expect(message.startsWith('היי, כאן בת מלך.')).toBe(true)
    expect(message).toContain('ההזמנה שלך רשומה אצלנו ומחכה.')
  })

  it('puts the exact review link in the thank-you message', () => {
    const message = buildReviewRequestMessage({ customerName: 'רחל', googleReviewUrl: REVIEW_URL })

    expect(message).toBe(
      [
        'היי רחל, כאן בת מלך.',
        'תודה רבה שהזמנת אצלנו, מקווים שנהניתם.',
        'אם בא לך לשמח אותנו, ביקורת קטנה בגוגל עוזרת לנו מאוד:',
        REVIEW_URL,
        'תודה מכל הלב.',
      ].join('\n'),
    )
  })

  it('lists the previous order and invites a repeat through the customer site', () => {
    const message = buildReorderInviteMessage({
      customerName: 'מיכל',
      orderDateLabel: 'יום שישי 07.08',
      items: [
        { name: 'ארוחה זוגית', quantity: 2 },
        { name: 'מטבוחה', quantity: 1 },
      ],
    })

    expect(message).toBe(
      [
        'היי מיכל, כאן בת מלך.',
        'בפעם הקודמת, יום שישי 07.08, הזמנת:',
        '· ארוחה זוגית ×2',
        '· מטבוחה ×1',
        'רוצים לחזור על זה לשבת הקרובה?',
        `אפשר להזמין כאן: ${BATMELECH_SITE_URL}`,
      ].join('\n'),
    )
  })
})

describe('outreach order reading', () => {
  it('formats a real service date as a Hebrew weekday and drops anything else', () => {
    expect(formatOutreachDate('2099-08-14')).toBe('יום שישי 14.08')
    expect(formatOutreachDate('2099-02-30')).toBe('')
    expect(formatOutreachDate('לא תאריך')).toBe('')
    expect(formatOutreachDate(undefined)).toBe('')
  })

  it('asks for the agreed deposit when there is one, otherwise the whole total', () => {
    expect(outreachAmountMinorUnits({ total: '120.50', deposit: '40' })).toBe(4_000)
    expect(outreachAmountMinorUnits({ total: '120.50' })).toBe(12_050)
    expect(outreachAmountMinorUnits({ total: '120.50', deposit: '0' })).toBe(12_050)
    expect(outreachAmountMinorUnits({ total: '1,2,3' })).toBeNull()
    expect(outreachAmountMinorUnits({})).toBeNull()
  })

  it('offers a payment request only for an unpaid order that carries an amount', () => {
    expect(isAwaitingPayment({ total: '100' })).toBe(true)
    expect(isAwaitingPayment({ total: '100', paid: 'לא' })).toBe(true)
    expect(isAwaitingPayment({ total: '100', paid: 'כן' })).toBe(false)
    expect(isAwaitingPayment({ total: '100', paid: 'מקדמה' })).toBe(false)
    expect(isAwaitingPayment({ paid: 'לא' })).toBe(false)
  })

  it('recognizes only a delivered order for the review request', () => {
    expect(isDelivered({ status: 'נמסרה' })).toBe(true)
    expect(isDelivered({ status: 'מוכנה' })).toBe(false)
    expect(isDelivered({})).toBe(false)
  })

  it('summarizes the biggest lines of an order and ignores unsafe quantities', () => {
    const order: LegacyOrder = {
      meals: 2,
      salads: { מטבוחה: { o: 5, p: 1 }, 'חציל בטחינה': { o: 0, p: 3 }, סלק: { o: '1' } },
      mains: { 'פילה דג': 3 },
      extras: { משלוח: { q: 1 }, שבור: { q: -4 } },
      custom: [{ name: 'עוגה', qty: 4 }, { name: '', qty: 9 }, 'not an object'],
      challot: 'לא מספר',
    }

    expect(summarizeOrderItems(order)).toEqual([
      { name: 'מטבוחה', quantity: 5 },
      { name: 'עוגה', quantity: 4 },
      { name: 'פילה דג', quantity: 3 },
      { name: 'ארוחה זוגית', quantity: 2 },
    ])
    expect(summarizeOrderItems(order, 2)).toEqual([
      { name: 'מטבוחה', quantity: 5 },
      { name: 'עוגה', quantity: 4 },
    ])
    expect(summarizeOrderItems({})).toEqual([])
  })
})

describe('outreach WhatsApp links', () => {
  it('normalizes the phone exactly like the orders screen and encodes the message once', () => {
    const href = buildOutreachWhatsAppHref('050-123-4567', 'שלום & שלום')

    expect(href).toBe('https://wa.me/972501234567?text=%D7%A9%D7%9C%D7%95%D7%9D%20%26%20%D7%A9%D7%9C%D7%95%D7%9D')
    expect(decodeMessage(href!)).toBe('שלום & שלום')
    expect(buildOutreachWhatsAppHref('+971 50 765 4321', 'היי')).toMatch(/^https:\/\/wa\.me\/971507654321\?text=/)
  })

  it('produces no link at all for an unusable phone or an empty message', () => {
    expect(buildOutreachWhatsAppHref('12', 'היי')).toBeNull()
    expect(buildOutreachWhatsAppHref('', 'היי')).toBeNull()
    expect(buildOutreachWhatsAppHref('0501234567', '   ')).toBeNull()
  })

  it('builds the deposit link from the saved order and the settings text', () => {
    const order: LegacyOrder = { name: 'שרה', date: '2099-08-14', total: '120.50', deposit: '40' }

    const href = depositRequestHref(order, '0501234567', 'ביט 050-1234567')

    expect(href).toMatch(/^https:\/\/wa\.me\/972501234567\?text=/)
    expect(decodeMessage(href!)).toBe(
      [
        'היי שרה, כאן בת מלך.',
        'ההזמנה שלך ליום שישי 14.08 רשומה אצלנו ומחכה.',
        'נשאר להסדיר תשלום של $40.00.',
        'אפשר להעביר כך: ביט 050-1234567',
        'תודה רבה, ושבת שלום.',
      ].join('\n'),
    )
    expect(depositRequestHref({ name: 'שרה' }, '0501234567', '')).toBeNull()
  })

  it('refuses a review link that is not a real http address', () => {
    const order: LegacyOrder = { name: 'רחל', status: 'נמסרה' }

    expect(decodeMessage(reviewRequestHref(order, '0501234567', REVIEW_URL)!)).toContain(REVIEW_URL)
    expect(reviewRequestHref(order, '0501234567', 'javascript:alert(1)')).toBeNull()
    expect(reviewRequestHref(order, '0501234567', '')).toBeNull()
  })

  it('builds a reorder link only when the previous order actually had items', () => {
    const order: LegacyOrder = { name: 'מיכל', date: '2026-08-07', meals: 2 }

    expect(decodeMessage(reorderInviteHref(order, '0501234567')!)).toBe(
      [
        'היי מיכל, כאן בת מלך.',
        'בפעם הקודמת, יום שישי 07.08, הזמנת:',
        '· ארוחה זוגית ×2',
        'רוצים לחזור על זה לשבת הקרובה?',
        `אפשר להזמין כאן: ${BATMELECH_SITE_URL}`,
      ].join('\n'),
    )
    expect(reorderInviteHref({ name: 'מיכל', date: '2026-08-07' }, '0501234567')).toBeNull()
    expect(reorderInviteHref(order, 'לא טלפון')).toBeNull()
  })
})
