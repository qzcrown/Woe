






import { eq } from 'drizzle-orm'
import { register as registerPlugin } from '../../src/plugins/registry.ts'
import { registerPluginTask, resetPluginTaskRegistry } from '../../src/plugins/jobs/registry.ts'
import type { PluginTaskDefinition, PluginTaskResult } from '../../src/plugins/jobs/types.ts'
import type { Env } from '../../src/types/index.ts'
import { applications, messages, pluginConfigs, pluginJobs, pluginLogs } from '../../src/models/index.ts'
import {
  PluginJobQueueConsumer,
  type PluginJobConsumerDeps,
  type QuotaChecker
} from '../../src/services/pluginJobs/pluginJobQueueConsumer.ts'
import { cleanupPluginJobs } from '../../src/services/pluginJobs/cleanup.ts'
import { createPluginJobRuntime } from '../../src/services/pluginJobs/pluginJobService.ts'
import { MessageHandlers } from '../../src/handlers/messageHandlers.ts'
import { createPluginJobsTestDb } from '../helpers/pluginJobsTestDb.ts'
import { asDrizzle } from '../helpers/testDb.ts'

type TestDb = ReturnType<typeof createPluginJobsTestDb>

const USER_ID = 7

function seedUser(db: TestDb, id = USER_ID, disabled = 0, admin = 0) {
  db.sqlite
    .prepare('INSERT INTO users (id, name, admin, disabled) VALUES (?, ?, ?, ?)')
    .run(id, `user-${id}-${Math.random().toString(36).slice(2)}`, admin, disabled)
}

function seedPlugin(
  db: TestDb,
  values: { userId?: number; modulePath: string; enabled?: number; configYaml?: string | null }
) {
  const [row] = db.db
    .insert(pluginConfigs)
    .values({
      userId: values.userId ?? USER_ID,
      name: 'Test Plugin',
      token: `token-${Math.random().toString(36).slice(2)}`,
      modulePath: values.modulePath,
      configYaml: values.configYaml ?? 'provider: test',
      enabled: values.enabled ?? 1
    })
    .returning()
    .all()
  return row
}

function seedMessage(db: TestDb, userId = USER_ID, content = 'hello') {
  const [row] = db.db
    .insert(messages)
    .values({ userid: userId, appid: 1, message: content })
    .returning()
    .all()
  return row
}

function seedJob(
  db: TestDb,
  values: {
    pluginId: number
    subjectId: number
    userId?: number
    status?: string
    createdAt?: string
    payload?: string | null
  }
) {
  const [row] = db.db
    .insert(pluginJobs)
    .values({
      userId: values.userId ?? USER_ID,
      pluginId: values.pluginId,
      subjectType: 'message',
      subjectId: values.subjectId,
      status: values.status ?? 'pending',
      createdAt: values.createdAt,
      payload: values.payload ?? null
    })
    .returning()
    .all()
  return row
}

let definitionSeq = 0

function registerDefinition(
  run: (input?: { attempt: number }) => Promise<PluginTaskResult>,
  overrides: Partial<PluginTaskDefinition> = {}
): PluginTaskDefinition {
  const definition: PluginTaskDefinition = {
    modulePath: `test/jobs-integration/${++definitionSeq}`,
    supportedSubjectTypes: ['message'],
    createTask: async () => ({ run: async ({ attempt }) => run({ attempt }) }),
    ...overrides
  }
  registerPluginTask(definition)
  return definition
}

function createFakeQuota(): { quota: QuotaChecker; check: jest.Mock; consume: jest.Mock } {
  const check = jest.fn().mockResolvedValue({ status: 'ok', limit: 100, used: 0, source: 'default' })
  const consume = jest.fn().mockResolvedValue({ status: 'consumed' })
  return { quota: { check, consume }, check, consume }
}

function createFakeQueue() {
  const send = jest.fn<Promise<void>, [{ jobId: number }]>().mockResolvedValue(undefined)
  return { send, sender: { send } }
}

function createBatch(bodies: unknown[], attempts = 1) {
  const messages = bodies.map((body) => ({
    id: `msg-${Math.random().toString(36).slice(2)}`,
    body,
    attempts,
    ack: jest.fn(),
    retry: jest.fn()
  }))
  const batch = {
    queue: 'woe-plugin-jobs',
    messages,
    ackAll: jest.fn(),
    retryAll: jest.fn()
  }
  return { batch, messages, batchLike: batch as never }
}

