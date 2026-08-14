import { Icon } from '@iconify/react'
import { Link } from 'react-router'
import { useCart } from '../cart-context'

const LINKS = [
  { to: '/weekdays', label: 'יום חול' },
  { to: '/shabbat-order', label: 'שבת קודש' },
  { to: '/shabbat-extras', label: 'חיזוקים לסופ״ש' },
]

export function Nav({ active }: { active: string }) {
  return (
    <nav className="flex items-center p-1 md:p-1.5 rounded-full shadow-2xl bg-black/20 backdrop-blur-xl border border-white/20 overflow-x-auto max-w-full">
      {LINKS.map((link) => {
        const isActive = link.to === active
        return (
          <Link
            key={link.to}
            to={link.to}
            className={`px-3 md:px-6 py-2 md:py-2.5 rounded-full text-xs md:text-sm font-black whitespace-nowrap transition-all ${
              isActive ? 'bg-white text-[#3B151A] shadow-lg' : 'text-white hover:text-white/80'
            }`}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}

export function NavCartButton() {
  const { lines } = useCart()
  const count = lines.reduce((n, l) => n + l.qty, 0)

  return (
    <Link
      to="/checkout"
      className="relative flex items-center justify-center w-9 h-9 md:w-11 md:h-11 rounded-full bg-white text-[#3B151A] shadow-xl shrink-0"
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
  return (
    <Link to="/" className="shrink-0 w-10 h-10 md:w-16 md:h-16">
      <img src="/site/assets/logo-cream.png" alt="מטעמי בת מלך" className="w-full h-full object-contain drop-shadow-[0_2px_10px_rgba(59,21,26,0.5)]" />
    </Link>
  )
}

export function PhoneBadge() {
  return (
    <a
      href="tel:+971586288776"
      className="flex items-center gap-3 text-white bg-black/20 backdrop-blur-xl border border-white/20 rounded-full w-9 h-9 md:w-auto md:h-auto md:px-5 md:py-2.5 shadow-xl shrink-0 justify-center"
      dir="ltr"
    >
      <Icon icon="ph:phone-fill" className="text-base md:text-xl" />
      <span className="hidden md:inline font-bold tracking-wider text-sm">+971 58 628 8776</span>
    </a>
  )
}

export function NavHeader({ active }: { active: string }) {
  return (
    <header className="w-full pt-5 px-4 md:pt-8 md:px-16 flex items-center justify-between gap-2 md:gap-6">
      <NavLogo />
      <div className="flex-1 min-w-0 flex items-center justify-center">
        <Nav active={active} />
      </div>
      <div className="flex items-center gap-2 md:gap-3 shrink-0">
        <PhoneBadge />
        <NavCartButton />
      </div>
    </header>
  )
}
