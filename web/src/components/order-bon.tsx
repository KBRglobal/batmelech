import { formatLegacyOrderText } from '../domain/orders-dashboard.ts'
import type { LegacyOrder } from '../domain/store.ts'

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
 * One printable bon. The `bm-bon-*` hooks are what the print stylesheet sizes
 * for the QL-800 roll, so they must stay on these elements.
 */
export function OrderBon({ order }: { readonly order: Readonly<LegacyOrder> }) {
  const orderText = [formatLegacyOrderText(order), ...extendedDeliveryLines(order)].join('\n')
  const orderId = String(order.id)
  const status = typeof order.status === 'string' && order.status.trim() ? order.status.trim() : 'לא צוין'

  return (
    <article
      className="bm-order-bon mx-auto w-full max-w-2xl rounded-[2rem] border-2 border-dotted border-primary bg-card p-6 shadow-sm sm:p-10"
      data-order-id={orderId}
      dir="rtl"
    >
      <p className="bm-bon-bsd text-left text-xs font-black text-foreground">בס&quot;ד</p>
      <header className="bm-bon-head border-b border-dashed border-border pb-5 text-center">
        <h1 className="bm-bon-title font-heading text-2xl font-black text-primary">מטעמי בת מלך</h1>
        <p className="bm-bon-sub mt-1 text-xs font-bold text-muted-foreground">מטבח ביתי אותנטי · כשר</p>
      </header>

      <div className="bm-bon-meta mt-5 flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-muted-foreground">
        <span>מזהה הזמנה: {orderId}</span>
        <span>סטטוס: {status}</span>
      </div>
      <pre className="bm-bon-body mt-5 whitespace-pre-wrap break-words font-sans text-sm font-semibold leading-7 text-foreground">
        {orderText}
      </pre>
      <footer className="bm-bon-foot mt-6 border-t border-dashed border-border pt-5 text-center text-sm font-black text-primary">
        בשם השם נעשה ונצליח!
      </footer>
    </article>
  )
}

export default OrderBon
