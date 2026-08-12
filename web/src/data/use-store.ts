import { queryOptions, useQuery } from '@tanstack/react-query'
import { loadState, type StateApiOptions } from '../services/state-api.ts'

export const STORE_QUERY_KEY = ['bat-melech', 'legacy-state'] as const

export function storeQueryOptions(options: StateApiOptions = {}) {
  return queryOptions({
    queryKey: [...STORE_QUERY_KEY, options.baseUrl ?? 'same-origin'] as const,
    queryFn: () => loadState(options),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
}

export function useStore(options: StateApiOptions = {}) {
  return useQuery(storeQueryOptions(options))
}
