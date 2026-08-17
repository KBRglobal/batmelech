import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'

// Three locales, Hebrew is the source of truth. English is written for an
// American Jewish audience and French for a French Jewish audience — native
// copy, never translated word-by-word (Shabbat, not Saturday; Chabbat, not
// samedi). Routes: Hebrew at /, English under /en, French under /fr.

export type Locale = 'he' | 'en' | 'fr'

export const LOCALES: readonly Locale[] = ['he', 'en', 'fr']

const STORAGE_KEY = 'bm-locale'

export interface LocaleValue {
  readonly locale: Locale
  readonly dir: 'rtl' | 'ltr'
  /** Prefixes a site-internal path with the current locale segment. */
  readonly href: (path: string) => string
}

const LocaleContext = createContext<LocaleValue>({
  locale: 'he',
  dir: 'rtl',
  href: (path) => path,
})

export function useLocale(): LocaleValue {
  return useContext(LocaleContext)
}

export function localeDir(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'he' ? 'rtl' : 'ltr'
}

export function localizedHref(locale: Locale, path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  if (locale === 'he') return normalized
  return normalized === '/' ? `/${locale}` : `/${locale}${normalized}`
}

export function rememberLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // storage unavailable — detection will run again next visit
  }
}

function storedLocale(): Locale | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'he' || value === 'en' || value === 'fr' ? value : null
  } catch {
    return null
  }
}

function deviceLocale(): Locale {
  const languages = Array.isArray(navigator.languages) && navigator.languages.length > 0
    ? navigator.languages
    : [navigator.language]
  for (const language of languages) {
    const code = String(language || '').toLowerCase()
    if (code.startsWith('he') || code.startsWith('iw')) return 'he'
    if (code.startsWith('en')) return 'en'
    if (code.startsWith('fr')) return 'fr'
  }
  return 'he'
}

// First visit to the Hebrew root with no remembered choice: follow the
// device language. An explicit choice (the language button) always wins and
// is remembered; deep links into /en or /fr are respected as-is.
export function DeviceLocaleRedirect() {
  const { pathname, search, hash } = useLocation()
  const remembered = storedLocale()
  const target = remembered ?? deviceLocale()
  if (target === 'he') return null
  if (remembered === null) rememberLocale(target)
  return <Navigate to={`${localizedHref(target, pathname)}${search}${hash}`} replace />
}

export function LocaleLayout({ locale, children }: { readonly locale: Locale; readonly children?: ReactNode }) {
  const dir = localeDir(locale)
  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = dir
  }, [locale, dir])
  const value: LocaleValue = {
    locale,
    dir,
    href: (path) => localizedHref(locale, path),
  }
  return <LocaleContext.Provider value={value}>{children ?? <Outlet />}</LocaleContext.Provider>
}

// Strips the locale segment from a pathname, returning the canonical
// (Hebrew) site path — used for meta lookups and the language switcher.
export function canonicalPath(pathname: string): { readonly locale: Locale; readonly path: string } {
  for (const locale of ['en', 'fr'] as const) {
    if (pathname === `/${locale}`) return { locale, path: '/' }
    if (pathname.startsWith(`/${locale}/`)) return { locale, path: pathname.slice(locale.length + 1) }
  }
  return { locale: 'he', path: pathname }
}
