



















import type { Env } from '../../../../../../src/types/index.ts'
import type { WebhookerPayload } from '../../../../../../src/plugins/builtin/webhooker/types.ts'
import type { PluginHostContext, PluginTaskResult } from '../../../../../../src/plugins/jobs/types.ts'
import { OutboundHttpError, type OutboundHttpErrorCode } from '../../../../../../src/services/http/outboundPolicy.ts'
import { PluginSecretError } from '../../../../../../src/services/pluginSecretService.ts'
import { pluginConfigs, messages } from '../../../../../../src/models/index.ts'
import { PluginJobService } from '../../../../../../src/services/pluginJobs/pluginJobService.ts'
import { createPluginJobsTestDb } from '../../../../../../tests/helpers/pluginJobsTestDb.ts'
import { asDrizzle } from '../../../../../../tests/helpers/testDb.ts'
import {
  createWebhookerDefinition,
  createWebhookerStaticDefinition,
  createWebhookerTaskDefinition
} from '../../../../../../src/plugins/builtin/webhooker/definition.ts'
import { createWebhookerTask } from '../../../../../../src/plugins/builtin/webhooker/task.ts'
import {
  builtinPluginTaskMetadata,
  builtinPluginTasks,
  createBuiltinPluginTasks
} from '../../../../../../src/plugins/builtin/pluginTasks.ts'

const USER_ID = 7
const PLUGIN_ID = 11
const MESSAGE_ID = 1000

const SNAPSHOT: WebhookerPayload = {
  url: 'https://example.com/hook',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-User-Id': String(USER_ID) },
  body: JSON.stringify({ message: 'hello' })
}

interface HostHandle {
  host: PluginHostContext
  secretsGet: jest.Mock
  secretsHas: jest.Mock
  httpFetch: jest.Mock
}


function createHost(
  opts: {
    secret?: string | null
    secretError?: Error
    httpFetch?: jest.Mock
  } = {}
): HostHandle {
  const secretsGet = jest.fn(async (): Promise<string | null> => {
    if (opts.secretError) throw opts.secretError
    return opts.secret === undefined ? null : opts.secret
  })
  const secretsHas = jest.fn(async (): Promise<boolean> => opts.secret !== undefined && opts.secret !== null)
  const httpFetch =
    opts.httpFetch ??
    jest.fn(async (): Promise<Response> => new Response('OK', { status: 200 }))
  const host: PluginHostContext = {
    userId: USER_ID,
    pluginId: PLUGIN_ID,
    messages: { getMessage: jest.fn() },
    applications: { getApplication: jest.fn() },
    tags: { getTags: jest.fn(), appendTags: jest.fn() },
    secrets: { get: secretsGet, has: secretsHas, paths: () => [] },
    http: { fetch: httpFetch }
  }
  return { host, secretsGet, secretsHas, httpFetch }
}

interface TaskInput {
  payload?: unknown
  timeoutMs?: number
  authTokenDeclared?: boolean
  configTimeoutMs?: number
  host?: HostHandle
  httpFetch?: jest.Mock
}


async function runTask(input: TaskInput = {}): Promise<PluginTaskResult> {
  const handle =
    input.host ??
    createHost(
      input.httpFetch === undefined ? {} : { httpFetch: input.httpFetch }
    )
  const task = createWebhookerTask({
    config: {
      targetUrl: 'https://example.com/hook',
      method: 'POST',
      timeoutMs: input.configTimeoutMs ?? 3000
    },
    authTokenDeclared: input.authTokenDeclared ?? false,
    payload: input.payload === undefined ? SNAPSHOT : input.payload,
    host: handle.host
  })
  return task.run({ attempt: 1, timeoutMs: input.timeoutMs ?? 20_000 })
}

const statusResponse = (status: number, headers: Record<string, string> = {}): Response =>
  new Response(status === 204 || status === 304 ? null : 'body', { status, headers })





