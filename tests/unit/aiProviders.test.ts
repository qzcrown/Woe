











import type { Env } from '../../src/types/index'
import type {
  AiProviderRequest,
  OutboundHttp,
  ReasoningEffort
} from '../../src/services/ai/contracts'
import { createWorkersAiProvider } from '../../src/services/ai/providers/workersAi'
import { createOpenAiCompatibleProvider } from '../../src/services/ai/providers/openaiCompatible'
import { OutboundHttpError } from '../../src/services/http/outboundPolicy'

const request: AiProviderRequest = {
  messages: [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hello' }
  ],
  maxTokens: 128,
  temperature: 0.2,
  timeoutMs: 5_000
}


function taskRequest(reasoningEffort: ReasoningEffort): AiProviderRequest {
  return {
    messages: request.messages,
    maxTokens: 256,
    temperature: 0,
    timeoutMs: 40_000,
    reasoningEffort,
    reasoningTokens: 25_600
  }
}

function makeEnv(run: jest.Mock): Env {
  return { AI: { run } } as unknown as Env
}

function makeHttp(response: Response | (() => Promise<Response>)): OutboundHttp {
  return {
    fetch: jest.fn(
      typeof response === 'function' ? response : async () => response
    ) as unknown as OutboundHttp['fetch']
  }
}

