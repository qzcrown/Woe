







import { eq } from 'drizzle-orm'
import { createPluginJobsTestDb } from '../helpers/pluginJobsTestDb'
import { asDrizzle } from '../helpers/testDb'
import type { TestDb } from '../helpers/testDb'
import type { Env } from '../../src/types/index'
import type { DrizzleDB } from '../../src/drizzle/index'
import { applications, messages, pluginConfigs, pluginLogs } from '../../src/models'
import { createPluginHost } from '../../src/services/pluginJobs/pluginHost'
import {
  createPluginTaskRegistry,
  getPluginConfigParser,
  getPluginSecretFields,
  getQuotaNamespaceModulePaths,
  getQuotaNamespaces,
  hasPluginTask,
  registerPluginTask,
  resetPluginTaskRegistry,
  resolvePluginTask
} from '../../src/plugins/jobs/registry'
import { builtinPluginTasks } from '../../src/plugins/builtin/pluginTasks'
import type {
  PluginConfigErrorCode,
  PluginConfigFailure,
  PluginEnqueueErrorCode,
  PluginEventOutcome,
  PluginHostContext,
  PluginJobContext,
  PluginJobsAccess,
  PluginTask,
  PluginTaskDefinition,
  PluginTaskFailure,
  PluginTaskResult
} from '../../src/plugins/jobs/types'
import { register as registerPlugin } from '../../src/plugins/registry'
import { PluginManager } from '../../src/plugins/manager'
import { TAG_MAX_COUNT } from '../../src/services/messageTagsService'

const env = {} as Env


function minimalDefinition(modulePath = 'test/minimal'): PluginTaskDefinition {
  return {
    modulePath,
    supportedSubjectTypes: ['message'],
    createTask: async () => ({ run: async () => ({ ok: true }) })
  }
}





function seedUser(testDb: TestDb, name: string): number {
  const info = testDb.sqlite
    .prepare('INSERT INTO users (name, admin, disabled) VALUES (?, 1, 0)')
    .run(name)
  return Number(info.lastInsertRowid)
}

function seedMessage(
  testDb: TestDb,
  userId: number,
  overrides: Partial<typeof messages.$inferInsert> = {}
): typeof messages.$inferSelect {
  const [row] = testDb.db
    .insert(messages)
    .values({
      userid: userId,
      appid: 1,
      message: 'hello world',
      title: 'Hello',
      extras: null,
      ...overrides
    })
    .returning()
    .all()
  return row
}

function seedPluginConfig(testDb: TestDb, userId: number, modulePath: string): number {
  const [row] = testDb.db
    .insert(pluginConfigs)
    .values({
      userId,
      name: modulePath,
      token: `token-${modulePath}`,
      modulePath,
      enabled: 1
    })
    .returning()
    .all()
  return row.id
}

