import { Icon } from '@iconify/react'
import { Link } from 'react-router'

const LINKS = [
  { to: '/', label: 'בית' },
  { to: '/weekdays', label: 'יום חול' },
  { to: '/shabbat-order', label: 'שבת קודש' },
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
    <header className="w-full pt-8 px-6 md:px-16 flex flex-col md:flex-row items-center justify-between gap-6">
      <div className="order-1 md:order-2">
        <Nav active={active} />
      </div>
      <div className="order-2 md:order-1">
        <PhoneBadge />
      </div>
    </header>
  )
}
