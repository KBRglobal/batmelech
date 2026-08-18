import { useCallback, useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { LocalIcon } from './local-icon.tsx'

// Holiday menus editor: the server computes the Hebrew calendar (13 months
// ahead, Asia/Dubai days) and this section lets Lin attach a menu to each
// holiday — its own dishes, HER prices (the UI never invents a price), a
// publish window for the site, and an order cutoff. Saved as a full-array
// replace to PUT /api/holidays/menus.

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const HolidaySchema = z.object({
  key: z.string(),
  startDate: z.string().regex(DAY_PATTERN),
  endDate: z.string().regex(DAY_PATTERN),
  eveDate: z.string().regex(DAY_PATTERN),
  hebrewDateLabel: z.string(),
  names: z.object({ he: z.string(), en: z.string(), fr: z.string() }),
})

const MenuSchema = z.object({
  id: z.string(),
  holidayKey: z.string(),
  title: z.object({ he: z.string(), en: z.string(), fr: z.string() }),
  dishes: z.array(
    z.object({
      name: z.string(),
      displayName: z.object({ en: z.string(), fr: z.string() }),
      priceUsd: z.number().nullable(),
    }),
  ),
  publishFrom: z.string(),
  publishUntil: z.string(),
  orderCutoff: z.string(),
})

const MenusResponseSchema = z.object({
  menus: z.array(MenuSchema).max(20),
  holidays: z.array(HolidaySchema).max(40),
}).passthrough()

type Holiday = z.infer<typeof HolidaySchema>

type EditableDish = { name: string; en: string; fr: string; price: string }

type EditableMenu = {
  id: string
  holidayKey: string
  titleHe: string
  titleEn: string
  titleFr: string
  publishFrom: string
  publishUntil: string
  orderCutoff: string
  dishes: EditableDish[]
}

function addDays(day: string, days: number): string {
  const base = Date.parse(`${day}T00:00:00Z`)
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10)
}

