import { Icon } from '@iconify/react'
import { useSiteStatus } from '../site-status-context'

export function SiteBanner() {
  const { orderingOpen, siteBanner } = useSiteStatus()
  const message = siteBanner || (!orderingOpen ? 'האתר לא מקבל הזמנות כרגע. שבת שלום!' : null)

  if (!message) return null

  return (
    <div className="sticky top-0 z-[300] bg-[#8D182C] text-white text-center py-3 px-6 font-black text-sm flex items-center justify-center gap-3">
      <Icon icon="ph:megaphone-fill" className="text-lg shrink-0" />
      <span>{message}</span>
    </div>
  )
}
