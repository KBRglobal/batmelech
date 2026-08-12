import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router'
import { APP_ROUTES, CUSTOMER_ORDER_ROUTE_ALIASES, ROOT_ROUTE_TARGET } from './app/routes.ts'
import { AppShell } from './components/app-shell.tsx'
import { CustomersScreen } from './screens/customers-screen.tsx'
import { DeliveriesScreen } from './screens/deliveries-screen.tsx'
import { FinanceScreen } from './screens/finance-screen.tsx'
import { OrdersScreen } from './screens/orders-screen.tsx'
import { PendingScreen } from './screens/pending-screen.tsx'
import { PreparationScreen } from './screens/preparation-screen.tsx'
import { ShoppingListScreen } from './screens/shopping-list-screen.tsx'
import { TodayScreen } from './screens/today-screen.tsx'

const LEGACY_CUSTOMER_ORDER_ROUTE_ALIASES = [
  ...CUSTOMER_ORDER_ROUTE_ALIASES,
  '/order-form',
  '/order.html',
] as const

function OperatorLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}

function CustomerOrderPendingScreen() {
  return (
    <PendingScreen
      title="טופס הזמנה ללקוחות"
      description="טופס הלקוחות החדש עדיין בתצוגת פיתוח בלבד ואינו שולח או שומר הזמנות."
    />
  )
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path={APP_ROUTES.root} element={<Navigate to={ROOT_ROUTE_TARGET} replace />} />

      <Route element={<OperatorLayout />}>
        <Route path={APP_ROUTES.today} element={<TodayScreen />} />
        <Route path={APP_ROUTES.orders} element={<OrdersScreen />} />
        <Route path={APP_ROUTES.newOrder} element={<PendingScreen title="הזמנה חדשה" />} />
        <Route path={APP_ROUTES.editOrder} element={<PendingScreen title="עריכת הזמנה" />} />
        <Route path={APP_ROUTES.orderBon} element={<PendingScreen title="בון הזמנה" />} />
        <Route
          path={APP_ROUTES.orderImportReview}
          element={<PendingScreen title="בדיקת הזמנה מוואטסאפ" />}
        />
        <Route path={APP_ROUTES.preparation} element={<PreparationScreen />} />
        <Route
          path={APP_ROUTES.preparationLabels}
          element={<PendingScreen title="מדבקות הכנה" />}
        />
        <Route path={APP_ROUTES.deliveries} element={<DeliveriesScreen />} />
        <Route path={APP_ROUTES.finance} element={<FinanceScreen />} />
        <Route path={APP_ROUTES.customers} element={<CustomersScreen />} />
        <Route path={APP_ROUTES.settings} element={<PendingScreen title="הגדרות וגיבוי" />} />
        <Route path={APP_ROUTES.menuSettings} element={<PendingScreen title="עריכת תפריט" />} />
        <Route
          path={APP_ROUTES.recipeSettings}
          element={<PendingScreen title="מתכונים ומצרכים" />}
        />
        <Route path={APP_ROUTES.shoppingList} element={<ShoppingListScreen />} />
        <Route
          path="*"
          element={
            <PendingScreen
              title="העמוד לא נמצא"
              description="הכתובת אינה שייכת למסך קיים במערכת. לא נפתחה ולא שונתה הזמנה."
              notFound
            />
          }
        />
      </Route>

      <Route path={APP_ROUTES.customerOrder} element={<CustomerOrderPendingScreen />} />
      {LEGACY_CUSTOMER_ORDER_ROUTE_ALIASES.map((alias) => (
        <Route
          key={alias}
          path={alias}
          element={<Navigate to={APP_ROUTES.customerOrder} replace />}
        />
      ))}
    </Routes>
  )
}

export function AppRouter() {
  return (
    <BrowserRouter basename="/app">
      <AppRoutes />
    </BrowserRouter>
  )
}

export default AppRouter