describe('task.run：2xx 成功', () => {
  test('200：ok + result {status:"sent", httpStatus} + quotaConsumed', async () => {
    const result = await runTask()
    expect(result).toEqual({
      ok: true,
      result: { status: 'sent', httpStatus: 200 },
      quotaConsumed: true
    })
  })

  test.each([201, 204, 299])('status=%i 同为成功', async (status) => {
    const { host, httpFetch } = createHost()
    httpFetch.mockResolvedValue(statusResponse(status))
    void host
    const result = await runTask({ httpFetch })
    expect(result.ok).toBe(true)
    expect(result).toMatchObject({ result: { status: 'sent', httpStatus: status } })
  })

  test('成功不持久化响应体：result 只含 status/httpStatus', async () => {
    const result = await runTask()
    expect(result.ok && result.result).toEqual({ status: 'sent', httpStatus: 200 })
  })
})





describe('task.run：下游状态失败映射', () => {
  async function runStatus(status: number, headers: Record<string, string> = {}) {
    const httpFetch = jest.fn(async () => statusResponse(status, headers))
    const result = await runTask({ httpFetch })
    return { result, httpFetch }
  }

  test.each([401, 403])('status=%i -> provider-auth 不可重试', async (status) => {
    const { result } = await runStatus(status)
    expect(result).toEqual({
      ok: false,
      failure: { errorCode: 'provider-auth', retriable: false, httpStatus: status },
      quotaConsumed: true
    })
  })
  test.each([400, 404, 418, 422, 499])('status=%i -> downstream-rejected 不可重试', async (status) => {
    const { result } = await runStatus(status)
    expect(result).toEqual({
      ok: false,
      failure: { errorCode: 'downstream-rejected', retriable: false, httpStatus: status },
      quotaConsumed: true
    })
  })

  test.each([301, 302, 304, 307])(
    'status=%i（重定向禁跟）-> downstream-rejected 不可重试',
    async (status) => {
      const { result } = await runStatus(status)
      expect(result).toEqual({
        ok: false,
        failure: { errorCode: 'downstream-rejected', retriable: false, httpStatus: status },
        quotaConsumed: true
      })
    }
  )

  test.each([500, 502, 503, 504])('status=%i -> provider-network 可重试', async (status) => {
    const { result } = await runStatus(status)
    expect(result).toEqual({
      ok: false,
      failure: { errorCode: 'provider-network', retriable: true, httpStatus: status },
      quotaConsumed: true
    })
  })
})





describe('task.run：429 与 Retry-After', () => {
  test('整数秒 Retry-After: 2 -> retryAfterMs 2000，retriable', async () => {
    const outcome = await runTask({
      httpFetch: jest.fn(async () => statusResponse(429, { 'Retry-After': '2' }))
    })
    expect(outcome).toEqual({
      ok: false,
      failure: {
        errorCode: 'provider-rate-limit',
        retriable: true,
        retryAfterMs: 2000,
        httpStatus: 429
      },
      quotaConsumed: true
    })
  })

  test('HTTP-date（未来时刻）-> retryAfterMs 为正差值', async () => {
    const outcome = await runTask({
      httpFetch: jest.fn(async () =>
        statusResponse(429, { 'Retry-After': new Date('2030-01-01T00:00:00Z').toUTCString() })
      )
    })
    expect(outcome).toMatchObject({
      ok: false,
      failure: { errorCode: 'provider-rate-limit', retriable: true }
    })
    if (!outcome.ok) {
      expect(outcome.failure.retryAfterMs).toBeGreaterThan(0)
    }
  })

  test('HTTP-date（过去时刻）-> retryAfterMs 收敛为 0', async () => {
    const outcome = await runTask({
      httpFetch: jest.fn(async () =>
        statusResponse(429, { 'Retry-After': 'Mon, 01 Jan 1990 00:00:00 GMT' })
      )
    })
    expect(outcome).toMatchObject({
      failure: { errorCode: 'provider-rate-limit', retryAfterMs: 0 }
    })
  })

  test('缺失 Retry-After：仍是 provider-rate-limit 可重试，但无 retryAfterMs', async () => {
    const outcome = await runTask({
      httpFetch: jest.fn(async () => statusResponse(429))
    })
    expect(outcome).toEqual({
      ok: false,
      failure: { errorCode: 'provider-rate-limit', retriable: true, httpStatus: 429 },
      quotaConsumed: true
    })
  })

  test('非法 Retry-After（无法解析）-> 无 retryAfterMs', async () => {
    const outcome = await runTask({
      httpFetch: jest.fn(async () => statusResponse(429, { 'Retry-After': 'right away' }))
    })
    expect(outcome).toMatchObject({
      ok: false,
      failure: { errorCode: 'provider-rate-limit', retriable: true }
    })
    if (!outcome.ok) {
      expect(outcome.failure.retryAfterMs).toBeUndefined()
    }
  })
})





