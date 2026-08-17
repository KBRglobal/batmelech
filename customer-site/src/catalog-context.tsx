import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/**
 * The live public menu catalog, served by GET /api/site/catalog from the same
 * data the admin app edits. Pages keep their own hardcoded structure as the
 * fallback and OVERRIDE names/prices/photos from here when available, so a
 * failed fetch degrades to the site exactly as it was before this existed.
 */

export type CatalogDish = {
  name: string
  description: string
  imageUrl: string | null
}

export type CatalogExtra = CatalogDish & { priceUsd: number | null }

export type CatalogLunchVariant = { key: string; priceUsd: number | null; sidePriceUsd: number | null }

export type CatalogLunchItem = {
  key: string
  priceUsd: number | null
  variants: CatalogLunchVariant[]
  addonPriceUsd: number | null
}

export type CatalogCategoryKey = 'salads' | 'firsts' | 'mains' | 'sides' | 'desserts'

export type SiteCatalog = {
  couplePriceUsd: number | null
  challahPriceUsd: number | null
  categories: Record<CatalogCategoryKey, CatalogDish[]>
  extras: CatalogExtra[]
  lunch: CatalogLunchItem[]
  lunchSides: string[]
}

type SiteCatalogValue = {
  /** null while loading or when the fetch failed — always fall back to local data. */
  catalog: SiteCatalog | null
  /** Price of an extra by exact name, or null when unknown. */
  extraPriceUsd: (name: string) => number | null
  /** Dish text/photo by exact name across all categories and extras, or null. */
  dishByName: (name: string) => CatalogDish | null
  /** Lunch item by its stable key ('baguette', 'schnitzel-plate', ...), or null. */
  lunchItem: (key: string) => CatalogLunchItem | null
}

const CATEGORY_KEYS: CatalogCategoryKey[] = ['salads', 'firsts', 'mains', 'sides', 'desserts']

function usd(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseDish(value: unknown): CatalogDish | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  const name = textOf(row.name)
  if (name === '') return null
  const imageUrl = textOf(row.imageUrl)
  return {
    name,
    description: textOf(row.description),
    imageUrl: imageUrl.startsWith('https://') ? imageUrl : null,
  }
}

function parseCatalog(value: unknown): SiteCatalog | null {
  if (typeof value !== 'object' || value === null) return null
  const body = value as Record<string, unknown>
  const rawCategories = (typeof body.categories === 'object' && body.categories !== null
    ? body.categories
    : {}) as Record<string, unknown>
  const categories = {} as Record<CatalogCategoryKey, CatalogDish[]>
  for (const key of CATEGORY_KEYS) {
    const rows = Array.isArray(rawCategories[key]) ? (rawCategories[key] as unknown[]) : []
    categories[key] = rows.map(parseDish).filter((dish): dish is CatalogDish => dish !== null)
  }
  const extras = (Array.isArray(body.extras) ? body.extras : [])
    .map((row) => {
      const dish = parseDish(row)
      if (dish === null) return null
      return { ...dish, priceUsd: usd((row as Record<string, unknown>).priceUsd) }
    })
    .filter((extra): extra is CatalogExtra => extra !== null)
  const lunch = (Array.isArray(body.lunch) ? body.lunch : [])
    .map((row): CatalogLunchItem | null => {
      if (typeof row !== 'object' || row === null) return null
      const item = row as Record<string, unknown>
      const key = textOf(item.key)
      if (key === '') return null
      return {
        key,
        priceUsd: usd(item.priceUsd),
        variants: (Array.isArray(item.variants) ? item.variants : [])
          .map((variant): CatalogLunchVariant | null => {
            if (typeof variant !== 'object' || variant === null) return null
            const record = variant as Record<string, unknown>
            const variantKey = textOf(record.key)
            if (variantKey === '') return null
            return { key: variantKey, priceUsd: usd(record.priceUsd), sidePriceUsd: usd(record.sidePriceUsd) }
          })
          .filter((variant): variant is CatalogLunchVariant => variant !== null),
        addonPriceUsd: usd(item.addonPriceUsd),
      }
    })
    .filter((item): item is CatalogLunchItem => item !== null)
  return {
    couplePriceUsd: usd(body.couplePriceUsd),
    challahPriceUsd: usd(body.challahPriceUsd),
    categories,
    extras,
    lunch,
    lunchSides: (Array.isArray(body.lunchSides) ? body.lunchSides : [])
      .map(textOf)
      .filter((name) => name !== ''),
  }
}

const SiteCatalogContext = createContext<SiteCatalogValue>({
  catalog: null,
  extraPriceUsd: () => null,
  dishByName: () => null,
  lunchItem: () => null,
})

// Drag-to-order support: the admin's saved category order is the order the
// site shows. Items the live catalog does not know keep their place at the
// end, in their original relative order — the page never loses a dish.
export function orderByCatalog<T extends { name: string }>(
  items: readonly T[],
  liveDishes: readonly { name: string }[] | undefined,
): T[] {
  if (!liveDishes || liveDishes.length === 0) return [...items]
  const indexByName = new Map(liveDishes.map((dish, index) => [dish.name.trim(), index]))
  return [...items].sort((a, b) => {
    const aIndex = indexByName.get(a.name.trim()) ?? Number.MAX_SAFE_INTEGER
    const bIndex = indexByName.get(b.name.trim()) ?? Number.MAX_SAFE_INTEGER
    if (aIndex !== bIndex) return aIndex - bIndex
    return items.indexOf(a) - items.indexOf(b)
  })
}

export function SiteCatalogProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<SiteCatalog | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/site/catalog')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || data === null) return
        setCatalog(parseCatalog(data))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const value = useMemo<SiteCatalogValue>(() => {
    const dishes = new Map<string, CatalogDish>()
    const extraPrices = new Map<string, number>()
    if (catalog !== null) {
      for (const key of CATEGORY_KEYS) {
        for (const dish of catalog.categories[key]) dishes.set(dish.name, dish)
      }
      for (const extra of catalog.extras) {
        dishes.set(extra.name, extra)
        if (extra.priceUsd !== null) extraPrices.set(extra.name, extra.priceUsd)
      }
    }
    return {
      catalog,
      extraPriceUsd: (name) => extraPrices.get(name.trim()) ?? null,
      dishByName: (name) => dishes.get(name.trim()) ?? null,
      lunchItem: (key) => catalog?.lunch.find((item) => item.key === key) ?? null,
    }
  }, [catalog])

  return <SiteCatalogContext.Provider value={value}>{children}</SiteCatalogContext.Provider>
}

export function useSiteCatalog(): SiteCatalogValue {
  return useContext(SiteCatalogContext)
}
