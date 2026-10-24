






import type { Env } from '../../src/types/index'
import type { AiProviderRequest, OutboundHttp } from '../../src/services/ai/contracts'
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
  it('归一文本与 usage，并透传 task 参数', async () => {
    const run = jest.fn().mockResolvedValue({
      response: 'hello world',
      usage: { prompt_tokens: 9, completion_tokens: 4 }
    })
    const provider = createWorkersAiProvider(makeEnv(run), 'model-a')

    const result = await provider.run(request)

    expect(result).toEqual({
      ok: true,
      text: 'hello world',
      usage: { inputTokens: 9, outputTokens: 4 }
    })
    expect(provider.kind).toBe('workers-ai')
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0]).toBe('model-a')
    expect(run.mock.calls[0][1]).toMatchObject({
      messages: request.messages,
      max_tokens: 128,
      temperature: 0.2
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

  it('disableReasoning 透传 reasoning.effort = none', async () => {
    const run = jest.fn().mockResolvedValue({ response: 'ok' })
    const provider = createWorkersAiProvider(makeEnv(run), 'model-a')

    await provider.run({ ...request, disableReasoning: true })

    expect(run.mock.calls[0][1]).toMatchObject({ reasoning: { effort: 'none' } })
  })

  it('未启用 disableReasoning 时不附加 reasoning', async () => {
    const run = jest.fn().mockResolvedValue({ response: 'ok' })
    const provider = createWorkersAiProvider(makeEnv(run), 'model-a')

    await provider.run(request)

    expect(run.mock.calls[0][1]).not.toHaveProperty('reasoning')
  })

  it.each([
    ['undefined', undefined],
    ['false', false]
  ])('disableReasoning = %s 时 wire payload 不含 reasoning 键', async (_label, disableReasoning) => {
    const run = jest.fn().mockResolvedValue({ response: 'ok' })
    const provider = createWorkersAiProvider(makeEnv(run), 'model-a')

    await provider.run({ ...request, ...(disableReasoning === undefined ? {} : { disableReasoning }) })

    const payload = run.mock.calls[0][1] as Record<string, unknown>
    expect(Object.hasOwn(JSON.parse(JSON.stringify(payload)), 'reasoning')).toBe(false)
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

  it('请求方法/header/body 精确', async () => {
    const http = makeHttp(baseResponse())
    const provider = createOpenAiCompatibleProvider(baseBinding, { http })

    await provider.run({ ...request, disableReasoning: true })

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
      reasoning: { effort: 'none' }
    })
  })

  it.each([
    ['undefined', undefined],
    ['false', false]
  ])('disableReasoning = %s 时请求体不含 reasoning 键', async (_label, disableReasoning) => {
    const http = makeHttp(baseResponse())
    const provider = createOpenAiCompatibleProvider(baseBinding, { http })

    await provider.run({
      ...request,
      ...(disableReasoning === undefined ? {} : { disableReasoning })
    })

    const body = (http.fetch as jest.Mock).mock.calls[0][0].body as string
    expect(Object.hasOwn(JSON.parse(body), 'reasoning')).toBe(false)
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
