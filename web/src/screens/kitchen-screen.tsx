import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { APP_ROUTES } from '../app/routes.ts'
import { LocalIcon } from '../components/local-icon.tsx'
import { ScreenState } from '../components/screen-state.tsx'
import {
  isSameVersionedStateEnvelope,
  type ConfirmedStoreSaveHandler,
} from '../data/versioned-screen-save.tsx'
import { useStore } from '../data/use-store.ts'
import {
  applyPreparationCompletion,
  isPreparationCompleted,
  type PreparationCompletionCategory,
} from '../domain/operational-state.ts'
import { buildPreparationPlan, type PreparationDateGroup } from '../domain/preparation.ts'
import { upcomingServiceDate } from '../domain/service-dates.ts'
import { resolvePreparationCatalog } from '../domain/settings-catalog.ts'
import type { LegacyStore } from '../domain/store.ts'
import { isVersionedStateEnvelope, type VersionedStateEnvelope } from '../services/state-api.ts'

// מצב מטבח: a full-screen board for a wall tablet. Today's prep in huge
// type, one tap marks a dish done (the same prepDone map the preparation
// screen uses), auto-refresh every 30 seconds, and a screen wake lock so a
// cheap tablet never sleeps mid-service.
//
// Two mounts share the same board:
// - /admin/kitchen (KitchenScreen): staff session, saves via the versioned
//   state flow like every admin screen.
// - /kitchen (KitchenStandaloneScreen): the tablet surface, its own
//   kitchen-only login, reads a whitelisted projection and can ONLY toggle
//   prep marks through /api/kitchen — nothing else is possible from there.

const REFRESH_INTERVAL_MS = 30_000

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

function formatKitchenDate(serviceDate: string): string {
  const [year, month, day] = serviceDate.split('-').map(Number)
  return new Intl.DateTimeFormat('he-IL', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year!, month! - 1, day)))
}

// The wall tablet must never dim mid-service. Reacquired on every return to
// the foreground; quietly absent on browsers without the API.
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

