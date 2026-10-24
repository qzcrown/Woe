

























jest.mock('file-type', () => ({ fileTypeFromBuffer: jest.fn() }), { virtual: true })


jest.mock('../../src/services/migrationRunner.ts', () => ({
  MigrationRunner: class {
    async runPendingMigrations(): Promise<void> {}
  }
}))

import { eq } from 'drizzle-orm'
import worker from '../../src/index.ts'
import app from '../../src/app.ts'
import type { Env } from '../../src/types/index.ts'
import { MessageHandlers } from '../../src/handlers/messageHandlers.ts'
import { createPluginJobRuntime } from '../../src/services/pluginJobs/pluginJobService.ts'
import { PluginSecretService } from '../../src/services/pluginSecretService.ts'
import { WEBHOOKER_MODULE_PATH } from '../../src/plugins/builtin/webhooker/config.ts'
import { PUBLIC_TASK_MODULE as FIXTURE_MODULE_PATH } from '../helpers/publicTaskFixture'
import {
  applications,
  clients,
  messages,
  pluginConfigs,
  pluginJobs,
  pluginLogs
} from '../../src/models/index.ts'
import { createPluginJobsTestDb } from '../helpers/pluginJobsTestDb.ts'
import { asDrizzle } from '../helpers/testDb.ts'
import { makeD1Sqlite } from '../helpers/d1Sqlite.ts'
import { makeExecutionCtxStub, type ExecutionCtxStub } from '../helpers/executionContext.ts'

type TestDb = ReturnType<typeof createPluginJobsTestDb>

const USER_ID = 7
const APP_ID = 1
const CLIENT_TOKEN = 'Cwebhooker-client-token'
const MASTER_KEY = Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => i + 1)).toString('base64')

const FIXTURE_CONFIG = 'valid: true\n'


const WEBHOOKER_CONFIG = `
targetUrl: https://hooks.example.com/hook/#{USER_ID}
method: POST
body: |
  {"text": "#{MESSAGE}", "title": "#{MESSAGE_TITLE}", "app": "#{APP_NAME}", "at": "#{NOW}"}
headers:
  X-User-Id: "#{USER_ID}"
`

interface SetupOptions {

  webhookerYaml?: string

  envVars?: Record<string, string>

  withFixture?: boolean
}

interface Fixture {
  testDb: TestDb
  env: Env
  executionCtx: ExecutionCtxStub
  queueSend: jest.Mock
  sent: Array<{ jobId: number }>
  webhooker: { id: number }
  fixtureTask: { id: number } | null
  handlers: MessageHandlers
  runtime: ReturnType<typeof createPluginJobRuntime>
}

function setup(options: SetupOptions = {}): Fixture {
  const testDb = createPluginJobsTestDb()


  testDb.sqlite
    .prepare('INSERT INTO users (id, name, admin, disabled) VALUES (?, ?, 1, 0)')
    .run(USER_ID, 'webhooker-user')

  testDb.db
    .insert(applications)
    .values({ id: APP_ID, userId: USER_ID, token: 'Awebhooker-app-token', name: 'Probe App' })
    .run()

  testDb.db
    .insert(clients)
    .values({
      id: 5,
      userId: USER_ID,
      token: CLIENT_TOKEN,
      name: 'Probe Device',
      platform: 'web',
      deviceUid: 'probe-device',
      tokenStatus: 'active',

      lastUsed: new Date().toISOString(),
      elevatedUntil: null,
      expiresAfterInactivitySeconds: 0,
      expiresAt: null
    })
    .run()

  const [webhooker] = testDb.db
    .insert(pluginConfigs)
    .values({
      userId: USER_ID,
      name: 'Webhooker',
      token: 'webhooker-plugin-token',
      modulePath: WEBHOOKER_MODULE_PATH,
      configYaml: options.webhookerYaml ?? WEBHOOKER_CONFIG,
      enabled: 1
    })
    .returning()
    .all()

  let fixtureTask: { id: number } | null = null
  if (options.withFixture) {
    const [row] = testDb.db
      .insert(pluginConfigs)
      .values({
        userId: USER_ID,
        name: 'Fixture Task',
        token: 'fixture-task-plugin-token',
        modulePath: FIXTURE_MODULE_PATH,
        configYaml: FIXTURE_CONFIG,
        enabled: 1
      })
      .returning()
      .all()
    fixtureTask = { id: row.id }
  }

  const sent: Array<{ jobId: number }> = []
  const queueSend = jest.fn(async (body: { jobId: number }) => {
    sent.push(body)
  })

  const env = {
    DB: makeD1Sqlite(testDb),
    PLUGIN_JOB_QUEUE: { send: queueSend },
    PLUGIN_SECRET_MASTER_KEY: MASTER_KEY,
    PLUGIN_SECRET_KEY_VERSION: '1',
    ...options.envVars
  } as unknown as Env
  const executionCtx = makeExecutionCtxStub()

  const runtime = createPluginJobRuntime({ drizzle: asDrizzle(testDb), env })
  const handlers = new MessageHandlers(asDrizzle(testDb), undefined, runtime)

  return { testDb, env, executionCtx, queueSend, sent, webhooker, fixtureTask, handlers, runtime }
}