describe('task.run：OutboundHttpError 映射', () => {
  async function runOutboundError(code: OutboundHttpErrorCode): Promise<PluginTaskResult> {
    const httpFetch = jest.fn(async (): Promise<Response> => {
      throw new OutboundHttpError(code)
    })
    return runTask({ httpFetch })
  }

  test.each(['invalid', 'insecure', 'userinfo', 'query', 'fragment', 'traversal', 'private-host'] as const)(
    'url 拒绝 code=%s -> outbound-blocked 不可重试且未出站（quotaConsumed false）',
    async (code) => {
      const outcome = await runOutboundError(code)
      expect(outcome).toEqual({
        ok: false,
        failure: { errorCode: 'outbound-blocked', retriable: false },
        quotaConsumed: false
      })
    }
  )

  test('invalid-timeout -> config 不可重试且未出站', async () => {
    const outcome = await runOutboundError('invalid-timeout')
    expect(outcome).toEqual({
      ok: false,
      failure: { errorCode: 'config', retriable: false },
      quotaConsumed: false
    })
  })

  test('timeout -> provider-timeout 可重试，已进入出站尝试', async () => {
    const outcome = await runOutboundError('timeout')
    expect(outcome).toEqual({
      ok: false,
      failure: { errorCode: 'provider-timeout', retriable: true },
      quotaConsumed: true
    })
  })

  test('network -> provider-network 可重试，已进入出站尝试', async () => {
    const outcome = await runOutboundError('network')
    expect(outcome).toEqual({
      ok: false,
      failure: { errorCode: 'provider-network', retriable: true },
      quotaConsumed: true
    })
  })

  test('too-large（响应超 1MB）-> downstream-rejected 不可重试，已进入出站尝试', async () => {
    const outcome = await runOutboundError('too-large')
    expect(outcome).toEqual({
      ok: false,
      failure: { errorCode: 'downstream-rejected', retriable: false },
      quotaConsumed: true
    })
  })

  test('非 OutboundHttpError 的未知异常原样上抛（consumer 归 internal）', async () => {
    await expect(
      runTask({
        httpFetch: jest.fn(async (): Promise<Response> => {
          throw new Error('boom')
        })
      })
    ).rejects.toThrow('boom')
  })
})





