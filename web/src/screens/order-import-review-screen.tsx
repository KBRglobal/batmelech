import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { z } from 'zod'
import { APP_ROUTES } from '../app/routes.ts'
import { LocalIcon } from '../components/local-icon.tsx'
import { readWhatsAppExportFile } from '../domain/whatsapp-export-file.ts'
import { ScreenState } from '../components/screen-state.tsx'
import { useStore } from '../data/use-store.ts'
import {
  AIReviewSchema,
  applyAIReviewToDraft,
  applyHotelDestinationInput,
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

const MAX_CONVERSATION_LENGTH = 24000
const AIResponseSchema = z.object({
  review: AIReviewSchema,
  conversation: z.string().trim().min(1).max(MAX_CONVERSATION_LENGTH).optional(),
}).strict()

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
const BM1_LUNCH_SELECTION = z.object({
  q: BM1_SELECTED_COUNT,
  v: BM1_TEXT,
  sides: z.record(z.string().min(1).max(300), BM1_SELECTED_COUNT),
  addon: BM1_COUNT,
}).strict()
const HIDDEN_BM1_PREFIX = '\u2060\u200b\u200c'
const HIDDEN_BM1_SUFFIX = '\u2060\u200c\u200b'
const HIDDEN_BM1_ALPHABET = ['\u200b', '\u200c', '\u200d', '\u2060'] as const
const HIDDEN_BM1_VALUES = new Map<string, number>(HIDDEN_BM1_ALPHABET.map((character, index) => [character, index]))
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
  lunch: z.record(z.string().min(1).max(100), BM1_LUNCH_SELECTION).default({}),
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

// A follow-up message pasted onto an EXISTING order (the "add 2 challahs and
// change to 15:00" flow): the editor sends its order id along with the base
// draft, and the reviewed result goes back to that order's edit screen.
function initialFollowUpOrderId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const id = (value as { followUpOrderId?: unknown }).followUpOrderId
  return typeof id === 'string' && id.trim() !== '' ? id.trim() : null
}

