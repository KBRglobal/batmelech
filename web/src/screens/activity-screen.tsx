import { useState } from 'react'
import { generatePath, Link } from 'react-router'
import { APP_ROUTES } from '../app/routes.ts'
import { LocalIcon, type LocalIconName } from '../components/local-icon.tsx'
import { ScreenState } from '../components/screen-state.tsx'
import { useStore } from '../data/use-store.ts'
import type { LegacyOrder, LegacyStore } from '../domain/store.ts'

// Activity feed (roadmap #29): a readable, human timeline derived ENTIRELY
// from order data — no new storage. Honest about time: only moments the data
// actually stamps (deliveredAt, deliveryProofAt, מיי's audit log) appear on
// the clock timeline; everything else (order created, current status, paid)
// has no timestamp in the legacy store, so those orders are listed under an
// explicit "ללא זמן מדויק" section by their service date instead of being
// assigned an invented moment.

const DUBAI_TIME_ZONE = 'Asia/Dubai'
const SERVICE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u

export type ActivityCategory = 'orders' | 'deliveries' | 'mey'

export interface TimedActivityEvent {
  readonly key: string
  readonly at: number
  readonly category: Exclude<ActivityCategory, 'orders'>
  readonly icon: LocalIconName
  readonly title: string
  readonly detail: string | null
  readonly orderId: string | null
}

export interface UndatedOrderLine {
  readonly key: string
  readonly serviceDate: string | null
  readonly name: string
  readonly detail: string
  readonly orderId: string | null
}

export interface ActivityDayGroup {
  readonly dayKey: string
  readonly label: string
  readonly events: readonly TimedActivityEvent[]
}

export interface ActivityFeed {
  readonly days: readonly ActivityDayGroup[]
  readonly undated: readonly UndatedOrderLine[]
}

const FILTERS = [
  { value: 'all', label: 'הכל' },
  { value: 'orders', label: 'הזמנות' },
  { value: 'deliveries', label: 'משלוחים' },
  { value: 'mey', label: 'מיי' },
] as const

type FilterValue = (typeof FILTERS)[number]['value']

const dayKeyFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: DUBAI_TIME_ZONE })
const dayLabelFormatter = new Intl.DateTimeFormat('he-IL', {
  dateStyle: 'full',
  timeZone: DUBAI_TIME_ZONE,
})
const timeFormatter = new Intl.DateTimeFormat('he-IL', {
  timeStyle: 'short',
  timeZone: DUBAI_TIME_ZONE,
})

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function orderIdOf(order: LegacyOrder): string | null {
  if (typeof order.id === 'number' && Number.isFinite(order.id)) return String(order.id)
  if (typeof order.id === 'string' && order.id.trim() !== '') return order.id
  return null
}

function orderNameOf(order: LegacyOrder): string {
  return cleanText(order.name) || 'ללא שם'
}

function finiteTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function sourceLabel(order: LegacyOrder): string {
  const source = cleanText(order.source)
  if (source === 'site') return 'נקלטה מהאתר'
  if (source === 'mey-whatsapp') return 'נקלטה דרך מיי בוואטסאפ'
  return 'נרשמה בפאנל'
}

function paidLabel(order: LegacyOrder): string {
  const paid = cleanText(order.paid)
  if (paid === 'כן') return 'שולם'
  if (paid === '' || paid === 'לא') return 'לא שולם'
  return paid
}

function statusLabel(order: LegacyOrder): string {
  return cleanText(order.status) || 'חדשה'
}

function serviceDateOf(order: LegacyOrder): string | null {
  const raw = cleanText(order.date)
  return SERVICE_DATE_PATTERN.test(raw) ? raw : null
}

interface AuditEntryLike {
  readonly at: number
  readonly summary: string
  readonly undone: boolean
  readonly key: string
}

// settings.meyAuditLog is server-written and outside the typed store schema;
// read it defensively and keep only entries with a real timestamp + summary.
function auditEntriesOf(store: LegacyStore): AuditEntryLike[] {
  const settings: Record<string, unknown> = store.settings ?? {}
  const raw = settings['meyAuditLog']
  if (!Array.isArray(raw)) return []
  const entries: AuditEntryLike[] = []
  raw.forEach((entry, index) => {
    if (typeof entry !== 'object' || entry === null) return
    const record = entry as Record<string, unknown>
    const at = finiteTimestamp(record['at'])
    const summary = cleanText(record['summary'])
    if (at === null || summary === '') return
    const id = cleanText(record['id'])
    entries.push({
      at,
      summary,
      undone: record['undone'] === true,
      key: `mey-${id !== '' ? id : String(index)}`,
    })
  })
  return entries
}

