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

const AIErrorCodeSchema = z.enum([
  'ai_rate_limited',
  'ai_not_configured',
  'ai_refused',
  'invalid_ai_response',
  'ai_provider_error',
  'invalid_request',
  'request_too_large',
])
const AIErrorResponseSchema = z.object({
  error: z.object({
    code: AIErrorCodeSchema,
    message: z.string().max(1000),
  }).strict(),
}).strict()

const GENERIC_AI_ERROR_MESSAGE = 'לא הצלחנו לקבל פענוח תקין. ההזמנה לא שונתה ואפשר לנסות שוב.'

const AI_ERROR_MESSAGES = {
  ai_rate_limited: {
    status: 429,
    message: 'בוצעו יותר מדי ניסיונות פענוח בזמן קצר. ההזמנה לא שונתה ואפשר לנסות שוב בעוד כמה דקות.',
  },
  ai_not_configured: {
    status: 503,
    message: 'שירות פענוח ההזמנות אינו זמין כרגע. ההזמנה לא שונתה.',
  },
  ai_refused: {
    status: 422,
    message: 'ה־AI לא הצליח לפענח את ההודעה הזאת בבטחה. ההזמנה לא שונתה ואפשר לערוך את ההודעה או להקליד ידנית.',
  },
  invalid_ai_response: {
    status: 502,
    message: 'ה־AI החזיר פענוח שלא עבר את בדיקות הבטיחות. ההזמנה לא שונתה ואפשר לנסות שוב.',
  },
  ai_provider_error: {
    status: 502,
    message: 'שירות ה־AI לא הגיב בצורה תקינה כרגע. ההזמנה לא שונתה ואפשר לנסות שוב.',
  },
  invalid_request: {
    status: 400,
    message: 'הודעת ההזמנה או התפריט שנשלחו לפענוח אינם תקינים. ההזמנה לא שונתה.',
  },
  request_too_large: {
    status: 413,
    message: 'הודעת ההזמנה ארוכה מדי לפענוח. ההזמנה לא שונתה; צריך לקצר אותה ולנסות שוב.',
  },
} satisfies Record<z.infer<typeof AIErrorCodeSchema>, { readonly status: number; readonly message: string }>

class AIReviewHttpError extends Error {
  readonly displayMessage: string

  constructor(displayMessage: string) {
    super('AI_REVIEW_HTTP_ERROR')
    this.name = 'AIReviewHttpError'
    this.displayMessage = displayMessage
  }
}

async function safeAIHttpErrorMessage(response: Response): Promise<string> {
  try {
    const parsed = AIErrorResponseSchema.safeParse(await response.json())
    if (!parsed.success) return GENERIC_AI_ERROR_MESSAGE
    const mapped = AI_ERROR_MESSAGES[parsed.data.error.code]
    return response.status === mapped.status ? mapped.message : GENERIC_AI_ERROR_MESSAGE
  } catch {
    return GENERIC_AI_ERROR_MESSAGE
  }
}

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

