import { useMemo, useState } from 'react'
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
  type AIReview,
  type OrderDraft,
} from '../domain/order-editor.ts'

const AIResponseSchema = z.object({ review: AIReviewSchema }).strict()

function initialMessage(value: unknown): string {
  if (typeof value !== 'object' || value === null) return ''
  const message = (value as { message?: unknown }).message
  return typeof message === 'string' ? message : ''
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
  const [message, setMessage] = useState(() => initialMessage(location.state))
  const [review, setReview] = useState<AIReview | null>(null)
  const [appliedDraft, setAppliedDraft] = useState<OrderDraft | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const store = storeQuery.data?.data ?? null
  const menu = useMemo(() => buildOrderEditorMenu(store ?? { orders: [] }), [store])
  const catalog = useMemo(() => buildAIOrderCatalog(menu), [menu])

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
    setAppliedDraft(null)
    try {
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
      setStatus('idle')
    } catch {
      setStatus('error')
      setErrorMessage('לא הצלחנו לקבל פענוח תקין. ההזמנה לא שונתה ואפשר לנסות שוב.')
    }
  }

  const applyReview = () => {
    if (!review) return
    setAppliedDraft(
      applyAIReviewToDraft(createOrderDraft(menu), review, catalog.targetsById),
    )
  }

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
              disabled={status === 'loading'}
              onClick={() => { void requestReview() }}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-primary px-7 text-sm font-black text-primary-foreground hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60"
            >
              <LocalIcon name="ph:arrow-counter-clockwise-bold" className={status === 'loading' ? 'animate-spin text-lg' : 'text-lg'} />
              <span>{status === 'loading' ? 'מפענחת את ההודעה' : review ? 'פענוח מחדש' : 'פענוח ההזמנה'}</span>
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

      <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 p-4 backdrop-blur md:right-64">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-black text-muted-foreground">שום דבר לא נשמר במסד הנתונים</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => navigate(APP_ROUTES.newOrder)} className="min-h-11 rounded-full border border-border px-5 text-sm font-black text-primary hover:bg-secondary">ביטול</button>
            {!appliedDraft ? (
              <button type="button" disabled={!review || status === 'loading'} onClick={applyReview} className="min-h-11 rounded-full bg-primary px-7 text-sm font-black text-primary-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground">החלה על טיוטה בזיכרון</button>
            ) : (
              <button type="button" onClick={() => navigate(APP_ROUTES.newOrder, { state: { review } })} className="min-h-11 rounded-full bg-primary px-7 text-sm font-black text-primary-foreground hover:bg-primary/90">מעבר לטופס והשלמה ידנית</button>
            )}
          </div>
        </div>
      </footer>
    </div>
  )
}

export default OrderImportReviewScreen