export function buildActivityFeed(store: LegacyStore): ActivityFeed {
  const timed: TimedActivityEvent[] = []
  const undated: UndatedOrderLine[] = []

  store.orders.forEach((order, index) => {
    const orderId = orderIdOf(order)
    const name = orderNameOf(order)
    const keyBase = orderId ?? `at-${String(index)}`

    const deliveredAt = finiteTimestamp(order.deliveredAt)
    if (deliveredAt !== null) {
      timed.push({
        key: `delivered-${keyBase}`,
        at: deliveredAt,
        category: 'deliveries',
        icon: 'ph:truck-bold',
        title: `ההזמנה של ${name} נמסרה`,
        detail: null,
        orderId,
      })
    }

    const proofAt = finiteTimestamp(order.deliveryProofAt)
    if (proofAt !== null) {
      timed.push({
        key: `proof-${keyBase}`,
        at: proofAt,
        category: 'deliveries',
        icon: 'ph:image-bold',
        title: `צורפה תמונת מסירה — ${name}`,
        detail: null,
        orderId,
      })
    }

    // Order creation has no timestamp anywhere in the legacy store, so the
    // order itself (source, current status, payment) lives in the honest
    // "no exact time" section, positioned by its service date.
    undated.push({
      key: `order-${keyBase}`,
      serviceDate: serviceDateOf(order),
      name,
      detail: `${sourceLabel(order)} · סטטוס: ${statusLabel(order)} · ${paidLabel(order)}`,
      orderId,
    })
  })

  for (const entry of auditEntriesOf(store)) {
    timed.push({
      key: entry.key,
      at: entry.at,
      category: 'mey',
      icon: 'ph:robot-bold',
      title: entry.summary,
      detail: entry.undone ? 'השינוי בוטל' : null,
      orderId: null,
    })
  }

  timed.sort((a, b) => b.at - a.at)

  const days: ActivityDayGroup[] = []
  const dayIndex = new Map<string, TimedActivityEvent[]>()
  for (const event of timed) {
    const dayKey = dayKeyFormatter.format(new Date(event.at))
    const existing = dayIndex.get(dayKey)
    if (existing !== undefined) {
      existing.push(event)
    } else {
      const events: TimedActivityEvent[] = [event]
      dayIndex.set(dayKey, events)
      days.push({
        dayKey,
        label: dayLabelFormatter.format(new Date(event.at)),
        events,
      })
    }
  }

  // Newest service date first; orders with no valid date sink to the end,
  // keeping their relative store order.
  const sortedUndated = undated
    .map((line, index) => ({ line, index }))
    .sort((a, b) => {
      if (a.line.serviceDate !== b.line.serviceDate) {
        if (a.line.serviceDate === null) return 1
        if (b.line.serviceDate === null) return -1
        return b.line.serviceDate.localeCompare(a.line.serviceDate)
      }
      return a.index - b.index
    })
    .map((entry) => entry.line)

  return { days, undated: sortedUndated }
}

function orderEditLink(orderId: string): string {
  return generatePath(APP_ROUTES.editOrder, { orderId })
}

function OpenOrderLink({ orderId, name }: { orderId: string; name: string }) {
  return (
    <Link
      to={orderEditLink(orderId)}
      aria-label={`פתיחת ההזמנה של ${name}`}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-bold text-primary transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <LocalIcon name="ph:arrow-left-bold" className="text-sm" />
      <span>פתיחה</span>
    </Link>
  )
}

