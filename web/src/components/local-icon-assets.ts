const PUBLIC_BASE = import.meta.env.BASE_URL

export const LOCAL_ICON_PATHS = {
  'ph:arrow-counter-clockwise-bold': `${PUBLIC_BASE}icons/ph-arrow-counter-clockwise-bold.svg`,
  'ph:arrow-left-bold': `${PUBLIC_BASE}icons/ph-arrow-left-bold.svg`,
  'ph:calendar-bold': `${PUBLIC_BASE}icons/ph-calendar-bold.svg`,
  'ph:chart-pie-slice-bold': `${PUBLIC_BASE}icons/ph-chart-pie-slice-bold.svg`,
  'ph:check-circle-bold': `${PUBLIC_BASE}icons/ph-check-circle-bold.svg`,
  'ph:clock-bold': `${PUBLIC_BASE}icons/ph-clock-bold.svg`,
  'ph:cloud-arrow-up-bold': `${PUBLIC_BASE}icons/ph-cloud-arrow-up-bold.svg`,
  'ph:coins-bold': `${PUBLIC_BASE}icons/ph-coins-bold.svg`,
  'ph:cooking-pot-bold': `${PUBLIC_BASE}icons/ph-cooking-pot-bold.svg`,
  'ph:gear-six-bold': `${PUBLIC_BASE}icons/ph-gear-six-bold.svg`,
  'ph:image-bold': `${PUBLIC_BASE}icons/ph-image-bold.svg`,
  'ph:list-checks-bold': `${PUBLIC_BASE}icons/ph-list-checks-bold.svg`,
  'ph:map-pin-bold': `${PUBLIC_BASE}icons/ph-map-pin-bold.svg`,
  'ph:package-bold': `${PUBLIC_BASE}icons/ph-package-bold.svg`,
  'ph:pencil-simple-bold': `${PUBLIC_BASE}icons/ph-pencil-simple-bold.svg`,
  'ph:plus-bold': `${PUBLIC_BASE}icons/ph-plus-bold.svg`,
  'ph:plus-circle-bold': `${PUBLIC_BASE}icons/ph-plus-circle-bold.svg`,
  'ph:receipt-bold': `${PUBLIC_BASE}icons/ph-receipt-bold.svg`,
  'ph:shopping-cart-bold': `${PUBLIC_BASE}icons/ph-shopping-cart-bold.svg`,
  'ph:sign-out-bold': `${PUBLIC_BASE}icons/ph-sign-out-bold.svg`,
  'ph:storefront-bold': `${PUBLIC_BASE}icons/ph-storefront-bold.svg`,
  'ph:truck-bold': `${PUBLIC_BASE}icons/ph-truck-bold.svg`,
  'ph:users-bold': `${PUBLIC_BASE}icons/ph-users-bold.svg`,
  'ph:warning-circle-bold': `${PUBLIC_BASE}icons/ph-warning-circle-bold.svg`,
  'ph:x-bold': `${PUBLIC_BASE}icons/ph-x-bold.svg`,
} as const

export type LocalIconName = keyof typeof LOCAL_ICON_PATHS
