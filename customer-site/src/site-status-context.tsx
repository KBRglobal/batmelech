import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

type SiteStatus = {
  orderingOpen: boolean
  /** YYYY-MM-DD (Dubai) ordering comes back on. Present only while it is closed. */
  reopensOn: string | null
  siteBanner: string | null
  outOfStockNames: string[]
  /** Dates (YYYY-MM-DD Dubai) that the kitchen has marked as closed. */
  closedDates: string[]
  /** The calendar gate, independent of orderingOpen: Shabbat or a yom tov is in. */
  shabbatClosed: boolean
  /** The greeting for this occasion — 'שבת שלום', 'חג שמח — פסח'. */
  shabbatLabel: string | null
  /** Havdalah, in epoch milliseconds. */
  shabbatReopensAt: number | null
  /** Which of the two it is, so the copy can say מוצאי שבת or צאת החג. */
  shabbatOccasion: 'shabbat' | 'chag' | null
}

type SiteStatusValue = SiteStatus & {
  isOutOfStock: (name: string) => boolean
}

const DEFAULT_STATUS: SiteStatus = {
  orderingOpen: true,
  reopensOn: null,
  siteBanner: null,
  outOfStockNames: [],
  closedDates: [],
  shabbatClosed: false,
  shabbatLabel: null,
  shabbatReopensAt: null,
  shabbatOccasion: null,
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// settings.out holds names typed in the admin catalog, so they are rarely
// char-identical to the names hardcoded in the site's menu pages. Fold the
// Hebrew geresh/gershayim and the typographic quotes onto their ASCII twins
// (תפו״א vs תפו"א, צ׳ירשי vs צ'ירשי) and collapse whitespace before comparing.
function normalize(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/[׳‘’]/g, "'")
    .replace(/[״“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function matches(a: string, b: string): boolean {
  if (a === b) return true
  // Tolerant fallback: the admin name may be a shorter or longer wording of the
  // same dish ("חלה" vs "תוספת חלה"). Two chars minimum keeps stray fragments
  // from matching everything.
  if (a.length < 2 || b.length < 2) return false
  return a.includes(b) || b.includes(a)
}

const SiteStatusContext = createContext<SiteStatusValue>({
  ...DEFAULT_STATUS,
  isOutOfStock: () => false,
})

export function SiteStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SiteStatus>(DEFAULT_STATUS)

  useEffect(() => {
    let cancelled = false
    fetch('/api/site/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setStatus({
          orderingOpen: data.orderingOpen !== false,
          reopensOn: typeof data.reopensOn === 'string' && ISO_DATE.test(data.reopensOn) ? data.reopensOn : null,
          siteBanner: typeof data.siteBanner === 'string' ? data.siteBanner : null,
          outOfStockNames: Array.isArray(data.outOfStockNames) ? data.outOfStockNames : [],
          closedDates: Array.isArray(data.closedDates)
            ? data.closedDates.filter((value: unknown) => typeof value === 'string')
            : [],
          // Opt in, never out: only an explicit `true` closes the site, so a
          // stale server that has never heard of Shabbat keeps selling.
          shabbatClosed: data.shabbatClosed === true,
          shabbatLabel: typeof data.shabbatLabel === 'string' && data.shabbatLabel.trim() ? data.shabbatLabel : null,
          shabbatReopensAt:
            typeof data.shabbatReopensAt === 'number' && Number.isFinite(data.shabbatReopensAt)
              ? data.shabbatReopensAt
              : null,
          shabbatOccasion:
            data.shabbatOccasion === 'shabbat' || data.shabbatOccasion === 'chag' ? data.shabbatOccasion : null,
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const value = useMemo<SiteStatusValue>(() => {
    const normalized = status.outOfStockNames
      .filter((name) => typeof name === 'string')
      .map(normalize)
      .filter(Boolean)
    return {
      ...status,
      // Until the status call lands — and forever, if it fails — the list is
      // empty and nothing is marked out of stock, so a dead endpoint never
      // blocks a purchase.
      isOutOfStock: (name: string) => {
        const target = normalize(name)
        if (!target) return false
        return normalized.some((out) => matches(target, out))
      },
    }
  }, [status])

  return <SiteStatusContext.Provider value={value}>{children}</SiteStatusContext.Provider>
}

export function useSiteStatus() {
  return useContext(SiteStatusContext)
}