function TimedEventRow({ event }: { event: TimedActivityEvent }) {
  return (
    <li className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4">
      <span
        className={`mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl ${
          event.category === 'mey' ? 'bg-amber-50 text-amber-800' : 'bg-secondary text-primary'
        }`}
      >
        <LocalIcon name={event.icon} className="text-lg" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-black text-primary ${event.detail === 'השינוי בוטל' ? 'line-through opacity-60' : ''}`}>
          {event.title}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-bold text-muted-foreground">
          <span dir="ltr">{timeFormatter.format(new Date(event.at))}</span>
          {event.detail !== null && (
            <>
              <span>·</span>
              <span>{event.detail}</span>
            </>
          )}
        </p>
      </div>
      {event.orderId !== null && <OpenOrderLink orderId={event.orderId} name={event.title} />}
    </li>
  )
}

function localizedServiceDate(serviceDate: string): string {
  const parsed = new Date(`${serviceDate}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return serviceDate
  return new Intl.DateTimeFormat('he-IL', { dateStyle: 'full', timeZone: 'UTC' }).format(parsed)
}

function UndatedSection({ lines }: { lines: readonly UndatedOrderLine[] }) {
  if (lines.length === 0) return null
  return (
    <section aria-label="ללא זמן מדויק" className="rounded-[2rem] border border-dashed border-border bg-card/70 p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-lg font-black text-primary">
        <LocalIcon name="ph:clock-bold" className="text-xl" />
        <span>ללא זמן מדויק</span>
      </h2>
      <p className="mt-1 text-xs font-bold text-muted-foreground">
        להזמנות האלה לא נשמר רגע יצירה או עדכון — הן מוצגות לפי תאריך האירוח שלהן, החדש קודם.
      </p>
      <ul className="mt-4 space-y-2">
        {lines.map((line) => (
          <li key={line.key} className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
              <LocalIcon name="ph:shopping-cart-bold" className="text-lg" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-primary">{line.name}</p>
              <p className="mt-1 text-xs font-bold text-muted-foreground">
                {line.serviceDate !== null ? `${localizedServiceDate(line.serviceDate)} · ` : 'ללא תאריך · '}
                {line.detail}
              </p>
            </div>
            {line.orderId !== null && <OpenOrderLink orderId={line.orderId} name={line.name} />}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function ActivityScreen() {
  const storeQuery = useStore()
  const [filter, setFilter] = useState<FilterValue>('all')

  if (storeQuery.isPending) {
    return <ScreenState kind="loading" title="טוענת את יומן הפעילות" />
  }
  if (storeQuery.isError) {
    return (
      <ScreenState
        kind="error"
        title="לא הצלחנו לטעון את יומן הפעילות"
        description="הנתונים נשארו ללא שינוי. אפשר לנסות שוב."
        retry={() => {
          void storeQuery.refetch()
        }}
      />
    )
  }

  const feed = buildActivityFeed(storeQuery.data.data ?? { orders: [] })

  if (feed.days.length === 0 && feed.undated.length === 0) {
    return (
      <ScreenState
        kind="empty"
        title="אין עדיין פעילות"
        description="ברגע שתהיה הזמנה ראשונה — כל מה שקורה בעסק יופיע כאן."
        action={{ label: 'הזמנה חדשה', icon: 'ph:plus-bold', to: APP_ROUTES.newOrder }}
      />
    )
  }

  const filteredDays = feed.days
    .map((day) => ({
      ...day,
      events: day.events.filter(
        (event) => filter === 'all' || event.category === filter,
      ),
    }))
    .filter((day) => day.events.length > 0)
  const showUndated = filter === 'all' || filter === 'orders'
  const nothingVisible = filteredDays.length === 0 && !(showUndated && feed.undated.length > 0)

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-8 sm:py-10">
      <header>
        <h1 className="flex items-center gap-3 font-heading text-3xl font-black tracking-tight text-primary sm:text-4xl">
          <LocalIcon name="ph:clock-counter-clockwise-bold" className="text-3xl" />
          <span>יומן פעילות</span>
        </h1>
        <p className="mt-2 text-sm font-bold text-muted-foreground">
          מה קרה בעסק, מהחדש לישן: מסירות, תמונות מסירה והפעולות של מיי — עם זמן אמיתי בלבד.
        </p>
      </header>

      <div className="mt-6 flex flex-wrap items-center gap-2" role="group" aria-label="סינון פעילות">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={filter === option.value}
            onClick={() => setFilter(option.value)}
            className={`min-h-9 rounded-full border px-3.5 text-xs font-black transition-colors ${
              filter === option.value
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-primary hover:bg-secondary'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="mt-8 space-y-8">
        {filteredDays.map((day) => (
          <section key={day.dayKey} aria-label={day.label}>
            <h2 className="flex items-center gap-2 border-b border-border pb-3 text-lg font-black text-primary">
              <LocalIcon name="ph:calendar-bold" className="text-xl" />
              <span>{day.label}</span>
            </h2>
            <ul className="mt-4 space-y-2">
              {day.events.map((event) => (
                <TimedEventRow key={event.key} event={event} />
              ))}
            </ul>
          </section>
        ))}

        {showUndated && <UndatedSection lines={feed.undated} />}

        {nothingVisible && (
          <ScreenState
            kind="empty"
            title="אין פעילות בסינון הזה"
            description="אפשר לבחור סינון אחר או לחזור להכל."
            className="px-0"
          />
        )}
      </div>
    </div>
  )
}

export default ActivityScreen
