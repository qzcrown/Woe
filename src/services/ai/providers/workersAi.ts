










import type { Env } from '../../../types/index.ts'
import type {
  AiProvider,
  AiProviderFailureKind,
  AiProviderRequest,
  AiProviderResult
} from '../contracts.ts'
import { parseWorkersAiText } from '../envelope.ts'
import { buildReasoningWire, resolveWorkersAiDialect } from '../providerDialects.ts'


class AiRequestTimeout extends Error {
  constructor() {
    super('ai request timeout')
    this.name = 'TimeoutError'
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {

  const ms = Number.isFinite(timeoutMs) ? Math.max(1, Math.trunc(timeoutMs)) : 0

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AiRequestTimeout()), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

function mapThrownError(error: unknown): AiProviderFailureKind {
  if (error instanceof AiRequestTimeout) return 'timeout'

  const name = (error as { name?: unknown } | null)?.name
  if (name === 'AbortError' || name === 'TimeoutError') return 'timeout'
  if (error instanceof TypeError) return 'network'

  const message = (error as { message?: unknown } | null)?.message
  if (typeof message === 'string' && /fetch failed|network|ECONN|ENOTFOUND|EAI_AGAIN/i.test(message)) {
    return 'network'
  }
  return 'unknown'
}





export function createWorkersAiProvider(env: Env, model: string): AiProvider {
  return {
    kind: 'workers-ai',

    async run(input: AiProviderRequest): Promise<AiProviderResult> {
      const ai = env.AI
      if (!ai || typeof ai.run !== 'function') {
        return { ok: false, failureKind: 'config' }
      }

      const effort = input.reasoningEffort ?? 'off'
      const reasoningTokens = input.reasoningTokens ?? 0
      const dialect = resolveWorkersAiDialect(model)

      let payload: Record<string, unknown>
      if (dialect === null) {


        payload = {
          messages: input.messages,
          max_tokens: input.maxTokens,
          temperature: input.temperature
        }
      } else {
        const wire = buildReasoningWire(dialect, effort, reasoningTokens)
        const total = input.maxTokens + (wire.reasoningActive ? reasoningTokens : 0)
        payload = {
          messages: input.messages,
          [wire.tokenLimitField]: total,
          ...(wire.sendTemperature ? { temperature: input.temperature } : {}),

          ...wire.body
        }
      }

      try {
        const raw = await withTimeout(ai.run(model, payload), input.timeoutMs)
        return parseWorkersAiText(raw)
      } catch (error) {
        return { ok: false, failureKind: mapThrownError(error) }
      }
    }
  }
}
