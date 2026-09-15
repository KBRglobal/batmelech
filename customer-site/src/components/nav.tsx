import { Icon } from '@iconify/react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useCart } from '../cart-context'
import { canonicalPath, localizedHref, rememberLocale, useLocale, type Locale } from '../locale-context'

const LINKS: readonly { readonly to: string; readonly label: Record<Locale, string> }[] = [
  { to: '/weekdays', label: { he: 'יום חול', en: 'Weekdays', fr: 'Semaine' } },
  { to: '/shabbat-order', label: { he: 'שבת קודש', en: 'Shabbat', fr: 'Chabbat' } },
  { to: '/shabbat-extras', label: { he: 'חיזוקים לסופ״ש', en: 'Shabbat Extras', fr: 'Suppléments' } },
]

export function Nav({ active }: { active: string }) {
  const { locale, href } = useLocale()
  return (
    <nav className="flex items-center p-1 md:p-1.5 rounded-full shadow-2xl bg-black/20 backdrop-blur-xl border border-white/20 overflow-x-auto max-w-full">
      {LINKS.map((link) => {
        const isActive = link.to === active
        return (
          <Link
            key={link.to}
            to={href(link.to)}
            className={`px-3 md:px-6 py-2 md:py-2.5 rounded-full text-xs md:text-sm font-black whitespace-nowrap transition-all ${
              isActive ? 'bg-white text-[#3B151A] shadow-lg' : 'text-white hover:text-white/80'
            }`}
          >
            {link.label[locale]}
          </Link>
        )
      })}
    </nav>
  )
}

export function NavCartButton() {
  const { lines } = useCart()
  const { href } = useLocale()
  const count = lines.reduce((n, l) => n + l.qty, 0)

  return (
    <Link
      to={href('/checkout')}
      className="relative flex items-center justify-center w-11 h-11 rounded-full bg-white text-[#3B151A] shadow-xl shrink-0"
    >
      <Icon icon="ph:basket-fill" className="text-base md:text-lg" />
      {count > 0 && (
        <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-[#8D182C] text-white text-[10px] font-black flex items-center justify-center shadow-md">
          {count}
        </span>
      )}
    </Link>
  )
}

export function NavLogo() {
  const { href } = useLocale()
  return (
    <Link to={href('/')} className="shrink-0 w-10 h-10 md:w-16 md:h-16">
      <img src="/site/assets/logo-cream.png" alt="Bat Melech" className="w-full h-full object-contain drop-shadow-[0_2px_10px_rgba(59,21,26,0.5)]" />
    </Link>
  )
}

export function PhoneBadge() {
  return (
    <a
      href="tel:+971586288776"
      className="flex items-center gap-3 text-white bg-black/20 backdrop-blur-xl border border-white/20 rounded-full w-11 h-11 md:w-auto md:h-auto md:px-5 md:py-2.5 shadow-xl shrink-0 justify-center"
      dir="ltr"
    >
      <Icon icon="ph:phone-fill" className="text-base md:text-xl" />
      <span className="hidden md:inline font-bold tracking-wider text-sm">+971 58 628 8776</span>
    </a>
  )
}

const LOCALE_LABELS: Readonly<Record<Locale, string>> = { he: 'עב', en: 'EN', fr: 'FR' }

// Language button: switches locale in place (same page), remembers the
// explicit choice so the device-language redirect never overrides it.
export function LanguageSwitcher() {
  const { locale } = useLocale()
  const { pathname, search, hash } = useLocation()
  const navigate = useNavigate()
  const { path } = canonicalPath(pathname)

  return (
    <div
      className="flex items-center gap-0.5 rounded-full bg-black/20 backdrop-blur-xl border border-white/20 p-1 shadow-xl shrink-0"
      role="group"
      aria-label="Language / שפה / Langue"
      dir="ltr"
    >
      {(['he', 'en', 'fr'] as const).map((candidate) => (
        <button
          key={candidate}
          type="button"
          lang={candidate}
          aria-pressed={candidate === locale}
          onClick={() => {
            if (candidate === locale) return
            rememberLocale(candidate)
            navigate(`${localizedHref(candidate, path)}${search}${hash}`)
          }}
          className={`min-w-9 md:min-w-9 h-8 md:h-8 px-1.5 rounded-full text-[11px] md:text-xs font-black transition-all ${
            candidate === locale ? 'bg-white text-[#3B151A] shadow' : 'text-white/80 hover:text-white'
          }`}
        >
          {LOCALE_LABELS[candidate]}
        </button>
      ))}
    </div>
  )
}

// Mobile: two rows (logo + actions above, nav links below, full width) so the
// links are never clipped. Desktop (md:contents dissolves the wrapper): the
// original single row — logo, centered nav, actions.
export function NavHeader({ active }: { active: string }) {
  return (
    <header className="w-full pt-4 px-4 md:pt-8 md:px-16 flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6">
      <div className="flex items-center justify-between gap-2 md:contents">
        <NavLogo />
        <div className="flex items-center gap-2 md:gap-3 shrink-0 md:order-3">
          <LanguageSwitcher />
          <PhoneBadge />
          <NavCartButton />
        </div>
      </div>
      <div className="min-w-0 flex items-center justify-center md:flex-1 md:order-2">
        <Nav active={active} />
      </div>
    </header>
  )
}
