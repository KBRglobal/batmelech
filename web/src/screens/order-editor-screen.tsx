import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { APP_ROUTES } from '../app/routes.ts'
import { LocalIcon } from '../components/local-icon.tsx'
import { ScreenState } from '../components/screen-state.tsx'
import { useStore } from '../data/use-store.ts'
import {
  AIReviewSchema,
  HOTEL_OPTIONS,
  applyAIReviewToDraft,
  applyHotelSelection,
  buildAIOrderCatalog,
  buildOrderEditorMenu,
  calculateOrderDraftPricing,
  createOrderDraft,
  createOrderDraftFromLegacy,
  validateOrderDraft,
  type CustomDraftItem,
  type LunchDraftSelection,
  type OrderDraft,
  type OrderEditorMenu,
} from '../domain/order-editor.ts'
import { formatUsdMinorUnits } from '../domain/today-dashboard.ts'

const STATUS_OPTIONS = ['חדשה', 'אושרה', 'מוכנה', 'במשלוח', 'נמסרה', 'בוטלה'] as const
const HEAT_OPTIONS = ['', 'לא חריף', 'חריף', 'מעורב — חלק חריף וחלק לא'] as const
const PAYMENT_METHODS = ['', 'מזומן', 'ביט', 'פייבוקס', 'לינק', 'העברה'] as const
const PAID_OPTIONS = ['לא', 'מקדמה', 'כן', 'שת"פ'] as const

const SECTIONS = [
  ['details', 'פרטים'],
  ['customer', 'לקוח'],
  ['salads', 'סלטים'],
  ['firsts', 'ראשונות'],
  ['mains', 'עיקריות'],
  ['sides', 'תוספות'],
  ['desserts', 'קינוח'],
  ['lunch', 'צהריים'],
  ['extras', 'אקסטרות'],
  ['payment', 'תשלום'],
] as const

const inputClassName =
  'min-h-11 w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm font-bold text-primary outline-none focus:ring-2 focus:ring-primary/20'

function readReviewState(value: unknown) {
  if (typeof value !== 'object' || value === null) return null
  return AIReviewSchema.safeParse((value as { review?: unknown }).review).data ?? null
}

function Section({
  id,
  title,
  summary,
  children,
}: {
  readonly id: string
  readonly title: string
  readonly summary?: string
  readonly children: React.ReactNode
}) {
  return (
    <section id={`order-${id}`} className="scroll-mt-24 space-y-5 rounded-[2rem] border border-border bg-card p-5 shadow-sm sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3 border-r-4 border-primary pr-4">
        <h2 className="text-lg font-black text-primary">{title}</h2>
        {summary && <span className="rounded-full bg-secondary px-3 py-1 text-xs font-black text-primary">{summary}</span>}
      </div>
      {children}
    </section>
  )
}

