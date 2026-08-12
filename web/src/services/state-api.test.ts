import { describe, expect, it, vi } from 'vitest'
import { parseLegacyStore } from '../domain/store.ts'
import {
  isVersionedStateEnvelope,
  loadState,
  saveState,
  StateApiError,
  type SaveStateCommand,
} from './state-api.ts'

const BASE_HASH = 'a'.repeat(64)
const SAVED_HASH = 'b'.repeat(64)

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('legacy store compatibility', () => {
  it('round-trips unknown store and order fields without dropping them', () => {
    const original = {
      orders: [
        {
          id: 'o1',
          name: 'Test customer',
          futureOrderField: { nested: ['kept'] },
        },
      ],
      settings: { maxMeals: 12, futureSetting: true },
      futureTopLevel: { version: 7 },
    }

    expect(parseLegacyStore(original)).toEqual(original)
  })
})

describe('state API', () => {
  it('loads and validates the existing state envelope', async () => {
    const data = {
      orders: [{ id: 'o1', name: 'Test customer', unknown: 'preserved' }],
      futureTopLevel: 42,
    }
    const fetcher = vi.fn(async () => jsonResponse({ ts: 1234, data })) as unknown as typeof fetch

    await expect(loadState({ fetcher })).resolves.toEqual({ ts: 1234, data })
    expect(fetcher).toHaveBeenCalledWith('/api/state', expect.objectContaining({ method: 'GET' }))
  })

  it('uses an origin-qualified same-origin URL in the browser so Basic Auth URL credentials do not break fetch', async () => {
    const originalWindow = globalThis.window
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { origin: 'https://app.example.test' } },
    })
    const fetcher = vi.fn(async () => jsonResponse({ ts: 1234, data: { orders: [] } })) as unknown as typeof fetch

    try {
      await loadState({ fetcher })
    } finally {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
    }

    expect(fetcher).toHaveBeenCalledWith(
      'https://app.example.test/api/state',
      expect.objectContaining({ method: 'GET', credentials: 'same-origin' }),
    )
  })

  it('saves the complete store without stripping unknown fields', async () => {
    const baseState = parseLegacyStore({
      orders: [{ id: 'o1', futureOrderField: 'old' }],
      futureTopLevel: { keep: true },
    })
    const localState = parseLegacyStore({
      orders: [{ id: 'o1', futureOrderField: 'kept' }],
      futureTopLevel: { keep: true },
    })
    const command: SaveStateCommand = {
      baseState,
      localState,
      baseRevision: 1234,
      baseHash: BASE_HASH,
      requestId: 'browser-request-1',
    }
    const saved = {
      ok: true as const,
      revision: 5678,
      ts: 5678,
      hash: SAVED_HASH,
      data: localState,
      idempotent: false,
    }
    const fetchMock = vi.fn(async () => jsonResponse(saved))
    const fetcher = fetchMock as unknown as typeof fetch

    await expect(saveState(command, { fetcher })).resolves.toEqual(saved)
    const [, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(request.body))).toEqual(command)
  })

  it('returns a structured conflict without treating HTTP 409 as a transport failure', async () => {
    const remoteState = parseLegacyStore({ orders: [{ id: 'remote-order' }] })
    const conflict = {
      ok: false as const,
      conflict: {
        kind: 'merge-conflict' as const,
        conflicts: [{ path: ['orders', 'o1', 'total'] }],
        actualRevision: 5679,
        actualHash: SAVED_HASH,
        remoteState,
      },
      stage: 'merge' as const,
      idempotent: false,
    }
    const fetcher = vi.fn(async () => jsonResponse(conflict, 409)) as unknown as typeof fetch
    const command: SaveStateCommand = {
      baseState: remoteState,
      localState: remoteState,
      baseRevision: 5678,
      baseHash: BASE_HASH,
      requestId: 'browser-request-2',
    }

    await expect(saveState(command, { fetcher })).resolves.toEqual(conflict)
  })

  it('rejects malformed commands before contacting the server', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    const malformed = {
      baseState: { orders: [] },
      localState: { orders: [] },
      baseRevision: 1,
      baseHash: 'not-a-hash',
      requestId: 'request-3',
    } as SaveStateCommand

    await expect(saveState(malformed, { fetcher })).rejects.toEqual(
      new StateApiError('INVALID_RESPONSE', 0),
    )
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('distinguishes version-bound envelopes from the temporary legacy read shape', () => {
    expect(isVersionedStateEnvelope({
      revision: 1234,
      ts: 1234,
      hash: BASE_HASH,
      data: { orders: [] },
    })).toBe(true)
    expect(isVersionedStateEnvelope({ ts: 1234, data: { orders: [] } })).toBe(false)
  })

  it('rejects malformed JSON responses', async () => {
    const fetcher = vi.fn(async () => new Response('{', { status: 200 })) as unknown as typeof fetch

    await expect(loadState({ fetcher })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      status: 200,
    })
  })

  it('rejects envelopes that do not match the production contract', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ ts: 'not-a-number', data: {} })) as unknown as typeof fetch

    await expect(loadState({ fetcher })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      status: 200,
    })
  })

  it('reports server errors without exposing response bodies', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ error: 'private detail' }, 503)) as unknown as typeof fetch

    await expect(loadState({ fetcher })).rejects.toEqual(new StateApiError('HTTP_ERROR', 503))
  })

  it('rejects malformed conflict responses instead of guessing whether state was saved', async () => {
    const store = parseLegacyStore({ orders: [] })
    const fetcher = vi.fn(async () => jsonResponse({
      ok: false,
      conflict: { kind: 'merge-conflict', conflicts: [] },
      idempotent: false,
    }, 409)) as unknown as typeof fetch

    await expect(saveState({
      baseState: store,
      localState: store,
      baseRevision: 0,
      baseHash: BASE_HASH,
      requestId: 'request-4',
    }, { fetcher })).rejects.toEqual(new StateApiError('INVALID_RESPONSE', 409))
  })
})
