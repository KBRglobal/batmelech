import type { CartLine, CustomerDetails } from './cart-context'

export const WA_NUMBER = '971586288776'

/** The hotel the customer picked, or null when they typed a free address. */
export function selectedHotel(customer: CustomerDetails) {
  return customer.fulfillment === 'delivery' && customer.addressMode === 'hotel' ? customer.hotel : null
}

/** Hotel name plus room details, or the free address — what the driver needs. */
export function deliveryAddressText(customer: CustomerDetails) {
  const hotel = selectedHotel(customer)
  if (!hotel) return customer.address || '-'
  return [hotel.name, customer.address].filter(Boolean).join(' — ')
}

export function buildOrderMessage(lines: CartLine[], customer: CustomerDetails, total: number) {
  const hotel = selectedHotel(customer)
  const itemRows = lines.map((l) => `• ${l.name} x${l.qty} — $${l.unitPrice * l.qty}${l.note ? ` (${l.note})` : ''}`)
  const rows = [
    'הזמנה חדשה מהאתר — מטעמי בת מלך',
    '',
    ...itemRows,
    '',
    `סה"כ: $${total} USD`,
    '',
    `שם: ${customer.name || '-'}`,
    `טלפון: ${customer.phone ? `${customer.phoneCode}${customer.phone}` : '-'}`,
    `תאריך מבוקש: ${customer.date || '-'}`,
    `שעה מבוקשת: ${customer.time || '-'}`,
    customer.email ? `אימייל: ${customer.email}` : undefined,
    customer.fulfillment === 'pickup' ? 'איסוף עצמי' : `כתובת למשלוח: ${deliveryAddressText(customer)}`,
    hotel ? `כתובת המלון: ${hotel.fullAddress}` : undefined,
    customer.notes ? `הערות: ${customer.notes}` : undefined,
  ].filter(Boolean)
  return rows.join('\n')
}

export function waLink(text: string) {
  return `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(text)}`
}