describe('task.run：authToken 注入', () => {
  test('声明 authToken：解密注入 Authorization: Bearer，其余快照 headers 保留', async () => {
    const handle = createHost({ secret: 'tok-123' })
    const result = await runTask({ authTokenDeclared: true, host: handle })

    expect(result.ok).toBe(true)
    expect(handle.secretsGet).toHaveBeenCalledWith('authToken')
    expect(handle.httpFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': String(USER_ID),
          Authorization: 'Bearer tok-123'
        }
      })
    )
  })

  test('未声明：不触 secrets、不注入 Authorization', async () => {
    const handle = createHost({ secret: 'tok-123' })
    await runTask({ authTokenDeclared: false, host: handle })

    expect(handle.secretsGet).not.toHaveBeenCalled()
    const call = handle.httpFetch.mock.calls[0][0] as { headers: Record<string, string> }
    expect(call.headers).not.toHaveProperty('Authorization')
  })

  test('快照已含存量明文 Authorization：原样发送且不解密（并存已在配置层拒绝）', async () => {
    const handle = createHost({ secret: 'tok-123' })
    await runTask({
      authTokenDeclared: false,
      payload: { ...SNAPSHOT, headers: { ...SNAPSHOT.headers, Authorization: 'Basic abc' } },
      host: handle
    })

    expect(handle.secretsGet).not.toHaveBeenCalled()
    const call = handle.httpFetch.mock.calls[0][0] as { headers: Record<string, string> }
    expect(call.headers.Authorization).toBe('Basic abc')
  })

  test('解密失败（PluginSecretError）-> secret-decrypt-failed，未出站', async () => {
    const handle = createHost({ secretError: new PluginSecretError('secret-decrypt-failed') })
    const result = await runTask({ authTokenDeclared: true, host: handle })

    expect(result).toEqual({
      ok: false,
      failure: { errorCode: 'secret-decrypt-failed', retriable: false },
      quotaConsumed: false
    })
    expect(handle.httpFetch).not.toHaveBeenCalled()
  })

  test('声明但 secret 为 null（防御分支，validateConfig 已拦截）-> config，未出站', async () => {
    const handle = createHost({ secret: null })
    const result = await runTask({ authTokenDeclared: true, host: handle })

    expect(result).toEqual({
      ok: false,
      failure: { errorCode: 'config', retriable: false },
      quotaConsumed: false
    })
    expect(handle.httpFetch).not.toHaveBeenCalled()
  })

  test('声明但 secret 为空串 -> config，未出站', async () => {
    const handle = createHost({ secret: '' })
    const result = await runTask({ authTokenDeclared: true, host: handle })
    expect(result).toMatchObject({ failure: { errorCode: 'config' }, quotaConsumed: false })
    expect(handle.httpFetch).not.toHaveBeenCalled()
  })

  test('密钥服务基础设施异常（非 PluginSecretError）上抛，不伪装成配置失败', async () => {
    await expect(
      runTask({
        authTokenDeclared: true,
        host: createHost({ secretError: new Error('d1 down') })
      })
    ).rejects.toThrow('d1 down')
  })
})





describe('task.run：payload 快照缺失/损坏', () => {
  test.each([
    ['null', null],
    ['非对象', 'https://example.com/hook'],
    ['缺 url', { method: 'POST', headers: {}, body: '' }],
    ['method 非字符串', { url: 'https://example.com', method: 1, headers: {}, body: '' }],
    ['headers 非对象', { url: 'https://example.com', method: 'POST', headers: [], body: '' }],
    ['headers 值非字符串', { url: 'https://example.com', method: 'POST', headers: { 'X-A': 1 }, body: '' }],
    ['body 非字符串', { url: 'https://example.com', method: 'POST', headers: {}, body: 123 }]
  ])('payload %s -> config 失败且不做任何 I/O', async (_name, payload) => {
    const handle = createHost({ secret: 'tok' })
    const result = await runTask({ payload, authTokenDeclared: true, host: handle })

    expect(result).toEqual({
      ok: false,
      failure: { errorCode: 'config', retriable: false },
      quotaConsumed: false
    })
    expect(handle.secretsGet).not.toHaveBeenCalled()
    expect(handle.httpFetch).not.toHaveBeenCalled()
  })

  test('payload 结构合法但空 body：按快照原样投递（body 允许空串）', async () => {
    const handle = createHost()
    await runTask({
      payload: { url: 'https://example.com/hook', method: 'POST', headers: {}, body: '' },
      host: handle
    })
    expect(handle.httpFetch).toHaveBeenCalledWith(
      expect.objectContaining({ body: '', headers: {} })
    )
  })
})





describe('task.run：timeout 求值', () => {
  test('fetch 入参 timeoutMs = min(config.timeoutMs, 平台预算)', async () => {
    const handle = createHost()
    await runTask({ configTimeoutMs: 5000, timeoutMs: 20_000, host: handle })
    expect(handle.httpFetch).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 5000 }))

    const handle2 = createHost()
    await runTask({ configTimeoutMs: 30_000, timeoutMs: 20_000, host: handle2 })
    expect(handle2.httpFetch).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 20_000 }))
  })

  test.each([
    ['平台预算为 0', 0],
    ['平台预算为负数', -1],
    ['平台预算非整数', 20.5]
  ])('%s：fetch 前拒绝为 config（quotaConsumed false）', async (_name, budget) => {
    const handle = createHost()
    const result = await runTask({ timeoutMs: budget, host: handle })
    expect(result).toEqual({
      ok: false,
      failure: { errorCode: 'config', retriable: false },
      quotaConsumed: false
    })
    expect(handle.httpFetch).not.toHaveBeenCalled()
  })
})