describe('PluginTaskDefinition 契约', () => {
  beforeEach(() => {
    resetPluginTaskRegistry()
  })

  test('createTask 是唯一必填钩子，最小定义可被 registry 接受', () => {
    const definition = minimalDefinition('test/minimal')


    expect(definition.validateConfig).toBeUndefined()
    expect(definition.prepareJob).toBeUndefined()

    registerPluginTask(definition)
    expect(hasPluginTask('test/minimal')).toBe(true)
    expect(resolvePluginTask('test/minimal')).toBe(definition)
  })

  test('缺少 createTask 的 definition 无法通过类型检查', () => {
    // @ts-expect-error createTask 是唯一必填钩子
    const missingCreateTask: PluginTaskDefinition = {
      modulePath: 'test/missing-create-task',
      supportedSubjectTypes: ['message']
    }
    void missingCreateTask
  })

  test('registry 只做静态查表，不主动执行定义提供的钩子', async () => {
    const validateConfig = jest.fn(async () => undefined)
    const prepareJob = jest.fn(async () => ({}))
    const createTask = jest.fn(async (): Promise<PluginTask> => ({
      run: async () => ({ ok: true })
    }))

    const definition: PluginTaskDefinition = {
      modulePath: 'test/optional-hooks',
      supportedSubjectTypes: ['message'],
      validateConfig,
      prepareJob,
      createTask
    }

    registerPluginTask(definition)
    expect(resolvePluginTask('test/optional-hooks')).toBe(definition)

    expect(validateConfig).not.toHaveBeenCalled()
    expect(prepareJob).not.toHaveBeenCalled()
    expect(createTask).not.toHaveBeenCalled()


    const host = createPluginHost(asDrizzle(createPluginJobsTestDb()), env, 7, 3, definition)
    const config = { apiKey: 'placeholder', maxTags: 3 }
    const job: PluginJobContext = {
      jobId: 10,
      userId: 7,
      pluginId: 3,
      subjectType: 'message',
      subjectId: 42,
      payload: null
    }

    await expect(definition.validateConfig!({ config, host })).resolves.toBeUndefined()
    const PREPARE_NOW = '2026-10-23T00:00:00.000Z'
    await expect(
      definition.prepareJob!({
        userId: 7,
        pluginId: 3,
        subjectType: 'message',
        subjectId: 42,
        config,
        host,
        now: PREPARE_NOW
      })
    ).resolves.toEqual({})

    expect(prepareJob).toHaveBeenCalledWith(
      expect.objectContaining({ subjectId: 42, now: PREPARE_NOW })
    )
    const task: PluginTask = await definition.createTask({ config, job, host })
    await expect(task.run({ attempt: 1, timeoutMs: 1000 })).resolves.toEqual({ ok: true })


    expect(validateConfig).toHaveBeenCalledTimes(1)
    expect(prepareJob).toHaveBeenCalledTimes(1)
    expect(createTask).toHaveBeenCalledTimes(1)
  })

  test('PluginTaskResult 同时覆盖成功/失败/skipped 与 quotaConsumed', async () => {
    const success: PluginTask = {
      run: async () => ({ ok: true, result: { tags: ['a'] }, quotaConsumed: false })
    }
    const skipped: PluginTask = {
      run: async () => ({
        ok: true,
        skipped: { code: 'capacity-full' },
        result: { tags: ['a'] },
        quotaConsumed: false
      })
    }
    const failure: PluginTask = {
      run: async () => ({
        ok: false,
        failure: { errorCode: 'provider-rate-limit', retriable: true, retryAfterMs: 2000 },
        quotaConsumed: true
      })
    }
    await expect(success.run({ attempt: 1, timeoutMs: 100 })).resolves.toEqual({
      ok: true,
      result: { tags: ['a'] },
      quotaConsumed: false
    })
    await expect(skipped.run({ attempt: 1, timeoutMs: 100 })).resolves.toEqual({
      ok: true,
      skipped: { code: 'capacity-full' },
      result: { tags: ['a'] },
      quotaConsumed: false
    })
    await expect(failure.run({ attempt: 2, timeoutMs: 100 })).resolves.toEqual({
      ok: false,
      failure: { errorCode: 'provider-rate-limit', retriable: true, retryAfterMs: 2000 },
      quotaConsumed: true
    })




    const plainWithoutSkipped: PluginTaskResult = { ok: true, skipped: undefined }
    // @ts-expect-error skipped 与 failure 互斥（跳过不是失败）
    const failureWithSkipped: PluginTaskResult = { ok: false, failure: { errorCode: 'config', retriable: false }, skipped: { code: 'capacity-full' } }
    void plainWithoutSkipped
    void failureWithSkipped
  })

  test('PluginJobContext 持有 job 身份与 payload 快照', () => {
    const job: PluginJobContext = {
      jobId: 10,
      userId: 7,
      pluginId: 3,
      subjectType: 'message',
      subjectId: 42,
      payload: { foo: 'bar' }
    }
    expect(job).toEqual({
      jobId: 10,
      userId: 7,
      pluginId: 3,
      subjectType: 'message',
      subjectId: 42,
      payload: { foo: 'bar' }
    })
  })

  test('manualTrigger 与 outbound 是可选契约字段，缺省不填充（兼容既有插件）', () => {
    const definition = minimalDefinition('test/optional-policy')
    expect(definition.manualTrigger).toBeUndefined()
    expect(definition.outbound).toBeUndefined()


    const eventOnly: PluginTaskDefinition = {
      ...minimalDefinition('test/event-only'),
      manualTrigger: false,
      outbound: { allowHttp: true, allowPrivateNetwork: true, allowQuery: true }
    }
    registerPluginTask(eventOnly)
    expect(resolvePluginTask('test/event-only')).toBe(eventOnly)
  })
})

