import { z } from 'zod'

const NumberLikeSchema = z.union([z.number(), z.string()])

export const LegacyOrderSchema = z
  .object({
    id: z.union([z.string(), z.number(), z.null()]).optional(),
    date: z.string().optional(),
    name: z.string().optional(),
    phone: z.string().optional(),
    place: z.string().optional(),
    address: z.string().optional(),
    time: z.string().optional(),
    pickup: z.boolean().optional(),
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
  })
  .passthrough()

export const LegacySettingsSchema = z
  .object({
    maxMeals: NumberLikeSchema.optional(),
    out: z.array(z.unknown()).optional(),
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
