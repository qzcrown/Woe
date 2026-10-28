






import { eq } from 'drizzle-orm'
import type { DrizzleDB } from '../../src/drizzle/index.ts'
import type { Env } from '../../src/types/index.ts'
import { messages, pluginConfigs, pluginJobs, pluginLogs, users } from '../../src/models/index.ts'
import type { PluginTaskDefinition } from '../../src/plugins/jobs/types.ts'
import { registerPluginTask, resetPluginTaskRegistry } from '../../src/plugins/jobs/registry.ts'
import {
  ENQUEUE_HTTP_STATUS,
  PluginJobService,
  createPluginJobRuntime,
  isUniqueConstraintError,
  safeJsonStringify,
  type PluginJobQueueSender,
  type QuotaChecker
} from '../../src/services/pluginJobs/pluginJobService.ts'
import { createPluginJobsTestDb } from '../helpers/pluginJobsTestDb.ts'
import { PluginSecretError } from '../../src/services/pluginSecretService.ts'
import { asDrizzle } from '../helpers/testDb.ts'

const NOW = new Date('2026-10-23T12:00:00.000Z')

type TestDb = ReturnType<typeof createPluginJobsTestDb>

function seedUser(db: TestDb, id: number, disabled = 0) {
  db.sqlite
    .prepare('INSERT INTO users (id, name, admin, disabled) VALUES (?, ?, 0, ?)')
    .run(id, `user-${id}`, disabled)
}

function seedPlugin(
  db: TestDb,
  values: {
    userId?: number
    modulePath: string
    enabled?: number
    configYaml?: string | null






    grantPermission?: boolean
  }
) {
  const userId = values.userId ?? 7
  const [row] = db.db
    .insert(pluginConfigs)
    .values({
      userId,
      name: 'Test Plugin',
      token: `token-${Math.random().toString(36).slice(2)}`,
      modulePath: values.modulePath,
      configYaml: values.configYaml ?? 'provider: test',
      enabled: values.enabled ?? 1
    })
    .returning()
    .all()

  if (values.grantPermission ?? true) {
    db.sqlite
      .prepare('INSERT INTO user_plugin_permissions (user_id, module_path) VALUES (?, ?)')
      .run(userId, values.modulePath)
  }

  return row
}

function seedMessage(db: TestDb, userId: number, content = 'hello') {
  const [row] = db.db
    .insert(messages)
    .values({ userid: userId, appid: 1, message: content })
    .returning()
    .all()
  return row
}

function createFakeQueue() {
  const send = jest.fn<Promise<void>, [{ jobId: number }]>().mockResolvedValue(undefined)
  return { sent: send, queue: { send } as PluginJobQueueSender }
}

function createFakeQuota(): {
  quota: QuotaChecker
  check: jest.Mock
  consume: jest.Mock
} {
  const check = jest.fn().mockResolvedValue({ status: 'ok', limit: 100, used: 0, source: 'default' })
  const consume = jest.fn().mockResolvedValue({ status: 'consumed' })
  return { quota: { check, consume }, check, consume }
}

function createService(
  drizzle: DrizzleDB,
  queue: PluginJobQueueSender,
  quota: QuotaChecker,
  now: () => Date = () => NOW
) {
  return new PluginJobService({ drizzle, env: {} as Env, queue, quota, now })
}







function rejectJobInserts(drizzle: DrizzleDB, times: number): jest.SpyInstance {
  const realInsert = (drizzle.insert as unknown as (table: unknown) => unknown).bind(drizzle)
  let calls = 0
  const spy = jest.spyOn(drizzle, 'insert')
  spy.mockImplementation(((table: unknown) => {
    calls += 1
    if (calls <= times) {
      const failure = new Error(
        'UNIQUE constraint failed: plugin_jobs.plugin_id, plugin_jobs.subject_type, plugin_jobs.subject_id'
      )
      return { values: () => ({ returning: () => Promise.reject(failure) }) }
    }
    return realInsert(table)
  }) as unknown as typeof drizzle.insert)
  return spy
}





function wrappedUniqueConstraintError(): Error & { cause: Error & { code: string } } {
  const cause = Object.assign(
    new Error(
      'UNIQUE constraint failed: plugin_jobs.plugin_id, plugin_jobs.subject_type, plugin_jobs.subject_id'
    ),
    { code: 'SQLITE_CONSTRAINT_UNIQUE' }
  )
  return Object.assign(
    new Error(
      'Failed query: insert into "plugin_jobs" ("user_id", "plugin_id", "subject_type", "subject_id", "status", "payload") values (?, ?, ?, ?, ?, ?) params: 7,1,message,1,pending,'
    ),
    { cause }
  )
}


function rejectJobInsertsWith(
  drizzle: DrizzleDB,
  times: number,
  failure: unknown
): jest.SpyInstance {
  const realInsert = (drizzle.insert as unknown as (table: unknown) => unknown).bind(drizzle)
  let calls = 0
  const spy = jest.spyOn(drizzle, 'insert')
  spy.mockImplementation(((table: unknown) => {
    calls += 1
    if (calls <= times) {
      return { values: () => ({ returning: () => Promise.reject(failure) }) }
    }
    return realInsert(table)
  }) as unknown as typeof drizzle.insert)
  return spy
}

let definitionSeq = 0