function displaySafeReviewedMessage(message: string, isBM1: boolean): string {
  if (!isBM1) return message
  const withoutPayload = message.replace(/#BM1#[A-Za-z0-9+/=]{1,12000}#/gu, '').trim()
  return withoutPayload || 'הזמנה מובנית מטופס הלקוח'
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

export function OrderImportReviewScreen() {
  const storeQuery = useStore()
  const location = useLocation()
  const navigate = useNavigate()
  const baseDraftInput = initialBaseDraft(location.state)
  const [message, setMessage] = useState(() => initialMessage(location.state))
  const [status, setStatus] = useState<'idle' | 'loading' | 'checking' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  if (storeQuery.isPending) return <ScreenState kind="loading" title="טוענת את תפריט ההזמנות" />
  if (storeQuery.isError) return <ScreenState kind="error" title="לא הצלחנו לטעון את התפריט" retry={() => { void storeQuery.refetch() }} />

  const handoffReview = async (
    review: AIReview,
    context: ReviewContext,
    reviewedMessage: string,
  ) => {
    setStatus('checking')
    const refreshed = await storeQuery.refetch({ throwOnError: true })
    if (
      refreshed.isError ||
      refreshed.isRefetchError ||
      refreshed.error ||
      !refreshed.data ||
      !isVersionedStateEnvelope(refreshed.data)
    ) {
      throw new Error('UNVERSIONED_STATE')
    }
    const freshMenu = buildOrderEditorMenu(refreshed.data.data)
    const freshCatalog = buildAIOrderCatalog(freshMenu)
    if (
      !contextMatchesEnvelope(context, refreshed.data) ||
      catalogSignature(freshCatalog.items) !== context.catalogSignature
    ) {
      throw new Error('CHANGED_STATE')
    }
    const reviewedDraft = context.exactDraft ?? applyAIReviewToDraft(
      context.baseDraft,
      review,
      context.targetsById,
      context.menu,
    )
    navigate(APP_ROUTES.newOrder, {
      state: {
        review,
        reviewedCatalogSignature: context.catalogSignature,
        reviewedRevision: context.revision,
        reviewedHash: context.hash,
        reviewedTs: context.ts,
        reviewedStateSignature: context.stateSignature,
        reviewedDraft,
        reviewedMessage,
      },
    })
  }

  const requestReview = async () => {
    const normalizedMessage = message.trim()
    if (!normalizedMessage) {
      setStatus('error')
      setErrorMessage('הדביקי קודם את הודעת הלקוח.')
      return
    }
    setStatus('loading')
    setErrorMessage('')
    try {
      const refreshed = await storeQuery.refetch({ throwOnError: true })
      if (
        refreshed.isError ||
        refreshed.isRefetchError ||
        refreshed.error ||
        !refreshed.data ||
        !isVersionedStateEnvelope(refreshed.data)
      ) throw new Error('UNVERSIONED_STATE')
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
        await handoffReview(
          exactReview(exactDraft, catalog),
          requestedContext,
          displaySafeReviewedMessage(normalizedMessage, true),
        )
        return
      }
      const response = await fetch('/api/ai/order-intake/', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ message: normalizedMessage, catalog: catalog.items }),
      })
      if (!response.ok) throw new AIReviewHttpError(await safeAIHttpErrorMessage(response))
      const parsed = AIResponseSchema.safeParse(await response.json())
      if (!parsed.success) throw new Error('INVALID_RESPONSE')
      await handoffReview(parsed.data.review, requestedContext, normalizedMessage)
    } catch (error) {
      setStatus('error')
      setErrorMessage(
        error instanceof AIReviewHttpError
          ? error.displayMessage
          : error instanceof Error && error.message === 'BM1_UNKNOWN_ITEM'
          ? 'קוד ההזמנה כולל פריט שאינו קיים בתפריט הנוכחי. שום פריט לא הוחל וצריך לבדוק את ההודעה ידנית.'
          : error instanceof Error && (error.message === 'BM1_INVALID' || error.message === 'INVALID_BASE_DRAFT')
            ? 'קוד ההזמנה או הטיוטה הקודמת אינם תקינים. שום דבר לא הוחל כדי לא לאבד פריטים.'
            : error instanceof Error && error.message === 'CHANGED_STATE'
              ? 'הנתונים או התפריט השתנו בזמן הפענוח. צריך לפענח שוב כדי שלא תחול מנה או כמות לא נכונה.'
            : GENERIC_AI_ERROR_MESSAGE,
      )
    }
  }

  const isBusy = status === 'loading' || status === 'checking'

  return (
    <div className="pb-28" dir="rtl">
      <div className="mx-auto max-w-5xl space-y-7 px-5 py-8 sm:px-8 sm:py-10">
        <header>
          <div className="flex items-center gap-3 text-primary">
            <LocalIcon name="ph:plus-circle-bold" className="text-3xl" />
            <h1 className="font-heading text-3xl font-black">בניית הזמנה מהודעת וואטסאפ</h1>
          </div>
          <p className="mt-2 text-sm font-bold text-muted-foreground">המערכת בונה טופס הזמנה מלא מההודעה. שום דבר לא נשמר עד שמירה בטופס.</p>
        </header>

        <section className="rounded-[2rem] border border-border bg-card p-5 text-primary shadow-sm sm:p-6">
          <h2 className="border-b border-border pb-3 text-sm font-black">הודעת הלקוח</h2>
          <div className="mt-4">
            <label className="sr-only" htmlFor="review-message">הודעת הלקוח</label>
            <textarea
              id="review-message"
              value={message}
              maxLength={6000}
              onChange={(event) => {
                setMessage(event.currentTarget.value)
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
                <span>{status === 'loading' ? 'בונה את טופס ההזמנה' : status === 'checking' ? 'מוודאת שהתפריט עדכני' : 'בניית טופס ההזמנה'}</span>
              </button>
            </div>
            {status === 'error' && <p role="alert" className="mt-4 rounded-2xl bg-rose-50 p-4 text-sm font-black text-destructive">{errorMessage}</p>}
          </div>
        </section>

      </div>

      <footer className="fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-card/95 p-4 backdrop-blur md:right-64 md:bottom-0">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-black text-muted-foreground">שום דבר לא נשמר עד שמירה בטופס</p>
          <button type="button" disabled={isBusy} onClick={() => navigate(APP_ROUTES.newOrder)} className="min-h-11 rounded-full border border-border px-5 text-sm font-black text-primary hover:bg-secondary disabled:cursor-wait disabled:opacity-60">ביטול</button>
        </div>
      </footer>
    </div>
  )
}

export default OrderImportReviewScreen
