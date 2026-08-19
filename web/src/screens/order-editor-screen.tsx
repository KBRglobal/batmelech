import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { APP_ROUTES } from '../app/routes.ts'
import { LocalIcon } from '../components/local-icon.tsx'
import { readWhatsAppExportFile } from '../domain/whatsapp-export-file.ts'
import { ScreenState } from '../components/screen-state.tsx'
import {
  createVersionedRequestId,
  prepareVersionedStateChange,
  useVersionedStateMutation,
  type PreparedVersionedStateChange,
} from '../data/use-save-order.ts'
import { useStore } from '../data/use-store.ts'
import {
  AIReviewSchema,
  CANONICAL_ORDER_ID_PATTERN,
  HOTEL_OPTIONS,
  applyAIReviewToDraft,
  applyCoupleMealQuantity,
  applyHotelDestinationInput,
  applyHotelNavigationInput,
  applyHotelSelection,
  buildAIOrderCatalog,
  buildOrderEditorMenu,
  calculateOrderDraftPricing,
  demotePriceAvailabilityIssues,
  hasValidManualTotal,
  classifyStoredOrderIds,
  classifyDraftSelectionMode,
  createCanonicalOrderId,
  createDuplicateOrderDraft,
  createOrderDraft,
  createOrderDraftFromLegacy,
  DELIVERY_ZONE_OPTIONS,
  formatUsdInputMinorUnits,
  parseUsdInputMinorUnits,
  applyOrderDraftToStore,
  deleteOrderFromStore,
  legacyOrderEditIssue,
  mergedLunchPlateSides,
  orderPricingFingerprint,
  readLunchPlates,
  resizeLunchPlates,
  resolveReviewItemQuantities,
  parseHotelSearchResponse,
  serializeOrderDraft,
  validateOrderDraft,
  type CustomDraftItem,
  type AIReview,
  type LunchDraftSelection,
  type LunchPlateDraft,
  type HotelSearchResult,
  type OrderDraft,
  type OrderEditorMenu,
} from '../domain/order-editor.ts'
import { deliveryProofSummary } from '../domain/delivery-dashboard.ts'
import {
  MAX_PLATA_NOTE_LENGTH,
  PLATA_STATUSES,
  PLATA_STATUS_LABELS,
  PLATA_STEPPER_MAX,
  applyPlataToStore,
  isPlataFormValid,
  plataFormValues,
  type PlataFormValues,
  type PlataStatus,
} from '../domain/plata.ts'
import type { LegacyOrder, LegacyStore } from '../domain/store.ts'
import { formatUsdMinorUnits } from '../domain/today-dashboard.ts'
import { isVersionedStateEnvelope, type VersionedStateEnvelope } from '../services/state-api.ts'

const STATUS_OPTIONS = ['מתעניין', 'חדשה', 'אושרה', 'מוכנה', 'במשלוח', 'נמסרה', 'בוטלה'] as const
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
  ['proof', 'אישור מסירה'],
  ['plata', 'פלטה'],
] as const

const inputClassName =
  'min-h-11 w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm font-bold text-primary outline-none focus:ring-2 focus:ring-primary/20'

type SaveFeedback =
  | { readonly kind: 'idle' }
  | { readonly kind: 'network-error'; readonly message: string }
  | { readonly kind: 'conflict'; readonly message: string }
  | { readonly kind: 'blocked'; readonly message: string }

interface SaveAttempt {
  readonly draftSignature: string
  readonly change: PreparedVersionedStateChange
}

function isExactEnvelopeSnapshot(
  candidate: VersionedStateEnvelope,
  captured: VersionedStateEnvelope,
): boolean {
  return candidate.revision === captured.revision &&
    candidate.hash === captured.hash &&
    JSON.stringify(candidate.data) === JSON.stringify(captured.data)
}

function currentCatalogSignature(menu: OrderEditorMenu): string {
  return JSON.stringify(buildAIOrderCatalog(menu).items)
}

function hasReviewHandoffState(value: unknown): boolean {
  return typeof value === 'object' && value !== null &&
    ['reviewedMessage', 'review', 'reviewedDraft'].some((key) => Object.hasOwn(value, key))
}

function recoverReviewedMessage(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !Object.hasOwn(value, 'reviewedMessage')) {
    return null
  }
  const reviewedMessage = (value as { reviewedMessage?: unknown }).reviewedMessage
  if (typeof reviewedMessage !== 'string') return null
  const trimmed = reviewedMessage.trim()
  return trimmed.length >= 1 && trimmed.length <= 24000 ? trimmed : null
}

function readReviewState(
  value: unknown,
  expectedCatalogSignature: string,
  expectedEnvelope: VersionedStateEnvelope,
  menu: OrderEditorMenu,
):
  | { readonly draft: OrderDraft | null; readonly review: AIReview; readonly sourceMessage: string | null }
  | null {
  if (typeof value !== 'object' || value === null) return null
  const state = value as {
    review?: unknown
    reviewedDraft?: unknown
    reviewedCatalogSignature?: unknown
    reviewedRevision?: unknown
    reviewedHash?: unknown
    reviewedTs?: unknown
    reviewedStateSignature?: unknown
    reviewedMessage?: unknown
  }
  if (
    state.reviewedCatalogSignature !== expectedCatalogSignature ||
    state.reviewedRevision !== expectedEnvelope.revision ||
    state.reviewedHash !== expectedEnvelope.hash ||
    state.reviewedTs !== expectedEnvelope.ts ||
    state.reviewedStateSignature !== JSON.stringify(expectedEnvelope.data)
  ) return null
  const sourceMessage = state.reviewedMessage === undefined
    ? null
    : typeof state.reviewedMessage === 'string' && state.reviewedMessage.trim().length >= 1 && state.reviewedMessage.trim().length <= 24000
      ? state.reviewedMessage.trim()
      : null
  if (state.reviewedMessage !== undefined && sourceMessage === null) return null
  const review = AIReviewSchema.safeParse(state.review)
  if (!review.success) return null
  if (Object.hasOwn(state, 'reviewedDraft')) {
    try {
      const stored = serializeOrderDraft(state.reviewedDraft as OrderDraft, 'reviewed-draft')
      return {
        draft: { ...createOrderDraftFromLegacy(stored, menu), id: null },
        review: review.data,
        sourceMessage,
      }
    } catch {
      return null
    }
  }
  return { draft: null, review: review.data, sourceMessage }
}

const MISSING_FIELD_LABELS: Record<AIReview['missingFields'][number]['field'], string> = {
  customer_name: 'חסר שם הלקוח',
  customer_phone: 'חסר מספר טלפון',
  service_date: 'חסר תאריך להזמנה',
  service_time: 'חסרה שעת מסירה או איסוף',
  fulfillment_method: 'צריך לאשר משלוח או איסוף עצמי',
  delivery_location: 'חסר יעד למשלוח',
  item_quantity: 'חסרה כמות לפריט',
  item_choice: 'חסרה בחירת מנה',
  other: 'חסר פרט להזמנה',
}

const WARNING_LABELS: Record<AIReview['warnings'][number]['code'], string> = {
  paid_extra: 'צריך לבדוק תוספת בתשלום שלא הותאמה להזמנה',
  quantity_missing: 'צריך לבדוק כמות שלא הושלמה בהזמנה',
  catalog_mismatch: 'צריך לבדוק בקשה שלא הותאמה לתפריט',
  ambiguous_intent: 'צריך לוודא למה הלקוח התכוון',
  missing_field: 'צריך להשלים פרט חסר בהזמנה',
  other: 'יש פרט נוסף שצריך לבדוק מול הודעת הלקוח',
}

interface ManagerFinding {
  readonly id: string
  readonly label: string
  readonly sourceText: string | null
}

function paidExtraPrice(price: number | null, currency: 'USD' | null): string | null {
  if (price === null) return null
  if (currency === 'USD') return `$${price.toFixed(2)}`
  return price.toFixed(2)
}

function recognizedReviewItems(review: AIReview, menu: OrderEditorMenu, currentMeals: number) {
  const catalog = buildAIOrderCatalog(menu)
  const currentCatalogById = new Map(catalog.items.map((item) => [item.id, item]))
  const resolvedQuantities = resolveReviewItemQuantities(review.draft.items, catalog.targetsById, currentMeals)
  return review.draft.items.flatMap((reviewItem) => {
    const catalogItem = currentCatalogById.get(reviewItem.catalogItemId)
    if (!catalogItem) return []
    // Show what will actually land in the order, not the raw AI quantity —
    // a selection with no stated digits still resolves via the meal
    // structure, so it must not read as "not applied".
    const resolvedQuantity = resolvedQuantities.get(reviewItem.catalogItemId) ?? reviewItem.quantity
    return [{ reviewItem: { ...reviewItem, quantity: resolvedQuantity }, catalogItem }]
  })
}

function recognizedPaidExtras(review: AIReview, menu: OrderEditorMenu) {
  const currentCatalogById = new Map(buildAIOrderCatalog(menu).items.map((item) => [item.id, item]))
  const draftItemById = new Map(review.draft.items.map((item) => [item.catalogItemId, item]))
  const reviewedExtraById = new Map(review.paidExtras.map((extra) => [extra.catalogItemId, extra]))
  const paidIds = new Set([
    ...review.draft.items.map((item) => item.catalogItemId),
    ...review.paidExtras.map((extra) => extra.catalogItemId),
  ])
  return [...paidIds].flatMap((id) => {
    const catalogItem = currentCatalogById.get(id)
    if (!catalogItem?.isPaidExtra) return []
    const draftItem = draftItemById.get(id)
    const reviewedExtra = reviewedExtraById.get(id)
    return [{
      catalogItem,
      quantity: draftItem?.quantity ?? reviewedExtra?.quantity ?? null,
      sourceText: reviewedExtra?.sourceText ?? draftItem?.sourceText ?? null,
    }]
  })
}

