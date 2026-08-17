import { BrandLogo } from './brand-logo.tsx'
import { parseUsdInputMinorUnits } from '../domain/order-editor.ts'
import { formatLegacyOrderText } from '../domain/orders-dashboard.ts'
import type { LegacyOrder } from '../domain/store.ts'
import { formatUsdMinorUnits } from '../domain/today-dashboard.ts'

function extendedDeliveryLines(order: Readonly<LegacyOrder>): readonly string[] {
  const record = order as Readonly<Record<string, unknown>>
  const fields = [
    ['שם המלון השמור', record.hotelName],
    ['כתובת המלון השמורה', record.hotelAddress],
    ['קישור ניווט שמור', record.navigationUrl],
  ] as const
  return fields.flatMap(([label, value]) =>
    typeof value === 'string' && value.trim().length > 0 && value.length <= 10_000
      ? [`${label}: ${value.trim()}`]
      : [],
  )
}

/**
 * The emphasized total the legacy bon carried. Money is only ever shown when it
 * parses exactly — a bon that states a wrong amount is worse than one that
 * leaves the amount to the detail lines above it.
 */
function totalLabel(order: Readonly<LegacyOrder>): string | null {
  const raw = typeof order.total === 'number' ? String(order.total) : typeof order.total === 'string' ? order.total.trim() : ''
  if (raw === '') return null
  const minorUnits = parseUsdInputMinorUnits(raw)
  return minorUnits === null ? null : formatUsdMinorUnits(minorUnits)
}

/**
 * One printable bon. The `bm-bon-*` hooks are what the print stylesheet sizes
 * for the QL-800 roll, so they must stay on these elements.
 */
export function OrderBon({ order }: { readonly order: Readonly<LegacyOrder> }) {
  const orderText = [formatLegacyOrderText(order), ...extendedDeliveryLines(order)].join('\n')
  const orderId = String(order.id)
  const status = typeof order.status === 'string' && order.status.trim() ? order.status.trim() : 'לא צוין'
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

      <div className="bm-bon-meta mt-5 flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-muted-foreground">
        <span>מזהה הזמנה: {orderId}</span>
        <span>סטטוס: {status}</span>
      </div>
      <pre className="bm-bon-body mt-5 whitespace-pre-wrap break-words font-sans text-sm font-semibold leading-7 text-foreground">
        {orderText}
      </pre>
      {total !== null && (
        <p className="bm-bon-total mt-5 border-t-2 border-primary pt-3 text-center text-lg font-black tabular-nums text-primary">
          סך לתשלום: {total}
        </p>
      )}
      <footer className="bm-bon-foot mt-6 border-t border-dashed border-border pt-5 text-center text-sm font-black text-primary">
        בשם השם נעשה ונצליח!
      </footer>
    </article>
  )
}

export default OrderBon