function createConsumer(
  testDb: TestDb,
  overrides: Partial<PluginJobConsumerDeps> = {}
): PluginJobQueueConsumer {
  const { quota } = createFakeQuota()
  return new PluginJobQueueConsumer({
    drizzle: asDrizzle(testDb),
    env: {} as Env,
    quota,
    ...overrides
  })
}

function logs(testDb: TestDb) {
  return testDb.db.select().from(pluginLogs).all()
}

afterAll(() => {
  resetPluginTaskRegistry()
})

describe('plugin job lifecycle', () => {
  test('pending becomes success with result and completed_at', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb)
    const message = seedMessage(testDb)
    const definition = registerDefinition(async () => ({ ok: true, result: { tags: ['a'] } }))
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const job = seedJob(testDb, { pluginId: plugin.id, subjectId: message.id })
    const consumer = createConsumer(testDb)
    const { batch, messages: msgs, batchLike } = createBatch([{ jobId: job.id }])

    await consumer.consume(batchLike)

    expect(msgs[0].ack).toHaveBeenCalledTimes(1)
    expect(msgs[0].retry).not.toHaveBeenCalled()
    const row = testDb.db.select().from(pluginJobs).where(eq(pluginJobs.id, job.id)).get()!
    expect(row.status).toBe('success')
    expect(JSON.parse(row.result as string)).toEqual({ tags: ['a'] })
    expect(row.completedAt).not.toBeNull()
    expect(row.lastErrorCode).toBeNull()
    expect(row.lastErrorMessage).toBeNull()
    expect(logs(testDb)).toHaveLength(0)
    expect(batch.retryAll).not.toHaveBeenCalled()
  })

  test('non-retriable failure becomes failed and writes plugin_job.failed', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb)
    const message = seedMessage(testDb)
    const definition = registerDefinition(async () => ({
      ok: false,
      failure: { errorCode: 'provider-auth', retriable: false }
    }))
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const job = seedJob(testDb, { pluginId: plugin.id, subjectId: message.id })
    const consumer = createConsumer(testDb)
    const { batchLike } = createBatch([{ jobId: job.id }])

    await consumer.consume(batchLike)

    const row = testDb.db.select().from(pluginJobs).where(eq(pluginJobs.id, job.id)).get()!
    expect(row.status).toBe('failed')
    expect(row.lastErrorCode).toBe('provider-auth')
    expect(row.completedAt).not.toBeNull()
    const rows = logs(testDb)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      pluginId: plugin.id,
      userId: USER_ID,
      event: 'plugin_job.failed',
      status: 0,
      error: 'provider-auth'
    })
  })

  test('retriable failure on attempt 1 retries after 2s and keeps the job pending', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb)
    const message = seedMessage(testDb)
    const definition = registerDefinition(async () => ({
      ok: false,
      failure: { errorCode: 'provider-network', retriable: true }
    }))
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const job = seedJob(testDb, { pluginId: plugin.id, subjectId: message.id })
    const consumer = createConsumer(testDb)
    const { messages: msgs, batchLike } = createBatch([{ jobId: job.id }], 1)

    await consumer.consume(batchLike)

    expect(msgs[0].ack).not.toHaveBeenCalled()
    expect(msgs[0].retry).toHaveBeenCalledWith({ delaySeconds: 2 })
    const row = testDb.db.select().from(pluginJobs).where(eq(pluginJobs.id, job.id)).get()!
    expect(row.status).toBe('pending')
    expect(row.completedAt).toBeNull()
    expect(row.lastErrorCode).toBe('provider-network')
    expect(logs(testDb)).toHaveLength(0)
  })

  test('retriable failure on the last attempt becomes dead', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb)
    const message = seedMessage(testDb)
    const definition = registerDefinition(async () => ({
      ok: false,
      failure: { errorCode: 'provider-timeout', retriable: true }
    }))
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const job = seedJob(testDb, { pluginId: plugin.id, subjectId: message.id })
    const consumer = createConsumer(testDb)
    const { messages: msgs, batchLike } = createBatch([{ jobId: job.id }], 3)

    await consumer.consume(batchLike)

    expect(msgs[0].ack).toHaveBeenCalledTimes(1)
    expect(msgs[0].retry).not.toHaveBeenCalled()
    const row = testDb.db.select().from(pluginJobs).where(eq(pluginJobs.id, job.id)).get()!
    expect(row.status).toBe('dead')
    expect(row.completedAt).not.toBeNull()
    expect(logs(testDb)[0]).toMatchObject({
      event: 'plugin_job.dead',
      status: 0,
      error: 'provider-timeout'
    })
  })

  test('task exceptions become non-retriable internal failures', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb)
    const message = seedMessage(testDb)
    const definition = registerDefinition(async () => {
      throw new Error('boom')
    })
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const job = seedJob(testDb, { pluginId: plugin.id, subjectId: message.id })
    const consumer = createConsumer(testDb)
    const { batchLike } = createBatch([{ jobId: job.id }])

    await consumer.consume(batchLike)

    const row = testDb.db.select().from(pluginJobs).where(eq(pluginJobs.id, job.id)).get()!
    expect(row.status).toBe('failed')
    expect(row.lastErrorCode).toBe('internal')
    expect(logs(testDb)[0]).toMatchObject({ event: 'plugin_job.failed', error: 'internal' })
  })

  test('task exceptions log a fixed line with job/plugin ids but not the error message', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const testDb = createPluginJobsTestDb()
    seedUser(testDb)
    const message = seedMessage(testDb)
    const definition = registerDefinition(async () => {
      throw new Error('provider-secret-7f3a leaked detail')
    })
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const job = seedJob(testDb, { pluginId: plugin.id, subjectId: message.id })
    const consumer = createConsumer(testDb)
    const { batchLike } = createBatch([{ jobId: job.id }])

    await consumer.consume(batchLike)

    expect(errorSpy).toHaveBeenCalledTimes(1)
    const logged = String(errorSpy.mock.calls[0][0])
    expect(logged).toBe(
      `[Plugin Job] task threw job=${job.id} plugin=${plugin.id} code=internal`
    )
    expect(logged).not.toContain('provider-secret-7f3a')
    errorSpy.mockRestore()
  })

  test('an unserializable result keeps the job success, stores NULL and logs the job id', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const testDb = createPluginJobsTestDb()
    seedUser(testDb)
    const message = seedMessage(testDb)
    const circular: Record<string, unknown> = { tags: ['a'] }
    circular.self = circular
    const definition = registerDefinition(async () => ({ ok: true, result: circular }))
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const job = seedJob(testDb, { pluginId: plugin.id, subjectId: message.id })
    const consumer = createConsumer(testDb)
    const { messages: msgs, batchLike } = createBatch([{ jobId: job.id }])

    await consumer.consume(batchLike)

    expect(msgs[0].ack).toHaveBeenCalledTimes(1)
    const row = testDb.db.select().from(pluginJobs).where(eq(pluginJobs.id, job.id)).get()!
    expect(row.status).toBe('success')
    expect(row.result).toBeNull()
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain(`job=${job.id}`)
    errorSpy.mockRestore()
  })
})

