'use strict';

const { z } = require('zod');

const MAX_OPERATION_DEMANDS = 250;
const MAX_OPERATION_WARNINGS = 250;
const MAX_OPERATION_FINDINGS = 30;

const OPERATIONS_WARNING_CODES = Object.freeze([
  'MISSING_ORDER_ID',
  'DUPLICATE_ORDER_ID',
  'MISSING_SERVICE_DATE',
  'INVALID_SERVICE_DATE',
  'MISSING_DESTINATION',
  'INVALID_PHONE',
  'INVALID_MONEY',
  'MONEY_OVERFLOW',
  'TEXT_TOO_LONG',
  'INVALID_QUANTITY',
  'QUANTITY_OVERFLOW',
  'UNKNOWN_CATALOG_ITEM',
  'UNKNOWN_LUNCH_ITEM',
  'LUNCH_VARIANT_FALLBACK',
  'UNEXPECTED_LUNCH_FIELD',
  'INVALID_DEMAND',
  'DEMAND_OVERFLOW',
  'DEMAND_IDENTITY_CONFLICT',
  'MISSING_RECIPE',
  'INVALID_RECIPE',
  'INGREDIENT_IDENTITY_CONFLICT',
]);

const SourceIdSchema = z
  .string()
  .trim()
  .regex(/^(?:demand|warning)-[1-9][0-9]{0,3}$/u)
  .max(20);

const ServiceDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .superRefine((value, context) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      context.addIssue({ code: 'custom', message: 'serviceDate must be a real ISO date.' });
    }
  });

const PositiveCanonicalQuantitySchema = z
  .string()
  .trim()
  .max(32)
  .regex(/^(?:0\.[0-9]*[1-9][0-9]*|[1-9][0-9]*(?:\.[0-9]+)?)$/u);

const SanitizedAggregateDemandSchema = z
  .object({
    id: SourceIdSchema,
    source: z.enum(['preparation', 'shopping']),
    serviceDate: ServiceDateSchema.nullable(),
    category: z.enum([
      'salads',
      'firsts',
      'mains',
      'sides',
      'desserts',
      'extras',
      'custom',
      'lunch',
      'ingredient',
    ]),
    quantity: PositiveCanonicalQuantitySchema,
    procurementKind: z.enum(['recipe', 'direct', 'none', 'computed']),
    comparisonGroup: z
      .string()
      .trim()
      .regex(/^group-[1-9][0-9]{0,3}$/u)
      .max(20)
      .nullable(),
  })
  .strict();

const SanitizedOperationWarningSchema = z
  .object({
    id: SourceIdSchema,
    source: z.enum(['preparation', 'shopping', 'delivery']),
    code: z.enum(OPERATIONS_WARNING_CODES),
    serviceDate: ServiceDateSchema.nullable(),
    occurrences: z.number().int().min(1).max(10_000),
    relatedDemandIds: z.array(SourceIdSchema).max(50),
  })
  .strict();

const OperationsReviewInputSchema = z
  .object({
    scope: z.enum(['preparation', 'shopping', 'delivery']),
    selectedServiceDate: ServiceDateSchema.nullable(),
    demands: z.array(SanitizedAggregateDemandSchema).max(MAX_OPERATION_DEMANDS),
    warnings: z.array(SanitizedOperationWarningSchema).max(MAX_OPERATION_WARNINGS),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.demands.length === 0 && snapshot.warnings.length === 0) {
      context.addIssue({ code: 'custom', message: 'At least one aggregate demand or warning is required.' });
    }

    const ids = new Set();
    for (const [index, source] of [...snapshot.demands, ...snapshot.warnings].entries()) {
      if (ids.has(source.id)) {
        context.addIssue({ code: 'custom', message: 'Source IDs must be unique.', path: [index, 'id'] });
      }
      ids.add(source.id);
    }

    const demandIds = new Set(snapshot.demands.map(({ id }) => id));
    for (const [index, warning] of snapshot.warnings.entries()) {
      if (new Set(warning.relatedDemandIds).size !== warning.relatedDemandIds.length) {
        context.addIssue({
          code: 'custom',
          message: 'relatedDemandIds must be unique.',
          path: ['warnings', index, 'relatedDemandIds'],
        });
      }
      if (!warning.relatedDemandIds.every((id) => demandIds.has(id))) {
        context.addIssue({
          code: 'custom',
          message: 'relatedDemandIds must reference supplied demands.',
          path: ['warnings', index, 'relatedDemandIds'],
        });
      }
    }
  });

const OperationsReviewFindingSchema = z
  .object({
    kind: z.enum([
      'unusual_quantity',
      'configuration_gap',
      'unit_conflict',
      'delivery_risk',
      'data_quality',
    ]),
    priority: z.enum(['low', 'medium', 'high']),
    sourceIds: z.array(SourceIdSchema).min(1).max(50),
    explanation: z.string().trim().min(1).max(500),
  })
  .strict();

const OperationsReviewSchema = z
  .object({
    reviewOnly: z.literal(true),
    overview: z.string().trim().min(1).max(500),
    findings: z.array(OperationsReviewFindingSchema).max(MAX_OPERATION_FINDINGS),
  })
  .strict();

module.exports = {
  MAX_OPERATION_DEMANDS,
  MAX_OPERATION_FINDINGS,
  MAX_OPERATION_WARNINGS,
  OPERATIONS_WARNING_CODES,
  OperationsReviewInputSchema,
  OperationsReviewSchema,
  SanitizedAggregateDemandSchema,
  SanitizedOperationWarningSchema,
  SourceIdSchema,
};