function managerFindings(review: AIReview, menu: OrderEditorMenu): readonly ManagerFinding[] {
  const missingQuantitySources = new Set(
    review.missingFields.flatMap((finding) =>
      finding.field === 'item_quantity' && finding.sourceText ? [finding.sourceText] : []),
  )
  const ambiguitySources = new Set(review.ambiguities.map((finding) => finding.sourceText))
  const selectionSources = new Set(
    review.draft.items.flatMap((item) =>
      ['salad', 'first', 'main', 'side', 'dessert', 'couple_meal', 'challahs'].includes(item.category)
        ? [item.sourceText]
        : []),
  )
  const paidExtras = recognizedPaidExtras(review, menu)
  const coveredWarningCodes = new Set<AIReview['warnings'][number]['code']>()
  if (paidExtras.length > 0) coveredWarningCodes.add('paid_extra')
  if (
    review.draft.items.some((item) => item.quantity === null) ||
    review.missingFields.some((finding) => finding.field === 'item_quantity') ||
    review.unknownItems.some((item) => item.requestedQuantity === null) ||
    paidExtras.some((item) => item.quantity === null)
  ) coveredWarningCodes.add('quantity_missing')
  if (review.unknownItems.length > 0) coveredWarningCodes.add('catalog_mismatch')
  if (review.ambiguities.length > 0) coveredWarningCodes.add('ambiguous_intent')
  if (review.missingFields.length > 0) coveredWarningCodes.add('missing_field')
  const warningFallbacks = new Map<AIReview['warnings'][number]['code'], ManagerFinding>()
  for (const warning of review.warnings) {
    if (
      warning.severity !== 'warning' ||
      warning.code === 'other' || // the vague catch-all was pure noise as a chore
      warningFallbacks.has(warning.code) ||
      coveredWarningCodes.has(warning.code)
    ) continue
    warningFallbacks.set(warning.code, {
      id: `warning:${warning.code}`,
      label: WARNING_LABELS[warning.code],
      sourceText: null,
    })
  }
  return [
    ...review.draft.items.flatMap((finding, index) => {
      // Couple-meal selections carry no quantity by nature — choosing the
      // dish is the whole statement, the meal structure sets the amounts.
      // Only standalone paid extras still deserve a quantity check.
      const selectionCategories = new Set(['salad', 'first', 'main', 'side', 'dessert', 'couple_meal', 'challahs'])
      if (finding.quantity !== null || selectionCategories.has(finding.category)) return []
      if (missingQuantitySources.has(finding.sourceText)) return []
      return [{
        id: `item-quantity:${index}`,
        label: `הוזן 1 — כדאי לוודא כמות עבור ${finding.catalogItemName}`,
        sourceText: finding.sourceText,
      }]
    }),
    // Customer self-corrections are already APPLIED by the model — they are
    // information, not work. Surfacing them as chores buried the real ones.

    ...review.ambiguities.flatMap((finding, index) => {
      // A one-candidate "ambiguity" whose candidate is already in the draft
      // is the model second-guessing itself — nothing for a human to close.
      if (
        finding.candidateCatalogItemIds.length === 1 &&
        review.draft.items.some((item) => item.catalogItemId === finding.candidateCatalogItemIds[0])
      ) return []
      return [{
        id: `ambiguity:${index}`,
        label: 'צריך לוודא לאיזו מנה הלקוח התכוון',
        sourceText: finding.sourceText,
      }]
    }),
    ...review.unknownItems.map((finding, index) => ({
      id: `unknown:${index}`,
      label: finding.requestedQuantity === null
        ? 'הפריט לא נמצא בתפריט'
        : `הפריט לא נמצא בתפריט · כמות ${finding.requestedQuantity}`,
      sourceText: finding.sourceText,
    })),
    ...review.missingFields.flatMap((finding, index) => {
      if (
        finding.sourceText && ambiguitySources.has(finding.sourceText) &&
        (finding.field === 'item_quantity' || finding.field === 'item_choice')
      ) return []
      // Selections resolved their own quantity from the meal structure —
      // a leftover item_quantity note about them is pure noise.
      if (finding.field === 'item_quantity' && finding.sourceText && selectionSources.has(finding.sourceText)) return []
      // A named hotel/address IS the delivery answer — nothing to confirm.
      if (finding.field === 'fulfillment_method' && review.draft.deliveryLocation !== null) return []
      return [{
        id: `missing:${index}`,
        label: MISSING_FIELD_LABELS[finding.field],
        sourceText: finding.sourceText,
      }]
    }),
    ...paidExtras.map((extra, index) => {
      const price = paidExtraPrice(extra.catalogItem.price, extra.catalogItem.currency)
      return {
        id: `paid-extra:${extra.catalogItem.id}:${index}`,
        label: `אישור תוספת בתשלום: ${extra.catalogItem.name} · ${extra.quantity ?? 'כמות חסרה'}${price ? ` · ${price}` : ''}`,
        sourceText: extra.sourceText,
      }
    }),
    ...warningFallbacks.values(),
  ]
}

