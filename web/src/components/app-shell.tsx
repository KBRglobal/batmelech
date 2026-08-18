import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router'
import type { NavLinkRenderProps } from 'react-router'
import { APP_ROUTES } from '../app/routes'
import { BrandLogo } from './brand-logo'
import { GlobalSearch } from './global-search'
import { LocalIcon, type LocalIconName } from './local-icon'
import { NewOrderAlerts } from './new-order-alerts'

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
    | typeof APP_ROUTES.insights
    | typeof APP_ROUTES.activity
    | typeof APP_ROUTES.calendar
    | typeof APP_ROUTES.invoices
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
    label: 'יומן פעילות',
    path: APP_ROUTES.activity,
    icon: 'ph:clock-counter-clockwise-bold',
    end: true,
  },
  {
    label: 'לוח שנה',
    path: APP_ROUTES.calendar,
    icon: 'ph:calendar-bold',
    end: true,
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
    label: 'תובנות',
    path: APP_ROUTES.insights,
    icon: 'ph:chart-pie-slice-bold',
    end: true,
  },
  {
    label: 'חשבוניות',
    path: APP_ROUTES.invoices,
    icon: 'ph:receipt-bold',
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

// On phones the full destination list no longer fits a bottom bar, so the
// bar keeps the four everyday destinations plus a "more" toggle that opens a
// bottom sheet with everything else (including alerts, legacy and logout).
const MOBILE_BAR_PATHS: readonly string[] = [
  APP_ROUTES.today,
  APP_ROUTES.orders,
  APP_ROUTES.newOrder,
  APP_ROUTES.preparation,
]

const MOBILE_BAR_NAVIGATION = PRIMARY_NAVIGATION.filter((item) => MOBILE_BAR_PATHS.includes(item.path))
const MOBILE_SHEET_NAVIGATION = PRIMARY_NAVIGATION.filter((item) => !MOBILE_BAR_PATHS.includes(item.path))

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

  return `flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[0.6875rem] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${stateClassName}`
}

function sheetLinkClassName({ isActive }: NavLinkRenderProps) {
  const stateClassName = isActive
    ? 'bg-primary text-primary-foreground shadow-sm'
    : 'text-muted-foreground hover:bg-secondary hover:text-primary'

  return `flex min-h-[4.25rem] flex-col items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${stateClassName}`
}

const SHEET_ROW_CLASS_NAME =
  'flex min-h-11 w-full items-center gap-3 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

async function handleLogout() {
  await fetch('/api/auth/logout', { method: 'POST' })
  window.location.href = '/'
}

function DesktopNavigation() {
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-l border-border bg-card/90 px-5 py-6 shadow-[0_0_40px_rgba(99,33,40,0.04)] backdrop-blur-xl md:flex print:hidden">
      <Link
        to={APP_ROUTES.today}
        aria-label="בת מלך — היום"
        className="mb-8 flex justify-center rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      >
        <BrandLogo alt="בת מלך" className="h-28 w-40" />
      </Link>

      <GlobalSearch variant="desktop" />

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
        <div className="mt-auto">
          <NewOrderAlerts />
        </div>
        <a
          href="/legacy/"
          className="group flex min-h-11 items-center gap-3 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <LocalIcon name="ph:arrow-counter-clockwise-bold" className="text-xl" />
          <span>המערכת הישנה</span>
        </a>
        <button
          type="button"
          onClick={handleLogout}
          className="group flex min-h-11 items-center gap-3 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <LocalIcon name="ph:sign-out-bold" className="text-xl" />
          <span>התנתקות</span>
        </button>
      </nav>
    </aside>
  )
}

function MobileHeader() {
  return (
    <header className="sticky top-0 z-30 flex h-20 items-center justify-center border-b border-border bg-card/90 px-4 backdrop-blur-xl md:hidden print:hidden">
      <Link
        to={APP_ROUTES.today}
        aria-label="בת מלך — היום"
        className="rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <BrandLogo alt="בת מלך" className="h-16 w-24" />
      </Link>
      <div className="absolute inset-y-0 start-4 flex items-center">
        <GlobalSearch variant="mobile" />
      </div>
    </header>
  )
}

function MobileNavigation() {
  const [moreOpen, setMoreOpen] = useState(false)
  const closeMore = () => setMoreOpen(false)

  useEffect(() => {
    if (!moreOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [moreOpen])

  return (
    <>
      {moreOpen ? (
        <div className="fixed inset-0 z-40 md:hidden print:hidden">
          <button
            type="button"
            aria-label="סגירת התפריט"
            onClick={closeMore}
            className="absolute inset-0 h-full w-full cursor-default bg-foreground/30 backdrop-blur-sm"
          />
          <div
            id="mobile-more-sheet"
            aria-label="ניווט נוסף"
            className="absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-3xl border-t border-border bg-card px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-4 shadow-[0_-20px_50px_rgba(99,33,40,0.16)]"
          >
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-border" aria-hidden="true" />
            <nav aria-label="כל המסכים" className="grid grid-cols-3 gap-2">
              {MOBILE_SHEET_NAVIGATION.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.end}
                  onClick={closeMore}
                  className={sheetLinkClassName}
                >
                  <LocalIcon name={item.icon} className="text-xl" />
                  <span className="max-w-full truncate">{item.label}</span>
                </NavLink>
              ))}
            </nav>
            <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
              <NewOrderAlerts />
              <a href="/legacy/" className={SHEET_ROW_CLASS_NAME}>
                <LocalIcon name="ph:arrow-counter-clockwise-bold" className="text-xl" />
                <span>המערכת הישנה</span>
              </a>
              <button type="button" onClick={handleLogout} className={SHEET_ROW_CLASS_NAME}>
                <LocalIcon name="ph:sign-out-bold" className="text-xl" />
                <span>התנתקות</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <nav
        aria-label="ניווט ראשי לנייד"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_30px_rgba(99,33,40,0.08)] backdrop-blur-xl md:hidden print:hidden"
      >
        <div className="grid grid-cols-5 gap-1">
          {MOBILE_BAR_NAVIGATION.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.end}
              onClick={closeMore}
              className={mobileLinkClassName}
            >
              <LocalIcon name={item.icon} className="text-xl" />
              <span className="max-w-full truncate">{item.label}</span>
            </NavLink>
          ))}
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-controls="mobile-more-sheet"
            onClick={() => setMoreOpen((open) => !open)}
            className={`flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[0.6875rem] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
              moreOpen
                ? 'bg-secondary text-primary shadow-sm ring-1 ring-border'
                : 'text-muted-foreground hover:bg-secondary hover:text-primary'
            }`}
          >
            <LocalIcon name={moreOpen ? 'ph:x-bold' : 'ph:caret-up-bold'} className="text-xl" />
            <span className="max-w-full truncate">עוד</span>
          </button>
        </div>
      </nav>
    </>
  )
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex min-h-screen bg-background text-foreground print:block print:min-h-0" dir="rtl">
      <DesktopNavigation />

      <div className="min-w-0 flex-1">
        <MobileHeader />
        <main id="main-content" className="min-h-screen pb-28 md:pb-0 print:min-h-0 print:pb-0">
          {children}
        </main>
      </div>

      <MobileNavigation />
    </div>
  )
}
