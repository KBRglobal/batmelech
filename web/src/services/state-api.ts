import { z } from 'zod'
import { LegacyStoreSchema, type LegacyStore } from '../domain/store.ts'

const TimestampSchema = z.number().finite().nonnegative()

const StateEnvelopeSchema = z
  .object({
    ts: TimestampSchema,
    data: LegacyStoreSchema.nullable(),
  })
  .passthrough()

const SaveStateResponseSchema = z
  .object({
    ts: TimestampSchema,
  })
  .passthrough()

export type StateEnvelope = z.infer<typeof StateEnvelopeSchema>

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

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new StateApiError('INVALID_RESPONSE', response.status)
  }
}

export async function loadState(options: StateApiOptions = {}): Promise<StateEnvelope> {
  const fetcher = options.fetcher ?? fetch
  const response = await fetcher(stateUrl(options.baseUrl), {
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
  store: LegacyStore,
  options: StateApiOptions = {},
): Promise<z.infer<typeof SaveStateResponseSchema>> {
  const validatedStore = LegacyStoreSchema.safeParse(store)
  if (!validatedStore.success) {
    throw new StateApiError('INVALID_RESPONSE', 0)
  }

  const fetcher = options.fetcher ?? fetch
  const response = await fetcher(stateUrl(options.baseUrl), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    credentials: 'same-origin',
    body: JSON.stringify({ data: validatedStore.data }),
  })

  if (!response.ok) {
    throw new StateApiError('HTTP_ERROR', response.status)
  }

  const result = SaveStateResponseSchema.safeParse(await readJson(response))
  if (!result.success) {
    throw new StateApiError('INVALID_RESPONSE', response.status)
  }

  return result.data
}
