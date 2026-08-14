import { Icon } from '@iconify/react'
import { Link } from 'react-router'
import { useCart } from '../cart-context'

const LINKS = [
  { to: '/', label: 'בית' },
  { to: '/weekdays', label: 'יום חול' },
  { to: '/shabbat-order', label: 'שבת קודש' },
  { to: '/shabbat-order#free-items', label: 'חיזוקים לסופ״ש' },
  { to: '/story', label: 'עלינו' },
  { to: '/events', label: 'אירועים' },
  { to: '/gallery', label: 'גלריה' },
  { to: '/kashrut', label: 'כשרות' },
]

export function Nav({ active }: { active: string }) {
  return (
    <nav className="flex items-center p-1.5 rounded-full shadow-2xl flex-wrap justify-center bg-black/20 backdrop-blur-xl border border-white/20">
      {LINKS.map((link) => {
        const isActive = link.to === active
        return (
          <Link
            key={link.to}
            to={link.to}
            className={`px-6 py-2.5 rounded-full text-sm font-black transition-all ${
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
      className="relative flex items-center justify-center w-11 h-11 rounded-full bg-white text-[#3B151A] shadow-xl shrink-0"
    >
      <Icon icon="ph:basket-fill" className="text-lg" />
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
    <Link to="/" className="shrink-0 w-14 h-14 md:w-16 md:h-16">
      <img src="/site/assets/logo-cream.png" alt="מטעמי בת מלך" className="w-full h-full object-contain drop-shadow-[0_2px_10px_rgba(59,21,26,0.5)]" />
    </Link>
  )
}

export function PhoneBadge() {
  return (
    <a
      href="tel:+971586288776"
      className="flex items-center gap-3 text-white bg-black/20 backdrop-blur-xl border border-white/20 rounded-full px-5 py-2.5 shadow-xl"
      dir="ltr"
    >
      <Icon icon="ph:phone-fill" className="text-xl" />
      <span className="font-bold tracking-wider text-sm">+971 58 628 8776</span>
    </a>
  )
}

export function NavHeader({ active }: { active: string }) {
  return (
    <header className="w-full pt-8 px-6 md:px-16 flex flex-col md:grid md:grid-cols-3 items-center gap-6">
      <div className="flex items-center justify-center md:justify-start order-1">
        <NavLogo />
      </div>
      <div className="flex items-center justify-center order-3 md:order-2">
        <Nav active={active} />
      </div>
      <div className="flex items-center justify-center md:justify-end gap-3 order-2 md:order-3">
        <PhoneBadge />
        <NavCartButton />
      </div>
    </header>
  )
}
