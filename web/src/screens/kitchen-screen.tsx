import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { LocalIcon } from '../components/local-icon.tsx'
import { ScreenState } from '../components/screen-state.tsx'
import type { PreparationCompletionCategory } from '../domain/operational-state.ts'
import { buildPreparationPlan, type PreparationDateGroup } from '../domain/preparation.ts'
import { upcomingServiceDate } from '../domain/service-dates.ts'
import { resolvePreparationCatalog } from '../domain/settings-catalog.ts'
import type { LegacyStore } from '../domain/store.ts'

// מצב מטבח: a full-screen board for a wall tablet, deliberately the simplest
// UI possible (Moshe). Two boards:
// - dishes: every prep item cycles stage on tap — לא התחיל → התחלתי להכין →
//   מוכן → ארוז → back. 'ארוז' is stored as the same boolean the preparation
//   screen calls completed; the intermediate stages are strings in prepDone.
// - orders: the day's orders with one-tap status chips.
// Both the tablet surface (/kitchen, its own login) and the admin variant
// (/admin/kitchen, staff session) speak to the same /api/kitchen endpoints.

const REFRESH_INTERVAL_MS = 30_000

type PrepStage = 'none' | 'started' | 'ready' | 'packed'

const STAGE_ORDER: readonly PrepStage[] = ['none', 'started', 'ready', 'packed']

const STAGE_LABELS: Readonly<Record<Exclude<PrepStage, 'none'>, string>> = {
  started: 'התחלתי להכין',
  ready: 'מוכן',
  packed: 'ארוז',
}

const STAGE_CARD_CLASSES: Readonly<Record<PrepStage, string>> = {
  none: 'border-white/20 bg-white/10 hover:bg-white/15',
  started: 'border-amber-300/70 bg-amber-400/20',
  ready: 'border-emerald-300/70 bg-emerald-500/25',
  packed: 'border-sky-300/60 bg-sky-500/20 text-primary-foreground/60',
}

const ORDER_STATUSES = ['חדשה', 'אושרה', 'מוכנה', 'במשלוח', 'נמסרה'] as const

interface KitchenRow {
  readonly category: PreparationCompletionCategory
  readonly name: string
  readonly quantity: number
}

interface KitchenGroup {
  readonly title: string
  readonly rows: readonly KitchenRow[]
}

function kitchenGroups(group: PreparationDateGroup): readonly KitchenGroup[] {
  const categories = group.categories
  const numberRows = (
    category: PreparationCompletionCategory,
    values: Readonly<Record<string, number>>,
  ): KitchenRow[] =>
    Object.entries(values)
      .filter(([, quantity]) => quantity > 0)
      .map(([name, quantity]) => ({ category, name, quantity }))
      .sort((a, b) => a.name.localeCompare(b.name, 'he'))
  const saladRows: KitchenRow[] = Object.entries(categories.salads)
    .filter(([, quantity]) => quantity.total > 0)
    .map(([name, quantity]) => ({ category: 'salads' as const, name, quantity: quantity.total }))
    .sort((a, b) => a.name.localeCompare(b.name, 'he'))
  return [
    { title: 'סלטים', rows: saladRows },
    { title: 'ראשונות', rows: numberRows('firsts', categories.firsts) },
    { title: 'עיקריות', rows: numberRows('mains', categories.mains) },
    { title: 'תוספות', rows: numberRows('sides', categories.sides) },
    { title: 'קינוחים', rows: numberRows('desserts', categories.desserts) },
    { title: 'אקסטרות', rows: numberRows('extras', categories.extras) },
    { title: 'מותאמים', rows: numberRows('custom', categories.custom) },
    { title: 'צהריים', rows: numberRows('lunch', categories.lunch) },
  ].filter((section) => section.rows.length > 0)
}

function stageOf(store: LegacyStore, serviceDate: string, row: KitchenRow): PrepStage {
  const root = (store as Record<string, unknown>).prepDone
  if (typeof root !== 'object' || root === null) return 'none'
  const scope = (root as Record<string, unknown>)[serviceDate]
  if (typeof scope !== 'object' || scope === null) return 'none'
  const value = (scope as Record<string, unknown>)[`${row.category}|${row.name}`]
  if (value === true) return 'packed'
  if (value === 'started' || value === 'ready') return value
  return 'none'
}

function nextStage(stage: PrepStage): PrepStage {
  return STAGE_ORDER[(STAGE_ORDER.indexOf(stage) + 1) % STAGE_ORDER.length]!
}

function formatKitchenDate(serviceDate: string): string {
  const [year, month, day] = serviceDate.split('-').map(Number)
  return new Intl.DateTimeFormat('he-IL', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year!, month! - 1, day)))
}

// The wall tablet must never dim mid-service.
function useScreenWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null
    let disposed = false
    const acquire = async () => {
      try {
        const wakeLock = (navigator as Navigator & {
          wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> }
        }).wakeLock
        if (!wakeLock) return
        const acquired = await wakeLock.request('screen')
        if (disposed) void acquired.release()
        else lock = acquired
      } catch {
        lock = null
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire()
    }
    void acquire()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibility)
      if (lock) void lock.release()
    }
  }, [])
}

