import { z } from 'zod'

const CsrfTokenSchema = z.string().min(32).max(512)
const UsernameSchema = z.string().min(1).max(128)

const AuthSessionSchema = z
  .object({
    authenticated: z.boolean(),
    csrfToken: CsrfTokenSchema,
    username: UsernameSchema.optional(),
  })
  .strict()
  .superRefine((session, context) => {
    if (session.authenticated && session.username === undefined) {
      context.addIssue({ code: 'custom', message: 'Authenticated session requires a username.' })
    }
    if (!session.authenticated && session.username !== undefined) {
      context.addIssue({ code: 'custom', message: 'Anonymous session cannot expose a username.' })
    }
  })

const RecoveredUsernameSchema = z.object({ username: UsernameSchema }).strict()
const ResetSuccessSchema = z.object({ ok: z.literal(true) }).strict()

export type AuthSession = z.infer<typeof AuthSessionSchema>

export type AuthApiErrorCode =
  | 'HTTP_ERROR'
  | 'INVALID_RESPONSE'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_RECOVERY_CODE'
  | 'RATE_LIMITED'

export class AuthApiError extends Error {
  readonly code: AuthApiErrorCode
  readonly status: number

  constructor(code: AuthApiErrorCode, status: number) {
    super('The authentication request failed.')
    this.name = 'AuthApiError'
    this.code = code
    this.status = status
  }
}

export interface AuthApiOptions {
  baseUrl?: string
  fetcher?: typeof fetch
}

const csrfTokens = new Map<string, string>()

function resolvedBaseUrl(baseUrl?: string): string {
  if (baseUrl !== undefined) return baseUrl.replace(/\/$/u, '')
  if (typeof window === 'undefined') return ''
  return window.location.origin
}

function authUrl(path: string, baseUrl?: string): string {
  return `${resolvedBaseUrl(baseUrl)}/api/auth${path}`
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new AuthApiError('INVALID_RESPONSE', response.status)
  }
}

function rememberSession(session: AuthSession, baseUrl?: string): AuthSession {
  csrfTokens.set(resolvedBaseUrl(baseUrl), session.csrfToken)
  return session
}

function classifyHttpError(status: number, recovery: boolean): AuthApiError {
  if (status === 429) return new AuthApiError('RATE_LIMITED', status)
  if (status === 401) {
    return new AuthApiError(
      recovery ? 'INVALID_RECOVERY_CODE' : 'INVALID_CREDENTIALS',
      status,
    )
  }
  return new AuthApiError('HTTP_ERROR', status)
}

export async function loadAuthSession(options: AuthApiOptions = {}): Promise<AuthSession> {
  const fetcher = options.fetcher ?? fetch
  const response = await fetcher(authUrl('/session', options.baseUrl), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
  })
  if (!response.ok) throw classifyHttpError(response.status, false)

  const result = AuthSessionSchema.safeParse(await readJson(response))
  if (!result.success) throw new AuthApiError('INVALID_RESPONSE', response.status)
  return rememberSession(result.data, options.baseUrl)
}

async function csrfToken(options: AuthApiOptions): Promise<string> {
  const baseUrl = resolvedBaseUrl(options.baseUrl)
  const cached = csrfTokens.get(baseUrl)
  if (cached !== undefined) return cached
  return (await loadAuthSession(options)).csrfToken
}

async function postJson(
  path: string,
  body: unknown,
  options: AuthApiOptions,
  recovery: boolean,
): Promise<Response> {
  const fetcher = options.fetcher ?? fetch
  const response = await fetcher(authUrl(path, options.baseUrl), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-CSRF-Token': await csrfToken(options),
    },
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify(body),
  })
  if (!response.ok) throw classifyHttpError(response.status, recovery)
  return response
}

export async function login(
  username: string,
  password: string,
  options: AuthApiOptions = {},
): Promise<AuthSession> {
  const response = await postJson('/login', { username, password }, options, false)
  const result = AuthSessionSchema.safeParse(await readJson(response))
  if (!result.success || !result.data.authenticated) {
    throw new AuthApiError('INVALID_RESPONSE', response.status)
  }
  return rememberSession(result.data, options.baseUrl)
}

export async function logout(options: AuthApiOptions = {}): Promise<void> {
  const response = await postJson('/logout', {}, options, false)
  if (response.status !== 204) throw new AuthApiError('INVALID_RESPONSE', response.status)
  csrfTokens.delete(resolvedBaseUrl(options.baseUrl))
}

export async function recoverUsername(
  recoveryCode: string,
  options: AuthApiOptions = {},
): Promise<string> {
  const response = await postJson('/recover-username', { recoveryCode }, options, true)
  const result = RecoveredUsernameSchema.safeParse(await readJson(response))
  if (!result.success) throw new AuthApiError('INVALID_RESPONSE', response.status)
  return result.data.username
}

export async function resetPassword(
  recoveryCode: string,
  newPassword: string,
  options: AuthApiOptions = {},
): Promise<void> {
  const response = await postJson('/reset-password', { recoveryCode, newPassword }, options, true)
  const result = ResetSuccessSchema.safeParse(await readJson(response))
  if (!result.success) throw new AuthApiError('INVALID_RESPONSE', response.status)
  csrfTokens.delete(resolvedBaseUrl(options.baseUrl))
}

export async function authenticatedFetch(
  input: string | URL,
  init: RequestInit = {},
  options: AuthApiOptions = {},
): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers.set('X-CSRF-Token', await csrfToken(options))
  }

  return (options.fetcher ?? fetch)(input, {
    ...init,
    headers,
    credentials: init.credentials ?? 'same-origin',
    cache: init.cache ?? 'no-store',
  })
}

export function clearAuthApiMemory(): void {
  csrfTokens.clear()
}
