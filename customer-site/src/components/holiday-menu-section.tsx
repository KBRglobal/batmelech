import { useEffect, useState } from 'react'
import { Icon } from '@iconify/react'
import { useCart } from '../cart-context'
import { useLocale, type Locale } from '../locale-context'
import { useReveal } from './reveal'

/**
 * Festive holiday-menu section for the home page. GET /api/site/holidays
 * returns the upcoming Hebrew-calendar holidays plus the menus whose publish
 * window covers today; when at least one menu is active this section renders
 * it with its dishes, prices, and the order cutoff. Any fetch or parse
 * failure renders nothing — the page degrades to exactly what it was.
 */

type HolidayNames = { he: string; en: string; fr: string }

type Holiday = {
  key: string
  startDate: string
  endDate: string
  eveDate: string
  hebrewDateLabel: string
  names: HolidayNames
}

type HolidayDish = {
  name: string
  displayName: { en: string; fr: string }
  priceUsd: number
}

type HolidayMenu = {
  id: string
  holidayKey: string
  title: HolidayNames
  dishes: HolidayDish[]
  publishFrom: string
  publishUntil: string
  orderCutoff: string
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function dayOf(value: unknown): string {
  const day = textOf(value)
  return DAY_PATTERN.test(day) ? day : ''
}

function namesOf(value: unknown): HolidayNames {
  const row = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  return { he: textOf(row.he), en: textOf(row.en), fr: textOf(row.fr) }
}

function parseHoliday(value: unknown): Holiday | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  const key = textOf(row.key)
  const startDate = dayOf(row.startDate)
  if (key === '' || startDate === '') return null
  return {
    key,
    startDate,
    endDate: dayOf(row.endDate) || startDate,
    eveDate: dayOf(row.eveDate),
    hebrewDateLabel: textOf(row.hebrewDateLabel),
    names: namesOf(row.names),
  }
}

function parseMenu(value: unknown): HolidayMenu | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  const id = textOf(row.id)
  const title = namesOf(row.title)
  if (id === '' || title.he === '') return null
  const dishes = (Array.isArray(row.dishes) ? row.dishes : [])
    .map((dish): HolidayDish | null => {
      if (typeof dish !== 'object' || dish === null) return null
      const record = dish as Record<string, unknown>
      const name = textOf(record.name)
      const priceUsd = record.priceUsd
      if (name === '' || typeof priceUsd !== 'number' || !Number.isFinite(priceUsd) || priceUsd < 0) return null
      const display = (typeof record.displayName === 'object' && record.displayName !== null ? record.displayName : {}) as Record<string, unknown>
      return { name, displayName: { en: textOf(display.en), fr: textOf(display.fr) }, priceUsd }
    })
    .filter((dish): dish is HolidayDish => dish !== null)
  return {
    id,
    holidayKey: textOf(row.holidayKey),
    title,
    dishes,
    publishFrom: dayOf(row.publishFrom),
    publishUntil: dayOf(row.publishUntil),
    orderCutoff: dayOf(row.orderCutoff),
  }
}

function formatDay(day: string, locale: Locale): string {
  if (!DAY_PATTERN.test(day)) return ''
  if (locale === 'he') return `${day.slice(8, 10)}.${day.slice(5, 7)}`
  try {
    return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-US', {
      month: locale === 'fr' ? 'long' : 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${day}T00:00:00Z`))
  } catch {
    return day
  }
}

// Native copy per locale — American Jewish English and French Jewish register
// (the holiday names themselves come localized from the server).
const SECTION_COPY = {
  he: {
    badge: 'Holiday Specials',
    kicker: 'מתקרב חג',
    cutoff: (day: string) => `הזמנות עד ${day}`,
    closed: 'ההזמנות לחג נסגרו — נתראה בחג הבא',
    add: 'הוספה להזמנה',
    added: 'נוסף',
  },
  en: {
    badge: 'Holiday Specials',
    kicker: 'A Chag Is Coming',
    cutoff: (day: string) => `Order by ${day}`,
    closed: 'Holiday ordering is closed — see you next chag',
    add: 'Add to Order',
    added: 'Added',
  },
  fr: {
    badge: 'Holiday Specials',
    kicker: 'Une fête approche',
    cutoff: (day: string) => `Commandes jusqu'au ${day}`,
    closed: 'Les commandes de fête sont clôturées — à la prochaine fête',
    add: 'Ajouter à la commande',
    added: 'Ajouté',
  },
} as const

function localizedTitle(names: HolidayNames, locale: Locale): string {
  if (locale === 'en' && names.en !== '') return names.en
  if (locale === 'fr' && names.fr !== '') return names.fr
  return names.he
}

function localizedDishName(dish: HolidayDish, locale: Locale): string {
  if (locale === 'en' && dish.displayName.en !== '') return dish.displayName.en
  if (locale === 'fr' && dish.displayName.fr !== '') return dish.displayName.fr
  return dish.name
}