describe('错误码封闭集合（outbound-blocked / downstream-rejected）', () => {
  test('outbound-blocked 同属 config / enqueue / job 三个错误码联合', () => {
    const configFailure: PluginConfigFailure = { errorCode: 'outbound-blocked' }
    const configCode: PluginConfigErrorCode = 'outbound-blocked'
    const enqueueCode: PluginEnqueueErrorCode = 'outbound-blocked'
    const taskFailure: PluginTaskFailure = { errorCode: 'outbound-blocked', retriable: false }
    const skipped: PluginEventOutcome = { status: 'skipped', code: 'outbound-blocked' }

    expect(configFailure).toEqual({ errorCode: 'outbound-blocked' })
    expect([configCode, enqueueCode]).toEqual(['outbound-blocked', 'outbound-blocked'])
    expect(taskFailure.retriable).toBe(false)
    expect(skipped).toEqual({ status: 'skipped', code: 'outbound-blocked' })
  })

  test('downstream-rejected 仅属任务错误码联合，不进入配置/入队联合', () => {
    const taskFailure: PluginTaskFailure = { errorCode: 'downstream-rejected', retriable: false }
    expect(taskFailure.errorCode).toBe('downstream-rejected')

    // @ts-expect-error downstream-rejected 不在入队错误码联合（仅运行时使用）
    const enqueueCode: PluginEnqueueErrorCode = 'downstream-rejected'
    // @ts-expect-error downstream-rejected 不在配置错误码联合
    const configCode: PluginConfigErrorCode = 'downstream-rejected'
    void enqueueCode
    void configCode
  })

  test('未知错误码无法通过类型检查（封闭集合）', () => {
    // @ts-expect-error 任意字符串不能赋给封闭错误码联合
    const badCode: PluginConfigErrorCode = 'not-a-code'
    void badCode
  })
})

describe('PluginTaskRegistry（静态目录）', () => {
  beforeEach(() => {
    resetPluginTaskRegistry()
  })

  test('builtin 静态任务目录与当前生成的 manifest 元数据完全对应', async () => {
    const { builtinPluginTaskMetadata } = await import('../../src/plugins/builtin/pluginTasks')
    expect(builtinPluginTasks.map((definition) => definition.modulePath)).toEqual(
      builtinPluginTaskMetadata.map((definition) => definition.modulePath)
    )
  })

  test('解析已注册定义；未知 modulePath 返回 null（无静默回退）', () => {
    const definition = minimalDefinition('test/known')
    registerPluginTask(definition)

    expect(resolvePluginTask('test/known')).toBe(definition)
    expect(resolvePluginTask('test/unknown')).toBeNull()
    expect(hasPluginTask('test/unknown')).toBe(false)
  })

  test('重复注册同名 modulePath 抛错，不静默覆盖', () => {
    registerPluginTask(minimalDefinition('test/duplicate'))
    expect(() => registerPluginTask(minimalDefinition('test/duplicate'))).toThrow(
      /already registered/
    )
  })
})

describe('声明化 config parser 与配额 namespace 目录', () => {
  test('quota namespace 与声明模块逐项来自当前生成目录', async () => {
    const { moduleDescriptors } = await import('../../src/generated/plugins/catalog')
    const expectedNamespaces = [...new Set(
      moduleDescriptors
        .map(descriptor => descriptor.task?.quotaNamespace)
        .filter((value): value is string => value !== undefined)
    )].sort()
    expect(getQuotaNamespaces()).toEqual(expectedNamespaces)
    for (const namespace of expectedNamespaces) {
      expect(getQuotaNamespaceModulePaths(namespace)).toEqual(
        moduleDescriptors
          .filter(descriptor => descriptor.task?.quotaNamespace === namespace)
          .map(descriptor => descriptor.modulePath)
          .sort()
      )
    }
    expect(getQuotaNamespaceModulePaths('test/undeclared-namespace')).toEqual([])
  })

  test('config parser 与当前 generated server 投影一致，未知模块返回 null', async () => {
    const { moduleDescriptors } = await import('../../src/generated/plugins/catalog')
    const { serverModules } = await import('../../src/generated/plugins/server')
    const modules = serverModules as unknown as Readonly<Record<string, {
      configParser?: (raw: unknown) => { ok: boolean }
    }>>
    for (const descriptor of moduleDescriptors) {
      const expected = modules[descriptor.modulePath]?.configParser
      const actual = getPluginConfigParser(descriptor.modulePath)
      if (expected) {
        expect(actual).not.toBeNull()
        expect(actual!.parse).toBe(expected)
        expect(actual!.errorDescription).toBe(descriptor.configErrorDescription ?? 'Invalid plugin config')
      } else {
        expect(actual).toBeNull()
      }
    }
    expect(getPluginConfigParser('unknown/module')).toBeNull()
  })
})

