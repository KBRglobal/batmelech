import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router'
import { APP_ROUTES, CUSTOMER_ORDER_ROUTE_ALIASES, ROOT_ROUTE_TARGET } from './app/routes.ts'
import { AppShell } from './components/app-shell.tsx'
import useVersionedScreenSave from './data/versioned-screen-save.tsx'
import { CustomersScreen } from './screens/customers-screen.tsx'
import { CustomerOrderScreen } from './screens/customer-order-screen.tsx'
import { DeliveriesScreen } from './screens/deliveries-screen.tsx'
import { FinanceScreen } from './screens/finance-screen.tsx'
import { LabelsScreen } from './screens/labels-screen.tsx'
import { MenuEditorScreen } from './screens/menu-editor-screen.tsx'
import { OrderBonScreen } from './screens/order-bon-screen.tsx'
import { OrderEditorScreen } from './screens/order-editor-screen.tsx'
import { OrderImportReviewScreen } from './screens/order-import-review-screen.tsx'
import { OrdersScreen } from './screens/orders-screen.tsx'
import { PendingScreen } from './screens/pending-screen.tsx'
import { PreparationScreen } from './screens/preparation-screen.tsx'
import { RecipesScreen } from './screens/recipes-screen.tsx'
import { SettingsBackupScreen } from './screens/settings-backup-screen.tsx'
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

function SettingsScreenWithSave() {
  const { onSave } = useVersionedScreenSave()
  return <SettingsBackupScreen onSave={async (request) => { await onSave(request) }} />
}

function MenuScreenWithSave() {
  const { onSave } = useVersionedScreenSave()
  return <MenuEditorScreen onSave={async (request) => { await onSave(request) }} />
}

function RecipesScreenWithSave() {
  const { onSave } = useVersionedScreenSave()
  return <RecipesScreen onSave={async (request) => { await onSave(request) }} />
}

function CustomersScreenWithSave() {
  const { onSave } = useVersionedScreenSave()
  return <CustomersScreen onSave={async (request) => { await onSave(request) }} />
}

function FinanceScreenWithSave() {
  const { onSave } = useVersionedScreenSave()
  return <FinanceScreen onSave={async (request) => { await onSave(request) }} />
}

function DeliveriesScreenWithSave() {
  const { onSave } = useVersionedScreenSave()
  return <DeliveriesScreen onSave={onSave} />
}

function PreparationScreenWithSave() {
  const { onSave } = useVersionedScreenSave()
  return <PreparationScreen onSave={onSave} />
}

function ShoppingListScreenWithSave() {
  const { onSave } = useVersionedScreenSave()
  return <ShoppingListScreen onSave={onSave} />
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path={APP_ROUTES.root} element={<Navigate to={ROOT_ROUTE_TARGET} replace />} />

      <Route element={<OperatorLayout />}>
        <Route path={APP_ROUTES.today} element={<TodayScreen />} />
        <Route path={APP_ROUTES.orders} element={<OrdersScreen />} />
        <Route path={APP_ROUTES.newOrder} element={<OrderEditorScreen />} />
        <Route path={APP_ROUTES.editOrder} element={<OrderEditorScreen />} />
        <Route path={APP_ROUTES.orderBon} element={<OrderBonScreen />} />
        <Route
          path={APP_ROUTES.orderImportReview}
          element={<OrderImportReviewScreen />}
        />
        <Route path={APP_ROUTES.preparation} element={<PreparationScreenWithSave />} />
        <Route
          path={APP_ROUTES.preparationLabels}
          element={<LabelsScreen />}
        />
        <Route path={APP_ROUTES.deliveries} element={<DeliveriesScreenWithSave />} />
        <Route path={APP_ROUTES.finance} element={<FinanceScreenWithSave />} />
        <Route path={APP_ROUTES.customers} element={<CustomersScreenWithSave />} />
        <Route path={APP_ROUTES.settings} element={<SettingsScreenWithSave />} />
        <Route path={APP_ROUTES.menuSettings} element={<MenuScreenWithSave />} />
        <Route
          path={APP_ROUTES.recipeSettings}
          element={<RecipesScreenWithSave />}
        />
        <Route path={APP_ROUTES.shoppingList} element={<ShoppingListScreenWithSave />} />
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

      <Route path={APP_ROUTES.customerOrder} element={<CustomerOrderScreen />} />
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
