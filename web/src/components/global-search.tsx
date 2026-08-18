import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { generatePath, useNavigate } from 'react-router'
import { APP_ROUTES } from '../app/routes.ts'
import { useStore } from '../data/use-store.ts'
import type { LegacyOrder } from '../domain/store.ts'
import { LocalIcon } from './local-icon.tsx'

// Global search (roadmap #6): reachable from any screen via the sidebar (and
// the mobile header), opening an overlay that searches the already-loaded
// store entirely client-side — orders by name/phone/id/hotel/notes and
// customers grouped by phone — with zero extra server round-trips. Fully
// keyboard driven: Cmd/Ctrl+K opens, arrows move, Enter opens, Esc closes.
//
// The overlay component is the only part that touches the store; it mounts
// only while the overlay is open, so the shell renders the trigger without
// requiring any query infrastructure.

const MAX_ORDER_RESULTS = 8
const MAX_CUSTOMER_RESULTS = 5
const MIN_PHONE_DIGITS = 6
const MIN_TOKEN_DIGITS = 3

interface SearchResult {
  readonly key: string
  readonly kind: 'order' | 'customer'
  readonly title: string
  readonly subtitle: string
  readonly to: string
}

function digitsOf(value: string): string {
  return value.replace(/\D+/gu, '')
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function orderIdOf(order: LegacyOrder): string | null {
  if (typeof order.id === 'number' && Number.isFinite(order.id)) return String(order.id)
  if (typeof order.id === 'string' && order.id.trim() !== '') return order.id
  return null
}

function destinationOf(order: LegacyOrder): string {
  if (order.pickup === true) return 'איסוף עצמי'
  return cleanText(order.hotelName) || cleanText(order.place) || cleanText(order.address) || ''
}

interface OrderEntry {
  readonly order: LegacyOrder
  readonly orderId: string
  readonly haystack: string
  readonly phoneDigits: string
}

interface CustomerEntry {
  readonly phone: string
  readonly phoneDigits: string
  readonly name: string
  readonly orderCount: number
  readonly haystack: string
}

function orderEntries(orders: readonly LegacyOrder[]): OrderEntry[] {
  const entries: OrderEntry[] = []
  for (const order of orders) {
    const orderId = orderIdOf(order)
    if (orderId === null) continue
    const phone = cleanText(order.phone)
    const haystack = [
      cleanText(order.name),
      phone,
      orderId,
      cleanText(order.hotelName),
      cleanText(order.place),
      cleanText(order.address),
      cleanText(order.notes),
      cleanText(order.group),
      cleanText(order.date),
    ]
      .join(' ')
      .toLowerCase()
    entries.push({ order, orderId, haystack, phoneDigits: digitsOf(phone) })
  }
  // Newest service date first; undated orders after the dated ones.
  return entries.sort((a, b) => {
    const aDate = cleanText(a.order.date)
    const bDate = cleanText(b.order.date)
    if (aDate === bDate) return 0
    if (aDate === '') return 1
    if (bDate === '') return -1
    return bDate.localeCompare(aDate)
  })
}

function customerEntries(orders: readonly LegacyOrder[]): CustomerEntry[] {
  const byPhone = new Map<string, { phone: string; name: string; orderCount: number }>()
  for (const order of orders) {
    const phone = cleanText(order.phone)
    const phoneDigits = digitsOf(phone)
    if (phoneDigits.length < MIN_PHONE_DIGITS) continue
    const existing = byPhone.get(phoneDigits)
    const name = cleanText(order.name)
    if (existing === undefined) {
      byPhone.set(phoneDigits, { phone, name, orderCount: 1 })
    } else {
      existing.orderCount += 1
      if (name !== '') existing.name = name
    }
  }
  return [...byPhone.entries()].map(([phoneDigits, entry]) => ({
    phone: entry.phone,
    phoneDigits,
    name: entry.name || 'ללא שם',
    orderCount: entry.orderCount,
    haystack: `${entry.name} ${entry.phone}`.toLowerCase(),
  }))
}

function matches(haystack: string, phoneDigits: string, tokens: readonly string[]): boolean {
  return tokens.every((token) => {
    if (haystack.includes(token)) return true
    const tokenDigits = digitsOf(token)
    return tokenDigits.length >= MIN_TOKEN_DIGITS && phoneDigits.includes(tokenDigits)
  })
}

export function searchStore(orders: readonly LegacyOrder[], query: string): SearchResult[] {
  const tokens = query.trim().toLowerCase().split(/\s+/u).filter((token) => token !== '')
  if (tokens.length === 0) return []

  const orderResults: SearchResult[] = []
  for (const entry of orderEntries(orders)) {
    if (orderResults.length >= MAX_ORDER_RESULTS) break
    if (!matches(entry.haystack, entry.phoneDigits, tokens)) continue
    const parts = [
      cleanText(entry.order.date),
      destinationOf(entry.order),
      cleanText(entry.order.status) || 'חדשה',
    ].filter((part) => part !== '')
    orderResults.push({
      key: `order-${entry.orderId}`,
      kind: 'order',
      title: cleanText(entry.order.name) || 'ללא שם',
      subtitle: parts.join(' · '),
      to: generatePath(APP_ROUTES.editOrder, { orderId: entry.orderId }),
    })
  }

  const customerResults: SearchResult[] = []
  for (const entry of customerEntries(orders)) {
    if (customerResults.length >= MAX_CUSTOMER_RESULTS) break
    if (!matches(entry.haystack, entry.phoneDigits, tokens)) continue
    customerResults.push({
      key: `customer-${entry.phoneDigits}`,
      kind: 'customer',
      title: entry.name,
      subtitle: `${entry.phone} · ${String(entry.orderCount)} הזמנות`,
      to: APP_ROUTES.customers,
    })
  }

  return [...orderResults, ...customerResults]
}

function ResultsGroup({
  label,
  icon,
  results,
  activeKey,
  onPick,
  onHover,
}: {
  readonly label: string
  readonly icon: 'ph:shopping-cart-bold' | 'ph:users-bold'
  readonly results: readonly SearchResult[]
  readonly activeKey: string | null
  readonly onPick: (result: SearchResult) => void
  readonly onHover: (result: SearchResult) => void
}) {
  if (results.length === 0) return null
  return (
    <section aria-label={label}>
      <h3 className="flex items-center gap-2 px-2 pb-1 pt-3 text-xs font-black text-muted-foreground">
        <LocalIcon name={icon} className="text-sm" />
        <span>{label}</span>
      </h3>
      <ul>
        {results.map((result) => {
          const active = result.key === activeKey
          return (
            <li key={result.key}>
              <button
                type="button"
                onClick={() => onPick(result)}
                onMouseMove={() => onHover(result)}
                ref={(element) => {
                  if (active) element?.scrollIntoView({ block: 'nearest' })
                }}
                className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-start transition-colors ${
                  active ? 'bg-secondary ring-1 ring-border' : 'hover:bg-secondary/60'
                }`}
              >
                <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
                  <LocalIcon name={icon} className="text-base" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-black text-primary">{result.title}</span>
                  {result.subtitle !== '' && (
                    <span className="block truncate text-xs font-bold text-muted-foreground">
                      {result.subtitle}
                    </span>
                  )}
                </span>
                <LocalIcon name="ph:arrow-left-bold" className="shrink-0 text-sm text-muted-foreground" />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function SearchOverlay({ onClose }: { readonly onClose: () => void }) {
  const storeQuery = useStore()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const orders = storeQuery.data?.data?.orders
  const results = useMemo(
    () => (orders === undefined ? [] : searchStore(orders, query)),
    [orders, query],
  )
  const boundedIndex = results.length === 0 ? -1 : Math.min(activeIndex, results.length - 1)
  const activeKey = boundedIndex >= 0 ? results[boundedIndex]!.key : null

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  const pick = (result: SearchResult) => {
    onClose()
    void navigate(result.to)
  }

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (results.length > 0) setActiveIndex((boundedIndex + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (results.length > 0) {
        setActiveIndex((boundedIndex - 1 + results.length) % results.length)
      }
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (boundedIndex >= 0) pick(results[boundedIndex]!)
    }
  }

  const trimmedQuery = query.trim()
  const orderResults = results.filter((result) => result.kind === 'order')
  const customerResults = results.filter((result) => result.kind === 'customer')

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-primary/30 p-4 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="חיפוש כללי"
        className="mx-auto mt-[8vh] w-full max-w-xl rounded-[2rem] border border-border bg-card shadow-[0_30px_80px_rgba(99,33,40,0.25)]"
      >
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <LocalIcon name="ph:magnifying-glass-bold" className="text-xl text-primary" />
          <label className="sr-only" htmlFor="global-search-input">
            חיפוש בכל המערכת
          </label>
          <input
            ref={inputRef}
            // The overlay exists only because the operator asked to search —
            // focus goes straight to the field.
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            id="global-search-input"
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value)
              setActiveIndex(0)
            }}
            onKeyDown={onInputKeyDown}
            placeholder="שם, טלפון, מלון, הערה..."
            className="min-h-10 min-w-0 flex-1 border-0 bg-transparent text-base font-bold text-primary outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="סגירת החיפוש"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-primary"
          >
            <LocalIcon name="ph:x-bold" className="text-lg" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2 pb-3">
          {storeQuery.isPending ? (
            <p className="px-3 py-6 text-center text-sm font-bold text-muted-foreground" role="status">
              טוענת את הנתונים...
            </p>
          ) : storeQuery.isError ? (
            <p className="px-3 py-6 text-center text-sm font-black text-destructive" role="alert">
              הנתונים לא נטענו — החיפוש לא זמין כרגע.
            </p>
          ) : trimmedQuery === '' ? (
            <p className="px-3 py-6 text-center text-sm font-bold text-muted-foreground">
              מקלידים ומקבלים מיד הזמנות ולקוחות מכל המערכת.
            </p>
          ) : results.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm font-bold text-muted-foreground" role="status">
              לא נמצא כלום עבור „{trimmedQuery}”.
            </p>
          ) : (
            <>
              <ResultsGroup
                label="הזמנות"
                icon="ph:shopping-cart-bold"
                results={orderResults}
                activeKey={activeKey}
                onPick={pick}
                onHover={(result) => setActiveIndex(results.indexOf(result))}
              />
              <ResultsGroup
                label="לקוחות"
                icon="ph:users-bold"
                results={customerResults}
                activeKey={activeKey}
                onPick={pick}
                onHover={(result) => setActiveIndex(results.indexOf(result))}
              />
            </>
          )}
        </div>

        <p className="flex items-center justify-center gap-3 border-t border-border px-5 py-2.5 text-[0.6875rem] font-bold text-muted-foreground">
          <span>Enter לפתיחה</span>
          <span>·</span>
          <span>חצים לניווט</span>
          <span>·</span>
          <span>Esc לסגירה</span>
        </p>
      </div>
    </div>
  )
}

export function GlobalSearch({ variant }: { readonly variant: 'desktop' | 'mobile' }) {
  const [open, setOpen] = useState(false)

  // Cmd/Ctrl+K from anywhere. Registered once, by the desktop instance only,
  // so the always-mounted mobile instance never double-opens.
  useEffect(() => {
    if (variant !== 'desktop') return
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [variant])

  return (
    <>
      {variant === 'desktop' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group mb-4 flex min-h-11 w-full items-center gap-3 rounded-xl border border-border bg-background/60 px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <LocalIcon name="ph:magnifying-glass-bold" className="text-xl" />
          <span>חיפוש</span>
          <kbd className="ms-auto rounded-md border border-border bg-card px-1.5 py-0.5 text-[0.625rem] font-black text-muted-foreground" dir="ltr">
            ⌘K
          </kbd>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="חיפוש"
          className="inline-flex size-11 items-center justify-center rounded-xl text-primary transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <LocalIcon name="ph:magnifying-glass-bold" className="text-2xl" />
        </button>
      )}
      {open && <SearchOverlay onClose={() => setOpen(false)} />}
    </>
  )
}