export function HolidayMenuSection() {
  const { locale } = useLocale()
  const { addLine } = useCart()
  const reveal = useReveal<HTMLElement>()
  const [menus, setMenus] = useState<HolidayMenu[]>([])
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [justAdded, setJustAdded] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/site/holidays')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        if (cancelled || data === null || typeof data !== 'object') return
        const body = data as Record<string, unknown>
        setMenus((Array.isArray(body.menus) ? body.menus : []).map(parseMenu).filter((menu): menu is HolidayMenu => menu !== null))
        setHolidays((Array.isArray(body.holidays) ? body.holidays : []).map(parseHoliday).filter((holiday): holiday is Holiday => holiday !== null))
      })
      .catch(() => {}) // fail silent: the section simply does not render
    return () => {
      cancelled = true
    }
  }, [])

  if (menus.length === 0) return null

  const t = SECTION_COPY[locale]
  // Cutoffs are the kitchen's calendar days — Asia/Dubai, not the viewer's zone.
  let today: string
  try {
    today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date())
  } catch {
    today = new Date().toISOString().slice(0, 10)
  }

  const addDish = (menu: HolidayMenu, dish: HolidayDish, index: number) => {
    addLine({
      id: `holiday-${menu.id}-${index}`,
      name: dish.name, // canonical Hebrew name — the kitchen's key
      displayName: localizedDishName(dish, locale),
      unitPrice: dish.priceUsd,
      qty: 1,
    })
    setJustAdded(`${menu.id}-${index}`)
    window.setTimeout(() => setJustAdded(null), 1500)
  }

  return (
    <section id="holiday-menu" ref={reveal.ref} className={`mb-32 scroll-mt-24 pt-24 ${reveal.className}`}>
      {menus.map((menu) => {
        const holiday = holidays.find((candidate) => candidate.key === menu.holidayKey) ?? null
        const cutoffOpen = menu.orderCutoff === '' || today <= menu.orderCutoff
        return (
          <div
            key={menu.id}
            className="relative overflow-hidden rounded-[4rem] border-4 border-[#F5A83A]/40 bg-[#3B151A] p-8 shadow-2xl md:p-16 mb-10 last:mb-0"
          >
            {/* soft festive glows */}
            <div aria-hidden className="pointer-events-none absolute -top-24 -start-24 h-72 w-72 rounded-full bg-[#F5A83A]/20 blur-3xl" />
            <div aria-hidden className="pointer-events-none absolute -bottom-24 -end-24 h-72 w-72 rounded-full bg-[#EDB2C1]/20 blur-3xl" />

            <div className="relative">
              <div className="inline-flex items-center gap-3 rounded-full bg-[#F5A83A] px-6 py-2 text-xs font-black uppercase tracking-widest text-[#3B151A]">
                <Icon icon="ph:sparkle-fill" className="animate-pulse" />
                <span>{t.badge}</span>
              </div>

              <div className="mt-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                  {holiday && (
                    <p className="mb-3 text-sm font-black uppercase tracking-widest text-[#EDB2C1]">
                      {t.kicker} · {localizedTitle(holiday.names, locale)} · {formatDay(holiday.startDate, locale)}
                    </p>
                  )}
                  <h2 className="font-heading text-4xl font-black leading-tight text-white md:text-6xl">
                    {localizedTitle(menu.title, locale)}
                  </h2>
                </div>
                <div
                  className={`inline-flex shrink-0 items-center gap-3 self-start rounded-full px-6 py-3 text-sm font-black md:self-end ${
                    cutoffOpen ? 'bg-white text-[#3B151A]' : 'bg-[#8D182C] text-white'
                  }`}
                >
                  <Icon icon={cutoffOpen ? 'ph:clock-countdown-fill' : 'ph:lock-simple-fill'} className="text-xl" />
                  <span>{cutoffOpen ? t.cutoff(formatDay(menu.orderCutoff, locale)) : t.closed}</span>
                </div>
              </div>

              {menu.dishes.length > 0 && (
                <ul className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2">
                  {menu.dishes.map((dish, index) => (
                    <li
                      key={`${menu.id}-${index}`}
                      className="flex items-center justify-between gap-4 rounded-[2rem] border border-white/10 bg-white/5 p-5 backdrop-blur-sm transition-colors hover:bg-white/10"
                    >
                      <div className="min-w-0">
                        <p className="text-lg font-black text-white md:text-xl">{localizedDishName(dish, locale)}</p>
                        <p className="mt-1 text-sm font-black text-[#F5A83A]" dir="ltr">${dish.priceUsd}</p>
                      </div>
                      {cutoffOpen && (
                        <button
                          type="button"
                          onClick={() => addDish(menu, dish, index)}
                          className={`inline-flex shrink-0 items-center gap-2 rounded-full px-6 py-3 text-sm font-black shadow-xl transition-all ${
                            justAdded === `${menu.id}-${index}`
                              ? 'bg-[#EDB2C1] text-[#3B151A]'
                              : 'bg-white text-[#3B151A] hover:bg-[#F5A83A] hover:scale-105'
                          }`}
                        >
                          <Icon
                            icon={justAdded === `${menu.id}-${index}` ? 'ph:check-circle-fill' : 'ph:plus-circle-fill'}
                            className="text-xl"
                          />
                          <span>{justAdded === `${menu.id}-${index}` ? t.added : t.add}</span>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )
      })}
    </section>
  )
}