function registerDefinition(overrides: Partial<PluginTaskDefinition> = {}): PluginTaskDefinition {
  const definition: PluginTaskDefinition = {
    modulePath: `test/job-service/${++definitionSeq}`,
    supportedSubjectTypes: ['message'],
    createTask: async () => ({ run: async () => ({ ok: true }) }),
    ...overrides
  }
  registerPluginTask(definition)
  return definition
}

afterAll(() => {
  resetPluginTaskRegistry()
})

describe('PluginJobService.enqueue', () => {
  test('creates a pending job and sends { jobId }', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition()
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()

    const service = createService(asDrizzle(testDb), fake.queue, quota)
    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.httpStatus).toBe(202)
    expect(result.job.status).toBe('pending')
    expect(result.job.payload).toBeNull()
    expect(fake.sent).toHaveBeenCalledTimes(1)
    expect(fake.sent).toHaveBeenCalledWith({ jobId: result.job.id })
  })

  test('stores prepareJob payload as JSON', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition({
      prepareJob: async () => ({ payload: { retag: true } })
    })
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(JSON.parse(result.job.payload as string)).toEqual({ retag: true })
  })

  test('returns the existing pending job without quota check, validateConfig or extra send', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const validateConfig = jest.fn().mockResolvedValue(undefined)
    const definition = registerDefinition({ validateConfig })
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    const { quota, check } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    const first = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })
    expect(first.status).toBe('ok')
    if (first.status !== 'ok') return


    testDb.db
      .update(pluginJobs)
      .set({ createdAt: '2026-10-23 11:58:00' })
      .where(eq(pluginJobs.id, first.job.id))
      .run()

    validateConfig.mockClear()

    const second = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(second.status).toBe('ok')
    if (second.status !== 'ok') return
    expect(second.job.id).toBe(first.job.id)
    expect(check).not.toHaveBeenCalled()
    expect(validateConfig).not.toHaveBeenCalled()
    expect(fake.sent).toHaveBeenCalledTimes(1)
  })

  test('resends the queue message once when the pending job is older than 5 minutes', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition()
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    const first = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })
    expect(first.status).toBe('ok')
    if (first.status !== 'ok') return


    testDb.db
      .update(pluginJobs)
      .set({ createdAt: '2026-10-23 11:54:00' })
      .where(eq(pluginJobs.id, first.job.id))
      .run()

    const second = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(second.status).toBe('ok')
    if (second.status !== 'ok') return
    expect(second.job.id).toBe(first.job.id)
    expect(fake.sent).toHaveBeenCalledTimes(2)
    expect(fake.sent).toHaveBeenLastCalledWith({ jobId: first.job.id })

    expect(testDb.db.select().from(pluginJobs).all()).toHaveLength(1)
  })

  test('a resend failure only logs and does not change job state', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition()
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    const first = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })
    expect(first.status).toBe('ok')
    if (first.status !== 'ok') return

    testDb.db
      .update(pluginJobs)
      .set({ createdAt: '2026-10-23 11:54:00' })
      .where(eq(pluginJobs.id, first.job.id))
      .run()
    fake.sent.mockRejectedValueOnce(new Error('queue down'))

    const second = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(second.status).toBe('ok')
    if (second.status !== 'ok') return
    expect(second.job.status).toBe('pending')
    expect(second.job.lastErrorCode).toBeNull()
    expect(testDb.db.select().from(pluginLogs).all()).toHaveLength(0)
  })

  test('unique index conflict returns the concurrently inserted pending job', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const drizzle = asDrizzle(testDb)


    const definition = registerDefinition({
      validateConfig: async () => {
        await drizzle.insert(pluginJobs).values({
          userId: 7,
          pluginId: plugin.id,
          subjectType: 'message',
          subjectId: message.id,
          status: 'pending'
        })
      }
    })
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })

    const service = createService(drizzle, fake.queue, quota)
    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(testDb.db.select().from(pluginJobs).all()).toHaveLength(1)
    expect(fake.sent).not.toHaveBeenCalled()
  })

  test('unique conflict with no visible pending retries the insert once and returns the new job', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition()
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const drizzle = asDrizzle(testDb)

    const insertSpy = rejectJobInserts(drizzle, 1)
    const service = createService(drizzle, fake.queue, quota)

    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(insertSpy).toHaveBeenCalledTimes(2)
    const rows = testDb.db.select().from(pluginJobs).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: result.job.id, status: 'pending' })
    expect(fake.sent).toHaveBeenCalledTimes(1)
    expect(fake.sent).toHaveBeenCalledWith({ jobId: result.job.id })
  })

  test('two unique conflicts with no visible pending return 409 instead of throwing', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition()
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const drizzle = asDrizzle(testDb)

    const insertSpy = rejectJobInserts(drizzle, 2)
    const service = createService(drizzle, fake.queue, quota)

    await expect(
      service.enqueue({
        source: 'event',
        userId: 7,
        pluginId: plugin.id,
        subjectType: 'message',
        subjectId: message.id
      })
    ).resolves.toEqual({ status: 'skipped', code: 'plugin-unavailable', httpStatus: 409 })

    expect(insertSpy).toHaveBeenCalledTimes(2)
    expect(testDb.db.select().from(pluginJobs).all()).toHaveLength(0)
    expect(fake.sent).not.toHaveBeenCalled()
  })

  test('D1-wrapped unique conflict returns the concurrently inserted pending job instead of throwing', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition()
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const drizzle = asDrizzle(testDb)



    const realInsert = (drizzle.insert as unknown as (table: unknown) => unknown).bind(drizzle)
    let concurrentId: number | undefined
    const insertSpy = jest.spyOn(drizzle, 'insert')
    insertSpy.mockImplementation(((table: unknown) => {
      if (table === pluginJobs) {

        const info = testDb.sqlite
          .prepare(
            `INSERT INTO plugin_jobs (user_id, plugin_id, subject_type, subject_id, status)
             VALUES (?, ?, ?, ?, 'pending')`
          )
          .run(7, plugin.id, 'message', message.id)
        concurrentId = Number(info.lastInsertRowid)
        return { values: () => ({ returning: () => Promise.reject(wrappedUniqueConstraintError()) }) }
      }
      return realInsert(table)
    }) as unknown as typeof drizzle.insert)
    const service = createService(drizzle, fake.queue, quota)

    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(result).toMatchObject({ status: 'ok', httpStatus: 202 })
    if (result.status !== 'ok') return
    expect(result.job.id).toBe(concurrentId)

    expect(insertSpy).toHaveBeenCalledTimes(1)
    expect(testDb.db.select().from(pluginJobs).all()).toHaveLength(1)
    expect(fake.sent).not.toHaveBeenCalled()
  })

  test('D1-wrapped unique conflict with no visible pending retries once and succeeds', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition()
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const drizzle = asDrizzle(testDb)
    const insertSpy = rejectJobInsertsWith(drizzle, 1, wrappedUniqueConstraintError())
    const service = createService(drizzle, fake.queue, quota)

    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(insertSpy).toHaveBeenCalledTimes(2)
    expect(testDb.db.select().from(pluginJobs).all()).toHaveLength(1)
    expect(fake.sent).toHaveBeenCalledWith({ jobId: result.job.id })
  })

  test('non-unique database errors are still rethrown', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition()
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const { quota } = createFakeQuota()
    const drizzle = asDrizzle(testDb)
    const failure = Object.assign(new Error('Failed query: insert into "plugin_jobs" ...'), {
      cause: Object.assign(new Error('NOT NULL constraint failed: plugin_jobs.status'), {
        code: 'SQLITE_CONSTRAINT_NOTNULL'
      })
    })
    rejectJobInsertsWith(drizzle, 1, failure)
    const service = createService(drizzle, createFakeQueue().queue, quota)

    await expect(
      service.enqueue({
        source: 'event',
        userId: 7,
        pluginId: plugin.id,
        subjectType: 'message',
        subjectId: message.id
      })
    ).rejects.toBe(failure)
  })

  test('queue send failure marks the job failed and writes plugin_job.failed', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition()
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    fake.sent.mockRejectedValueOnce(new Error('queue down rethrown by binding'))
    const { quota } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.code).toBe('enqueue-send-failed')
    expect(result.httpStatus).toBe(503)

    const rows = testDb.db.select().from(pluginJobs).all()
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('failed')
    expect(rows[0].completedAt).not.toBeNull()
    expect(rows[0].lastErrorCode).toBe('enqueue-send-failed')
    expect(rows[0].lastErrorMessage).toEqual(expect.any(String))

    const logs = testDb.db.select().from(pluginLogs).all()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      pluginId: plugin.id,
      userId: 7,
      event: 'plugin_job.failed',
      status: 0,
      error: 'enqueue-send-failed'
    })


    expect(errorSpy).toHaveBeenCalledTimes(1)
    const logged = String(errorSpy.mock.calls[0][0])
    expect(logged).toContain(`job=${result.job.id}`)
    expect(logged).toContain(`plugin=${plugin.id}`)
    expect(logged).toContain('code=enqueue-send-failed')
    expect(logged).not.toContain('queue down rethrown by binding')
    errorSpy.mockRestore()
  })

  test('circular payload is rejected as config without creating a job', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition()
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    const circular: Record<string, unknown> = { retag: true }
    circular.self = circular

    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id,
      payload: circular
    })

    expect(result).toEqual({ status: 'skipped', code: 'config', httpStatus: 409 })
    expect(testDb.db.select().from(pluginJobs).all()).toHaveLength(0)
    expect(fake.sent).not.toHaveBeenCalled()

    const logs = testDb.db.select().from(pluginLogs).all()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      pluginId: plugin.id,
      userId: 7,
      event: 'plugin_job.enqueue_rejected',
      status: 0,
      error: 'config'
    })
  })

  test('circular prepareJob payload is rejected as config without creating a job', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const circular: Record<string, unknown> = { retag: true }
    circular.self = circular
    const definition = registerDefinition({ prepareJob: async () => ({ payload: circular }) })
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(result).toEqual({ status: 'skipped', code: 'config', httpStatus: 409 })
    expect(testDb.db.select().from(pluginJobs).all()).toHaveLength(0)
    expect(testDb.db.select().from(pluginLogs).all()[0]).toMatchObject({
      event: 'plugin_job.enqueue_rejected',
      error: 'config'
    })
  })

  test('missing PLUGIN_JOB_QUEUE binding is treated as a send failure', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition()
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const { quota } = createFakeQuota()
    const service = new PluginJobService({ drizzle: asDrizzle(testDb), env: {} as Env, quota, now: () => NOW })

    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.httpStatus).toBe(503)
    expect(testDb.db.select().from(pluginJobs).all()[0].status).toBe('failed')
  })
})

