import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { APP_ROUTES } from '../app/routes.ts'
import { LocalIcon } from '../components/local-icon.tsx'
import { ScreenState } from '../components/screen-state.tsx'
import { useStore } from '../data/use-store.ts'
import { CANONICAL_ORDER_ID_PATTERN } from '../domain/order-editor.ts'
import { formatLegacyOrderText } from '../domain/orders-dashboard.ts'
import type { LegacyOrder } from '../domain/store.ts'
import {
  BON_MEDIA_OPTIONS,
  BON_PRINT_CSS,
  type BonMedia,
  printBon,
  rememberBonMedia,
  rememberedBonMedia,
} from '../services/bon-print.ts'

function isSafeRouteOrderId(value: string | undefined): value is string {
  return value !== undefined && CANONICAL_ORDER_ID_PATTERN.test(value)
}

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

function OrderBon({ order }: { readonly order: Readonly<LegacyOrder> }) {
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

export function OrderBonScreen() {
  const { orderId } = useParams<{ orderId?: string }>()
  const storeQuery = useStore()
  const [media, setMedia] = useState<BonMedia>(rememberedBonMedia())

  if (storeQuery.isPending) return <ScreenState kind="loading" title="טוענת את הבון" />
  if (storeQuery.isError) {
    return (
      <ScreenState
        kind="error"
        title="לא הצלחנו לטעון את הבון"
        retry={() => { void storeQuery.refetch() }}
      />
    )
  }
  if (!isSafeRouteOrderId(orderId)) {
    return (
      <ScreenState
        kind="error"
        title="מזהה ההזמנה אינו תקין"
        description="לא הודפסה הזמנה כדי למנוע בחירה של רשומה לא נכונה."
      />
    )
  }

  const matches = (storeQuery.data?.data?.orders ?? []).filter((order) => String(order.id) === orderId)
  if (matches.length !== 1) {
    return (
      <ScreenState
        kind="error"
        title={matches.length === 0 ? 'ההזמנה לא נמצאה' : 'מזהה ההזמנה אינו ייחודי'}
        description="לא הודפסה הזמנה כדי למנוע בחירה של רשומה לא נכונה."
      />
    )
  }

  const order = matches[0]!
  const selectMedia = (value: BonMedia) => {
    rememberBonMedia(value)
    setMedia(value)
  }

  return (
    <div className="min-h-full bg-background px-5 py-8 sm:px-8" dir="rtl">
      <style>{BON_PRINT_CSS}</style>
      <div className="bm-no-print mx-auto mb-6 flex w-full max-w-2xl flex-wrap items-center justify-between gap-3">
        <Link
          to={APP_ROUTES.orders}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-5 text-sm font-black text-primary hover:bg-secondary"
        >
          <LocalIcon name="ph:arrow-left-bold" className="rotate-180 text-lg" />
          <span>חזרה להזמנות</span>
        </Link>
        <button
          type="button"
          onClick={() => printBon(media, document.querySelector('.bm-order-bon'))}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-6 text-sm font-black text-primary-foreground hover:bg-primary/90"
        >
          <LocalIcon name="ph:package-bold" className="text-lg" />
          <span>הדפסת הבון</span>
        </button>
      </div>

      <fieldset className="bm-no-print mx-auto mb-6 w-full max-w-2xl rounded-3xl border border-border bg-card p-4">
        <legend className="px-2 text-xs font-black text-muted-foreground">על מה מדפיסים?</legend>
        <div className="flex flex-wrap gap-2">
          {BON_MEDIA_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm font-black ${media === option.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-primary hover:bg-secondary'}`}
            >
              <input
                type="radio"
                name="bm-bon-media"
                value={option.value}
                checked={media === option.value}
                onChange={() => selectMedia(option.value)}
                className="sr-only"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        <p className="mt-3 text-xs font-bold text-muted-foreground">
          {BON_MEDIA_OPTIONS.find((option) => option.value === media)?.hint}
        </p>
      </fieldset>

      <OrderBon order={order} />
    </div>
  )
}

export default OrderBonScreen
