import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import {
  STORE_QUERY_KEY,
  STORE_REFETCH_INTERVAL_MS,
  STORE_STALE_TIME_MS,
  storeQueryOptions,
} from './use-store.ts'

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('store query', () => {
  it('loads the authenticated state envelope once through the shared GET query', async () => {
    const envelope = {
      ts: 1234,
      data: {
        orders: [{ id: 'o1', futureOrderField: { keep: true } }],
        futureTopLevel: { keep: true },
      },
    }
    const fetchMock = vi.fn(async (_url: string | URL | Request, request?: RequestInit) => {
      expect(request).toEqual(expect.objectContaining({ method: 'GET' }))
      expect(request?.body).toBeUndefined()
      return jsonResponse(envelope)
    })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const options = storeQueryOptions({ fetcher: fetchMock as typeof fetch })

    await expect(queryClient.fetchQuery(options)).resolves.toEqual(envelope)
    await expect(queryClient.fetchQuery(options)).resolves.toEqual(envelope)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses the configured base URL with bounded foreground and lifecycle refreshes', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ts: 1, data: { orders: [] } }))
    const options = storeQueryOptions({
      baseUrl: 'https://example.test/',
      fetcher: fetchMock as typeof fetch,
    })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    await queryClient.fetchQuery(options)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/api/state',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(options.queryKey).toEqual([...STORE_QUERY_KEY, 'https://example.test/'])
    expect(options.staleTime).toBe(STORE_STALE_TIME_MS)
    expect(options.refetchInterval).toBe(STORE_REFETCH_INTERVAL_MS)
    expect(options.refetchIntervalInBackground).toBe(false)
    expect(options.refetchOnMount).toBe(true)
    expect(options.refetchOnReconnect).toBe('always')
    expect(options.refetchOnWindowFocus).toBe('always')
  })
})