describe('createWorkersAiProvider', () => {




  const qwen3NativeRunResult = {
    id: 'chatcmpl-redacted-0001',
    object: 'chat.completion',
    created: 1_761_182_400,
    model: '@cf/qwen/qwen3-30b-a3b-fp8',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        stop_reason: null,
        logprobs: null,
        message: { role: 'assistant', content: '["工作"]', reasoning_content: 'redacted' }
      }
    ],
    usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 }
  }

  it('归一原生 choices envelope 的文本与 usage，并透传 task 参数', async () => {
    const run = jest.fn().mockResolvedValue(qwen3NativeRunResult)
    const provider = createWorkersAiProvider(makeEnv(run), '@cf/qwen/qwen3-30b-a3b-fp8')

    const result = await provider.run(request)

    expect(result).toEqual({
      ok: true,
      text: '["工作"]',
      usage: { inputTokens: 12, outputTokens: 34 }
    })
    expect(provider.kind).toBe('workers-ai')
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0]).toBe('@cf/qwen/qwen3-30b-a3b-fp8')

    expect(run.mock.calls[0][1]).toMatchObject({
      messages: request.messages,
      max_tokens: 128,
      temperature: 0.2
    })
  })

  it('旧 response envelope（Llama 形态）仍成功', async () => {
    const run = jest.fn().mockResolvedValue({
      response: 'hello world',
      usage: { prompt_tokens: 9, completion_tokens: 4 }
    })
    const provider = createWorkersAiProvider(makeEnv(run), '@cf/meta/llama-3.3-70b-instruct-fp8-fast')

    const result = await provider.run(request)

    expect(result).toEqual({
      ok: true,
      text: 'hello world',
      usage: { inputTokens: 9, outputTokens: 4 }
    })
  })

  it('正的小数 timeoutMs 至少按 1ms 计时，不退化为 setTimeout(0)', async () => {
    const run = jest.fn().mockResolvedValue({ response: 'ok' })
    const provider = createWorkersAiProvider(makeEnv(run), 'model-a')
    const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout')

    try {
      await provider.run({ ...request, timeoutMs: 0.5 })

      const delays = setTimeoutSpy.mock.calls.map(
        (call: Parameters<typeof setTimeout>) => call[1]
      )
      expect(delays).toContain(1)
      expect(delays).not.toContain(0)
    } finally {
      setTimeoutSpy.mockRestore()
    }
  })

  describe('native 方言请求构造', () => {
    it.each(['off', 'high'] as const)(
      'Llama 3.x not-applicable：%s 档保持基础 payload（预算不膨胀、无思考字段、模型参数不变）',
      async (effort) => {
        const run = jest.fn().mockResolvedValue({ response: '["工作"]' })
        const model = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
        const provider = createWorkersAiProvider(makeEnv(run), model)

        const result = await provider.run(taskRequest(effort))

        expect(result.ok).toBe(true)
        expect(run.mock.calls[0][0]).toBe(model)

        expect(run.mock.calls[0][1]).toEqual({
          messages: request.messages,
          max_tokens: 256,
          temperature: 0
        })
      }
    )

    it.each(['off', 'high'] as const)(
      'Qwen3 mandatory：%s 档预算膨胀为 25_856，不注入臆测关闭字段，choices 可成功',
      async (effort) => {
        const run = jest.fn().mockResolvedValue(qwen3NativeRunResult)
        const provider = createWorkersAiProvider(makeEnv(run), '@cf/qwen/qwen3-30b-a3b-fp8')

        const result = await provider.run(taskRequest(effort))

        expect(result.ok).toBe(true)
        if (result.ok) expect(result.text).toBe('["工作"]')
        const payload = run.mock.calls[0][1] as Record<string, unknown>
        expect(payload.max_tokens).toBe(25_856)
        expect(payload.temperature).toBe(0)
        expect(payload).not.toHaveProperty('reasoning')
        expect(payload).not.toHaveProperty('reasoning_effort')
        expect(payload).not.toHaveProperty('thinking')
        expect(payload).not.toHaveProperty('enable_thinking')
      }
    )

    it('未知原生模型：保留基础 payload（max_tokens=256、温度保持），不注入 HTTP fallback 字段', async () => {
      const run = jest.fn().mockResolvedValue({ response: 'ok' })
      const provider = createWorkersAiProvider(makeEnv(run), 'model-a')

      const result = await provider.run(taskRequest('high'))

      expect(result.ok).toBe(true)
      expect(run.mock.calls[0][1]).toEqual({
        messages: request.messages,
        max_tokens: 256,
        temperature: 0
      })
    })
  })

  it('env.AI 缺失 → config，不抛错', async () => {
    const provider = createWorkersAiProvider({} as Env, 'model-a')

    await expect(provider.run(request)).resolves.toEqual({
      ok: false,
      failureKind: 'config'
    })
  })

  it('AbortError → timeout', async () => {
    const run = jest.fn(async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    })
    const provider = createWorkersAiProvider(makeEnv(run), 'model-a')

    await expect(provider.run(request)).resolves.toMatchObject({
      ok: false,
      failureKind: 'timeout'
    })
  })

  it('超过 timeoutMs 即使 binding 不返回也判定 timeout', async () => {
    const run = jest.fn(() => new Promise(() => undefined))
    const provider = createWorkersAiProvider(makeEnv(run), 'model-a')

    await expect(provider.run({ ...request, timeoutMs: 10 })).resolves.toMatchObject({
      ok: false,
      failureKind: 'timeout'
    })
  })

  it('TypeError/fetch failed → network', async () => {
    const run = jest.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const provider = createWorkersAiProvider(makeEnv(run), 'model-a')

    await expect(provider.run(request)).resolves.toMatchObject({
      ok: false,
      failureKind: 'network'
    })
  })

  it('未知错误 → unknown，且不回传错误 message', async () => {
    const run = jest.fn(async () => {
      throw new Error('SECRET-INTERNAL-DETAIL')
    })
    const provider = createWorkersAiProvider(makeEnv(run), 'model-a')

    const result = await provider.run(request)

    expect(result).toMatchObject({ ok: false, failureKind: 'unknown' })
    expect(JSON.stringify(result)).not.toContain('SECRET-INTERNAL-DETAIL')
  })
})