async function createMessage(
  handlers: MessageHandlers,
  overrides: { message?: string; title?: string; priority?: number; extras?: any } = {}
): Promise<{ id: number }> {
  const response = await handlers.createMessage(
    APP_ID,
    overrides.message ?? '生产环境部署失败，请检查流水线日志',
    overrides.title,
    overrides.priority,
    overrides.extras
  )
  expect(response.status).toBe(200)
  return (await response.json()) as { id: number }
}


async function deliver(
  fx: Fixture,
  jobId: number,
  attempts = 1
): Promise<{ ack: jest.Mock; retry: jest.Mock }> {
  const ack = jest.fn()
  const retry = jest.fn()
  const batch = {
    queue: 'woe-plugin-jobs',
    messages: [{ id: `probe-${jobId}`, body: { jobId }, attempts, ack, retry }],
    ackAll: jest.fn(),
    retryAll: jest.fn()
  }
  await worker.queue(batch as unknown as MessageBatch<unknown>, fx.env, fx.executionCtx)
  return { ack, retry }
}


function mockFetch(impl: () => Promise<Response>): jest.SpyInstance {
  return jest.spyOn(globalThis, 'fetch').mockImplementation(impl)
}

function jobRows(testDb: TestDb) {
  return testDb.db.select().from(pluginJobs).all()
}

function jobRow(testDb: TestDb, id: number) {
  return testDb.db.select().from(pluginJobs).where(eq(pluginJobs.id, id)).get()!
}

function jobPayload(testDb: TestDb, id: number) {
  return JSON.parse(jobRow(testDb, id).payload as string) as {
    url: string
    method: string
    headers: Record<string, string>
    body: string
  }
}


function logEvents(testDb: TestDb): Array<{ event: string; error: string | null }> {
  return testDb.db
    .select({ event: pluginLogs.event, error: pluginLogs.error })
    .from(pluginLogs)
    .all()
}

async function request(fx: Fixture, path: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'x-gotify-key': CLIENT_TOKEN,
    ...((init.headers as Record<string, string>) ?? {})
  }
  return await app.fetch(
    new Request(`http://localhost${path}`, { ...init, headers }),
    fx.env as never,
    fx.executionCtx
  )
}

afterEach(() => {
  jest.restoreAllMocks()
})

