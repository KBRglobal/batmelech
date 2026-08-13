import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  loadAuthSession,
  login,
  logout,
  recoverUsername,
  resetPassword,
  type AuthSession,
} from '../services/auth-api.ts'

export const AUTH_QUERY_KEY = ['bat-melech', 'auth-session'] as const

export function authQueryOptions() {
  return queryOptions({
    queryKey: AUTH_QUERY_KEY,
    queryFn: () => loadAuthSession(),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnMount: true,
    refetchOnReconnect: 'always',
    refetchOnWindowFocus: 'always',
  })
}

export function useAuthSession() {
  return useQuery(authQueryOptions())
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      login(username, password),
    onSuccess: (session) => {
      queryClient.setQueryData<AuthSession>(AUTH_QUERY_KEY, session)
    },
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => logout(),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: AUTH_QUERY_KEY })
      queryClient.removeQueries({ queryKey: ['bat-melech', 'legacy-state'] })
    },
  })
}

export function useRecoverUsername() {
  return useMutation({ mutationFn: (recoveryCode: string) => recoverUsername(recoveryCode) })
}

export function useResetPassword() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ recoveryCode, newPassword }: { recoveryCode: string; newPassword: string }) =>
      resetPassword(recoveryCode, newPassword),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: AUTH_QUERY_KEY })
      queryClient.removeQueries({ queryKey: ['bat-melech', 'legacy-state'] })
    },
  })
}