describe('createOpenAiCompatibleProvider', () => {
  const baseBinding = {
    provider: 'openai-compatible' as const,
    model: 'gpt-test',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-test'
  }

  function baseResponse() {
    return new Response(
      JSON.stringify({ choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 1 } }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  }

  it.each([
    ['无尾斜杠', 'https://api.example.com/v1'],
    ['有尾斜杠', 'https://api.example.com/v1/'],
    ['已含 /chat/completions', 'https://api.example.com/v1/chat/completions'],
    ['已含且带尾斜杠', 'https://api.example.com/v1/chat/completions/']
  ])('URL 拼接（%s）', async (_label, baseUrl) => {
    const http = makeHttp(baseResponse())
    const provider = createOpenAiCompatibleProvider({ ...baseBinding, baseUrl }, { http })

    await provider.run(request)

    expect(http.fetch).toHaveBeenCalledTimes(1)
    expect((http.fetch as jest.Mock).mock.calls[0][0].url).toBe(
      'https://api.example.com/v1/chat/completions'
    )
  })

  it('请求方法/header/body 精确（表外端点 + off：fallback 方言、预算不膨胀）', async () => {
    const http = makeHttp(baseResponse())
    const provider = createOpenAiCompatibleProvider(baseBinding, { http })

    await provider.run(request)

    const input = (http.fetch as jest.Mock).mock.calls[0][0]
    expect(input.method).toBe('POST')
    expect(input.timeoutMs).toBe(5_000)
    expect(input.headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer sk-test'
    })
    expect(JSON.parse(input.body)).toEqual({
      model: 'gpt-test',
      messages: request.messages,
      max_tokens: 128,
      temperature: 0.2,
      stream: false,
      reasoning_effort: 'none'
    })
  })

  it.each([
    ['缺省（undefined 等价 off）', undefined],
    ['显式 off', 'off']
  ] as Array<[string, ReasoningEffort | undefined]>)(
    'off：%s → 表外端点发送 reasoning_effort=none，不再发送 OpenRouter 风格 reasoning 字段',
    async (_label, effort) => {
      const http = makeHttp(baseResponse())
      const provider = createOpenAiCompatibleProvider(baseBinding, { http })

      await provider.run({
        ...request,
        ...(effort === undefined ? {} : { reasoningEffort: effort })
      })

      const body = JSON.parse((http.fetch as jest.Mock).mock.calls[0][0].body as string) as Record<
        string,
        unknown
      >
      expect(body.reasoning_effort).toBe('none')
      expect(body).not.toHaveProperty('reasoning')

      expect(body.max_tokens).toBe(128)
    }
  )

  it('通用 fixture 下的预算合成：off→high 切换后 max_tokens = 128 + 25_600', async () => {
    const http = makeHttp(baseResponse())
    const provider = createOpenAiCompatibleProvider(baseBinding, { http })

    await provider.run({ ...request, reasoningEffort: 'high', reasoningTokens: 25_600 })

    const body = JSON.parse((http.fetch as jest.Mock).mock.calls[0][0].body as string) as Record<
      string,
      unknown
    >


    expect(body.max_tokens).toBe(128 + 25_600)
    expect(body.reasoning_effort).toBe('high')
  })

  it('正常响应归一 text/usage/httpStatus', async () => {
    const http = makeHttp(baseResponse())
    const provider = createOpenAiCompatibleProvider(baseBinding, { http })

    await expect(provider.run(request)).resolves.toEqual({
      ok: true,
      text: 'hi',
      httpStatus: 200,
      usage: { inputTokens: 1 }
    })
  })

  it('429 + Retry-After: 30 → rate_limit + retryAfterMs', async () => {
    const http = makeHttp(
      new Response(JSON.stringify({ error: { message: 'slow down' } }), {
        status: 429,
        headers: { 'retry-after': '30' }
      })
    )
    const provider = createOpenAiCompatibleProvider(baseBinding, { http, now: () => 0 })

    await expect(provider.run(request)).resolves.toEqual({
      ok: false,
      failureKind: 'rate_limit',
      httpStatus: 429,
      retryAfterMs: 30_000
    })
  })

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [402, 'quota'],
    [404, 'model'],
    [500, 'network'],
    [503, 'network']
  ] as const)('%i → %s', async (status, failureKind) => {
    const http = makeHttp(new Response('{"error":"x"}', { status }))
    const provider = createOpenAiCompatibleProvider(baseBinding, { http })

    await expect(provider.run(request)).resolves.toMatchObject({
      ok: false,
      failureKind,
      httpStatus: status
    })
  })

  it('400 且 body 提到 model → model', async () => {
    const http = makeHttp(
      new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 400 })
    )
    const provider = createOpenAiCompatibleProvider(baseBinding, { http })

    await expect(provider.run(request)).resolves.toMatchObject({
      ok: false,
      failureKind: 'model',
      httpStatus: 400
    })
  })

  it('400 其他原因 → config', async () => {
    const http = makeHttp(new Response(JSON.stringify({ error: 'bad' }), { status: 400 }))
    const provider = createOpenAiCompatibleProvider(baseBinding, { http })

    await expect(provider.run(request)).resolves.toMatchObject({
      ok: false,
      failureKind: 'config',
      httpStatus: 400
    })
  })

  it('3xx → config（policy 不跟随重定向）', async () => {
    const http = makeHttp(new Response('', { status: 302, headers: { location: 'https://x' } }))
    const provider = createOpenAiCompatibleProvider(baseBinding, { http })

    await expect(provider.run(request)).resolves.toMatchObject({
      ok: false,
      failureKind: 'config',
      httpStatus: 302
    })
  })

  it('畸形 2xx body → invalid-envelope', async () => {
    const http = makeHttp(new Response('not json', { status: 200 }))
    const provider = createOpenAiCompatibleProvider(baseBinding, { http })

    await expect(provider.run(request)).resolves.toMatchObject({
      ok: false,
      failureKind: 'invalid-envelope',
      httpStatus: 200
    })
  })

  it('响应体中的错误文本不进入返回值', async () => {
    const http = makeHttp(
      new Response(JSON.stringify({ error: { message: 'SECRET-BODY-TOKEN' } }), { status: 500 })
    )
    const provider = createOpenAiCompatibleProvider(baseBinding, { http })

    const result = await provider.run(request)

    expect(result).toMatchObject({ ok: false, failureKind: 'network' })
    expect(JSON.stringify(result)).not.toContain('SECRET-BODY-TOKEN')
  })

  it.each([
    ['baseUrl 缺失', { baseUrl: undefined }],
    ['baseUrl 非 https', { baseUrl: 'http://api.example.com' }],
    ['baseUrl 带 query', { baseUrl: 'https://api.example.com/v1?x=1' }],
    ['baseUrl 带 userinfo', { baseUrl: 'https://user:pass@api.example.com' }],
    ['apiKey 缺失', { apiKey: undefined }],
    ['apiKey 空串', { apiKey: '' }]
  ])('%s → config 且不发请求', async (_label, patch) => {
    const http = makeHttp(baseResponse())
    const provider = createOpenAiCompatibleProvider({ ...baseBinding, ...patch }, { http })

    await expect(provider.run(request)).resolves.toEqual({ ok: false, failureKind: 'config' })
    expect(http.fetch).not.toHaveBeenCalled()
  })

  it('outbound 超时 → timeout', async () => {
    const http = makeHttp(async () => {
      throw new OutboundHttpError('timeout')
    })
    const provider = createOpenAiCompatibleProvider(baseBinding, { http })

    await expect(provider.run(request)).resolves.toMatchObject({
      ok: false,
      failureKind: 'timeout'
    })
  })

  it('outbound 私网拒绝 → config', async () => {
    const http = makeHttp(async () => {
      throw new OutboundHttpError('private-host')
    })
    const provider = createOpenAiCompatibleProvider(baseBinding, { http })

    await expect(provider.run(request)).resolves.toMatchObject({
      ok: false,
      failureKind: 'config'
    })
  })

  it('outbound 响应体超限 → invalid-envelope', async () => {
    const http = makeHttp(async () => {
      throw new OutboundHttpError('too-large')
    })
    const provider = createOpenAiCompatibleProvider(baseBinding, { http })

    await expect(provider.run(request)).resolves.toMatchObject({
      ok: false,
      failureKind: 'invalid-envelope'
    })
  })

  it('outbound 网络错误 → network', async () => {
    const http = makeHttp(async () => {
      throw new OutboundHttpError('network')
    })
    const provider = createOpenAiCompatibleProvider(baseBinding, { http })

    await expect(provider.run(request)).resolves.toMatchObject({
      ok: false,
      failureKind: 'network'
    })
  })

  it('未知异常 → unknown，不回传 message', async () => {
    const http = makeHttp(async () => {
      throw new Error('SECRET-OUTBOUND-DETAIL')
    })
    const provider = createOpenAiCompatibleProvider(baseBinding, { http })

    const result = await provider.run(request)

    expect(result).toMatchObject({ ok: false, failureKind: 'unknown' })
    expect(JSON.stringify(result)).not.toContain('SECRET-OUTBOUND-DETAIL')
  })
})

