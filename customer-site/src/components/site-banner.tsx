import { Icon } from '@iconify/react'
import { useSiteStatus } from '../site-status-context'

const CLOSED_MESSAGE = 'האתר לא מקבל הזמנות כרגע. שבת שלום!'

// Closing is only ever for the upcoming Shabbat, so when the server tells us
// which day ordering returns, say it — nobody has to ask when to come back.
function closedMessage(reopensOn: string | null): string {
  if (!reopensOn) return CLOSED_MESSAGE
  const reopenDay = new Date(`${reopensOn}T00:00:00Z`)
  if (!Number.isFinite(reopenDay.getTime())) return CLOSED_MESSAGE
  const weekday = new Intl.DateTimeFormat('he-IL', { weekday: 'long', timeZone: 'UTC' }).format(reopenDay)
  return `ההזמנות סגורות לשבת הקרובה — נפתח מחדש ב${weekday}`
}

export function SiteBanner() {
  const { orderingOpen, reopensOn, siteBanner } = useSiteStatus()
  const message = siteBanner || (!orderingOpen ? closedMessage(reopensOn) : null)

  if (!message) return null

  return (
    <div className="sticky top-0 z-[300] bg-[#8D182C] text-white text-center py-3 px-6 font-black text-sm flex items-center justify-center gap-3">
      <Icon icon="ph:megaphone-fill" className="text-lg shrink-0" />
      <span>{message}</span>
    </div>
  )
}
