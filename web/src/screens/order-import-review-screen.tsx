import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { z } from 'zod'
import { APP_ROUTES } from '../app/routes.ts'
import { LocalIcon } from '../components/local-icon.tsx'
import { ScreenState } from '../components/screen-state.tsx'
import { useStore } from '../data/use-store.ts'
import {
  AIReviewSchema,
  applyAIReviewToDraft,
  buildAIOrderCatalog,
  buildOrderEditorMenu,
  createOrderDraft,
  createOrderDraftFromLegacy,
  serializeOrderDraft,
  type AIReview,
  type AIOrderCatalog,
  type OrderDraft,
} from '../domain/order-editor.ts'
import { isAutomaticChargeName } from '../domain/order-total.ts'
import { isVersionedStateEnvelope, type VersionedStateEnvelope } from '../services/state-api.ts'

const AIResponseSchema = z.object({ review: AIReviewSchema }).strict()

interface ReviewContext {
  readonly revision: number
  readonly hash: string
  readonly ts: number
  readonly stateSignature: string
  readonly catalogSignature: string
  readonly menu: ReturnType<typeof buildOrderEditorMenu>
  readonly targetsById: ReturnType<typeof buildAIOrderCatalog>['targetsById']
  readonly baseDraft: OrderDraft
  readonly exactDraft: OrderDraft | null
}

const BM1_COUNT = z.number().int().min(0).max(1000)
const BM1_SELECTED_COUNT = z.number().int().min(1).max(1000)
const BM1_TEXT = z.string().max(1000)
const BM1PayloadSchema = z.object({
  date: BM1_TEXT,
  name: BM1_TEXT,
  phone: BM1_TEXT,
  place: BM1_TEXT,
  address: BM1_TEXT,
  time: BM1_TEXT,
  pickup: z.boolean(),
  meals: BM1_COUNT,
  challot: BM1_COUNT,
  salads: z.record(z.string().min(1).max(300), BM1_SELECTED_COUNT),
  firsts: z.record(z.string().min(1).max(300), BM1_SELECTED_COUNT),
  heat: BM1_TEXT,
  mains: z.record(z.string().min(1).max(300), BM1_SELECTED_COUNT),
  sides: z.record(z.string().min(1).max(300), BM1_SELECTED_COUNT),
  desserts: z.record(z.string().min(1).max(300), BM1_SELECTED_COUNT),
  extras: z.record(z.string().min(1).max(300), z.object({
    q: BM1_SELECTED_COUNT,
    note: BM1_TEXT,
  }).strict()),
  notes: BM1_TEXT,
}).passthrough()

function catalogSignature(items: ReturnType<typeof buildAIOrderCatalog>['items']): string {
  return JSON.stringify(items)
}

function stateSignature(data: Parameters<typeof buildOrderEditorMenu>[0]): string {
  return JSON.stringify(data)
}

function contextMatchesEnvelope(
  context: ReviewContext,
  envelope: VersionedStateEnvelope,
): boolean {
  return envelope.revision === context.revision
    && envelope.hash === context.hash
    && envelope.ts === context.ts
    && stateSignature(envelope.data) === context.stateSignature
}

function initialMessage(value: unknown): string {
  if (typeof value !== 'object' || value === null) return ''
  const message = (value as { message?: unknown }).message
  return typeof message === 'string' ? message : ''
}

function initialBaseDraft(value: unknown): { readonly present: boolean; readonly value: unknown } {
  if (typeof value !== 'object' || value === null || !Object.hasOwn(value, 'baseDraft')) {
    return { present: false, value: null }
  }
  return { present: true, value: (value as { baseDraft?: unknown }).baseDraft }
}

function zeroCoupleDraft(menu: ReturnType<typeof buildOrderEditorMenu>): OrderDraft {
  return { ...createOrderDraft(menu), meals: 0, challot: 0 }
}

function validatedBaseDraft(
  value: unknown,
  menu: ReturnType<typeof buildOrderEditorMenu>,
): OrderDraft | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  try {
    const stored = serializeOrderDraft(value as OrderDraft, 'review-base')
    return { ...createOrderDraftFromLegacy(stored, menu), id: null }
  } catch {
    return null
  }
}

