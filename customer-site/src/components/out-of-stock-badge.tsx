import { Icon } from '@iconify/react'

export function OutOfStockBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`z-20 inline-flex items-center gap-1 bg-[#8D182C] text-white text-[9px] font-black px-2 py-1 rounded-full shadow-lg backdrop-blur-sm ${className}`}
    >
      <Icon icon="ph:prohibit-bold" />
      אזל מהמלאי
    </span>
  )
}
