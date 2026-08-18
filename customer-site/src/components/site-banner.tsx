import { Icon } from '@iconify/react'
import { useSiteStatus } from '../site-status-context'
import { useLocale, type Locale } from '../locale-context'

const HE = {
  closedDefault: 'האתר לא מקבל הזמנות כרגע. שבת שלום!',
  reopens: (weekday: string) => `ההזמנות סגורות לשבת הקרובה — נפתח מחדש ב${weekday}`,
}

export const COPY: Record<Locale, typeof HE> = {
  he: HE,
  en: {
    closedDefault: 'We are not taking orders right now. Shabbat Shalom!',
    reopens: (weekday: string) => `Ordering is closed for this Shabbat — we reopen on ${weekday}`,
  },
  fr: {
    closedDefault: 'Les commandes sont suspendues pour le moment. Chabbat Chalom !',
    reopens: (weekday: string) => `Les commandes sont fermées pour ce Chabbat — réouverture ${weekday}`,
  },
}

const WEEKDAY_LOCALE: Record<Locale, string> = { he: 'he-IL', en: 'en-US', fr: 'fr-FR' }

// Closing is only ever for the upcoming Shabbat, so when the server tells us
// which day ordering returns, say it — nobody has to ask when to come back.
function closedMessage(locale: Locale, reopensOn: string | null): string {
  const t = COPY[locale]
  if (!reopensOn) return t.closedDefault
  const reopenDay = new Date(`${reopensOn}T00:00:00Z`)
  if (!Number.isFinite(reopenDay.getTime())) return t.closedDefault
  const weekday = new Intl.DateTimeFormat(WEEKDAY_LOCALE[locale], { weekday: 'long', timeZone: 'UTC' }).format(reopenDay)
  return t.reopens(weekday)
}

export function SiteBanner() {
  const { orderingOpen, reopensOn, siteBanner } = useSiteStatus()
  const { locale, dir } = useLocale()
  // A custom admin-typed banner is live content — shown exactly as written,
  // in whatever language the admin typed it.
  const message = siteBanner || (!orderingOpen ? closedMessage(locale, reopensOn) : null)

  if (!message) return null

  return (
    <div
      dir={siteBanner ? 'auto' : dir}
      className="sticky top-0 z-[300] bg-[#8D182C] text-white text-center py-3 px-6 font-black text-sm flex items-center justify-center gap-3"
    >
      <Icon icon="ph:megaphone-fill" className="text-lg shrink-0" />
      <span>{message}</span>
    </div>
  )
}
