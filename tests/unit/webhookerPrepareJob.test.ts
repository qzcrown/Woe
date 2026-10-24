















import {
  WEBHOOKER_MAX_PAYLOAD_BYTES,
  createWebhookerPlugin,
  createWebhookerStaticDefinition,
  createWebhookerTaskDefinition
} from '../../src/plugins/builtin/webhooker/definition'
import type {
  ApplicationAccess,
  MessageAccess,
  PluginHostContext,
  PluginTaskDefinition
} from '../../src/plugins/jobs/types'


type HostMessage = NonNullable<Awaited<ReturnType<MessageAccess['getMessage']>>>

const NOW = '2026-10-23T12:00:00.000Z'
const USER_ID = 7
const PLUGIN_ID = 11
const MESSAGE_ID = 1000
const APP_ID = 42

const MESSAGE: HostMessage = {
  id: MESSAGE_ID,
  appId: APP_ID,
  date: '2026-10-23T11:59:00.000Z',
  priority: 5,
  title: 'Test Alert',
  content: 'Test message content',
  extras: { 'woe::filter::tags': ['webhook'] }
}

const APPLICATION = { id: APP_ID, name: 'TestApp' }

interface HostHandle {
  host: PluginHostContext
  getMessage: jest.Mock
  getApplication: jest.Mock
  secretsGet: jest.Mock
  secretsHas: jest.Mock
  httpFetch: jest.Mock
}


function createHost(
  opts: { message?: HostMessage | null; application?: { id: number; name: string } | null } = {}
): HostHandle {
  const getMessage = jest.fn(async (id: number): Promise<HostMessage | null> => {
    if (opts.message !== undefined) return opts.message
    return id === MESSAGE_ID ? MESSAGE : null
  })
  const getApplication = jest.fn(
    async (appId: number): Promise<{ id: number; name: string } | null> => {
      if (opts.application !== undefined) return opts.application
      return appId === APP_ID ? APPLICATION : null
    }
  )
  const secretsGet = jest.fn()
  const secretsHas = jest.fn()
  const httpFetch = jest.fn()
  const host: PluginHostContext = {
    userId: USER_ID,
    pluginId: PLUGIN_ID,
    messages: { getMessage },
    applications: { getApplication },
    tags: { getTags: jest.fn(), appendTags: jest.fn() },
    secrets: { get: secretsGet, has: secretsHas, paths: () => [] },
    http: { fetch: httpFetch }
  }
  return { host, getMessage, getApplication, secretsGet, secretsHas, httpFetch }
}


function prepareCtx(config: unknown, host: PluginHostContext) {
  return {
    userId: USER_ID,
    pluginId: PLUGIN_ID,
    subjectType: 'message',
    subjectId: MESSAGE_ID,
    config,
    host,
    now: NOW
  }
}

type PrepareResult = Awaited<ReturnType<NonNullable<PluginTaskDefinition['prepareJob']>>>

async function runPrepare(
  config: unknown,
  host?: PluginHostContext,
  definition: PluginTaskDefinition = createWebhookerStaticDefinition()
): Promise<PrepareResult> {
  if (!definition.prepareJob) throw new Error('definition must implement prepareJob')
  return definition.prepareJob(prepareCtx(config, host ?? createHost().host))
}


const snapshotBytes = (payload: unknown): number =>
  new TextEncoder().encode(JSON.stringify(payload)).length


function expectPayload(result: PrepareResult): Record<string, unknown> {
  if (!('payload' in result)) {
    throw new Error(`expected payload, got error: ${JSON.stringify(result)}`)
  }
  return result.payload as Record<string, unknown>
}





describe('createWebhookerStaticDefinition：元数据与占位', () => {
  test('元数据与 pluginTasks 目录声明一致；outbound 默认严格 + 固定放行 query', () => {
    const definition = createWebhookerStaticDefinition()
    expect(definition.modulePath).toBe('builtin/webhooker')
    expect(definition.supportedSubjectTypes).toEqual(['message'])
    expect(definition.secretFields).toEqual(['authToken'])
    expect(definition.manualTrigger).toBe(false)
    expect(definition.outbound).toEqual({ allowQuery: true })
    expect(definition.quotaNamespace).toBeUndefined()
    expect(typeof definition.prepareJob).toBe('function')
  })

  test('createTask 占位 fail-loud：抛错而非伪装成 config 失败（参照 example task）', async () => {
    const { host } = createHost()
    await expect(
      createWebhookerStaticDefinition().createTask({
        config: { targetUrl: 'https://example.com/hook' },
        job: {
          jobId: 1,
          userId: USER_ID,
          pluginId: PLUGIN_ID,
          subjectType: 'message',
          subjectId: MESSAGE_ID,
          payload: null
        },
        host
      })
    ).rejects.toThrow()
  })
})





