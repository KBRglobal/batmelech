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

export function Nav({ active, dark = true }: { active: string; dark?: boolean }) {
  return (
    <nav
      className={`flex items-center p-1.5 rounded-full shadow-2xl flex-wrap justify-center ${
        dark ? 'bg-black/20 backdrop-blur-xl border border-white/20' : 'bg-white/60 backdrop-blur-md border border-[#EDB2C1]/60 shadow-lg'
      }`}
    >
      {LINKS.map((link) => {
        const isActive = link.to === active
        return (
          <Link
            key={link.to}
            to={link.to}
            className={`px-6 py-2.5 rounded-full text-sm font-black transition-all ${
              isActive
                ? 'bg-white text-[#3B151A] shadow-lg'
                : dark
                  ? 'text-white hover:text-white/80'
                  : 'text-[#3B151A] hover:text-[#3B151A]/80'
            }`}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}

export function PhoneBadge({ dark = true }: { dark?: boolean }) {
  return (
    <a
      href="tel:+971586288776"
      className={`flex items-center gap-4 ${dark ? 'text-white' : 'text-[#3B151A]'}`}
      dir="ltr"
    >
      <Icon icon="ph:phone-fill" className="text-2xl" />
      <span className="font-bold tracking-wider">+971 58 628 8776</span>
    </a>
  )
}

export function BackHeader({ backTo = '/' }: { backTo?: string }) {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-[#F7ECE6]/80 backdrop-blur-xl border-b border-[#EDB2C1]/20 p-6">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <Link to={backTo} className="flex items-center gap-2 text-[#3B151A] font-black">
          <Icon icon="ph:arrow-right-bold" className="text-2xl" /> חזרה
        </Link>
        <div className="w-12 h-12 flex items-center justify-center">
          <img src="/site/assets/logo.jpg" className="h-full object-contain rounded-full" alt="בת מלך" />
        </div>
      </div>
    </header>
  )
}
