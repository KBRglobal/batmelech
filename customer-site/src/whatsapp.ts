import { DELIVERY_ZONE_LABELS, type CartLine, type CustomerDetails } from './cart-context'

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

/**
 * @param deliveryFeeUsd the fee inside `total` — 0 means Dubai delivery is
 *   included by a Shabbat package; omitted keeps the message without a fee row.
 */
export function buildOrderMessage(lines: CartLine[], customer: CustomerDetails, total: number, deliveryFeeUsd?: number) {
  const hotel = selectedHotel(customer)
  const itemRows = lines.map((l) => `• ${l.name} x${l.qty} — $${l.unitPrice * l.qty}${l.note ? ` (${l.note})` : ''}`)
  const feeRow =
    deliveryFeeUsd === undefined || customer.fulfillment === 'pickup'
      ? undefined
      : `• משלוח (${DELIVERY_ZONE_LABELS[customer.zone]}) — ${deliveryFeeUsd === 0 ? 'כלול' : `$${deliveryFeeUsd}`}`
  const rows = [
    'הזמנה חדשה מהאתר — מטעמי בת מלך',
    '',
    ...itemRows,
    feeRow,
    '',
    `סה"כ: $${total} USD`,
    '',
    `שם: ${customer.name || '-'}`,
    `טלפון: ${customer.phone ? `${customer.phoneCode}${customer.phone}` : '-'}`,
    `תאריך מבוקש: ${customer.date || '-'}`,
    `שעה מבוקשת: ${customer.time || '-'}`,
    customer.email ? `אימייל: ${customer.email}` : undefined,
    customer.fulfillment === 'pickup'
      ? 'איסוף עצמי'
      : `כתובת למשלוח (${DELIVERY_ZONE_LABELS[customer.zone]}): ${deliveryAddressText(customer)}`,
    hotel ? `כתובת המלון: ${hotel.fullAddress}` : undefined,
    customer.notes ? `הערות: ${customer.notes}` : undefined,
  ].filter(Boolean)
  return rows.join('\n')
}

export function waLink(text: string) {
  return `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(text)}`
}
