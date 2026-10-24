







import type { AiProviderFailureKind, AiProviderResult, AiUsage } from './contracts.ts'


export { maxResponseBytes } from '../http/limits.ts'

export { parseRetryAfterMs } from '../http/retryAfter.ts'

const invalidEnvelope = (httpStatus?: number): AiProviderResult =>
  httpStatus === undefined
    ? { ok: false, failureKind: 'invalid-envelope' }
    : { ok: false, failureKind: 'invalid-envelope', httpStatus }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tokenCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return Math.trunc(value)
}

function firstTokenCount(primary: unknown, fallback: unknown): number | undefined {
  return tokenCount(primary) ?? tokenCount(fallback)
}





function normalizeUsage(raw: unknown): AiUsage | undefined {
  if (!isRecord(raw)) return undefined

  const inputTokens = firstTokenCount(raw.prompt_tokens, raw.input_tokens)
  const outputTokens = firstTokenCount(raw.completion_tokens, raw.output_tokens)
  if (inputTokens === undefined && outputTokens === undefined) return undefined

  const usage: AiUsage = {}
  if (inputTokens !== undefined) usage.inputTokens = inputTokens
  if (outputTokens !== undefined) usage.outputTokens = outputTokens
  return usage
}


function successResult(text: string, httpStatus?: number, usage?: AiUsage): AiProviderResult {
  const result: { ok: true; text: string; httpStatus?: number; usage?: AiUsage } = {
    ok: true,
    text
  }
  if (httpStatus !== undefined) result.httpStatus = httpStatus
  if (usage !== undefined) result.usage = usage
  return result
}





export function parseOpenAiChatCompletion(payload: unknown, httpStatus?: number): AiProviderResult {
  if (!isRecord(payload)) return invalidEnvelope(httpStatus)

  const { choices } = payload
  if (!Array.isArray(choices) || choices.length === 0) return invalidEnvelope(httpStatus)

  const first = choices[0]
  if (!isRecord(first)) return invalidEnvelope(httpStatus)

  const message = first.message
  if (!isRecord(message)) return invalidEnvelope(httpStatus)

  const content = message.content
  if (typeof content !== 'string' || content.length === 0) return invalidEnvelope(httpStatus)

  return successResult(content, httpStatus, normalizeUsage(payload.usage))
}





export function parseWorkersAiText(payload: unknown, httpStatus?: number): AiProviderResult {
  if (!isRecord(payload)) return invalidEnvelope(httpStatus)

  const text = payload.response
  if (typeof text !== 'string' || text.length === 0) return invalidEnvelope(httpStatus)

  return successResult(text, httpStatus, normalizeUsage(payload.usage))
}








export function mapHttpStatusToFailureKind(
  httpStatus: number,
  bodyText?: string
): AiProviderFailureKind {
  if (httpStatus === 401 || httpStatus === 403) return 'auth'
  if (httpStatus === 402) return 'quota'
  if (httpStatus === 429) return 'rate_limit'
  if (httpStatus === 404) return 'model'
  if (httpStatus === 400) {
    return typeof bodyText === 'string' && /model/i.test(bodyText) ? 'model' : 'config'
  }
  if (httpStatus >= 300 && httpStatus < 400) return 'config'
  if (httpStatus >= 500 && httpStatus < 600) return 'network'
  return 'unknown'
}
