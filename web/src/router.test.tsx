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
vi.mock('./screens/orders-screen.tsx', () => ({
  OrdersScreen: () => <h1>מסך ההזמנות המחובר</h1>,
}))
vi.mock('./screens/preparation-screen.tsx', () => ({
  PreparationScreen: ({ onSave }: { onSave?: unknown }) => (
    <h1 data-save-bound={typeof onSave === 'function'}>מסך ההכנות המחובר</h1>
  ),
}))
vi.mock('./screens/shopping-list-screen.tsx', () => ({
  ShoppingListScreen: ({ onSave }: { onSave?: unknown }) => (
    <h1 data-save-bound={typeof onSave === 'function'}>מסך הקניות המחובר</h1>
  ),
}))
vi.mock('./screens/deliveries-screen.tsx', () => ({
  DeliveriesScreen: ({ onSave }: { onSave?: unknown }) => (
    <h1 data-save-bound={typeof onSave === 'function'}>מסך המשלוחים המחובר</h1>
  ),
}))
vi.mock('./screens/customers-screen.tsx', () => ({
  CustomersScreen: ({ onSave }: { onSave?: unknown }) => (
    <h1 data-save-bound={typeof onSave === 'function'}>מסך הלקוחות המחובר</h1>
  ),
}))
vi.mock('./screens/finance-screen.tsx', () => ({
  FinanceScreen: ({ onSave }: { onSave?: unknown }) => (
    <h1 data-save-bound={typeof onSave === 'function'}>מסך הכספים המחובר</h1>
  ),
}))
vi.mock('./screens/order-editor-screen.tsx', () => ({
  OrderEditorScreen: () => <h1>מסך עריכת ההזמנה המחובר</h1>,
}))
vi.mock('./screens/order-import-review-screen.tsx', () => ({
  OrderImportReviewScreen: () => <h1>מסך בדיקת הוואטסאפ המחובר</h1>,
}))
vi.mock('./screens/order-bon-screen.tsx', () => ({
  OrderBonScreen: () => <h1>מסך בון ההזמנה המחובר</h1>,
}))
vi.mock('./screens/labels-screen.tsx', () => ({
  LabelsScreen: () => <h1>מסך המדבקות המחובר</h1>,
}))
vi.mock('./screens/settings-backup-screen.tsx', () => ({
  SettingsBackupScreen: () => <h1>מסך ההגדרות המחובר</h1>,
}))
vi.mock('./screens/menu-editor-screen.tsx', () => ({
  MenuEditorScreen: () => <h1>מסך עריכת התפריט המחובר</h1>,
}))
vi.mock('./screens/recipes-screen.tsx', () => ({
  RecipesScreen: () => <h1>מסך המתכונים המחובר</h1>,
}))
vi.mock('./screens/customer-order-screen.tsx', () => ({
  CustomerOrderScreen: () => <h1>מסך הזמנת הלקוח המחובר</h1>,
}))
vi.mock('./data/versioned-screen-save.tsx', () => ({
  default: () => ({ onSave: vi.fn() }),
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

  it('mounts BrowserRouter below the /linaya basename', () => {
    window.history.pushState({}, '', '/linaya/today')

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

  it('registers the real read-only Orders screen inside the shared shell', () => {
    const { container } = renderRoute(APP_ROUTES.orders)

    expect(container.querySelector('[data-route-status="pending"]')).toBeNull()
    expect(screen.getByRole('heading', { name: 'מסך ההזמנות המחובר' })).toBeTruthy()
    expect(screen.getAllByRole('navigation')).toHaveLength(2)
  })

  it.each([
    [APP_ROUTES.preparation, 'מסך ההכנות המחובר'],
    [APP_ROUTES.shoppingList, 'מסך הקניות המחובר'],
    [APP_ROUTES.deliveries, 'מסך המשלוחים המחובר'],
    [APP_ROUTES.customers, 'מסך הלקוחות המחובר'],
    [APP_ROUTES.finance, 'מסך הכספים המחובר'],
    [APP_ROUTES.newOrder, 'מסך עריכת ההזמנה המחובר'],
    ['/orders/order%201/edit', 'מסך עריכת ההזמנה המחובר'],
    [APP_ROUTES.orderImportReview, 'מסך בדיקת הוואטסאפ המחובר'],
    ['/orders/order%201/bon', 'מסך בון ההזמנה המחובר'],
    [APP_ROUTES.preparationLabels, 'מסך המדבקות המחובר'],
    [APP_ROUTES.settings, 'מסך ההגדרות המחובר'],
    [APP_ROUTES.menuSettings, 'מסך עריכת התפריט המחובר'],
    [APP_ROUTES.recipeSettings, 'מסך המתכונים המחובר'],
  ])('registers the real read-only operational screen at %s', (path, title) => {
    const { container } = renderRoute(path)

    expect(container.querySelector('[data-route-status="pending"]')).toBeNull()
    expect(screen.getByRole('heading', { name: title })).toBeTruthy()
    expect(screen.getAllByRole('navigation')).toHaveLength(2)
  })

  it.each([
    [APP_ROUTES.customers, 'מסך הלקוחות המחובר'],
    [APP_ROUTES.finance, 'מסך הכספים המחובר'],
    [APP_ROUTES.deliveries, 'מסך המשלוחים המחובר'],
    [APP_ROUTES.preparation, 'מסך ההכנות המחובר'],
    [APP_ROUTES.shoppingList, 'מסך הקניות המחובר'],
  ])('binds the guarded save boundary at %s', (path, title) => {
    renderRoute(path)

    expect(screen.getByRole('heading', { name: title }).getAttribute('data-save-bound')).toBe('true')
  })

  it('registers the canonical customer route without the operator navigation', () => {
    const { container } = renderRoute(APP_ROUTES.customerOrder)

    expect(container.querySelector('[data-route-status="pending"]')).toBeNull()
    expect(screen.getByRole('heading', { name: 'מסך הזמנת הלקוח המחובר' })).toBeTruthy()
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it.each(LEGACY_CUSTOMER_ORDER_ROUTE_ALIASES)(
    'redirects the legacy customer route %s to the canonical customer route',
    async (legacyRoute) => {
      renderRoute(legacyRoute)

      await waitFor(() => {
        expect(screen.getByLabelText('current route').textContent).toBe(APP_ROUTES.customerOrder)
      })
      expect(screen.getByRole('heading', { name: 'מסך הזמנת הלקוח המחובר' })).toBeTruthy()
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