describe('message.create 事件链路（唯一业务路径）', () => {
  test('创建消息 -> pending 快照(渲染终产物) -> 真分流 -> mock 出站 -> success', async () => {
    const fx = setup()
    const fetchSpy = mockFetch(async () => new Response('OK', { status: 200 }))

    const created = await createMessage(fx.handlers, { title: '构建失败' })
    const messageId = created.id


    const rows = jobRows(fx.testDb)
    expect(rows).toHaveLength(1)
    const job = rows[0]
    expect(job).toMatchObject({
      userId: USER_ID,
      pluginId: fx.webhooker.id,
      subjectType: 'message',
      subjectId: messageId,
      status: 'pending'
    })

    const snapshot = jobPayload(fx.testDb, job.id)
    expect(snapshot.url).toBe(`https://hooks.example.com/hook/${USER_ID}`)
    expect(snapshot.method).toBe('POST')
    expect(snapshot.headers).toEqual({
      'Content-Type': 'application/json',
      'X-User-Id': String(USER_ID)
    })
    const body = JSON.parse(snapshot.body)
    expect(body.text).toBe('生产环境部署失败，请检查流水线日志')
    expect(body.title).toBe('构建失败')
    expect(body.app).toBe('Probe App')

    expect(body.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)


    expect(fx.queueSend).toHaveBeenCalledTimes(1)
    expect(fx.sent).toEqual([{ jobId: job.id }])


    const { ack, retry } = await deliver(fx, job.id)
    expect(ack).toHaveBeenCalledTimes(1)
    expect(retry).not.toHaveBeenCalled()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const outbound = fetchSpy.mock.calls[0]
    expect(outbound[0]).toBe(`https://hooks.example.com/hook/${USER_ID}`)
    expect(outbound[1]).toMatchObject({ method: 'POST', redirect: 'manual' })
    expect(outbound[1].headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-User-Id': String(USER_ID)
    })

    expect(outbound[1].body).toBe(snapshot.body)

    const done = jobRow(fx.testDb, job.id)
    expect(done.status).toBe('success')
    expect(JSON.parse(done.result as string)).toEqual({ status: 'sent', httpStatus: 200 })
    expect(done.lastErrorCode).toBeNull()
    expect(done.lastErrorMessage).toBeNull()
    expect(done.completedAt).not.toBeNull()



    const plugin = fx.testDb.db
      .select()
      .from(pluginConfigs)
      .where(eq(pluginConfigs.id, fx.webhooker.id))
      .get()!
    expect(plugin.usageCount).toBe(0)
    expect(logEvents(fx.testDb)).toEqual([{ event: 'message.create', error: null }])


    const history = await request(fx, `/message/${messageId}/jobs?pluginId=${fx.webhooker.id}`)
    expect(history.status).toBe(200)
    const historyBody = (await history.json()) as {
      messageDeleted: boolean
      jobs: Array<Record<string, unknown>>
    }
    expect(historyBody.messageDeleted).toBe(false)
    expect(historyBody.jobs).toHaveLength(1)
    expect(historyBody.jobs[0]).toMatchObject({
      jobId: job.id,
      pluginId: fx.webhooker.id,
      status: 'success',
      result: { status: 'sent', httpStatus: 200 },
      error: null
    })

    expect(historyBody.jobs[0]).not.toHaveProperty('payload')
  })

  test('消息删除后快照仍可投递：执行期不读消息，历史按 messageDeleted 返回', async () => {
    const fx = setup()
    mockFetch(async () => new Response('OK', { status: 200 }))

    const created = await createMessage(fx.handlers)
    const [job] = jobRows(fx.testDb)


    fx.testDb.sqlite.prepare('DELETE FROM messages WHERE id = ?').run(created.id)

    const { ack, retry } = await deliver(fx, job.id)
    expect(ack).toHaveBeenCalledTimes(1)
    expect(retry).not.toHaveBeenCalled()

    const done = jobRow(fx.testDb, job.id)
    expect(done.status).toBe('success')
    expect(JSON.parse(done.result as string)).toEqual({ status: 'sent', httpStatus: 200 })

    const history = await request(fx, `/message/${created.id}/jobs`)
    expect(history.status).toBe(200)
    const body = (await history.json()) as { messageDeleted: boolean; jobs: Array<{ jobId: number }> }
    expect(body.messageDeleted).toBe(true)
    expect(body.jobs.map((row) => row.jobId)).toEqual([job.id])
  })

  test('pending 查重：同 subject 二次 event 入队返回既有 job；终态后可再入队', async () => {
    const fx = setup()
    mockFetch(async () => new Response('OK', { status: 200 }))

    const created = await createMessage(fx.handlers)
    const [first] = jobRows(fx.testDb)
    expect(fx.queueSend).toHaveBeenCalledTimes(1)


    const enqueue = fx.runtime.jobsFactory({ userId: USER_ID, pluginId: fx.webhooker.id })
    const outcome = await enqueue.enqueue({ subjectType: 'message', subjectId: created.id })
    expect(outcome).toEqual({ status: 'ok' })


    expect(jobRows(fx.testDb)).toHaveLength(1)
    expect(fx.queueSend).toHaveBeenCalledTimes(1)


    await deliver(fx, first.id)
    expect(jobRow(fx.testDb, first.id).status).toBe('success')

    const again = await enqueue.enqueue({ subjectType: 'message', subjectId: created.id })
    expect(again).toEqual({ status: 'ok' })
    const rows = jobRows(fx.testDb)
    expect(rows).toHaveLength(2)
    expect(rows.filter((row) => row.status === 'pending')).toHaveLength(1)
    expect(fx.queueSend).toHaveBeenCalledTimes(2)
  })

  test('filter 事件路径生效：tags 不匹配 / 优先级不足不入队；匹配正常入队', async () => {
    const fx = setup({
      webhookerYaml: `
targetUrl: https://hooks.example.com/hook
filter:
  tags: ["alert"]
  minPriority: 5
`
    })
    mockFetch(async () => new Response('OK', { status: 200 }))


    const mismatched = await createMessage(fx.handlers, {
      title: '日常巡检',
      priority: 9,
      extras: { 'woe::filter::tags': ['info'] }
    })
    expect(mismatched.id).toBeGreaterThan(0)
    expect(jobRows(fx.testDb)).toHaveLength(0)
    expect(fx.queueSend).not.toHaveBeenCalled()


    await createMessage(fx.handlers, {
      title: '低优先级告警',
      priority: 3,
      extras: { 'woe::filter::tags': ['alert'] }
    })
    expect(jobRows(fx.testDb)).toHaveLength(0)
    expect(fx.queueSend).not.toHaveBeenCalled()


    const matched = await createMessage(fx.handlers, {
      title: '生产告警',
      priority: 8,
      extras: { 'woe::filter::tags': ['alert', 'ops'] }
    })
    const [job] = jobRows(fx.testDb)
    expect(job).toMatchObject({ subjectId: matched.id, status: 'pending' })
    expect(fx.queueSend).toHaveBeenCalledTimes(1)

    const { ack } = await deliver(fx, job.id)
    expect(ack).toHaveBeenCalledTimes(1)
    expect(jobRow(fx.testDb, job.id).status).toBe('success')
  })

  test('手动拒绝：POST /message/:id/jobs 对 webhooker 409 不建 job；fixture-task 手动 202 不变', async () => {
    const fx = setup({ withFixture: true })


    const created = await createMessage(fx.handlers)
    const eventJobs = jobRows(fx.testDb)
    expect(eventJobs).toHaveLength(2)
    const fixtureTaskEventJob = eventJobs.find((row) => row.pluginId === fx.fixtureTask!.id)!
    const queueCallsAfterEvent = fx.queueSend.mock.calls.length


    const webhookerPost = await request(fx, `/message/${created.id}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pluginId: fx.webhooker.id })
    })
    expect(webhookerPost.status).toBe(409)
    expect(await webhookerPost.json()).toMatchObject({
      errorDescription: 'Plugin is not available for message jobs'
    })
    expect(jobRows(fx.testDb)).toHaveLength(2)
    expect(fx.queueSend.mock.calls.length).toBe(queueCallsAfterEvent)
    expect(
      logEvents(fx.testDb).filter((row) => row.event === 'plugin_job.enqueue_rejected')
    ).toEqual([{ event: 'plugin_job.enqueue_rejected', error: 'plugin-unavailable' }])



    const fixtureTaskEvent = await deliver(fx, fixtureTaskEventJob.id)
    expect(fixtureTaskEvent.ack).toHaveBeenCalledTimes(1)
    expect(jobRow(fx.testDb, fixtureTaskEventJob.id).status).toBe('success')

    const fixtureTaskPost = await request(fx, `/message/${created.id}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pluginId: fx.fixtureTask!.id })
    })
    expect(fixtureTaskPost.status).toBe(202)
    const manualBody = (await fixtureTaskPost.json()) as { jobId: number; status: string }
    expect(manualBody.status).toBe('pending')
    expect(manualBody.jobId).not.toBe(fixtureTaskEventJob.id)

    const rows = jobRows(fx.testDb)
    expect(rows).toHaveLength(3)
    expect(rows.filter((row) => row.pluginId === fx.webhooker.id && row.status === 'pending'))
      .toHaveLength(1)
    expect(rows.filter((row) => row.pluginId === fx.fixtureTask!.id && row.status === 'pending'))
      .toHaveLength(1)


    const history = await request(fx, `/message/${created.id}/jobs`)
    const body = (await history.json()) as { jobs: Array<{ pluginId: number; status: string }> }
    expect(body.jobs).toHaveLength(3)
    expect(body.jobs.filter((row) => row.pluginId === fx.webhooker.id)).toHaveLength(1)
    expect(body.jobs.filter((row) => row.pluginId === fx.fixtureTask!.id)).toHaveLength(2)
  })
})

