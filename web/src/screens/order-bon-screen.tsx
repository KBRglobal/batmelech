import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { APP_ROUTES } from '../app/routes.ts'
import { BonMediaPicker } from '../components/bon-media-picker.tsx'
import { LocalIcon } from '../components/local-icon.tsx'
import { OrderBon } from '../components/order-bon.tsx'
import { ScreenState } from '../components/screen-state.tsx'
import { useStore } from '../data/use-store.ts'
import { bonQrTargets } from '../domain/bon-qr.ts'
import { CANONICAL_ORDER_ID_PATTERN } from '../domain/order-editor.ts'
import {
  loadSettingsCatalog,
  orderKitchenNotes,
  type OrderKitchenNotes,
} from '../domain/settings-catalog.ts'
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

/**
 * A second printed strip for the kitchen: the order's allergen union in one
 * bold line at the top, then the heating instructions under each dish that has
 * them. Rendered only when there is something to print, and carrying the
 * `bm-order-bon` hooks so the QL-800 roll sizing and length measurement apply
 * to it exactly as to the customer bon.
 */
function KitchenBon({ orderId, notes }: { readonly orderId: string; readonly notes: OrderKitchenNotes }) {
  return (
    <article
      className="bm-order-bon bm-kitchen-bon mx-auto mt-6 w-full max-w-2xl rounded-[2rem] border-2 border-dotted border-primary bg-card p-6 shadow-sm sm:p-10"
      data-order-id={orderId}
      dir="rtl"
    >
      <h2 className="bm-bon-date text-center text-base font-black text-primary">בון מטבח — הזמנה {orderId}</h2>
      {notes.allergens.length > 0 && (
        <p className="bm-bon-allergens bm-bon-total mt-4 border-t-2 border-primary pt-3 text-center text-base font-black text-primary">
          אלרגנים בהזמנה: {notes.allergens.join(', ')}
        </p>
      )}
      {notes.heating.length > 0 && (
        <dl className="bm-bon-fields mt-4 text-sm leading-6">
          {notes.heating.map((dish) => (
            <div
              key={dish.name}
              className="bm-bon-row flex gap-2 border-b border-dotted border-border/70 py-1.5 last:border-b-0"
            >
              <dt className="bm-bon-label shrink-0 font-black text-primary">{dish.name}:</dt>
              <dd className="bm-bon-value min-w-0 flex-1 font-semibold text-foreground">
                חימום: {dish.heatingInstructions}
              </dd>
            </div>
          ))}
        </dl>
      )}
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
  const kitchenNotes = orderKitchenNotes(
    order,
    loadSettingsCatalog(storeQuery.data?.data ?? { orders: [] }).catalog,
  )
  const hasKitchenNotes = kitchenNotes.allergens.length > 0 || kitchenNotes.heating.length > 0
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
        <OrderBon order={order} qr={bonQrTargets(order, storeQuery.data?.data ?? { orders: [] })} />
        {hasKitchenNotes && <KitchenBon orderId={orderId} notes={kitchenNotes} />}
      </div>
    </div>
  )
}

export default OrderBonScreen