describe('openai-compatible HTTP 方言请求矩阵', () => {
  function httpBinding(baseUrl: string, model: string) {
    return { provider: 'openai-compatible' as const, baseUrl, model, apiKey: 'sk-test' }
  }


  async function wireBody(baseUrl: string, model: string, effort: ReasoningEffort) {
    const http = makeHttp(
      new Response(
        JSON.stringify({ choices: [{ message: { content: '["工作"]' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    const provider = createOpenAiCompatibleProvider(httpBinding(baseUrl, model), { http })

    const result = await provider.run(taskRequest(effort))

    expect(result.ok).toBe(true)
    expect(http.fetch).toHaveBeenCalledTimes(1)
    return JSON.parse((http.fetch as jest.Mock).mock.calls[0][0].body as string) as Record<
      string,
      unknown
    >
  }

  it('DeepSeek off → max_tokens=256、reasoning_effort=none、temperature 保留', async () => {
    const body = await wireBody('https://api.deepseek.com/v1', 'deepseek-flash', 'off')

    expect(body.max_tokens).toBe(256)
    expect(body.reasoning_effort).toBe('none')
    expect(body.temperature).toBe(0)
    expect(body).not.toHaveProperty('max_completion_tokens')
  })

  it('DeepSeek high → max_tokens=25_856、reasoning_effort=high', async () => {
    const body = await wireBody('https://api.deepseek.com/v1', 'deepseek-flash', 'high')

    expect(body.max_tokens).toBe(25_856)
    expect(body.reasoning_effort).toBe('high')
    expect(body.temperature).toBe(0)
  })

  it('DeepSeek medium → 回落 high（max_tokens=25_856）', async () => {
    const body = await wireBody('https://api.deepseek.com/v1', 'deepseek-flash', 'medium')

    expect(body.max_tokens).toBe(25_856)
    expect(body.reasoning_effort).toBe('high')
  })

  it('GPT-5-mini off → minimum：max_completion_tokens=25_856、minimal、无 max_tokens、无 temperature', async () => {
    const body = await wireBody('https://api.openai.com/v1', 'gpt-5-mini', 'off')

    expect(body.max_completion_tokens).toBe(25_856)
    expect(body.reasoning_effort).toBe('minimal')
    expect(body).not.toHaveProperty('max_tokens')
    expect(body).not.toHaveProperty('temperature')
  })

  it('GPT-5.1 off → max_completion_tokens=256、none、temperature=0（off-only 温度）', async () => {
    const body = await wireBody('https://api.openai.com/v1', 'gpt-5.1', 'off')

    expect(body.max_completion_tokens).toBe(256)
    expect(body.reasoning_effort).toBe('none')
    expect(body.temperature).toBe(0)
    expect(body).not.toHaveProperty('max_tokens')
  })

  it('GPT-5.1 high → max_completion_tokens=25_856、high、无 temperature', async () => {
    const body = await wireBody('https://api.openai.com/v1', 'gpt-5.1', 'high')

    expect(body.max_completion_tokens).toBe(25_856)
    expect(body.reasoning_effort).toBe('high')
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('max_tokens')
  })

  it('o3 off → minimum：max_completion_tokens=25_856、low、无 temperature', async () => {
    const body = await wireBody('https://api.openai.com/v1', 'o3', 'off')

    expect(body.max_completion_tokens).toBe(25_856)
    expect(body.reasoning_effort).toBe('low')
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('max_tokens')
  })

  it('GPT-4.1 high → not-applicable：max_tokens=256、temperature=0、无思考字段', async () => {
    const body = await wireBody('https://api.openai.com/v1', 'gpt-4.1', 'high')

    expect(body.max_tokens).toBe(256)
    expect(body.temperature).toBe(0)
    expect(body).not.toHaveProperty('max_completion_tokens')
    expect(body).not.toHaveProperty('reasoning_effort')
    expect(body).not.toHaveProperty('reasoning')
    expect(body).not.toHaveProperty('thinking')
  })

  it('OpenRouter high → reasoning 严格等于 {effort:"high"}，无 reasoning.max_tokens', async () => {
    const body = await wireBody('https://openrouter.ai/api/v1', 'anthropic/claude-sonnet-4', 'high')

    expect(body.max_tokens).toBe(25_856)
    expect(body.reasoning).toEqual({ effort: 'high' })
    expect(body.temperature).toBe(0)
  })

  it('Gemini 2.5 Flash off → disabled：max_tokens=256、none', async () => {
    const body = await wireBody(
      'https://generativelanguage.googleapis.com/v1beta/openai',
      'gemini-2.5-flash',
      'off'
    )

    expect(body.max_tokens).toBe(256)
    expect(body.reasoning_effort).toBe('none')
  })

  it('Gemini 2.5 Pro off → minimum：max_tokens=25_856、minimal（不能声称已关闭）', async () => {
    const body = await wireBody(
      'https://generativelanguage.googleapis.com/v1beta/openai',
      'gemini-2.5-pro',
      'off'
    )

    expect(body.max_tokens).toBe(25_856)
    expect(body.reasoning_effort).toBe('minimal')
  })

  it('GLM 5.3 off → mandatory：max_tokens=25_856、温度保留、无非法关闭字段', async () => {
    const body = await wireBody('https://api.bigmodel.cn/paas/v4', 'glm-5.3', 'off')

    expect(body.max_tokens).toBe(25_856)
    expect(body.temperature).toBe(0)
    expect(body).not.toHaveProperty('thinking')
    expect(body).not.toHaveProperty('reasoning_effort')
    expect(body).not.toHaveProperty('reasoning')
  })

  it('Kimi kimi-k3 off → mandatory：max_tokens=25_856、无温度（omit）、无非法关闭字段', async () => {
    const body = await wireBody('https://api.moonshot.cn/v1', 'kimi-k3', 'off')

    expect(body.max_tokens).toBe(25_856)
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('thinking')
    expect(body).not.toHaveProperty('reasoning_effort')
    expect(body).not.toHaveProperty('reasoning')
  })

  it('百炼 qwen3 high → enable_thinking=true、thinking_budget=25_600、max_tokens=25_856', async () => {
    const body = await wireBody(
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
      'qwen3-235b-a22b',
      'high'
    )

    expect(body.enable_thinking).toBe(true)
    expect(body.thinking_budget).toBe(25_600)
    expect(body.max_tokens).toBe(25_856)
    expect(body.temperature).toBe(0)
  })

  it('表外 HTTP off → fallback：max_tokens=256、reasoning_effort=none；400 保持 config 分类且不二次请求', async () => {
    const http = makeHttp(
      new Response(JSON.stringify({ error: { message: 'Unsupported parameter: reasoning_effort' } }), {
        status: 400
      })
    )
    const provider = createOpenAiCompatibleProvider(
      httpBinding('https://api.example.com/v1', 'mystery-model'),
      { http }
    )

    const result = await provider.run(taskRequest('off'))

    expect(result).toMatchObject({ ok: false, failureKind: 'config', httpStatus: 400 })
    expect(http.fetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse((http.fetch as jest.Mock).mock.calls[0][0].body as string) as Record<
      string,
      unknown
    >
    expect(body.max_tokens).toBe(256)
    expect(body.reasoning_effort).toBe('none')
  })
})