function OrderManagerPanel({
  review,
  menu,
  currentMeals,
  sourceMessage,
  acknowledged,
  onToggleAcknowledged,
}: {
  readonly review: AIReview
  readonly menu: OrderEditorMenu
  readonly currentMeals: number
  readonly sourceMessage: string | null
  readonly acknowledged: ReadonlySet<string>
  readonly onToggleAcknowledged: (id: string) => void
}) {
  const findings = managerFindings(review, menu)
  const remaining = findings.filter((finding) => !acknowledged.has(finding.id)).length
  const recognizedItems = recognizedReviewItems(review, menu, currentMeals)
  const paidExtras = recognizedPaidExtras(review, menu)

  return (
    <section aria-label="מנהל ההזמנה מוואטסאפ" className="space-y-4 rounded-[2rem] border border-primary/20 bg-secondary p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3 text-primary">
          <LocalIcon name="ph:list-checks-bold" className="text-2xl" />
          <div>
            <h2 className="font-heading text-xl font-black">מנהל ההזמנה</h2>
            <p className="mt-1 text-xs font-bold text-muted-foreground">ההזמנה כבר פתוחה לעריכה. עברי על מה שנבנה וסגרי את הדברים שדורשים טיפול.</p>
          </div>
        </div>
        {findings.length > 0 && (
          <span className="rounded-full bg-card px-3 py-1 text-xs font-black text-primary">
            {remaining === 0 ? 'כל הבירורים טופלו' : `${remaining} לבירור`}
          </span>
        )}
      </div>

      {sourceMessage && (
        <details className="rounded-2xl border border-border bg-card p-4">
          <summary className="cursor-pointer text-sm font-black text-primary">הודעת הלקוח המקורית</summary>
          <blockquote className="mt-3 break-words whitespace-pre-wrap text-sm font-bold text-muted-foreground [overflow-wrap:anywhere]">{sourceMessage}</blockquote>
        </details>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-4">
          <h3 className="text-xs font-black text-muted-foreground">מה נכנס להזמנה</h3>
          {recognizedItems.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {recognizedItems.map(({ reviewItem, catalogItem }, index) => (
                <li key={`${catalogItem.id}-${index}`} className="text-sm font-bold text-primary">
                  <span>{catalogItem.name} · {reviewItem.quantity ?? 'לא הוחל · חסרה כמות'}</span>
                  <q className="mt-1 block break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">{reviewItem.sourceText}</q>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs font-bold text-muted-foreground">לא זוהו בחירות מהתפריט.</p>
          )}
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
          <h3 className="text-xs font-black">תוספות בתשלום</h3>
          {paidExtras.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {paidExtras.map(({ sourceText, quantity, catalogItem }, index) => (
                <li key={`${catalogItem.id}-${index}`} className="text-sm font-bold">
                  <span>{catalogItem.name} · {quantity ?? 'כמות חסרה'}{paidExtraPrice(catalogItem.price, catalogItem.currency) ? ` · ${paidExtraPrice(catalogItem.price, catalogItem.currency)}` : ''}</span>
                  <q className="mt-1 block break-words text-xs [overflow-wrap:anywhere]">{sourceText}</q>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs font-bold">לא זוהו תוספות בתשלום.</p>
          )}
        </div>
      </div>

      {findings.length > 0 && (
        <div>
          <h3 className="text-sm font-black text-primary">מה עדיין צריך לסגור</h3>
          <ul className="mt-3 space-y-2">
            {findings.map((finding) => {
              const isAcknowledged = acknowledged.has(finding.id)
              return (
                <li key={finding.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-3 ${isAcknowledged ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-card'}`}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black text-primary">{finding.label}</p>
                    {finding.sourceText && <q className="mt-1 block break-words text-xs font-bold text-muted-foreground [overflow-wrap:anywhere]">{finding.sourceText}</q>}
                  </div>
                  <button
                    type="button"
                    aria-pressed={isAcknowledged}
                    aria-label={`טופל: ${finding.label}`}
                    onClick={() => onToggleAcknowledged(finding.id)}
                    className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-xs font-black ${isAcknowledged ? 'border-emerald-300 bg-emerald-100 text-emerald-950' : 'border-primary/20 bg-card text-primary hover:bg-secondary'}`}
                  >
                    <LocalIcon name="ph:check-circle-bold" className="text-base" />
                    <span>טופל</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}

// Drafts the WhatsApp reply Lin copies to the customer: summary + price from
// the panel's own pricing, missing details as questions, in the customer's
// language. The system never sends anything — copy only.
function ReplyDraftBox({
  conversation,
  review,
  draft,
  menu,
}: {
  readonly conversation: string
  readonly review: AIReview
  readonly draft: OrderDraft
  readonly menu: OrderEditorMenu
}) {
  const [state, setState] = useState<
    | { readonly kind: 'idle' }
    | { readonly kind: 'loading' }
    | { readonly kind: 'ready'; readonly reply: string; readonly copied: boolean }
    | { readonly kind: 'error'; readonly message: string }
  >({ kind: 'idle' })

  const requestReply = async () => {
    setState({ kind: 'loading' })
    try {
      const pricing = calculateOrderDraftPricing(draft, menu, { allowMixedLunchAndShabbat: true })
      const totalUsd = pricing.result ? pricing.result.totalMinorUnits / 100 : null
      const recognized = recognizedReviewItems(review, menu, draft.meals)
      const lines = recognized.flatMap(({ reviewItem, catalogItem }) =>
        reviewItem.quantity === null
          ? []
          : [{
              name: catalogItem.name,
              qty: reviewItem.quantity,
              priceUsd: catalogItem.isPaidExtra ? catalogItem.price : null,
            }],
      )
      const missing = [...new Set([
        ...review.missingFields.map((finding) => MISSING_FIELD_LABELS[finding.field]),
        ...recognized.flatMap(({ reviewItem, catalogItem }) =>
          reviewItem.quantity === null ? [`כמות עבור ${catalogItem.name}`] : []),
      ])].slice(0, 30)
      const response = await fetch('/api/ai/order-reply/', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({
          conversation,
          summary: {
            lines,
            totalUsd,
            serviceDate: draft.date || null,
            serviceTime: draft.time || null,
            deliveryLocation: draft.pickup ? null : draft.place.trim() || draft.address.trim() || null,
            fulfillment: draft.pickup ? 'pickup' : 'delivery',
          },
          missing,
        }),
      })
      if (!response.ok) throw new Error('reply request failed')
      const data: unknown = await response.json()
      const reply = typeof (data as { reply?: unknown }).reply === 'string' ? (data as { reply: string }).reply : ''
      if (!reply) throw new Error('empty reply')
      setState({ kind: 'ready', reply, copied: false })
    } catch {
      setState({ kind: 'error', message: 'לא הצלחנו לנסח תשובה כרגע. אפשר לנסות שוב.' })
    }
  }

  return (
    <section aria-label="טיוטת תשובה ללקוח" className="rounded-[2rem] border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-primary">
          <LocalIcon name="ph:chat-circle-text-bold" className="text-2xl" />
          <div>
            <h2 className="font-heading text-xl font-black">טיוטת תשובה ללקוח</h2>
            <p className="mt-1 text-xs font-bold text-muted-foreground">מנוסחת בשפה של הלקוח, עם הסיכום, המחיר והשאלות על מה שחסר. את מעתיקה ושולחת בעצמך — המערכת לא שולחת כלום.</p>
          </div>
        </div>
        <button
          type="button"
          disabled={state.kind === 'loading'}
          onClick={() => { void requestReply() }}
          className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-primary px-5 text-sm font-black text-primary-foreground hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60"
        >
          <LocalIcon name="ph:magic-wand-bold" className={state.kind === 'loading' ? 'animate-spin text-lg' : 'text-lg'} />
          <span>{state.kind === 'loading' ? 'מנסחת תשובה' : state.kind === 'ready' ? 'ניסוח מחדש' : 'ניסוח תשובה'}</span>
        </button>
      </div>
      {state.kind === 'error' && <p role="alert" className="mt-4 rounded-2xl bg-rose-50 p-4 text-sm font-black text-destructive">{state.message}</p>}
      {state.kind === 'ready' && (
        <div className="mt-4 space-y-3">
          <blockquote dir="auto" className="rounded-2xl border border-border bg-background p-4 text-sm font-bold whitespace-pre-wrap break-words text-primary [overflow-wrap:anywhere]">{state.reply}</blockquote>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(state.reply).then(() => {
                setState((current) => current.kind === 'ready' ? { ...current, copied: true } : current)
              })
            }}
            className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-primary/20 bg-card px-5 text-sm font-black text-primary hover:bg-secondary"
          >
            <LocalIcon name={state.copied ? 'ph:check-circle-bold' : 'ph:copy-bold'} className="text-lg" />
            <span>{state.copied ? 'הועתק — אפשר להדביק בוואטסאפ' : 'העתקת התשובה'}</span>
          </button>
        </div>
      )}
    </section>
  )
}

// The customer's personal tracking link (signed server-side): one click
// copies it, Lin pastes it into WhatsApp herself.
function TrackingLinkButton({ orderId }: { readonly orderId: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'copied' | 'error'>('idle')
  return (
    <button
      type="button"
      disabled={state === 'busy'}
      onClick={() => {
        setState('busy')
        void (async () => {
          try {
            const response = await fetch(`/api/tracking-link/${encodeURIComponent(orderId)}`, {
              headers: { Accept: 'application/json' },
              credentials: 'same-origin',
              cache: 'no-store',
            })
            if (!response.ok) throw new Error('tracking link failed')
            const data: unknown = await response.json()
            const url = (data as { url?: unknown }).url
            if (typeof url !== 'string' || !url.startsWith('/t/')) throw new Error('tracking link invalid')
            await navigator.clipboard.writeText(`${window.location.origin}${url}`)
            setState('copied')
          } catch {
            setState('error')
          }
        })()
      }}
      className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-primary/20 bg-card px-5 text-sm font-black text-primary hover:bg-secondary disabled:cursor-wait disabled:opacity-60"
    >
      <LocalIcon name={state === 'copied' ? 'ph:check-circle-bold' : 'ph:map-pin-bold'} className="text-lg" />
      <span>
        {state === 'copied'
          ? 'קישור המעקב הועתק — אפשר לשלוח ללקוח'
          : state === 'error'
            ? 'ההעתקה נכשלה — לנסות שוב'
            : 'העתקת קישור מעקב ללקוח'}
      </span>
    </button>
  )
}

function Section({
  id,
  title,
  summary,
  collapsible = false,
  children,
}: {
  readonly id: string
  readonly title: string
  readonly summary?: string
  readonly collapsible?: boolean
  readonly children: React.ReactNode
}) {
  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3 border-r-4 border-primary pr-4">
      <h2 className="text-lg font-black text-primary">{title}</h2>
      {summary && <span className="rounded-full bg-secondary px-3 py-1 text-xs font-black text-primary">{summary}</span>}
    </div>
  )

  if (collapsible) {
    return (
      <details id={`order-${id}`} open className="scroll-mt-24 space-y-5 rounded-[2rem] border border-border bg-card p-5 shadow-sm sm:p-7">
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">{header}</summary>
        <div className="space-y-5 pt-1">{children}</div>
      </details>
    )
  }

  return (
    <section id={`order-${id}`} className="scroll-mt-24 space-y-5 rounded-[2rem] border border-border bg-card p-5 shadow-sm sm:p-7">
      {header}
      {children}
    </section>
  )
}

const DELIVERY_TIMESTAMP_FORMAT = new Intl.DateTimeFormat('he-IL', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Asia/Dubai',
})

function formatDeliveryTimestamp(value: number): string {
  return DELIVERY_TIMESTAMP_FORMAT.format(new Date(value))
}

// Read-only. The courier flows on the server own every field shown here, and they are
// deliberately absent from OrderDraft so that saving an admin edit preserves them.
function DeliveryProofSection({ order }: { readonly order: LegacyOrder | null }) {
  const proof = order === null ? null : deliveryProofSummary(order)
  return (
    <Section id="proof" title="אישור מסירה">
      {proof === null || !proof.present ? (
        <p className="text-sm font-bold text-muted-foreground">אין עדיין אישור מסירה</p>
      ) : (
        <div className="space-y-4">
          {proof.photoHref && (
            <a href={proof.photoHref} target="_blank" rel="noopener noreferrer" className="block w-fit">
              <img
                src={proof.photoHref}
                alt="צילום מסירה"
                className="max-h-[300px] w-auto rounded-2xl border border-border object-contain"
              />
            </a>
          )}
          <dl className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {proof.deliveredAt !== null && (
              <div>
                <dt className="text-xs font-black text-muted-foreground">מועד המסירה</dt>
                <dd className="mt-1 text-sm font-bold text-primary">{formatDeliveryTimestamp(proof.deliveredAt)}</dd>
              </div>
            )}
            {proof.proofAt !== null && (
              <div>
                <dt className="text-xs font-black text-muted-foreground">מועד הצילום</dt>
                <dd className="mt-1 text-sm font-bold text-primary">{formatDeliveryTimestamp(proof.proofAt)}</dd>
              </div>
            )}
            {proof.proofBy !== '' && (
              <div>
                <dt className="text-xs font-black text-muted-foreground">נמסר על ידי</dt>
                <dd className="mt-1 text-sm font-bold text-primary">{proof.proofBy}</dd>
              </div>
            )}
            {proof.checkinLabel && (
              <div>
                <dt className="text-xs font-black text-muted-foreground">דיווח אחרון מהשליח</dt>
                <dd className="mt-1 text-sm font-bold text-primary">
                  {proof.checkinLabel}
                  {proof.checkinAt !== null && ` · ${formatDeliveryTimestamp(proof.checkinAt)}`}
                </dd>
              </div>
            )}
            {proof.courierNote !== '' && (
              <div className="md:col-span-2">
                <dt className="text-xs font-black text-muted-foreground">הערת השליח</dt>
                <dd className="mt-1 break-words text-sm font-bold text-primary [overflow-wrap:anywhere]">{proof.courierNote}</dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </Section>
  )
}

type PlataSaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'error'; readonly message: string }

type DeleteState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'deleting' }
  | { readonly kind: 'error'; readonly message: string }

// Deleting is a hard removal from the live data. It is still recoverable —
// every save is snapshotted, so a restore from Settings brings the order back —
// but the button stays behind an explicit two-step confirmation.
function DeleteOrderSection({
  state,
  onDelete,
}: {
  readonly state: DeleteState
  readonly onDelete: () => void
}) {
  const [armed, setArmed] = useState(false)
  return (
    <Section id="delete" title="מחיקת ההזמנה">
      <p className="text-xs font-bold text-muted-foreground">
        מחיקה מסירה את ההזמנה מכל המסכים, מהכמויות ומרשימת הקניות. אפשר לשחזר דרך היסטוריית השמירות בהגדרות.
      </p>
      {!armed ? (
        <button
          type="button"
          disabled={state.kind === 'deleting'}
          onClick={() => setArmed(true)}
          className="mt-3 min-h-11 rounded-full border border-rose-200 px-5 text-sm font-black text-destructive hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          מחיקת ההזמנה
        </button>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={state.kind === 'deleting'}
            onClick={onDelete}
            className="min-h-11 rounded-full bg-destructive px-5 text-sm font-black text-white hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {state.kind === 'deleting' ? 'מוחקת בבטחה' : 'כן, למחוק את ההזמנה'}
          </button>
          <button
            type="button"
            disabled={state.kind === 'deleting'}
            onClick={() => setArmed(false)}
            className="min-h-11 rounded-full border border-border px-5 text-sm font-black text-primary hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
          >
            ביטול
          </button>
        </div>
      )}
      {state.kind === 'error' && (
        <p role="alert" className="mt-2 text-xs font-black text-destructive">{state.message}</p>
      )}
    </Section>
  )
}

/**
 * The one place a hotplate is edited. It saves itself, straight to the versioned state, and
 * never through OrderDraft: the draft save merges over the stored order, so a plata that
 * lived in the draft would silently overwrite whatever מיי wrote while the editor was open
 * (and vice versa). Its own save keeps the two writers apart.
 */
function PlataSection({
  order,
  saveState,
  onSave,
}: {
  readonly order: LegacyOrder | null
  readonly saveState: PlataSaveState
  readonly onSave: ((values: PlataFormValues) => void) | null
}) {
  const stored = plataFormValues(order)
  const storedSignature = JSON.stringify(stored)
  // Edits are tagged with the stored values they started from, so a confirmed save — or a
  // Telegram update landing under the open editor — drops the local copy instead of
  // re-showing a value the server already replaced.
  const [edited, setEdited] = useState<{
    readonly signature: string
    readonly values: PlataFormValues
  } | null>(null)
  // What the last save was for, so the confirmation belongs to the values on screen and
  // disappears the moment they are edited again.
  const [submitted, setSubmitted] = useState<string | null>(null)
  const values = edited !== null && edited.signature === storedSignature ? edited.values : stored
  const patch = (next: Partial<PlataFormValues>) => {
    setEdited({ signature: storedSignature, values: { ...values, ...next } })
  }

  const dirty = JSON.stringify(values) !== storedSignature
  const valid = isPlataFormValid(values)
  const stamps = order === null ? null : {
    collectedAt: typeof order.plataCollectedAt === 'number' ? order.plataCollectedAt : null,
    depositReturnedAt: typeof order.plataDepositReturnedAt === 'number' ? order.plataDepositReturnedAt : null,
  }

  return (
    <Section id="plata" title="פלטה ופיקדון">
      {onSave === null ? (
        <p className="text-sm font-bold text-muted-foreground">אפשר לרשום פלטה אחרי ששומרים את ההזמנה.</p>
      ) : (
        <div className="space-y-5">
          <QuantityStepper
            label="פלטות"
            value={values.count}
            onChange={(count) => patch({ count: Math.min(Math.max(count, 0), Math.max(PLATA_STEPPER_MAX, values.count)) })}
          />
          {values.count === 0 ? (
            <p className="text-sm font-bold text-muted-foreground">אין פלטה בהזמנה הזאת.</p>
          ) : (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <Field label="פיקדון ($)">
                <input
                  aria-label="פיקדון פלטה"
                  inputMode="decimal"
                  value={values.deposit}
                  onChange={(event) => patch({ deposit: event.currentTarget.value })}
                  className={inputClassName}
                />
              </Field>
              <Field label="מצב הפלטה">
                <select
                  aria-label="מצב הפלטה"
                  value={values.status}
                  onChange={(event) => patch({ status: event.currentTarget.value as PlataStatus })}
                  className={inputClassName}
                >
                  {PLATA_STATUSES.map((status) => (
                    <option key={status} value={status}>{PLATA_STATUS_LABELS[status]}</option>
                  ))}
                </select>
              </Field>
              <div className="md:col-span-2">
                <Field label="איפה הפלטה מחכה">
                  <input
                    aria-label="איפה הפלטה מחכה"
                    maxLength={MAX_PLATA_NOTE_LENGTH}
                    placeholder="בקבלה, חדר 812..."
                    value={values.note}
                    onChange={(event) => patch({ note: event.currentTarget.value })}
                    className={inputClassName}
                  />
                </Field>
              </div>
            </div>
          )}
          {stamps !== null && (stamps.collectedAt !== null || stamps.depositReturnedAt !== null) && (
            <dl className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {stamps.collectedAt !== null && (
                <div>
                  <dt className="text-xs font-black text-muted-foreground">מועד האיסוף</dt>
                  <dd className="mt-1 text-sm font-bold text-primary">{formatDeliveryTimestamp(stamps.collectedAt)}</dd>
                </div>
              )}
              {stamps.depositReturnedAt !== null && (
                <div>
                  <dt className="text-xs font-black text-muted-foreground">מועד החזרת הפיקדון</dt>
                  <dd className="mt-1 text-sm font-bold text-primary">{formatDeliveryTimestamp(stamps.depositReturnedAt)}</dd>
                </div>
              )}
            </dl>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!dirty || !valid || saveState.kind === 'saving'}
              onClick={() => {
                setSubmitted(JSON.stringify(values))
                onSave(values)
              }}
              className="min-h-11 rounded-full border border-primary bg-primary px-6 text-sm font-black text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground"
            >
              {saveState.kind === 'saving' ? 'שומרת פלטה' : 'שמירת הפלטה'}
            </button>
            {!valid && (
              <p role="alert" className="text-xs font-black text-destructive">
                הפיקדון חייב להיות סכום תקין. לא נשמר שינוי.
              </p>
            )}
            {saveState.kind === 'saved' && submitted === JSON.stringify(values) && (
              <p role="status" className="text-xs font-black text-emerald-700">פרטי הפלטה נשמרו.</p>
            )}
            {saveState.kind === 'error' && (
              <p role="alert" className="text-xs font-black text-destructive">{saveState.message}</p>
            )}
          </div>
          <p className="text-xs font-bold text-muted-foreground">
            הפלטה נשמרת בנפרד משאר ההזמנה, כדי שעדכון של מיי בטלגרם ועריכה כאן לא ידרסו זה את זה.
          </p>
        </div>
      )}
    </Section>
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

// The change list shown for a follow-up message: base is the order as it is
// saved today, next is the reviewed draft with the customer's changes applied.
function draftDeltaLines(base: OrderDraft, next: OrderDraft): readonly string[] {
  const lines: string[] = []
  const scalar = (label: string, before: string, after: string) => {
    if (before.trim() !== after.trim()) lines.push(`${label}: ${before.trim() || '—'} ← ${after.trim() || '—'}`)
  }
  scalar('תאריך', base.date, next.date)
  scalar('שעה', base.time, next.time)
  scalar('שם', base.name, next.name)
  scalar('טלפון', base.phone, next.phone)
  scalar('יעד', base.place || base.address, next.place || next.address)
  if (base.pickup !== next.pickup) lines.push(`אופן מסירה: ${base.pickup ? 'איסוף עצמי' : 'משלוח'} ← ${next.pickup ? 'איסוף עצמי' : 'משלוח'}`)
  const numeric = (label: string, before: number, after: number) => {
    if (before !== after) lines.push(`${label}: ${before} ← ${after}`)
  }
  numeric('ארוחות זוגיות', base.meals, next.meals)
  numeric('חלות', base.challot, next.challot)
  const records: readonly [string, Readonly<Record<string, number>>, Readonly<Record<string, number>>][] = [
    ['סלטים', Object.fromEntries(Object.entries(base.salads).map(([name, value]) => [name, value.ordered])), Object.fromEntries(Object.entries(next.salads).map(([name, value]) => [name, value.ordered]))],
    ['ראשונות', base.firsts, next.firsts],
    ['עיקריות', base.mains, next.mains],
    ['תוספות חמות', base.sides, next.sides],
    ['קינוחים', base.desserts, next.desserts],
    ['תוספות', Object.fromEntries(Object.entries(base.extras).map(([name, value]) => [name, value.quantity])), Object.fromEntries(Object.entries(next.extras).map(([name, value]) => [name, value.quantity]))],
  ]
  for (const [label, before, after] of records) {
    for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const beforeQuantity = before[name] ?? 0
      const afterQuantity = after[name] ?? 0
      if (beforeQuantity !== afterQuantity) lines.push(`${label} · ${name}: ${beforeQuantity} ← ${afterQuantity}`)
    }
  }
  for (const key of new Set([...Object.keys(base.lunch), ...Object.keys(next.lunch)])) {
    const beforeQuantity = base.lunch[key]?.quantity ?? 0
    const afterQuantity = next.lunch[key]?.quantity ?? 0
    if (beforeQuantity !== afterQuantity) lines.push(`צהריים · ${key}: ${beforeQuantity} ← ${afterQuantity}`)
  }
  if (base.notes.trim() !== next.notes.trim()) lines.push('הערות ההזמנה עודכנו')
  return lines
}

// Stamps the source WhatsApp conversation onto the saved order, outside the
// draft (same preservation rule as the mey*/courier* fields). Follow-ups
// append; a fresh intake sets.
function withIntakeConversation(
  state: LegacyStore,
  orderId: string,
  conversation: string | null,
  mode: 'new' | 'edit',
): LegacyStore {
  if (!conversation || conversation.trim() === '') return state
  return {
    ...state,
    orders: state.orders.map((order) => {
      if (order.id !== orderId) return order
      const existing = typeof order.intakeConversation === 'string' ? order.intakeConversation.trim() : ''
      const next = mode === 'edit' && existing !== '' && existing !== conversation.trim()
        ? `${existing}\n\n--- הודעת המשך ---\n${conversation.trim()}`.slice(0, 60000)
        : conversation.trim()
      return { ...order, intakeConversation: next }
    }),
  }
}

function createOrderImportBaseDraft(draft: OrderDraft): OrderDraft {
  return {
    ...draft,
    id: null,
    status: 'מתעניין',
    meals: 0,
    aricha: 0,
    challot: 0,
    salads: {},
    firsts: {},
    heat: '',
    firstsNote: '',
    mains: {},
    mainsNote: '',
    sides: {},
    desserts: {},
    extras: {},
    custom: [],
    lunch: {},
    total: '',
    deposit: '',
    payMethod: '',
    paid: 'לא',
  }
}

function countRecord(record: Readonly<Record<string, number>>): number {
  return Object.values(record).reduce((total, quantity) => total + quantity, 0)
}

function OrderEditorContent({
  draft,
  menu,
  onDraftChange,
  onSave,
  mode,
  outOfStockNames = [],
  persistenceReady,
  isSaving,
  saveFeedback,
  requiresCurrentPricing,
  autoConvertUntouchedDefaultMeal,
  managerReview,
  managerSourceMessage,
  loadedOrder,
  existingGroupNames,
  plataSaveState,
  onSavePlata,
  deleteState,
  onDelete,
}: {
  readonly draft: OrderDraft
  readonly menu: OrderEditorMenu
  readonly onDraftChange: (draft: OrderDraft) => void
  readonly onSave: (allowMixedLunchAndShabbat: boolean) => void
  readonly mode: 'new' | 'edit'
  readonly outOfStockNames?: readonly string[]
  readonly persistenceReady: boolean
  readonly isSaving: boolean
  readonly saveFeedback: SaveFeedback
  readonly requiresCurrentPricing: boolean
  readonly autoConvertUntouchedDefaultMeal: boolean
  readonly managerReview: AIReview | null
  readonly managerSourceMessage: string | null
  readonly loadedOrder: LegacyOrder | null
  readonly existingGroupNames: readonly string[]
  readonly plataSaveState: PlataSaveState
  readonly onSavePlata: ((values: PlataFormValues) => void) | null
  readonly deleteState: DeleteState
  readonly onDelete: (() => void) | null
}) {
  const navigate = useNavigate()
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState('')
  const [hotelQuery, setHotelQuery] = useState(draft.place)
  const [hotelResults, setHotelResults] = useState<readonly HotelSearchResult[]>([])
  const [hotelSearchState, setHotelSearchState] = useState<
    | { readonly kind: 'idle' }
    | { readonly kind: 'loading' }
    | { readonly kind: 'error'; readonly message: string }
    | { readonly kind: 'empty' }
  >({ kind: 'idle' })
  const [staticHotelName, setStaticHotelName] = useState('')
  const [mixedOrderConfirmed, setMixedOrderConfirmed] = useState(false)
  const [discountPercent, setDiscountPercent] = useState('')
  const [manualPrice, setManualPrice] = useState('')
  const [groupSuggestionsOpen, setGroupSuggestionsOpen] = useState(false)
  const [acknowledgedManagerFindings, setAcknowledgedManagerFindings] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const hotelRequest = useRef(0)
  const untouchedDefaultMeal = useRef(autoConvertUntouchedDefaultMeal)
  const outOfStock = useMemo(() => new Set(outOfStockNames), [outOfStockNames])
  const selectionMode = classifyDraftSelectionMode(draft)
  const pricing = calculateOrderDraftPricing(draft, menu, {
    allowMixedLunchAndShabbat: mixedOrderConfirmed,
  })
  const validationIssues = validateOrderDraft(
    draft,
    requiresCurrentPricing ? pricing.result?.totalMinorUnits : undefined,
  )
  // A typed manual total is the operator's explicit pricing decision: the
  // "engine can't price this" issues stop blocking (still shown), and a
  // missing computed result no longer freezes the save.
  const allIssues = demotePriceAvailabilityIssues([...validationIssues, ...pricing.issues], draft, pricing.result?.totalMinorUnits ?? null)
  const hasBlockingIssue = allIssues.some((issue) => issue.blocking)
  const manualTotalCoversPricing = hasValidManualTotal(draft)
  const unresolvedManagerFindings = managerReview === null
    ? []
    : managerFindings(managerReview, menu).filter((finding) => !acknowledgedManagerFindings.has(finding.id))
  const saveIsSafelyBlocked =
    !persistenceReady ||
    hasBlockingIssue ||
    unresolvedManagerFindings.length > 0 ||
    (pricing.result === null && !manualTotalCoversPricing) ||
    isSaving ||
    saveFeedback.kind === 'conflict' ||
    saveFeedback.kind === 'blocked'
  const orderedSalads = Object.values(draft.salads).reduce((total, item) => total + item.ordered, 0)
  const giftSalads = Object.values(draft.salads).reduce((total, item) => total + item.gift, 0)
  const patch = (next: Partial<OrderDraft>) => onDraftChange({ ...draft, ...next })

  // The suggested price is the DEFAULT (Moshe, 2026-08-18): the total field
  // follows the computed price on its own as long as the operator never
  // typed a different value. A manual total (or an edited order's saved
  // total) is left alone — only then does the mismatch warning ask for an
  // explicit confirmation.
  const autoTotalRef = useRef<string | null>(null)
  // Once the operator touches the total field it belongs to them — the
  // default stops refilling, even through a clear-and-retype.
  const manualTotalEdited = useRef(false)
  const suggestedTotalMinorUnits = pricing.result?.totalMinorUnits ?? null
  useEffect(() => {
    if (suggestedTotalMinorUnits === null || isSaving) return
    const suggested = formatUsdInputMinorUnits(suggestedTotalMinorUnits)
    if (
      (draft.total.trim() === '' && !manualTotalEdited.current) ||
      (draft.total === autoTotalRef.current && !manualTotalEdited.current)
    ) {
      autoTotalRef.current = suggested
      if (draft.total !== suggested) onDraftChange({ ...draft, total: suggested })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedTotalMinorUnits, draft.total])

  const markShabbatSelectionChanged = () => {
    untouchedDefaultMeal.current = false
    setMixedOrderConfirmed(false)
  }

  const updateCategory = (
    key: 'firsts' | 'mains' | 'sides' | 'desserts',
    name: string,
    quantity: number,
  ) => {
    markShabbatSelectionChanged()
    patch({ [key]: updateQuantityRecord(draft[key], name, quantity) })
  }

  const updateMeals = (meals: number) => {
    markShabbatSelectionChanged()
    onDraftChange(applyCoupleMealQuantity(draft, menu, meals))
  }

  const updateChallahs = (challot: number) => {
    markShabbatSelectionChanged()
    patch({ challot })
  }

  const updateSalad = (
    name: string,
    selection: { readonly ordered: number; readonly gift: number },
  ) => {
    markShabbatSelectionChanged()
    patch({ salads: updateSaladRecord(draft.salads, name, selection) })
  }

  const updateLunch = (key: string, next: Partial<LunchDraftSelection>) => {
    const current = draft.lunch[key] ?? { quantity: 0, variantKey: '', sides: {}, addonQuantity: 0 }
    const merged = { ...current, ...next }
    const updated = merged.quantity === 0
      ? { ...merged, sides: {}, addonQuantity: 0 }
      : merged
    const lunch = { ...draft.lunch }
    const {
      quantity: _quantity,
      variantKey: _variantKey,
      sides: _sides,
      addonQuantity: _addonQuantity,
      ...unknown
    } = updated
    if (updated.quantity === 0 && Object.keys(unknown).length === 0) delete lunch[key]
    else lunch[key] = updated

    const hadLunchSelection = Object.values(draft.lunch).some(
      (selection) => selection.quantity > 0,
    )
    const convertDefaultMeal =
      untouchedDefaultMeal.current &&
      !hadLunchSelection &&
      current.quantity === 0 &&
      updated.quantity > 0
    if (convertDefaultMeal) untouchedDefaultMeal.current = false
    setMixedOrderConfirmed(false)
    patch({
      lunch,
      ...(convertDefaultMeal ? { meals: 0, challot: 0 } : {}),
    })
  }

  const searchHotels = async () => {
    const query = hotelQuery.normalize('NFKC').trim().replace(/\s+/gu, ' ')
    if (query.length < 2 || query.length > 100) {
      setHotelResults([])
      setHotelSearchState({ kind: 'error', message: 'יש לכתוב לפחות שני תווים בשם המלון.' })
      return
    }
    const requestId = hotelRequest.current + 1
    hotelRequest.current = requestId
    setHotelResults([])
    setHotelSearchState({ kind: 'loading' })
    try {
      const response = await fetch(`/api/hotels/search?${new URLSearchParams({ q: query }).toString()}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) throw new Error('hotel search failed')
      const parsed = parseHotelSearchResponse(await response.json())
      if (!parsed) throw new Error('hotel search response was invalid')
      if (hotelRequest.current !== requestId) return
      setHotelResults(parsed.results)
      setHotelSearchState(parsed.results.length > 0 ? { kind: 'idle' } : { kind: 'empty' })
    } catch {
      if (hotelRequest.current !== requestId) return
      setHotelResults([])
      setHotelSearchState({
        kind: 'error',
        message: 'חיפוש המלונות אינו זמין כרגע. אפשר לבחור מהרשימה הקבועה למטה.',
      })
    }
  }

  const selectHotel = (hotel: HotelSearchResult | (typeof HOTEL_OPTIONS)[number]) => {
    onDraftChange(applyHotelSelection(draft, hotel))
    setHotelQuery(hotel.name)
    setHotelResults([])
    setHotelSearchState({ kind: 'idle' })
  }

  return (
    <div className="pb-36" dir="rtl" aria-busy={isSaving || undefined}>
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
          <p className="text-xs font-black text-accent-foreground">השינויים נשמרים רק אחרי אישור מהשרת</p>
          <h1 className="mt-2 font-heading text-3xl font-black text-primary">
            {mode === 'edit'
              ? `עריכת הזמנה ${draft.name.trim() === '' ? String(draft.id ?? '') : draft.name.trim()}`
              : 'הזמנה חדשה'}
          </h1>
        </header>

        {!persistenceReady && (
          <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-black text-amber-950">
            השמירה חסומה כי הגרסה המאובטחת של הנתונים לא נטענה. הטיוטה נשארת במסך ושום הזמנה לא משתנה.
          </p>
        )}
        {saveFeedback.kind !== 'idle' && (
          <p role="alert" className={`rounded-2xl border p-4 text-sm font-black ${saveFeedback.kind === 'network-error' ? 'border-amber-200 bg-amber-50 text-amber-950' : 'border-rose-200 bg-rose-50 text-destructive'}`}>
            {saveFeedback.message}
          </p>
        )}

        {managerReview && (
          <OrderManagerPanel
            review={managerReview}
            menu={menu}
            currentMeals={draft.meals}
            sourceMessage={managerSourceMessage}
            acknowledged={acknowledgedManagerFindings}
            onToggleAcknowledged={(id) => {
              setAcknowledgedManagerFindings((current) => {
                const next = new Set(current)
                if (next.has(id)) next.delete(id)
                else next.add(id)
                return next
              })
            }}
          />
        )}

        {mode === 'edit' && managerReview && loadedOrder && (() => {
          let deltaLines: readonly string[] = []
          try {
            deltaLines = draftDeltaLines(createOrderDraftFromLegacy(loadedOrder, menu), draft)
          } catch {
            deltaLines = []
          }
          return (
            <section aria-label="השינויים מהודעת ההמשך" className="rounded-[2rem] border border-primary/20 bg-secondary p-5 shadow-sm sm:p-6">
              <div className="flex items-center gap-3 text-primary">
                <LocalIcon name="ph:arrows-clockwise-bold" className="text-2xl" />
                <h2 className="font-heading text-xl font-black">השינויים המוצעים על ההזמנה</h2>
              </div>
              {deltaLines.length > 0 ? (
                <ul className="mt-4 space-y-2">
                  {deltaLines.map((line, index) => (
                    <li key={index} className="rounded-2xl border border-border bg-card p-3 text-sm font-black text-primary">{line}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm font-bold text-muted-foreground">לא זוהה שינוי לעומת ההזמנה השמורה — כדאי לבדוק את ההודעה ידנית.</p>
              )}
              <p className="mt-3 text-xs font-bold text-muted-foreground">שום דבר לא נשמר עד לחיצה על שמירת השינויים למטה.</p>
            </section>
          )
        })()}

        {managerReview && managerSourceMessage && (
          <ReplyDraftBox
            conversation={managerSourceMessage}
            review={managerReview}
            draft={draft}
            menu={menu}
          />
        )}

        {mode === 'new' && (
          <section className="rounded-[2rem] border border-border bg-secondary p-5 sm:p-7">
            <div className="flex items-center gap-3 text-primary">
              <LocalIcon name="ph:plus-circle-bold" className="text-2xl" />
              <h2 className="font-black">בניית הזמנה מהודעת וואטסאפ</h2>
            </div>
            <p className="mt-2 text-xs font-bold text-muted-foreground">מדביקים את ההודעה המלאה ומקבלים הזמנה פתוחה לעריכה, עם רשימה קצרה של מה שצריך לסגור.</p>
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
            <label className="mt-3 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-2xl border border-border bg-card px-4 text-xs font-black text-primary hover:bg-background">
              <LocalIcon name="ph:file-text-bold" className="text-lg" />
              <span>או העלאת קובץ ייצוא שיחה מוואטסאפ</span>
              <input
                type="file"
                accept=".txt,.zip,text/plain,application/zip,application/x-zip-compressed"
                className="sr-only"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  event.currentTarget.value = ''
                  if (!file) return
                  void readWhatsAppExportFile(file, 24000).then((result) => {
                    if ('error' in result) {
                      setImportError(
                        result.error === 'not_chat_export'
                          ? 'לא נמצא קובץ שיחה בקובץ שהועלה — מייצאים מוואטסאפ עם "ייצוא צ׳אט"'
                          : 'לא הצלחנו לקרוא את הקובץ — אפשר לנסות שוב או להדביק את הטקסט',
                      )
                      return
                    }
                    setImportText(result.text)
                    setImportError(result.trimmed ? 'השיחה ארוכה — נלקחו ההודעות האחרונות (שם נמצאת ההזמנה)' : '')
                  })
                }}
              />
            </label>
            {importError && <p role="alert" className="mt-2 text-xs font-black text-destructive">{importError}</p>}
            <button
              type="button"
              onClick={() => {
                if (!importText.trim()) {
                  setImportError('הדביקי קודם את הודעת הלקוח, או העלי קובץ ייצוא שיחה.')
                  return
                }
                navigate(APP_ROUTES.orderImportReview, {
                  state: {
                    message: importText,
                    baseDraft: createOrderImportBaseDraft(draft),
                  },
                })
              }}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 text-sm font-black text-primary-foreground hover:bg-primary/90"
            >
              <LocalIcon name="ph:plus-circle-bold" className="text-lg" />
              <span>בניית הזמנה מההודעה</span>
            </button>
          </section>
        )}

        {mode === 'edit' && !managerReview && typeof draft.id === 'string' && (
          <section className="rounded-[2rem] border border-border bg-secondary p-5 sm:p-7">
            <div className="flex items-center gap-3 text-primary">
              <LocalIcon name="ph:arrows-clockwise-bold" className="text-2xl" />
              <h2 className="font-black">הלקוח שלח הודעת המשך?</h2>
            </div>
            <p className="mt-2 text-xs font-bold text-muted-foreground">מדביקים את ההודעה החדשה ("תוסיפי 2 חלות ותשני ל-15:00") — המערכת תציע רק את השינויים על ההזמנה הזאת, לאישור לפני שמירה.</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  navigate(APP_ROUTES.orderImportReview, {
                    state: {
                      baseDraft: { ...draft, id: null },
                      followUpOrderId: draft.id,
                    },
                  })
                }}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-primary/20 bg-card px-5 text-sm font-black text-primary hover:bg-secondary"
              >
                <LocalIcon name="ph:chat-dots-bold" className="text-lg" />
                <span>פענוח הודעת המשך</span>
              </button>
              <TrackingLinkButton orderId={draft.id} />
            </div>
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
            <QuantityStepper label="ארוחות זוגיות" value={draft.meals} onChange={updateMeals} />
            <QuantityStepper label="עריכה לכמה אנשים" value={draft.aricha} onChange={(aricha) => patch({ aricha })} />
            <QuantityStepper label="חלות" value={draft.challot} onChange={updateChallahs} />
          </div>
          <Field label="קבוצה / יעד משותף">
            <div className="relative">
              <input
                aria-label="קבוצה / יעד משותף"
                value={draft.group}
                onChange={(event) => { patch({ group: event.currentTarget.value }); setGroupSuggestionsOpen(true) }}
                onFocus={() => setGroupSuggestionsOpen(true)}
                onBlur={() => window.setTimeout(() => setGroupSuggestionsOpen(false), 150)}
                placeholder="הזמנה בודדת — בלי קבוצה"
                autoComplete="off"
                className={inputClassName}
              />
              {groupSuggestionsOpen && existingGroupNames.length > 0 && (() => {
                const query = draft.group.trim().toLocaleLowerCase('he-IL')
                const matches = existingGroupNames.filter((name) => name.toLocaleLowerCase('he-IL').includes(query))
                if (matches.length === 0) return null
                return (
                  <ul className="absolute z-10 mt-2 w-full space-y-1 rounded-2xl border border-border bg-card p-2 shadow-lg">
                    {matches.map((name) => (
                      <li key={name}>
                        <button
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => { patch({ group: name }); setGroupSuggestionsOpen(false) }}
                          className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 text-right text-sm font-bold text-primary hover:bg-secondary"
                        >
                          <LocalIcon name="ph:users-bold" className="text-base" />
                          <span>{name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              })()}
            </div>
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
            <Field label="אימייל (לשליחת חשבונית)">
              <input aria-label="אימייל" type="email" value={draft.email} onChange={(event) => patch({ email: event.currentTarget.value })} className={inputClassName} />
            </Field>
          </div>
          <label className="flex min-h-11 items-center gap-3 rounded-2xl border border-border px-4 text-sm font-black text-primary">
            <input type="checkbox" checked={draft.pickup} onChange={(event) => patch({ pickup: event.currentTarget.checked })} className="size-5 accent-primary" />
            <span>איסוף עצמי</span>
          </label>
          {!draft.pickup && (
            <div className="space-y-5">
              <Field label="אזור משלוח">
                <div className="grid grid-cols-2 gap-3">
                  {DELIVERY_ZONE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => patch({ deliveryZone: option.value })}
                      className={`min-h-11 rounded-xl border-2 text-sm font-black transition-colors ${
                        draft.deliveryZone === option.value
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-card text-muted-foreground hover:bg-secondary'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </Field>
              <label className="flex min-h-11 items-center gap-3 rounded-2xl border border-border px-4 text-sm font-black text-primary">
                <input
                  type="checkbox"
                  checked={draft.freeDelivery}
                  onChange={(event) => patch({ freeDelivery: event.currentTarget.checked })}
                  className="size-5 accent-primary"
                />
                <span>משלוח חינם</span>
              </label>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <Field label="שם מלון / יעד">
                  <input
                    aria-label="שם מלון / יעד"
                    value={hotelQuery}
                    onChange={(event) => {
                      const value = event.currentTarget.value
                      hotelRequest.current += 1
                      setHotelQuery(value)
                      setHotelResults([])
                      setHotelSearchState({ kind: 'idle' })
                      onDraftChange(applyHotelDestinationInput(draft, value))
                    }}
                    className={inputClassName}
                  />
                  <button
                    type="button"
                    disabled={hotelSearchState.kind === 'loading'}
                    onClick={() => { void searchHotels() }}
                    className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-xs font-black text-primary-foreground hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60"
                  >
                    <LocalIcon name="ph:map-pin-bold" className="text-base" />
                    <span>{hotelSearchState.kind === 'loading' ? 'מחפשת מלון' : 'חיפוש מלון'}</span>
                  </button>
                  <a
                    href="https://www.openstreetmap.org/copyright"
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block text-[0.65rem] font-bold text-muted-foreground underline"
                  >
                    נתוני החיפוש: OpenStreetMap contributors
                  </a>
                </Field>
                <Field label="שעת הגעה">
                  <input aria-label="שעת הגעה" value={draft.time} onChange={(event) => patch({ time: event.currentTarget.value })} className={inputClassName} />
                </Field>
              </div>
              {hotelSearchState.kind === 'error' && (
                <p role="alert" className="rounded-xl bg-amber-50 p-3 text-xs font-black text-amber-950">
                  {hotelSearchState.message}
                </p>
              )}
              {hotelSearchState.kind === 'empty' && (
                <p role="status" className="rounded-xl bg-secondary p-3 text-xs font-black text-primary">
                  לא נמצאו מלונות מתאימים בדובאי או באבו דאבי. אפשר לבחור מהרשימה הקבועה.
                </p>
              )}
              {hotelResults.length > 0 && (
                <ul aria-label="תוצאות חיפוש מלונות" className="space-y-2 rounded-2xl border border-border bg-background/60 p-3">
                  {hotelResults.map((hotel) => (
                    <li key={hotel.id}>
                      <button
                        type="button"
                        onClick={() => selectHotel(hotel)}
                        className="flex min-h-12 w-full items-start gap-3 rounded-xl bg-card p-3 text-right hover:bg-secondary"
                      >
                        <LocalIcon name="ph:map-pin-bold" className="mt-0.5 shrink-0 text-lg text-primary" />
                        <span>
                          <span className="block text-sm font-black text-primary">{hotel.name}</span>
                          <span className="mt-1 block text-xs font-bold text-muted-foreground">{hotel.fullAddress}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="grid grid-cols-1 gap-2 rounded-2xl border border-border bg-background/60 p-3 md:grid-cols-[1fr_auto]">
                <label className="space-y-2">
                  <span className="text-xs font-black text-muted-foreground">רשימת מלונות קבועה</span>
                  <select
                    aria-label="מלון מהרשימה הקבועה"
                    value={staticHotelName}
                    onChange={(event) => setStaticHotelName(event.currentTarget.value)}
                    className={inputClassName}
                  >
                    <option value="">— בחירה —</option>
                    {HOTEL_OPTIONS.map((hotel) => (
                      <option key={hotel.name} value={hotel.name}>{hotel.city} · {hotel.name}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={!staticHotelName}
                  onClick={() => {
                    const hotel = HOTEL_OPTIONS.find((candidate) => candidate.name === staticHotelName)
                    if (hotel) selectHotel(hotel)
                  }}
                  className="min-h-11 self-end rounded-xl border border-primary/20 bg-card px-4 text-xs font-black text-primary hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="inline-flex items-center gap-2">
                    <LocalIcon name="ph:map-pin-bold" />
                    בחירת המלון
                  </span>
                </button>
              </div>
              <Field label="כתובת מלאה / הוראות לקבלה">
                <input aria-label="כתובת מלאה" value={draft.address} onChange={(event) => patch({ address: event.currentTarget.value })} className={inputClassName} />
              </Field>
              <Field label="קישור ניווט">
                <input aria-label="קישור ניווט" value={draft.navigationUrl} onChange={(event) => onDraftChange(applyHotelNavigationInput(draft, event.currentTarget.value))} className={inputClassName} />
              </Field>
            </div>
          )}
        </Section>

        <Section id="salads" title="סלטים" summary={`${orderedSalads}/${draft.meals * 4} כלולים · ${giftSalads} פינוק`} collapsible>
          <p className="text-xs font-bold text-muted-foreground">עמודת פינוק לא מקטינה את הזכאות ולא מחויבת.</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {menu.salads.map((name) => {
              const selection = draft.salads[name] ?? { ordered: 0, gift: 0 }
              return (
                <div key={name} className={`rounded-2xl border border-border bg-background/60 p-3 ${outOfStock.has(name) ? 'opacity-70' : ''}`}>
                  <p className="mb-3 text-sm font-black text-primary">{name}</p>
                  {outOfStock.has(name) && <p className="mb-2 text-xs font-black text-destructive">אזל מהמלאי — הבחירה עדיין פתוחה</p>}
                  <div className="grid grid-cols-2 gap-2">
                    <div><span className="mb-1 block text-center text-[0.65rem] font-black text-muted-foreground">הוזמן</span><QuantityStepper compact label={`${name} הוזמן`} value={selection.ordered} onChange={(ordered) => updateSalad(name, { ...selection, ordered })} /></div>
                    <div><span className="mb-1 block text-center text-[0.65rem] font-black text-accent-foreground">פינוק</span><QuantityStepper compact label={`${name} פינוק`} value={selection.gift} onChange={(gift) => updateSalad(name, { ...selection, gift })} /></div>
                  </div>
                </div>
              )
            })}
          </div>
        </Section>

        <Section id="firsts" title="מנה ראשונה — דגים" summary={`${pricing.result?.fish.selectedUnits ?? '—'}/${draft.meals * 2} יחידות`} collapsible>
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

        <Section id="mains" title="עיקריות" summary={`${countRecord(draft.mains)} נבחרו`} collapsible>
          <QuantityCategory names={menu.mains} quantities={draft.mains} outOfStock={outOfStock} update={(name, quantity) => updateCategory('mains', name, quantity)} />
          <Field label="הערה לעיקריות"><input aria-label="הערה לעיקריות" value={draft.mainsNote} onChange={(event) => patch({ mainsNote: event.currentTarget.value })} className={inputClassName} /></Field>
        </Section>

        <Section id="sides" title="תוספות" summary={`${countRecord(draft.sides)} נבחרו`} collapsible>
          <QuantityCategory names={menu.sides} quantities={draft.sides} outOfStock={outOfStock} update={(name, quantity) => updateCategory('sides', name, quantity)} />
        </Section>

        <Section id="desserts" title="קינוחים" summary={`2 סופלה או בקלאווה אחת לזוגית`} collapsible>
          <QuantityCategory names={menu.desserts} quantities={draft.desserts} outOfStock={outOfStock} update={(name, quantity) => updateCategory('desserts', name, quantity)} />
        </Section>

        <Section id="lunch" title="תפריט צהריים" collapsible>
          <div className="space-y-4">
            {menu.lunch.map((item) => {
              const selection = draft.lunch[item.key] ?? { quantity: 0, variantKey: '', sides: {}, addonQuantity: 0 }
              const fallbackVariantKey = selection.variantKey || item.variants[0]?.key || ''
              const plates = item.variants.length > 0 && selection.quantity > 0
                ? readLunchPlates(selection, item) ?? resizeLunchPlates(
                    [{ variantKey: fallbackVariantKey, sides: selection.sides }],
                    selection.quantity,
                    fallbackVariantKey,
                  )
                : null
              const commitPlates = (quantity: number, nextPlates: readonly LunchPlateDraft[]) =>
                updateLunch(item.key, {
                  quantity,
                  plates: nextPlates,
                  sides: mergedLunchPlateSides(nextPlates),
                  variantKey: nextPlates[0]?.variantKey ?? '',
                })
              const setPlate = (plateIndex: number, nextPlate: LunchPlateDraft) =>
                commitPlates(
                  selection.quantity,
                  plates!.map((plate, index) => (index === plateIndex ? nextPlate : plate)),
                )
              return (
                <div key={item.key} className="rounded-2xl border border-border bg-background/60 p-4">
                  <QuantityStepper
                    label={item.name}
                    value={selection.quantity}
                    onChange={(quantity) => {
                      if (item.variants.length === 0) {
                        updateLunch(item.key, { quantity })
                        return
                      }
                      if (quantity === 0) {
                        updateLunch(item.key, { quantity, plates: [], sides: {}, variantKey: '' })
                        return
                      }
                      commitPlates(quantity, resizeLunchPlates(plates, quantity, fallbackVariantKey))
                    }}
                  />
                  {plates !== null && (
                    <div className="mt-4 space-y-3">
                      {plates.map((plate, plateIndex) => (
                        <div key={plateIndex} className="rounded-2xl border border-border bg-card p-4">
                          {plates.length > 1 && (
                            <p className="mb-2 text-xs font-black text-muted-foreground">
                              מנה {plateIndex + 1} מתוך {plates.length}
                            </p>
                          )}
                          <fieldset className="flex flex-wrap gap-3">
                            <legend className="mb-2 text-xs font-black text-muted-foreground">בחירת וריאציה</legend>
                            {item.variants.map((variant) => (
                              <label key={variant.key} className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-background/60 px-3 text-xs font-bold text-primary">
                                <input
                                  type="radio"
                                  name={`lunch-${item.key}-plate-${plateIndex}`}
                                  checked={plate.variantKey === variant.key}
                                  onChange={() => setPlate(plateIndex, { ...plate, variantKey: variant.key })}
                                />
                                <span>{variant.label} · {formatUsdMinorUnits(variant.priceMinorUnits)}</span>
                              </label>
                            ))}
                          </fieldset>
                          {item.sideChoice && (
                            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                              {menu.lunchSides.map((sideName) => (
                                <QuantityStepper
                                  key={sideName}
                                  label={plates.length > 1 ? `${sideName} — מנה ${plateIndex + 1}` : sideName}
                                  value={plate.sides[sideName] ?? 0}
                                  onChange={(quantity) =>
                                    setPlate(plateIndex, {
                                      ...plate,
                                      sides: updateQuantityRecord(plate.sides, sideName, quantity),
                                    })
                                  }
                                />
                              ))}
                            </div>
                          )}
                        </div>
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

        {selectionMode === 'mixed' && (
          <label className="flex min-h-12 items-start gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 text-sm font-black text-amber-950 shadow-sm">
            <input
              type="checkbox"
              checked={mixedOrderConfirmed}
              onChange={(event) => setMixedOrderConfirmed(event.currentTarget.checked)}
              className="mt-0.5 size-5 shrink-0 accent-primary"
            />
            <span>אני מאשרת שזו הזמנה משולבת של שבת וצהריים</span>
          </label>
        )}

        <Section id="extras" title="אקסטרות ופריטים חופשיים" collapsible>
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
              <button type="button" onClick={() => { manualTotalEdited.current = false; autoTotalRef.current = formatUsdInputMinorUnits(pricing.result!.totalMinorUnits); patch({ total: formatUsdInputMinorUnits(pricing.result!.totalMinorUnits) }) }} className="min-h-11 w-full rounded-xl border border-primary/20 bg-card text-xs font-black text-primary hover:bg-background">להשתמש במחיר המוצע</button>
              <div className="flex items-center gap-2">
                <input
                  aria-label="הנחה באחוזים"
                  inputMode="decimal"
                  value={discountPercent}
                  onChange={(event) => setDiscountPercent(event.currentTarget.value)}
                  placeholder="הנחה %"
                  className="min-h-11 w-24 rounded-xl border border-border bg-card px-3 text-sm font-black text-primary outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    const percent = Number.parseFloat(discountPercent)
                    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return
                    const discounted = Math.round(pricing.result!.totalMinorUnits * (100 - percent) / 100)
                    manualTotalEdited.current = true
                    patch({ total: formatUsdInputMinorUnits(discounted) })
                  }}
                  className="min-h-11 flex-1 rounded-xl border border-primary/20 bg-card text-xs font-black text-primary hover:bg-background"
                >
                  החלת הנחה על המחיר המוצע
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  aria-label="מחיר ידני בדולרים"
                  inputMode="decimal"
                  value={manualPrice}
                  onChange={(event) => setManualPrice(event.currentTarget.value)}
                  placeholder="מחיר ידני $"
                  className="min-h-11 w-24 rounded-xl border border-border bg-card px-3 text-sm font-black text-primary outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    const minorUnits = parseUsdInputMinorUnits(manualPrice)
                    if (minorUnits === null) return
                    manualTotalEdited.current = true
                    patch({ total: formatUsdInputMinorUnits(minorUnits) })
                    setManualPrice('')
                  }}
                  className="min-h-11 flex-1 rounded-xl border border-primary/20 bg-card text-xs font-black text-primary hover:bg-background"
                >
                  קביעת מחיר ידני (במקום המחושב)
                </button>
              </div>
            </div>
          ) : <p role="alert" className="rounded-2xl bg-rose-50 p-4 text-sm font-black text-destructive">אי אפשר לחשב מחיר אוטומטי להזמנה הזאת. אפשר לקבוע מחיר ידני בשדה "סך לתשלום" למטה — ההזמנה תישמר עם המחיר שהוקלד.</p>}
          {allIssues.length > 0 && (
            <ul className="space-y-2" aria-label="אזהרות הזמנה">
              {allIssues.map((issue, index) => <li key={`${issue.code}-${index}`} className={`rounded-xl p-3 text-xs font-black ${issue.blocking ? 'bg-rose-50 text-destructive' : 'bg-amber-50 text-amber-900'}`}>{issue.message}</li>)}
            </ul>
          )}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Field label="סך לתשלום ($)"><input aria-label="סך לתשלום" inputMode="decimal" value={draft.total} onChange={(event) => { manualTotalEdited.current = true; patch({ total: event.currentTarget.value }) }} className={inputClassName} /></Field>
            <Field label="מקדמה ($)"><input aria-label="מקדמה" inputMode="decimal" value={draft.deposit} onChange={(event) => patch({ deposit: event.currentTarget.value })} className={inputClassName} /></Field>
            <Field label="דרך תשלום"><select aria-label="דרך תשלום" value={draft.payMethod} onChange={(event) => patch({ payMethod: event.currentTarget.value })} className={inputClassName}>{PAYMENT_METHODS.map((value) => <option key={value} value={value}>{value || '— לא נבחר —'}</option>)}</select></Field>
            <Field label="סטטוס תשלום"><select aria-label="סטטוס תשלום" value={draft.paid} onChange={(event) => patch({ paid: event.currentTarget.value })} className={inputClassName}>{PAID_OPTIONS.map((value) => <option key={value}>{value}</option>)}</select></Field>
          </div>
          <Field label="הערות כלליות"><textarea aria-label="הערות כלליות" value={draft.notes} onChange={(event) => patch({ notes: event.currentTarget.value })} className={`${inputClassName} min-h-28 resize-y`} /></Field>
        </Section>

        <DeliveryProofSection order={loadedOrder} />

        {typeof loadedOrder?.intakeConversation === 'string' && loadedOrder.intakeConversation.trim() !== '' && (
          <Section id="intake-conversation" title="השיחה המקורית מוואטסאפ" collapsible>
            <blockquote dir="auto" className="break-words whitespace-pre-wrap rounded-2xl border border-border bg-background p-4 text-sm font-bold text-muted-foreground [overflow-wrap:anywhere]">
              {loadedOrder.intakeConversation}
            </blockquote>
          </Section>
        )}

        <PlataSection order={loadedOrder} saveState={plataSaveState} onSave={onSavePlata} />

        {mode === 'edit' && onDelete !== null && (
          <DeleteOrderSection state={deleteState} onDelete={onDelete} />
        )}
      </div>

      <footer className="fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-card/95 p-4 backdrop-blur md:right-64 md:bottom-0">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[0.65rem] font-black text-muted-foreground">{isSaving ? 'ממתינה לאישור שמירה מהשרת' : 'עד לאישור השמירה, הטיוטה לא משנה את מסד הנתונים'}</p>
            {unresolvedManagerFindings.length > 0 && (
              <p className="mt-1 text-xs font-black text-amber-900">השמירה תיפתח אחרי סימון טופל בכל הבירורים.</p>
            )}
            {(() => {
              // The footer shows what will actually be charged: the manual
              // total when one is typed; the computed price is secondary.
              const manualMinorUnits = parseUsdInputMinorUnits(draft.total)
              const computedMinorUnits = pricing.result?.totalMinorUnits ?? null
              const effective = manualMinorUnits ?? computedMinorUnits
              return (
                <>
                  <p className="text-lg font-black text-primary" dir="ltr">{effective !== null ? formatUsdMinorUnits(effective) : '—'}</p>
                  {manualMinorUnits !== null && computedMinorUnits !== null && manualMinorUnits !== computedMinorUnits && (
                    <p className="text-[0.65rem] font-black text-amber-900" dir="ltr">
                      {`מחושב: ${formatUsdMinorUnits(computedMinorUnits)} · נקבע ידנית`}
                    </p>
                  )}
                </>
              )
            })()}
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={isSaving} onClick={() => navigate(APP_ROUTES.orders)} className="min-h-11 rounded-full border border-border px-5 text-sm font-black text-primary hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60">ביטול</button>
            <button
              type="button"
              disabled={saveIsSafelyBlocked}
              onClick={() => {
                if (unresolvedManagerFindings.length === 0) onSave(mixedOrderConfirmed)
              }}
              title={!persistenceReady
                ? 'השמירה דורשת מעטפת נתונים עם גרסה מאומתת'
                : unresolvedManagerFindings.length > 0
                  ? 'יש לסמן טופל בכל הבירורים לפני השמירה'
                  : hasBlockingIssue
                    ? 'יש לתקן את השדות המסומנים לפני השמירה'
                    : undefined}
              className="min-h-11 rounded-full bg-primary px-7 text-sm font-black text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
            >
              {isSaving ? 'שומרת בבטחה' : saveFeedback.kind === 'network-error' ? 'בדיקת ניסיון השמירה מחדש' : mode === 'edit' ? 'שמירת השינויים' : 'שמירת ההזמנה'}
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}

export function OrderEditorScreen() {
  const { orderId } = useParams<{ orderId?: string }>()
  const storeQuery = useStore()
  const saveMutation = useVersionedStateMutation()
  // The plata section's own writer. Same mutation scope as the draft save, so the two can
  // never be in flight at once, but its own pending state — saving a hotplate must not look
  // like saving the order.
  const plataMutation = useVersionedStateMutation()
  // The delete writer. Same mutation scope, own pending state.
  const deleteMutation = useVersionedStateMutation()
  const location = useLocation()
  const navigate = useNavigate()
  const [draft, setDraft] = useState<OrderDraft | null>(null)
  const [managerReview, setManagerReview] = useState<AIReview | null>(null)
  const [managerSourceMessage, setManagerSourceMessage] = useState<string | null>(null)
  const [editLoadIssue, setEditLoadIssue] = useState<string | null>(null)
  const [duplicateLoadIssue, setDuplicateLoadIssue] = useState<string | null>(null)
  const [reviewLoadIssue, setReviewLoadIssue] = useState<{ readonly sourceMessage: string | null } | null>(null)
  const [saveFeedback, setSaveFeedback] = useState<SaveFeedback>({ kind: 'idle' })
  const [plataSaveState, setPlataSaveState] = useState<PlataSaveState>({ kind: 'idle' })
  const [deleteState, setDeleteState] = useState<DeleteState>({ kind: 'idle' })
  const initializedFor = useRef('')
  const baseEnvelope = useRef<VersionedStateEnvelope | null>(null)
  const retryAttempt = useRef<SaveAttempt | null>(null)
  const createdOrderId = useRef<string | null>(null)
  const submissionLocked = useRef(false)
  const initialPricingFingerprint = useRef<string | null>(null)
  const initialDraftKind = useRef<'fresh' | 'other'>('other')

  const store = storeQuery.data?.data ?? null
  const menu = useMemo(() => buildOrderEditorMenu(store ?? { orders: [] }), [store])
  const existingGroupNames = useMemo(
    () =>
      [...new Set(
        (store?.orders ?? [])
          .map((order) => (typeof order.group === 'string' ? order.group.trim() : ''))
          .filter((name) => name !== ''),
      )].sort((a, b) => a.localeCompare(b, 'he')),
    [store],
  )
  const mode = orderId === undefined ? 'new' : 'edit'
  const initializationKey = `${mode}:${orderId ?? ''}:${location.search}`
  const storedOrderIdStatus = store ? classifyStoredOrderIds(store.orders) : 'safe'

  useEffect(() => {
    if (!storeQuery.data || initializedFor.current === initializationKey) return
    initializedFor.current = initializationKey
    baseEnvelope.current = isVersionedStateEnvelope(storeQuery.data)
      ? structuredClone(storeQuery.data)
      : null
    if (storedOrderIdStatus !== 'safe') {
      initialDraftKind.current = 'other'
      setManagerReview(null)
      setManagerSourceMessage(null)
      setReviewLoadIssue(null)
      setDraft(null)
      return
    }
    const reviewHandoffPresent = hasReviewHandoffState(location.state)
    const reviewHandoff = reviewHandoffPresent && isVersionedStateEnvelope(storeQuery.data)
      ? readReviewState(
          location.state,
          currentCatalogSignature(menu),
          storeQuery.data,
          menu,
        )
      : null
    if (reviewHandoffPresent && reviewHandoff === null) {
      initialDraftKind.current = 'other'
      initialPricingFingerprint.current = null
      setEditLoadIssue(null)
      setDuplicateLoadIssue(null)
      setManagerReview(null)
      setManagerSourceMessage(null)
      setReviewLoadIssue({ sourceMessage: recoverReviewedMessage(location.state) })
      setDraft(null)
      return
    }
    if (mode === 'edit') {
      initialDraftKind.current = 'other'
      setReviewLoadIssue(null)
      const matches = (store?.orders ?? []).filter((order) => order.id === orderId)
      if (matches.length !== 1) {
        setManagerReview(null)
        setManagerSourceMessage(null)
        setDraft(null)
        return
      }
      const issue = legacyOrderEditIssue(matches[0]!)
      if (issue !== null) {
        setManagerReview(null)
        setManagerSourceMessage(null)
        setEditLoadIssue(issue)
        setDraft(null)
        return
      }
      const baseline = createOrderDraftFromLegacy(matches[0]!, menu)
      // A follow-up review lands here with the customer's changes already
      // applied over this order's own draft; the original keeps its identity
      // and pricing is forced through a fresh calculation (the fingerprint
      // below is the ORIGINAL order's, so any change requires repricing).
      const nextDraft = reviewHandoff?.draft
        ? { ...reviewHandoff.draft, id: baseline.id, status: reviewHandoff.draft.status || baseline.status }
        : baseline
      initialPricingFingerprint.current = orderPricingFingerprint(baseline)
      setManagerReview(reviewHandoff?.review ?? null)
      setManagerSourceMessage(reviewHandoff?.sourceMessage ?? null)
      setEditLoadIssue(null)
      setDuplicateLoadIssue(null)
      setDraft(nextDraft)
      return
    }
    const duplicateValues = new URLSearchParams(location.search).getAll('duplicate')
    if (duplicateValues.length > 0) {
      initialDraftKind.current = 'other'
      setManagerReview(null)
      setManagerSourceMessage(null)
      setReviewLoadIssue(null)
      const duplicateId = duplicateValues.length === 1 ? duplicateValues[0]! : ''
      if (!CANONICAL_ORDER_ID_PATTERN.test(duplicateId)) {
        setDuplicateLoadIssue('מזהה הזמנת המקור אינו תקין. לא נפתחה טיוטה חדשה.')
        setEditLoadIssue(null)
        setDraft(null)
        return
      }
      const matches = (store?.orders ?? []).filter((order) => order.id === duplicateId)
      if (matches.length !== 1) {
        setDuplicateLoadIssue(
          matches.length === 0
            ? 'הזמנת המקור לא נמצאה. לא נפתחה טיוטה חדשה.'
            : 'מזהה הזמנת המקור אינו ייחודי. לא נפתחה טיוטה חדשה.',
        )
        setEditLoadIssue(null)
        setDraft(null)
        return
      }
      try {
        const nextDraft = createDuplicateOrderDraft(matches[0]!, menu)
        initialPricingFingerprint.current = orderPricingFingerprint(nextDraft)
        setDuplicateLoadIssue(null)
        setEditLoadIssue(null)
        setDraft(nextDraft)
      } catch {
        setDuplicateLoadIssue('הזמנת המקור כוללת נתון ישן שלא ניתן לשכפל בבטחה. לא נפתחה טיוטה חדשה.')
        setEditLoadIssue(null)
        setDraft(null)
      }
      return
    }
    const base = createOrderDraft(menu)
    const zeroBaseline = { ...base, meals: 0, challot: 0 }
    const nextDraft = reviewHandoff?.draft ?? (
      reviewHandoff
        ? applyAIReviewToDraft(zeroBaseline, reviewHandoff.review, buildAIOrderCatalog(menu).targetsById, menu)
        : base
    )
    initialDraftKind.current = reviewHandoff ? 'other' : 'fresh'
    initialPricingFingerprint.current = orderPricingFingerprint(nextDraft)
    setEditLoadIssue(null)
    setDuplicateLoadIssue(null)
    setReviewLoadIssue(null)
    setManagerReview(reviewHandoff?.review ?? null)
    setManagerSourceMessage(reviewHandoff?.sourceMessage ?? null)
    setDraft(nextDraft)
  }, [initializationKey, location.search, location.state, menu, mode, orderId, store, storedOrderIdStatus, storeQuery.data])

  const updateDraft = (nextDraft: OrderDraft) => {
    if (submissionLocked.current) return
    setDraft(nextDraft)
    if (saveFeedback.kind === 'network-error') {
      retryAttempt.current = null
      saveMutation.reset()
      setSaveFeedback({ kind: 'idle' })
    }
  }

  const saveDraft = async (allowMixedLunchAndShabbat: boolean) => {
    if (!draft || submissionLocked.current || saveMutation.isPending) return
    const loadedBase = baseEnvelope.current
    if (!loadedBase) {
      setSaveFeedback({
        kind: 'blocked',
        message: 'אי אפשר לשמור בלי גרסת בסיס מאומתת. הטיוטה לא נשלחה ושום הזמנה לא שונתה.',
      })
      return
    }
    const draftSignature = JSON.stringify(draft)
    let attempt = retryAttempt.current
    if (!attempt || attempt.draftSignature !== draftSignature) {
      retryAttempt.current = null
      const pricing = calculateOrderDraftPricing(draft, menu, { allowMixedLunchAndShabbat })
      const requiresCurrentPricing =
        mode === 'new' || orderPricingFingerprint(draft) !== initialPricingFingerprint.current
      const blockingIssues = demotePriceAvailabilityIssues([
        ...validateOrderDraft(
          draft,
          requiresCurrentPricing ? pricing.result?.totalMinorUnits : undefined,
        ),
        ...pricing.issues,
      ], draft, pricing.result?.totalMinorUnits ?? null).filter((issue) => issue.blocking)
      if (blockingIssues.length > 0) return

      let refreshedEnvelope: VersionedStateEnvelope | null = null
      try {
        const refreshed = await storeQuery.refetch()
        const refreshedData = refreshed.data
        refreshedEnvelope = refreshedData !== undefined && isVersionedStateEnvelope(refreshedData)
          ? refreshedData
          : null
      } catch {
        refreshedEnvelope = null
      }
      if (!refreshedEnvelope || !isExactEnvelopeSnapshot(refreshedEnvelope, loadedBase)) {
        setSaveFeedback({
          kind: 'blocked',
          message: 'הנתונים או התפריט השתנו מאז פתיחת הטיוטה. שום שמירה לא נשלחה. יש לפתוח את ההזמנה מחדש ולבדוק אותה מול הנתונים העדכניים.',
        })
        return
      }

      try {
        const targetOrderId =
          mode === 'new'
            ? createdOrderId.current ?? createCanonicalOrderId(loadedBase.data)
            : typeof draft.id === 'string'
              ? draft.id
              : ''
        if (!targetOrderId || (mode === 'edit' && targetOrderId !== orderId)) {
          throw new Error('Edited order identity is unsafe.')
        }
        if (mode === 'new') createdOrderId.current = targetOrderId
        const requestId = createVersionedRequestId(
          mode === 'new' ? 'order-create' : 'order-edit',
        )
        attempt = {
          draftSignature,
          change: prepareVersionedStateChange(
            loadedBase,
            requestId,
            (baseStateCopy) => withIntakeConversation(
              applyOrderDraftToStore(baseStateCopy, draft, {
                mode,
                orderId: targetOrderId,
              }),
              targetOrderId,
              managerSourceMessage,
              mode,
            ),
          ),
        }
        retryAttempt.current = attempt
      } catch {
        retryAttempt.current = null
        setSaveFeedback({
          kind: 'blocked',
          message: 'לא ניתן להכין שמירה בטוחה מהנתונים שנטענו. הטיוטה נשארה במסך ושום הזמנה לא שונתה.',
        })
        return
      }
    }

    if (!attempt) return

    submissionLocked.current = true
    setSaveFeedback({ kind: 'idle' })
    let confirmed = false
    try {
      const result = await saveMutation.mutateAsync(attempt.change)
      if (!result.ok) {
        retryAttempt.current = null
        setSaveFeedback({
          kind: 'conflict',
          message: 'נמצאה התנגשות עם שינוי אחר. שום הזמנה לא נדרסה והטיוטה נשארה במסך. יש לחזור לרשימת ההזמנות ולפתוח מחדש לפני שמירה נוספת.',
        })
        return
      }
      retryAttempt.current = null
      confirmed = true
      navigate(APP_ROUTES.orders, { replace: true })
    } catch {
      setSaveFeedback({
        kind: 'network-error',
        message: 'לא התקבל אישור שמירה מהשרת. הטיוטה נשארה במסך; ניסיון נוסף ישתמש באותו מזהה שמירה כדי למנוע כפילות.',
      })
    } finally {
      if (!confirmed) submissionLocked.current = false
    }
  }

  // Deliberately not part of saveDraft: it writes only the plata fields of one order, straight
  // onto the loaded base, and then adopts the confirmed envelope as the new base so the open
  // draft can still be saved afterwards without looking stale.
  const savePlata = async (values: PlataFormValues) => {
    if (mode !== 'edit' || typeof orderId !== 'string') return
    if (submissionLocked.current || saveMutation.isPending || plataMutation.isPending) return
    const loadedBase = baseEnvelope.current
    if (!loadedBase) {
      setPlataSaveState({
        kind: 'error',
        message: 'אי אפשר לשמור בלי גרסת בסיס מאומתת. שום נתון לא שונה.',
      })
      return
    }

    setPlataSaveState({ kind: 'saving' })
    let refreshedEnvelope: VersionedStateEnvelope | null = null
    try {
      const refreshed = await storeQuery.refetch()
      const refreshedData = refreshed.data
      refreshedEnvelope = refreshedData !== undefined && isVersionedStateEnvelope(refreshedData)
        ? refreshedData
        : null
    } catch {
      refreshedEnvelope = null
    }
    if (!refreshedEnvelope || !isExactEnvelopeSnapshot(refreshedEnvelope, loadedBase)) {
      setPlataSaveState({
        kind: 'error',
        message: 'הנתונים השתנו מאז פתיחת ההזמנה. שום שינוי לא נשמר; צריך לפתוח את ההזמנה מחדש.',
      })
      return
    }

    let change: PreparedVersionedStateChange
    try {
      change = prepareVersionedStateChange(
        loadedBase,
        createVersionedRequestId('order-plata'),
        (baseStateCopy) => applyPlataToStore(baseStateCopy, orderId, values),
      )
    } catch {
      setPlataSaveState({
        kind: 'error',
        message: 'פרטי הפלטה אינם בטוחים לשמירה. שום נתון לא שונה.',
      })
      return
    }

    try {
      const result = await plataMutation.mutateAsync(change)
      if (!result.ok) {
        setPlataSaveState({
          kind: 'error',
          message: 'נמצאה התנגשות עם שינוי אחר. פרטי הפלטה לא נשמרו.',
        })
        return
      }
      baseEnvelope.current = {
        revision: result.revision,
        ts: result.ts,
        hash: result.hash,
        data: result.data,
      }
      setPlataSaveState({ kind: 'saved' })
    } catch {
      setPlataSaveState({
        kind: 'error',
        message: 'לא התקבל אישור שמירה מהשרת. פרטי הפלטה לא נשמרו.',
      })
    }
  }

  // Same shape as savePlata: refetch, prove the base is exactly what was loaded,
  // then write the removal through the versioned pipeline (recoverable via restore).
  const deleteOrder = async () => {
    if (mode !== 'edit' || typeof orderId !== 'string') return
    if (submissionLocked.current || saveMutation.isPending || plataMutation.isPending || deleteMutation.isPending) return
    const loadedBase = baseEnvelope.current
    if (!loadedBase) {
      setDeleteState({ kind: 'error', message: 'אי אפשר למחוק בלי גרסת בסיס מאומתת. שום נתון לא שונה.' })
      return
    }

    setDeleteState({ kind: 'deleting' })
    let refreshedEnvelope: VersionedStateEnvelope | null = null
    try {
      const refreshed = await storeQuery.refetch()
      const refreshedData = refreshed.data
      refreshedEnvelope = refreshedData !== undefined && isVersionedStateEnvelope(refreshedData)
        ? refreshedData
        : null
    } catch {
      refreshedEnvelope = null
    }
    if (!refreshedEnvelope || !isExactEnvelopeSnapshot(refreshedEnvelope, loadedBase)) {
      setDeleteState({
        kind: 'error',
        message: 'הנתונים השתנו מאז פתיחת ההזמנה. שום דבר לא נמחק; צריך לפתוח את ההזמנה מחדש.',
      })
      return
    }

    let change: PreparedVersionedStateChange
    try {
      change = prepareVersionedStateChange(
        loadedBase,
        createVersionedRequestId('order-delete'),
        (baseStateCopy) => deleteOrderFromStore(baseStateCopy, orderId),
      )
    } catch {
      setDeleteState({ kind: 'error', message: 'זהות ההזמנה אינה בטוחה למחיקה. שום נתון לא שונה.' })
      return
    }

    try {
      const result = await deleteMutation.mutateAsync(change)
      if (!result.ok) {
        setDeleteState({ kind: 'error', message: 'נמצאה התנגשות עם שינוי אחר. ההזמנה לא נמחקה.' })
        return
      }
      navigate(APP_ROUTES.orders, { replace: true })
    } catch {
      setDeleteState({ kind: 'error', message: 'לא התקבל אישור מהשרת. ההזמנה לא נמחקה.' })
    }
  }

  if (storeQuery.isPending) return <ScreenState kind="loading" title="טוענת את טופס ההזמנה" />
  if (storeQuery.isError) return <ScreenState kind="error" title="לא הצלחנו לטעון את ההזמנה" retry={() => { void storeQuery.refetch() }} />
  if (storedOrderIdStatus !== 'safe') {
    return (
      <ScreenState
        kind="error"
        title={storedOrderIdStatus === 'collision' ? 'מזהה ההזמנה אינו ייחודי' : 'מזהה הזמנה שנטען אינו תקין'}
        description="לא נפתחה טיוטה ולא תישלח שמירה עד לטעינת נתונים עם מזהי הזמנות בטוחים."
      />
    )
  }
  if (editLoadIssue !== null) {
    return (
      <ScreenState
        kind="error"
        title="ההזמנה כוללת נתון ישן שלא ניתן לערוך בבטחה"
        description={`${editLoadIssue} לא נפתחה טיוטה ושום נתון לא השתנה.`}
      />
    )
  }
  if (duplicateLoadIssue !== null) {
    return (
      <ScreenState
        kind="error"
        title="לא ניתן לשכפל את ההזמנה"
        description={`${duplicateLoadIssue} שום נתון לא השתנה.`}
      />
    )
  }
  if (reviewLoadIssue !== null) {
    return (
      <ScreenState
        kind="error"
        title="לא ניתן לפתוח את פענוח הוואטסאפ בבטחה"
        description="פרטי הבדיקה אינם תואמים לנתונים שנטענו. לא נפתחה טיוטה ושום נתון לא השתנה."
        action={{
          label: 'חזרה לבדיקת הודעת הוואטסאפ',
          onClick: () => navigate(APP_ROUTES.orderImportReview, {
            replace: true,
            state: reviewLoadIssue.sourceMessage === null
              ? undefined
              : { message: reviewLoadIssue.sourceMessage },
          }),
        }}
      />
    )
  }
  if (mode === 'edit') {
    const matches = (store?.orders ?? []).filter((order) => order.id === orderId)
    if (matches.length !== 1) {
      return <ScreenState kind="error" title={matches.length === 0 ? 'ההזמנה לא נמצאה' : 'מזהה ההזמנה אינו ייחודי'} description="לא נפתחה טיוטה כדי למנוע עריכת הזמנה לא נכונה." />
    }
  }
  if (!draft) return <ScreenState kind="loading" title="מכינה טיוטה בטוחה" />

  const outOfStockNames = Array.isArray(store?.settings?.out)
    ? store.settings.out.filter((value): value is string => typeof value === 'string')
    : []
  // The loaded order, not the draft: the delivery-confirmation fields never enter the draft.
  const loadedMatches = mode === 'edit' ? (store?.orders ?? []).filter((order) => order.id === orderId) : []
  const loadedOrder = loadedMatches.length === 1 ? loadedMatches[0]! : null

  return (
    <OrderEditorContent
      key={initializationKey}
      draft={draft}
      menu={menu}
      onDraftChange={updateDraft}
      onSave={(allowMixedLunchAndShabbat) => { void saveDraft(allowMixedLunchAndShabbat) }}
      mode={mode}
      outOfStockNames={outOfStockNames}
      persistenceReady={baseEnvelope.current !== null}
      isSaving={saveMutation.isPending || submissionLocked.current}
      saveFeedback={saveFeedback}
      requiresCurrentPricing={
        mode === 'new' || orderPricingFingerprint(draft) !== initialPricingFingerprint.current
      }
      autoConvertUntouchedDefaultMeal={initialDraftKind.current === 'fresh'}
      managerReview={managerReview}
      managerSourceMessage={managerSourceMessage}
      loadedOrder={loadedOrder}
      existingGroupNames={existingGroupNames}
      plataSaveState={plataSaveState}
      onSavePlata={loadedOrder === null ? null : (values) => { void savePlata(values) }}
      deleteState={deleteState}
      onDelete={loadedOrder === null ? null : () => { void deleteOrder() }}
    />
  )
}

export default OrderEditorScreen