function Field({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-black text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function QuantityStepper({
  label,
  value,
  onChange,
  compact = false,
}: {
  readonly label: string
  readonly value: number
  readonly onChange: (value: number) => void
  readonly compact?: boolean
}) {
  return (
    <div className={`flex items-center justify-between gap-3 ${compact ? '' : 'rounded-2xl border border-border bg-background/60 p-3'}`}>
      {!compact && <span className="min-w-0 text-sm font-bold text-primary">{label}</span>}
      <div className="flex shrink-0 items-center gap-2 rounded-full bg-secondary p-1">
        <button
          type="button"
          aria-label={`הפחתה מ${label}`}
          onClick={() => onChange(Math.max(0, value - 1))}
          className="flex size-10 items-center justify-center rounded-full text-primary hover:bg-card focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span aria-hidden="true">−</span>
        </button>
        <output aria-label={`כמות ${label}`} className="min-w-7 text-center text-sm font-black text-primary">
          {value}
        </output>
        <button
          type="button"
          aria-label={`הוספה ל${label}`}
          onClick={() => onChange(value + 1)}
          className="flex size-10 items-center justify-center rounded-full text-primary hover:bg-card focus-visible:outline-2 focus-visible:outline-ring"
        >
          <LocalIcon name="ph:plus-bold" className="text-sm" />
        </button>
      </div>
    </div>
  )
}

function QuantityCategory({
  names,
  quantities,
  outOfStock,
  update,
}: {
  readonly names: readonly string[]
  readonly quantities: Readonly<Record<string, number>>
  readonly outOfStock: ReadonlySet<string>
  readonly update: (name: string, quantity: number) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {names.map((name) => (
        <div key={name} className={outOfStock.has(name) ? 'rounded-2xl bg-muted/50 opacity-70' : ''}>
          <QuantityStepper label={name} value={quantities[name] ?? 0} onChange={(quantity) => update(name, quantity)} />
          {outOfStock.has(name) && <p className="px-3 pb-2 text-xs font-black text-destructive">אזל מהמלאי — הבחירה עדיין פתוחה</p>}
        </div>
      ))}
    </div>
  )
}

function updateQuantityRecord(
  record: Readonly<Record<string, number>>,
  name: string,
  quantity: number,
): Record<string, number> {
  const next = { ...record }
  if (quantity === 0) delete next[name]
  else next[name] = quantity
  return next
}

function updateSaladRecord(
  record: OrderDraft['salads'],
  name: string,
  selection: { readonly ordered: number; readonly gift: number },
): OrderDraft['salads'] {
  const next = { ...record }
  if (selection.ordered === 0 && selection.gift === 0) delete next[name]
  else next[name] = selection
  return next
}

function updateExtraRecord(
  record: OrderDraft['extras'],
  name: string,
  selection: { readonly quantity: number; readonly note: string },
): OrderDraft['extras'] {
  const next = { ...record }
  if (selection.quantity === 0 && selection.note.trim().length === 0) delete next[name]
  else next[name] = selection
  return next
}

function countRecord(record: Readonly<Record<string, number>>): number {
  return Object.values(record).reduce((total, quantity) => total + quantity, 0)
}

function OrderEditorContent({ draft, menu, onDraftChange, mode, outOfStockNames = [] }: {
  readonly draft: OrderDraft
  readonly menu: OrderEditorMenu
  readonly onDraftChange: (draft: OrderDraft) => void
  readonly mode: 'new' | 'edit'
  readonly outOfStockNames?: readonly string[]
}) {
  const navigate = useNavigate()
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState('')
  const outOfStock = useMemo(() => new Set(outOfStockNames), [outOfStockNames])
  const pricing = calculateOrderDraftPricing(draft, menu)
  const validationIssues = validateOrderDraft(draft)
  const allIssues = [...validationIssues, ...pricing.issues]
  const orderedSalads = Object.values(draft.salads).reduce((total, item) => total + item.ordered, 0)
  const giftSalads = Object.values(draft.salads).reduce((total, item) => total + item.gift, 0)
  const patch = (next: Partial<OrderDraft>) => onDraftChange({ ...draft, ...next })

  const updateCategory = (
    key: 'firsts' | 'mains' | 'sides' | 'desserts',
    name: string,
    quantity: number,
  ) => patch({ [key]: updateQuantityRecord(draft[key], name, quantity) })

  const updateLunch = (key: string, next: Partial<LunchDraftSelection>) => {
    const current = draft.lunch[key] ?? { quantity: 0, variantKey: '', sides: {}, addonQuantity: 0 }
    const updated = { ...current, ...next }
    const lunch = { ...draft.lunch }
    if (updated.quantity === 0 && updated.addonQuantity === 0 && Object.keys(updated.sides).length === 0) delete lunch[key]
    else lunch[key] = updated
    patch({ lunch })
  }

  return (
    <div className="pb-36" dir="rtl">
      <nav aria-label="מעבר בין חלקי ההזמנה" className="sticky top-0 z-20 flex gap-2 overflow-x-auto border-b border-border bg-card/95 px-5 py-3 backdrop-blur sm:px-8">
        {SECTIONS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => document.getElementById(`order-${id}`)?.scrollIntoView({ block: 'start' })}
            className="min-h-10 shrink-0 rounded-full border border-border bg-card px-4 text-xs font-black text-primary hover:bg-secondary"
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="mx-auto max-w-5xl space-y-7 px-5 py-8 sm:px-8 sm:py-10">
        <header>
          <p className="text-xs font-black text-accent-foreground">טיוטה מקומית בלבד · עדיין לא נשמרת</p>
          <h1 className="mt-2 font-heading text-3xl font-black text-primary">
            {mode === 'edit' ? `עריכת הזמנה ${String(draft.id ?? '')}` : 'הזמנה חדשה'}
          </h1>
        </header>

        {mode === 'new' && (
          <section className="rounded-[2rem] border border-border bg-secondary p-5 sm:p-7">
            <div className="flex items-center gap-3 text-primary">
              <LocalIcon name="ph:plus-circle-bold" className="text-2xl" />
              <h2 className="font-black">הלקוח כתב בוואטסאפ? הדביקי את ההודעה כאן</h2>
            </div>
            <p className="mt-2 text-xs font-bold text-muted-foreground">הפענוח מציע טיוטה בלבד. את בודקת את התיקונים, הספקות והתוספות בתשלום.</p>
            <label className="sr-only" htmlFor="customer-message">הודעת הלקוח</label>
            <textarea
              id="customer-message"
              value={importText}
              onChange={(event) => {
                setImportText(event.currentTarget.value)
                setImportError('')
              }}
              placeholder="מדביקים כאן את ההודעה המלאה..."
              className={`${inputClassName} mt-4 min-h-32 resize-y`}
            />
            {importError && <p role="alert" className="mt-2 text-xs font-black text-destructive">{importError}</p>}
            <button
              type="button"
              onClick={() => {
                if (!importText.trim()) {
                  setImportError('הדביקי קודם את הודעת הלקוח.')
                  return
                }
                navigate(APP_ROUTES.orderImportReview, { state: { message: importText, baseDraft: draft } })
              }}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 text-sm font-black text-primary-foreground hover:bg-primary/90"
            >
              <LocalIcon name="ph:plus-circle-bold" className="text-lg" />
              <span>פענוח ובדיקת ההזמנה</span>
            </button>
          </section>
        )}

        <Section id="details" title="פרטי ההזמנה">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Field label="לאיזה תאריך ההזמנה?">
              <input aria-label="תאריך ההזמנה" type="date" value={draft.date} onChange={(event) => patch({ date: event.currentTarget.value })} className={inputClassName} />
            </Field>
            <Field label="סטטוס ההזמנה">
              <select aria-label="סטטוס ההזמנה" value={draft.status} onChange={(event) => patch({ status: event.currentTarget.value })} className={inputClassName}>
                {STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <QuantityStepper label="ארוחות זוגיות" value={draft.meals} onChange={(meals) => patch({ meals })} />
            <QuantityStepper label="עריכה לכמה אנשים" value={draft.aricha} onChange={(aricha) => patch({ aricha })} />
            <QuantityStepper label="חלות" value={draft.challot} onChange={(challot) => patch({ challot })} />
          </div>
          <Field label="קבוצה / יעד משותף">
            <input aria-label="קבוצה / יעד משותף" value={draft.group} onChange={(event) => patch({ group: event.currentTarget.value })} className={inputClassName} />
          </Field>
        </Section>

        <Section id="customer" title="פרטי לקוח ומשלוח">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Field label="שם מלא">
              <input aria-label="שם מלא" value={draft.name} onChange={(event) => patch({ name: event.currentTarget.value })} className={inputClassName} />
            </Field>
            <Field label="מספר טלפון">
              <input aria-label="מספר טלפון" inputMode="tel" value={draft.phone} onChange={(event) => patch({ phone: event.currentTarget.value })} className={inputClassName} />
            </Field>
          </div>
          <label className="flex min-h-11 items-center gap-3 rounded-2xl border border-border px-4 text-sm font-black text-primary">
            <input type="checkbox" checked={draft.pickup} onChange={(event) => patch({ pickup: event.currentTarget.checked })} className="size-5 accent-primary" />
            <span>איסוף עצמי</span>
          </label>
          {!draft.pickup && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <Field label="שם מלון / יעד">
                  <input
                    aria-label="שם מלון / יעד"
                    list="bat-melech-hotels"
                    value={draft.place}
                    onChange={(event) => onDraftChange(applyHotelSelection(draft, event.currentTarget.value))}
                    className={inputClassName}
                  />
                  <datalist id="bat-melech-hotels">
                    {HOTEL_OPTIONS.map((hotel) => <option key={hotel.name} value={hotel.name}>{hotel.city} · {hotel.fullAddress}</option>)}
                  </datalist>
                </Field>
                <Field label="שעת הגעה">
                  <input aria-label="שעת הגעה" value={draft.time} onChange={(event) => patch({ time: event.currentTarget.value })} className={inputClassName} />
                </Field>
              </div>
              <Field label="כתובת מלאה / הוראות לקבלה">
                <input aria-label="כתובת מלאה" value={draft.address} onChange={(event) => patch({ address: event.currentTarget.value, hotelAddress: event.currentTarget.value })} className={inputClassName} />
              </Field>
              <Field label="קישור ניווט">
                <input aria-label="קישור ניווט" value={draft.navigationUrl} onChange={(event) => patch({ navigationUrl: event.currentTarget.value })} className={inputClassName} />
              </Field>
            </div>
          )}
        </Section>

        <Section id="salads" title="סלטים" summary={`${orderedSalads}/${draft.meals * 4} כלולים · ${giftSalads} פינוק`}>
          <p className="text-xs font-bold text-muted-foreground">עמודת פינוק לא מקטינה את הזכאות ולא מחויבת.</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {menu.salads.map((name) => {
              const selection = draft.salads[name] ?? { ordered: 0, gift: 0 }
              return (
                <div key={name} className={`rounded-2xl border border-border bg-background/60 p-3 ${outOfStock.has(name) ? 'opacity-70' : ''}`}>
                  <p className="mb-3 text-sm font-black text-primary">{name}</p>
                  {outOfStock.has(name) && <p className="mb-2 text-xs font-black text-destructive">אזל מהמלאי — הבחירה עדיין פתוחה</p>}
                  <div className="grid grid-cols-2 gap-2">
                    <div><span className="mb-1 block text-center text-[0.65rem] font-black text-muted-foreground">הוזמן</span><QuantityStepper compact label={`${name} הוזמן`} value={selection.ordered} onChange={(ordered) => patch({ salads: updateSaladRecord(draft.salads, name, { ...selection, ordered }) })} /></div>
                    <div><span className="mb-1 block text-center text-[0.65rem] font-black text-accent-foreground">פינוק</span><QuantityStepper compact label={`${name} פינוק`} value={selection.gift} onChange={(gift) => patch({ salads: updateSaladRecord(draft.salads, name, { ...selection, gift }) })} /></div>
                  </div>
                </div>
              )
            })}
          </div>
        </Section>

        <Section id="firsts" title="מנה ראשונה — דגים" summary={`${pricing.result?.fish.selectedUnits ?? '—'}/${draft.meals * 2} יחידות`}>
          <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-xs font-bold leading-6 text-amber-900">
            בכל זוגית כלולות שתי יחידות פילה. מנת קציצות דגים שווה לשתי יחידות. כל יחידה מעבר לכלול מחויבת ב־30$.
          </div>
          <QuantityCategory names={menu.firsts} quantities={draft.firsts} outOfStock={outOfStock} update={(name, quantity) => updateCategory('firsts', name, quantity)} />
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Field label="חריפות">
              <select aria-label="חריפות" value={draft.heat} onChange={(event) => patch({ heat: event.currentTarget.value })} className={inputClassName}>{HEAT_OPTIONS.map((value) => <option key={value} value={value}>{value || '— ללא בחירה —'}</option>)}</select>
            </Field>
            <Field label="הערה לראשונות">
              <input aria-label="הערה לראשונות" value={draft.firstsNote} onChange={(event) => patch({ firstsNote: event.currentTarget.value })} className={inputClassName} />
            </Field>
          </div>
        </Section>

        <Section id="mains" title="עיקריות" summary={`${countRecord(draft.mains)} נבחרו`}>
          <QuantityCategory names={menu.mains} quantities={draft.mains} outOfStock={outOfStock} update={(name, quantity) => updateCategory('mains', name, quantity)} />
          <Field label="הערה לעיקריות"><input aria-label="הערה לעיקריות" value={draft.mainsNote} onChange={(event) => patch({ mainsNote: event.currentTarget.value })} className={inputClassName} /></Field>
        </Section>

        <Section id="sides" title="תוספות" summary={`${countRecord(draft.sides)} נבחרו`}>
          <QuantityCategory names={menu.sides} quantities={draft.sides} outOfStock={outOfStock} update={(name, quantity) => updateCategory('sides', name, quantity)} />
        </Section>

        <Section id="desserts" title="קינוחים" summary={`2 סופלה או בקלאווה אחת לזוגית`}>
          <QuantityCategory names={menu.desserts} quantities={draft.desserts} outOfStock={outOfStock} update={(name, quantity) => updateCategory('desserts', name, quantity)} />
          {pricing.dessert.excessHalfUnits > 0 && <p role="alert" className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-xs font-black text-amber-900">יש חריגה מזכאות הקינוח. לא הוספנו מחיר שלא אושר.</p>}
        </Section>

        <Section id="lunch" title="תפריט צהריים">
          <div className="space-y-4">
            {menu.lunch.map((item) => {
              const selection = draft.lunch[item.key] ?? { quantity: 0, variantKey: '', sides: {}, addonQuantity: 0 }
              const selectedVariant = item.variants.find((variant) => variant.key === (selection.variantKey || item.variants[0]?.key))
              return (
                <div key={item.key} className="rounded-2xl border border-border bg-background/60 p-4">
                  <QuantityStepper label={item.name} value={selection.quantity} onChange={(quantity) => updateLunch(item.key, { quantity })} />
                  {selection.quantity > 0 && item.variants.length > 0 && (
                    <fieldset className="mt-4 flex flex-wrap gap-3">
                      <legend className="mb-2 text-xs font-black text-muted-foreground">בחירת וריאציה</legend>
                      {item.variants.map((variant) => (
                        <label key={variant.key} className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-bold text-primary">
                          <input type="radio" name={`lunch-${item.key}`} checked={(selection.variantKey || item.variants[0]?.key) === variant.key} onChange={() => updateLunch(item.key, { variantKey: variant.key })} />
                          <span>{variant.label} · {formatUsdMinorUnits(variant.priceMinorUnits)}</span>
                        </label>
                      ))}
                    </fieldset>
                  )}
                  {selection.quantity > 0 && item.sideChoice && selectedVariant && (
                    <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-3">
                      {menu.lunchSides.map((sideName) => (
                        <QuantityStepper
                          key={sideName}
                          label={sideName}
                          value={selection.sides[sideName] ?? 0}
                          onChange={(quantity) => updateLunch(item.key, { sides: updateQuantityRecord(selection.sides, sideName, quantity) })}
                        />
                      ))}
                    </div>
                  )}
                  {selection.quantity > 0 && item.addon && (
                    <div className="mt-4"><QuantityStepper label={`${item.addon.name} · ${formatUsdMinorUnits(item.addon.priceMinorUnits)}`} value={selection.addonQuantity} onChange={(addonQuantity) => updateLunch(item.key, { addonQuantity })} /></div>
                  )}
                </div>
              )
            })}
          </div>
        </Section>

        <Section id="extras" title="אקסטרות ופריטים חופשיים">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {menu.extras.map((extra) => {
              const selection = draft.extras[extra.name] ?? { quantity: 0, note: '' }
              return (
                <div key={extra.name} className="rounded-2xl border border-border bg-background/60 p-3">
                  <QuantityStepper label={`${extra.name} · ${formatUsdMinorUnits(extra.priceMinorUnits)}`} value={selection.quantity} onChange={(quantity) => patch({ extras: updateExtraRecord(draft.extras, extra.name, { ...selection, quantity }) })} />
                  {selection.quantity > 0 && <input aria-label={`הערה ל${extra.name}`} value={selection.note} onChange={(event) => patch({ extras: updateExtraRecord(draft.extras, extra.name, { ...selection, note: event.currentTarget.value }) })} placeholder={extra.name === 'תוספת מנת דג' ? 'איזה דג?' : 'הערה'} className={`${inputClassName} mt-2`} />}
                </div>
              )
            })}
          </div>
          <div className="space-y-3 border-t border-border pt-5">
            {draft.custom.map((item, index) => (
              <div key={index} className="grid grid-cols-1 gap-3 rounded-2xl border border-dashed border-border p-4 md:grid-cols-12">
                <input aria-label={`שם פריט חופשי ${index + 1}`} value={item.name} onChange={(event) => {
                  const custom = draft.custom.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, name: event.currentTarget.value } : candidate)
                  patch({ custom })
                }} placeholder="שם הפריט" className={`${inputClassName} md:col-span-4`} />
                <input aria-label={`כמות פריט חופשי ${index + 1}`} type="number" min="0" step="1" value={item.quantity} onChange={(event) => {
                  const quantity = Math.max(0, Number.parseInt(event.currentTarget.value, 10) || 0)
                  patch({ custom: draft.custom.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, quantity } : candidate) })
                }} className={`${inputClassName} md:col-span-2`} />
                <input aria-label={`מחיר פריט חופשי ${index + 1}`} inputMode="decimal" value={item.unitPrice} onChange={(event) => patch({ custom: draft.custom.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, unitPrice: event.currentTarget.value } : candidate) })} placeholder="מחיר $" className={`${inputClassName} md:col-span-2`} />
                <input aria-label={`הערת פריט חופשי ${index + 1}`} value={item.note} onChange={(event) => patch({ custom: draft.custom.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, note: event.currentTarget.value } : candidate) })} placeholder="הערה" className={`${inputClassName} md:col-span-3`} />
                <button type="button" aria-label={`מחיקת פריט חופשי ${index + 1}`} onClick={() => patch({ custom: draft.custom.filter((_, candidateIndex) => candidateIndex !== index) })} className="min-h-11 rounded-xl text-xs font-black text-destructive hover:bg-rose-50 md:col-span-1">מחיקה</button>
              </div>
            ))}
            <button type="button" onClick={() => patch({ custom: [...draft.custom, { name: '', quantity: 1, unitPrice: '', note: '' } satisfies CustomDraftItem] })} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border text-sm font-black text-primary hover:bg-secondary">
              <LocalIcon name="ph:plus-bold" />
              <span>הוספת פריט חופשי</span>
            </button>
          </div>
        </Section>

        <Section id="payment" title="סיכום ותשלום">
          {pricing.result ? (
            <div className="space-y-3 rounded-2xl bg-secondary p-4">
              {pricing.result.lines.map((line, index) => (
                <div key={`${line.kind}-${line.name}-${index}`} className="flex justify-between gap-4 text-xs font-bold text-primary">
                  <span>{line.name} ×{line.quantity}</span>
                  <span dir="ltr">{formatUsdMinorUnits(line.amountMinorUnits)}</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-border pt-3 text-lg font-black text-primary"><span>מחיר מוצע</span><span dir="ltr">{formatUsdMinorUnits(pricing.result.totalMinorUnits)}</span></div>
              <button type="button" onClick={() => patch({ total: (pricing.result!.totalMinorUnits / 100).toFixed(2) })} className="min-h-11 w-full rounded-xl border border-primary/20 bg-card text-xs font-black text-primary hover:bg-background">להשתמש במחיר המוצע</button>
            </div>
          ) : <p role="alert" className="rounded-2xl bg-rose-50 p-4 text-sm font-black text-destructive">אי אפשר לחשב מחיר בטוח.</p>}
          {allIssues.length > 0 && (
            <ul className="space-y-2" aria-label="אזהרות הזמנה">
              {allIssues.map((issue, index) => <li key={`${issue.code}-${index}`} className={`rounded-xl p-3 text-xs font-black ${issue.blocking ? 'bg-rose-50 text-destructive' : 'bg-amber-50 text-amber-900'}`}>{issue.message}</li>)}
            </ul>
          )}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Field label="סך לתשלום ($)"><input aria-label="סך לתשלום" inputMode="decimal" value={draft.total} onChange={(event) => patch({ total: event.currentTarget.value })} className={inputClassName} /></Field>
            <Field label="מקדמה ($)"><input aria-label="מקדמה" inputMode="decimal" value={draft.deposit} onChange={(event) => patch({ deposit: event.currentTarget.value })} className={inputClassName} /></Field>
            <Field label="דרך תשלום"><select aria-label="דרך תשלום" value={draft.payMethod} onChange={(event) => patch({ payMethod: event.currentTarget.value })} className={inputClassName}>{PAYMENT_METHODS.map((value) => <option key={value} value={value}>{value || '— לא נבחר —'}</option>)}</select></Field>
            <Field label="סטטוס תשלום"><select aria-label="סטטוס תשלום" value={draft.paid} onChange={(event) => patch({ paid: event.currentTarget.value })} className={inputClassName}>{PAID_OPTIONS.map((value) => <option key={value}>{value}</option>)}</select></Field>
          </div>
          <Field label="הערות כלליות"><textarea aria-label="הערות כלליות" value={draft.notes} onChange={(event) => patch({ notes: event.currentTarget.value })} className={`${inputClassName} min-h-28 resize-y`} /></Field>
        </Section>
      </div>

      <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 p-4 backdrop-blur md:right-64">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[0.65rem] font-black text-muted-foreground">הטיוטה לא שונה את מסד הנתונים</p>
            <p className="text-lg font-black text-primary" dir="ltr">{pricing.result ? formatUsdMinorUnits(pricing.result.totalMinorUnits) : '—'}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => navigate(APP_ROUTES.orders)} className="min-h-11 rounded-full border border-border px-5 text-sm font-black text-primary hover:bg-secondary">ביטול</button>
            <button type="button" disabled title="השמירה תופעל רק עם מנגנון גרסאות שמונע דריסת הזמנות" className="min-h-11 cursor-not-allowed rounded-full bg-muted px-7 text-sm font-black text-muted-foreground opacity-70">שמירה תופעל לאחר חיבור מוגן</button>
          </div>
        </div>
      </footer>
    </div>
  )
}

