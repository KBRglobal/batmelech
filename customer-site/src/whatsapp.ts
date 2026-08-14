import type { CartLine, CustomerDetails } from './cart-context'

export const WA_NUMBER = '971586288776'

export function buildOrderMessage(lines: CartLine[], customer: CustomerDetails, total: number) {
  const itemRows = lines.map((l) => `• ${l.name} x${l.qty} — $${l.unitPrice * l.qty}${l.note ? ` (${l.note})` : ''}`)
  const rows = [
    'הזמנה חדשה מהאתר — מטעמי בת מלך',
    '',
    ...itemRows,
    '',
    `סה"כ: $${total}`,
    '',
    `שם: ${customer.name || '-'}`,
    `טלפון: ${customer.phone ? `${customer.phoneCode}${customer.phone}` : '-'}`,
    customer.email ? `אימייל: ${customer.email}` : undefined,
    customer.fulfillment === 'pickup' ? 'איסוף עצמי' : `כתובת למשלוח: ${customer.address || '-'}`,
    customer.notes ? `הערות: ${customer.notes}` : undefined,
  ].filter(Boolean)
  return rows.join('\n')
}

export function waLink(text: string) {
  return `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(text)}`
}
