import { Icon } from '@iconify/react'
import { useSiteStatus } from '../site-status-context'

const PHONE_DISPLAY = '+971 58 628 8776'
const PHONE_HREF = 'tel:+971586288776'
const DUBAI_TIMEZONE = 'Asia/Dubai'

function dubaiDate(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: DUBAI_TIMEZONE }).format(at)
}

function dubaiTime(at: Date): string {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: DUBAI_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at)
}

function dubaiWeekday(at: Date): string {
  return new Intl.DateTimeFormat('he-IL', { timeZone: DUBAI_TIMEZONE, weekday: 'long' }).format(at)
}

// "בשעה 19:30" is only unambiguous while it is still the same Dubai day; once
// the reopening is tomorrow night the weekday has to be said out loud.
function reopenSentence(reopensAt: number | null): string | null {
  if (reopensAt === null) return null
  const at = new Date(reopensAt)
  if (Number.isNaN(at.getTime())) return null
  const sameDay = dubaiDate(at) === dubaiDate(new Date())
  // he-IL already renders the weekday as "יום שבת", so the preposition is a
  // bare ב — "ביום שבת", never "ביום יום שבת".
  const when = sameDay ? '' : `ב${dubaiWeekday(at)} `
  return `נחזור לקבל הזמנות ${when}בערך בשעה ${dubaiTime(at)}`
}

/**
 * The whole site while it rests. Deliberately calm and photo-free: a screen of
 * food would be inviting an order we are not taking. The phone stays reachable
 * for an emergency, and nothing else does.
 */
export function ShabbatClosure() {
  const { shabbatLabel, shabbatReopensAt, shabbatOccasion } = useSiteStatus()
  const greeting = shabbatLabel ?? 'שבת שלום'
  const returnWhen = shabbatOccasion === 'chag' ? 'בצאת החג' : 'במוצאי שבת'
  const reopen = reopenSentence(shabbatReopensAt)

  return (
    <div
      dir="rtl"
      className="min-h-screen flex flex-col items-center justify-center text-center px-6 py-16 bg-[#3B151A] text-white font-sans selection:bg-[#EDB2C1]/30"
      style={{
        backgroundImage:
          'radial-gradient(ellipse at 50% 18%, rgba(245,168,58,0.22) 0%, rgba(59,21,26,0) 62%), linear-gradient(to bottom, #3B151A 0%, #2A0F13 100%)',
      }}
    >
      <div className="w-32 h-32 md:w-44 md:h-44 mb-10">
        <img
          src="/site/assets/logo-cream.png"
          alt="מטעמי בת מלך"
          className="w-full h-full object-contain drop-shadow-[0_2px_24px_rgba(0,0,0,0.55)]"
        />
      </div>

      <div className="max-w-2xl backdrop-blur-md bg-white/[0.04] px-8 py-12 md:px-14 md:py-16 rounded-[4rem] border border-white/10 shadow-2xl">
        <Icon icon="ph:moon-stars-fill" className="text-5xl md:text-6xl text-[#F5A83A] mx-auto mb-8" />

        <h1 className="text-5xl md:text-7xl font-black font-heading tracking-tight leading-none text-[#F5A83A] mb-8">
          {greeting}
        </h1>

        <p className="text-white/90 text-lg md:text-2xl font-bold leading-relaxed">
          המטבח שלנו שומר שבת — נשמח לראותכם {returnWhen}
        </p>

        {reopen && <p className="text-white/60 text-base md:text-lg font-bold mt-6">{reopen}</p>}
      </div>

      <a
        href={PHONE_HREF}
        className="mt-12 inline-flex items-center gap-3 text-white/50 hover:text-[#F5A83A] font-bold text-sm transition-colors"
      >
        <Icon icon="ph:phone-fill" className="text-lg" />
        <span dir="ltr">{PHONE_DISPLAY}</span>
      </a>
    </div>
  )
}
