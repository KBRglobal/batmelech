import type { ReactNode } from 'react'
import { Icon } from '@iconify/react'
import { Link } from 'react-router'
import { PageHero } from '../components/page-hero'
import { Footer } from '../components/footer'
import { useCart } from '../cart-context'
import { useSiteStatus } from '../site-status-context'
import { buildOrderMessage, waLink } from '../whatsapp'

const DELIVERY_FEE = 15
const PHONE_CODES = [
  { code: '+971', label: 'איחוד האמירויות' },
  { code: '+972', label: 'ישראל' },
  { code: '+1', label: 'ארה"ב / קנדה' },
  { code: '+44', label: 'בריטניה' },
]
const CHECKOUT_HERO_IMAGE =
  'https://ggrhecslgdflloszjkwl.supabase.co/storage/v1/object/public/user-assets/ucQtca7hCDw/components/L5fzK0kRQ4N.jpeg'

function dubaiToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date())
}

export function Checkout() {
  const { lines, subtotal, setQty, removeLine, customer, setCustomer, clear } = useCart()
  const { orderingOpen } = useSiteStatus()
  const isPickup = customer.fulfillment === 'pickup'
  const total = lines.length ? subtotal + (isPickup ? 0 : DELIVERY_FEE) : 0

  if (lines.length === 0) {
    return (
      <div className="min-h-screen bg-[#F7ECE6] text-[#3B151A] font-sans selection:bg-[#EDB2C1]/30" dir="rtl">
        <PageHero active="/checkout" size="compact" title={['הסל שלכם', 'ריק']} image={CHECKOUT_HERO_IMAGE} imageAlt="מטעמי בת מלך - מטבח ביתי כשר בדובאי" />
        <div className="flex flex-col items-center gap-8 px-6 py-20 text-center">
          <Icon icon="ph:basket-bold" className="text-6xl text-[#EDB2C1]" />
          <Link to="/weekdays" className="bg-[#3B151A] text-white px-10 py-5 rounded-full font-black text-lg">
            לתפריט יום חול
          </Link>
          <Link to="/shabbat-order" className="text-[#8D182C] font-black underline">
            או להרכבת מארז שבת
          </Link>
        </div>
        <Footer />
      </div>
    )
  }

  const canSubmit =
    orderingOpen &&
    customer.name.trim() &&
    customer.phone.trim() &&
    customer.date.trim() &&
    customer.time.trim() &&
    (isPickup || customer.address.trim())

  const submitOrderToKitchen = () => {
    fetch('/api/site/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: { ...customer, phone: `${customer.phoneCode}${customer.phone}` },
        lines: lines.map((line) => ({ id: line.id, name: line.name, unitPrice: line.unitPrice, qty: line.qty, note: line.note })),
        total,
      }),
    }).catch(() => {
      // Best-effort — the WhatsApp message is the order of record either way.
    })
  }

  return (
    <div className="min-h-screen bg-[#F7ECE6] text-[#3B151A] font-sans selection:bg-[#EDB2C1]/30 pb-32" dir="rtl">
      <PageHero active="/checkout" size="compact" title={['סיכום', 'הזמנה']} image={CHECKOUT_HERO_IMAGE} imageAlt="מטעמי בת מלך - מטבח ביתי כשר בדובאי" />

      <main className="max-w-3xl mx-auto px-6 py-12 space-y-12">
        <section className="bg-white rounded-[3rem] p-6 md:p-8 shadow-xl border border-[#EDB2C1]/20">
          <h2 className="text-2xl font-black font-heading mb-6 border-b border-[#EDB2C1]/10 pb-4 flex items-center gap-3">
            <Icon icon="ph:basket-fill" className="text-[#F5A83A]" />
            פריטים בהזמנה
          </h2>
          <div className="space-y-6">
            {lines.map((line) => (
              <div key={line.id} className="flex items-start justify-between gap-4">
                <div className="flex-grow">
                  <h4 className="font-black">{line.name}</h4>
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
                      className="mr-2 text-[#8D182C] text-xs font-black underline"
                    >
                      הסר
                    </button>
                  </div>
                </div>
                <span className="font-black shrink-0">${(line.unitPrice * line.qty).toFixed(2).replace(/\.00$/, '')}</span>
              </div>
            ))}
          </div>
          <div className="mt-8 pt-8 border-t-2 border-dotted border-[#EDB2C1]/20 space-y-4">
            <div className="flex justify-between text-sm font-bold text-[#3B151A]/60">
              <span>סיכום פריטים</span>
              <span>${subtotal.toFixed(2).replace(/\.00$/, '')}</span>
            </div>
            <div className="flex justify-between text-sm font-bold text-[#3B151A]/60">
              <span>{isPickup ? 'איסוף עצמי' : 'משלוח (דובאי)'}</span>
              <span>{isPickup ? 'ללא עלות' : `$${DELIVERY_FEE}`}</span>
            </div>
            <div className="flex justify-between text-2xl font-black pt-4">
              <span>סה"כ לתשלום</span>
              <span>${total.toFixed(2).replace(/\.00$/, '')}</span>
            </div>
          </div>
        </section>

        <section className="space-y-8">
          <h2 className="text-2xl font-black font-heading flex items-center gap-3">
            <Icon icon="ph:map-pin-fill" className="text-[#F5A83A]" />
            איך תרצו לקבל את ההזמנה
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => setCustomer({ fulfillment: 'delivery' })}
              className={`p-6 rounded-3xl border-2 font-black text-center transition-all ${
                !isPickup ? 'border-[#F5A83A] bg-[#F5A83A]/5' : 'border-[#EDB2C1]/30 bg-white'
              }`}
            >
              משלוח (${DELIVERY_FEE})
            </button>
            <button
              type="button"
              onClick={() => setCustomer({ fulfillment: 'pickup' })}
              className={`p-6 rounded-3xl border-2 font-black text-center transition-all ${
                isPickup ? 'border-[#F5A83A] bg-[#F5A83A]/5' : 'border-[#EDB2C1]/30 bg-white'
              }`}
            >
              איסוף עצמי (ללא עלות)
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Field label="שם מלא">
              <input
                type="text"
                value={customer.name}
                onChange={(e) => setCustomer({ name: e.target.value })}
                placeholder="ישראל ישראלי"
                className="w-full p-5 rounded-2xl bg-white border border-[#EDB2C1]/30 focus:ring-2 focus:ring-[#F5A83A] outline-none font-bold"
              />
            </Field>
            <Field label="מספר טלפון">
              <div className="flex gap-2" dir="ltr">
                <select
                  value={customer.phoneCode}
                  onChange={(e) => setCustomer({ phoneCode: e.target.value })}
                  className="p-5 rounded-2xl bg-white border border-[#EDB2C1]/30 focus:ring-2 focus:ring-[#F5A83A] outline-none font-bold shrink-0"
                >
                  {PHONE_CODES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} {c.label}
                    </option>
                  ))}
                </select>
                <input
                  type="tel"
                  value={customer.phone}
                  onChange={(e) => setCustomer({ phone: e.target.value })}
                  placeholder="50 000 0000"
                  className="w-full p-5 rounded-2xl bg-white border border-[#EDB2C1]/30 focus:ring-2 focus:ring-[#F5A83A] outline-none font-bold"
                />
              </div>
            </Field>
            <Field label={isPickup ? 'תאריך איסוף' : 'תאריך משלוח'}>
              <input
                type="date"
                value={customer.date}
                min={dubaiToday()}
                onChange={(e) => setCustomer({ date: e.target.value })}
                className="w-full p-5 rounded-2xl bg-white border border-[#EDB2C1]/30 focus:ring-2 focus:ring-[#F5A83A] outline-none font-bold"
              />
            </Field>
            <Field label={isPickup ? 'שעת איסוף' : 'שעת משלוח'}>
              <input
                type="time"
                value={customer.time}
                onChange={(e) => setCustomer({ time: e.target.value })}
                className="w-full p-5 rounded-2xl bg-white border border-[#EDB2C1]/30 focus:ring-2 focus:ring-[#F5A83A] outline-none font-bold"
              />
            </Field>
            <div className="md:col-span-2">
              <Field label="אימייל (לקבלת חשבונית)">
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
              <div className="md:col-span-2">
                <Field label="כתובת מלאה (מלון / דירה)">
                  <input
                    type="text"
                    value={customer.address}
                    onChange={(e) => setCustomer({ address: e.target.value })}
                    placeholder="שם המלון, מספר חדר, אזור..."
                    className="w-full p-5 rounded-2xl bg-white border border-[#EDB2C1]/30 focus:ring-2 focus:ring-[#F5A83A] outline-none font-bold"
                  />
                </Field>
              </div>
            )}
            <div className="md:col-span-2">
              <Field label="הערות למטבח">
                <textarea
                  value={customer.notes}
                  onChange={(e) => setCustomer({ notes: e.target.value })}
                  placeholder="בלי חריף, אקסטרה מטבוחה..."
                  className="w-full p-5 rounded-2xl bg-white border border-[#EDB2C1]/30 focus:ring-2 focus:ring-[#F5A83A] outline-none font-bold h-32"
                />
              </Field>
            </div>
          </div>
        </section>

        <section className="bg-[#3B151A]/5 rounded-[3rem] p-8 border-2 border-dashed border-[#F5A83A]/30 text-center space-y-4">
          <Icon icon="ph:info-fill" className="text-3xl text-[#F5A83A]" />
          <p className="font-bold text-[#3B151A]/70">
            לאחר לחיצה על "אישור ושליחה", ההזמנה תיפתח כהודעת וואטסאפ מוכנה אל בת מלך לאישור סופי.
          </p>
          <p className="font-bold text-[#3B151A]/70">
            אין תשלום באתר. התשלום מסתדר ישירות מול בת מלך בוואטסאפ — מזומן במסירה, העברה בנקאית, ביט או פייבוקס.
          </p>
        </section>
      </main>

      <div className="fixed bottom-0 left-0 right-0 p-6 bg-[#F7ECE6]/90 backdrop-blur-xl border-t border-[#EDB2C1]/30 z-[100]">
        <div className="max-w-3xl mx-auto">
          <a
            href={canSubmit ? waLink(buildOrderMessage(lines, customer, total)) : undefined}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              if (!canSubmit) {
                e.preventDefault()
                return
              }
              submitOrderToKitchen()
              clear()
            }}
            className={`w-full py-6 rounded-[2.5rem] font-black text-2xl shadow-2xl transition-all flex items-center justify-center gap-4 group ${
              canSubmit ? 'bg-[#3B151A] text-white hover:bg-black' : 'bg-[#3B151A]/30 text-white/60 cursor-not-allowed'
            }`}
          >
            אישור ושליחת הזמנה <Icon icon="ph:check-circle-fill" className="text-3xl group-hover:scale-125 transition-transform" />
          </a>
          {!canSubmit && (
            <p className="text-center text-xs font-bold text-[#8D182C] mt-3">
              {!orderingOpen
                ? 'האתר לא מקבל הזמנות כרגע'
                : isPickup
                  ? 'מלאו שם, טלפון, תאריך ושעה כדי לשלוח'
                  : 'מלאו שם, טלפון, תאריך, שעה וכתובת כדי לשלוח'}
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
      <label className="text-sm font-black mr-2">{label}</label>
      {children}
    </div>
  )
}
