import { useEffect, useState, type ReactNode } from 'react'
import { Icon } from '@iconify/react'
import { Link } from 'react-router'
import { CurrencyNote } from '../components/currency-note'
import { PageHero } from '../components/page-hero'
import { Footer } from '../components/footer'
import { DELIVERY_FEES_USD, useCart, type CartLine, type CustomerDetails, type DeliveryZone, type SelectedHotel } from '../cart-context'
import { useSiteStatus } from '../site-status-context'
import { buildOrderMessage, deliveryAddressText, selectedHotel, waLink } from '../whatsapp'
import { useLocale, type Locale } from '../locale-context'
import { dishName } from '../dish-names'

const HOTEL_SEARCH_DEBOUNCE_MS = 300
const HOTEL_QUERY_MIN_LENGTH = 2
const HOTEL_QUERY_MAX_LENGTH = 100
const INPUT_CLASS =
  'w-full p-5 rounded-2xl bg-white border border-[#EDB2C1]/30 focus:ring-2 focus:ring-[#F5A83A] outline-none font-bold'
// Submitted phone codes never change; only the country labels are localized.
const PHONE_CODES = ['+971', '+972', '+1', '+44'] as const
const CHECKOUT_HERO_IMAGE =
  'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/L5fzK0kRQ4N.jpeg'

// Localized copy. Hebrew is the source of truth; English is written for an
// American Jewish audience and French for a French Jewish audience — native
// copy, never word-by-word (always Shabbat/Chabbat, never weekday names). Submitted
// values (zones, phone codes, order lines) are never localized.
const HE = {
  emptyTitle: ['הסל שלכם', 'ריק'] as [string, string],
  heroImageAlt: 'מטעמי בת מלך - מטבח ביתי כשר בדובאי',
  emptyWeekdaysCta: 'לתפריט יום חול',
  emptyShabbatCta: 'או להרכבת מארז שבת',
  heroTitle: ['סיכום', 'הזמנה'] as [string, string],
  itemsTitle: 'פריטים בהזמנה',
  remove: 'הסר',
  itemsSubtotal: 'סיכום פריטים',
  pickupLine: 'איסוף עצמי',
  deliveryLine: 'משלוח',
  freeOfCharge: 'ללא עלות',
  totalDue: 'סה"כ לתשלום',
  fulfillmentTitle: 'איך תרצו לקבל את ההזמנה',
  delivery: 'משלוח',
  pickupFree: 'איסוף עצמי (ללא עלות)',
  zones: { dubai: 'דובאי', 'abu-dhabi': 'אבו דאבי' } as Record<DeliveryZone, string>,
  fullNameLabel: 'שם מלא',
  fullNamePlaceholder: 'ישראל ישראלי',
  phoneLabel: 'מספר טלפון',
  phonePlaceholder: '50 000 0000',
  phoneCountries: {
    '+971': 'איחוד האמירויות',
    '+972': 'ישראל',
    '+1': 'ארה"ב / קנדה',
    '+44': 'בריטניה',
  } as Record<(typeof PHONE_CODES)[number], string>,
  pickupDateLabel: 'תאריך איסוף',
  deliveryDateLabel: 'תאריך משלוח',
  pickupTimeLabel: 'שעת איסוף',
  deliveryTimeLabel: 'שעת משלוח',
  emailLabel: 'אימייל (לקבלת חשבונית)',
  destinationLabel: 'לאן מגיע המשלוח',
  hotelOption: 'מלון',
  otherAddressOption: 'כתובת אחרת',
  hotelNameLabel: 'שם המלון',
  roomLabel: 'מספר חדר, הערות לכתובת',
  roomPlaceholder: 'חדר 402, לובי, קומה 12...',
  fullAddressLabel: 'כתובת מלאה',
  fullAddressPlaceholder: 'רחוב, בניין, מספר דירה, אזור...',
  kitchenNotesLabel: 'הערות למטבח',
  kitchenNotesPlaceholder: 'בלי חריף, אקסטרה מטבוחה...',
  infoWhatsApp: 'לאחר לחיצה על "אישור ושליחה", ההזמנה תיפתח כהודעת וואטסאפ מוכנה אל בת מלך לאישור סופי.',
  infoPayment: 'אין תשלום באתר. התשלום מסתדר ישירות מול בת מלך בוואטסאפ — מזומן במסירה, העברה בנקאית, ביט או פייבוקס.',
  phoneBlockedError: 'מספר הטלפון הזה אינו יכול לבצע הזמנות כרגע. נשמח לעזור בוואטסאפ.',
  submitCta: 'אישור ושליחת הזמנה',
  hintClosed: 'האתר לא מקבל הזמנות כרגע',
  hintShabbatClosed: 'המטבח שלנו שומר שבת — לא מקבלים הזמנות כרגע',
  hintPickup: 'מלאו שם, טלפון, תאריך ושעה כדי לשלוח',
  hintHotel: 'מלאו שם, טלפון, תאריך ושעה, ובחרו מלון כדי לשלוח',
  hintAddress: 'מלאו שם, טלפון, תאריך, שעה וכתובת כדי לשלוח',
  hotelSearchPlaceholder: 'התחילו להקליד שם מלון...',
  hotelSearching: 'מחפשים מלונות...',
  hotelEmpty: 'לא מצאנו מלון בשם הזה. אפשר לעבור ל"כתובת אחרת" ולכתוב את הכתובת המלאה.',
  hotelError: 'חיפוש המלונות לא זמין כרגע. אפשר לעבור ל"כתובת אחרת" ולכתוב את הכתובת המלאה.',
  hotelClearAria: 'ביטול בחירת המלון',
  // Delivery time windows: shown only when the kitchen configured windows for
  // the chosen date; otherwise the free time field stays.
  windowRemaining: (remaining: number) => (remaining === 1 ? 'נותר מקום אחרון' : `נותרו ${remaining}`),
  windowFull: 'מלא',
  // WhatsApp handoff message. Hebrew keeps the original wording; en/fr are
  // written in the customer's language while each dish line carries the
  // canonical Hebrew name in parentheses so the kitchen always understands.
  waHeader: 'הזמנה חדשה מהאתר — מטעמי בת מלך',
  waTotal: 'סה"כ',
  waName: 'שם',
  waPhone: 'טלפון',
  waDate: 'תאריך מבוקש',
  waTime: 'שעה מבוקשת',
  waEmail: 'אימייל',
  waPickup: 'איסוף עצמי',
  waDeliveryAddress: 'כתובת למשלוח',
  waHotelAddress: 'כתובת המלון',
  waNotes: 'הערות',
}