describe('PluginJobService.enqueue availability checks', () => {
  test('missing plugin instance is 404 not-found', async () => {
    const testDb = createPluginJobsTestDb()
    const message = seedMessage(testDb, 7)
    const fake = createFakeQueue()
    const { quota, check } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: 404,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(result).toMatchObject({ status: 'skipped', code: 'not-found', httpStatus: 404 })
    expect(check).not.toHaveBeenCalled()
    expect(fake.sent).not.toHaveBeenCalled()
  })

  test('plugin owned by another user is 404 not-found', async () => {
    const testDb = createPluginJobsTestDb()
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition()
    const plugin = seedPlugin(testDb, { userId: 8, modulePath: definition.modulePath })
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(result).toMatchObject({ status: 'skipped', code: 'not-found', httpStatus: 404 })
  })

  test('disabled plugin is 409 plugin-unavailable', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition()
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath, enabled: 0 })
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(result).toMatchObject({
      status: 'skipped',
      code: 'plugin-unavailable',
      httpStatus: 409
    })
    expect(testDb.db.select().from(pluginJobs).all()).toHaveLength(0)
  })

  test('message ownership is checked before plugin availability', async () => {
    const testDb = createPluginJobsTestDb()

    const message = seedMessage(testDb, 8)
    const definition = registerDefinition()

    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath, enabled: 0 })
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(result).toMatchObject({ status: 'skipped', code: 'not-found', httpStatus: 404 })
    expect(fake.sent).not.toHaveBeenCalled()
  })

  test('owned message + disabled plugin is still 409 plugin-unavailable', async () => {
    const testDb = createPluginJobsTestDb()
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition()
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath, enabled: 0 })
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(result).toMatchObject({
      status: 'skipped',
      code: 'plugin-unavailable',
      httpStatus: 409
    })
  })

  test('missing message and missing plugin is 404 not-found', async () => {
    const testDb = createPluginJobsTestDb()
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: 404,
      subjectType: 'message',
      subjectId: 999
    })

    expect(result).toMatchObject({ status: 'skipped', code: 'not-found', httpStatus: 404 })
  })

  test('unsupported subject type is 409 plugin-unavailable', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition({ supportedSubjectTypes: ['application'] })
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(result).toMatchObject({
      status: 'skipped',
      code: 'plugin-unavailable',
      httpStatus: 409
    })
  })

  test('unknown task module is 409 plugin-unavailable', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const plugin = seedPlugin(testDb, { modulePath: 'test/not-registered' })
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    const eventResult = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })


    expect(eventResult).toMatchObject({
      status: 'skipped',
      code: 'plugin-unavailable',
      httpStatus: 409
    })
    expect(testDb.db.select().from(pluginJobs).all()).toHaveLength(0)
    expect(fake.sent).not.toHaveBeenCalled()


    const manualResult = await service.enqueue({
      source: 'manual',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })
    expect(manualResult).toMatchObject({
      status: 'skipped',
      code: 'plugin-unavailable',
      httpStatus: 409
    })
    expect(testDb.db.select().from(pluginJobs).all()).toHaveLength(0)
  })

  test('missing message subject is 404 not-found', async () => {
    const testDb = createPluginJobsTestDb()
    const definition = registerDefinition()
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: 999
    })

    expect(result).toMatchObject({ status: 'skipped', code: 'not-found', httpStatus: 404 })
  })

  test('message owned by another user is 404 not-found', async () => {
    const testDb = createPluginJobsTestDb()
    const message = seedMessage(testDb, 8)
    const definition = registerDefinition()
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(result).toMatchObject({ status: 'skipped', code: 'not-found', httpStatus: 404 })
  })
})