function useClock(): string {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return new Intl.DateTimeFormat('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Dubai',
  }).format(now)
}

interface KitchenOrder {
  readonly id: string
  readonly name: string
  readonly time: string
  readonly destination: string
  readonly status: string
}

function kitchenOrders(store: LegacyStore, serviceDate: string): readonly KitchenOrder[] {
  return (store.orders ?? [])
    .filter((order) => order.date === serviceDate)
    .filter((order) => {
      const status = typeof order.status === 'string' ? order.status : ''
      return status !== 'בוטלה' && status.toLowerCase() !== 'cancelled' && status.toLowerCase() !== 'canceled'
    })
    .flatMap((order) => {
      const id = typeof order.id === 'string' || typeof order.id === 'number' ? String(order.id) : ''
      if (id === '') return []
      return [{
        id,
        name: typeof order.name === 'string' && order.name.trim() !== '' ? order.name.trim() : 'ללא שם',
        time: typeof order.time === 'string' ? order.time : '',
        destination: order.pickup === true
          ? 'איסוף עצמי'
          : typeof order.hotelName === 'string' && order.hotelName.trim() !== ''
            ? order.hotelName.trim()
            : typeof order.place === 'string'
              ? order.place.trim()
              : '',
        status: typeof order.status === 'string' && order.status.trim() !== '' ? order.status.trim() : 'חדשה',
      }]
    })
    .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'))
}