describe('出站策略 vars 矩阵（入队期 prepareJob 预检 + 执行期防线同源）', () => {
  test('默认部署：http 目标入队期 outbound-blocked 拒绝，消息创建不受影响', async () => {
    const fx = setup({ webhookerYaml: 'targetUrl: http://hooks.example.com/hook\n' })
    const fetchSpy = mockFetch(async () => new Response('OK', { status: 200 }))

    const created = await createMessage(fx.handlers)


    expect(jobRows(fx.testDb)).toHaveLength(0)
    expect(fx.queueSend).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(logEvents(fx.testDb)).toEqual([
      { event: 'plugin_job.enqueue_rejected', error: 'outbound-blocked' }
    ])
    expect(
      fx.testDb.sqlite.prepare('SELECT COUNT(*) AS c FROM messages').get() as { c: number }
    ).toMatchObject({ c: 1 })
    expect(created.id).toBeGreaterThan(0)
  })

  test('默认部署：私网目标入队期拒绝', async () => {
    const fx = setup({ webhookerYaml: 'targetUrl: https://192.168.1.10/hook\n' })
    mockFetch(async () => new Response('OK', { status: 200 }))

    await createMessage(fx.handlers)

    expect(jobRows(fx.testDb)).toHaveLength(0)
    expect(fx.queueSend).not.toHaveBeenCalled()
    expect(logEvents(fx.testDb)).toEqual([
      { event: 'plugin_job.enqueue_rejected', error: 'outbound-blocked' }
    ])
  })

  test('默认部署：query string 恒放行（?token= 存量形态）并原样出站', async () => {
    const fx = setup({
      webhookerYaml: 'targetUrl: https://hooks.example.com/hook?token=legacy-token\n'
    })
    const fetchSpy = mockFetch(async () => new Response('OK', { status: 200 }))

    await createMessage(fx.handlers)
    const [job] = jobRows(fx.testDb)
    expect(jobPayload(fx.testDb, job.id).url).toBe('https://hooks.example.com/hook?token=legacy-token')

    const { ack } = await deliver(fx, job.id)
    expect(ack).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][0]).toBe('https://hooks.example.com/hook?token=legacy-token')
    expect(jobRow(fx.testDb, job.id).status).toBe('success')
  })

  test('WEBHOOKER_ALLOW_HTTP=true：http 公网目标放行', async () => {

    const fx = setup({
      webhookerYaml: 'targetUrl: http://hooks.example.com/hook\n',
      envVars: { WEBHOOKER_ALLOW_HTTP: 'true' }
    })
    const fetchSpy = mockFetch(async () => new Response('OK', { status: 200 }))

    await createMessage(fx.handlers)
    const [job] = jobRows(fx.testDb)
    expect(job).toBeDefined()

    const { ack } = await deliver(fx, job.id)
    expect(ack).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][0]).toBe('http://hooks.example.com/hook')
    expect(jobRow(fx.testDb, job.id).status).toBe('success')
  })

  test('WEBHOOKER_ALLOW_PRIVATE_NETWORK=true：私网目标放行（http 仍拒）', async () => {
    const fx = setup({
      webhookerYaml: 'targetUrl: https://10.0.0.5/hook\n',
      envVars: { WEBHOOKER_ALLOW_PRIVATE_NETWORK: 'true' }
    })


    const [httpPlugin] = fx.testDb.db
      .insert(pluginConfigs)
      .values({
        userId: USER_ID,
        name: 'Webhooker (http)',
        token: 'webhooker-plugin-token-http',
        modulePath: WEBHOOKER_MODULE_PATH,
        configYaml: 'targetUrl: http://hooks.example.com/plain\n',
        enabled: 1
      })
      .returning()
      .all()

    const fetchSpy = mockFetch(async () => new Response('OK', { status: 200 }))

    await createMessage(fx.handlers)


    const [job] = jobRows(fx.testDb)
    expect(job).toMatchObject({ pluginId: fx.webhooker.id, status: 'pending' })

    const { ack } = await deliver(fx, job.id)
    expect(ack).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][0]).toBe('https://10.0.0.5/hook')
    expect(jobRow(fx.testDb, job.id).status).toBe('success')


    expect(jobRows(fx.testDb).filter((row) => row.pluginId === httpPlugin.id)).toEqual([])
    expect(
      logEvents(fx.testDb).filter((row) => row.event === 'plugin_job.enqueue_rejected')
    ).toEqual([{ event: 'plugin_job.enqueue_rejected', error: 'outbound-blocked' }])
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