export const COPY: Record<Locale, typeof HE> = {
  he: HE,
  en: {
    emptyTitle: ['Your Basket', 'Is Empty'],
    heroImageAlt: 'Bat Melech — kosher home kitchen in Dubai',
    emptyWeekdaysCta: 'Browse the weekday menu',
    emptyShabbatCta: 'or build your Shabbat package',
    heroTitle: ['Order', 'Summary'],
    itemsTitle: 'Items in your order',
    remove: 'Remove',
    itemsSubtotal: 'Subtotal',
    pickupLine: 'Pickup',
    deliveryLine: 'Delivery',
    freeOfCharge: 'Free',
    totalDue: 'Total due',
    fulfillmentTitle: 'How would you like to receive your order?',
    delivery: 'Delivery',
    pickupFree: 'Pickup (free)',
    zones: { dubai: 'Dubai', 'abu-dhabi': 'Abu Dhabi' },
    fullNameLabel: 'Full name',
    fullNamePlaceholder: 'Your name',
    phoneLabel: 'Phone number',
    phonePlaceholder: '50 000 0000',
    phoneCountries: {
      '+971': 'UAE',
      '+972': 'Israel',
      '+1': 'US / Canada',
      '+44': 'UK',
    },
    pickupDateLabel: 'Pickup date',
    deliveryDateLabel: 'Delivery date',
    pickupTimeLabel: 'Pickup time',
    deliveryTimeLabel: 'Delivery time',
    emailLabel: 'Email (for your invoice)',
    destinationLabel: 'Where should we deliver?',
    hotelOption: 'Hotel',
    otherAddressOption: 'Other address',
    hotelNameLabel: 'Hotel name',
    roomLabel: 'Room number, delivery notes',
    roomPlaceholder: 'Room 402, lobby, 12th floor...',
    fullAddressLabel: 'Full address',
    fullAddressPlaceholder: 'Street, building, apartment, area...',
    kitchenNotesLabel: 'Notes for the kitchen',
    kitchenNotesPlaceholder: 'No spicy, extra matbucha...',
    infoWhatsApp: 'When you tap "Confirm & Send", your order opens as a ready-made WhatsApp message to Bat Melech for final confirmation.',
    infoPayment: 'No payment is taken on the site. Payment is arranged directly with Bat Melech on WhatsApp — cash on delivery, bank transfer, Bit, or PayBox.',
    phoneBlockedError: 'This phone number cannot place orders right now. We would be happy to help on WhatsApp.',
    submitCta: 'Confirm & Send Order',
    hintClosed: 'We are not taking orders right now',
    hintShabbatClosed: 'We keep Shabbat — we are not taking orders right now',
    hintPickup: 'Fill in your name, phone, date, and time to send',
    hintHotel: 'Fill in your name, phone, date, and time, and choose a hotel to send',
    hintAddress: 'Fill in your name, phone, date, time, and address to send',
    hotelSearchPlaceholder: 'Start typing a hotel name...',
    hotelSearching: 'Searching hotels...',
    hotelEmpty: 'We could not find a hotel by that name. You can switch to "Other address" and type the full address.',
    hotelError: 'Hotel search is unavailable right now. You can switch to "Other address" and type the full address.',
    hotelClearAria: 'Clear hotel selection',
    windowRemaining: (remaining: number) => (remaining === 1 ? 'Last spot left' : `${remaining} left`),
    windowFull: 'Full',
    waHeader: 'New order from the website — Bat Melech',
    waTotal: 'Total',
    waName: 'Name',
    waPhone: 'Phone',
    waDate: 'Requested date',
    waTime: 'Requested time',
    waEmail: 'Email',
    waPickup: 'Pickup',
    waDeliveryAddress: 'Delivery address',
    waHotelAddress: 'Hotel address',
    waNotes: 'Notes',
  },
  fr: {
    emptyTitle: ['Votre panier', 'est vide'],
    heroImageAlt: 'Bat Melech — cuisine familiale casher à Dubaï',
    emptyWeekdaysCta: 'Voir le menu de semaine',
    emptyShabbatCta: 'ou composez votre coffret de Chabbat',
    heroTitle: ['Récapitulatif', 'de commande'],
    itemsTitle: 'Articles de votre commande',
    remove: 'Retirer',
    itemsSubtotal: 'Sous-total',
    pickupLine: 'Retrait sur place',
    deliveryLine: 'Livraison',
    freeOfCharge: 'Gratuit',
    totalDue: 'Total à payer',
    fulfillmentTitle: 'Comment souhaitez-vous recevoir votre commande ?',
    delivery: 'Livraison',
    pickupFree: 'Retrait sur place (gratuit)',
    zones: { dubai: 'Dubaï', 'abu-dhabi': 'Abou Dhabi' },
    fullNameLabel: 'Nom complet',
    fullNamePlaceholder: 'Votre nom',
    phoneLabel: 'Numéro de téléphone',
    phonePlaceholder: '50 000 0000',
    phoneCountries: {
      '+971': 'Émirats arabes unis',
      '+972': 'Israël',
      '+1': 'États-Unis / Canada',
      '+44': 'Royaume-Uni',
    },
    pickupDateLabel: 'Date de retrait',
    deliveryDateLabel: 'Date de livraison',
    pickupTimeLabel: 'Heure de retrait',
    deliveryTimeLabel: 'Heure de livraison',
    emailLabel: 'E-mail (pour recevoir la facture)',
    destinationLabel: 'Où livrons-nous ?',
    hotelOption: 'Hôtel',
    otherAddressOption: 'Autre adresse',
    hotelNameLabel: 'Nom de l\'hôtel',
    roomLabel: 'Numéro de chambre, précisions',
    roomPlaceholder: 'Chambre 402, lobby, 12e étage...',
    fullAddressLabel: 'Adresse complète',
    fullAddressPlaceholder: 'Rue, immeuble, appartement, quartier...',
    kitchenNotesLabel: 'Remarques pour la cuisine',
    kitchenNotesPlaceholder: 'Sans piment, extra matboukha...',
    infoWhatsApp: 'Après avoir appuyé sur « Confirmer et envoyer », votre commande s\'ouvrira sous forme de message WhatsApp prêt à envoyer à Bat Melech pour confirmation finale.',
    infoPayment: 'Aucun paiement sur le site. Le règlement se fait directement avec Bat Melech sur WhatsApp — espèces à la livraison, virement bancaire, Bit ou PayBox.',
    phoneBlockedError: 'Ce numéro de téléphone ne peut pas passer de commande pour le moment. Nous serons ravis de vous aider sur WhatsApp.',
    submitCta: 'Confirmer et envoyer la commande',
    hintClosed: 'Le site ne prend pas de commandes pour le moment',
    hintShabbatClosed: 'Nous gardons le Shabbat — le site ne prend pas de commandes pour le moment',
    hintPickup: 'Renseignez votre nom, téléphone, date et heure pour envoyer',
    hintHotel: 'Renseignez votre nom, téléphone, date et heure, et choisissez un hôtel pour envoyer',
    hintAddress: 'Renseignez votre nom, téléphone, date, heure et adresse pour envoyer',
    hotelSearchPlaceholder: 'Commencez à saisir le nom d\'un hôtel...',
    hotelSearching: 'Recherche des hôtels...',
    hotelEmpty: 'Nous n\'avons pas trouvé d\'hôtel à ce nom. Vous pouvez passer à « Autre adresse » et saisir l\'adresse complète.',
    hotelError: 'La recherche d\'hôtels est indisponible pour le moment. Vous pouvez passer à « Autre adresse » et saisir l\'adresse complète.',
    hotelClearAria: 'Annuler la sélection de l\'hôtel',
    windowRemaining: (remaining: number) => (remaining === 1 ? 'Dernière place restante' : `${remaining} restants`),
    windowFull: 'Complet',
    waHeader: 'Nouvelle commande depuis le site — Bat Melech',
    waTotal: 'Total',
    waName: 'Nom',
    waPhone: 'Téléphone',
    waDate: 'Date souhaitée',
    waTime: 'Heure souhaitée',
    waEmail: 'E-mail',
    waPickup: 'Retrait sur place',
    waDeliveryAddress: 'Adresse de livraison',
    waHotelAddress: 'Adresse de l\'hôtel',
    waNotes: 'Remarques',
  },
}

function dubaiToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date())
}

// --- delivery time windows ----------------------------------------------------
// When the kitchen configured windows, the free time input becomes window
// buttons with live remaining capacity. Any failure (fetch, malformed page)
// falls back to the free time field — availability must never block a purchase.

interface DeliveryWindow {
  readonly key: string
  readonly start: string
  readonly end: string
  readonly remaining: number
}

const WINDOW_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
const MAX_WINDOWS = 20

function parseDeliveryWindows(value: unknown): DeliveryWindow[] | null {
  if (!value || typeof value !== 'object') return null
  const windows = (value as { windows?: unknown }).windows
  if (!Array.isArray(windows) || windows.length > MAX_WINDOWS) return null
  const parsed: DeliveryWindow[] = []
  for (const row of windows) {
    if (!row || typeof row !== 'object') return null
    const { key, start, end, remaining } = row as Record<string, unknown>
    if (typeof key !== 'string' || key.length === 0 || key.length > 64) return null
    if (typeof start !== 'string' || !WINDOW_TIME_PATTERN.test(start)) return null
    if (typeof end !== 'string' || !WINDOW_TIME_PATTERN.test(end)) return null
    if (typeof remaining !== 'number' || !Number.isInteger(remaining) || remaining < 0) return null
    parsed.push({ key, start, end, remaining })
  }
  return parsed
}