describe('createPluginHost 端口绑定', () => {
  let testDb: TestDb
  let drizzle: DrizzleDB

  beforeEach(() => {
    testDb = createPluginJobsTestDb()
    drizzle = asDrizzle(testDb)
  })

  test('host 绑定 userId/pluginId，不暴露数据库句柄', () => {
    const host = createPluginHost(drizzle, env, 7, 3, minimalDefinition())

    expect(host.userId).toBe(7)
    expect(host.pluginId).toBe(3)
    expect('drizzle' in host).toBe(false)
    expect('db' in host).toBe(false)
  })

  test('getMessage 仅能读取同一用户的消息，找不到返回 null', async () => {
    const own = seedMessage(testDb, 7, {
      extras: '{"a":1}',
      date: '2026-10-23 10:00:00',
      priority: 5
    })
    const other = seedMessage(testDb, 8)
    const host = createPluginHost(drizzle, env, 7, 3, minimalDefinition())

    const message = await host.messages.getMessage(own.id)
    expect(message).toEqual({
      id: own.id,
      appId: 1,
      date: '2026-10-23T10:00:00.000Z',
      priority: 5,
      title: 'Hello',
      content: 'hello world',
      extras: { a: 1 }
    })

    await expect(host.messages.getMessage(other.id)).resolves.toBeNull()
    await expect(host.messages.getMessage(999999)).resolves.toBeNull()
  })

  test('getMessage 的 date 归一为 UTC ISO 8601，无效/缺失值兜底为空串', async () => {
    const epoch = seedMessage(testDb, 7, { date: '1700000000000' })
    const sqliteTs = seedMessage(testDb, 7, { date: '2026-10-23 12:34:56' })
    const iso = seedMessage(testDb, 7, { date: '2026-10-23T12:34:56.789Z' })
    const isoNoZone = seedMessage(testDb, 7, { date: '2026-10-23T12:34:56' })
    const garbage = seedMessage(testDb, 7, { date: 'not-a-date' })
    const blank = seedMessage(testDb, 7, { date: '' })
    const missing = seedMessage(testDb, 7, { date: null })
    const noPriority = seedMessage(testDb, 7, { priority: null })
    const host = createPluginHost(drizzle, env, 7, 3, minimalDefinition())

    expect((await host.messages.getMessage(epoch.id))?.date).toBe('2023-11-14T22:13:20.000Z')
    expect((await host.messages.getMessage(sqliteTs.id))?.date).toBe('2026-10-23T12:34:56.000Z')
    expect((await host.messages.getMessage(iso.id))?.date).toBe('2026-10-23T12:34:56.789Z')
    expect((await host.messages.getMessage(isoNoZone.id))?.date).toBe('2026-10-23T12:34:56.000Z')
    expect((await host.messages.getMessage(garbage.id))?.date).toBe('')
    expect((await host.messages.getMessage(blank.id))?.date).toBe('')
    expect((await host.messages.getMessage(missing.id))?.date).toBe('')

    expect((await host.messages.getMessage(noPriority.id))?.priority).toBe(0)
  })

  test('applications.getApplication 仅返回绑定用户名下的 application', async () => {
    const [ownApp] = testDb.db
      .insert(applications)
      .values({ userId: 7, token: 'app-token-contract-own', name: 'Own App' })
      .returning()
      .all()
    const [otherApp] = testDb.db
      .insert(applications)
      .values({ userId: 8, token: 'app-token-contract-other', name: 'Other App' })
      .returning()
      .all()
    const host = createPluginHost(drizzle, env, 7, 3, minimalDefinition())

    await expect(host.applications.getApplication(ownApp.id)).resolves.toEqual({
      id: ownApp.id,
      name: 'Own App'
    })

    await expect(host.applications.getApplication(otherApp.id)).resolves.toBeNull()
    await expect(host.applications.getApplication(999999)).resolves.toBeNull()
  })

  test('端口签名不接受 userId（宿主已绑定）', () => {
    const host = createPluginHost(drizzle, env, 7, 3, minimalDefinition())

    // @ts-expect-error getMessage 只接受 messageId，不接受任意 userId
    const badCall = () => host.messages.getMessage(7, 1)

    void badCall
  })

  test('getTags：不存在 / 非数组 / 正常标签', async () => {
    const normal = seedMessage(testDb, 7, { extras: '{"woe::tags":["a","b"]}' })
    const notArray = seedMessage(testDb, 7, { extras: '{"woe::tags":"a"}' })
    const corrupt = seedMessage(testDb, 7, { extras: '{not-json' })
    const noExtras = seedMessage(testDb, 7, { extras: null })
    const host = createPluginHost(drizzle, env, 7, 3, minimalDefinition())

    await expect(host.tags.getTags(999999)).resolves.toEqual({ ok: false, reason: 'not-found' })
    await expect(host.tags.getTags(notArray.id)).resolves.toEqual({
      ok: false,
      reason: 'invalid-tags'
    })
    await expect(host.tags.getTags(corrupt.id)).resolves.toEqual({
      ok: false,
      reason: 'invalid-tags'
    })
    await expect(host.tags.getTags(normal.id)).resolves.toEqual({ ok: true, tags: ['a', 'b'] })
    await expect(host.tags.getTags(noExtras.id)).resolves.toEqual({ ok: true, tags: [] })
  })

  test('appendTags：规范化去重、unchanged、corrupted、invalid-existing-tags', async () => {
    const existing = seedMessage(testDb, 7, { extras: '{"woe::tags":["a"],"x":1}' })
    const corrupt = seedMessage(testDb, 7, { extras: '{not-json' })
    const invalid = seedMessage(testDb, 7, { extras: '{"woe::tags":["a",1]}' })
    const host = createPluginHost(drizzle, env, 7, 3, minimalDefinition())

    await expect(host.tags.appendTags(999999, ['a'])).resolves.toEqual({ status: 'not-found' })
    await expect(host.tags.appendTags(corrupt.id, ['a'])).resolves.toEqual({
      status: 'corrupted'
    })
    await expect(host.tags.appendTags(invalid.id, ['b'])).resolves.toEqual({
      status: 'invalid-existing-tags'
    })

    await expect(host.tags.appendTags(existing.id, [' a ', 'b', 'b'])).resolves.toEqual({
      status: 'updated',
      tags: ['a', 'b']
    })

    await expect(host.tags.getTags(existing.id)).resolves.toEqual({ ok: true, tags: ['a', 'b'] })
    const [stored] = testDb.db
      .select({ extras: messages.extras })
      .from(messages)
      .where(eq(messages.id, existing.id))
      .all()
    expect(JSON.parse(stored.extras ?? '{}')).toEqual({ 'woe::tags': ['a', 'b'], x: 1 })

    await expect(host.tags.appendTags(existing.id, ['a', 'b'])).resolves.toEqual({
      status: 'unchanged',
      tags: ['a', 'b']
    })
  })

  test('appendTags：既有满额合法标签时追加越界是调用方 bug，抛错且不写入', async () => {
    const fullTags = Array.from({ length: TAG_MAX_COUNT }, (_, i) => `tag-${i}`)
    const full = seedMessage(testDb, 7, {
      extras: JSON.stringify({ 'woe::tags': fullTags, x: 1 })
    })
    const host = createPluginHost(drizzle, env, 7, 3, minimalDefinition())

    await expect(host.tags.appendTags(full.id, ['overflow'])).rejects.toThrow(
      'plugin tags overflow: appendTags exceeds TAG_MAX_COUNT'
    )


    const [stored] = testDb.db
      .select({ extras: messages.extras })
      .from(messages)
      .where(eq(messages.id, full.id))
      .all()
    expect(JSON.parse(stored.extras ?? '{}')).toEqual({ 'woe::tags': fullTags, x: 1 })
    await expect(host.tags.getTags(full.id)).resolves.toEqual({ ok: true, tags: fullTags })
  })

  test('appendTags：既有标签本身非法时返回 invalid-existing-tags，不抛错', async () => {
    const invalid = seedMessage(testDb, 7, { extras: '{"woe::tags":"not-array"}' })
    const host = createPluginHost(drizzle, env, 7, 3, minimalDefinition())

    await expect(host.tags.appendTags(invalid.id, ['a'])).resolves.toEqual({
      status: 'invalid-existing-tags'
    })
  })

  test('secret 端口 fail-closed：has=false、get=null、paths 仅声明字段', async () => {
    const host = createPluginHost(drizzle, env, 7, 3, {
      ...minimalDefinition(),
      secretFields: ['apiKey']
    })

    await expect(host.secrets.has('apiKey')).resolves.toBe(false)
    await expect(host.secrets.get('apiKey')).resolves.toBeNull()
    expect(host.secrets.paths()).toEqual(['apiKey'])
  })

  test('http 端口接入 outbound policy：非 https/私网在出站前拒绝', async () => {
    const host = createPluginHost(drizzle, env, 7, 3, minimalDefinition())

    await expect(
      host.http.fetch({ url: 'http://example.com/hook', timeoutMs: 1000 })
    ).rejects.toMatchObject({ code: 'insecure' })

    await expect(
      host.http.fetch({ url: 'https://127.0.0.1/hook', timeoutMs: 1000 })
    ).rejects.toMatchObject({ code: 'private-host' })

    await expect(
      host.http.fetch({ url: 'https://example.com/hook?token=1', timeoutMs: 1000 })
    ).rejects.toMatchObject({ code: 'query' })
  })





  test('host.http 按定义的 outbound 声明放行（allowQuery 时 query URL 不再被拒）', async () => {
    jest.useFakeTimers()
    try {
      const host = createPluginHost(drizzle, env, 7, 3, {
        ...minimalDefinition(),
        outbound: { allowQuery: true }
      })

      const pending = host.http.fetch({
        url: 'https://example.invalid/hook?token=1',
        timeoutMs: 50
      })
      const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' })

      await Promise.resolve()
      jest.advanceTimersByTime(50)
      await assertion
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('PluginJobsAccess.enqueue 结果封闭性', () => {
  const skipCodes = [
    'capacity-full',
    'config',
    'secret-config',
    'secret-decrypt-failed',
    'secret-reentry-required',
    'outbound-blocked',
    'quota-exceeded',
    'quota-read-failed',
    'plugin-unavailable'
  ] as const

  test('ok 与全部 skip/error code 都可赋值给 PluginEventOutcome', async () => {
    const ok: PluginEventOutcome = { status: 'ok' }
    expect(ok).toEqual({ status: 'ok' })

    for (const code of skipCodes) {
      const outcome: PluginEventOutcome = { status: 'skipped', code }
      const access: PluginJobsAccess = {
        enqueue: async () => outcome
      }
      await expect(
        access.enqueue({ subjectType: 'message', subjectId: 1 })
      ).resolves.toEqual({ status: 'skipped', code })
    }
  })

  test('enqueue 输入不包含 userId/pluginId（由 core 绑定）', () => {
    const access: PluginJobsAccess = { enqueue: async () => ({ status: 'ok' }) }

    // @ts-expect-error 插件不能指定其他属主
    void access.enqueue({ subjectType: 'message', subjectId: 1, userId: 9 })
    // @ts-expect-error 插件不能指定其他 pluginId
    void access.enqueue({ subjectType: 'message', subjectId: 1, pluginId: 9 })
  })
})

describe('PluginManager 消费 PluginEventOutcome', () => {
  let testDb: TestDb
  let drizzle: DrizzleDB
  let userId: number

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    testDb = createPluginJobsTestDb()
    drizzle = asDrizzle(testDb)
    userId = seedUser(testDb, 'contract-user')
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  function logs(): Array<{ status: number; error: string | null }> {
    return testDb.db
      .select({ status: pluginLogs.status, error: pluginLogs.error })
      .from(pluginLogs)
      .where(eq(pluginLogs.userId, userId))
      .all()
  }

  const messageCtx = () => ({
    userId,
    now: '2026-10-23T00:00:00.000Z',
    message: { id: 1, appId: 1, content: 'hello' }
  })

  test('返回 {status:"ok"} 写一行成功日志', async () => {
    registerPlugin('test/jobs-ok', ({ id, name }) => ({
      id,
      name,
      capabilities: [],
      init() {},
      onMessageCreate: async () => ({ status: 'ok' })
    }))
    seedPluginConfig(testDb, userId, 'test/jobs-ok')

    await new PluginManager(drizzle).emit(userId, 'message.create', messageCtx())

    expect(logs()).toEqual([{ status: 1, error: null }])
  })

  test('返回 skipped 时不写 plugin_logs（由 job service 记录 enqueue_rejected）', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    registerPlugin('test/jobs-skip', ({ id, name }) => ({
      id,
      name,
      capabilities: [],
      init() {},
      onMessageCreate: async () => ({ status: 'skipped', code: 'capacity-full' })
    }))
    seedPluginConfig(testDb, userId, 'test/jobs-skip')

    await new PluginManager(drizzle).emit(userId, 'message.create', messageCtx())

    expect(logs()).toEqual([])
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith(
      '[Plugin Skipped] plugin=test/jobs-skip event=message.create code=capacity-full'
    )
  })

  test('handler 抛异常写固定 plugin-handler-error，不泄露原始 message', async () => {
    registerPlugin('test/jobs-throw', ({ id, name }) => ({
      id,
      name,
      capabilities: [],
      init() {},
      onMessageCreate: async () => {
        throw new Error('boom secret')
      }
    }))
    seedPluginConfig(testDb, userId, 'test/jobs-throw')

    await new PluginManager(drizzle).emit(userId, 'message.create', messageCtx())

    expect(logs()).toEqual([{ status: 0, error: 'plugin-handler-error' }])
    expect(logs()[0].error).not.toContain('boom secret')
  })

  test('未注入 jobs factory 时 enqueue 会抛固定错误并被记为 plugin-handler-error', async () => {
    registerPlugin('test/jobs-unconfigured', ({ id, name }) => ({
      id,
      name,
      capabilities: [],
      init() {},
      onMessageCreate: async (ctx) => {
        await ctx.jobs?.enqueue({ subjectType: 'message', subjectId: 1 })
        return { status: 'ok' }
      }
    }))
    seedPluginConfig(testDb, userId, 'test/jobs-unconfigured')

    await new PluginManager(drizzle).emit(userId, 'message.create', messageCtx())

    expect(logs()).toEqual([{ status: 0, error: 'plugin-handler-error' }])
  })

  test('jobs 工厂抛错时回落为 fail-closed access，同用户其他插件不受影响', async () => {
    registerPlugin('test/jobs-factory-no-jobs', ({ id, name }) => ({
      id,
      name,
      capabilities: [],
      init() {},
      onMessageCreate: async () => ({ status: 'ok' })
    }))
    registerPlugin('test/jobs-factory-uses-jobs', ({ id, name }) => ({
      id,
      name,
      capabilities: [],
      init() {},
      onMessageCreate: async (ctx) => {
        await ctx.jobs!.enqueue({ subjectType: 'message', subjectId: 1 })
        return { status: 'ok' }
      }
    }))
    seedPluginConfig(testDb, userId, 'test/jobs-factory-no-jobs')
    seedPluginConfig(testDb, userId, 'test/jobs-factory-uses-jobs')

    const factory = jest.fn(() => {
      throw new Error('PLUGIN_JOB_QUEUE is missing: do not leak this')
    })

    await expect(
      new PluginManager(drizzle, { jobs: factory }).emit(userId, 'message.create', messageCtx())
    ).resolves.toBeUndefined()



    expect(logs()).toHaveLength(2)
    expect(logs()).toEqual(
      expect.arrayContaining([
        { status: 1, error: null },
        { status: 0, error: 'plugin-handler-error' }
      ])
    )

    const messages = (console.error as jest.Mock).mock.calls.map((args) => String(args[0]))
    expect(messages).toContain('[Plugin Jobs Factory Error] plugin=test/jobs-factory-no-jobs')

    expect(messages.join('\n')).not.toContain('PLUGIN_JOB_QUEUE')
  })

  test('注入 factory 时按当前 userId/pluginId 绑定 jobs', async () => {
    registerPlugin('test/jobs-injected', ({ id, name }) => ({
      id,
      name,
      capabilities: [],
      init() {},
      onMessageCreate: async (ctx) => {
        expect(ctx.jobs).toBeDefined()
        return ctx.jobs!.enqueue({ subjectType: 'message', subjectId: 42 })
      }
    }))
    const pluginId = seedPluginConfig(testDb, userId, 'test/jobs-injected')
    const enqueue = jest.fn(async () => ({ status: 'ok' as const }))
    const factory = jest.fn(() => ({ enqueue }))

    await new PluginManager(drizzle, { jobs: factory }).emit(
      userId,
      'message.create',
      messageCtx()
    )

    expect(factory).toHaveBeenCalledWith({ userId, pluginId })
    expect(enqueue).toHaveBeenCalledWith({ subjectType: 'message', subjectId: 42 })
    expect(logs()).toEqual([{ status: 1, error: null }])
  })
})
