import { useMutation, useQueryClient } from '@tanstack/react-query'
import { parseLegacyStore, type LegacyStore } from '../domain/store.ts'
import {
  saveState,
  type SaveStateCommand,
  type StateApiOptions,
  type StateEnvelope,
  type VersionedStateEnvelope,
} from '../services/state-api.ts'
import { storeQueryOptions } from './use-store.ts'

const REQUEST_OPERATION_PATTERN = /^[a-z][a-z0-9-]{0,39}$/u
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function browserRandomUuid(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('Secure UUID generation is unavailable.')
  }
  return globalThis.crypto.randomUUID()
}

export function createVersionedRequestId(
  operation: string,
  randomUuid: () => string = browserRandomUuid,
): string {
  if (!REQUEST_OPERATION_PATTERN.test(operation)) {
    throw new Error('Versioned state operation is not valid.')
  }
  const uuid = randomUuid()
  if (!UUID_PATTERN.test(uuid)) throw new Error('Secure UUID generation failed.')
  return `web-${operation}:${uuid.toLowerCase()}`
}

export interface PreparedVersionedStateChange {
  readonly command: SaveStateCommand
}

export type VersionedStateUpdater = (baseStateCopy: LegacyStore) => LegacyStore

export function prepareVersionedStateChange(
  baseEnvelope: VersionedStateEnvelope,
  requestId: string,
  updateState: VersionedStateUpdater,
): PreparedVersionedStateChange {
  const baseState = parseLegacyStore(structuredClone(baseEnvelope.data))
  const updateInput = parseLegacyStore(structuredClone(baseEnvelope.data))
  const localState = parseLegacyStore(structuredClone(updateState(updateInput)))
  return {
    command: {
      baseState,
      localState,
      baseRevision: baseEnvelope.revision,
      baseHash: baseEnvelope.hash,
      requestId,
    },
  }
}

function confirmedEnvelope(result: {
  readonly revision: number
  readonly ts: number
  readonly hash: string
  readonly data: LegacyStore
}): StateEnvelope {
  return {
    revision: result.revision,
    ts: result.ts,
    hash: result.hash,
    data: result.data,
  }
}

export function useVersionedStateMutation(options: StateApiOptions = {}) {
  const queryClient = useQueryClient()
  const queryKey = storeQueryOptions(options).queryKey
  return useMutation({
    mutationKey: ['bat-melech', 'versioned-state-save', options.baseUrl ?? 'same-origin'],
    scope: { id: `bat-melech-versioned-state:${options.baseUrl ?? 'same-origin'}` },
    retry: false,
    mutationFn: (change: PreparedVersionedStateChange) => saveState(change.command, options),
    onSuccess: (result) => {
      if (result.ok) queryClient.setQueryData(queryKey, confirmedEnvelope(result))
    },
  })
}
