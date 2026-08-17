import { BrandLogo } from './brand-logo.tsx'
import { parseUsdInputMinorUnits } from '../domain/order-editor.ts'
import { type BonField, bonPaymentFields, bonServiceDate, buildBonFields } from '../domain/orders-dashboard.ts'
import type { LegacyOrder } from '../domain/store.ts'
import { formatUsdMinorUnits } from '../domain/today-dashboard.ts'

/**
 * The amount for the bon's own block. A stored amount that parses exactly is
 * printed as money; anything else is printed verbatim, so a bon never states a
 * number the order does not hold.
 */
function totalLabel(order: Readonly<LegacyOrder>): string | null {
  const raw = typeof order.total === 'number'
    ? String(order.total)
    : typeof order.total === 'string' ? order.total.trim() : ''
  if (raw === '') return null
  const minorUnits = parseUsdInputMinorUnits(raw)
  return minorUnits === null ? raw : formatUsdMinorUnits(minorUnits)
}

function BonRow({ field }: { readonly field: Readonly<BonField> }) {
  return (
    <div className="bm-bon-row flex gap-2 border-b border-dotted border-border/70 py-1.5 last:border-b-0">
      <dt className="bm-bon-label shrink-0 font-black text-primary">{field.label}:</dt>
      <dd className="bm-bon-value min-w-0 flex-1 font-semibold text-foreground">
        {field.value}
        {field.notes.map((note) => (
          <span key={note} className="bm-bon-note block font-bold text-muted-foreground">{note}</span>
        ))}
      </dd>
    </div>
  )
}

/**
 * One printable bon. The `bm-bon-*` hooks are what the print stylesheet sizes
 * for the QL-800 roll, so they must stay on these elements.
 */
export function OrderBon({ order }: { readonly order: Readonly<LegacyOrder> }) {
  const orderId = String(order.id)
  const status = typeof order.status === 'string' && order.status.trim() ? order.status.trim() : 'לא צוין'
  const fields = buildBonFields(order)
  const payment = bonPaymentFields(order)
  const total = totalLabel(order)

  return (
    <article
      className="bm-order-bon mx-auto w-full max-w-2xl rounded-[2rem] border-2 border-dotted border-primary bg-card p-6 shadow-sm sm:p-10"
      data-order-id={orderId}
      dir="rtl"
    >
      <p className="bm-bon-bsd text-left text-xs font-black text-foreground">בס&quot;ד</p>
      <header className="bm-bon-head border-b border-dashed border-border pb-5 text-center">
        <h1 className="sr-only">מטעמי בת מלך</h1>
        {/*
          The logo file carries wide white margins around the mark. The frame
          crops them so the header costs the roll only the mark itself — see the
          measured ratios in the print stylesheet.
        */}
        <div className="bm-bon-logo-frame">
          <BrandLogo alt="מטעמי בת מלך" className="bm-bon-logo mx-auto h-28 w-40" />
        </div>
        <p className="bm-bon-sub mt-1 text-xs font-bold text-muted-foreground">מטבח ביתי אותנטי · כשר</p>
      </header>

      <p className="bm-bon-date mt-4 text-center text-base font-black text-primary">{bonServiceDate(order)}</p>
      <div className="bm-bon-meta mt-2 flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-muted-foreground">
        <span>מזהה הזמנה: {orderId}</span>
        <span>סטטוס: {status}</span>
      </div>

      <dl className="bm-bon-fields mt-4 text-sm leading-6">
        {fields.map((field) => <BonRow key={field.label} field={field} />)}
      </dl>

      {total !== null && (
        <p className="bm-bon-total mt-5 border-t-2 border-primary pt-3 text-center text-lg font-black tabular-nums text-primary">
          סכום לתשלום: {total}
        </p>
      )}
      <dl className="bm-bon-payment mt-2 flex flex-wrap justify-center gap-x-4 text-xs font-bold text-muted-foreground">
        {payment.map((field) => (
          <div key={field.label} className="flex gap-1">
            <dt className="font-black">{field.label}:</dt>
            <dd>{field.value}</dd>
          </div>
        ))}
      </dl>

      <footer className="bm-bon-foot mt-6 border-t border-dashed border-border pt-5 text-center text-sm font-black text-primary">
        בשם השם נעשה ונצליח!
      </footer>
    </article>
  )
}

export default OrderBon