describe('PluginJobService quota and config preflight', () => {
  test('quota exceeded writes enqueue_rejected and creates no job', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const validateConfig = jest.fn()
    const definition = registerDefinition({ quotaNamespace: 'ai', validateConfig })
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    const { quota, check } = createFakeQuota()
    check.mockResolvedValueOnce({ status: 'exceeded', limit: 1, used: 1, source: 'default' })
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(result).toMatchObject({ status: 'skipped', code: 'quota-exceeded', httpStatus: 429 })
    expect(testDb.db.select().from(pluginJobs).all()).toHaveLength(0)
    expect(fake.sent).not.toHaveBeenCalled()
    expect(validateConfig).not.toHaveBeenCalled()

    const logs = testDb.db.select().from(pluginLogs).all()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      pluginId: plugin.id,
      userId: 7,
      event: 'plugin_job.enqueue_rejected',
      status: 0,
      error: 'quota-exceeded'
    })
  })

  test('quota read failure writes enqueue_rejected and returns 503', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition({ quotaNamespace: 'ai' })
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    const { quota, check } = createFakeQuota()
    check.mockResolvedValueOnce({ status: 'read-failed' })
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(result).toMatchObject({
      status: 'skipped',
      code: 'quota-read-failed',
      httpStatus: 503
    })
    expect(testDb.db.select().from(pluginJobs).all()).toHaveLength(0)
    expect(testDb.db.select().from(pluginLogs).all()[0]).toMatchObject({
      event: 'plugin_job.enqueue_rejected',
      error: 'quota-read-failed'
    })
  })

  test('invalid quota limit fails closed as quota-read-failed', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition({ quotaNamespace: 'ai' })
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    const { quota, check } = createFakeQuota()
    check.mockResolvedValueOnce({ status: 'invalid-limit' })
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(result).toMatchObject({ status: 'skipped', code: 'quota-read-failed', httpStatus: 503 })
  })

  test('validateConfig failure writes enqueue_rejected and creates no job', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition({
      validateConfig: async () => ({ errorCode: 'secret-config' })
    })
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(result).toMatchObject({ status: 'skipped', code: 'secret-config', httpStatus: 409 })
    expect(testDb.db.select().from(pluginJobs).all()).toHaveLength(0)
    expect(testDb.db.select().from(pluginLogs).all()[0]).toMatchObject({
      event: 'plugin_job.enqueue_rejected',
      error: 'secret-config'
    })
  })

  test('prepareJob error creates no job and maps to 409', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition({
      prepareJob: async () => ({ error: { errorCode: 'config' } })
    })
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(result).toMatchObject({ status: 'skipped', code: 'config', httpStatus: 409 })
    expect(testDb.db.select().from(pluginJobs).all()).toHaveLength(0)
    expect(fake.sent).not.toHaveBeenCalled()
  })
})

