// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  APP_ROUTES,
  CUSTOMER_ORDER_ROUTE_ALIASES,
  ROOT_ROUTE_TARGET,
} from './app/routes.ts'
import { AppRouter, AppRoutes } from './router.tsx'

vi.mock('./screens/today-screen.tsx', () => ({
  TodayScreen: () => <h1>מסך היום המחובר</h1>,
}))

const LEGACY_CUSTOMER_ORDER_ROUTE_ALIASES = [
  ...CUSTOMER_ORDER_ROUTE_ALIASES,
  '/order-form',
  '/order.html',
] as const

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="current route">{`${location.pathname}${location.search}`}</output>
}

function renderRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
      <LocationProbe />
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  window.history.replaceState({}, '', '/')
})

describe('AppRoutes', () => {
  it('mounts BrowserRouter below the production /app basename', () => {
    window.history.pushState({}, '', '/app/today')

    render(<AppRouter />)

    expect(screen.getByRole('heading', { name: 'מסך היום המחובר' })).toBeTruthy()
    expect(screen.getAllByRole('navigation')).toHaveLength(2)
  })

  it('redirects the root route to Today and renders it inside the shared operator shell', async () => {
    renderRoute(APP_ROUTES.root)

    await waitFor(() => {
      expect(screen.getByLabelText('current route').textContent).toBe(ROOT_ROUTE_TARGET)
    })
    expect(screen.getByRole('heading', { name: 'מסך היום המחובר' })).toBeTruthy()
    expect(screen.getAllByRole('navigation')).toHaveLength(2)
    expect(document.querySelector('#main-content')).toBeTruthy()
  })

  it.each([
    [APP_ROUTES.orders, 'הזמנות'],
    [APP_ROUTES.newOrder, 'הזמנה חדשה'],
    ['/orders/order%201/edit', 'עריכת הזמנה'],
    ['/orders/order%201/bon', 'בון הזמנה'],
    [APP_ROUTES.orderImportReview, 'בדיקת הזמנה מוואטסאפ'],
    [APP_ROUTES.preparation, 'סיכום הכנות'],
    [APP_ROUTES.preparationLabels, 'מדבקות הכנה'],
    [APP_ROUTES.deliveries, 'משלוחים'],
    [APP_ROUTES.finance, 'כספים'],
    [APP_ROUTES.customers, 'לקוחות'],
    [APP_ROUTES.settings, 'הגדרות וגיבוי'],
    [APP_ROUTES.menuSettings, 'עריכת תפריט'],
    [APP_ROUTES.recipeSettings, 'מתכונים ומצרכים'],
    [APP_ROUTES.shoppingList, 'רשימת קניות'],
  ])('registers %s as an explicit non-writing operator destination', (path, title) => {
    const { container } = renderRoute(path)

    expect(container.querySelector('[data-route-status="pending"]')).toBeTruthy()
    expect(screen.getByRole('heading', { name: title })).toBeTruthy()
    expect(screen.getAllByRole('navigation')).toHaveLength(2)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('registers the canonical customer route without the operator navigation', () => {
    const { container } = renderRoute(APP_ROUTES.customerOrder)

    expect(container.querySelector('[data-route-status="pending"]')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'טופס הזמנה ללקוחות' })).toBeTruthy()
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.getByText(/אינו שולח או שומר הזמנות/)).toBeTruthy()
  })

  it.each(LEGACY_CUSTOMER_ORDER_ROUTE_ALIASES)(
    'redirects the legacy customer route %s to the canonical customer route',
    async (legacyRoute) => {
      renderRoute(legacyRoute)

      await waitFor(() => {
        expect(screen.getByLabelText('current route').textContent).toBe(APP_ROUTES.customerOrder)
      })
      expect(screen.getByRole('heading', { name: 'טופס הזמנה ללקוחות' })).toBeTruthy()
      expect(screen.queryByRole('navigation')).toBeNull()
    },
  )

  it('renders an explicit not-found state without interpreting an unknown path as an order', () => {
    const { container } = renderRoute('/orders/untrusted-order-id')

    expect(container.querySelector('[data-route-status="not-found"]')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'העמוד לא נמצא' })).toBeTruthy()
    expect(screen.getByText(/לא נפתחה ולא שונתה הזמנה/)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'עריכת הזמנה' })).toBeNull()
    expect(screen.getByLabelText('current route').textContent).toBe('/orders/untrusted-order-id')
  })
})
