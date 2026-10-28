











import type {
  AiProvider,
  AiProviderFailureKind,
  AiProviderRequest,
  AiProviderResult,
  AiRuntimeBinding,
  OutboundHttp
} from '../contracts.ts'
import {
  mapHttpStatusToFailureKind,
  parseOpenAiChatCompletion
} from '../envelope.ts'
import { buildReasoningWire, resolveDialect } from '../providerDialects.ts'
import { parseRetryAfterMs } from '../../http/retryAfter.ts'
import {
  OutboundHttpError,
  createOutboundHttp,
  validateOutboundUrl
} from '../../http/outboundPolicy.ts'


const MAX_ERROR_BODY_CHARS = 8192

export interface OpenAiCompatibleDeps {

  http?: OutboundHttp

  now?: () => number
}


export function buildChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`
}

function mapOutboundError(error: unknown): AiProviderResult {
  if (error instanceof OutboundHttpError) {
    switch (error.code) {
      case 'timeout':
        return { ok: false, failureKind: 'timeout' }
      case 'too-large':

        return { ok: false, failureKind: 'invalid-envelope' }
      case 'network':
        return { ok: false, failureKind: 'network' }
      default:

        return { ok: false, failureKind: 'config' }
    }
  }

  if (error instanceof TypeError) return { ok: false, failureKind: 'network' }

  const message = (error as { message?: unknown } | null)?.message
  if (typeof message === 'string' && /fetch failed|network|ECONN|ENOTFOUND|EAI_AGAIN/i.test(message)) {
    return { ok: false, failureKind: 'network' }
  }

  return { ok: false, failureKind: 'unknown' }
}

async function readTextSafely(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

function failureResult(
  failureKind: AiProviderFailureKind,
  httpStatus: number,
  retryAfterMs?: number
): AiProviderResult {
  const result: { ok: false; failureKind: AiProviderFailureKind; httpStatus: number; retryAfterMs?: number } = {
    ok: false,
    failureKind,
    httpStatus
  }
  if (retryAfterMs !== undefined) result.retryAfterMs = retryAfterMs
  return result
}

export function createOpenAiCompatibleProvider(
  binding: AiRuntimeBinding,
  deps: OpenAiCompatibleDeps = {}
): AiProvider {
  const http = deps.http ?? createOutboundHttp()
  const now = deps.now ?? (() => Date.now())

  return {
    kind: 'openai-compatible',

    async run(input: AiProviderRequest): Promise<AiProviderResult> {
      const baseUrl = typeof binding.baseUrl === 'string' ? binding.baseUrl.trim() : ''
      const apiKey = typeof binding.apiKey === 'string' ? binding.apiKey : ''

      if (baseUrl === '' || apiKey === '') return { ok: false, failureKind: 'config' }
      if (!validateOutboundUrl(baseUrl).ok) return { ok: false, failureKind: 'config' }




      const effort = input.reasoningEffort ?? 'off'
      const reasoningTokens = input.reasoningTokens ?? 0
      const wire = buildReasoningWire(
        resolveDialect(baseUrl, binding.model),
        effort,
        reasoningTokens
      )
      const total = input.maxTokens + (wire.reasoningActive ? reasoningTokens : 0)
      const body: Record<string, unknown> = {
        model: binding.model,
        messages: input.messages,
        stream: false,
        [wire.tokenLimitField]: total,
        ...(wire.sendTemperature ? { temperature: input.temperature } : {}),


        ...wire.body
      }

      let response: Response
      try {
        response = await http.fetch({
          url: buildChatCompletionsUrl(baseUrl),
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify(body),
          timeoutMs: input.timeoutMs
        })
      } catch (error) {
        return mapOutboundError(error)
      }

      if (response.status >= 200 && response.status < 300) {
        const text = await readTextSafely(response)
        let payload: unknown
        try {
          payload = JSON.parse(text)
        } catch {
          return { ok: false, failureKind: 'invalid-envelope', httpStatus: response.status }
        }
        return parseOpenAiChatCompletion(payload, response.status)
      }


      const errorText = (await readTextSafely(response)).slice(0, MAX_ERROR_BODY_CHARS)
      const failureKind = mapHttpStatusToFailureKind(response.status, errorText)

      if (response.status === 429) {
        const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'), now())
        return failureResult(failureKind, response.status, retryAfterMs)
      }

      return failureResult(failureKind, response.status)
    }
  }
}
