import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { APP_ROUTES } from '../app/routes.ts'
import { LocalIcon } from '../components/local-icon.tsx'
import { ScreenState } from '../components/screen-state.tsx'
import { QrCode } from '../components/qr-code.tsx'
import { orderFormQrTarget } from '../domain/bon-qr.ts'
import { useStore } from '../data/use-store.ts'
import { upcomingServiceDate } from '../domain/service-dates.ts'
import type { LegacyOrder } from '../domain/store.ts'
import {
  LABEL_MEDIA_OPTIONS,
  LABEL_PRINT_CSS,
  type LabelMedia,
  printLabels,
  rememberLabelMedia,
  rememberedLabelMedia,
} from '../services/label-print.ts'

const SAFE_ORDER_ID = /^(?!\.{1,2}$)[A-Za-z0-9][A-Za-z0-9._~-]{0,255}$/u
const FORBIDDEN_ORDER_IDS = new Set(['__proto__', 'constructor', 'prototype'])
const CANCELLED = new Set(['בוטלה', 'cancelled', 'canceled'])
const MAX_PREPARATION_COPIES_PER_ITEM = 500
const MAX_PREPARATION_COPIES_TOTAL = 5_000
const sessionBagCopies = new Map<string, number>()
const sessionPreparationCopies = new Map<string, number>()
const EMPTY_ORDERS: readonly LegacyOrder[] = []

const LUNCH_NAMES: Readonly<Record<string, string>> = {
  baguette: 'בגט טוניסאי אותנטי',
  'schnitzel-roll': 'בגט/חלת שניצל ישראלי',
  kubeh: 'מנת קובה סלק ביתית',
  'schnitzel-plate': 'שניצל בצלחת',
  couscous: 'ספיישל קוסקוס',
}

const LUNCH_VARIANTS: Readonly<Record<string, string>> = {
  baguette: 'בבגט',
  challah: 'בחלה',
  single: 'אישית',
  couple: 'זוגית',
  family: 'משפחתית',
}

interface PreparationLabelGroup {
  readonly key: string
  readonly customer: string
  readonly serviceDate: string
  readonly item: string
  readonly details: readonly string[]
  readonly sourceQuantity: number
}

interface PreparationLabelData extends PreparationLabelGroup {
  readonly copyIndex: number
  readonly copyCount: number
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' && value.length <= 10_000 ? value.trim() : ''
}

function quantity(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return 0
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 && value <= MAX_PREPARATION_COPIES_PER_ITEM ? value : null
  }
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(value.trim()) || value.length > 64) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed <= MAX_PREPARATION_COPIES_PER_ITEM ? parsed : null
}

function entries(value: unknown): readonly (readonly [string, unknown])[] | null {
  if (value === undefined || value === null) return []
  if (!isRecord(value)) return null
  const values = Object.entries(value)
  if (values.length > 2_000) return null
  return values.sort(([a], [b]) => a.localeCompare(b, 'he'))
}

function realDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
}

