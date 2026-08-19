import { useEffect, useRef, useState } from 'react'
import { LocalIcon } from './local-icon'

// New-order browser notifications (roadmap #8): a bell toggle in the shell.
// While enabled, the panel polls the versioned state once a minute and fires
// a system notification for any order id it has not seen before. The seen
// set primes silently on the first poll so enabling never floods.

const ENABLED_KEY = 'bm-order-alerts'
const SEEN_KEY = 'bm-order-alerts-seen'
const POLL_MS = 60_000
const MAX_SEEN = 2000

function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeSeen(seen: Set<string>): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-MAX_SEEN)))
  } catch {
    // storage unavailable — alerts still work within this tab session
  }
}

interface StateOrder {
  readonly id?: unknown
  readonly name?: unknown
  readonly total?: unknown
  readonly source?: unknown
}

async function fetchOrders(): Promise<StateOrder[] | null> {
  try {
    const response = await fetch('/api/state', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
    })
    if (!response.ok) return null
    const body: unknown = await response.json()
    const orders = (body as { data?: { orders?: unknown } })?.data?.orders
    return Array.isArray(orders) ? (orders as StateOrder[]) : null
  } catch {
    return null
  }
}

function notifyNewOrder(order: StateOrder): void {
  const name = typeof order.name === 'string' && order.name.trim() !== '' ? order.name.trim() : 'ללא שם'
  const total = typeof order.total === 'number' && Number.isFinite(order.total) && order.total > 0
    ? ` · $${order.total}`
    : ''
  const source = order.source === 'site' ? ' (מהאתר)' : order.source === 'mey-whatsapp' ? ' (דרך מיי)' : ''
  try {
    new Notification('הזמנה חדשה — מטעמי בת מלך', {
      body: `${name}${total}${source}`,
      tag: `bm-order-${String(order.id)}`,
    })
  } catch {
    // Notification constructor can throw on some platforms — never break the shell
  }
}

export function NewOrderAlerts() {
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem(ENABLED_KEY) === 'on' && typeof Notification !== 'undefined' && Notification.permission === 'granted'
    } catch {
      return false
    }
  })
  const [blocked, setBlocked] = useState(false)
  const seenRef = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const poll = async () => {
      const orders = await fetchOrders()
      if (cancelled || orders === null) return
      const ids = orders
        .map((order) => (typeof order.id === 'string' || typeof order.id === 'number' ? String(order.id) : ''))
        .filter((id) => id !== '')
      if (seenRef.current === null) {
        // First poll after enabling: prime silently.
        seenRef.current = readSeen()
        if (seenRef.current.size === 0) {
          seenRef.current = new Set(ids)
          writeSeen(seenRef.current)
          return
        }
      }
      const seen = seenRef.current
      let changed = false
      for (const order of orders) {
        const id = typeof order.id === 'string' || typeof order.id === 'number' ? String(order.id) : ''
        if (id === '' || seen.has(id)) continue
        seen.add(id)
        changed = true
        notifyNewOrder(order)
      }
      if (changed) writeSeen(seen)
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [enabled])

  const toggle = async () => {
    if (enabled) {
      setEnabled(false)
      try { localStorage.setItem(ENABLED_KEY, 'off') } catch { /* keep in-memory state */ }
      return
    }
    if (typeof Notification === 'undefined') {
      setBlocked(true)
      return
    }
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      setBlocked(true)
      return
    }
    setBlocked(false)
    seenRef.current = null
    setEnabled(true)
    try { localStorage.setItem(ENABLED_KEY, 'on') } catch { /* keep in-memory state */ }
  }

  return (
    <button
      type="button"
      aria-pressed={enabled}
      onClick={() => { void toggle() }}
      title={blocked
        ? 'הדפדפן חוסם התראות — צריך לאשר התראות לאתר בהגדרות הדפדפן'
        : enabled
          ? 'התראות על הזמנות חדשות פועלות — לחיצה מכבה'
          : 'הפעלת התראות דפדפן על הזמנות חדשות'}
      className={`flex min-h-11 w-full min-w-0 items-center gap-3 rounded-2xl px-4 text-sm font-black transition-colors ${
        enabled ? 'bg-emerald-50 text-emerald-900' : blocked ? 'bg-rose-50 text-destructive' : 'text-primary hover:bg-secondary'
      }`}
    >
      <LocalIcon name={enabled ? 'ph:bell-ringing-bold' : 'ph:bell-bold'} className="text-xl" />
      <span className="min-w-0 truncate">{enabled ? 'התראות פועלות' : blocked ? 'התראות חסומות' : 'התראות הזמנות'}</span>
    </button>
  )
}
