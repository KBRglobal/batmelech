import { Icon } from '@iconify/react'
import { useLocale, type Locale } from '../locale-context'

const HE = {
  note: 'כל המחירים באתר בדולר אמריקאי (USD)',
}

export const COPY: Record<Locale, typeof HE> = {
  he: HE,
  en: { note: 'All prices on this site are in US dollars (USD)' },
  fr: { note: 'Tous les prix du site sont en dollars américains (USD)' },
}

export function CurrencyNote({ className = '' }: { className?: string }) {
  const { locale } = useLocale()
  const t = COPY[locale]
  return (
    <div className={`flex justify-center ${className}`}>
      <span className="inline-flex items-center gap-2 text-[11px] md:text-xs font-black text-[#3B151A]/60 bg-white/60 px-4 py-2 rounded-full border border-[#EDB2C1]/40">
        <Icon icon="ph:currency-dollar-bold" className="text-[#F5A83A] text-base" />
        {t.note}
      </span>
    </div>
  )
}
