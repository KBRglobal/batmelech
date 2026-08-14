import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

type SiteStatus = {
  orderingOpen: boolean
  /** YYYY-MM-DD (Dubai) ordering comes back on. Present only while it is closed. */
  reopensOn: string | null
  siteBanner: string | null
  outOfStockNames: string[]
}

type SiteStatusValue = SiteStatus & {
  isOutOfStock: (name: string) => boolean
}

const DEFAULT_STATUS: SiteStatus = {
  orderingOpen: true,
  reopensOn: null,
  siteBanner: null,
  outOfStockNames: [],
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