describe('createWebhookerDefinition：policy vars 求值', () => {
  const env = (vars: Partial<Record<'WEBHOOKER_ALLOW_HTTP' | 'WEBHOOKER_ALLOW_PRIVATE_NETWORK', string>>): Env =>
    ({ ...vars }) as Env

  test('缺省（两 var 均缺）：默认严格策略 + 固定放行 query', () => {
    const definition = createWebhookerDefinition(env({}))
    expect(definition.outbound).toEqual({ allowQuery: true })
  })

  test('仅 WEBHOOKER_ALLOW_HTTP="true"：放行 http 目标，仍拒私网', () => {
    const definition = createWebhookerDefinition(env({ WEBHOOKER_ALLOW_HTTP: 'true' }))
    expect(definition.outbound).toEqual({ allowHttp: true, allowQuery: true })
  })

  test('仅 WEBHOOKER_ALLOW_PRIVATE_NETWORK="true"：放行私网目标，仍拒 http', () => {
    const definition = createWebhookerDefinition(
      env({ WEBHOOKER_ALLOW_PRIVATE_NETWORK: 'true' })
    )
    expect(definition.outbound).toEqual({ allowPrivateNetwork: true, allowQuery: true })
  })

  test('两 var 同时为 "true"：全部放行', () => {
    const definition = createWebhookerDefinition(
      env({ WEBHOOKER_ALLOW_HTTP: 'true', WEBHOOKER_ALLOW_PRIVATE_NETWORK: 'true' })
    )
    expect(definition.outbound).toEqual({
      allowHttp: true,
      allowPrivateNetwork: true,
      allowQuery: true
    })
  })

  test.each(['TRUE', 'True', 'tRuE'])('大小写不敏感：%s 等价 true', async (value) => {
    const definition = createWebhookerDefinition(env({ WEBHOOKER_ALLOW_HTTP: value }))
    expect(definition.outbound).toEqual({ allowHttp: true, allowQuery: true })
  })

  test.each(['1', 'yes', 'on', 'false', ''])('非法值 %s 静默按 false（fail-closed）', (value) => {
    const definition = createWebhookerDefinition(
      env({ WEBHOOKER_ALLOW_HTTP: value, WEBHOOKER_ALLOW_PRIVATE_NETWORK: value })
    )
    expect(definition.outbound).toEqual({ allowQuery: true })
  })

  test('env 工厂与 prepareJob 预检共用同一策略：allowHttp 下 http 目标可建快照', async () => {
    const definition = createWebhookerDefinition(env({ WEBHOOKER_ALLOW_HTTP: 'true' }))
    expect(definition.prepareJob).toBeDefined()

    const getMessage = jest.fn(async () => ({
      id: MESSAGE_ID,
      appId: 42,
      date: '2026-10-23T11:59:00.000Z',
      priority: 5,
      content: 'hello',
      extras: {}
    }))
    const host: PluginHostContext = {
      ...createHost().host,
      messages: { getMessage }
    }
    const prepared = await definition.prepareJob!({
      userId: USER_ID,
      pluginId: PLUGIN_ID,
      subjectType: 'message',
      subjectId: MESSAGE_ID,
      config: { targetUrl: 'http://example.com/hook' },
      host,
      now: '2026-10-23T12:00:00.000Z'
    })
    expect(prepared).toMatchObject({ payload: { url: 'http://example.com/hook' } })
  })

  test('allowQuery:false 传入工厂被强制覆盖为 true（§4.2 固定放行）', () => {
    const definition = createWebhookerTaskDefinition({ allowHttp: true, allowQuery: false })
    expect(definition.outbound).toEqual({ allowHttp: true, allowQuery: true })
  })

  test('env 工厂只返回任务行为，元数据不随工厂复制', () => {
    const definition = createWebhookerDefinition(env({}))
    expect(definition).not.toHaveProperty('modulePath')
    expect(definition).not.toHaveProperty('supportedSubjectTypes')
    expect(definition).not.toHaveProperty('secretFields')
    expect(definition).not.toHaveProperty('manualTrigger')
    expect(definition).not.toHaveProperty('quotaNamespace')
    expect(typeof definition.validateConfig).toBe('function')
    expect(typeof definition.prepareJob).toBe('function')
    expect(typeof definition.createTask).toBe('function')
  })
})





