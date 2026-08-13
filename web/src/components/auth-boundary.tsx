import { Navigate, Outlet, useLocation } from 'react-router'
import { APP_ROUTES } from '../app/routes.ts'
import { useAuthSession } from '../data/use-auth.ts'
import { BrandLogo } from './brand-logo.tsx'
import { ScreenState } from './screen-state.tsx'

export function safeReturnPath(path: string | null | undefined): string {
  if (
    typeof path !== 'string' ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('\\') ||
    /[\u0000-\u001f\u007f]/u.test(path) ||
    path.startsWith(APP_ROUTES.login) ||
    path.startsWith(APP_ROUTES.accountRecovery)
  ) {
    return APP_ROUTES.today
  }
  return path
}

function AuthLoadingState() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5" dir="rtl">
      <div className="text-center" role="status" aria-live="polite">
        <BrandLogo alt="מטעמי בת מלך" className="mx-auto h-28 w-36" />
        <div className="mx-auto mt-5 size-7 animate-spin rounded-full border-2 border-primary/20 border-t-primary motion-reduce:animate-none" />
        <p className="mt-4 text-sm font-bold text-muted-foreground">בודקים את החיבור המאובטח</p>
      </div>
    </main>
  )
}

export function AuthBoundary() {
  const location = useLocation()
  const sessionQuery = useAuthSession()

  if (sessionQuery.isPending) return <AuthLoadingState />
  if (sessionQuery.isError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-5" dir="rtl">
        <ScreenState
          kind="error"
          title="לא הצלחנו לבדוק את הכניסה"
          description="בדקי את החיבור ונסי שוב. שום הזמנה לא שונתה."
          retry={() => { void sessionQuery.refetch() }}
        />
      </main>
    )
  }

  if (!sessionQuery.data.authenticated) {
    const returnTo = safeReturnPath(`${location.pathname}${location.search}`)
    return (
      <Navigate
        to={`${APP_ROUTES.login}?${new URLSearchParams({ returnTo }).toString()}`}
        replace
      />
    )
  }

  return <Outlet />
}

export default AuthBoundary
