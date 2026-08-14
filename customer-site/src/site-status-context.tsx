import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

type SiteStatus = {
  orderingOpen: boolean
  siteBanner: string | null
  outOfStockNames: string[]
}

const DEFAULT_STATUS: SiteStatus = { orderingOpen: true, siteBanner: null, outOfStockNames: [] }

const SiteStatusContext = createContext<SiteStatus>(DEFAULT_STATUS)

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
          siteBanner: typeof data.siteBanner === 'string' ? data.siteBanner : null,
          outOfStockNames: Array.isArray(data.outOfStockNames) ? data.outOfStockNames : [],
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return <SiteStatusContext.Provider value={status}>{children}</SiteStatusContext.Provider>
}

export function useSiteStatus() {
  return useContext(SiteStatusContext)
}
