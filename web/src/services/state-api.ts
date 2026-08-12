import { z } from 'zod'
import { LegacyStoreSchema } from '../domain/store.ts'

const TimestampSchema = z.number().finite().nonnegative()
const RevisionSchema = z.number().int().nonnegative().safe()
const StateHashSchema = z.string().regex(/^[0-9a-f]{64}$/)
const RequestIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/)

const StateEnvelopeSchema = z
  .object({
    ts: TimestampSchema,
    data: LegacyStoreSchema.nullable(),
    revision: RevisionSchema.optional(),
    hash: StateHashSchema.optional(),
  })
  .passthrough()

const VersionedStateEnvelopeSchema = z
  .object({
    revision: RevisionSchema,
    ts: TimestampSchema,
    hash: StateHashSchema,
    data: LegacyStoreSchema,
  })
  .passthrough()

const SaveStateCommandSchema = z
  .object({
    baseState: LegacyStoreSchema,
    localState: LegacyStoreSchema,
    baseRevision: RevisionSchema,
    baseHash: StateHashSchema,
    requestId: RequestIdSchema,
  })
  .strict()

const SaveSuccessSchema = VersionedStateEnvelopeSchema.extend({
  ok: z.literal(true),
  idempotent: z.boolean(),
})

const VersionConflictSchema = z.object({
  kind: z.literal('base-version-mismatch'),
  expectedBaseRevision: RevisionSchema,
  expectedBaseHash: StateHashSchema,
  actualRevision: RevisionSchema,
  actualHash: StateHashSchema,
  remoteState: LegacyStoreSchema,
})

const MergeConflictSchema = z.object({
  kind: z.literal('merge-conflict'),
  conflicts: z.array(z.unknown()).min(1),
  actualRevision: RevisionSchema,
  actualHash: StateHashSchema,
  remoteState: LegacyStoreSchema,
})

const IdempotencyConflictSchema = z.object({
  kind: z.literal('idempotency-mismatch'),
  requestId: RequestIdSchema,
})

const SaveConflictSchema = z.object({
  ok: z.literal(false),
  conflict: z.union([
    VersionConflictSchema,
    MergeConflictSchema,
    IdempotencyConflictSchema,
  ]),
  idempotent: z.boolean(),
  stage: z.enum(['merge', 'persistence']).optional(),
})

const SaveStateResponseSchema = z.union([SaveSuccessSchema, SaveConflictSchema])

export type StateEnvelope = z.infer<typeof StateEnvelopeSchema>
export type VersionedStateEnvelope = z.infer<typeof VersionedStateEnvelopeSchema>
export type SaveStateCommand = z.infer<typeof SaveStateCommandSchema>
export type SaveStateResult = z.infer<typeof SaveStateResponseSchema>

type StateApiErrorCode = 'HTTP_ERROR' | 'INVALID_RESPONSE'

export class StateApiError extends Error {
  readonly code: StateApiErrorCode
  readonly status: number

  constructor(code: StateApiErrorCode, status: number) {
    super(code === 'HTTP_ERROR' ? 'The state service request failed.' : 'The state service returned invalid data.')
    this.name = 'StateApiError'
    this.code = code
    this.status = status
  }
}

export interface StateApiOptions {
  baseUrl?: string
  fetcher?: typeof fetch
}

function stateUrl(baseUrl = ''): string {
  return `${baseUrl.replace(/\/$/, '')}/api/state`
}

function defaultStateBaseUrl(): string {
  if (typeof window === 'undefined') return ''
  return window.location.origin
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new StateApiError('INVALID_RESPONSE', response.status)
  }
}

export async function loadState(options: StateApiOptions = {}): Promise<StateEnvelope> {
  const fetcher = options.fetcher ?? fetch
  const response = await fetcher(stateUrl(options.baseUrl ?? defaultStateBaseUrl()), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new StateApiError('HTTP_ERROR', response.status)
  }

  const result = StateEnvelopeSchema.safeParse(await readJson(response))
  if (!result.success) {
    throw new StateApiError('INVALID_RESPONSE', response.status)
  }

  return result.data
}

export async function saveState(
  command: SaveStateCommand,
  options: StateApiOptions = {},
): Promise<SaveStateResult> {
  const validatedCommand = SaveStateCommandSchema.safeParse(command)
  if (!validatedCommand.success) {
    throw new StateApiError('INVALID_RESPONSE', 0)
  }

  const fetcher = options.fetcher ?? fetch
  const response = await fetcher(stateUrl(options.baseUrl ?? defaultStateBaseUrl()), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    credentials: 'same-origin',
    body: JSON.stringify(validatedCommand.data),
  })

  if (!response.ok && response.status !== 409) {
    throw new StateApiError('HTTP_ERROR', response.status)
  }

  const result = SaveStateResponseSchema.safeParse(await readJson(response))
  if (!result.success) {
    throw new StateApiError('INVALID_RESPONSE', response.status)
  }

  return result.data
}

export function isVersionedStateEnvelope(
  envelope: StateEnvelope,
): envelope is VersionedStateEnvelope {
  return VersionedStateEnvelopeSchema.safeParse(envelope).success
}