describe('plugin job consumer availability and quota', () => {
  test('disabled plugin fails as plugin-unavailable without running the task', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb)
    const message = seedMessage(testDb)
    const run = jest.fn()
    const definition = registerDefinition(run as never)
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath, enabled: 0 })
    const job = seedJob(testDb, { pluginId: plugin.id, subjectId: message.id })
    const consumer = createConsumer(testDb)
    const { messages: msgs, batchLike } = createBatch([{ jobId: job.id }])

    await consumer.consume(batchLike)

    expect(msgs[0].ack).toHaveBeenCalledTimes(1)
    const row = testDb.db.select().from(pluginJobs).where(eq(pluginJobs.id, job.id)).get()!
    expect(row.status).toBe('failed')
    expect(row.lastErrorCode).toBe('plugin-unavailable')
    expect(logs(testDb)[0]).toMatchObject({ event: 'plugin_job.failed', error: 'plugin-unavailable' })
  })

  test('disabled user fails as plugin-unavailable', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, USER_ID, 1)
    const message = seedMessage(testDb)
    const definition = registerDefinition(async () => ({ ok: true }))
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const job = seedJob(testDb, { pluginId: plugin.id, subjectId: message.id })
    const consumer = createConsumer(testDb)
    const { batchLike } = createBatch([{ jobId: job.id }])

    await consumer.consume(batchLike)

    const row = testDb.db.select().from(pluginJobs).where(eq(pluginJobs.id, job.id)).get()!
    expect(row.status).toBe('failed')
    expect(row.lastErrorCode).toBe('plugin-unavailable')
  })

  test('unknown modulePath fails as plugin-unavailable without running the task or consuming quota', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb)
    const message = seedMessage(testDb)
    const run = jest.fn()
    const plugin = seedPlugin(testDb, { modulePath: 'test/never-registered' })
    const job = seedJob(testDb, { pluginId: plugin.id, subjectId: message.id })
    const { quota, consume } = createFakeQuota()
    const consumer = createConsumer(testDb, { quota })
    const { messages: msgs, batchLike } = createBatch([{ jobId: job.id }])

    await consumer.consume(batchLike)


    expect(msgs[0].ack).toHaveBeenCalledTimes(1)
    expect(msgs[0].retry).not.toHaveBeenCalled()
    const row = testDb.db.select().from(pluginJobs).where(eq(pluginJobs.id, job.id)).get()!
    expect(row.status).toBe('failed')
    expect(row.lastErrorCode).toBe('plugin-unavailable')
    expect(row.completedAt).not.toBeNull()
    expect(logs(testDb)[0]).toMatchObject({
      event: 'plugin_job.failed',
      status: 0,
      error: 'plugin-unavailable'
    })

    expect(run).not.toHaveBeenCalled()
    expect(consume).not.toHaveBeenCalled()
  })

  test('unknown modulePath redelivery of a still-pending job fails once and acks again', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb)
    const message = seedMessage(testDb)
    const plugin = seedPlugin(testDb, { modulePath: 'test/never-registered-redelivery' })
    const job = seedJob(testDb, { pluginId: plugin.id, subjectId: message.id })
    const consumer = createConsumer(testDb)

    const first = createBatch([{ jobId: job.id }])
    await consumer.consume(first.batchLike)
    const second = createBatch([{ jobId: job.id }])
    await consumer.consume(second.batchLike)


    expect(second.messages[0].ack).toHaveBeenCalledTimes(1)
    const row = testDb.db.select().from(pluginJobs).where(eq(pluginJobs.id, job.id)).get()!
    expect(row.status).toBe('failed')
    expect(logs(testDb)).toHaveLength(1)
  })

  test('restoring the module does not revive the terminal job', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb)
    const message = seedMessage(testDb)
    const modulePath = 'test/restore-after-removal'
    const run = jest.fn().mockResolvedValue({ ok: true })
    const plugin = seedPlugin(testDb, { modulePath })
    const job = seedJob(testDb, { pluginId: plugin.id, subjectId: message.id })


    await createConsumer(testDb).consume(createBatch([{ jobId: job.id }]).batchLike)
    let row = testDb.db.select().from(pluginJobs).where(eq(pluginJobs.id, job.id)).get()!
    expect(row.status).toBe('failed')


    registerDefinition(run as never, { modulePath })
    const restoredConsumer = createConsumer(testDb)
    const { messages: msgs, batchLike } = createBatch([{ jobId: job.id }])
    await restoredConsumer.consume(batchLike)

    expect(msgs[0].ack).toHaveBeenCalledTimes(1)
    row = testDb.db.select().from(pluginJobs).where(eq(pluginJobs.id, job.id)).get()!
    expect(row.status).toBe('failed')
    expect(row.lastErrorCode).toBe('plugin-unavailable')
    expect(run).not.toHaveBeenCalled()
  })

  test('terminal status write failure does not ack the message', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb)
    const message = seedMessage(testDb)
    const plugin = seedPlugin(testDb, { modulePath: 'test/unknown-write-fails' })
    const job = seedJob(testDb, { pluginId: plugin.id, subjectId: message.id })
    const drizzle = asDrizzle(testDb)

    jest.spyOn(drizzle, 'update').mockImplementationOnce(() => {
      throw new Error('d1 write failed')
    })
    const consumer = new PluginJobQueueConsumer({ drizzle, env: {} as Env, quota: createFakeQuota().quota })
    const { messages: msgs, batchLike } = createBatch([{ jobId: job.id }])

    await consumer.consume(batchLike)

    expect(msgs[0].ack).not.toHaveBeenCalled()
    expect(msgs[0].retry).toHaveBeenCalledTimes(1)
    const row = testDb.db.select().from(pluginJobs).where(eq(pluginJobs.id, job.id)).get()!
    expect(row.status).toBe('pending')
  })

  test('quota exceeded at consume time fails with limit-exceeded and never runs the task', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb)
    const message = seedMessage(testDb)
    const run = jest.fn()
    const definition = registerDefinition(run as never, { quotaNamespace: 'ai' })
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const job = seedJob(testDb, { pluginId: plugin.id, subjectId: message.id })
    const { quota, check } = createFakeQuota()
    check.mockResolvedValue({ status: 'exceeded', limit: 0, used: 0, source: 'override' })
    const consumer = createConsumer(testDb, { quota })
    const { messages: msgs, batchLike } = createBatch([{ jobId: job.id }])

    await consumer.consume(batchLike)

    expect(run).not.toHaveBeenCalled()
    expect(msgs[0].ack).toHaveBeenCalledTimes(1)
    const row = testDb.db.select().from(pluginJobs).where(eq(pluginJobs.id, job.id)).get()!
    expect(row.status).toBe('failed')
    expect(row.lastErrorCode).toBe('limit-exceeded')
    const rows = logs(testDb)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      event: 'plugin_job.quota_rejected',
      status: 0,
      error: 'limit-exceeded'
    })
  })

  test('quota read failure at consume time fails with quota-read-failed and logs failed', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb)
    const message = seedMessage(testDb)
    const run = jest.fn()
    const definition = registerDefinition(run as never, { quotaNamespace: 'ai' })
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const job = seedJob(testDb, { pluginId: plugin.id, subjectId: message.id })
    const { quota, check } = createFakeQuota()
    check.mockResolvedValue({ status: 'read-failed' })
    const consumer = createConsumer(testDb, { quota })
    const { batchLike } = createBatch([{ jobId: job.id }])

    await consumer.consume(batchLike)

    expect(run).not.toHaveBeenCalled()
    const row = testDb.db.select().from(pluginJobs).where(eq(pluginJobs.id, job.id)).get()!
    expect(row.status).toBe('failed')
    expect(row.lastErrorCode).toBe('quota-read-failed')
    expect(logs(testDb)[0]).toMatchObject({
      event: 'plugin_job.failed',
      error: 'quota-read-failed'
    })
  })

  test('deleted message is reported by the task as not-found', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb)
    const message = seedMessage(testDb)
    const definition = registerDefinition(async () => ({
      ok: false,
      failure: { errorCode: 'not-found', retriable: false }
    }))
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const job = seedJob(testDb, { pluginId: plugin.id, subjectId: message.id })
    testDb.db.delete(messages).where(eq(messages.id, message.id)).run()
    const consumer = createConsumer(testDb)
    const { batchLike } = createBatch([{ jobId: job.id }])

    await consumer.consume(batchLike)

    const row = testDb.db.select().from(pluginJobs).where(eq(pluginJobs.id, job.id)).get()!
    expect(row.status).toBe('failed')
    expect(row.lastErrorCode).toBe('not-found')
  })
})