export function OrderEditorScreen() {
  const { orderId } = useParams<{ orderId?: string }>()
  const storeQuery = useStore()
  const location = useLocation()
  const [draft, setDraft] = useState<OrderDraft | null>(null)
  const initializedFor = useRef('')

  const store = storeQuery.data?.data ?? null
  const menu = useMemo(() => buildOrderEditorMenu(store ?? { orders: [] }), [store])
  const mode = orderId === undefined ? 'new' : 'edit'
  const initializationKey = `${mode}:${orderId ?? ''}:${storeQuery.data?.ts ?? ''}`

  useEffect(() => {
    if (!storeQuery.data || initializedFor.current === initializationKey) return
    initializedFor.current = initializationKey
    if (mode === 'edit') {
      const matches = (store?.orders ?? []).filter((order) => String(order.id) === orderId)
      setDraft(matches.length === 1 ? createOrderDraftFromLegacy(matches[0]!, menu) : null)
      return
    }
    const base = createOrderDraft(menu)
    const review = readReviewState(location.state)
    setDraft(review ? applyAIReviewToDraft(base, review, buildAIOrderCatalog(menu).targetsById) : base)
  }, [initializationKey, location.state, menu, mode, orderId, store, storeQuery.data])

  if (storeQuery.isPending) return <ScreenState kind="loading" title="טוענת את טופס ההזמנה" />
  if (storeQuery.isError) return <ScreenState kind="error" title="לא הצלחנו לטעון את ההזמנה" retry={() => { void storeQuery.refetch() }} />
  if (mode === 'edit') {
    const matches = (store?.orders ?? []).filter((order) => String(order.id) === orderId)
    if (matches.length !== 1) {
      return <ScreenState kind="error" title={matches.length === 0 ? 'ההזמנה לא נמצאה' : 'מזהה ההזמנה אינו ייחודי'} description="לא נפתחה טיוטה כדי למנוע עריכת הזמנה לא נכונה." />
    }
  }
  if (!draft) return <ScreenState kind="loading" title="מכינה טיוטה בטוחה" />

  const outOfStockNames = Array.isArray(store?.settings?.out)
    ? store.settings.out.filter((value): value is string => typeof value === 'string')
    : []

  return (
    <OrderEditorContent
      draft={draft}
      menu={menu}
      onDraftChange={setDraft}
      mode={mode}
      outOfStockNames={outOfStockNames}
    />
  )
}

export default OrderEditorScreen
