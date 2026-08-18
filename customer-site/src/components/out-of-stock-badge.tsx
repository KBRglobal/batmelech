import { Icon } from '@iconify/react'
import { useLocale, type Locale } from '../locale-context'

const HE = {
  soldOut: 'אזל מהמלאי',
}

export const COPY: Record<Locale, typeof HE> = {
  he: HE,
  en: { soldOut: 'Sold out' },
  fr: { soldOut: 'Épuisé' },
}

export function OutOfStockBadge({ className = '' }: { className?: string }) {
  const { locale } = useLocale()
  const t = COPY[locale]
  return (
    <span
      className={`z-20 inline-flex items-center gap-1 bg-[#8D182C] text-white text-[9px] font-black px-2 py-1 rounded-full shadow-lg backdrop-blur-sm ${className}`}
    >
      <Icon icon="ph:prohibit-bold" />
      {t.soldOut}
    </span>
  )
}
