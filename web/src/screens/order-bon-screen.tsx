import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { APP_ROUTES } from '../app/routes.ts'
import { BonMediaPicker } from '../components/bon-media-picker.tsx'
import { LocalIcon } from '../components/local-icon.tsx'
import { OrderBon } from '../components/order-bon.tsx'
import { ScreenState } from '../components/screen-state.tsx'
import { useStore } from '../data/use-store.ts'
import { CANONICAL_ORDER_ID_PATTERN } from '../domain/order-editor.ts'
import {
  BON_PRINT_CSS,
  type BonMedia,
  printBons,
  rememberBonMedia,
  rememberedBonMedia,
} from '../services/bon-print.ts'

function isSafeRouteOrderId(value: string | undefined): value is string {
  return value !== undefined && CANONICAL_ORDER_ID_PATTERN.test(value)
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
          onClick={() => printBons(media, document.querySelectorAll('.bm-bon-sheet .bm-order-bon'))}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-6 text-sm font-black text-primary-foreground hover:bg-primary/90"
        >
          <LocalIcon name="ph:package-bold" className="text-lg" />
          <span>הדפסת הבון</span>
        </button>
      </div>

      <BonMediaPicker value={media} onChange={selectMedia} />

      <div className="bm-bon-sheet">
        <OrderBon order={order} />
      </div>
    </div>
  )
}

export default OrderBonScreen