function dayMonth(day: string): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}`
}

function hebrewWeekday(day: string): string {
  try {
    const weekday = new Intl.DateTimeFormat('he-IL', { weekday: 'long', timeZone: 'UTC' }).format(
      new Date(`${day}T00:00:00Z`),
    )
    return `יום ${weekday}`
  } catch {
    return ''
  }
}

function toEditable(menu: z.infer<typeof MenuSchema>): EditableMenu {
  return {
    id: menu.id,
    holidayKey: menu.holidayKey,
    titleHe: menu.title.he,
    titleEn: menu.title.en,
    titleFr: menu.title.fr,
    publishFrom: menu.publishFrom,
    publishUntil: menu.publishUntil,
    orderCutoff: menu.orderCutoff,
    dishes: menu.dishes.map((dish) => ({
      name: dish.name,
      en: dish.displayName.en,
      fr: dish.displayName.fr,
      price: dish.priceUsd === null ? '' : String(dish.priceUsd),
    })),
  }
}

/** Hebrew description of the first problem, or null when everything is savable. */
function validationError(menus: EditableMenu[]): string | null {
  for (const menu of menus) {
    const where = menu.titleHe.trim() !== '' ? `"${menu.titleHe.trim()}"` : 'אחד התפריטים'
    if (menu.titleHe.trim() === '') return 'לכל תפריט חייבת להיות כותרת בעברית.'
    if (!DAY_PATTERN.test(menu.publishFrom) || !DAY_PATTERN.test(menu.publishUntil) || !DAY_PATTERN.test(menu.orderCutoff)) {
      return `בתפריט ${where} חסר תאריך פרסום או תאריך סגירת הזמנות.`
    }
    if (menu.publishFrom > menu.publishUntil) return `בתפריט ${where} תאריך תחילת הפרסום מאוחר מתאריך הסיום.`
    for (const dish of menu.dishes) {
      if (dish.name.trim() === '') return `בתפריט ${where} יש מנה בלי שם בעברית.`
      const price = Number(dish.price)
      if (dish.price.trim() === '' || !Number.isFinite(price) || price < 0 || price > 100_000) {
        return `במנה "${dish.name.trim()}" חסר מחיר תקין (0 עד 100,000 דולר).`
      }
    }
  }
  return null
}

function toPayload(menus: EditableMenu[]) {
  return menus.map((menu) => ({
    id: menu.id,
    holidayKey: menu.holidayKey,
    title: { he: menu.titleHe.trim(), en: menu.titleEn.trim(), fr: menu.titleFr.trim() },
    dishes: menu.dishes.map((dish) => ({
      name: dish.name.trim(),
      displayName: { en: dish.en.trim(), fr: dish.fr.trim() },
      priceUsd: Number(dish.price),
    })),
    publishFrom: menu.publishFrom,
    publishUntil: menu.publishUntil,
    orderCutoff: menu.orderCutoff,
  }))
}

const FIELD_CLASS =
  'min-h-10 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20'

export function HolidayMenusSection() {
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [menus, setMenus] = useState<EditableMenu[]>([])
  const [loadError, setLoadError] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/holidays/menus', {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('holiday menus fetch failed')
      const parsed = MenusResponseSchema.safeParse(await response.json())
      if (!parsed.success) throw new Error('holiday menus response invalid')
      setHolidays(parsed.data.holidays)
      setMenus(parsed.data.menus.map(toEditable))
      setDirty(false)
      setLoadError(false)
      setLoaded(true)
    } catch {
      setLoadError(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // One entry per holiday key, at its NEXT occurrence — menus attach to the key.
  const nextByKey = useMemo(() => {
    const seen = new Map<string, Holiday>()
    for (const holiday of holidays) {
      if (!seen.has(holiday.key)) seen.set(holiday.key, holiday)
    }
    return [...seen.values()]
  }, [holidays])

  const editMenu = (id: string, patch: Partial<EditableMenu>) => {
    setMenus((prev) => prev.map((menu) => (menu.id === id ? { ...menu, ...patch } : menu)))
    setDirty(true)
    setSaveState('idle')
  }

  const editDish = (menuId: string, index: number, patch: Partial<EditableDish>) => {
    setMenus((prev) =>
      prev.map((menu) =>
        menu.id === menuId
          ? { ...menu, dishes: menu.dishes.map((dish, i) => (i === index ? { ...dish, ...patch } : dish)) }
          : menu,
      ),
    )
    setDirty(true)
    setSaveState('idle')
  }

  const addMenuFor = (holiday: Holiday) => {
    if (menus.length >= 20) return
    const menu: EditableMenu = {
      id: `hm-${holiday.key}-${Date.now().toString(36)}`,
      holidayKey: holiday.key,
      titleHe: `תפריט ${holiday.names.he}`,
      titleEn: '',
      titleFr: '',
      // Defaults: publish three weeks before the eve, until the last holiday
      // day; ordering closes three days before the eve. Lin can change all.
      publishFrom: addDays(holiday.eveDate, -21),
      publishUntil: holiday.endDate,
      orderCutoff: addDays(holiday.eveDate, -3),
      dishes: [], // prices are Lin's — a new menu never invents dishes
    }
    setMenus((prev) => [...prev, menu])
    setDirty(true)
    setSaveState('idle')
  }

  const removeMenu = (id: string) => {
    setMenus((prev) => prev.filter((menu) => menu.id !== id))
    setDirty(true)
    setSaveState('idle')
  }

  const addDish = (menuId: string) => {
    setMenus((prev) =>
      prev.map((menu) =>
        menu.id === menuId && menu.dishes.length < 60
          ? { ...menu, dishes: [...menu.dishes, { name: '', en: '', fr: '', price: '' }] }
          : menu,
      ),
    )
    setDirty(true)
    setSaveState('idle')
  }

  const removeDish = (menuId: string, index: number) => {
    setMenus((prev) =>
      prev.map((menu) =>
        menu.id === menuId ? { ...menu, dishes: menu.dishes.filter((_, i) => i !== index) } : menu,
      ),
    )
    setDirty(true)
    setSaveState('idle')
  }

  const saveAll = async () => {
    const problem = validationError(menus)
    if (problem !== null) {
      setSaveError(problem)
      return
    }
    setSaveError(null)
    setSaveState('saving')
    try {
      const response = await fetch('/api/holidays/menus', {
        method: 'PUT',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ menus: toPayload(menus) }),
      })
      if (!response.ok) {
        const data: unknown = await response.json().catch(() => null)
        const message = (data as { error?: unknown } | null)?.error
        setSaveError(typeof message === 'string' ? message : 'השמירה נכשלה. אפשר לנסות שוב.')
        setSaveState('idle')
        return
      }
      setSaveState('saved')
      setDirty(false)
    } catch {
      setSaveError('השמירה נכשלה. אפשר לנסות שוב.')
      setSaveState('idle')
    }
  }

  return (
    <section aria-label="תפריטי חגים" className="rounded-[2rem] border border-border bg-card p-5 text-primary shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-center gap-3">
          <LocalIcon name="ph:calendar-bold" className="text-2xl" />
          <div>
            <h2 className="text-sm font-black">תפריטי חגים</h2>
            <p className="mt-1 text-xs font-bold text-muted-foreground">
              המערכת מכירה את לוח השנה העברי. לכל חג אפשר לבנות תפריט עם מנות ומחירים משלו — הוא יופיע באתר בחלון הפרסום שנקבע, וההזמנות ייסגרו בתאריך הסגירה.
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={saveState === 'saving' || !dirty}
          onClick={() => { void saveAll() }}
          className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-primary px-5 text-sm font-black text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <LocalIcon name="ph:floppy-disk-bold" className="text-lg" />
          <span>{saveState === 'saving' ? 'שומרת...' : 'שמירת כל התפריטים'}</span>
        </button>
      </div>

      {saveState === 'saved' && <p role="status" className="mt-4 rounded-2xl bg-secondary p-3 text-sm font-black text-emerald-700">נשמר ✓ — האתר יתעדכן בתוך כמה דקות.</p>}
      {saveError && <p role="alert" className="mt-4 rounded-2xl bg-rose-50 p-3 text-sm font-black text-destructive">{saveError}</p>}
      {loadError && (
        <p className="mt-4 rounded-2xl bg-rose-50 p-4 text-sm font-black text-destructive">
          לא הצלחנו לטעון את תפריטי החגים. <button type="button" onClick={() => { void refresh() }} className="underline">לנסות שוב</button>
        </p>
      )}

      {loaded && (
        <ul className="mt-4 space-y-4">
          {nextByKey.map((holiday) => {
            const holidayMenus = menus.filter((menu) => menu.holidayKey === holiday.key)
            return (
              <li key={holiday.key} className="rounded-2xl border border-border bg-background p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-black">
                      {holiday.names.he} — {hebrewWeekday(holiday.startDate)} {dayMonth(holiday.startDate)}
                      {holiday.endDate !== holiday.startDate ? ` עד ${dayMonth(holiday.endDate)}` : ''}
                    </h3>
                    <p className="mt-1 text-xs font-bold text-muted-foreground">
                      ערב חג {dayMonth(holiday.eveDate)} · {holiday.hebrewDateLabel}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => addMenuFor(holiday)}
                    disabled={menus.length >= 20}
                    className="inline-flex min-h-10 items-center gap-2 rounded-full border border-primary/20 bg-card px-4 text-xs font-black hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <LocalIcon name="ph:plus-circle-bold" className="text-base" />
                    <span>תפריט חדש לחג הזה</span>
                  </button>
                </div>

                {holidayMenus.map((menu) => (
                  <div key={menu.id} className="mt-3 rounded-2xl border border-border bg-card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-3">
                        <label className="block text-xs font-black">
                          כותרת בעברית
                          <input value={menu.titleHe} onChange={(event) => editMenu(menu.id, { titleHe: event.currentTarget.value })} maxLength={240} className={`mt-1 ${FIELD_CLASS}`} />
                        </label>
                        <label className="block text-xs font-black">
                          כותרת באנגלית
                          <input dir="ltr" value={menu.titleEn} onChange={(event) => editMenu(menu.id, { titleEn: event.currentTarget.value })} maxLength={240} className={`mt-1 ${FIELD_CLASS}`} />
                        </label>
                        <label className="block text-xs font-black">
                          כותרת בצרפתית
                          <input dir="ltr" value={menu.titleFr} onChange={(event) => editMenu(menu.id, { titleFr: event.currentTarget.value })} maxLength={240} className={`mt-1 ${FIELD_CLASS}`} />
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeMenu(menu.id)}
                        className="inline-flex min-h-10 items-center gap-2 rounded-full border border-destructive/30 px-4 text-xs font-black text-destructive hover:bg-rose-50"
                      >
                        <LocalIcon name="ph:x-circle-bold" className="text-base" />
                        <span>מחיקת התפריט</span>
                      </button>
                    </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <label className="block text-xs font-black">
                        פרסום באתר מתאריך
                        <input type="date" value={menu.publishFrom} onChange={(event) => editMenu(menu.id, { publishFrom: event.currentTarget.value })} className={`mt-1 ${FIELD_CLASS}`} />
                      </label>
                      <label className="block text-xs font-black">
                        פרסום עד תאריך
                        <input type="date" value={menu.publishUntil} onChange={(event) => editMenu(menu.id, { publishUntil: event.currentTarget.value })} className={`mt-1 ${FIELD_CLASS}`} />
                      </label>
                      <label className="block text-xs font-black">
                        סגירת הזמנות בתאריך
                        <input type="date" value={menu.orderCutoff} onChange={(event) => editMenu(menu.id, { orderCutoff: event.currentTarget.value })} className={`mt-1 ${FIELD_CLASS}`} />
                      </label>
                    </div>

                    <div className="mt-4">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-xs font-black text-muted-foreground">המנות של התפריט</h4>
                        <button
                          type="button"
                          onClick={() => addDish(menu.id)}
                          disabled={menu.dishes.length >= 60}
                          className="inline-flex min-h-9 items-center gap-2 rounded-full border border-primary/20 px-3 text-xs font-black hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <LocalIcon name="ph:plus-bold" className="text-sm" />
                          <span>הוספת מנה</span>
                        </button>
                      </div>
                      {menu.dishes.length === 0 && (
                        <p className="mt-2 text-xs font-bold text-muted-foreground">עוד אין מנות — כל מנה נוספת עם שם ומחיר שאת קובעת.</p>
                      )}
                      {menu.dishes.map((dish, index) => (
                        <div key={index} className="mt-2 grid items-end gap-2 rounded-xl border border-border p-2 sm:grid-cols-[2fr_2fr_2fr_1fr_auto]">
                          <label className="block text-[11px] font-black">
                            שם המנה (עברית)
                            <input value={dish.name} onChange={(event) => editDish(menu.id, index, { name: event.currentTarget.value })} maxLength={240} className={`mt-1 ${FIELD_CLASS}`} />
                          </label>
                          <label className="block text-[11px] font-black">
                            שם באנגלית
                            <input dir="ltr" value={dish.en} onChange={(event) => editDish(menu.id, index, { en: event.currentTarget.value })} maxLength={240} className={`mt-1 ${FIELD_CLASS}`} />
                          </label>
                          <label className="block text-[11px] font-black">
                            שם בצרפתית
                            <input dir="ltr" value={dish.fr} onChange={(event) => editDish(menu.id, index, { fr: event.currentTarget.value })} maxLength={240} className={`mt-1 ${FIELD_CLASS}`} />
                          </label>
                          <label className="block text-[11px] font-black">
                            מחיר בדולר
                            <input
                              dir="ltr"
                              inputMode="decimal"
                              value={dish.price}
                              onChange={(event) => editDish(menu.id, index, { price: event.currentTarget.value })}
                              placeholder="0"
                              className={`mt-1 ${FIELD_CLASS}`}
                            />
                          </label>
                          <button
                            type="button"
                            aria-label="מחיקת המנה"
                            onClick={() => removeDish(menu.id, index)}
                            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-destructive/30 px-3 text-destructive hover:bg-rose-50"
                          >
                            <LocalIcon name="ph:x-bold" className="text-base" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
