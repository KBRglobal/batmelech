import { useRef } from 'react'
import type { RestoreRequestHandler } from '../domain/settings-backup.ts'
import type { StoreSaveRequest } from '../domain/settings-catalog.ts'
import {
  isVersionedStateEnvelope,
  type StateEnvelope,
  type VersionedStateEnvelope,
} from '../services/state-api.ts'
import { useStore } from './use-store.ts'
import {
  createVersionedRequestId,
  prepareVersionedStateChange,
  type PreparedVersionedStateChange,
  useVersionedStateMutation,
} from './use-save-order.ts'

export interface VersionedScreenSaveBindings {
  readonly onSave: VersionedScreenSaveHandler
  readonly onRestore?: RestoreRequestHandler
}

export type ConfirmedStoreSaveHandler = (
  request: StoreSaveRequest,
) => Promise<VersionedStateEnvelope>

export type VersionedScreenSaveHandler = ConfirmedStoreSaveHandler

export function isSameVersionedStateEnvelope(
  current: StateEnvelope | undefined,
  base: Readonly<VersionedStateEnvelope>,
): boolean {
  return Boolean(
    current &&
      isVersionedStateEnvelope(current) &&
      current.revision === base.revision &&
      current.hash === base.hash &&
      current.ts === base.ts &&
      JSON.stringify(current.data) === JSON.stringify(base.data),
  )
}

export default function useVersionedScreenSave(): VersionedScreenSaveBindings {
  const storeQuery = useStore()
  const mutation = useVersionedStateMutation()
  const pendingRequest = useRef<{
    readonly fingerprint: string
    readonly change: PreparedVersionedStateChange
  } | null>(null)

  async function onSave({
    reason,
    baseEnvelope,
    baseStore,
    nextStore,
  }: StoreSaveRequest): Promise<VersionedStateEnvelope> {
    if (!isVersionedStateEnvelope(baseEnvelope)) {
      throw new Error('Versioned state is unavailable.')
    }
    if (JSON.stringify(baseEnvelope.data) !== JSON.stringify(baseStore)) {
      throw new Error('The submitted screen base does not match its envelope.')
    }
    const fingerprint = JSON.stringify({
      reason,
      baseRevision: baseEnvelope.revision,
      baseHash: baseEnvelope.hash,
      baseStore,
      nextStore,
    })
    if (pendingRequest.current?.fingerprint === fingerprint) {
      const replay = await mutation.mutateAsync(pendingRequest.current.change)
      if (!replay.ok) {
        pendingRequest.current = null
        throw new Error('The state change conflicted.')
      }
      pendingRequest.current = null
      return {
        revision: replay.revision,
        ts: replay.ts,
        hash: replay.hash,
        data: replay.data,
      }
    }

    if (!isSameVersionedStateEnvelope(storeQuery.data, baseEnvelope)) {
      throw new Error('The screen base is stale.')
    }
    const refreshed = await storeQuery.refetch({ throwOnError: true })
    if (!isSameVersionedStateEnvelope(refreshed.data, baseEnvelope)) {
      throw new Error('The screen base changed remotely.')
    }

    const change = prepareVersionedStateChange(
      baseEnvelope,
      createVersionedRequestId(reason),
      () => structuredClone(nextStore),
    )
    pendingRequest.current = { fingerprint, change }
    const result = await mutation.mutateAsync(change)
    if (!result.ok) {
      pendingRequest.current = null
      throw new Error('The state change conflicted.')
    }
    pendingRequest.current = null
    return {
      revision: result.revision,
      ts: result.ts,
      hash: result.hash,
      data: result.data,
    }
  }

  return { onSave }
}