function assertAllowedNames(
  values: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): void {
  const allowedNames = new Set(allowed)
  if (Object.keys(values).some((name) => !allowedNames.has(name))) {
    throw new Error('BM1_UNKNOWN_ITEM')
  }
}

function decodeBM1Draft(
  message: string,
  menu: ReturnType<typeof buildOrderEditorMenu>,
): OrderDraft | null {
  const markerPresent = message.includes('#BM1#')
  const match = /#BM1#([A-Za-z0-9+/=]{1,12000})#/u.exec(message)
  if (!match) {
    if (markerPresent) throw new Error('BM1_INVALID')
    return null
  }
  try {
    const binary = atob(match[1]!)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const parsed = BM1PayloadSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
    assertAllowedNames(parsed.salads, menu.salads)
    assertAllowedNames(parsed.firsts, menu.firsts)
    assertAllowedNames(parsed.mains, menu.mains)
    assertAllowedNames(parsed.sides, menu.sides)
    assertAllowedNames(parsed.desserts, menu.desserts)
    const selectableExtras = new Set(menu.extras.map((extra) => extra.name))
    if (Object.keys(parsed.extras).some((name) => !selectableExtras.has(name) && !isAutomaticChargeName(name))) {
      throw new Error('BM1_UNKNOWN_ITEM')
    }
    const base = zeroCoupleDraft(menu)
    return {
      ...base,
      date: parsed.date || base.date,
      name: parsed.name,
      phone: parsed.phone,
      place: parsed.place,
      hotelName: parsed.place,
      address: parsed.address,
      time: parsed.time,
      pickup: parsed.pickup,
      meals: parsed.meals,
      challot: parsed.challot,
      salads: Object.fromEntries(Object.entries(parsed.salads).map(([name, ordered]) => [name, { ordered, gift: 0 }])),
      firsts: structuredClone(parsed.firsts),
      heat: parsed.heat,
      mains: structuredClone(parsed.mains),
      sides: structuredClone(parsed.sides),
      desserts: structuredClone(parsed.desserts),
      extras: Object.fromEntries(
        Object.entries(parsed.extras)
          .filter(([name]) => !isAutomaticChargeName(name))
          .map(([name, selection]) => [name, { quantity: selection.q, note: selection.note }]),
      ),
      notes: parsed.notes,
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'BM1_UNKNOWN_ITEM') throw error
    throw new Error('BM1_INVALID')
  }
}

function exactReview(draft: OrderDraft, catalog: AIOrderCatalog): AIReview {
  const quantityForTarget = (target: AIOrderCatalog['targetsById'][string]): number => {
    if (target.kind === 'meals') return draft.meals
    if (target.kind === 'challahs') return draft.challot
    if (target.kind === 'salad') return draft.salads[target.name]?.ordered ?? 0
    if (target.kind === 'first') return draft.firsts[target.name] ?? 0
    if (target.kind === 'main') return draft.mains[target.name] ?? 0
    if (target.kind === 'side') return draft.sides[target.name] ?? 0
    if (target.kind === 'dessert') return draft.desserts[target.name] ?? 0
    if (target.kind === 'extra') return draft.extras[target.name]?.quantity ?? 0
    return 0
  }
  const items = catalog.items.flatMap((item) => {
    const target = catalog.targetsById[item.id]
    if (!target) return []
    const quantity = quantityForTarget(target)
    return quantity > 0 ? [{
      catalogItemId: item.id,
      catalogItemName: item.name,
      category: item.category,
      quantity,
      sourceText: 'קוד הזמנה מובנה של הלקוח',
      confidence: 1,
    }] : []
  })
  return AIReviewSchema.parse({
    reviewOnly: true,
    draft: {
      customerName: draft.name || null,
      customerPhone: draft.phone || null,
      serviceDate: draft.date || null,
      serviceTime: draft.time || null,
      fulfillmentMethod: draft.pickup ? 'pickup' : 'delivery',
      deliveryLocation: draft.pickup ? null : draft.place || null,
      items,
      notes: draft.notes ? [draft.notes] : [],
    },
    corrections: [],
    ambiguities: [],
    paidExtras: [],
    unknownItems: [],
    missingFields: [],
    warnings: [{
      code: 'other',
      severity: 'info',
      message: 'הכמויות נקראו ישירות מקוד ההזמנה המובנה ולא הוסקו מטקסט חופשי.',
    }],
    overallConfidence: 1,
  })
}