// The en/fr WhatsApp handoff: written in the customer's language, but every
// dish line keeps the canonical Hebrew name in parentheses so the kitchen
// (which works off the Hebrew catalog) always recognizes the item. Hebrew
// checkout keeps using buildOrderMessage untouched.
function localizedOrderMessage(
  lines: CartLine[],
  customer: CustomerDetails,
  total: number,
  locale: Locale,
  t: typeof HE,
) {
  const hotel = selectedHotel(customer)
  const itemRows = lines.map((l) => {
    const display = l.displayName ?? dishName(l.name, locale)
    const label = display === l.name ? l.name : `${display} (${l.name})`
    return `• ${label} x${l.qty} — $${l.unitPrice * l.qty}${l.note ? ` (${l.note})` : ''}`
  })
  const rows = [
    t.waHeader,
    '',
    ...itemRows,
    '',
    `${t.waTotal}: $${total} USD`,
    '',
    `${t.waName}: ${customer.name || '-'}`,
    `${t.waPhone}: ${customer.phone ? `${customer.phoneCode}${customer.phone}` : '-'}`,
    `${t.waDate}: ${customer.date || '-'}`,
    `${t.waTime}: ${customer.time || '-'}`,
    customer.email ? `${t.waEmail}: ${customer.email}` : undefined,
    customer.fulfillment === 'pickup'
      ? t.waPickup
      : `${t.waDeliveryAddress} (${t.zones[customer.zone]}): ${deliveryAddressText(customer)}`,
    hotel ? `${t.waHotelAddress}: ${hotel.fullAddress}` : undefined,
    customer.notes ? `${t.waNotes}: ${customer.notes}` : undefined,
  ].filter(Boolean)
  return rows.join('\n')
}