describe('plugin job consumer delivery and usage semantics', () => {
  test('malformed payload is acked without touching the database', async () => {
    const testDb = createPluginJobsTestDb()
    const consumer = createConsumer(testDb)
    const { messages: msgs, batchLike } = createBatch([
      'not-an-object',
      { jobId: 0 },
      { jobId: -1 },
      { jobId: 1.5 },
      { jobId: '7' },
      {}
    ])

    await consumer.consume(batchLike)

    for (const msg of msgs) expect(msg.ack).toHaveBeenCalledTimes(1)
    expect(testDb.db.select().from(pluginJobs).all()).toHaveLength(0)
  })

  test('missing job is acked; terminal job is acked without re-running the task', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb)
    const message = seedMessage(testDb)
    const run = jest.fn().mockResolvedValue({ ok: true })
    const definition = registerDefinition(run as never)
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const job = seedJob(testDb, { pluginId: plugin.id, subjectId: message.id, status: 'success' })
    const consumer = createConsumer(testDb)
    const { messages: msgs, batchLike } = createBatch([{ jobId: 999_999 }, { jobId: job.id }])

    await consumer.consume(batchLike)

    expect(msgs[0].ack).toHaveBeenCalledTimes(1)
    expect(msgs[1].ack).toHaveBeenCalledTimes(1)
    expect(run).not.toHaveBeenCalled()
    expect(logs(testDb)).toHaveLength(0)
  })

  test('late terminal writes win (last-write-wins, no CAS)', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb)
    const message = seedMessage(testDb)
    let release: (result: PluginTaskResult) => void = () => {}
    const gate = new Promise<PluginTaskResult>((resolve) => {
      release = resolve
    })
    let markStarted: () => void = () => {}
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const definition = registerDefinition(async () => {
      markStarted()
      return gate
    })
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const job = seedJob(testDb, { pluginId: plugin.id, subjectId: message.id })
    const consumer = createConsumer(testDb)
    const { batchLike } = createBatch([{ jobId: job.id }])

    const pending = consumer.consume(batchLike)
    await started

    testDb.db
      .update(pluginJobs)
      .set({ status: 'success', completedAt: '2026-10-23 12:00:00' })
      .where(eq(pluginJobs.id, job.id))
      .run()
    release({ ok: false, failure: { errorCode: 'internal', retriable: false } })
    await pending

    const row = testDb.db.select().from(pluginJobs).where(eq(pluginJobs.id, job.id)).get()!
    expect(row.status).toBe('failed')
    expect(row.lastErrorCode).toBe('internal')
  })

  test('usage write failure keeps the job success and only logs', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb)
    const message = seedMessage(testDb)
    const definition = registerDefinition(async () => ({ ok: true, result: { tags: [] } }), {
      quotaNamespace: 'ai'
    })
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const job = seedJob(testDb, { pluginId: plugin.id, subjectId: message.id })
    const { quota, check, consume } = createFakeQuota()
    check.mockResolvedValue({ status: 'ok', limit: 100, used: 0, source: 'default' })
    consume.mockRejectedValue(new Error('d1 down'))
    const consumer = createConsumer(testDb, { quota })
    const { batchLike } = createBatch([{ jobId: job.id }])

    await consumer.consume(batchLike)

    expect(consume).toHaveBeenCalledTimes(1)
    const row = testDb.db.select().from(pluginJobs).where(eq(pluginJobs.id, job.id)).get()!
    expect(row.status).toBe('success')
  })

  test('plain ok:true with quotaConsumed=false skips usage and writes no capacity-full log', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb)
    const message = seedMessage(testDb)
    const definition = registerDefinition(
      async () => ({ ok: true, result: { tags: ['existing'] }, quotaConsumed: false }),
      { quotaNamespace: 'ai' }
    )
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const job = seedJob(testDb, { pluginId: plugin.id, subjectId: message.id })
    const { quota, consume } = createFakeQuota()
    const consumer = createConsumer(testDb, { quota })
    const { batchLike } = createBatch([{ jobId: job.id }])

    await consumer.consume(batchLike)

    expect(consume).not.toHaveBeenCalled()
    const row = testDb.db.select().from(pluginJobs).where(eq(pluginJobs.id, job.id)).get()!
    expect(row.status).toBe('success')

    expect(logs(testDb)).toHaveLength(0)
  })

  test('explicit skipped capacity-full writes plugin_job.skipped and ends as success', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb)
    const message = seedMessage(testDb)
    const definition = registerDefinition(
      async () => ({
        ok: true,
        skipped: { code: 'capacity-full' },
        result: { tags: ['existing'] },
        quotaConsumed: false
      }),
      { quotaNamespace: 'ai' }
    )
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const job = seedJob(testDb, { pluginId: plugin.id, subjectId: message.id })
    const { quota, consume } = createFakeQuota()
    const consumer = createConsumer(testDb, { quota })
    const { batchLike } = createBatch([{ jobId: job.id }])

    await consumer.consume(batchLike)

    expect(consume).not.toHaveBeenCalled()
    const row = testDb.db.select().from(pluginJobs).where(eq(pluginJobs.id, job.id)).get()!
    expect(row.status).toBe('success')
    expect(JSON.parse(row.result as string)).toEqual({ tags: ['existing'] })
    expect(row.lastErrorCode).toBeNull()

    const rows = logs(testDb)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      pluginId: plugin.id,
      userId: USER_ID,
      event: 'plugin_job.skipped',
      status: 1,
      error: 'capacity-full'
    })
  })

  test('a batch with several messages is processed one by one', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb)
    const message = seedMessage(testDb)
    const otherMessage = seedMessage(testDb, USER_ID, 'second')
    const run = jest.fn().mockResolvedValue({ ok: true })
    const definition = registerDefinition(run as never)
    const plugin = seedPlugin(testDb, { modulePath: definition.modulePath })
    const jobA = seedJob(testDb, { pluginId: plugin.id, subjectId: message.id })
    const jobB = seedJob(testDb, { pluginId: plugin.id, subjectId: otherMessage.id })
    const consumer = createConsumer(testDb)
    const { messages: msgs, batchLike } = createBatch([{ jobId: jobA.id }, { jobId: jobB.id }])

    await consumer.consume(batchLike)

    expect(run).toHaveBeenCalledTimes(2)
    expect(msgs[0].ack).toHaveBeenCalledTimes(1)
    expect(msgs[1].ack).toHaveBeenCalledTimes(1)
  })
})

