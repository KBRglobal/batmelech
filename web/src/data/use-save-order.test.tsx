// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VersionedStateEnvelope } from '../services/state-api.ts'
import { storeQueryOptions } from './use-store.ts'
import {
  createVersionedRequestId,
  prepareVersionedStateChange,
  useVersionedStateMutation,
} from './use-save-order.ts'

const BASE_HASH = 'a'.repeat(64)
const SAVED_HASH = 'b'.repeat(64)
const UUID = '123e4567-e89b-42d3-a456-426614174000'

function envelope(): VersionedStateEnvelope {
  return {
    revision: 9,
    ts: 9,
    hash: BASE_HASH,
    data: {
      orders: [{ id: 'order-existing', futureOrderField: { keep: true } }],
      futureTopLevel: { keep: true },
    },
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('reusable versioned-state save primitive', () => {
  it('creates bounded secure request IDs and rejects malformed inputs', () => {
    expect(createVersionedRequestId('order-create', () => UUID)).toBe(`web-order-create:${UUID}`)
    expect(() => createVersionedRequestId('NOT VALID', () => UUID)).toThrow()
    expect(() => createVersionedRequestId('order-create', () => 'predictable')).toThrow()
  })

  it('binds the command to an immutable copy of the original envelope', () => {
    const base = envelope()
    const change = prepareVersionedStateChange(base, `web-order-edit:${UUID}`, (state) => {
      state.orders[0]!.name = 'edited'
      return state
    })

    expect(change.command).toMatchObject({
      baseRevision: 9,
      baseHash: BASE_HASH,
      requestId: `web-order-edit:${UUID}`,
      baseState: { orders: [{ id: 'order-existing', futureOrderField: { keep: true } }] },
      localState: { orders: [{ id: 'order-existing', name: 'edited', futureOrderField: { keep: true } }] },
    })
    expect(base.data.orders[0]).toEqual({ id: 'order-existing', futureOrderField: { keep: true } })
    ;(base.data.orders[0] as Record<string, unknown>).lateMutation = true
    expect(change.command.baseState.orders[0]).not.toHaveProperty('lateMutation')
  })

  it('posts once without retry and updates the matching cache only after confirmed success', async () => {
    const base = envelope()
    const localState = { ...base.data, orders: [...base.data.orders, { id: 'order-new' }] }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        idempotent: false,
        revision: 10,
        ts: 10,
        hash: SAVED_HASH,
        data: localState,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    queryClient.setQueryData(storeQueryOptions().queryKey, base)
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useVersionedStateMutation(), { wrapper })
    const change = prepareVersionedStateChange(base, `web-order-create:${UUID}`, () => localState)

    await act(async () => {
      await result.current.mutateAsync(change)
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryData(storeQueryOptions().queryKey)).toEqual({
      revision: 10,
      ts: 10,
      hash: SAVED_HASH,
      data: localState,
    })
  })

  it('leaves the cached base untouched when the server reports a conflict', async () => {
    const base = envelope()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        ok: false,
        idempotent: false,
        stage: 'merge',
        conflict: {
          kind: 'merge-conflict',
          conflicts: [{ path: '$.orders[id="order-existing"].name' }],
          actualRevision: 10,
          actualHash: SAVED_HASH,
          remoteState: base.data,
        },
      }), { status: 409, headers: { 'Content-Type': 'application/json' } }),
    )
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    queryClient.setQueryData(storeQueryOptions().queryKey, base)
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useVersionedStateMutation(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(
        prepareVersionedStateChange(base, `web-order-edit:${UUID}`, (state) => state),
      )
    })

    expect(queryClient.getQueryData(storeQueryOptions().queryKey)).toEqual(base)
  })
})