describe('PluginJobService.getSubjectJobHistory', () => {
  test('owned message -> found, messageDeleted=false, newest first, payload not read', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition()
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const service = createService(asDrizzle(testDb), createFakeQueue().queue, createFakeQuota().quota)

    const inserted = testDb.db
      .insert(pluginJobs)
      .values([
        {
          userId: 7,
          pluginId: plugin.id,
          subjectType: 'message',
          subjectId: message.id,
          status: 'success',
          payload: JSON.stringify({ prompt: 'must-not-be-read' }),
          result: JSON.stringify({ tags: ['a'] }),
          createdAt: '2026-10-01 00:00:00'
        },
        {
          userId: 7,
          pluginId: plugin.id,
          subjectType: 'message',
          subjectId: message.id,
          status: 'success',
          payload: JSON.stringify({ prompt: 'must-not-be-read' }),
          result: JSON.stringify({ tags: ['b'] }),
          createdAt: '2026-10-02 00:00:00'
        }
      ])
      .returning()
      .all()

    const history = await service.getSubjectJobHistory({
      userId: 7,
      subjectType: 'message',
      subjectId: message.id,
      limit: 20
    })

    expect(history.found).toBe(true)
    if (!history.found) return
    expect(history.messageDeleted).toBe(false)
    expect(history.jobs.map((job) => job.id)).toEqual([inserted[1].id, inserted[0].id])

    expect(history.jobs[0]).not.toHaveProperty('payload')
    expect(history.jobs[0]).not.toHaveProperty('userId')
  })

  test('deleted message with history -> messageDeleted=true; pluginId only filters jobs', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition()
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const service = createService(asDrizzle(testDb), createFakeQueue().queue, createFakeQuota().quota)

    testDb.db
      .insert(pluginJobs)
      .values({
        userId: 7,
        pluginId: plugin.id,
        subjectType: 'message',
        subjectId: message.id,
        status: 'success',
        result: JSON.stringify({ tags: ['kept'] })
      })
      .run()
    testDb.sqlite.prepare('DELETE FROM messages WHERE id = ?').run(message.id)

    const all = await service.getSubjectJobHistory({
      userId: 7,
      subjectType: 'message',
      subjectId: message.id
    })
    expect(all.found).toBe(true)
    if (!all.found) return
    expect(all.messageDeleted).toBe(true)
    expect(all.jobs).toHaveLength(1)


    const filtered = await service.getSubjectJobHistory({
      userId: 7,
      subjectType: 'message',
      subjectId: message.id,
      pluginId: plugin.id + 999
    })
    expect(filtered.found).toBe(true)
    if (!filtered.found) return
    expect(filtered.messageDeleted).toBe(true)
    expect(filtered.jobs).toEqual([])
  })

  test('message owned by another user or without any history -> found=false', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    seedUser(testDb, 8)
    const foreignMessage = seedMessage(testDb, 8)
    const definition = registerDefinition()
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const service = createService(asDrizzle(testDb), createFakeQueue().queue, createFakeQuota().quota)


    testDb.db
      .insert(pluginJobs)
      .values({
        userId: 7,
        pluginId: plugin.id,
        subjectType: 'message',
        subjectId: foreignMessage.id,
        status: 'success'
      })
      .run()

    await expect(
      service.getSubjectJobHistory({
        userId: 7,
        subjectType: 'message',
        subjectId: foreignMessage.id
      })
    ).resolves.toEqual({ found: false })


    await expect(
      service.getSubjectJobHistory({ userId: 7, subjectType: 'message', subjectId: 999 })
    ).resolves.toEqual({ found: false })


    await expect(
      service.getSubjectJobHistory({ userId: 7, subjectType: 'application', subjectId: 1 })
    ).resolves.toEqual({ found: false })
  })
})