function normalizedPhoneDigits(value: unknown): string {
  if (typeof value !== 'string') return ''
  const digits = value.replace(/\D+/gu, '')
  if (digits.length < 7) return ''
  return digits.slice(-9)
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

function decodeBM1Lunch(
  values: Readonly<Record<string, z.infer<typeof BM1_LUNCH_SELECTION>>>,
  menu: ReturnType<typeof buildOrderEditorMenu>,
): OrderDraft['lunch'] {
  const menuByKey = new Map(menu.lunch.map((item) => [item.key, item]))
  const allowedSides = new Set(menu.lunchSides)
  return Object.fromEntries(Object.entries(values).map(([key, selection]) => {
    const item = menuByKey.get(key)
    if (!item) throw new Error('BM1_UNKNOWN_ITEM')
    const variantKey = selection.v || item.variants[0]?.key || ''
    if (
      (item.variants.length > 0 && !item.variants.some((variant) => variant.key === variantKey)) ||
      (item.variants.length === 0 && variantKey !== '') ||
      Object.keys(selection.sides).some((name) => !item.sideChoice || !allowedSides.has(name)) ||
      (selection.addon > 0 && item.addon === null)
    ) throw new Error('BM1_UNKNOWN_ITEM')
    return [key, {
      quantity: selection.q,
      variantKey,
      sides: structuredClone(selection.sides),
      addonQuantity: selection.addon,
      note: '',
    }]
  }))
}

function decodeBM1Draft(
  message: string,
  menu: ReturnType<typeof buildOrderEditorMenu>,
): OrderDraft | null {
  const markerPresent = message.includes('#BM1#') || message.includes(HIDDEN_BM1_PREFIX)
  const visibleMatch = /#BM1#([A-Za-z0-9+/=]{1,12000})#/u.exec(message)
  let encoded = visibleMatch?.[1] ?? null
  if (encoded === null) {
    const hiddenStart = message.indexOf(HIDDEN_BM1_PREFIX)
    const hiddenEnd = hiddenStart < 0 ? -1 : message.indexOf(HIDDEN_BM1_SUFFIX, hiddenStart + HIDDEN_BM1_PREFIX.length)
    if (hiddenStart >= 0 && hiddenEnd > hiddenStart) {
      const hidden = message.slice(hiddenStart + HIDDEN_BM1_PREFIX.length, hiddenEnd)
      if (hidden.length > 0 && hidden.length % 3 === 0) {
        let decoded = ''
        for (let index = 0; index < hidden.length; index += 3) {
          const high = HIDDEN_BM1_VALUES.get(hidden[index]!)
          const middle = HIDDEN_BM1_VALUES.get(hidden[index + 1]!)
          const low = HIDDEN_BM1_VALUES.get(hidden[index + 2]!)
          if (high === undefined || middle === undefined || low === undefined) {
            decoded = ''
            break
          }
          decoded += 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='[(high << 4) | (middle << 2) | low]
        }
        encoded = decoded || null
      }
    }
  }
  if (encoded === null) {
    if (markerPresent) throw new Error('BM1_INVALID')
    return null
  }
  try {
    const binary = atob(encoded)
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
    const lunch = decodeBM1Lunch(parsed.lunch, menu)
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
      salads: Object.fromEntries(Object.entries(parsed.salads).map(([name, ordered]) => [name, { ordered, gift: 0, note: '' }])),
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
      lunch,
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
    if (target.kind === 'lunch') {
      const selection = draft.lunch[target.key]
      return selection && selection.variantKey === target.variantKey ? selection.quantity : 0
    }
    if (target.kind === 'lunch-addon') return draft.lunch[target.key]?.addonQuantity ?? 0
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
  const followUpOrderId = initialFollowUpOrderId(location.state)
  const [message, setMessage] = useState(() => initialMessage(location.state))
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
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
    let reviewedDraft = context.exactDraft ?? applyAIReviewToDraft(
      context.baseDraft,
      review,
      context.targetsById,
      context.menu,
    )
    let reviewedForHandoff = review
    // Returning-customer memory: a known phone fills the name and hotel from
    // the previous visit, and says so — never silently.
    if (!followUpOrderId && !context.exactDraft) {
      const phoneKey = normalizedPhoneDigits(reviewedDraft.phone)
      if (phoneKey !== '' && refreshed.data) {
        const pastOrders = (refreshed.data.data.orders ?? []).filter(
          (order) => normalizedPhoneDigits(order.phone) === phoneKey,
        )
        const lastKnown = pastOrders[pastOrders.length - 1]
        if (lastKnown) {
          const filled: string[] = []
          if (!reviewedDraft.name.trim() && typeof lastKnown.name === 'string' && lastKnown.name.trim() !== '') {
            reviewedDraft = { ...reviewedDraft, name: lastKnown.name.trim() }
            filled.push('שם')
          }
          const knownPlace = typeof lastKnown.place === 'string' && lastKnown.place.trim() !== ''
            ? lastKnown.place.trim()
            : typeof lastKnown.hotelName === 'string' && lastKnown.hotelName.trim() !== ''
              ? lastKnown.hotelName.trim()
              : ''
          if (!reviewedDraft.pickup && !reviewedDraft.place.trim() && !reviewedDraft.address.trim() && knownPlace !== '') {
            reviewedDraft = applyHotelDestinationInput(reviewedDraft, knownPlace)
            filled.push('מלון')
          }
          if (filled.length > 0 && review.warnings.length < 100) {
            reviewedForHandoff = AIReviewSchema.parse({
              ...review,
              warnings: [
                ...review.warnings,
                {
                  code: 'other',
                  severity: 'warning',
                  message: `לקוח/ה מוכר/ה לפי הטלפון — הושלמו מהביקור הקודם: ${filled.join(', ')}. צריך לוודא שזה עדיין נכון.`,
                },
              ],
            })
          }
        }
      }
    }
    navigate(
      followUpOrderId
        ? APP_ROUTES.editOrder.replace(':orderId', encodeURIComponent(followUpOrderId))
        : APP_ROUTES.newOrder,
      {
        state: {
          review: reviewedForHandoff,
          reviewedCatalogSignature: context.catalogSignature,
          reviewedRevision: context.revision,
          reviewedHash: context.hash,
          reviewedTs: context.ts,
          reviewedStateSignature: context.stateSignature,
          reviewedDraft,
          reviewedMessage,
        },
      },
    )
  }

  const requestReview = async () => {
    const normalizedMessage = message.trim()
    if (!normalizedMessage && !imageDataUrl) {
      setStatus('error')
      setErrorMessage('הדביקי את הודעת הלקוח, או העלי קובץ ייצוא שיחה או צילום מסך.')
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
      const exactDraft = imageDataUrl ? null : decodeBM1Draft(normalizedMessage, menu)
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
        body: JSON.stringify(
          imageDataUrl
            ? { image: imageDataUrl, catalog: catalog.items }
            : { message: normalizedMessage, catalog: catalog.items },
        ),
      })
      if (!response.ok) throw new AIReviewHttpError(await safeAIHttpErrorMessage(response))
      const parsed = AIResponseSchema.safeParse(await response.json())
      if (!parsed.success) throw new Error('INVALID_RESPONSE')
      // The server returns the cleaned transcript it actually reviewed (an
      // exported chat stripped of timestamps, or the text read out of a
      // screenshot) — that transcript is what the editor must show.
      const reviewedConversation = parsed.data.conversation ?? normalizedMessage
      if (!reviewedConversation) throw new Error('INVALID_RESPONSE')
      await handoffReview(parsed.data.review, requestedContext, reviewedConversation)
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
            <LocalIcon name={followUpOrderId ? 'ph:arrows-clockwise-bold' : 'ph:plus-circle-bold'} className="text-3xl" />
            <h1 className="font-heading text-3xl font-black">{followUpOrderId ? 'הודעת המשך על הזמנה קיימת' : 'בניית הזמנה מהודעת וואטסאפ'}</h1>
          </div>
          <p className="mt-2 text-sm font-bold text-muted-foreground">
            {followUpOrderId
              ? 'מדביקים את ההודעה החדשה מהלקוח — המערכת תציע רק את השינויים על ההזמנה הקיימת. שום דבר לא נשמר עד שמירה בטופס.'
              : 'אפשר להדביק הודעה או שיחה שלמה, להעלות קובץ ייצוא שיחה מוואטסאפ, או צילום מסך. שום דבר לא נשמר עד שמירה בטופס.'}
          </p>
        </header>

        <section className="rounded-[2rem] border border-border bg-card p-5 text-primary shadow-sm sm:p-6">
          <h2 className="border-b border-border pb-3 text-sm font-black">הודעת הלקוח</h2>
          <div className="mt-4">
            <label className="sr-only" htmlFor="review-message">הודעת הלקוח</label>
            <textarea
              id="review-message"
              value={message}
              maxLength={MAX_CONVERSATION_LENGTH}
              onChange={(event) => {
                setMessage(event.currentTarget.value)
                if (status === 'error') setStatus('idle')
              }}
              className="min-h-40 w-full resize-y rounded-2xl border border-border bg-background px-4 py-3 text-sm font-bold text-primary outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="מדביקים את ההודעה המלאה..."
            />
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-2xl border border-border bg-background px-4 text-xs font-black text-primary hover:bg-secondary">
                <LocalIcon name="ph:file-text-bold" className="text-lg" />
                <span>קובץ ייצוא שיחה (txt / zip)</span>
                <input
                  type="file"
                  accept=".txt,.zip,text/plain,application/zip,application/x-zip-compressed"
                  className="sr-only"
                  disabled={isBusy}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0]
                    event.currentTarget.value = ''
                    if (!file) return
                    void readWhatsAppExportFile(file, MAX_CONVERSATION_LENGTH).then((result) => {
                      if ('error' in result) {
                        setErrorMessage(
                          result.error === 'not_chat_export'
                            ? 'לא נמצא קובץ שיחה בקובץ שהועלה — מייצאים מוואטסאפ עם "ייצוא צ׳אט"'
                            : 'לא הצלחנו לקרוא את הקובץ — אפשר לנסות שוב או להדביק את הטקסט',
                        )
                        setStatus('error')
                        return
                      }
                      setImageDataUrl(null)
                      setMessage(result.text)
                      if (result.trimmed) {
                        setErrorMessage('השיחה ארוכה — נלקחו ההודעות האחרונות (שם נמצאת ההזמנה)')
                        setStatus('error')
                      } else {
                        setStatus('idle')
                      }
                    })
                  }}
                />
              </label>
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-2xl border border-border bg-background px-4 text-xs font-black text-primary hover:bg-secondary">
                <LocalIcon name="ph:image-bold" className="text-lg" />
                <span>צילום מסך של השיחה</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  disabled={isBusy}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0]
                    event.currentTarget.value = ''
                    if (!file) return
                    const reader = new FileReader()
                    reader.onload = () => {
                      if (typeof reader.result === 'string' && reader.result.startsWith('data:image/')) {
                        setImageDataUrl(reader.result)
                        setStatus('idle')
                      }
                    }
                    reader.readAsDataURL(file)
                  }}
                />
              </label>
              {imageDataUrl && (
                <span className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-secondary px-4 text-xs font-black text-primary">
                  <img src={imageDataUrl} alt="צילום מסך שהועלה" className="h-8 w-8 rounded-lg object-cover" />
                  <span>צילום מסך מוכן לפענוח</span>
                  <button type="button" aria-label="הסרת צילום המסך" disabled={isBusy} onClick={() => setImageDataUrl(null)} className="text-destructive">
                    <LocalIcon name="ph:x-circle-bold" className="text-lg" />
                  </button>
                </span>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-bold text-muted-foreground" dir="ltr">{message.length}/24000</span>
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
          <button
            type="button"
            disabled={isBusy}
            onClick={() => navigate(
              followUpOrderId
                ? APP_ROUTES.editOrder.replace(':orderId', encodeURIComponent(followUpOrderId))
                : APP_ROUTES.newOrder,
            )}
            className="min-h-11 rounded-full border border-border px-5 text-sm font-black text-primary hover:bg-secondary disabled:cursor-wait disabled:opacity-60"
          >ביטול</button>
        </div>
      </footer>
    </div>
  )
}

export default OrderImportReviewScreen
