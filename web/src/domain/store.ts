import { z } from 'zod'

const NumberLikeSchema = z.union([z.number(), z.string()])

export const LegacyOrderSchema = z
  .object({
    id: z.union([z.string(), z.number(), z.null()]).optional(),
    date: z.string().optional(),
    name: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    place: z.string().optional(),
    address: z.string().optional(),
    time: z.string().optional(),
    pickup: z.boolean().optional(),
    deliveryZone: z.enum(['dubai', 'abu-dhabi']).optional(),
    status: z.string().optional(),
    group: z.string().optional(),
    meals: NumberLikeSchema.optional(),
    aricha: NumberLikeSchema.optional(),
    challot: NumberLikeSchema.optional(),
    salads: z.record(z.string(), z.unknown()).optional(),
    firsts: z.record(z.string(), z.unknown()).optional(),
    heat: z.string().optional(),
    firstsNote: z.string().optional(),
    mains: z.record(z.string(), z.unknown()).optional(),
    mainsNote: z.string().optional(),
    sides: z.record(z.string(), z.unknown()).optional(),
    desserts: z.record(z.string(), z.unknown()).optional(),
    extras: z.record(z.string(), z.unknown()).optional(),
    custom: z.array(z.unknown()).optional(),
    lunch: z.record(z.string(), z.unknown()).optional(),
    notes: z.string().optional(),
    total: NumberLikeSchema.optional(),
    deposit: NumberLikeSchema.optional(),
    payMethod: z.string().optional(),
    paid: z.string().optional(),
    source: z.string().optional(),
    invoiceSentAt: z.number().optional(),
    invoiceNumber: z.string().optional(),
    // Delivery-coordination fields. These are written only by the courier/customer
    // Telegram flows on the server, never by the admin editor. They are deliberately
    // absent from OrderDraft / createOrderDraftFromLegacy / serializeOrderDraft in
    // order-editor.ts: the admin save merges `{...existingOrder, ...serializeOrderDraft(draft)}`,
    // so keeping them out of the draft is what preserves them through an admin edit.
    // Every admin-panel surface that shows them is read-only.
    meyToken: z.string().optional(),
    meyLeadNudgeAt: z.number().optional(),
    meyCheckinAskedAt: z.number().optional(),
    meyLateNudgeAt: z.number().optional(),
    meyAwaitingReplySince: z.number().optional(),
    meyPromptMessageId: z.number().optional(),
    courierCheckinState: z.enum(['onTheWay', 'onTime', 'delayed']).optional(),
    courierCheckinAt: z.number().optional(),
    courierEtaMinutes: z.number().optional(),
    courierEtaAt: z.number().optional(),
    courierNote: z.string().optional(),
    deliveryProofUrl: z.string().optional(),
    deliveryProofAt: z.number().optional(),
    deliveryProofBy: z.string().optional(),
    deliveredAt: z.number().optional(),
    statusBeforeProof: z.string().optional(),
    // The original WhatsApp conversation an order was built from. Same rule
    // as the mey*/courier* fields above: NEVER add it to OrderDraft /
    // serializeOrderDraft — staying out of the draft is what preserves it
    // through admin edits. Read-only in the panel.
    intakeConversation: z.string().optional(),
  })
  .passthrough()

export const LegacySettingsSchema = z
  .object({
    maxMeals: NumberLikeSchema.optional(),
    out: z.array(z.unknown()).optional(),
    businessName: z.string().optional(),
    trn: z.string().optional(),
    businessAddress: z.string().optional(),
    invoiceCurrency: z.enum(['AED', 'USD']).optional(),
    orderingOpen: z.boolean().optional(),
    orderingClosedUntil: z.string().optional(),
    siteBanner: z.string().nullable().optional(),
    meyDigestSentFor: z.string().optional(),
    meyPendingProof: z
      .object({ url: z.string(), at: z.number(), by: z.string().optional() })
      .nullable()
      .optional(),
    meyCourierLocation: z
      .object({ lat: z.number(), lon: z.number(), at: z.number() })
      .nullable()
      .optional(),
  })
  .passthrough()

export const LegacyStoreSchema = z
  .object({
    orders: z.array(LegacyOrderSchema),
    settings: LegacySettingsSchema.optional(),
    customerMeta: z.record(z.string(), z.unknown()).optional(),
    prepDone: z.record(z.string(), z.unknown()).optional(),
    expenses: z.record(z.string(), z.unknown()).optional(),
    lastBackup: z.number().optional(),
    introSeen: z.boolean().optional(),
  })
  .passthrough()

export type LegacyOrder = z.infer<typeof LegacyOrderSchema>
export type LegacyStore = z.infer<typeof LegacyStoreSchema>

export function parseLegacyStore(value: unknown): LegacyStore {
  return LegacyStoreSchema.parse(value)
}
