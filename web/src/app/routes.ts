type AbsoluteRoutePath = `/${string}`

export const APP_ROUTES = {
  root: '/',
  today: '/today',
  orders: '/orders',
  newOrder: '/orders/new',
  editOrder: '/orders/:orderId/edit',
  orderBon: '/orders/:orderId/bon',
  orderImportReview: '/orders/new/import-review',
  preparation: '/preparation',
  kitchen: '/kitchen',
  preparationLabels: '/preparation/labels',
  preparationBons: '/preparation/bons',
  deliveries: '/deliveries',
  finance: '/finance',
  insights: '/insights',
  calendar: '/calendar',
  invoices: '/invoices',
  customers: '/customers',
  settings: '/settings',
  menuSettings: '/settings/menu',
  recipeSettings: '/settings/recipes',
  shoppingList: '/shopping-list',
  customerOrder: '/customer-order',
  legacyCustomerOrder: '/order-form.html',
} as const satisfies Record<string, AbsoluteRoutePath>

export type AppRouteKey = keyof typeof APP_ROUTES
export type AppRoutePath = (typeof APP_ROUTES)[AppRouteKey]

export const ROOT_ROUTE_TARGET = APP_ROUTES.today
export const CUSTOMER_ORDER_ROUTE_ALIASES = [APP_ROUTES.legacyCustomerOrder] as const
