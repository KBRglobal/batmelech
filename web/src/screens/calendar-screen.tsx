import { useState } from 'react'
import { Link } from 'react-router'
import type { To } from 'react-router'
import { APP_ROUTES } from '../app/routes.ts'
import { LocalIcon } from '../components/local-icon.tsx'
import { ScreenState } from '../components/screen-state.tsx'
import { useStore } from '../data/use-store.ts'
import type { LegacyOrder, LegacyStore } from '../domain/store.ts'

/**
 * A month-at-a-glance planning view: how many orders and couple meals sit on
 * each service date, colored by load against the configured meal capacity.
 * Read-only — a day click opens that date's preparation summary.
 */

const CANCELLED_STATUSES = new Set(['בוטלה'])
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
const WEEKDAY_LABELS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'] as const

export interface CalendarDaySummary {
  readonly iso: string
  readonly orderCount: number
  readonly meals: number
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function mealsOf(order: Readonly<LegacyOrder>): number {
  const raw = order.meals
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/u.test(raw.trim()) ? Number(raw.trim()) : 0
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0
}

export function summarizeCalendarDays(store: Readonly<LegacyStore>): Map<string, CalendarDaySummary> {
  const days = new Map<string, CalendarDaySummary>()
  for (const order of store.orders) {
    if (CANCELLED_STATUSES.has(text(order.status))) continue
    const iso = text(order.date)
    if (!ISO_DATE_PATTERN.test(iso)) continue
    const existing = days.get(iso) ?? { iso, orderCount: 0, meals: 0 }
    days.set(iso, {
      iso,
      orderCount: existing.orderCount + 1,
      meals: existing.meals + mealsOf(order),
    })
  }
  return days
}

export function calendarCapacity(store: Readonly<LegacyStore>): number | null {
  const raw = store.settings?.maxMeals
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/u.test(raw.trim()) ? Number(raw.trim()) : null
  return parsed !== null && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function todayIsoInDubai(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date())
}

export interface CalendarMonth {
  readonly year: number
  readonly month: number
  readonly label: string
  /** Rows of 7 ISO dates (or null for cells outside the month), Sunday-first. */
  readonly weeks: readonly (readonly (string | null)[])[]
}

export function buildCalendarMonth(year: number, month: number): CalendarMonth {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const leadingBlanks = first.getUTCDay()
  const cells: (string | null)[] = Array.from({ length: leadingBlanks }, () => null)
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
  }
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: (string | null)[][] = []
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7))
  }
  const label = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first)
  return { year, month, label, weeks }
}

function preparationRoute(serviceDate: string): To {
  return {
    pathname: APP_ROUTES.preparation,
    search: `?${new URLSearchParams({ date: serviceDate }).toString()}`,
  }
}

function loadClassName(meals: number, capacity: number | null): string {
  if (meals === 0) return 'bg-card'
  if (capacity === null) return 'bg-secondary/70'
  if (meals >= capacity) return 'bg-rose-50 border-rose-200'
  if (meals >= capacity * 0.7) return 'bg-amber-50 border-amber-200'
  return 'bg-emerald-50 border-emerald-100'
}

export function CalendarScreen() {
  const storeQuery = useStore()
  const todayIso = todayIsoInDubai()
  const [cursor, setCursor] = useState(() => ({
    year: Number(todayIso.slice(0, 4)),
    month: Number(todayIso.slice(5, 7)),
  }))

  if (storeQuery.isPending) return <ScreenState kind="loading" title="טוענת את לוח השנה" />
  if (storeQuery.isError) {
    return (
      <ScreenState
        kind="error"
        title="לא הצלחנו לטעון את לוח השנה"
        retry={() => { void storeQuery.refetch() }}
      />
    )
  }

  const store = storeQuery.data.data ?? { orders: [] }
  const days = summarizeCalendarDays(store)
  const capacity = calendarCapacity(store)
  const view = buildCalendarMonth(cursor.year, cursor.month)

  const shiftMonth = (delta: number) => {
    setCursor((current) => {
      const index = current.year * 12 + (current.month - 1) + delta
      return { year: Math.floor(index / 12), month: (index % 12) + 1 }
    })
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-black tracking-tight text-primary sm:text-4xl">לוח שנה</h1>
          <p className="mt-2 text-sm font-bold text-muted-foreground">
            העומס של כל החודש במבט אחד. לחיצה על יום פותחת את סיכום ההכנות שלו.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="חודש קודם"
            onClick={() => shiftMonth(-1)}
            className="flex size-11 items-center justify-center rounded-xl border border-border bg-card text-primary hover:bg-secondary"
          >
            <LocalIcon name="ph:arrow-left-bold" className="rotate-180 text-lg" />
          </button>
          <span className="min-w-36 text-center text-lg font-black text-primary">{view.label}</span>
          <button
            type="button"
            aria-label="חודש הבא"
            onClick={() => shiftMonth(1)}
            className="flex size-11 items-center justify-center rounded-xl border border-border bg-card text-primary hover:bg-secondary"
          >
            <LocalIcon name="ph:arrow-left-bold" className="text-lg" />
          </button>
        </div>
      </header>

      <div className="mt-8 rounded-[2rem] border border-border bg-card p-4 shadow-sm sm:p-6">
        <div className="grid grid-cols-7 gap-2 text-center text-xs font-black text-muted-foreground">
          {WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}
        </div>
        <div className="mt-2 space-y-2">
          {view.weeks.map((week, weekIndex) => (
            <div key={weekIndex} className="grid grid-cols-7 gap-2">
              {week.map((iso, dayIndex) => {
                if (iso === null) return <span key={`blank-${dayIndex}`} aria-hidden="true" />
                const summary = days.get(iso)
                const isToday = iso === todayIso
                const body = (
                  <>
                    <span className={`text-sm font-black ${isToday ? 'text-primary-foreground' : 'text-primary'}`}>
                      {Number(iso.slice(8, 10))}
                    </span>
                    {summary !== undefined && (
                      <span className={`mt-1 block text-[0.65rem] font-black leading-4 ${isToday ? 'text-primary-foreground' : 'text-primary'}`}>
                        {summary.orderCount} הזמנות
                        <span className="block font-bold opacity-80">
                          {capacity === null ? `${summary.meals} זוגיות` : `${summary.meals}/${capacity} זוגיות`}
                        </span>
                      </span>
                    )}
                  </>
                )
                const cellClassName = `block min-h-20 rounded-2xl border p-2 text-right transition-colors ${
                  isToday ? 'border-primary bg-primary' : `border-border ${loadClassName(summary?.meals ?? 0, capacity)}`
                }`
                return summary !== undefined ? (
                  <Link
                    key={iso}
                    to={preparationRoute(iso)}
                    aria-label={`פתיחת ההכנות של ${iso}`}
                    className={`${cellClassName} hover:ring-2 hover:ring-primary/30`}
                  >
                    {body}
                  </Link>
                ) : (
                  <span key={iso} className={cellClassName}>{body}</span>
                )
              })}
            </div>
          ))}
        </div>
        {capacity === null && (
          <p className="mt-4 rounded-2xl bg-secondary p-3 text-xs font-bold text-muted-foreground">
            אפשר להגדיר תקרת זוגיות בהגדרות כדי לראות כאן צבעי עומס מדויקים לכל יום.
          </p>
        )}
      </div>
    </div>
  )
}

export default CalendarScreen
