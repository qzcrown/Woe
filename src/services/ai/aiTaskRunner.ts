











import type { Env } from '../../types/index.ts'
import type {
  AiProvider,
  AiProviderRequest,
  AiProviderResult,
  AiRuntimeBinding,
  AiTaskRunner
} from './contracts.ts'
import { createWorkersAiProvider } from './providers/workersAi.ts'
import { createOpenAiCompatibleProvider } from './providers/openaiCompatible.ts'

export interface AiTaskRunnerDeps {

  providerFactory?: (binding: AiRuntimeBinding, env: Env) => AiProvider | null
}

function defaultProviderFactory(binding: AiRuntimeBinding, env: Env): AiProvider | null {
  switch (binding.provider) {
    case 'workers-ai':
      return createWorkersAiProvider(env, binding.model)
    case 'openai-compatible':
      return createOpenAiCompatibleProvider(binding)
    default:
      return null
  }
}

export function createAiTaskRunner(
  binding: AiRuntimeBinding,
  env: Env,
  deps: AiTaskRunnerDeps = {}
): AiTaskRunner {

  const runtime: AiRuntimeBinding = { ...binding }
  const factory = deps.providerFactory ?? defaultProviderFactory

  return {
    async run(input: AiProviderRequest): Promise<AiProviderResult> {
      try {
        const provider = factory(runtime, env)

        if (!provider) return { ok: false, failureKind: 'unknown' }

        return await provider.run({
          messages: input.messages.map(({ role, content }) => ({ role, content })),
          maxTokens: input.maxTokens,
          temperature: input.temperature,
          timeoutMs: input.timeoutMs,

          ...(input.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: input.reasoningEffort }),
          ...(input.reasoningTokens === undefined
            ? {}
            : { reasoningTokens: input.reasoningTokens })
        })
      } catch {
        return { ok: false, failureKind: 'unknown' }
      }
    }
  }
}
