import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router'
import type { NavLinkRenderProps } from 'react-router'
import { APP_ROUTES } from '../app/routes'
import { BrandLogo } from './brand-logo'
import { LocalIcon, type LocalIconName } from './local-icon'

type AppShellProps = {
  children: ReactNode
}

type PrimaryNavigationItem = {
  label: string
  path:
    | typeof APP_ROUTES.today
    | typeof APP_ROUTES.orders
    | typeof APP_ROUTES.newOrder
    | typeof APP_ROUTES.preparation
    | typeof APP_ROUTES.shoppingList
    | typeof APP_ROUTES.deliveries
    | typeof APP_ROUTES.finance
    | typeof APP_ROUTES.customers
    | typeof APP_ROUTES.settings
  icon: LocalIconName
  end: boolean
}

const PRIMARY_NAVIGATION = [
  {
    label: 'היום',
    path: APP_ROUTES.today,
    icon: 'ph:calendar-bold',
    end: true,
  },
  {
    label: 'הזמנות',
    path: APP_ROUTES.orders,
    icon: 'ph:shopping-cart-bold',
    end: true,
  },
  {
    label: 'הזמנה חדשה',
    path: APP_ROUTES.newOrder,
    icon: 'ph:plus-circle-bold',
    end: false,
  },
  {
    label: 'סיכום הכנות',
    path: APP_ROUTES.preparation,
    icon: 'ph:cooking-pot-bold',
    end: false,
  },
  {
    label: 'רשימת קניות',
    path: APP_ROUTES.shoppingList,
    icon: 'ph:list-checks-bold',
    end: true,
  },
  {
    label: 'משלוחים',
    path: APP_ROUTES.deliveries,
    icon: 'ph:truck-bold',
    end: true,
  },
  {
    label: 'כספים',
    path: APP_ROUTES.finance,
    icon: 'ph:coins-bold',
    end: true,
  },
  {
    label: 'לקוחות',
    path: APP_ROUTES.customers,
    icon: 'ph:users-bold',
    end: true,
  },
  {
    label: 'הגדרות',
    path: APP_ROUTES.settings,
    icon: 'ph:gear-six-bold',
    end: false,
  },
] as const satisfies readonly PrimaryNavigationItem[]

function desktopLinkClassName({ isActive }: NavLinkRenderProps) {
  const stateClassName = isActive
    ? 'bg-secondary text-primary shadow-sm ring-1 ring-border'
    : 'text-muted-foreground hover:bg-secondary/70 hover:text-primary'

  return `group flex min-h-11 items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${stateClassName}`
}

function mobileLinkClassName({ isActive }: NavLinkRenderProps) {
  const stateClassName = isActive
    ? 'bg-primary text-primary-foreground shadow-sm'
    : 'text-muted-foreground hover:bg-secondary hover:text-primary'

  return `flex min-w-[5.25rem] flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[0.6875rem] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${stateClassName}`
}

function DesktopNavigation() {
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-l border-border bg-card/90 px-5 py-6 shadow-[0_0_40px_rgba(99,33,40,0.04)] backdrop-blur-xl md:flex">
      <Link
        to={APP_ROUTES.today}
        aria-label="בת מלך — היום"
        className="mb-8 flex justify-center rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      >
        <BrandLogo alt="בת מלך" className="h-28 w-40" />
      </Link>

      <nav aria-label="ניווט ראשי" className="flex flex-1 flex-col gap-1.5">
        {PRIMARY_NAVIGATION.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.end}
            className={desktopLinkClassName}
          >
            <LocalIcon name={item.icon} className="text-xl" />
            <span>{item.label}</span>
          </NavLink>
        ))}
        <a
          href="/legacy/"
          className="group mt-auto flex min-h-11 items-center gap-3 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <LocalIcon name="ph:arrow-counter-clockwise-bold" className="text-xl" />
          <span>המערכת הישנה</span>
        </a>
      </nav>
    </aside>
  )
}

function MobileHeader() {
  return (
    <header className="sticky top-0 z-30 flex h-20 items-center justify-center border-b border-border bg-card/90 px-4 backdrop-blur-xl md:hidden">
      <Link
        to={APP_ROUTES.today}
        aria-label="בת מלך — היום"
        className="rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <BrandLogo alt="בת מלך" className="h-16 w-24" />
      </Link>
    </header>
  )
}

function MobileNavigation() {
  return (
    <nav
      aria-label="ניווט ראשי לנייד"
      className="fixed inset-x-0 bottom-0 z-40 overflow-x-auto border-t border-border bg-card/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_30px_rgba(99,33,40,0.08)] backdrop-blur-xl md:hidden"
    >
      <div className="mx-auto flex w-max min-w-full items-stretch justify-start gap-1">
        {PRIMARY_NAVIGATION.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.end}
            className={mobileLinkClassName}
          >
            <LocalIcon name={item.icon} className="text-xl" />
            <span className="whitespace-nowrap">{item.label}</span>
          </NavLink>
        ))}
        <a
          href="/legacy/"
          className="flex min-w-[5.25rem] flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[0.6875rem] font-bold text-muted-foreground transition-colors hover:bg-secondary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <LocalIcon name="ph:arrow-counter-clockwise-bold" className="text-xl" />
          <span className="whitespace-nowrap">המערכת הישנה</span>
        </a>
      </div>
    </nav>
  )
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex min-h-screen bg-background text-foreground" dir="rtl">
      <DesktopNavigation />

      <div className="min-w-0 flex-1">
        <MobileHeader />
        <main id="main-content" className="min-h-screen pb-28 md:pb-0">
          {children}
        </main>
      </div>

      <MobileNavigation />
    </div>
  )
}