describe('isUniqueConstraintError', () => {
  test('recognises a D1/Drizzle wrapped SQLError through the cause chain', () => {
    expect(isUniqueConstraintError(wrappedUniqueConstraintError())).toBe(true)
  })

  test('recognises the bare better-sqlite3 shape', () => {
    expect(
      isUniqueConstraintError(
        new Error(
          'UNIQUE constraint failed: plugin_jobs.plugin_id, plugin_jobs.subject_type, plugin_jobs.subject_id'
        )
      )
    ).toBe(true)
  })

  test('recognises the extended unique code without a recognisable message', () => {
    expect(
      isUniqueConstraintError(Object.assign(new Error('insert failed'), { code: 'SQLITE_CONSTRAINT_UNIQUE' }))
    ).toBe(true)
  })

  test('does not treat the bare SQLITE_CONSTRAINT code as a unique conflict', () => {

    expect(
      isUniqueConstraintError(
        Object.assign(new Error('NOT NULL constraint failed: plugin_jobs.status'), {
          code: 'SQLITE_CONSTRAINT'
        })
      )
    ).toBe(false)
    expect(
      isUniqueConstraintError(
        Object.assign(new Error('FOREIGN KEY constraint failed'), { code: 'SQLITE_CONSTRAINT' })
      )
    ).toBe(false)
    expect(
      isUniqueConstraintError(
        Object.assign(new Error('CHECK constraint failed: plugin_jobs'), {
          code: 'SQLITE_CONSTRAINT'
        })
      )
    ).toBe(false)


    expect(
      isUniqueConstraintError(
        Object.assign(new Error('UNIQUE constraint failed: plugin_jobs.id'), {
          code: 'SQLITE_CONSTRAINT'
        })
      )
    ).toBe(true)
  })

  test('rejects unrelated and deeply nested causes', () => {
    expect(isUniqueConstraintError(new Error('Failed query: insert into "plugin_jobs" ...'))).toBe(false)
    expect(isUniqueConstraintError('some string failure')).toBe(false)
    expect(
      isUniqueConstraintError(
        Object.assign(new Error('wrapped'), {
          cause: Object.assign(new Error('mid'), {
            cause: Object.assign(new Error('deep'), {
              cause: Object.assign(new Error('too deep'), {
                cause: Object.assign(new Error('deeper'), {
                  cause: new Error('UNIQUE constraint failed: too-far')
                })
              })
            })
          })
        })
      )
    ).toBe(false)
  })

  test('does not loop forever on a cyclic cause chain', () => {
    const cyclic = new Error('wrapped') as Error & { cause?: unknown }
    cyclic.cause = cyclic
    expect(isUniqueConstraintError(cyclic)).toBe(false)
  })
})

describe('safeJsonStringify', () => {
  test('returns null for undefined', () => {
    expect(safeJsonStringify(undefined)).toBeNull()
  })

  test('round-trips a plain object', () => {
    const serialized = safeJsonStringify({ retag: true, tags: ['a', 'b'] })
    expect(serialized).not.toBeNull()
    expect(JSON.parse(serialized as string)).toEqual({ retag: true, tags: ['a', 'b'] })
  })

  test('returns null instead of throwing on circular references and BigInt', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(safeJsonStringify(circular)).toBeNull()
    expect(safeJsonStringify({ n: 1n })).toBeNull()
  })
})

describe('code to httpStatus mapping', () => {
  test('locks the published mapping table', () => {
    expect(ENQUEUE_HTTP_STATUS['not-found']).toBe(404)
    expect(ENQUEUE_HTTP_STATUS['plugin-unavailable']).toBe(409)
    expect(ENQUEUE_HTTP_STATUS.config).toBe(409)
    expect(ENQUEUE_HTTP_STATUS['secret-config']).toBe(409)
    expect(ENQUEUE_HTTP_STATUS['secret-decrypt-failed']).toBe(409)
    expect(ENQUEUE_HTTP_STATUS['secret-reentry-required']).toBe(409)
    expect(ENQUEUE_HTTP_STATUS['outbound-blocked']).toBe(409)
    expect(ENQUEUE_HTTP_STATUS['quota-exceeded']).toBe(429)
    expect(ENQUEUE_HTTP_STATUS['quota-read-failed']).toBe(503)
    expect(ENQUEUE_HTTP_STATUS['enqueue-send-failed']).toBe(503)
  })
})

describe('PluginJobService.enqueue manual trigger gating', () => {
  test('manual 对 manualTrigger=false 的任务立即 409：不建 job、不查配额、不调 validateConfig', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const validateConfig = jest.fn().mockResolvedValue(undefined)
    const definition = registerDefinition({
      manualTrigger: false,
      quotaNamespace: 'test-manual',
      validateConfig
    })
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    const { quota, check } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    const result = await service.enqueue({
      source: 'manual',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(result).toEqual({ status: 'skipped', code: 'plugin-unavailable', httpStatus: 409 })
    expect(testDb.db.select().from(pluginJobs).all()).toHaveLength(0)
    expect(fake.sent).not.toHaveBeenCalled()
    expect(check).not.toHaveBeenCalled()
    expect(validateConfig).not.toHaveBeenCalled()

    const logs = testDb.db.select().from(pluginLogs).all()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      pluginId: plugin.id,
      userId: 7,
      event: 'plugin_job.enqueue_rejected',
      status: 0,
      error: 'plugin-unavailable'
    })
  })

  test('manual 对 manualTrigger=false 一律 409：存在 pending job 也先于查重拒绝（不返回 202）', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const validateConfig = jest.fn().mockResolvedValue(undefined)
    const definition = registerDefinition({
      manualTrigger: false,
      quotaNamespace: 'test-manual-pending',
      validateConfig
    })
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    const { quota, check } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)


    const eventResult = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })
    expect(eventResult.status).toBe('ok')

    const manual = await service.enqueue({
      source: 'manual',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(manual).toEqual({ status: 'skipped', code: 'plugin-unavailable', httpStatus: 409 })

    const jobs = testDb.db.select().from(pluginJobs).all()
    expect(jobs).toHaveLength(1)
    expect(jobs[0].status).toBe('pending')
    expect(validateConfig).toHaveBeenCalledTimes(1)
    expect(check).toHaveBeenCalledTimes(1)
    expect(fake.sent).toHaveBeenCalledTimes(1)
  })

  test('event 对 manualTrigger=false 的任务照常入队（事件是唯一触发路径）', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition({ manualTrigger: false })
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(result.status).toBe('ok')
    expect(fake.sent).toHaveBeenCalledTimes(1)
  })

  test('manual 对缺省 manualTrigger（未声明）的任务照常入队（兼容既有插件）', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition()
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    const result = await service.enqueue({
      source: 'manual',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(result.status).toBe('ok')
    expect(fake.sent).toHaveBeenCalledTimes(1)
  })
})