function KitchenBoard({
  store,
  saveIssue,
  onToggle,
  exitTo,
}: {
  readonly store: LegacyStore
  readonly saveIssue: string | null
  readonly onToggle: ((row: KitchenRow, serviceDate: string) => void) | null
  readonly exitTo: string | null
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const clock = useClock()
  useScreenWakeLock()

  const plan = buildPreparationPlan(store.orders, resolvePreparationCatalog(store).catalog)
  const availableDates = plan.dates.map(({ serviceDate }) => serviceDate)
  const requestedDate = searchParams.get('date')?.trim() ?? ''
  const selectedDate = availableDates.includes(requestedDate)
    ? requestedDate
    : upcomingServiceDate(availableDates) ?? ''
  const group = plan.dates.find(({ serviceDate }) => serviceDate === selectedDate) ?? null
  const sections = group ? kitchenGroups(group) : []
  const allRows = sections.flatMap((section) => section.rows)
  const doneCount = group
    ? allRows.filter((row) => isPreparationCompleted(store, group.serviceDate, row.category, row.name)).length
    : 0

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
          {group && allRows.length > 0 && (
            <div className="text-left">
              <span className="block text-3xl font-black leading-none" dir="ltr">{doneCount}/{allRows.length}</span>
              <span className="text-xs font-bold text-primary-foreground/70">הוכנו</span>
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

      {availableDates.length > 1 && (
        <nav aria-label="בחירת תאריך" className="flex gap-2 overflow-x-auto px-6 py-3">
          {availableDates.map((date) => (
            <button
              key={date}
              type="button"
              onClick={() => setSearchParams(date === selectedDate ? {} : { date })}
              className={`min-h-11 shrink-0 rounded-full px-5 text-sm font-black ${date === selectedDate ? 'bg-white text-primary' : 'border border-white/25 text-primary-foreground/80 hover:bg-white/10'}`}
            >
              {formatKitchenDate(date)}
            </button>
          ))}
        </nav>
      )}

      {saveIssue && (
        <p role="alert" className="mx-6 mt-4 rounded-2xl bg-rose-100 p-4 text-lg font-black text-rose-950">{saveIssue}</p>
      )}

      {!group || allRows.length === 0 ? (
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
                  const completed = isPreparationCompleted(store, group.serviceDate, row.category, row.name)
                  return (
                    <li key={`${row.category}|${row.name}`}>
                      <button
                        type="button"
                        aria-pressed={completed}
                        disabled={onToggle === null}
                        onClick={() => onToggle?.(row, group.serviceDate)}
                        className={`flex min-h-20 w-full items-center justify-between gap-4 rounded-3xl border-2 px-6 text-right transition-colors ${
                          completed
                            ? 'border-emerald-300/60 bg-emerald-500/25 text-primary-foreground/60'
                            : 'border-white/20 bg-white/10 hover:bg-white/15'
                        }`}
                      >
                        <span className={`text-3xl font-black leading-tight ${completed ? 'line-through' : ''}`}>{row.name}</span>
                        <span className="flex items-center gap-3">
                          <span className="text-4xl font-black tabular-nums" dir="ltr">×{row.quantity}</span>
                          <LocalIcon
                            name="ph:check-circle-bold"
                            className={`text-4xl ${completed ? 'text-emerald-300' : 'text-white/25'}`}
                          />
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </main>
      )}
    </div>
  )
}

export function KitchenScreen({ onSave }: { readonly onSave?: ConfirmedStoreSaveHandler }) {
  const storeQuery = useStore()
  const writeInFlightRef = useRef(false)
  const acceptedEnvelopeRef = useRef<VersionedStateEnvelope | null>(null)
  const [saveIssue, setSaveIssue] = useState<string | null>(null)

  // The board follows the live data: refetch on an interval, skipping only
  // while a tap is being saved so the base envelope stays stable.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!writeInFlightRef.current) void storeQuery.refetch()
    }, REFRESH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [storeQuery])

  if (storeQuery.isPending) return <ScreenState kind="loading" title="טוענת את לוח המטבח" />
  if (storeQuery.isError) {
    return (
      <ScreenState
        kind="error"
        title="לא הצלחנו לטעון את לוח המטבח"
        retry={() => { void storeQuery.refetch() }}
      />
    )
  }

  const envelope = acceptedEnvelopeRef.current !== null &&
    isSameVersionedStateEnvelope(storeQuery.data, acceptedEnvelopeRef.current)
    ? acceptedEnvelopeRef.current
    : isVersionedStateEnvelope(storeQuery.data)
      ? storeQuery.data
      : null
  if (envelope === null) {
    return <ScreenState kind="error" title="לא נטענה גרסה מאומתת של הנתונים" retry={() => { void storeQuery.refetch() }} />
  }
  const store: LegacyStore = envelope.data

  const toggle = async (row: KitchenRow, serviceDate: string) => {
    if (!onSave || writeInFlightRef.current) return
    const completed = !isPreparationCompleted(store, serviceDate, row.category, row.name)
    let nextStore: LegacyStore
    try {
      nextStore = applyPreparationCompletion(store, serviceDate, row.category, row.name, completed)
    } catch {
      setSaveIssue('הסימון לא נשמר — זהות הפריט אינה בטוחה.')
      return
    }
    writeInFlightRef.current = true
    setSaveIssue(null)
    try {
      const confirmed = await onSave({
        reason: 'kitchen',
        baseEnvelope: envelope,
        baseStore: store,
        nextStore,
      })
      acceptedEnvelopeRef.current = confirmed
    } catch {
      setSaveIssue('הסימון לא נשמר. המסך יתרענן ואפשר לנסות שוב.')
    } finally {
      writeInFlightRef.current = false
      void storeQuery.refetch()
    }
  }

  return (
    <KitchenBoard
      store={store}
      saveIssue={saveIssue}
      onToggle={(row, serviceDate) => { void toggle(row, serviceDate) }}
      exitTo={APP_ROUTES.preparation}
    />
  )
}

// The tablet surface at /kitchen: kitchen login only, no staff session, no
// admin API. A 401 means the kitchen cookie expired — reloading brings the
// login page back.
export function KitchenStandaloneScreen() {
  const [store, setStore] = useState<LegacyStore | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saveIssue, setSaveIssue] = useState<string | null>(null)
  const busyRef = useRef(false)

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

  if (store === null && !loadFailed) return <ScreenState kind="loading" title="טוענת את לוח המטבח" />
  if (store === null) {
    return (
      <ScreenState
        kind="error"
        title="לא הצלחנו לטעון את לוח המטבח"
        retry={() => { void load() }}
      />
    )
  }

  const toggle = async (row: KitchenRow, serviceDate: string) => {
    if (busyRef.current) return
    busyRef.current = true
    setSaveIssue(null)
    const completed = !isPreparationCompleted(store, serviceDate, row.category, row.name)
    try {
      const response = await fetch('/api/kitchen/prep-toggle', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ serviceDate, category: row.category, itemName: row.name, completed }),
      })
      if (response.status === 401) {
        window.location.reload()
        return
      }
      if (!response.ok) throw new Error('toggle failed')
    } catch {
      setSaveIssue('הסימון לא נשמר. אפשר לנסות שוב.')
    } finally {
      busyRef.current = false
      void load()
    }
  }

  return (
    <KitchenBoard
      store={store}
      saveIssue={saveIssue}
      onToggle={(row, serviceDate) => { void toggle(row, serviceDate) }}
      exitTo={null}
    />
  )
}

export default KitchenScreen