describe('definition：createTask', () => {
  function jobContext(payload: unknown) {
    return {
      jobId: 1,
      userId: USER_ID,
      pluginId: PLUGIN_ID,
      subjectType: 'message',
      subjectId: MESSAGE_ID,
      payload
    }
  }

  test('env 工厂 createTask：配置解析成功则返回可执行 task 并跑通成功路径', async () => {
    const handle = createHost()
    const definition = createWebhookerDefinition({} as Env)
    const task = await definition.createTask({
      config: { targetUrl: 'https://example.com/hook', timeoutMs: 5000 },
      job: jobContext(SNAPSHOT),
      host: handle.host
    })
    const result = await task.run({ attempt: 1, timeoutMs: 20_000 })

    expect(result).toEqual({
      ok: true,
      result: { status: 'sent', httpStatus: 200 },
      quotaConsumed: true
    })

    expect(handle.httpFetch).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 5000 }))
  })

  test('env 工厂 createTask：配置解析失败返回 fail-closed task（run 即 config）', async () => {
    const definition = createWebhookerDefinition({} as Env)
    const task = await definition.createTask({
      config: { method: 'POST' },
      job: jobContext(SNAPSHOT),
      host: createHost().host
    })
    await expect(task.run({ attempt: 1, timeoutMs: 20_000 })).resolves.toEqual({
      ok: false,
      failure: { errorCode: 'config', retriable: false },
      quotaConsumed: false
    })
  })

  test('authToken 声明（存储 YAML 的 *** 掩码形态）被 createTask 识别并注入', async () => {
    const handle = createHost({ secret: 'tok-123' })
    const definition = createWebhookerDefinition({} as Env)
    const task = await definition.createTask({
      config: { targetUrl: 'https://example.com/hook', authToken: '***' },
      job: jobContext(SNAPSHOT),
      host: handle.host
    })
    await task.run({ attempt: 1, timeoutMs: 20_000 })

    const call = handle.httpFetch.mock.calls[0][0] as { headers: Record<string, string> }
    expect(call.headers.Authorization).toBe('Bearer tok-123')
  })

  test('静态目录 createTask fail-loud：缺 env 装配错误不伪装 config 失败', async () => {
    await expect(
      createWebhookerStaticDefinition().createTask({
        config: { targetUrl: 'https://example.com/hook' },
        job: jobContext(SNAPSHOT),
        host: createHost().host
      })
    ).rejects.toThrow('webhooker task definition requires env')
  })
})





describe('definition：validateConfig', () => {
  test('配置合法且未声明 authToken：直接通过，不触 secrets', async () => {
    const handle = createHost()
    const failure = await createWebhookerStaticDefinition().validateConfig!({
      config: { targetUrl: 'https://example.com/hook' },
      host: handle.host
    })
    expect(failure).toBeUndefined()
    expect(handle.secretsHas).not.toHaveBeenCalled()
  })

  test('声明 authToken 且 secret 存在：通过', async () => {
    const handle = createHost({ secret: 'tok' })
    const failure = await createWebhookerStaticDefinition().validateConfig!({
      config: { targetUrl: 'https://example.com/hook', authToken: '***' },
      host: handle.host
    })
    expect(failure).toBeUndefined()
    expect(handle.secretsHas).toHaveBeenCalledWith('authToken')
  })

  test('声明 authToken 但 secret 不存在：secret-config 拒绝', async () => {
    const handle = createHost({ secret: null })
    const failure = await createWebhookerStaticDefinition().validateConfig!({
      config: { targetUrl: 'https://example.com/hook', authToken: '***' },
      host: handle.host
    })
    expect(failure).toEqual({ errorCode: 'secret-config' })
  })

  test('配置非法：config 拒绝', async () => {
    const failure = await createWebhookerStaticDefinition().validateConfig!({
      config: { method: 'POST' },
      host: createHost().host
    })
    expect(failure).toEqual({ errorCode: 'config' })
  })
})





