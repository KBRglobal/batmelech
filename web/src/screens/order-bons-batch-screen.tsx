import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { APP_ROUTES } from '../app/routes.ts'
import { BonMediaPicker } from '../components/bon-media-picker.tsx'
import { LocalIcon } from '../components/local-icon.tsx'
import { OrderBon } from '../components/order-bon.tsx'
import { ScreenState } from '../components/screen-state.tsx'
import { useStore } from '../data/use-store.ts'
import { bonQrTargets } from '../domain/bon-qr.ts'
import { upcomingServiceDate } from '../domain/service-dates.ts'
import type { LegacyOrder } from '../domain/store.ts'
import {
  BON_PRINT_CSS,
  type BonMedia,
  printBons,
  rememberBonMedia,
  rememberedBonMedia,
} from '../services/bon-print.ts'

const CANCELLED = new Set(['בוטלה', 'cancelled', 'canceled'])
const EMPTY_ORDERS: readonly LegacyOrder[] = []

function text(value: unknown): string {
  return typeof value === 'string' && value.length <= 10_000 ? value.trim() : ''
}

function active(order: Readonly<LegacyOrder>): boolean {
  return !CANCELLED.has(text(order.status).toLocaleLowerCase('he-IL'))
}

function realDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
}

function dateLabel(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Intl.DateTimeFormat('he-IL', {
    weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC',
  }).format(new Date(Date.UTC(year!, month! - 1, day)))
}

function orderSort(a: Readonly<LegacyOrder>, b: Readonly<LegacyOrder>): number {
  return text(a.time).localeCompare(text(b.time), 'he')
    || text(a.name).localeCompare(text(b.name), 'he')
    || String(a.id).localeCompare(String(b.id), 'en')
}

export function OrderBonsBatchScreen() {
  const storeQuery = useStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const [media, setMedia] = useState<BonMedia>(rememberedBonMedia())

  const orders = storeQuery.data?.data?.orders ?? EMPTY_ORDERS
  const dates = useMemo(
    () => [...new Set(orders.filter(active).map((order) => order.date).filter(realDate))].sort(),
    [orders],
  )
  const requestedDate = searchParams.get('date') ?? ''
  const selectedDate = realDate(requestedDate) ? requestedDate : (upcomingServiceDate(dates) ?? '')
  const scopedOrders = useMemo(
    () => orders.filter((order) => active(order) && order.date === selectedDate).sort(orderSort),
    [orders, selectedDate],
  )

  if (storeQuery.isPending) return <ScreenState kind="loading" title="טוענת את הבונים" />
  if (storeQuery.isError) {
    return (
      <ScreenState
        kind="error"
        title="לא הצלחנו לטעון את הבונים"
        retry={() => { void storeQuery.refetch() }}
      />
    )
  }
  if (dates.length === 0) {
    return (
      <ScreenState
        kind="empty"
        title="אין הזמנות לבונים"
        description="אין הזמנות פעילות עם תאריך תקין."
        action={{ label: 'חזרה להכנות', to: APP_ROUTES.preparation }}
      />
    )
  }
  if (requestedDate && !realDate(requestedDate)) {
    return (
      <ScreenState
        kind="error"
        title="תאריך הבונים אינו תקין"
        description="לא נבחרו הזמנות כדי למנוע הדפסה לתאריך שגוי."
      />
    )
  }

  const selectMedia = (value: BonMedia) => {
    rememberBonMedia(value)
    setMedia(value)
  }

  return (
    <div className="min-h-full bg-background px-5 py-8 sm:px-8" dir="rtl">
      <style>{BON_PRINT_CSS}</style>

      <div className="bm-no-print mx-auto w-full max-w-2xl">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-heading text-3xl font-black text-primary">בונים לכל ההזמנות</h1>
            <p className="mt-2 text-sm font-bold text-muted-foreground">בון אחד לכל הזמנה פעילה בתאריך שנבחר, כל בון בעמוד נפרד.</p>
          </div>
          <Link
            to={{ pathname: APP_ROUTES.preparation, search: `?${new URLSearchParams({ date: selectedDate })}` }}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-5 text-sm font-black text-primary hover:bg-secondary"
          >
            <LocalIcon name="ph:arrow-left-bold" className="rotate-180 text-lg" />
            <span>חזרה להכנות</span>
          </Link>
        </header>

        <label className="mt-6 block max-w-xs text-xs font-black text-muted-foreground">
          תאריך להדפסה
          <select
            aria-label="תאריך לבונים"
            value={selectedDate}
            onChange={(event) => setSearchParams({ date: event.currentTarget.value })}
            className="mt-2 min-h-11 w-full rounded-2xl border border-border bg-card px-4 text-sm font-black text-primary"
          >
            {dates.map((date) => <option key={date} value={date}>{dateLabel(date)}</option>)}
          </select>
        </label>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-black text-primary">{scopedOrders.length} בונים להדפסה</p>
          <button
            type="button"
            disabled={scopedOrders.length === 0}
            onClick={() => printBons(media, document.querySelectorAll('.bm-bon-sheet .bm-order-bon'))}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-6 text-sm font-black text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <LocalIcon name="ph:receipt-bold" className="text-lg" />
            <span>הדפסת כל הבונים</span>
          </button>
        </div>

        {media === 'roll' && scopedOrders.length > 1 && (
          <p className="mt-3 text-xs font-bold text-muted-foreground">
            על הגליל כל הבונים מודפסים באורך של הבון הארוך ביותר — זו מגבלה של הדפדפן, שמאפשר גודל עמוד אחד להדפסה.
          </p>
        )}
      </div>

      {scopedOrders.length === 0
        ? (
          <p className="bm-no-print mx-auto mt-8 w-full max-w-2xl rounded-2xl bg-card p-5 text-sm font-bold text-muted-foreground">
            אין הזמנות פעילות בתאריך שנבחר.
          </p>
        )
        : (
          <div className="mt-8">
            <BonMediaPicker value={media} onChange={selectMedia} />
            <div className="bm-bon-sheet space-y-8">
              {scopedOrders.map((order) => (
                <OrderBon
                  key={String(order.id)}
                  order={order}
                  qr={bonQrTargets(order, storeQuery.data?.data ?? { orders: [] })}
                />
              ))}
            </div>
          </div>
        )}
    </div>
  )
}

export default OrderBonsBatchScreen