function confidenceLabel(value: number): string {
  if (value >= 0.85) return 'גבוהה'
  if (value >= 0.6) return 'בינונית'
  return 'נמוכה'
}

function ReviewSection({
  title,
  tone = 'default',
  children,
}: {
  readonly title: string
  readonly tone?: 'default' | 'warning' | 'question'
  readonly children: React.ReactNode
}) {
  const colors =
    tone === 'warning'
      ? 'border-amber-100 bg-amber-50 text-amber-950'
      : tone === 'question'
        ? 'border-blue-100 bg-blue-50 text-blue-950'
        : 'border-border bg-card text-primary'
  return (
    <section className={`rounded-[2rem] border p-5 shadow-sm sm:p-6 ${colors}`}>
      <h2 className="border-b border-current/10 pb-3 text-sm font-black">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function FindingList({ rows }: { readonly rows: readonly { readonly primary: string; readonly secondary?: string }[] }) {
  return (
    <ul className="space-y-3">
      {rows.map((row, index) => (
        <li key={`${row.primary}-${index}`} className="rounded-2xl border border-current/10 bg-card/70 p-3 text-sm font-bold">
          <p>{row.primary}</p>
          {row.secondary && <p className="mt-1 text-xs font-medium opacity-75">{row.secondary}</p>}
        </li>
      ))}
    </ul>
  )
}

function DraftPreview({ draft }: { readonly draft: OrderDraft }) {
  const selectedItems = [
    ...Object.entries(draft.salads).map(([name, value]) => `${name} ×${value.ordered}`),
    ...Object.entries(draft.firsts).map(([name, quantity]) => `${name} ×${quantity}`),
    ...Object.entries(draft.mains).map(([name, quantity]) => `${name} ×${quantity}`),
    ...Object.entries(draft.sides).map(([name, quantity]) => `${name} ×${quantity}`),
    ...Object.entries(draft.desserts).map(([name, quantity]) => `${name} ×${quantity}`),
    ...Object.entries(draft.extras).map(([name, value]) => `${name} ×${value.quantity}`),
  ].filter((line) => !line.endsWith('×0'))

  return (
    <ReviewSection title="הטיוטה שהוחלה בזיכרון בלבד">
      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-xs font-black text-muted-foreground">לקוח</dt><dd className="font-bold">{draft.name || 'לא זוהה'}</dd></div>
        <div><dt className="text-xs font-black text-muted-foreground">טלפון</dt><dd className="font-bold">{draft.phone || 'לא זוהה'}</dd></div>
        <div><dt className="text-xs font-black text-muted-foreground">תאריך</dt><dd className="font-bold">{draft.date}</dd></div>
        <div><dt className="text-xs font-black text-muted-foreground">יעד</dt><dd className="font-bold">{draft.pickup ? 'איסוף עצמי' : draft.place || 'לא זוהה'}</dd></div>
      </dl>
      <div className="mt-4 rounded-2xl bg-secondary p-4">
        <p className="text-xs font-black text-muted-foreground">בחירות שהוחלו</p>
        <p className="mt-2 text-sm font-bold">ארוחות זוגיות: {draft.meals}</p>
        <p className="mt-1 text-sm font-bold">חלות: {draft.challot}</p>
        {selectedItems.length > 0 ? (
          <ul className="mt-2 list-inside list-disc space-y-1 text-xs font-bold">
            {selectedItems.map((line) => <li key={line}>{line}</li>)}
          </ul>
        ) : <p className="mt-2 text-xs font-bold text-muted-foreground">לא הוחלו מנות עם כמות מפורשת.</p>}
      </div>
    </ReviewSection>
  )
}

export function OrderImportReviewScreen() {
  const storeQuery = useStore()
  const location = useLocation()
  const navigate = useNavigate()
  const baseDraftInput = initialBaseDraft(location.state)
  const [message, setMessage] = useState(() => initialMessage(location.state))
  const [review, setReview] = useState<AIReview | null>(null)
  const [reviewContext, setReviewContext] = useState<ReviewContext | null>(null)
  const [appliedDraft, setAppliedDraft] = useState<OrderDraft | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'checking' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  if (storeQuery.isPending) return <ScreenState kind="loading" title="טוענת את תפריט ההזמנות" />
  if (storeQuery.isError) return <ScreenState kind="error" title="לא הצלחנו לטעון את התפריט" retry={() => { void storeQuery.refetch() }} />

  const requestReview = async () => {
    const normalizedMessage = message.trim()
    if (!normalizedMessage) {
      setStatus('error')
      setErrorMessage('הדביקי קודם את הודעת הלקוח.')
      return
    }
    setStatus('loading')
    setErrorMessage('')
    setReview(null)
    setReviewContext(null)
    setAppliedDraft(null)
    try {
      const refreshed = await storeQuery.refetch()
      if (!refreshed.data || !isVersionedStateEnvelope(refreshed.data)) throw new Error('UNVERSIONED_STATE')
      const menu = buildOrderEditorMenu(refreshed.data.data)
      const catalog = buildAIOrderCatalog(menu)
      const baseDraft = baseDraftInput.present
        ? validatedBaseDraft(baseDraftInput.value, menu)
        : zeroCoupleDraft(menu)
      if (!baseDraft) throw new Error('INVALID_BASE_DRAFT')
      const exactDraft = decodeBM1Draft(normalizedMessage, menu)
      const requestedContext: ReviewContext = {
        revision: refreshed.data.revision,
        hash: refreshed.data.hash,
        ts: refreshed.data.ts,
        stateSignature: stateSignature(refreshed.data.data),
        catalogSignature: catalogSignature(catalog.items),
        menu: structuredClone(menu),
        targetsById: structuredClone(catalog.targetsById),
        baseDraft: structuredClone(baseDraft),
        exactDraft: exactDraft ? structuredClone(exactDraft) : null,
      }
      if (exactDraft) {
        setReview(exactReview(exactDraft, catalog))
        setReviewContext(requestedContext)
        setStatus('idle')
        return
      }
      const response = await fetch('/api/ai/order-intake/', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ message: normalizedMessage, catalog: catalog.items }),
      })
      if (!response.ok) throw new Error('HTTP_ERROR')
      const parsed = AIResponseSchema.safeParse(await response.json())
      if (!parsed.success) throw new Error('INVALID_RESPONSE')
      setReview(parsed.data.review)
      setReviewContext(requestedContext)
      setStatus('idle')
    } catch (error) {
      setStatus('error')
      setErrorMessage(
        error instanceof Error && error.message === 'BM1_UNKNOWN_ITEM'
          ? 'קוד ההזמנה כולל פריט שאינו קיים בתפריט הנוכחי. שום פריט לא הוחל וצריך לבדוק את ההודעה ידנית.'
          : error instanceof Error && (error.message === 'BM1_INVALID' || error.message === 'INVALID_BASE_DRAFT')
            ? 'קוד ההזמנה או הטיוטה הקודמת אינם תקינים. שום דבר לא הוחל כדי לא לאבד פריטים.'
            : 'לא הצלחנו לקבל פענוח תקין. ההזמנה לא שונתה ואפשר לנסות שוב.',
      )
    }
  }

  const rejectChangedState = () => {
    setReview(null)
    setReviewContext(null)
    setAppliedDraft(null)
    setStatus('error')
    setErrorMessage('הנתונים או התפריט השתנו מאז הפענוח. צריך לפענח שוב כדי שלא תחול מנה או כמות לא נכונה.')
  }

  const applyReview = async () => {
    if (!review || !reviewContext) return
    setStatus('checking')
    setErrorMessage('')
    try {
      const refreshed = await storeQuery.refetch()
      if (!refreshed.data || !isVersionedStateEnvelope(refreshed.data)) throw new Error('UNVERSIONED_STATE')
      const freshCatalog = buildAIOrderCatalog(buildOrderEditorMenu(refreshed.data.data))
      if (
        !contextMatchesEnvelope(reviewContext, refreshed.data) ||
        catalogSignature(freshCatalog.items) !== reviewContext.catalogSignature
      ) {
        rejectChangedState()
        return
      }
      setAppliedDraft(
        reviewContext.exactDraft ?? applyAIReviewToDraft(
          reviewContext.baseDraft,
          review,
          reviewContext.targetsById,
          reviewContext.menu,
        ),
      )
      setStatus('idle')
    } catch {
      setStatus('error')
      setErrorMessage('לא הצלחנו לוודא שהנתונים עדיין עדכניים. שום דבר לא הוחל ואפשר לנסות שוב.')
    }
  }

  const continueToEditor = async () => {
    if (!appliedDraft || !review || !reviewContext) return
    setStatus('checking')
    setErrorMessage('')
    try {
      const refreshed = await storeQuery.refetch()
      if (!refreshed.data || !isVersionedStateEnvelope(refreshed.data)) throw new Error('UNVERSIONED_STATE')
      const freshCatalog = buildAIOrderCatalog(buildOrderEditorMenu(refreshed.data.data))
      if (
        !contextMatchesEnvelope(reviewContext, refreshed.data) ||
        catalogSignature(freshCatalog.items) !== reviewContext.catalogSignature
      ) {
        rejectChangedState()
        return
      }
      navigate(APP_ROUTES.newOrder, {
        state: {
          review,
          reviewedCatalogSignature: reviewContext.catalogSignature,
          reviewedRevision: reviewContext.revision,
          reviewedHash: reviewContext.hash,
          reviewedTs: reviewContext.ts,
          reviewedDraft: appliedDraft,
        },
      })
    } catch {
      setStatus('error')
      setErrorMessage('לא הצלחנו לוודא שהנתונים עדיין עדכניים. הטיוטה לא הועברה ואפשר לנסות שוב.')
    }
  }

  const isBusy = status === 'loading' || status === 'checking'

  return (
    <div className="pb-28" dir="rtl">
      <div className="mx-auto max-w-5xl space-y-7 px-5 py-8 sm:px-8 sm:py-10">
        <header>
          <div className="flex items-center gap-3 text-primary">
            <LocalIcon name="ph:plus-circle-bold" className="text-3xl" />
            <h1 className="font-heading text-3xl font-black">פענוח הזמנה מוואטסאפ</h1>
          </div>
          <p className="mt-2 text-sm font-bold text-muted-foreground">ה־AI לא שומר, לא מאשר ולא מתמחר. הוא מציע פענוח לבדיקה שלך.</p>
        </header>

        <ReviewSection title="הודעת הלקוח">
          <label className="sr-only" htmlFor="review-message">הודעת הלקוח</label>
          <textarea
            id="review-message"
            value={message}
            maxLength={6000}
            onChange={(event) => {
              setMessage(event.currentTarget.value)
              setReview(null)
              setReviewContext(null)
              setAppliedDraft(null)
              if (status === 'error') setStatus('idle')
            }}
            className="min-h-40 w-full resize-y rounded-2xl border border-border bg-background px-4 py-3 text-sm font-bold text-primary outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="מדביקים את ההודעה המלאה..."
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs font-bold text-muted-foreground" dir="ltr">{message.length}/6000</span>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => { void requestReview() }}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-primary px-7 text-sm font-black text-primary-foreground hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60"
            >
              <LocalIcon name="ph:arrow-counter-clockwise-bold" className={isBusy ? 'animate-spin text-lg' : 'text-lg'} />
              <span>{status === 'loading' ? 'מפענחת את ההודעה' : status === 'checking' ? 'בודקת שהנתונים עדכניים' : review ? 'פענוח מחדש' : 'פענוח ההזמנה'}</span>
            </button>
          </div>
          {status === 'error' && <p role="alert" className="mt-4 rounded-2xl bg-rose-50 p-4 text-sm font-black text-destructive">{errorMessage}</p>}
        </ReviewSection>

        {review && (
          <>
            <section className="rounded-2xl border border-border bg-secondary p-4 text-xs font-black text-primary" role="status">
              רמת ביטחון כללית: {confidenceLabel(review.overallConfidence)}. גם בביטחון גבוה חייבים לעבור על כל השורות.
            </section>

            <ReviewSection title="מה זוהה בהודעה">
              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-xs font-black text-muted-foreground">שם</dt><dd className="font-bold">{review.draft.customerName ?? 'לא זוהה'}</dd></div>
                <div><dt className="text-xs font-black text-muted-foreground">טלפון</dt><dd className="font-bold">{review.draft.customerPhone ?? 'לא זוהה'}</dd></div>
                <div><dt className="text-xs font-black text-muted-foreground">תאריך ושעה</dt><dd className="font-bold">{[review.draft.serviceDate, review.draft.serviceTime].filter(Boolean).join(' · ') || 'לא זוהה'}</dd></div>
                <div><dt className="text-xs font-black text-muted-foreground">מסירה</dt><dd className="font-bold">{review.draft.fulfillmentMethod === 'pickup' ? 'איסוף עצמי' : review.draft.fulfillmentMethod === 'delivery' ? review.draft.deliveryLocation ?? 'משלוח — יעד חסר' : 'לא ברור'}</dd></div>
              </dl>
              {review.draft.items.length > 0 ? (
                <FindingList rows={review.draft.items.map((item) => ({ primary: `${item.catalogItemName} — ${item.quantity ?? 'כמות חסרה'}`, secondary: `מקור: „${item.sourceText}” · ביטחון ${confidenceLabel(item.confidence)}` }))} />
              ) : <p className="text-sm font-bold text-muted-foreground">לא זוהו מנות מהתפריט.</p>}
            </ReviewSection>

            {review.corrections.length > 0 && <ReviewSection title="תיקונים שזוהו"><FindingList rows={review.corrections.map((item) => ({ primary: `מ„${item.originalText}” ל„${item.correctedText}”`, secondary: item.reason }))} /></ReviewSection>}

            {review.paidExtras.length > 0 && <ReviewSection title="תוספות בתשלום שזוהו" tone="warning"><FindingList rows={review.paidExtras.map((item) => ({ primary: `${item.catalogItemName} ×${item.quantity ?? 'כמות חסרה'}${item.catalogPrice === null ? '' : ` · ${item.catalogPrice.toFixed(2)} ${item.currency ?? ''}`}`, secondary: item.reason }))} /></ReviewSection>}

            {(review.ambiguities.length > 0 || review.missingFields.length > 0) && (
              <ReviewSection title="מה צריך לברר עם הלקוח" tone="question">
                <FindingList rows={[
                  ...review.ambiguities.map((item) => ({ primary: item.question, secondary: `מקור: „${item.sourceText}”` })),
                  ...review.missingFields.map((item) => ({ primary: item.reason, secondary: item.sourceText ? `מקור: „${item.sourceText}”` : undefined })),
                ]} />
              </ReviewSection>
            )}

            {review.unknownItems.length > 0 && <ReviewSection title="דברים שלא נמצאו בתפריט" tone="warning"><FindingList rows={review.unknownItems.map((item) => ({ primary: `„${item.sourceText}”${item.requestedQuantity === null ? '' : ` ×${item.requestedQuantity}`}`, secondary: item.reason }))} /></ReviewSection>}

            {review.warnings.length > 0 && <ReviewSection title="אזהרות נוספות" tone="warning"><FindingList rows={review.warnings.map((item) => ({ primary: item.message, secondary: item.severity === 'warning' ? 'דורש בדיקה' : 'מידע' }))} /></ReviewSection>}

            {appliedDraft && <DraftPreview draft={appliedDraft} />}
          </>
        )}
      </div>

      <footer className="fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-card/95 p-4 backdrop-blur md:right-64 md:bottom-0">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-black text-muted-foreground">שום דבר לא נשמר במסד הנתונים</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => navigate(APP_ROUTES.newOrder)} className="min-h-11 rounded-full border border-border px-5 text-sm font-black text-primary hover:bg-secondary">ביטול</button>
            {!appliedDraft ? (
              <button type="button" disabled={!review || isBusy} onClick={() => { void applyReview() }} className="min-h-11 rounded-full bg-primary px-7 text-sm font-black text-primary-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground">החלה על טיוטה בזיכרון</button>
            ) : (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => { void continueToEditor() }}
                className="min-h-11 rounded-full bg-primary px-7 text-sm font-black text-primary-foreground hover:bg-primary/90"
              >מעבר לטופס והשלמה ידנית</button>
            )}
          </div>
        </div>
      </footer>
    </div>
  )
}

export default OrderImportReviewScreen
