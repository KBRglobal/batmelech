import { describe, expect, it, vi } from 'vitest'
import { parseLegacyStore } from '../domain/store.ts'
import { loadState, saveState, StateApiError } from './state-api.ts'

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
    const data = parseLegacyStore({
      orders: [{ id: 'o1', futureOrderField: 'kept' }],
      futureTopLevel: { keep: true },
    })
    const fetchMock = vi.fn(async () => jsonResponse({ ts: 5678 }))
    const fetcher = fetchMock as unknown as typeof fetch

    await expect(saveState(data, { fetcher })).resolves.toEqual({ ts: 5678 })
    const [, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(request.body))).toEqual({ data })
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
})
