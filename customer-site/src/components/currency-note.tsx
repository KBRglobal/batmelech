import { Icon } from '@iconify/react'

export function CurrencyNote({ className = '' }: { className?: string }) {
  return (
    <div className={`flex justify-center ${className}`}>
      <span className="inline-flex items-center gap-2 text-[11px] md:text-xs font-black text-[#3B151A]/60 bg-white/60 px-4 py-2 rounded-full border border-[#EDB2C1]/40">
        <Icon icon="ph:currency-dollar-bold" className="text-[#F5A83A] text-base" />
        כל המחירים באתר בדולר אמריקאי (USD)
      </span>
    </div>
  )
}
