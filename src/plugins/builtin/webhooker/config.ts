













import type { PluginConfigErrorCode } from '../../jobs/types.ts'
import type { FilterConfig } from '../../types.ts'
import type { WebhookerConfig, WebhookerConfigResult, WebhookerHeaderValue } from './types.ts'


export const WEBHOOKER_MODULE_PATH = 'builtin/webhooker'


export const DEFAULT_WEBHOOKER_TIMEOUT_MS = 3000


export const WEBHOOKER_MAX_TIMEOUT_MS = 120_000


const TEMPLATE_PATTERN = /#\{[^}]*\}/g


const HTTP_TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(errorCode: PluginConfigErrorCode = 'config'): WebhookerConfigResult {
  return { ok: false, errorCode }
}

function isHeaderValue(value: unknown): value is WebhookerHeaderValue {
  return (
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
  )
}






function isValidTargetUrlTemplate(value: string): boolean {
  const substituted = value.replace(TEMPLATE_PATTERN, 'w')
  try {
    const url = new URL(substituted)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}











function resolveHeaders(
  raw: unknown
): { headers?: Record<string, WebhookerHeaderValue>; authorizationCount: number } | null {
  if (raw === undefined) return { authorizationCount: 0 }

  if (!isRecord(raw)) return null
  const headers: Record<string, WebhookerHeaderValue> = {}
  let authorizationCount = 0
  for (const [name, value] of Object.entries(raw)) {
    if (!HTTP_TOKEN_PATTERN.test(name)) return null
    if (!isHeaderValue(value)) return null
    if (name.toLowerCase() === 'authorization') authorizationCount += 1
    headers[name] = value
  }
  return { headers, authorizationCount }
}


function resolveFilter(raw: unknown): { filter?: FilterConfig } | null {
  if (raw === undefined) return {}
  if (!isRecord(raw)) return null

  const filter: FilterConfig = {}
  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags) || !raw.tags.every((tag) => typeof tag === 'string')) {
      return null
    }
    filter.tags = raw.tags
  }
  if (raw.minPriority !== undefined) {
    if (typeof raw.minPriority !== 'number' || !Number.isFinite(raw.minPriority)) return null
    filter.minPriority = raw.minPriority
  }
  return { filter }
}










export function isAuthTokenDeclared(raw: unknown): boolean {
  if (!isRecord(raw)) return false
  const value = raw.authToken
  if (value === undefined || value === null) return false
  if (typeof value !== 'string') return false
  return value !== ''
}

export function resolveWebhookerConfig(raw: unknown): WebhookerConfigResult {
  if (!isRecord(raw)) return fail()


  if (typeof raw.targetUrl !== 'string' || raw.targetUrl.trim() === '') return fail()
  const targetUrl = raw.targetUrl.trim()
  if (!isValidTargetUrlTemplate(targetUrl)) return fail()


  let method = 'POST'
  if (raw.method !== undefined) {
    if (typeof raw.method !== 'string' || !HTTP_TOKEN_PATTERN.test(raw.method)) return fail()
    method = raw.method
  }


  let timeoutMs = DEFAULT_WEBHOOKER_TIMEOUT_MS
  if (raw.timeoutMs !== undefined) {
    if (
      typeof raw.timeoutMs !== 'number' ||
      !Number.isInteger(raw.timeoutMs) ||
      raw.timeoutMs < 1 ||
      raw.timeoutMs > WEBHOOKER_MAX_TIMEOUT_MS
    ) {
      return fail()
    }
    timeoutMs = raw.timeoutMs
  }


  const resolvedHeaders = resolveHeaders(raw.headers)
  if (resolvedHeaders === null) return fail()



  const hasAuthToken = isAuthTokenDeclared(raw)
  if (raw.authToken !== undefined && raw.authToken !== null) {
    if (typeof raw.authToken !== 'string') return fail()
  }
  if (hasAuthToken && resolvedHeaders.authorizationCount > 0) return fail()
  if (resolvedHeaders.authorizationCount > 1) return fail()


  let body: string | undefined
  if (raw.body !== undefined) {
    if (typeof raw.body !== 'string') return fail()
    body = raw.body
  }


  const resolvedFilter = resolveFilter(raw.filter)
  if (resolvedFilter === null) return fail()

  const config: WebhookerConfig = { targetUrl, method, timeoutMs }
  if (resolvedHeaders.headers !== undefined) config.headers = resolvedHeaders.headers
  if (body !== undefined) config.body = body
  if (resolvedFilter.filter !== undefined) config.filter = resolvedFilter.filter

  return { ok: true, config }
}
