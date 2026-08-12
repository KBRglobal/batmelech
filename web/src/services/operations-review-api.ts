import { z } from 'zod'
import type { OperationsReviewSnapshot } from '../domain/operations-review.ts'

const SourceIdSchema = z.string().regex(/^(?:demand|warning)-[1-9][0-9]{0,3}$/u)

export const OperationsReviewSchema = z.object({
  reviewOnly: z.literal(true),
  overview: z.string().trim().min(1).max(500),
  findings: z.array(z.object({
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
  }).strict()).max(30),
}).strict()

const OperationsReviewResponseSchema = z.object({ review: OperationsReviewSchema }).strict()

export type OperationsReview = z.infer<typeof OperationsReviewSchema>

export class OperationsReviewApiError extends Error {
  constructor() {
    super('Operations review request failed.')
    this.name = 'OperationsReviewApiError'
  }
}

export async function requestOperationsReview(
  snapshot: OperationsReviewSnapshot,
  signal?: AbortSignal,
): Promise<OperationsReview> {
  let response: Response
  try {
    response = await fetch('/api/ai/operations-review/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshot }),
      cache: 'no-store',
      signal,
    })
  } catch {
    throw new OperationsReviewApiError()
  }

  if (!response.ok) throw new OperationsReviewApiError()
  try {
    const parsed = OperationsReviewResponseSchema.safeParse(await response.json())
    if (!parsed.success) throw new OperationsReviewApiError()
    return parsed.data.review
  } catch (error) {
    if (error instanceof OperationsReviewApiError) throw error
    throw new OperationsReviewApiError()
  }
}
