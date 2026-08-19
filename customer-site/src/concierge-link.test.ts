import { describe, expect, it } from 'vitest'
import { WHATSAPP_MENTION, stripWhatsAppContact } from './components/concierge-chat'

describe('concierge WhatsApp handoff', () => {
  it('detects WhatsApp mentions in Hebrew, English and links', () => {
    expect(WHATSAPP_MENTION.test('אפשר לשאול בוואטסאפ')).toBe(true)
    expect(WHATSAPP_MENTION.test('ask us on WhatsApp')).toBe(true)
    expect(WHATSAPP_MENTION.test('https://wa.me/971586288776')).toBe(true)
    expect(WHATSAPP_MENTION.test('המשלוח לדובאי עולה $15')).toBe(false)
  })

  it('strips raw numbers and links so only clean text remains', () => {
    expect(
      stripWhatsAppContact('אם תרצי, אפשר לשאול בוואטסאפ: +971 58 628 8776.')
    ).toBe('אם תרצי, אפשר לשאול בוואטסאפ.')
    expect(stripWhatsAppContact('Ask on WhatsApp at https://wa.me/971586288776 anytime.')).toBe(
      'Ask on WhatsApp at anytime.'
    )
    expect(stripWhatsAppContact('וואטסאפ: 058-628-8776')).toBe('וואטסאפ')
  })

  it('leaves regular prices and numbers untouched', () => {
    expect(stripWhatsAppContact('משלוח לדובאי $15 ולאבו דאבי $55 בוואטסאפ')).toBe(
      'משלוח לדובאי $15 ולאבו דאבי $55 בוואטסאפ'
    )
  })
})