describe('PluginJobService.prepareJob contract extensions', () => {
  test('prepareJob ctx 注入 Job Service 时钟的 now（ISO 字符串）', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const prepareJob = jest.fn(async () => ({}))
    const definition = registerDefinition({ prepareJob })
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(result.status).toBe('ok')
    expect(prepareJob).toHaveBeenCalledTimes(1)
    expect(prepareJob).toHaveBeenCalledWith(
      expect.objectContaining({ subjectId: message.id, now: NOW.toISOString() })
    )
  })

  test('prepareJob 返回 outbound-blocked 时按 409 拒绝且不建 job', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition({
      prepareJob: async () => ({ error: { errorCode: 'outbound-blocked' } })
    })
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(result).toEqual({ status: 'skipped', code: 'outbound-blocked', httpStatus: 409 })
    expect(testDb.db.select().from(pluginJobs).all()).toHaveLength(0)
    expect(fake.sent).not.toHaveBeenCalled()

    const logs = testDb.db.select().from(pluginLogs).all()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      event: 'plugin_job.enqueue_rejected',
      status: 0,
      error: 'outbound-blocked'
    })
  })
})

describe('PluginJobsAccess adapter', () => {
  test('maps successful and rejected enqueue results to the closed outcome union', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition()
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const runtime = createPluginJobRuntime({
      drizzle: asDrizzle(testDb),
      env: {} as Env,
      queue: fake.queue,
      quota,
      now: () => NOW
    })
    const access = runtime.jobsFactory({ userId: 7, pluginId: plugin.id })

    const outcome = await access.enqueue({
      subjectType: 'message',
      subjectId: message.id
    })

    expect(outcome).toEqual({ status: 'ok' })

    const rejected = await access.enqueue({
      subjectType: 'message',
      subjectId: 999
    })
    expect(rejected).toEqual({ status: 'skipped', code: 'plugin-unavailable' })
  })

  test('queue send failure still returns ok to the plugin handler (documented trade-off)', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition()
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    fake.sent.mockRejectedValueOnce(new Error('queue down'))
    const { quota } = createFakeQuota()
    const runtime = createPluginJobRuntime({
      drizzle: asDrizzle(testDb),
      env: {} as Env,
      queue: fake.queue,
      quota,
      now: () => NOW
    })
    const access = runtime.jobsFactory({ userId: 7, pluginId: plugin.id })

    await expect(
      access.enqueue({ subjectType: 'message', subjectId: message.id })
    ).resolves.toEqual({ status: 'ok' })
  })

  test('unexpected database errors are rethrown, not faked as skipped', async () => {
    const testDb = createPluginJobsTestDb()
    seedMessage(testDb, 7)
    const brokenDrizzle = {
      select: () => {
        throw new Error('d1 down')
      }
    } as unknown as DrizzleDB
    const runtime = createPluginJobRuntime({
      drizzle: brokenDrizzle,
      env: {} as Env,
      queue: createFakeQueue().queue,
      quota: createFakeQuota().quota,
      now: () => NOW
    })
    const access = runtime.jobsFactory({ userId: 7, pluginId: 1 })

    await expect(
      access.enqueue({ subjectType: 'message', subjectId: 1 })
    ).rejects.toThrow('d1 down')
  })
})