describe('重试与错误映射（§3.2，经真 consumer 分流）', () => {
  test('429 + Retry-After=30：首次尝试保持 pending 并透传延迟重试', async () => {
    const fx = setup()
    mockFetch(
      async () => new Response('slow down', { status: 429, headers: { 'retry-after': '30' } })
    )

    const created = await createMessage(fx.handlers)
    const [job] = jobRows(fx.testDb)

    const { ack, retry } = await deliver(fx, job.id, 1)
    expect(retry).toHaveBeenCalledWith({ delaySeconds: 30 })
    expect(ack).not.toHaveBeenCalled()

    const row = jobRow(fx.testDb, job.id)
    expect(row.status).toBe('pending')
    expect(row.lastErrorCode).toBe('provider-rate-limit')
    expect(row.completedAt).toBeNull()
    expect(created.id).toBeGreaterThan(0)
  })

  test('5xx 在最后一次尝试：dead 终态 + plugin_job.dead 日志', async () => {
    const fx = setup()
    mockFetch(async () => new Response('boom', { status: 500 }))

    await createMessage(fx.handlers)
    const [job] = jobRows(fx.testDb)

    const { ack, retry } = await deliver(fx, job.id, 3)
    expect(ack).toHaveBeenCalledTimes(1)
    expect(retry).not.toHaveBeenCalled()

    const row = jobRow(fx.testDb, job.id)
    expect(row.status).toBe('dead')
    expect(row.lastErrorCode).toBe('provider-network')

    expect(logEvents(fx.testDb)).toEqual([
      { event: 'message.create', error: null },
      { event: 'plugin_job.dead', error: 'provider-network' }
    ])
  })

  test('401：provider-auth 不可重试，终态 failed + plugin_job.failed 日志', async () => {
    const fx = setup()
    mockFetch(async () => new Response('unauthorized', { status: 401 }))

    await createMessage(fx.handlers)
    const [job] = jobRows(fx.testDb)

    const { ack, retry } = await deliver(fx, job.id)
    expect(ack).toHaveBeenCalledTimes(1)
    expect(retry).not.toHaveBeenCalled()

    const row = jobRow(fx.testDb, job.id)
    expect(row.status).toBe('failed')
    expect(row.lastErrorCode).toBe('provider-auth')
    expect(row.completedAt).not.toBeNull()

    expect(logEvents(fx.testDb)).toEqual([
      { event: 'message.create', error: null },
      { event: 'plugin_job.failed', error: 'provider-auth' }
    ])
  })

  test('网络错误（fetch reject）：provider-network 可重试，按缺省退避 2s', async () => {
    const fx = setup()
    mockFetch(async () => {
      throw new Error('connection reset')
    })

    await createMessage(fx.handlers)
    const [job] = jobRows(fx.testDb)

    const { ack, retry } = await deliver(fx, job.id, 1)
    expect(retry).toHaveBeenCalledWith({ delaySeconds: 2 })
    expect(ack).not.toHaveBeenCalled()

    const row = jobRow(fx.testDb, job.id)
    expect(row.status).toBe('pending')
    expect(row.lastErrorCode).toBe('provider-network')
  })
})

