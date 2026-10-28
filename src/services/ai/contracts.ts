












export type AiProviderFailureKind =
  | 'auth'
  | 'quota'
  | 'rate_limit'
  | 'model'
  | 'network'
  | 'timeout'
  | 'config'
  | 'invalid-envelope'
  | 'reasoning-starved'
  | 'unknown'

export type AiUsage = {
  inputTokens?: number
  outputTokens?: number
}





export type ReasoningEffort = 'off' | 'low' | 'medium' | 'high' | 'max'

export type AiProviderResult =
  | { ok: true; text: string; httpStatus?: number; usage?: AiUsage }
  | {
      ok: false
      httpStatus?: number
      failureKind: AiProviderFailureKind
      retryAfterMs?: number

      consoleMessage?: string
    }







export interface AiRuntimeBinding {
  provider: 'workers-ai' | 'openai-compatible'
  model: string

  baseUrl?: string

  apiKey?: string
}

export interface AiProviderRequest {
  messages: Array<{ role: string; content: string }>
  maxTokens: number
  temperature: number
  timeoutMs: number





  reasoningEffort?: ReasoningEffort

  reasoningTokens?: number
}

export interface AiProvider {
  readonly kind: AiRuntimeBinding['provider']
  run(input: AiProviderRequest): Promise<AiProviderResult>
}





export interface AiTaskRunner {
  run(input: AiProviderRequest): Promise<AiProviderResult>
}





export type { OutboundHttp } from '../../plugins/jobs/types.ts'
