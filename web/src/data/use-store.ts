import { queryOptions, useQuery } from '@tanstack/react-query'
import { loadState, type StateApiOptions } from '../services/state-api.ts'

export const STORE_QUERY_KEY = ['bat-melech', 'legacy-state'] as const
export const STORE_STALE_TIME_MS = 10_000
export const STORE_REFETCH_INTERVAL_MS = 30_000

export function storeQueryOptions(options: StateApiOptions = {}) {
  return queryOptions({
    queryKey: [...STORE_QUERY_KEY, options.baseUrl ?? 'same-origin'] as const,
    queryFn: () => loadState(options),
    staleTime: STORE_STALE_TIME_MS,
    refetchInterval: STORE_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnMount: true,
    refetchOnReconnect: 'always',
    refetchOnWindowFocus: 'always',
  })
}

export function useStore(options: StateApiOptions = {}) {
  return useQuery(storeQueryOptions(options))
}