describe('PluginJobService.enqueue secret errors', () => {

  function registerSecretProbe(
    overrides: Partial<PluginTaskDefinition> = {}
  ): PluginTaskDefinition {
    return registerDefinition({
      secretFields: ['apiKey'],
      validateConfig: async ({ host }) => {
        const hasApiKey = await host.secrets.has('apiKey')
        return hasApiKey ? undefined : { errorCode: 'secret-config' }
      },
      ...overrides
    })
  }

  test('损坏的 secret envelope -> 409 secret-decrypt-failed（不抛 500、不建 job、写 enqueue_rejected）', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const definition = registerSecretProbe()
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })

    testDb.db
      .update(pluginConfigs)
      .set({ encryptedSecret: '{not-json' })
      .where(eq(pluginConfigs.id, plugin.id))
      .run()
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    await expect(
      service.enqueue({
        source: 'event',
        userId: 7,
        pluginId: plugin.id,
        subjectType: 'message',
        subjectId: message.id
      })
    ).resolves.toEqual({ status: 'skipped', code: 'secret-decrypt-failed', httpStatus: 409 })

    expect(testDb.db.select().from(pluginJobs).all()).toHaveLength(0)
    expect(fake.sent).not.toHaveBeenCalled()

    const logs = testDb.db.select().from(pluginLogs).all()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      pluginId: plugin.id,
      userId: 7,
      event: 'plugin_job.enqueue_rejected',
      status: 0,
      error: 'secret-decrypt-failed'
    })
  })

  test('prepareJob 抛 PluginSecretError 同样收敛为 409', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition({
      secretFields: ['apiKey'],
      prepareJob: async ({ host }) => {
        await host.secrets.has('apiKey')
        return {}
      }
    })
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    testDb.db
      .update(pluginConfigs)
      .set({ encryptedSecret: '{"v":99}' })
      .where(eq(pluginConfigs.id, plugin.id))
      .run()
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    await expect(
      service.enqueue({
        source: 'event',
        userId: 7,
        pluginId: plugin.id,
        subjectType: 'message',
        subjectId: message.id
      })
    ).resolves.toEqual({ status: 'skipped', code: 'secret-decrypt-failed', httpStatus: 409 })

    expect(testDb.db.select().from(pluginJobs).all()).toHaveLength(0)
    expect(testDb.db.select().from(pluginLogs).all()[0]).toMatchObject({
      event: 'plugin_job.enqueue_rejected',
      error: 'secret-decrypt-failed'
    })
  })

  test('secret-key-unavailable 映射为 secret-config（不新增错误码）', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition({
      validateConfig: async () => {
        throw new PluginSecretError('secret-key-unavailable')
      }
    })
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    await expect(
      service.enqueue({
        source: 'event',
        userId: 7,
        pluginId: plugin.id,
        subjectType: 'message',
        subjectId: message.id
      })
    ).resolves.toEqual({ status: 'skipped', code: 'secret-config', httpStatus: 409 })

    expect(testDb.db.select().from(pluginJobs).all()).toHaveLength(0)
    expect(testDb.db.select().from(pluginLogs).all()[0]).toMatchObject({
      event: 'plugin_job.enqueue_rejected',
      error: 'secret-config'
    })
  })

  test('非 PluginSecretError 仍然上抛（真实服务器错误应 500）', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, 7)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition({
      validateConfig: async () => {
        throw new Error('unexpected boom')
      }
    })
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    await expect(
      service.enqueue({
        source: 'event',
        userId: 7,
        pluginId: plugin.id,
        subjectType: 'message',
        subjectId: message.id
      })
    ).rejects.toThrow('unexpected boom')
  })
})

describe('PluginJobService.enqueue plugin permissions', () => {
  function seedUserRow(db: TestDb, id: number, admin: 0 | 1) {
    db.sqlite
      .prepare('INSERT INTO users (id, name, admin, disabled) VALUES (?, ?, ?, 0)')
      .run(id, `perm-user-${id}-${admin}`, admin)
  }

  test('非管理员且无权限行 -> 409 plugin-unavailable、不建 job、写 enqueue_rejected', async () => {
    const testDb = createPluginJobsTestDb()
    seedUserRow(testDb, 7, 0)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition()
    const plugin = seedPlugin(testDb, {
      modulePath: definition.modulePath,
      grantPermission: false
    })
    const fake = createFakeQueue()
    const { quota, check } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(result).toEqual({ status: 'skipped', code: 'plugin-unavailable', httpStatus: 409 })
    expect(testDb.db.select().from(pluginJobs).all()).toHaveLength(0)
    expect(fake.sent).not.toHaveBeenCalled()

    expect(check).not.toHaveBeenCalled()

    const logs = testDb.db.select().from(pluginLogs).all()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      pluginId: plugin.id,
      userId: 7,
      event: 'plugin_job.enqueue_rejected',
      status: 0,
      error: 'plugin-unavailable'
    })
  })

  test('非管理员 + 有权限行 -> 成功入队', async () => {
    const testDb = createPluginJobsTestDb()
    seedUserRow(testDb, 7, 0)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition()
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.httpStatus).toBe(202)
    expect(fake.sent).toHaveBeenCalledWith({ jobId: result.job.id })
  })

  test('管理员不受 user_plugin_permissions 限制', async () => {
    const testDb = createPluginJobsTestDb()
    seedUserRow(testDb, 7, 1)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition()
    const plugin = seedPlugin(testDb, {
      modulePath: definition.modulePath,
      grantPermission: false
    })
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(result.status).toBe('ok')
  })

  test('禁用用户不享受管理员豁免 -> 409', async () => {
    const testDb = createPluginJobsTestDb()
    testDb.sqlite
      .prepare('INSERT INTO users (id, name, admin, disabled) VALUES (?, ?, 1, 1)')
      .run(7, 'disabled-admin')
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition()
    const plugin = seedPlugin(testDb, {
      modulePath: definition.modulePath,
      grantPermission: false
    })
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)

    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(result).toMatchObject({ status: 'skipped', code: 'plugin-unavailable' })
  })

  test('权限查询失败时 fail-closed（不抛、按无权限处理）', async () => {
    const testDb = createPluginJobsTestDb()
    seedUserRow(testDb, 7, 0)
    const message = seedMessage(testDb, 7)
    const definition = registerDefinition()
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const fake = createFakeQueue()
    const { quota } = createFakeQuota()
    const service = createService(asDrizzle(testDb), fake.queue, quota)


    testDb.sqlite.exec('DROP TABLE user_plugin_permissions')

    const result = await service.enqueue({
      source: 'event',
      userId: 7,
      pluginId: plugin.id,
      subjectType: 'message',
      subjectId: message.id
    })

    expect(result).toEqual({ status: 'skipped', code: 'plugin-unavailable', httpStatus: 409 })
    expect(testDb.db.select().from(pluginJobs).all()).toHaveLength(0)
    expect(fake.sent).not.toHaveBeenCalled()
  })
})