describe('Authorization 兼容与 authToken secret 注入', () => {
  test('旧明文 headers.Authorization：快照携带并原样出站，不触 secrets', async () => {
    const fx = setup({
      webhookerYaml: `
targetUrl: https://hooks.example.com/hook
headers:
  Authorization: "Bearer legacy-plain-token"
`
    })
    const fetchSpy = mockFetch(async () => new Response('OK', { status: 200 }))

    await createMessage(fx.handlers)
    const [job] = jobRows(fx.testDb)


    expect(jobPayload(fx.testDb, job.id).headers.Authorization).toBe('Bearer legacy-plain-token')

    const { ack } = await deliver(fx, job.id)
    expect(ack).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][1].headers.Authorization).toBe('Bearer legacy-plain-token')
    expect(jobRow(fx.testDb, job.id).status).toBe('success')
  })

  test('authToken：掩码保存 -> 入队通过 -> 执行期解密注入 Bearer（快照不含凭据）', async () => {
    const fx = setup({
      webhookerYaml: 'targetUrl: https://hooks.example.com/hook\nauthToken: placeholder\n'
    })


    const secretService = new PluginSecretService({
      PLUGIN_SECRET_MASTER_KEY: MASTER_KEY,
      PLUGIN_SECRET_KEY_VERSION: '1'
    })
    const prepared = await secretService.processConfigForSave({
      pluginId: fx.webhooker.id,
      userId: USER_ID,
      configYaml: 'targetUrl: https://hooks.example.com/hook\nauthToken: sk-webhooker-secret\n',
      encryptedSecret: null,
      secretFields: ['authToken']
    })
    expect(prepared.configYaml).toContain('***')
    fx.testDb.db
      .update(pluginConfigs)
      .set({ configYaml: prepared.configYaml, encryptedSecret: prepared.encryptedSecret })
      .where(eq(pluginConfigs.id, fx.webhooker.id))
      .run()

    const fetchSpy = mockFetch(async () => new Response('OK', { status: 200 }))


    await createMessage(fx.handlers)
    const [job] = jobRows(fx.testDb)
    expect(job.status).toBe('pending')


    const snapshot = jobPayload(fx.testDb, job.id)
    expect(Object.keys(snapshot.headers).some((name) => name.toLowerCase() === 'authorization')).toBe(
      false
    )

    const { ack } = await deliver(fx, job.id)
    expect(ack).toHaveBeenCalledTimes(1)

    expect(fetchSpy.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-webhooker-secret')
    expect(jobRow(fx.testDb, job.id).status).toBe('success')
  })
})