describe('双注册接线：pluginTasks 目录', () => {
  test('静态目录含 webhooker（manualTrigger=false，createTask fail-loud）', () => {
    const definition = builtinPluginTasks.find((d) => d.modulePath === 'builtin/webhooker')
    expect(definition).toBeDefined()
    expect(definition!.manualTrigger).toBe(false)
    expect(definition!.outbound).toEqual({ allowQuery: true })
  })

  test('env 目录与当前静态任务集合一致，webhooker createTask 可执行', () => {
    const definitions = createBuiltinPluginTasks({} as Env)
    expect(definitions.map((d) => d.modulePath)).toEqual(
      builtinPluginTasks.map((d) => d.modulePath)
    )
    expect(definitions.some((d) => d.modulePath === 'builtin/webhooker')).toBe(true)
  })

  test('元数据目录完整投影当前 manifest，webhooker 字段不从任务工厂复制', () => {
    expect(builtinPluginTaskMetadata.map((d) => d.modulePath)).toEqual(
      builtinPluginTasks.map((d) => d.modulePath)
    )
    expect(builtinPluginTaskMetadata.find((d) => d.modulePath === 'builtin/webhooker')).toEqual({
      modulePath: 'builtin/webhooker',
      supportedSubjectTypes: ['message'],
      secretFields: ['authToken'],
      manualTrigger: false,
      outbound: { allowQuery: true }
    })
  })
})





describe('手动触发拒绝：PluginJobService 对 webhooker 的 manual 门控', () => {
  test('source=manual 一律 409 plugin-unavailable，不建 job；source=event 正常入队并携带快照', async () => {
    const db = createPluginJobsTestDb()
    db.sqlite.prepare('INSERT INTO users (id, name, admin, disabled) VALUES (7, ?, 0, 0)').run('u7')
    const [plugin] = db.db
      .insert(pluginConfigs)
      .values({
        userId: 7,
        name: 'hook',
        token: 'tok',
        modulePath: 'builtin/webhooker',
        configYaml: 'targetUrl: https://example.com/hook',
        enabled: 1
      })
      .returning()
      .all()
    db.sqlite
      .prepare('INSERT INTO user_plugin_permissions (user_id, module_path) VALUES (7, ?)')
      .run('builtin/webhooker')
    const [message] = db.db
      .insert(messages)
      .values({ userid: 7, appid: 1, message: 'hello' })
      .returning()
      .all()

    const queue = { send: jest.fn(async () => undefined) }

    const service = new PluginJobService({ drizzle: asDrizzle(db), env: {} as Env, queue })

    const manual = await service.enqueue({
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id,
      source: 'manual'
    })
    expect(manual).toMatchObject({ status: 'skipped', code: 'plugin-unavailable', httpStatus: 409 })
    expect(
      db.sqlite.prepare('SELECT COUNT(*) AS n FROM plugin_jobs').get()
    ).toMatchObject({ n: 0 })

    const event = await service.enqueue({
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id,
      source: 'event'
    })
    expect(event).toMatchObject({ status: 'ok', httpStatus: 202 })
    if (event.status === 'ok') {
      const row = db.sqlite
        .prepare('SELECT payload FROM plugin_jobs WHERE id = ?')
        .get(event.job.id) as { payload: string }
      const payload = JSON.parse(row.payload)
      expect(payload).toMatchObject({ url: 'https://example.com/hook', method: 'POST' })
    }
  })
})
