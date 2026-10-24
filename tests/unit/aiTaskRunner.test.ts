







jest.mock('../../src/services/pluginJobs/pluginJobService', () => {
  throw new Error('AiTaskRunner must not import pluginJobService')
})

jest.mock('../../src/drizzle/index', () => {
  throw new Error('AiTaskRunner must not import drizzle')
})

import type { Env } from '../../src/types/index'
import type {
  AiProvider,
  AiProviderRequest,
  AiProviderResult
} from '../../src/services/ai/contracts'
import { createAiTaskRunner } from '../../src/services/ai/aiTaskRunner'

const env = {} as Env

const input: AiProviderRequest = {
  messages: [{ role: 'user', content: 'hello' }],
  maxTokens: 64,
  temperature: 0,
  timeoutMs: 3_000,
  disableReasoning: true
}

describe('createAiTaskRunner', () => {
  it('正常委托 provider 并原样透传 task 参数', async () => {
    const result: AiProviderResult = { ok: true, text: 'hi' }
    const run = jest.fn(async (_input: AiProviderRequest) => result)
    const provider: AiProvider = { kind: 'workers-ai', run }
    const factory = jest.fn(() => provider)

    const runner = createAiTaskRunner(
      { provider: 'workers-ai', model: 'm' },
      env,
      { providerFactory: factory }
    )
    const output = await runner.run(input)

    expect(output).toBe(result)
    expect(factory).toHaveBeenCalledWith({ provider: 'workers-ai', model: 'm' }, env)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0]).toEqual(input)
  })

  it('可选字段缺省时不伪造 disableReasoning', async () => {
    const run = jest.fn(async (_input: AiProviderRequest) => ({ ok: true, text: 'hi' }) as const)
    const runner = createAiTaskRunner(
      { provider: 'workers-ai', model: 'm' },
      env,
      { providerFactory: () => ({ kind: 'workers-ai', run }) }
    )

    const { disableReasoning: _ignored, ...withoutReasoning } = input
    await runner.run(withoutReasoning)

    expect(run.mock.calls[0][0]).not.toHaveProperty('disableReasoning')
  })

  it('未知 provider → unknown 且不抛', async () => {
    const runner = createAiTaskRunner(
      { provider: 'mystery' as never, model: 'm' },
      env
    )

    await expect(runner.run(input)).resolves.toEqual({ ok: false, failureKind: 'unknown' })
  })

  it('provider 内部抛错 → unknown 且不抛', async () => {
    const runner = createAiTaskRunner({ provider: 'workers-ai', model: 'm' }, env, {
      providerFactory: () => ({
        kind: 'workers-ai',
        run: async () => {
          throw new Error('boom')
        }
      })
    })

    await expect(runner.run(input)).resolves.toMatchObject({
      ok: false,
      failureKind: 'unknown'
    })
  })

  it('provider 返回失败时原样返回（不重试）', async () => {
    const run = jest.fn(async () => ({ ok: false, failureKind: 'rate_limit', retryAfterMs: 1 }) as const)
    const runner = createAiTaskRunner({ provider: 'workers-ai', model: 'm' }, env, {
      providerFactory: () => ({ kind: 'workers-ai', run })
    })

    await expect(runner.run(input)).resolves.toEqual({
      ok: false,
      failureKind: 'rate_limit',
      retryAfterMs: 1
    })
    expect(run).toHaveBeenCalledTimes(1)
  })
})