describe('prepareJob：快照渲染', () => {
  test('全变量渲染：url/method/headers/body 为终产物，timeoutMs 不进快照', async () => {
    const config = {
      targetUrl: 'https://example.com/hook/#{USER_ID}/#{MESSAGE_ID}/#{APP_ID}',
      method: 'PUT',
      headers: {
        'X-User-Id': '#{USER_ID}',
        'X-App-Name': '#{APP_NAME}',
        'X-Title': '#{MESSAGE_TITLE}',
        'X-Priority': '#{MESSAGE_PRIORITY}',
        'X-Count': 3,
        'X-Flag': true
      },
      body: JSON.stringify({
        m: '#{MESSAGE}',
        mid: '#{MESSAGE_ID}',
        title: '#{MESSAGE_TITLE}',
        priority: '#{MESSAGE_PRIORITY}',
        user: '#{USER_ID}',
        app: '#{APP_NAME}',
        appId: '#{APP_ID}',
        at: '#{NOW}'
      })
    }

    const payload = expectPayload(await runPrepare(config))

    expect(payload).toEqual({
      url: `https://example.com/hook/${USER_ID}/${MESSAGE_ID}/${APP_ID}`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': String(USER_ID),
        'X-App-Name': 'TestApp',
        'X-Title': 'Test Alert',
        'X-Priority': '5',
        'X-Count': '3',
        'X-Flag': 'true'
      },
      body: JSON.stringify({
        m: 'Test message content',
        mid: String(MESSAGE_ID),
        title: 'Test Alert',
        priority: '5',
        user: String(USER_ID),
        app: 'TestApp',
        appId: String(APP_ID),
        at: NOW
      })
    })

    expect(Object.keys(payload).sort()).toEqual(['body', 'headers', 'method', 'url'])
  })

  test('默认（缺 method/headers/body）：POST + Content-Type + 向后兼容默认 body', async () => {
    const payload = expectPayload(await runPrepare({ targetUrl: 'https://example.com/hook' }))

    expect(payload.url).toBe('https://example.com/hook')
    expect(payload.method).toBe('POST')
    expect(payload.headers).toEqual({ 'Content-Type': 'application/json' })


    expect(JSON.parse(payload.body as string)).toEqual({
      pluginId: PLUGIN_ID,
      userId: USER_ID,
      event: 'message.create',
      message: MESSAGE,
      at: NOW
    })
  })

  test('NOW 使用入队时刻 ctx.now，而非消息 date', async () => {
    const payload = expectPayload(
      await runPrepare({
        targetUrl: 'https://example.com/hook',
        body: '{"at":"#{NOW}"}'
      })
    )
    expect(payload.body).toBe(`{"at":"${NOW}"}`)
    expect(NOW).not.toBe(MESSAGE.date)
  })

  test('自定义 body 非合法 JSON：按纯字符串回退并做变量替换（旧语义）', async () => {
    const payload = expectPayload(
      await runPrepare({
        targetUrl: 'https://example.com/hook',
        body: 'plain #{USER_ID} text'
      })
    )
    expect(payload.body).toBe(`plain ${USER_ID} text`)
  })

  test('用户 headers 可覆盖默认 Content-Type', async () => {
    const payload = expectPayload(
      await runPrepare({
        targetUrl: 'https://example.com/hook',
        headers: { 'Content-Type': 'text/plain' }
      })
    )
    expect(payload.headers).toEqual({ 'Content-Type': 'text/plain' })
  })

  test('未识别变量保留原占位符（resolveVariables 现有规则）', async () => {
    const payload = expectPayload(
      await runPrepare({
        targetUrl: 'https://example.com/hook',
        body: '{"x":"#{UNDEFINED_VAR}"}'
      })
    )
    expect(payload.body).toBe('{"x":"#{UNDEFINED_VAR}"}')
  })
})





