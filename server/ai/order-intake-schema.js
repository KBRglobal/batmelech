'use strict';

const { z } = require('zod');

const MAX_CATALOG_ITEMS = 200;
const MAX_NORMALIZED_ITEMS = 100;

const NonEmptyText = z.string().trim().min(1).max(500);
const NullableText = NonEmptyText.nullable();
const Confidence = z.number().min(0).max(1);
const Quantity = z.number().int().min(1).max(1000);

const CatalogItemSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(200),
    category: z.string().trim().min(1).max(100),
    aliases: z.array(z.string().trim().min(1).max(200)).max(25).optional().default([]),
    isPaidExtra: z.boolean().optional().default(false),
    price: z.number().finite().nonnegative().nullable().optional().default(null),
    currency: z.string().trim().min(1).max(10).nullable().optional().default(null),
  })
  .strict();

const OrderCatalogSchema = z
  .array(CatalogItemSchema)
  .min(1)
  .max(MAX_CATALOG_ITEMS)
  .superRefine((catalog, context) => {
    const ids = new Set();
    for (const [index, item] of catalog.entries()) {
      if (ids.has(item.id)) {
        context.addIssue({
          code: 'custom',
          message: 'Catalog item IDs must be unique.',
          path: [index, 'id'],
        });
      }
      ids.add(item.id);
    }
  });

const NormalizedItemSchema = z
  .object({
    catalogItemId: z.string().trim().min(1).max(100),
    catalogItemName: z.string().trim().min(1).max(200),
    category: z.string().trim().min(1).max(100),
    quantity: Quantity.nullable(),
    sourceText: NonEmptyText,
    confidence: Confidence,
  })
  .strict();

const CorrectionSchema = z
  .object({
    originalText: NonEmptyText,
    correctedText: NonEmptyText,
    reason: NonEmptyText,
  })
  .strict();

const AmbiguitySchema = z
  .object({
    sourceText: NonEmptyText,
    question: NonEmptyText,
    candidateCatalogItemIds: z.array(z.string().trim().min(1).max(100)).max(20),
  })
  .strict();

const PaidExtraSchema = z
  .object({
    catalogItemId: z.string().trim().min(1).max(100),
    catalogItemName: z.string().trim().min(1).max(200),
    quantity: Quantity.nullable(),
    catalogPrice: z.number().finite().nonnegative().nullable(),
    currency: z.string().trim().min(1).max(10).nullable(),
    sourceText: NonEmptyText,
    reason: NonEmptyText,
    confidence: Confidence,
  })
  .strict();

const UnknownItemSchema = z
  .object({
    sourceText: NonEmptyText,
    requestedQuantity: Quantity.nullable(),
    reason: NonEmptyText,
  })
  .strict();

const MissingFieldSchema = z
  .object({
    field: z.enum([
      'customer_name',
      'customer_phone',
      'service_date',
      'service_time',
      'fulfillment_method',
      'delivery_location',
      'item_quantity',
      'item_choice',
      'other',
    ]),
    sourceText: NullableText,
    reason: NonEmptyText,
  })
  .strict();

const WarningSchema = z
  .object({
    code: z.enum([
      'paid_extra',
      'quantity_missing',
      'catalog_mismatch',
      'ambiguous_intent',
      'missing_field',
      'other',
    ]),
    severity: z.enum(['info', 'warning']),
    message: NonEmptyText,
  })
  .strict();

const OrderIntakeReviewSchema = z
  .object({
    reviewOnly: z.literal(true),
    draft: z
      .object({
        customerName: NullableText,
        customerPhone: NullableText,
        serviceDate: NullableText,
        serviceTime: NullableText,
        fulfillmentMethod: z.enum(['delivery', 'pickup', 'unknown']),
        deliveryLocation: NullableText,
        items: z.array(NormalizedItemSchema).max(MAX_NORMALIZED_ITEMS),
        notes: z.array(NonEmptyText).max(50),
      })
      .strict(),
    corrections: z.array(CorrectionSchema).max(50),
    ambiguities: z.array(AmbiguitySchema).max(50),
    paidExtras: z.array(PaidExtraSchema).max(MAX_NORMALIZED_ITEMS),
    unknownItems: z.array(UnknownItemSchema).max(50),
    missingFields: z.array(MissingFieldSchema).max(50),
    warnings: z.array(WarningSchema).max(100),
    overallConfidence: Confidence,
  })
  .strict();

module.exports = {
  CatalogItemSchema,
  MAX_CATALOG_ITEMS,
  MAX_NORMALIZED_ITEMS,
  OrderCatalogSchema,
  OrderIntakeReviewSchema,
};