export function Checkout() {
  const { lines, subtotal, setQty, removeLine, customer, setCustomer, clear } = useCart()
  const { orderingOpen, shabbatClosed } = useSiteStatus()
  const { locale, dir, href } = useLocale()
  const t = COPY[locale]
  const isPickup = customer.fulfillment === 'pickup'
  const deliveryFee = DELIVERY_FEES_USD[customer.zone]
  const total = lines.length ? subtotal + (isPickup ? 0 : deliveryFee) : 0

  // Empty = free time field (feature off, pickup, no date yet, or fetch
  // failed — fail open, availability must never block a purchase).
  const [deliveryWindows, setDeliveryWindows] = useState<DeliveryWindow[]>([])
  const [orderError, setOrderError] = useState<string | null>(null)

  useEffect(() => {
    if (isPickup || !customer.date) {
      setDeliveryWindows([])
      return
    }
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch(
          `/api/site/delivery-windows/?${new URLSearchParams({ date: customer.date }).toString()}`,
          { headers: { Accept: 'application/json' }, signal: controller.signal },
        )
        if (!response.ok) throw new Error('delivery windows fetch failed')
        const parsed = parseDeliveryWindows(await response.json())
        if (!parsed) throw new Error('delivery windows response was invalid')
        if (controller.signal.aborted) return
        setDeliveryWindows(parsed)
      } catch {
        if (controller.signal.aborted) return
        setDeliveryWindows([])
      }
    })()
    return () => controller.abort()
  }, [isPickup, customer.date])

  // Once windows apply, the time must be one of the offered starts: a time
  // typed before the date changed (or a window that just filled up) is reset
  // so the customer picks again instead of submitting into a refusal.
  useEffect(() => {
    if (isPickup || deliveryWindows.length === 0 || !customer.time) return
    const match = deliveryWindows.find((window) => window.start === customer.time)
    if (!match || match.remaining <= 0) setCustomer({ time: '' })
  }, [deliveryWindows, isPickup, customer.time, setCustomer])

  if (lines.length === 0) {
    return (
      <div className="min-h-screen bg-[#F7ECE6] text-[#3B151A] font-sans selection:bg-[#EDB2C1]/30" dir={dir}>
        <PageHero active="/checkout" size="compact" title={t.emptyTitle} image={CHECKOUT_HERO_IMAGE} imageAlt={t.heroImageAlt} />
        <div className="flex flex-col items-center gap-8 px-6 py-20 text-center">
          <Icon icon="ph:basket-bold" className="text-6xl text-[#EDB2C1]" />
          <Link to={href('/weekdays')} className="bg-[#3B151A] text-white px-10 py-5 rounded-full font-black text-lg">
            {t.emptyWeekdaysCta}
          </Link>
          <Link to={href('/shabbat-order')} className="text-[#8D182C] font-black underline">
            {t.emptyShabbatCta}
          </Link>
        </div>
        <Footer />
      </div>
    )
  }

  const hotel = selectedHotel(customer)
  const isHotelMode = !isPickup && customer.addressMode === 'hotel'

  // The closure screen normally replaces this page outright; this gate is what
  // catches a cart that was already open when candle lighting arrived.
  const canSubmit =
    orderingOpen &&
    !shabbatClosed &&
    customer.name.trim() &&
    customer.phone.trim() &&
    customer.date.trim() &&
    customer.time.trim() &&
    (isPickup || (isHotelMode ? hotel !== null : customer.address.trim()))

  const submitOrderToKitchen = async (): Promise<boolean> => {
    setOrderError(null)
    try {
      const response = await fetch('/api/site/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: {
            ...customer,
            zone: isPickup ? undefined : customer.zone,
            phone: `${customer.phoneCode}${customer.phone}`,
            // Flat fields, all five together or none — that is what the order
            // route accepts, and what the kitchen's delivery routing reads.
            ...(hotel
              ? {
                  hotelName: hotel.name,
                  hotelAddress: hotel.fullAddress,
                  hotelLatitude: hotel.latitude,
                  hotelLongitude: hotel.longitude,
                  hotelProviderId: hotel.id,
                }
              : {}),
          },
          lines: lines.map((line) => ({ id: line.id, name: line.name, unitPrice: line.unitPrice, qty: line.qty, note: line.note })),
          total,
        }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        if (response.status === 403 && body.error === 'phone_blocked') {
          setOrderError(t.phoneBlockedError)
        }
        return false
      }
      return true
    } catch {
      // Best-effort — the WhatsApp message is the order of record either way.
      return true
    }
  }

  const orderMessage =
    locale === 'he'
      ? buildOrderMessage(lines, customer, total)
      : localizedOrderMessage(lines, customer, total, locale, t)

  // Address means different things per mode (free address vs room number), so
  // switching starts that field clean.
  const chooseAddressMode = (addressMode: 'hotel' | 'free') => {
    if (customer.addressMode === addressMode) return
    setCustomer({ addressMode, address: '', hotel: null })
  }

  return (
    <div className="min-h-screen bg-[#F7ECE6] text-[#3B151A] font-sans selection:bg-[#EDB2C1]/30 pb-32" dir={dir}>
      <PageHero active="/checkout" size="compact" title={t.heroTitle} image={CHECKOUT_HERO_IMAGE} imageAlt={t.heroImageAlt} />

      <main className="max-w-3xl mx-auto px-6 py-12 space-y-12">
        <section className="bg-white rounded-[3rem] p-6 md:p-8 shadow-xl border border-[#EDB2C1]/20">
          <h2 className="text-2xl font-black font-heading mb-6 border-b border-[#EDB2C1]/10 pb-4 flex items-center gap-3">
            <Icon icon="ph:basket-fill" className="text-[#F5A83A]" />
            {t.itemsTitle}
          </h2>
          <div className="space-y-6">
            {lines.map((line) => (
              <div key={line.id} className="flex items-start justify-between gap-4">
                <div className="flex-grow">
                  <h4 className="font-black">{line.displayName ?? line.name}</h4>
                  {line.note && <p className="text-xs text-[#3B151A]/50 font-bold mt-1 leading-relaxed">{line.note}</p>}
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => setQty(line.id, line.qty - 1)}
                      className="w-8 h-8 rounded-lg bg-[#F7ECE6] font-black flex items-center justify-center"
                    >
                      −
                    </button>
                    <span className="w-6 text-center font-black">{line.qty}</span>
                    <button
                      type="button"
                      onClick={() => setQty(line.id, line.qty + 1)}
                      className="w-8 h-8 rounded-lg bg-[#F7ECE6] font-black flex items-center justify-center"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      onClick={() => removeLine(line.id)}
                      className="ms-2 text-[#8D182C] text-xs font-black underline"
                    >
                      {t.remove}
                    </button>
                  </div>
                </div>
                <span className="font-black shrink-0">${(line.unitPrice * line.qty).toFixed(2).replace(/\.00$/, '')}</span>
              </div>
            ))}
          </div>
          <div className="mt-8 pt-8 border-t-2 border-dotted border-[#EDB2C1]/20 space-y-4">
            <div className="flex justify-between text-sm font-bold text-[#3B151A]/60">
              <span>{t.itemsSubtotal}</span>
              <span>${subtotal.toFixed(2).replace(/\.00$/, '')}</span>
            </div>
            <div className="flex justify-between text-sm font-bold text-[#3B151A]/60">
              <span>{isPickup ? t.pickupLine : `${t.deliveryLine} (${t.zones[customer.zone]})`}</span>
              <span>{isPickup ? t.freeOfCharge : `$${deliveryFee}`}</span>
            </div>
            <div className="flex justify-between text-2xl font-black pt-4">
              <span>{t.totalDue}</span>
              <span>${total.toFixed(2).replace(/\.00$/, '')}</span>
            </div>
          </div>
          <CurrencyNote className="mt-6" />
        </section>

        <section className="space-y-8">
          <h2 className="text-2xl font-black font-heading flex items-center gap-3">
            <Icon icon="ph:map-pin-fill" className="text-[#F5A83A]" />
            {t.fulfillmentTitle}
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => setCustomer({ fulfillment: 'delivery' })}
              className={`p-6 rounded-3xl border-2 font-black text-center transition-all ${
                !isPickup ? 'border-[#F5A83A] bg-[#F5A83A]/5' : 'border-[#EDB2C1]/30 bg-white'
              }`}
            >
              {t.delivery}
            </button>
            <button
              type="button"
              onClick={() => setCustomer({ fulfillment: 'pickup' })}
              className={`p-6 rounded-3xl border-2 font-black text-center transition-all ${
                isPickup ? 'border-[#F5A83A] bg-[#F5A83A]/5' : 'border-[#EDB2C1]/30 bg-white'
              }`}
            >
              {t.pickupFree}
            </button>
          </div>
          {!isPickup && (
            <div className="grid grid-cols-2 gap-4">
              {(Object.keys(t.zones) as DeliveryZone[]).map((zone) => (
                <button
                  key={zone}
                  type="button"
                  onClick={() => setCustomer({ zone })}
                  className={`p-4 rounded-2xl border-2 font-black text-center transition-all ${
                    customer.zone === zone ? 'border-[#F5A83A] bg-[#F5A83A]/5' : 'border-[#EDB2C1]/30 bg-white'
                  }`}
                >
                  {t.zones[zone]} (${DELIVERY_FEES_USD[zone]})
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Field label={t.fullNameLabel}>
              <input
                type="text"
                value={customer.name}
                onChange={(e) => setCustomer({ name: e.target.value })}
                placeholder={t.fullNamePlaceholder}
                className="w-full p-5 rounded-2xl bg-white border border-[#EDB2C1]/30 focus:ring-2 focus:ring-[#F5A83A] outline-none font-bold"
              />
            </Field>
            <Field label={t.phoneLabel}>
              <div className="flex gap-2" dir="ltr">
                <select
                  value={customer.phoneCode}
                  onChange={(e) => setCustomer({ phoneCode: e.target.value })}
                  className="p-5 rounded-2xl bg-white border border-[#EDB2C1]/30 focus:ring-2 focus:ring-[#F5A83A] outline-none font-bold shrink-0"
                >
                  {PHONE_CODES.map((code) => (
                    <option key={code} value={code}>
                      {code} {t.phoneCountries[code]}
                    </option>
                  ))}
                </select>
                <input
                  type="tel"
                  value={customer.phone}
                  onChange={(e) => setCustomer({ phone: e.target.value })}
                  placeholder={t.phonePlaceholder}
                  className="w-full p-5 rounded-2xl bg-white border border-[#EDB2C1]/30 focus:ring-2 focus:ring-[#F5A83A] outline-none font-bold"
                />
              </div>
            </Field>
            <Field label={isPickup ? t.pickupDateLabel : t.deliveryDateLabel}>
              <input
                type="date"
                value={customer.date}
                min={dubaiToday()}
                onChange={(e) => setCustomer({ date: e.target.value })}
                className="w-full p-5 rounded-2xl bg-white border border-[#EDB2C1]/30 focus:ring-2 focus:ring-[#F5A83A] outline-none font-bold"
              />
            </Field>
            <Field label={isPickup ? t.pickupTimeLabel : t.deliveryTimeLabel}>
              {!isPickup && deliveryWindows.length > 0 ? (
                <div className="grid grid-cols-2 gap-3">
                  {deliveryWindows.map((window) => {
                    const isFull = window.remaining <= 0
                    const isSelected = customer.time === window.start
                    return (
                      <button
                        key={window.key}
                        type="button"
                        disabled={isFull}
                        onClick={() => setCustomer({ time: window.start })}
                        className={`p-4 rounded-2xl border-2 font-black text-center transition-all ${
                          isSelected
                            ? 'border-[#F5A83A] bg-[#F5A83A]/5'
                            : isFull
                              ? 'border-[#EDB2C1]/30 bg-white opacity-40 cursor-not-allowed'
                              : 'border-[#EDB2C1]/30 bg-white'
                        }`}
                      >
                        <span className="block" dir="ltr">
                          {window.start}–{window.end}
                        </span>
                        <span className={`block text-xs font-bold mt-1 ${isFull ? 'text-[#8D182C]' : 'text-[#3B151A]/50'}`}>
                          {isFull ? t.windowFull : t.windowRemaining(window.remaining)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <input
                  type="time"
                  value={customer.time}
                  onChange={(e) => setCustomer({ time: e.target.value })}
                  className="w-full p-5 rounded-2xl bg-white border border-[#EDB2C1]/30 focus:ring-2 focus:ring-[#F5A83A] outline-none font-bold"
                />
              )}
            </Field>
            <div className="md:col-span-2">
              <Field label={t.emailLabel}>
                <input
                  type="email"
                  value={customer.email}
                  onChange={(e) => setCustomer({ email: e.target.value })}
                  placeholder="name@example.com"
                  dir="ltr"
                  className="w-full p-5 rounded-2xl bg-white border border-[#EDB2C1]/30 focus:ring-2 focus:ring-[#F5A83A] outline-none font-bold"
                />
              </Field>
            </div>
            {!isPickup && (
              <div className="md:col-span-2 space-y-6">
                <Field label={t.destinationLabel}>
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      type="button"
                      onClick={() => chooseAddressMode('hotel')}
                      className={`p-4 rounded-2xl border-2 font-black text-center transition-all ${
                        isHotelMode ? 'border-[#F5A83A] bg-[#F5A83A]/5' : 'border-[#EDB2C1]/30 bg-white'
                      }`}
                    >
                      {t.hotelOption}
                    </button>
                    <button
                      type="button"
                      onClick={() => chooseAddressMode('free')}
                      className={`p-4 rounded-2xl border-2 font-black text-center transition-all ${
                        !isHotelMode ? 'border-[#F5A83A] bg-[#F5A83A]/5' : 'border-[#EDB2C1]/30 bg-white'
                      }`}
                    >
                      {t.otherAddressOption}
                    </button>
                  </div>
                </Field>
                {isHotelMode ? (
                  <>
                    <Field label={t.hotelNameLabel}>
                      <HotelPicker
                        hotel={hotel}
                        onSelect={(selection) => setCustomer({ hotel: selection })}
                        onClear={() => setCustomer({ hotel: null })}
                      />
                    </Field>
                    {hotel && (
                      <Field label={t.roomLabel}>
                        <input
                          type="text"
                          value={customer.address}
                          onChange={(e) => setCustomer({ address: e.target.value })}
                          placeholder={t.roomPlaceholder}
                          className={INPUT_CLASS}
                        />
                      </Field>
                    )}
                  </>
                ) : (
                  <Field label={t.fullAddressLabel}>
                    <input
                      type="text"
                      value={customer.address}
                      onChange={(e) => setCustomer({ address: e.target.value })}
                      placeholder={t.fullAddressPlaceholder}
                      className={INPUT_CLASS}
                    />
                  </Field>
                )}
              </div>
            )}
            <div className="md:col-span-2">
              <Field label={t.kitchenNotesLabel}>
                <textarea
                  value={customer.notes}
                  onChange={(e) => setCustomer({ notes: e.target.value })}
                  placeholder={t.kitchenNotesPlaceholder}
                  className="w-full p-5 rounded-2xl bg-white border border-[#EDB2C1]/30 focus:ring-2 focus:ring-[#F5A83A] outline-none font-bold h-32"
                />
              </Field>
            </div>
          </div>
        </section>

        <section className="bg-[#3B151A]/5 rounded-[3rem] p-8 border-2 border-dashed border-[#F5A83A]/30 text-center space-y-4">
          <Icon icon="ph:info-fill" className="text-3xl text-[#F5A83A]" />
          <p className="font-bold text-[#3B151A]/70">
            {t.infoWhatsApp}
          </p>
          <p className="font-bold text-[#3B151A]/70">
            {t.infoPayment}
          </p>
        </section>
      </main>

      <div className="fixed bottom-0 left-0 right-0 p-6 bg-[#F7ECE6]/90 backdrop-blur-xl border-t border-[#EDB2C1]/30 z-[100]">
        <div className="max-w-3xl mx-auto">
          <button
            type="button"
            disabled={!canSubmit}
            onClick={async () => {
              if (!canSubmit) return
              const accepted = await submitOrderToKitchen()
              if (accepted) {
                window.open(waLink(orderMessage), '_blank', 'noopener,noreferrer')
                clear()
              }
            }}
            className={`w-full py-6 rounded-[2.5rem] font-black text-2xl shadow-2xl transition-all flex items-center justify-center gap-4 group ${
              canSubmit ? 'bg-[#3B151A] text-white hover:bg-black' : 'bg-[#3B151A]/30 text-white/60 cursor-not-allowed'
            }`}
          >
            {t.submitCta} <Icon icon="ph:check-circle-fill" className="text-3xl group-hover:scale-125 transition-transform" />
          </button>
          {orderError && (
            <p className="text-center text-sm font-black text-[#8D182C] mt-3" role="alert">
              {orderError}
            </p>
          )}
          {!canSubmit && (
            <p className="text-center text-xs font-bold text-[#8D182C] mt-3">
              {shabbatClosed
                ? t.hintShabbatClosed
                : !orderingOpen
                  ? t.hintClosed
                  : isPickup
                    ? t.hintPickup
                    : isHotelMode
                      ? t.hintHotel
                      : t.hintAddress}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-black ms-2">{label}</label>
      {children}
    </div>
  )
}

const HOTEL_PROVIDER_ID_PATTERN = /^[NWR][1-9]\d{0,18}$/u
const HOTEL_MINIMUM_LATITUDE = 22.5
const HOTEL_MAXIMUM_LATITUDE = 26.5
const HOTEL_MINIMUM_LONGITUDE = 51
const HOTEL_MAXIMUM_LONGITUDE = 56.6

/** Same bounds the search route enforces — a malformed page never becomes an order. */
function parseHotelResults(value: unknown): SelectedHotel[] | null {
  if (!value || typeof value !== 'object') return null
  const results = (value as { results?: unknown }).results
  if (!Array.isArray(results) || results.length > 10) return null
  const hotels: SelectedHotel[] = []
  for (const row of results) {
    if (!row || typeof row !== 'object') return null
    const { id, name, fullAddress, latitude, longitude } = row as Record<string, unknown>
    if (typeof id !== 'string' || !HOTEL_PROVIDER_ID_PATTERN.test(id)) return null
    if (typeof name !== 'string' || name.length === 0 || name.length > 200) return null
    if (typeof fullAddress !== 'string' || fullAddress.length === 0 || fullAddress.length > 500) return null
    if (
      typeof latitude !== 'number' ||
      !Number.isFinite(latitude) ||
      latitude < HOTEL_MINIMUM_LATITUDE ||
      latitude > HOTEL_MAXIMUM_LATITUDE
    ) return null
    if (
      typeof longitude !== 'number' ||
      !Number.isFinite(longitude) ||
      longitude < HOTEL_MINIMUM_LONGITUDE ||
      longitude > HOTEL_MAXIMUM_LONGITUDE
    ) return null
    hotels.push({ id, name, fullAddress, latitude, longitude })
  }
  return hotels
}

type HotelSearchState = 'idle' | 'loading' | 'empty' | 'error'

function HotelPicker({
  hotel,
  onSelect,
  onClear,
}: {
  hotel: SelectedHotel | null
  onSelect: (hotel: SelectedHotel) => void
  onClear: () => void
}) {
  const { locale } = useLocale()
  const t = COPY[locale]
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SelectedHotel[]>([])
  const [searchState, setSearchState] = useState<HotelSearchState>('idle')

  useEffect(() => {
    if (hotel) return
    const trimmed = query.normalize('NFKC').trim().replace(/\s+/gu, ' ')
    if (trimmed.length < HOTEL_QUERY_MIN_LENGTH || trimmed.length > HOTEL_QUERY_MAX_LENGTH) {
      setResults([])
      setSearchState('idle')
      return
    }
    // Aborting on cleanup is what drops stale answers: a reply that arrives
    // after the next keystroke belongs to a controller nobody reads anymore.
    const controller = new AbortController()
    setSearchState('loading')
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/hotels/search?${new URLSearchParams({ q: trimmed }).toString()}`, {
            headers: { Accept: 'application/json' },
            signal: controller.signal,
          })
          if (!response.ok) throw new Error('hotel search failed')
          const parsed = parseHotelResults(await response.json())
          if (!parsed) throw new Error('hotel search response was invalid')
          if (controller.signal.aborted) return
          setResults(parsed)
          setSearchState(parsed.length > 0 ? 'idle' : 'empty')
        } catch {
          if (controller.signal.aborted) return
          setResults([])
          setSearchState('error')
        }
      })()
    }, HOTEL_SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query, hotel])

  if (hotel) {
    return (
      <div className="w-full p-5 rounded-2xl bg-white border-2 border-[#F5A83A] flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-black">{hotel.name}</p>
          <p className="text-xs font-bold text-[#3B151A]/50 mt-1 leading-relaxed">{hotel.fullAddress}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setQuery('')
            setResults([])
            setSearchState('idle')
            onClear()
          }}
          aria-label={t.hotelClearAria}
          className="shrink-0 w-8 h-8 rounded-lg bg-[#F7ECE6] flex items-center justify-center"
        >
          <Icon icon="ph:x-bold" className="text-[#8D182C]" />
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t.hotelSearchPlaceholder}
        autoComplete="off"
        className={INPUT_CLASS}
      />
      {searchState === 'loading' && (
        <p className="text-xs font-bold text-[#3B151A]/50 ms-2">{t.hotelSearching}</p>
      )}
      {searchState === 'empty' && (
        <p className="text-xs font-bold text-[#3B151A]/50 ms-2">
          {t.hotelEmpty}
        </p>
      )}
      {searchState === 'error' && (
        <p className="text-xs font-bold text-[#8D182C] ms-2">
          {t.hotelError}
        </p>
      )}
      {results.length > 0 && (
        <ul className="bg-white rounded-2xl border border-[#EDB2C1]/30 divide-y divide-[#EDB2C1]/20 max-h-72 overflow-y-auto">
          {results.map((result) => (
            <li key={result.id}>
              <button
                type="button"
                onClick={() => onSelect(result)}
                className="w-full text-start p-4 hover:bg-[#F7ECE6] transition-colors"
              >
                <span className="block font-black">{result.name}</span>
                <span className="block text-xs font-bold text-[#3B151A]/50 mt-1 leading-relaxed">
                  {result.fullAddress}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
