import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router'
import { APP_ROUTES, CUSTOMER_ORDER_ROUTE_ALIASES, ROOT_ROUTE_TARGET } from './app/routes.ts'
import { AppShell } from './components/app-shell.tsx'
import useVersionedScreenSave from './data/versioned-screen-save.tsx'
import { CustomersScreen } from './screens/customers-screen.tsx'
import { CustomerOrderScreen } from './screens/customer-order-screen.tsx'
import { DeliveriesScreen } from './screens/deliveries-screen.tsx'
import { DeliveryPhotosScreen } from './screens/delivery-photos-screen.tsx'
import { FinanceScreen } from './screens/finance-screen.tsx'
import { ActivityScreen } from './screens/activity-screen.tsx'
import { CalendarScreen } from './screens/calendar-screen.tsx'
import { CostReportScreen } from './screens/cost-report-screen.tsx'
import { InsightsScreen } from './screens/insights-screen.tsx'
import { InvoicesScreen } from './screens/invoices-screen.tsx'
import { SupplierExpensesScreen } from './screens/supplier-expenses-screen.tsx'
import { KitchenScreen, KitchenStandaloneScreen } from './screens/kitchen-screen.tsx'
import { LabelsScreen } from './screens/labels-screen.tsx'
import { MenuEditorScreen } from './screens/menu-editor-screen.tsx'
import { OrderBonScreen } from './screens/order-bon-screen.tsx'
import { OrderBonsBatchScreen } from './screens/order-bons-batch-screen.tsx'
import { OrderEditorScreen } from './screens/order-editor-screen.tsx'
import { OrderImportReviewScreen } from './screens/order-import-review-screen.tsx'
import { OrdersScreen } from './screens/orders-screen.tsx'
import { PendingScreen } from './screens/pending-screen.tsx'
import { PreparationScreen } from './screens/preparation-screen.tsx'
import { ProductLibraryScreen } from './screens/product-library-screen.tsx'
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

function ProductLibraryScreenWithSave() {
  const { onSave } = useVersionedScreenSave()
  return <ProductLibraryScreen onSave={async (request) => { await onSave(request) }} />
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

function DeliveryPhotosScreenWithSave() {
  useVersionedScreenSave()
  return <DeliveryPhotosScreen />
}

function PreparationScreenWithSave() {
  const { onSave } = useVersionedScreenSave()
  return <PreparationScreen onSave={onSave} />
}

function ShoppingListScreenWithSave() {
  const { onSave } = useVersionedScreenSave()
  return <ShoppingListScreen onSave={onSave} />
}

function OrdersScreenWithSave() {
  const { onSave } = useVersionedScreenSave()
  return <OrdersScreen onSave={async (request) => { await onSave(request) }} />
}

function TodayScreenWithSave() {
  const { onSave } = useVersionedScreenSave()
  return <TodayScreen onSave={async (request) => { await onSave(request) }} />
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path={APP_ROUTES.root} element={<Navigate to={ROOT_ROUTE_TARGET} replace />} />

      <Route element={<OperatorLayout />}>
        <Route path={APP_ROUTES.today} element={<TodayScreenWithSave />} />
        <Route path={APP_ROUTES.orders} element={<OrdersScreenWithSave />} />
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
        <Route
          path={APP_ROUTES.preparationBons}
          element={<OrderBonsBatchScreen />}
        />
        <Route path={APP_ROUTES.deliveries} element={<DeliveriesScreenWithSave />} />
        <Route path={APP_ROUTES.deliveryPhotos} element={<DeliveryPhotosScreenWithSave />} />
        <Route path={APP_ROUTES.finance} element={<FinanceScreenWithSave />} />
        <Route path={APP_ROUTES.insights} element={<InsightsScreen />} />
        <Route path={APP_ROUTES.activity} element={<ActivityScreen />} />
        <Route path={APP_ROUTES.calendar} element={<CalendarScreen />} />
        <Route path={APP_ROUTES.invoices} element={<InvoicesScreen />} />
        <Route path={APP_ROUTES.supplierExpenses} element={<SupplierExpensesScreen />} />
        <Route path={APP_ROUTES.customers} element={<CustomersScreenWithSave />} />
        <Route path={APP_ROUTES.settings} element={<SettingsScreenWithSave />} />
        <Route path={APP_ROUTES.menuSettings} element={<MenuScreenWithSave />} />
        <Route
          path={APP_ROUTES.recipeSettings}
          element={<RecipesScreenWithSave />}
        />
        <Route path={APP_ROUTES.productLibrary} element={<ProductLibraryScreenWithSave />} />
        <Route path={APP_ROUTES.costReport} element={<CostReportScreen />} />
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

      <Route path={APP_ROUTES.kitchen} element={<KitchenScreen exitTo={APP_ROUTES.preparation} />} />

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
  const pathname = typeof window !== 'undefined' ? window.location.pathname : ''
  // The wall-tablet surface: the whole bundle serves ONLY the kitchen board
  // under /kitchen — no other screen exists there, by design.
  if (pathname.startsWith('/kitchen')) {
    return (
      <BrowserRouter basename="/kitchen">
        <Routes>
          <Route path="*" element={<KitchenStandaloneScreen />} />
        </Routes>
      </BrowserRouter>
    )
  }
  const operatorBasePath = pathname.startsWith('/orders/admin')
    ? '/orders/admin'
    : pathname.startsWith('/admin')
    ? '/admin'
    : '/app'
  return (
    <BrowserRouter basename={operatorBasePath}>
      <AppRoutes />
    </BrowserRouter>
  )
}

export default AppRouter