export function KitchenScreen({ exitTo = null }: { readonly exitTo?: string | null }) {
  const [store, setStore] = useState<LegacyStore | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saveIssue, setSaveIssue] = useState<string | null>(null)
  const [board, setBoard] = useState<'dishes' | 'orders'>('dishes')
  const [searchParams, setSearchParams] = useSearchParams()
  const busyRef = useRef(false)
  const clock = useClock()
  useScreenWakeLock()

  const load = async () => {
    try {
      const response = await fetch('/api/kitchen/state', {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
      })
      if (response.status === 401) {
        window.location.reload()
        return
      }
      if (!response.ok) throw new Error('kitchen state failed')
      const body: unknown = await response.json()
      const data = (body as { data?: unknown }).data
      if (typeof data !== 'object' || data === null || !Array.isArray((data as { orders?: unknown }).orders)) {
        throw new Error('kitchen state invalid')
      }
      setStore(data as LegacyStore)
      setLoadFailed(false)
    } catch {
      setLoadFailed(true)
    }
  }

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => {
      if (!busyRef.current) void load()
    }, REFRESH_INTERVAL_MS)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const post = async (path: string, body: Record<string, unknown>) => {
    if (busyRef.current) return
    busyRef.current = true
    setSaveIssue(null)
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      })
      if (response.status === 401) {
        window.location.reload()
        return
      }
      if (!response.ok) throw new Error('save failed')
    } catch {
      setSaveIssue('לא נשמר. אפשר לנסות שוב.')
    } finally {
      busyRef.current = false
      void load()
    }
  }

  if (store === null && !loadFailed) return <ScreenState kind="loading" title="טוענת את לוח המטבח" />
  if (store === null) {
    return <ScreenState kind="error" title="לא הצלחנו לטעון את לוח המטבח" retry={() => { void load() }} />
  }

  const plan = buildPreparationPlan(store.orders, resolvePreparationCatalog(store).catalog)
  const availableDates = plan.dates.map(({ serviceDate }) => serviceDate)
  const requestedDate = searchParams.get('date')?.trim() ?? ''
  const selectedDate = availableDates.includes(requestedDate)
    ? requestedDate
    : upcomingServiceDate(availableDates) ?? ''
  const group = plan.dates.find(({ serviceDate }) => serviceDate === selectedDate) ?? null
  const sections = group ? kitchenGroups(group) : []
  const allRows = sections.flatMap((section) => section.rows)
  const packedCount = group
    ? allRows.filter((row) => stageOf(store, group.serviceDate, row) === 'packed').length
    : 0
  const orders = group ? kitchenOrders(store, group.serviceDate) : []

  return (
    <div dir="rtl" className="min-h-screen bg-primary text-primary-foreground">
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-4 border-b border-white/15 bg-primary/95 px-6 py-4 backdrop-blur">
        <div className="flex items-center gap-4">
          <LocalIcon name="ph:cooking-pot-bold" className="text-4xl" />
          <div>
            <h1 className="font-heading text-3xl font-black leading-none">מצב מטבח</h1>
            {group && <p className="mt-1 text-lg font-bold text-primary-foreground/70">{formatKitchenDate(group.serviceDate)} · {group.orderCount} הזמנות</p>}
          </div>
        </div>
        <div className="flex items-center gap-5">
          {board === 'dishes' && group && allRows.length > 0 && (
            <div className="text-left">
              <span className="block text-3xl font-black leading-none" dir="ltr">{packedCount}/{allRows.length}</span>
              <span className="text-xs font-bold text-primary-foreground/70">ארוזים</span>
            </div>
          )}
          <span className="text-3xl font-black tabular-nums" dir="ltr">{clock}</span>
          {exitTo && (
            <Link
              to={exitTo}
              aria-label="יציאה למסך ההכנות"
              className="flex size-11 items-center justify-center rounded-full border border-white/25 text-primary-foreground/80 hover:bg-white/10"
            >
              <LocalIcon name="ph:sign-out-bold" className="text-xl" />
            </Link>
          )}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 px-6 py-3">
        <button
          type="button"
          onClick={() => setBoard('dishes')}
          className={`min-h-11 rounded-full px-6 text-sm font-black ${board === 'dishes' ? 'bg-white text-primary' : 'border border-white/25 text-primary-foreground/80 hover:bg-white/10'}`}
        >
          מנות להכנה
        </button>
        <button
          type="button"
          onClick={() => setBoard('orders')}
          className={`min-h-11 rounded-full px-6 text-sm font-black ${board === 'orders' ? 'bg-white text-primary' : 'border border-white/25 text-primary-foreground/80 hover:bg-white/10'}`}
        >
          הזמנות היום
        </button>
        {availableDates.length > 1 && (
          <nav aria-label="בחירת תאריך" className="flex gap-2 overflow-x-auto">
            {availableDates.map((date) => (
              <button
                key={date}
                type="button"
                onClick={() => setSearchParams(date === selectedDate ? {} : { date })}
                className={`min-h-11 shrink-0 rounded-full px-5 text-sm font-black ${date === selectedDate ? 'bg-white/90 text-primary' : 'border border-white/25 text-primary-foreground/70 hover:bg-white/10'}`}
              >
                {formatKitchenDate(date)}
              </button>
            ))}
          </nav>
        )}
      </div>

      {saveIssue && (
        <p role="alert" className="mx-6 mt-1 rounded-2xl bg-rose-100 p-4 text-lg font-black text-rose-950">{saveIssue}</p>
      )}

      {board === 'dishes' ? (
        !group || allRows.length === 0 ? (
          <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-primary-foreground/70">
            <LocalIcon name="ph:check-circle-bold" className="text-7xl" />
            <p className="text-3xl font-black">אין הכנות לתאריך הזה</p>
          </div>
        ) : (
          <main className="grid grid-cols-1 gap-6 p-6 md:grid-cols-2 xl:grid-cols-3">
            {sections.map((section) => (
              <section key={section.title} aria-label={section.title} className="space-y-3">
                <h2 className="border-r-8 border-white/40 pr-4 text-2xl font-black text-primary-foreground/80">{section.title}</h2>
                <ul className="space-y-3">
                  {section.rows.map((row) => {
                    const stage = stageOf(store, group.serviceDate, row)
                    return (
                      <li key={`${row.category}|${row.name}`}>
                        <button
                          type="button"
                          onClick={() => {
                            void post('/api/kitchen/prep-stage', {
                              serviceDate: group.serviceDate,
                              category: row.category,
                              itemName: row.name,
                              stage: nextStage(stage),
                            })
                          }}
                          className={`flex min-h-20 w-full items-center justify-between gap-4 rounded-3xl border-2 px-6 text-right transition-colors ${STAGE_CARD_CLASSES[stage]}`}
                        >
                          <span className="min-w-0">
                            <span className={`block text-3xl font-black leading-tight ${stage === 'packed' ? 'line-through' : ''}`}>{row.name}</span>
                            {stage !== 'none' && (
                              <span className="mt-1 block text-base font-black opacity-80">{STAGE_LABELS[stage]}</span>
                            )}
                          </span>
                          <span className="text-4xl font-black tabular-nums" dir="ltr">×{row.quantity}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </main>
        )
      ) : (
        <main className="space-y-4 p-6">
          {orders.length === 0 ? (
            <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-primary-foreground/70">
              <LocalIcon name="ph:check-circle-bold" className="text-7xl" />
              <p className="text-3xl font-black">אין הזמנות לתאריך הזה</p>
            </div>
          ) : orders.map((order) => (
            <section key={order.id} aria-label={`הזמנה של ${order.name}`} className="rounded-3xl border-2 border-white/20 bg-white/10 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-3xl font-black leading-tight">{order.name}</h2>
                  <p className="mt-1 text-lg font-bold text-primary-foreground/70">
                    {order.time && <span dir="ltr">{order.time}</span>}
                    {order.time && order.destination && ' · '}
                    {order.destination}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {ORDER_STATUSES.map((status) => (
                  <button
                    key={status}
                    type="button"
                    aria-pressed={order.status === status}
                    onClick={() => {
                      if (order.status !== status) {
                        void post('/api/kitchen/order-status', { orderId: order.id, status })
                      }
                    }}
                    className={`min-h-14 rounded-2xl px-6 text-xl font-black transition-colors ${
                      order.status === status
                        ? 'bg-white text-primary shadow-lg'
                        : 'border-2 border-white/25 text-primary-foreground/80 hover:bg-white/10'
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </main>
      )}
    </div>
  )
}

// The tablet surface at /kitchen — same board, no exit link into the panel.
export function KitchenStandaloneScreen() {
  return <KitchenScreen exitTo={null} />
}

export default KitchenScreen