describe('plugin job cleanup', () => {
  test('deletes terminal jobs older than 30 days and keeps 29-day-old rows', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb)
    const message = seedMessage(testDb)
    const plugin = seedPlugin(testDb, { modulePath: 'test/cleanup' })
    const oldSuccess = seedJob(testDb, {
      pluginId: plugin.id,
      subjectId: message.id,
      status: 'success',
      createdAt: '2026-09-01 00:00:00'
    })
    const oldFailed = seedJob(testDb, {
      pluginId: plugin.id,
      subjectId: message.id,
      status: 'failed',
      createdAt: '2026-09-01 00:00:00'
    })
    const kept = seedJob(testDb, {
      pluginId: plugin.id,
      subjectId: message.id,
      status: 'success',
      createdAt: '2026-09-24 12:00:00'
    })

    const now = new Date('2026-10-23T12:00:00.000Z')
    const result = await cleanupPluginJobs(asDrizzle(testDb), now, { hasTaskDefinition: () => true })

    expect(result.deleted).toBe(2)
    expect(result.deadMarked).toBe(0)
    expect(result.unavailableFailed).toBe(0)
    const ids = testDb.db.select({ id: pluginJobs.id }).from(pluginJobs).all().map((r) => r.id)
    expect(ids).toEqual([kept.id])
    expect(ids).not.toContain(oldSuccess.id)
    expect(ids).not.toContain(oldFailed.id)
  })

  test('marks pending jobs older than 24h as dead and keeps younger ones', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb)
    const message = seedMessage(testDb)
    const otherMessage = seedMessage(testDb, USER_ID, 'second')
    const plugin = seedPlugin(testDb, { modulePath: 'test/cleanup' })
    const stale = seedJob(testDb, {
      pluginId: plugin.id,
      subjectId: message.id,
      status: 'pending',
      createdAt: '2026-10-21 00:00:00'
    })
    const fresh = seedJob(testDb, {
      pluginId: plugin.id,
      subjectId: otherMessage.id,
      status: 'pending',
      createdAt: '2026-10-22 13:00:00'
    })

    const now = new Date('2026-10-23T12:00:00.000Z')
    const result = await cleanupPluginJobs(asDrizzle(testDb), now, { hasTaskDefinition: () => true })

    expect(result.deadMarked).toBe(1)
    expect(result.deleted).toBe(0)
    expect(result.unavailableFailed).toBe(0)
    const staleRow = testDb.db.select().from(pluginJobs).where(eq(pluginJobs.id, stale.id)).get()!
    expect(staleRow.status).toBe('dead')
    expect(staleRow.completedAt).not.toBeNull()
    expect(staleRow.lastErrorCode).toBe('dead-timeout')
    expect(staleRow.lastErrorMessage).toEqual(expect.any(String))
    const freshRow = testDb.db.select().from(pluginJobs).where(eq(pluginJobs.id, fresh.id)).get()!
    expect(freshRow.status).toBe('pending')

    const rows = logs(testDb)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      pluginId: plugin.id,
      userId: USER_ID,
      event: 'plugin_job.dead',
      status: 0,
      error: 'dead-timeout'
    })
  })

  test('a row that turns terminal before the update gets no dead log', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb)
    const message = seedMessage(testDb)
    const otherMessage = seedMessage(testDb, USER_ID, 'second')
    const plugin = seedPlugin(testDb, { modulePath: 'test/cleanup' })
    const stale = seedJob(testDb, {
      pluginId: plugin.id,
      subjectId: message.id,
      status: 'pending',
      createdAt: '2026-10-21 00:00:00'
    })
    const converged = seedJob(testDb, {
      pluginId: plugin.id,
      subjectId: otherMessage.id,
      status: 'pending',
      createdAt: '2026-10-21 00:00:00'
    })




    const drizzle = asDrizzle(testDb)
    const realUpdate = (drizzle.update as unknown as (table: unknown) => unknown).bind(drizzle)
    jest.spyOn(drizzle, 'update').mockImplementation(((table: unknown) => {
      testDb.sqlite
        .prepare("UPDATE plugin_jobs SET status = 'success', completed_at = ? WHERE id = ?")
        .run('2026-10-23 11:59:00', converged.id)
      return realUpdate(table)
    }) as unknown as typeof drizzle.update)

    const result = await cleanupPluginJobs(drizzle, new Date('2026-10-23T12:00:00.000Z'), {
      hasTaskDefinition: () => true
    })

    expect(result.deadMarked).toBe(1)
    expect(result.deleted).toBe(0)

    const convergedRow = testDb.db
      .select()
      .from(pluginJobs)
      .where(eq(pluginJobs.id, converged.id))
      .get()!
    expect(convergedRow.status).toBe('success')
    expect(convergedRow.lastErrorCode).toBeNull()

    const staleRow = testDb.db.select().from(pluginJobs).where(eq(pluginJobs.id, stale.id)).get()!
    expect(staleRow.status).toBe('dead')
    expect(staleRow.lastErrorCode).toBe('dead-timeout')


    const rows = logs(testDb)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      pluginId: plugin.id,
      userId: USER_ID,
      event: 'plugin_job.dead',
      status: 0,
      error: 'dead-timeout'
    })
  })

  test('terminal jobs are not affected by the 24h pending rule', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb)
    const message = seedMessage(testDb)
    const plugin = seedPlugin(testDb, { modulePath: 'test/cleanup' })
    const oldTerminal = seedJob(testDb, {
      pluginId: plugin.id,
      subjectId: message.id,
      status: 'dead',
      createdAt: '2026-10-01 00:00:00'
    })

    const result = await cleanupPluginJobs(asDrizzle(testDb), new Date('2026-10-23T12:00:00.000Z'), {
      hasTaskDefinition: () => true
    })

    expect(result.deadMarked).toBe(0)
    const row = testDb.db.select().from(pluginJobs).where(eq(pluginJobs.id, oldTerminal.id)).get()!
    expect(row.status).toBe('dead')
  })
})