describe('prepareJob：缺失与防御分支', () => {
  test('缺 app：getApplication 返回 null，#{APP_NAME} 在 body/headers 保留占位，快照仍可建', async () => {
    const { host, getApplication } = createHost({ application: null })
    const payload = expectPayload(
      await runPrepare(
        {
          targetUrl: 'https://example.com/hook',
          headers: { 'X-App-Name': '#{APP_NAME}' },
          body: '{"app":"#{APP_NAME}"}'
        },
        host
      )
    )
    expect(getApplication).toHaveBeenCalledWith(APP_ID)
    expect(payload.headers).toHaveProperty('X-App-Name', '#{APP_NAME}')
    expect(payload.body).toBe('{"app":"#{APP_NAME}"}')
  })

  test('缺 app 且占位符位于 URL：残留 #{...} 含 #，按 outbound-blocked fail-closed', async () => {


    const { host } = createHost({ application: null })
    const result = await runPrepare({ targetUrl: 'https://example.com/hook/#{APP_NAME}' }, host)
    expect(result).toEqual({ error: { errorCode: 'outbound-blocked' } })
  })

  test('消息无 title：#{MESSAGE_TITLE} 保留占位', async () => {
    const { host } = createHost({ message: { ...MESSAGE, title: undefined } })
    const payload = expectPayload(
      await runPrepare(
        { targetUrl: 'https://example.com/hook', body: '{"t":"#{MESSAGE_TITLE}"}' },
        host
      )
    )
    expect(payload.body).toBe('{"t":"#{MESSAGE_TITLE}"}')
  })

  test('消息防御性读取为 null：返回 config，不读 application、不建快照', async () => {
    const { host, getApplication, httpFetch } = createHost({ message: null })
    const result = await runPrepare({ targetUrl: 'https://example.com/hook' }, host)
    expect(result).toEqual({ error: { errorCode: 'config' } })
    expect(getApplication).not.toHaveBeenCalled()
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('配置解析失败（缺 targetUrl）：返回 config，且不做任何端口 I/O', async () => {
    const { host, getMessage } = createHost()
    const result = await runPrepare({ method: 'POST' }, host)
    expect(result).toEqual({ error: { errorCode: 'config' } })
    expect(getMessage).not.toHaveBeenCalled()
  })
})





describe('prepareJob：快照 64 KiB UTF-8 字节上限', () => {
  const config = (body: string) => ({ targetUrl: 'https://example.com/hook', body })

  const bodyTemplate = JSON.stringify({ m: '#{MESSAGE}' })
  const withContent = (content: string) =>
    createHost({ message: { ...MESSAGE, content } }).host

  test('恰好 64 KiB 放行；超 1 字节拒绝为 config 不建 job', async () => {
    const base = expectPayload(await runPrepare(config(bodyTemplate), withContent('x')))
    const baseSize = snapshotBytes(base)
    expect(baseSize).toBeLessThan(WEBHOOKER_MAX_PAYLOAD_BYTES)

    const targetLength = 1 + (WEBHOOKER_MAX_PAYLOAD_BYTES - baseSize)

    const exact = expectPayload(await runPrepare(config(bodyTemplate), withContent('x'.repeat(targetLength))))
    expect(snapshotBytes(exact)).toBe(WEBHOOKER_MAX_PAYLOAD_BYTES)

    const over = await runPrepare(config(bodyTemplate), withContent('x'.repeat(targetLength + 1)))
    expect(over).toEqual({ error: { errorCode: 'config' } })
  })

  test('按 UTF-8 字节数而非字符数计：多字节内容字符数低于上限仍拒绝', async () => {

    const cjk = '世'.repeat(22_000)
    const result = await runPrepare(config(bodyTemplate), withContent(cjk))
    expect(result).toEqual({ error: { errorCode: 'config' } })
  })
})





describe('prepareJob：渲染后 URL 出站预检', () => {
  test('默认策略：http 目标拒绝为 outbound-blocked，不建 job', async () => {
    const result = await runPrepare({ targetUrl: 'http://example.com/hook' })
    expect(result).toEqual({ error: { errorCode: 'outbound-blocked' } })
  })

  test('默认策略：私网目标拒绝为 outbound-blocked', async () => {
    const result = await runPrepare({ targetUrl: 'https://192.168.1.10:8123/hook' })
    expect(result).toEqual({ error: { errorCode: 'outbound-blocked' } })
  })

  test('预检作用于渲染后 URL：模板静态部分合法、渲染成私网目标仍拒绝', async () => {


    const result = await runPrepare({ targetUrl: 'https://192.168.1.#{MESSAGE_PRIORITY}/hook' })
    expect(result).toEqual({ error: { errorCode: 'outbound-blocked' } })
  })

  test('query 恒放行（§4.2，兼容 ?token= 形态）：含变量渲染的 query 快照正常', async () => {
    const payload = expectPayload(
      await runPrepare({ targetUrl: 'https://example.com/hook?token=#{USER_ID}' })
    )
    expect(payload.url).toBe(`https://example.com/hook?token=${USER_ID}`)
  })

  test('开关联动：allowHttp 定义放行 http 公网目标，但仍拒私网', async () => {
    const definition = createWebhookerTaskDefinition({ allowHttp: true })
    expect(definition.outbound).toEqual({ allowHttp: true, allowQuery: true })

    const allowed = expectPayload(
      await runPrepare({ targetUrl: 'http://example.com/hook' }, undefined, definition)
    )
    expect(allowed.url).toBe('http://example.com/hook')

    const stillBlocked = await runPrepare(
      { targetUrl: 'http://192.168.1.10/hook' },
      undefined,
      definition
    )
    expect(stillBlocked).toEqual({ error: { errorCode: 'outbound-blocked' } })
  })

  test('开关联动：allowPrivateNetwork 定义放行私网目标，但仍拒 http', async () => {
    const definition = createWebhookerTaskDefinition({ allowPrivateNetwork: true })

    const allowed = expectPayload(
      await runPrepare({ targetUrl: 'https://192.168.1.10:8123/hook' }, undefined, definition)
    )
    expect(allowed.url).toBe('https://192.168.1.10:8123/hook')

    const stillBlocked = await runPrepare(
      { targetUrl: 'http://example.com/hook' },
      undefined,
      definition
    )
    expect(stillBlocked).toEqual({ error: { errorCode: 'outbound-blocked' } })
  })

  test('开关联动：两个开关同时放开时 http + 私网目标放行', async () => {
    const definition = createWebhookerTaskDefinition({
      allowHttp: true,
      allowPrivateNetwork: true
    })
    const payload = expectPayload(
      await runPrepare({ targetUrl: 'http://192.168.1.10/hook' }, undefined, definition)
    )
    expect(payload.url).toBe('http://192.168.1.10/hook')
  })
})





describe('prepareJob：端口边界', () => {
  test('只经宿主端口读消息与 application；不触 secrets / http', async () => {
    const handle = createHost()
    expectPayload(await runPrepare({ targetUrl: 'https://example.com/hook' }, handle.host))

    expect(handle.getMessage).toHaveBeenCalledWith(MESSAGE_ID)
    expect(handle.getApplication).toHaveBeenCalledWith(APP_ID)
    expect(handle.secretsGet).not.toHaveBeenCalled()
    expect(handle.secretsHas).not.toHaveBeenCalled()
    expect(handle.httpFetch).not.toHaveBeenCalled()
  })
})





describe('createWebhookerPlugin：message.create 薄事件入口', () => {
  function pluginCtx(overrides: Record<string, unknown> = {}) {
    const jobs = {
      enqueue: jest.fn(async () => ({ status: 'ok' as const }))
    }
    return {
      jobs,
      ctx: {
        userId: USER_ID,
        now: NOW,
        message: {
          id: MESSAGE_ID,
          appId: APP_ID,
          title: 'Test Alert',
          content: 'Test message content',
          priority: 5
        },
        jobs,
        ...overrides
      }
    }
  }

  test('只调用 ctx.jobs.enqueue({subjectType,subjectId}) 并透传结果', async () => {
    const plugin = createWebhookerPlugin({ id: PLUGIN_ID, name: 'webhooker' })
    const { jobs, ctx } = pluginCtx()
    plugin.init({ config: { targetUrl: 'https://example.com/hook' }, jobs })

    await expect(plugin.onMessageCreate!(ctx)).resolves.toEqual({ status: 'ok' })
    expect(jobs.enqueue).toHaveBeenCalledTimes(1)
    expect(jobs.enqueue).toHaveBeenCalledWith({
      subjectType: 'message',
      subjectId: MESSAGE_ID
    })
  })

  test('无 message → skipped plugin-unavailable，不调用 enqueue', async () => {
    const plugin = createWebhookerPlugin({ id: PLUGIN_ID, name: 'webhooker' })
    const { jobs, ctx } = pluginCtx({ message: undefined })
    await expect(plugin.onMessageCreate!(ctx)).resolves.toEqual({
      status: 'skipped',
      code: 'plugin-unavailable'
    })
    expect(jobs.enqueue).not.toHaveBeenCalled()
  })

  test('无 jobs → skipped plugin-unavailable', async () => {
    const plugin = createWebhookerPlugin({ id: PLUGIN_ID, name: 'webhooker' })
    const { ctx } = pluginCtx({ jobs: undefined })
    await expect(plugin.onMessageCreate!(ctx)).resolves.toEqual({
      status: 'skipped',
      code: 'plugin-unavailable'
    })
  })

  test('enqueue 返回 skipped 时原样透传（不吞配置拒绝）', async () => {
    const plugin = createWebhookerPlugin({ id: PLUGIN_ID, name: 'webhooker' })
    const { ctx } = pluginCtx({
      jobs: {
        enqueue: jest.fn(async () => ({ status: 'skipped' as const, code: 'config' as const }))
      }
    })
    await expect(plugin.onMessageCreate!(ctx)).resolves.toEqual({
      status: 'skipped',
      code: 'config'
    })
  })

  test('capabilities 与 configExample 保留（UI/展示契约不变）', () => {
    const plugin = createWebhookerPlugin({ id: PLUGIN_ID, name: 'webhooker' })
    expect(plugin.capabilities).toEqual(['webhooker', 'messenger'])
    expect(plugin.configExample).toContain('targetUrl')
  })
})
