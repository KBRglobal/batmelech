// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LegacyStore } from '../domain/store.ts'
import type { VersionedStateEnvelope } from '../services/state-api.ts'
import { STORE_QUERY_KEY } from './use-store.ts'
import useVersionedScreenSave from './versioned-screen-save.tsx'

const HASH = 'a'.repeat(64)
const baseStore: LegacyStore = { orders: [], settings: { maxMeals: 8 } }

function initialEnvelope(): VersionedStateEnvelope {
  return {
    revision: 7,
    ts: 7,
    hash: HASH,
    data: baseStore,
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function setup(fetcher: typeof fetch) {
  vi.stubGlobal('fetch', fetcher)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const baseEnvelope = initialEnvelope()
  queryClient.setQueryData([...STORE_QUERY_KEY, 'same-origin'], baseEnvelope)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return {
    hook: renderHook(() => useVersionedScreenSave(), { wrapper }),
    queryClient,
    baseEnvelope,
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useVersionedScreenSave', () => {
  it('returns and caches the exact merged server envelope while exposing no restore write', async () => {
    const nextStore: LegacyStore = { orders: [], settings: { maxMeals: 10 } }
    const mergedStore: LegacyStore = {
      ...nextStore,
      remoteOnly: { keep: true },
    }
    const confirmedEnvelope: VersionedStateEnvelope = {
      revision: 8,
      ts: 8,
      hash: 'b'.repeat(64),
      data: mergedStore,
    }
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(initialEnvelope()))
      .mockResolvedValueOnce(jsonResponse({ ok: true, idempotent: false, ...confirmedEnvelope }))
    const { hook: { result }, queryClient, baseEnvelope } = setup(fetcher)

    expect(result.current.onRestore).toBeUndefined()
    let saved: VersionedStateEnvelope | undefined
    await act(async () => {
      saved = await result.current.onSave({ reason: 'settings', baseEnvelope, baseStore, nextStore })
    })

    expect(saved).toEqual(confirmedEnvelope)
    expect(queryClient.getQueryData([...STORE_QUERY_KEY, 'same-origin'])).toEqual(confirmedEnvelope)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', cache: 'no-store' })
    const init = fetcher.mock.calls[1]?.[1]
    const body = JSON.parse(String(init?.body))
    expect(body).toMatchObject({
      baseRevision: 7,
      baseHash: HASH,
      baseState: baseStore,
      localState: nextStore,
    })
    expect(body.requestId).toMatch(/^web-settings:/)
  })

  it('rejects a stale screen before any state write', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const { hook: { result }, baseEnvelope } = setup(fetcher)

    await expect(
      result.current.onSave({
        reason: 'menu',
        baseEnvelope,
        baseStore: { orders: [], settings: { maxMeals: 7 } },
        nextStore: baseStore,
      }),
    ).rejects.toThrow('The submitted screen base does not match its envelope.')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects the captured screen envelope after a byte-identical newer revision without writing', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const { hook, queryClient, baseEnvelope } = setup(fetcher)
    const { result } = hook
    const nextStore: LegacyStore = { orders: [], settings: { maxMeals: 10 } }

    act(() => {
      queryClient.setQueryData([...STORE_QUERY_KEY, 'same-origin'], {
        ...baseEnvelope,
        revision: 8,
        ts: 8,
      })
    })
    hook.rerender()

    await expect(
      result.current.onSave({ reason: 'settings', baseEnvelope, baseStore, nextStore }),
    ).rejects.toThrow('The screen base is stale.')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects unseen cross-tab drift after the mandatory live refetch without posting', async () => {
    const changedEnvelope = {
      ...initialEnvelope(),
      revision: 8,
      ts: 8,
      hash: 'b'.repeat(64),
      data: { orders: [], settings: { maxMeals: 11 } },
    }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(changedEnvelope))
    const { hook: { result }, baseEnvelope } = setup(fetcher)

    await expect(result.current.onSave({
      reason: 'settings',
      baseEnvelope,
      baseStore,
      nextStore: { orders: [], settings: { maxMeals: 10 } },
    })).rejects.toThrow('The screen base changed remotely.')

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'GET' })
  })

  it('does not fall back to cached state when the live refetch fails', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('network'))
    const { hook: { result }, baseEnvelope } = setup(fetcher)

    await expect(result.current.onSave({
      reason: 'settings',
      baseEnvelope,
      baseStore,
      nextStore: { orders: [], settings: { maxMeals: 10 } },
    })).rejects.toThrow('network')

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('keeps the same idempotency key after a network failure', async () => {
    const nextStore: LegacyStore = { orders: [], settings: { maxMeals: 9 } }
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(initialEnvelope()))
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(jsonResponse({ ok: true, idempotent: true, revision: 8, ts: 8, hash: 'b'.repeat(64), data: nextStore }))
    const { hook: { result }, baseEnvelope } = setup(fetcher)

    await expect(result.current.onSave({ reason: 'recipes', baseEnvelope, baseStore, nextStore })).rejects.toThrow()
    let replayed: VersionedStateEnvelope | undefined
    await act(async () => {
      replayed = await result.current.onSave({ reason: 'recipes', baseEnvelope, baseStore, nextStore })
    })

    expect(replayed).toEqual({
      revision: 8,
      ts: 8,
      hash: 'b'.repeat(64),
      data: nextStore,
    })
    const first = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))
    const second = JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))
    expect(second.requestId).toBe(first.requestId)
    expect(second).toEqual(first)
    expect(fetcher.mock.calls[2]?.[1]).toMatchObject({ method: 'POST' })
  })

  it('replays a committed request before stale preflight when the first response is lost', async () => {
    const nextStore: LegacyStore = { orders: [], settings: { maxMeals: 9 } }
    const committedEnvelope = {
      ok: true as const,
      idempotent: true,
      revision: 8,
      ts: 8,
      hash: 'b'.repeat(64),
      data: nextStore,
    }
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(initialEnvelope()))
      .mockRejectedValueOnce(new TypeError('response lost'))
      .mockResolvedValueOnce(jsonResponse(committedEnvelope))
    const { hook, queryClient, baseEnvelope } = setup(fetcher)

    await expect(hook.result.current.onSave({
      reason: 'settings',
      baseEnvelope,
      baseStore,
      nextStore,
    })).rejects.toThrow('response lost')

    act(() => {
      queryClient.setQueryData([...STORE_QUERY_KEY, 'same-origin'], committedEnvelope)
    })
    hook.rerender()
    await act(async () => {
      await hook.result.current.onSave({ reason: 'settings', baseEnvelope, baseStore, nextStore })
    })

    expect(fetcher).toHaveBeenCalledTimes(3)
    const first = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))
    const replay = JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))
    expect(replay).toEqual(first)
    expect(replay.requestId).toBe(first.requestId)
    expect(fetcher.mock.calls.slice(1).every(([, init]) => init?.method === 'POST')).toBe(true)
  })

  it('uses a new idempotency key when the draft changes after a failed request', async () => {
    const firstStore: LegacyStore = { orders: [], settings: { maxMeals: 9 } }
    const secondStore: LegacyStore = { orders: [], settings: { maxMeals: 10 } }
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(initialEnvelope()))
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(jsonResponse(initialEnvelope()))
      .mockResolvedValueOnce(jsonResponse({ ok: true, idempotent: false, revision: 8, ts: 8, hash: 'b'.repeat(64), data: secondStore }))
    const { hook: { result }, baseEnvelope } = setup(fetcher)

    await expect(result.current.onSave({ reason: 'settings', baseEnvelope, baseStore, nextStore: firstStore })).rejects.toThrow()
    await act(async () => {
      await result.current.onSave({ reason: 'settings', baseEnvelope, baseStore, nextStore: secondStore })
    })

    const first = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))
    const second = JSON.parse(String(fetcher.mock.calls[3]?.[1]?.body))
    expect(second.requestId).not.toBe(first.requestId)
    expect(second.localState).toEqual(secondStore)
  })
})