describe('message creation enqueues synchronously', () => {
  const MODULE_PATH = 'test/executable-enqueue'

  function registerExecutablePlugin() {
    registerPlugin(MODULE_PATH, ({ id, name }) => ({
      id,
      name,
      capabilities: ['message'],
      init: () => {},
      onMessageCreate: async (ctx) => {
        await ctx.jobs!.enqueue({
          subjectType: 'message',
          subjectId: ctx.message!.id
        })
        return { status: 'ok' }
      }
    }))
  }

  beforeAll(() => {
    registerExecutablePlugin()
    registerDefinition(async () => ({ ok: true }), { modulePath: MODULE_PATH })
  })

  test('createMessage creates a pending job and sends it to the queue', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, USER_ID, 0, 1)
    const plugin = seedPlugin(testDb, { modulePath: MODULE_PATH })
    const [app] = testDb.db
      .insert(applications)
      .values({ userId: USER_ID, token: 'app-token', name: 'App' })
      .returning()
      .all()
    const fake = createFakeQueue()
    const runtime = createPluginJobRuntime({
      drizzle: asDrizzle(testDb),
      env: { PLUGIN_JOB_QUEUE: fake.sender } as unknown as Env
    })
    const handlers = new MessageHandlers(asDrizzle(testDb), undefined, runtime)

    const response = await handlers.createMessage(app.id, 'hello world')

    expect(response.status).toBe(200)
    const jobs = testDb.db.select().from(pluginJobs).all()
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({
      userId: USER_ID,
      pluginId: plugin.id,
      subjectType: 'message',
      status: 'pending'
    })
    expect(fake.send).toHaveBeenCalledWith({ jobId: jobs[0].id })
  })

  test('queue send failure does not break message creation', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, USER_ID, 0, 1)
    seedPlugin(testDb, { modulePath: MODULE_PATH })
    const [app] = testDb.db
      .insert(applications)
      .values({ userId: USER_ID, token: 'app-token-2', name: 'App' })
      .returning()
      .all()
    const fake = createFakeQueue()
    fake.send.mockRejectedValueOnce(new Error('queue down'))
    const runtime = createPluginJobRuntime({
      drizzle: asDrizzle(testDb),
      env: { PLUGIN_JOB_QUEUE: fake.sender } as unknown as Env
    })
    const handlers = new MessageHandlers(asDrizzle(testDb), undefined, runtime)

    const response = await handlers.createMessage(app.id, 'hello world')

    expect(response.status).toBe(200)
    const jobs = testDb.db.select().from(pluginJobs).all()
    expect(jobs).toHaveLength(1)
    expect(jobs[0].status).toBe('failed')
    expect(jobs[0].lastErrorCode).toBe('enqueue-send-failed')
  })

  test('without a runtime the manager keeps the fail-loud default and messages still work', async () => {
    const testDb = createPluginJobsTestDb()
    seedUser(testDb, USER_ID, 0, 1)
    const [app] = testDb.db
      .insert(applications)
      .values({ userId: USER_ID, token: 'app-token-3', name: 'App' })
      .returning()
      .all()
    const handlers = new MessageHandlers(asDrizzle(testDb), undefined)

    const response = await handlers.createMessage(app.id, 'hello world')

    expect(response.status).toBe(200)
    expect(testDb.db.select().from(pluginJobs).all()).toHaveLength(0)
  })
})
