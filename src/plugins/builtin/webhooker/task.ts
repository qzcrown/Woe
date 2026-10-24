















import {
  MAX_TIMEOUT_MS,
  OutboundHttpError,
  type OutboundHttpErrorCode
} from '../../../services/http/outboundPolicy.ts'
import { parseRetryAfterMs } from '../../../services/http/retryAfter.ts'
import { PluginSecretError } from '../../../services/pluginSecretService.ts'
import type {
  PluginHostContext,
  PluginJobErrorCode,
  PluginTask,
  PluginTaskResult
} from '../../jobs/types.ts'
import type { WebhookerConfig, WebhookerPayload } from './types.ts'







const OUTBOUND_FAILURE_MAP: Record<
  OutboundHttpErrorCode,
  { errorCode: PluginJobErrorCode; retriable: boolean; consumed: boolean }
> = {
  invalid: { errorCode: 'outbound-blocked', retriable: false, consumed: false },
  insecure: { errorCode: 'outbound-blocked', retriable: false, consumed: false },
  userinfo: { errorCode: 'outbound-blocked', retriable: false, consumed: false },
  query: { errorCode: 'outbound-blocked', retriable: false, consumed: false },
  fragment: { errorCode: 'outbound-blocked', retriable: false, consumed: false },
  traversal: { errorCode: 'outbound-blocked', retriable: false, consumed: false },
  'private-host': { errorCode: 'outbound-blocked', retriable: false, consumed: false },
  'invalid-timeout': { errorCode: 'config', retriable: false, consumed: false },
  timeout: { errorCode: 'provider-timeout', retriable: true, consumed: true },
  network: { errorCode: 'provider-network', retriable: true, consumed: true },

  'too-large': { errorCode: 'downstream-rejected', retriable: false, consumed: true }
}

export interface CreateWebhookerTaskInput {

  config: WebhookerConfig

  authTokenDeclared: boolean

  payload: unknown
  host: PluginHostContext
}


function parseWebhookerPayload(raw: unknown): WebhookerPayload | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const { url, method, headers, body } = raw as Record<string, unknown>
  if (typeof url !== 'string' || url === '') return null
  if (typeof method !== 'string' || method === '') return null
  if (typeof body !== 'string') return null
  if (typeof headers !== 'object' || headers === null || Array.isArray(headers)) return null
  for (const value of Object.values(headers)) {
    if (typeof value !== 'string') return null
  }
  return { url, method, headers: headers as Record<string, string>, body }
}


function hasAuthorizationHeader(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((name) => name.toLowerCase() === 'authorization')
}


function preFetchFailure(errorCode: PluginJobErrorCode): PluginTaskResult {
  return { ok: false, failure: { errorCode, retriable: false }, quotaConsumed: false }
}





function mapResponseStatus(response: Response): PluginTaskResult {
  const status = response.status
  const failure = (
    errorCode: PluginJobErrorCode,
    retriable: boolean,
    extra: { retryAfterMs?: number } = {}
  ): PluginTaskResult => ({
    ok: false,
    failure: { errorCode, retriable, httpStatus: status, ...extra },
    quotaConsumed: true
  })

  if (status >= 200 && status < 300) {
    return { ok: true, result: { status: 'sent', httpStatus: status }, quotaConsumed: true }
  }
  if (status === 401 || status === 403) return failure('provider-auth', false)
  if (status === 429) {
    const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'), Date.now())
    return failure('provider-rate-limit', true, retryAfterMs === undefined ? {} : { retryAfterMs })
  }
  if (status >= 500) return failure('provider-network', true)

  return failure('downstream-rejected', false)
}

export function createWebhookerTask(input: CreateWebhookerTaskInput): PluginTask {
  const { config, authTokenDeclared, payload, host } = input

  return {
    async run({ timeoutMs: budgetMs }): Promise<PluginTaskResult> {

      const snapshot = parseWebhookerPayload(payload)
      if (!snapshot) return preFetchFailure('config')



      const effectiveTimeoutMs = Math.min(config.timeoutMs, budgetMs)
      if (
        !Number.isInteger(effectiveTimeoutMs) ||
        effectiveTimeoutMs <= 0 ||
        effectiveTimeoutMs > MAX_TIMEOUT_MS
      ) {
        return preFetchFailure('config')
      }



      const headers: Record<string, string> = { ...snapshot.headers }
      if (!hasAuthorizationHeader(headers) && authTokenDeclared) {
        let token: string | null
        try {
          token = await host.secrets.get('authToken')
        } catch (error) {

          if (!(error instanceof PluginSecretError)) throw error
          return preFetchFailure('secret-decrypt-failed')
        }



        if (token === null || token === '') return preFetchFailure('config')
        headers.Authorization = `Bearer ${token}`
      }


      let response: Response
      try {
        response = await host.http.fetch({
          url: snapshot.url,
          method: snapshot.method,
          headers,
          body: snapshot.body,
          timeoutMs: effectiveTimeoutMs
        })
      } catch (error) {
        if (!(error instanceof OutboundHttpError)) throw error
        const mapped = OUTBOUND_FAILURE_MAP[error.code]
        return {
          ok: false,
          failure: { errorCode: mapped.errorCode, retriable: mapped.retriable },
          quotaConsumed: mapped.consumed
        }
      }

      return mapResponseStatus(response)
    }
  }
}