function dateLabel(value: string, short = false): string {
  const [year, month, day] = value.split('-').map(Number)
  if (short) return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`
  return new Intl.DateTimeFormat('he-IL', {
    weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC',
  }).format(new Date(Date.UTC(year!, month! - 1, day)))
}

function active(order: Readonly<LegacyOrder>): boolean {
  return !CANCELLED.has(text(order.status).toLocaleLowerCase('he-IL'))
}

function safeId(order: Readonly<LegacyOrder>): string | null {
  if (typeof order.id !== 'string' && typeof order.id !== 'number') return null
  const value = String(order.id)
  return SAFE_ORDER_ID.test(value) && !FORBIDDEN_ORDER_IDS.has(value) ? value : null
}

function orderSort(a: Readonly<LegacyOrder>, b: Readonly<LegacyOrder>): number {
  return text(a.time).localeCompare(text(b.time), 'he') || text(a.name).localeCompare(text(b.name), 'he') || String(a.id).localeCompare(String(b.id), 'en')
}

function detailNotes(order: Readonly<LegacyOrder>, category: 'first' | 'main' | 'general'): string[] {
  const details: string[] = []
  if (category === 'first' && text(order.heat)) details.push(`חריפות: ${text(order.heat)}`)
  if (category === 'first' && text(order.firstsNote)) details.push(text(order.firstsNote))
  if (category === 'main' && text(order.mainsNote)) details.push(text(order.mainsNote))
  if (category === 'general' && text(order.notes)) details.push(text(order.notes))
  return details
}

type PreparationGroupsResult =
  | { readonly ok: true; readonly groups: readonly PreparationLabelGroup[] }
  | { readonly ok: false }

function preparationGroups(order: Readonly<LegacyOrder>, orderId: string): PreparationGroupsResult {
  const groups: PreparationLabelGroup[] = []
  const customer = text(order.name) || 'ללא שם'
  const serviceDate = text(order.date)
  let index = 0
  let invalid = false
  let total = 0
  const add = (item: string, rawCount: unknown, details: readonly string[] = []) => {
    const count = quantity(rawCount)
    if (count === null) {
      invalid = true
      return
    }
    if (count === 0) return
    total += count
    if (total > MAX_PREPARATION_COPIES_TOTAL) {
      invalid = true
      return
    }
    groups.push({ key: `${orderId}:prep:${index++}`, customer, serviceDate, item, details, sourceQuantity: count })
  }

  add('ארוחה זוגית', order.meals, detailNotes(order, 'general'))
  add('ערכת שולחן', order.aricha)
  add('חלות', order.challot)

  const salads = entries(order.salads)
  if (salads === null) invalid = true
  for (const [name, value] of salads ?? []) {
    if (!isRecord(value)) {
      invalid = true
      continue
    }
    add(name, value.o, detailNotes(order, 'general'))
    add(`${name} — פינוק`, value.p, detailNotes(order, 'general'))
  }

  const standard = [
    [order.firsts, 'first'], [order.mains, 'main'], [order.sides, 'general'], [order.desserts, 'general'],
  ] as const
  for (const [record, category] of standard) {
    const selections = entries(record)
    if (selections === null) invalid = true
    for (const [name, value] of selections ?? []) add(name, value, detailNotes(order, category))
  }

  const extras = entries(order.extras)
  if (extras === null) invalid = true
  for (const [name, value] of extras ?? []) {
    if (!isRecord(value)) {
      invalid = true
      continue
    }
    const notes = [text(value.note), ...detailNotes(order, 'general')].filter(Boolean)
    add(name, value.q, notes)
  }

  const customItems: readonly unknown[] = order.custom === undefined || order.custom === null
    ? []
    : Array.isArray(order.custom) && order.custom.length <= 2_000 ? order.custom : []
  if (order.custom !== undefined && order.custom !== null && (!Array.isArray(order.custom) || order.custom.length > 2_000)) invalid = true
  for (const [customIndex, value] of customItems.entries()) {
    if (!isRecord(value) || !text(value.name)) {
      invalid = true
      continue
    }
    const notes = [text(value.note), value.price === undefined ? '' : `מחיר יחידה: ${String(value.price)}$`, ...detailNotes(order, 'general')].filter(Boolean)
    const before = groups.length
    add(text(value.name), value.qty, notes)
    if (groups.length > before) groups[groups.length - 1] = { ...groups[groups.length - 1]!, key: `${orderId}:custom:${customIndex}` }
  }

  const lunch = entries(order.lunch)
  if (lunch === null) invalid = true
  for (const [key, value] of lunch ?? []) {
    if (!isRecord(value)) {
      invalid = true
      continue
    }
    const variant = text(value.v)
    const item = `${LUNCH_NAMES[key] ?? key}${variant ? ` (${LUNCH_VARIANTS[variant] ?? variant})` : ''}`
    const sides = entries(value.sides)
    if (sides === null) invalid = true
    const sideDetails: string[] = []
    for (const [name, count] of sides ?? []) {
      const parsed = quantity(count)
      if (parsed === null) {
        invalid = true
        continue
      }
      if (parsed > 0) sideDetails.push(`${name} ×${parsed}`)
      add(`${item} — ${name}`, count, detailNotes(order, 'general'))
    }
    const addon = quantity(value.addon)
    if (addon === null) invalid = true
    add(item, value.q, [
      ...(sideDetails.length > 0 ? [`תוספות: ${sideDetails.join(', ')}`] : []),
      ...(addon !== null && addon > 0 ? [`מנת מפרום ביתי ×${addon}`] : []),
      ...detailNotes(order, 'general'),
    ])
    add(`${item} — מנת מפרום ביתי`, value.addon, detailNotes(order, 'general'))
  }

  if (groups.length === 0 && text(order.notes)) add('הערות להזמנה', 1, [text(order.notes)])
  return invalid ? { ok: false } : { ok: true, groups }
}

function BagLabel({ order, qrTarget }: {
  readonly order: Readonly<LegacyOrder>
  readonly qrTarget: string | null
}) {
  const date = text(order.date)
  return (
    <article className="bm-label-card" data-label-kind="bag" dir="rtl">
      <strong className="bm-label-brand text-center text-primary">מטעמי בת מלך</strong>
      <span className="bm-label-kosher text-center text-muted-foreground">מטבח ביתי אותנטי · כשר</span>
      <strong className="bm-label-name text-center text-foreground">{text(order.name)}</strong>
      <span className="bm-label-meta text-center">{realDate(date) ? dateLabel(date) : date}</span>
      <span className="bm-label-meta text-center">
        {order.pickup === true ? 'איסוף עצמי' : text(order.place)}
        {order.pickup !== true && text(order.time) ? ` · ${text(order.time)}` : ''}
      </span>
      {order.pickup !== true && text(order.address) && <span className="bm-label-meta text-center">{text(order.address)}</span>}
      {text(order.phone) && <span className="bm-label-meta text-center">טלפון: {text(order.phone)}</span>}
      <span className="bm-label-guidance text-center">
        לשמור בקירור עד החימום · חימום בכלי מכוסה
        {realDate(date) ? ` · הוכן בתאריך ${dateLabel(date, true)}` : ''}
      </span>
      {qrTarget !== null && (
        <QrCode caption="סרקו להזמנה הבאה" className="bm-label-qr mx-auto w-20 text-[10px] text-muted-foreground" value={qrTarget} />
      )}
    </article>
  )
}

function PreparationLabel({ label }: { readonly label: PreparationLabelData }) {
  return (
    <article className="bm-label-card" data-label-kind="preparation" data-preparation-item={label.item} dir="rtl">
      <strong className="bm-label-brand text-center text-primary">מטעמי בת מלך</strong>
      <span className="bm-label-kosher text-center text-muted-foreground">מדבקת הכנה · כשר</span>
      <strong className="bm-label-name text-center text-foreground">{label.item}</strong>
      <span className="bm-label-meta text-center">{label.customer}</span>
      <span className="bm-label-meta text-center">{realDate(label.serviceDate) ? dateLabel(label.serviceDate) : label.serviceDate}</span>
      <span className="bm-label-prep-details text-center">
        יחידה {label.copyIndex + 1} מתוך {label.copyCount} · כמות בהזמנה: {label.sourceQuantity}
        {label.details.length > 0 ? ` · ${label.details.join(' · ')}` : ''}
      </span>
    </article>
  )
}

export function LabelsScreen() {
  const storeQuery = useStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const [revision, setRevision] = useState(0)
  const [printMessage, setPrintMessage] = useState('')
  const [media, setMedia] = useState<LabelMedia>(rememberedLabelMedia())

  const orders = storeQuery.data?.data?.orders ?? EMPTY_ORDERS
  const labelQrTarget = orderFormQrTarget(storeQuery.data?.data ?? { orders: [] })
  const dates = useMemo(() => [...new Set(orders.filter(active).map((order) => order.date).filter(realDate))].sort(), [orders])
  const requestedDate = searchParams.get('date') ?? ''
  const selectedDate = realDate(requestedDate) ? requestedDate : (upcomingServiceDate(dates) ?? '')
  const scopedOrders = useMemo(
    () => orders.filter((order) => active(order) && order.date === selectedDate).sort(orderSort),
    [orders, selectedDate],
  )

  if (storeQuery.isPending) return <ScreenState kind="loading" title="טוענת את המדבקות" />
  if (storeQuery.isError) return <ScreenState kind="error" title="לא הצלחנו לטעון את המדבקות" retry={() => { void storeQuery.refetch() }} />
  if (dates.length === 0) {
    return <ScreenState kind="empty" title="אין הזמנות למדבקות" description="אין הזמנות פעילות עם תאריך תקין." action={{ label: 'חזרה להכנות', to: APP_ROUTES.preparation }} />
  }
  if (requestedDate && !realDate(requestedDate)) {
    return <ScreenState kind="error" title="תאריך המדבקות אינו תקין" description="לא נבחרו הזמנות כדי למנוע הדפסה לתאריך שגוי." />
  }

  const ids = scopedOrders.map(safeId)
  const duplicateIds = new Set(ids.filter((id): id is string => id !== null).filter((id, index, all) => all.indexOf(id) !== index))
  if (ids.some((id) => id === null) || duplicateIds.size > 0) {
    return <ScreenState kind="error" title="אי אפשר לזהות בבטחה את כל ההזמנות" description="ההדפסה נעצרה בגלל מזהה חסר, לא תקין או כפול." />
  }
  if (scopedOrders.length === 0) {
    return <ScreenState kind="empty" title="אין הזמנות בתאריך שנבחר" description="לא נוצרו מדבקות ריקות." action={{ label: 'חזרה להכנות', to: APP_ROUTES.preparation }} />
  }

  void revision
  const bagLabels = scopedOrders.flatMap((order, index) => {
    const id = ids[index]!
    const copies = sessionBagCopies.get(`${selectedDate}:${id}`) ?? 1
    return Array.from({ length: copies }, (_, copyIndex) => ({ order, key: `${id}:${copyIndex}` }))
  })
  const preparationResults = scopedOrders.map((order, index) => preparationGroups(order, ids[index]!))
  if (preparationResults.some((result) => !result.ok)) {
    return <ScreenState kind="error" title="אי אפשר ליצור מדבקות הכנה בבטחה" description="ההדפסה נעצרה בגלל כמות חסרה, שברית, שלילית או גדולה מהמותר." />
  }
  const preparationGroupsForDate = preparationResults.flatMap((result) => result.ok ? result.groups : [])
  const defaultPreparationCount = preparationGroupsForDate.reduce((sum, group) => sum + group.sourceQuantity, 0)
  if (defaultPreparationCount > MAX_PREPARATION_COPIES_TOTAL) {
    return <ScreenState kind="error" title="אי אפשר ליצור מדבקות הכנה בבטחה" description="ההדפסה נעצרה כי מספר המדבקות הכולל גדול מהמותר." />
  }
  const prepLabels = preparationGroupsForDate.flatMap((group) => {
    const copies = sessionPreparationCopies.get(`${selectedDate}:${group.key}`) ?? group.sourceQuantity
    return Array.from({ length: copies }, (_, copyIndex): PreparationLabelData => ({
      ...group,
      key: `${group.key}:copy:${copyIndex}`,
      copyIndex,
      copyCount: copies,
    }))
  })

  const updateBagCopies = (id: string, delta: number) => {
    const key = `${selectedDate}:${id}`
    const current = sessionBagCopies.get(key) ?? 1
    sessionBagCopies.set(key, Math.max(0, current + delta))
    setPrintMessage('')
    setRevision((value) => value + 1)
  }
  const updatePreparationCopies = (group: Readonly<PreparationLabelGroup>, delta: number) => {
    const key = `${selectedDate}:${group.key}`
    const current = sessionPreparationCopies.get(key) ?? group.sourceQuantity
    if (delta > 0 && (current >= MAX_PREPARATION_COPIES_PER_ITEM || prepLabels.length >= MAX_PREPARATION_COPIES_TOTAL)) {
      setPrintMessage('אי אפשר להוסיף עוד מדבקות הכנה — הגעת למגבלת ההדפסה הבטוחה.')
      return
    }
    sessionPreparationCopies.set(key, Math.max(0, current + delta))
    setPrintMessage('')
    setRevision((value) => value + 1)
  }
  const print = (kind: 'bag' | 'preparation', count: number) => {
    if (count === 0) {
      setPrintMessage(kind === 'bag' ? 'אין מדבקות לשקיות להדפסה — כל הכמויות על 0.' : 'אין מדבקות הכנה להדפסה בתאריך הזה.')
      return
    }
    setPrintMessage('')
    const sheet = kind === 'bag' ? '.bm-bag-labels' : '.bm-preparation-labels'
    printLabels(kind, media, document.querySelectorAll(`${sheet} .bm-label-card`))
  }
  const selectMedia = (value: LabelMedia) => {
    rememberLabelMedia(value)
    setMedia(value)
  }

  return (
    <div className="min-h-full bg-background px-5 py-8 sm:px-8" dir="rtl">
      <style>{LABEL_PRINT_CSS}</style>
      <div className="bm-label-screen-only mx-auto max-w-6xl">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black text-accent-foreground">Brother QL-800 · גליל 62 מ&quot;מ</p>
            <h1 className="mt-2 font-heading text-3xl font-black text-primary">מדבקות הכנה ושקיות</h1>
            <p className="mt-2 text-sm font-bold text-muted-foreground">מדבקה אחת בכל עמוד, בגודל הגליל שנבחר.</p>
          </div>
          <Link to={{ pathname: APP_ROUTES.preparation, search: `?${new URLSearchParams({ date: selectedDate })}` }} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-5 text-sm font-black text-primary hover:bg-secondary">
            <LocalIcon name="ph:arrow-left-bold" className="rotate-180 text-lg" />
            <span>חזרה להכנות</span>
          </Link>
        </header>

        <label className="mt-6 block max-w-xs text-xs font-black text-muted-foreground">
          תאריך להכנה ולהדפסה
          <select
            aria-label="תאריך למדבקות"
            value={selectedDate}
            onChange={(event) => setSearchParams({ date: event.currentTarget.value })}
            className="mt-2 min-h-11 w-full rounded-2xl border border-border bg-card px-4 text-sm font-black text-primary"
          >
            {dates.map((date) => <option key={date} value={date}>{dateLabel(date)}</option>)}
          </select>
        </label>


        <fieldset className="mt-6 rounded-3xl border border-border bg-card p-4">
          <legend className="px-2 text-xs font-black text-muted-foreground">איזה גליל טעון במדפסת?</legend>
          <div className="flex flex-wrap gap-2">
            {LABEL_MEDIA_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm font-black ${media === option.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-primary hover:bg-secondary'}`}
              >
                <input
                  type="radio"
                  name="bm-label-media"
                  value={option.value}
                  checked={media === option.value}
                  onChange={() => selectMedia(option.value)}
                  className="sr-only"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          <p className="mt-3 text-xs font-bold text-muted-foreground">
            {LABEL_MEDIA_OPTIONS.find((option) => option.value === media)?.hint}
          </p>
        </fieldset>
        <section className="mt-8 rounded-[2rem] border border-border bg-card p-5 shadow-sm sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-black text-primary">מדבקות לשקיות</h2>
              <p className="mt-1 text-xs font-bold text-muted-foreground">ברירת המחדל היא מדבקה אחת לכל הזמנה. 0 משאיר את ההזמנה בלי מדבקה.</p>
            </div>
            <button type="button" onClick={() => print('bag', bagLabels.length)} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-black text-primary-foreground">
              <LocalIcon name="ph:package-bold" className="text-lg" />
              <span>הדפסת מדבקות לשקיות</span>
            </button>
          </div>
          <ul className="mt-5 divide-y divide-border">
            {scopedOrders.map((order, index) => {
              const id = ids[index]!
              const copies = sessionBagCopies.get(`${selectedDate}:${id}`) ?? 1
              const customer = text(order.name) || 'ללא שם'
              return (
                <li key={id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div><strong className="text-sm text-primary">{customer}</strong><span className="mr-2 text-xs text-muted-foreground">{order.pickup ? 'איסוף עצמי' : text(order.place) || 'ללא יעד'}</span></div>
                  <div className="flex items-center gap-2 rounded-full bg-secondary p-1">
                    <button type="button" aria-label={`הפחתת מדבקה ל${customer}`} onClick={() => updateBagCopies(id, -1)} className="size-10 rounded-full text-lg font-black text-primary hover:bg-card">−</button>
                    <output aria-label={`כמות מדבקות ל${customer}`} className="min-w-7 text-center text-sm font-black text-primary">{copies}</output>
                    <button type="button" aria-label={`הוספת מדבקה ל${customer}`} onClick={() => updateBagCopies(id, 1)} className="size-10 rounded-full text-primary hover:bg-card"><LocalIcon name="ph:plus-bold" className="text-lg" /></button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>

        <section className="mt-6 rounded-[2rem] border border-border bg-card p-5 shadow-sm sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div><h2 className="text-xl font-black text-primary">מדבקות הכנה</h2><p className="mt-1 text-xs font-bold text-muted-foreground">מדבקה פיזית אחת לכל יחידה שמורה. אפשר להתאים את מספר העותקים לפני ההדפסה.</p></div>
            <button type="button" onClick={() => print('preparation', prepLabels.length)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-primary bg-card px-5 text-sm font-black text-primary">
              <LocalIcon name="ph:cooking-pot-bold" className="text-lg" />
              <span>הדפסת מדבקות הכנה</span>
            </button>
          </div>
          <p className="mt-4 text-sm font-black text-primary">{prepLabels.length} מדבקות נוצרו</p>
          {preparationGroupsForDate.length > 0 && (
            <ul className="mt-5 max-h-96 divide-y divide-border overflow-y-auto">
              {preparationGroupsForDate.map((group) => {
                const copies = sessionPreparationCopies.get(`${selectedDate}:${group.key}`) ?? group.sourceQuantity
                const accessibleName = `${group.item} עבור ${group.customer}`
                return (
                  <li key={group.key} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div>
                      <strong className="text-sm text-primary">{group.item}</strong>
                      <span className="mr-2 text-xs text-muted-foreground">{group.customer} · כמות בהזמנה {group.sourceQuantity}</span>
                    </div>
                    <div className="flex items-center gap-2 rounded-full bg-secondary p-1">
                      <button type="button" aria-label={`הפחתת מדבקת הכנה ${accessibleName}`} onClick={() => updatePreparationCopies(group, -1)} className="size-10 rounded-full text-lg font-black text-primary hover:bg-card">−</button>
                      <output aria-label={`כמות מדבקות הכנה ${accessibleName}`} className="min-w-7 text-center text-sm font-black text-primary">{copies}</output>
                      <button type="button" aria-label={`הוספת מדבקת הכנה ${accessibleName}`} onClick={() => updatePreparationCopies(group, 1)} className="size-10 rounded-full text-primary hover:bg-card"><LocalIcon name="ph:plus-bold" className="text-lg" /></button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
        {printMessage && <p role="alert" className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-black text-amber-900">{printMessage}</p>}
      </div>

      <main className="mx-auto mt-8 max-w-6xl space-y-10">
        <section aria-labelledby="bag-preview-title">
          <h2 id="bag-preview-title" className="bm-label-screen-only mb-4 text-lg font-black text-primary">תצוגה מקדימה — שקיות ({bagLabels.length})</h2>
          {bagLabels.length > 0 ? (
            <div className="bm-label-sheet bm-bag-labels">{bagLabels.map(({ order, key }) => <BagLabel key={key} order={order} qrTarget={labelQrTarget} />)}</div>
          ) : <p className="bm-label-screen-only rounded-2xl bg-card p-5 text-sm font-bold text-muted-foreground">אין מדבקות לשקיות בתצוגה.</p>}
        </section>
        <section aria-labelledby="prep-preview-title">
          <h2 id="prep-preview-title" className="bm-label-screen-only mb-4 text-lg font-black text-primary">תצוגה מקדימה — הכנה ({prepLabels.length})</h2>
          {prepLabels.length > 0 ? (
            <div className="bm-label-sheet bm-preparation-labels">{prepLabels.map((label) => <PreparationLabel key={label.key} label={label} />)}</div>
          ) : <p className="bm-label-screen-only rounded-2xl bg-card p-5 text-sm font-bold text-muted-foreground">אין פריטי הכנה שמורים בתאריך הזה.</p>}
        </section>
      </main>
    </div>
  )
}

export default LabelsScreen
