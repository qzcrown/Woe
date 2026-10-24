
import { eq } from 'drizzle-orm'
import { createTestDb, asDrizzle, seedClient, type TestDb } from '../helpers/testDb'
import { createPushRuntime } from '../../src/services/push/runtime'
import { PushOutboxService } from '../../src/services/push/outboxService'
import { PushDispatcher } from '../../src/services/push/dispatcher'
import { consumePushQueueBatch } from '../../src/services/push/queueConsumer'
import { DEFAULT_PUSH_DELIVERY_POLICY } from '../../src/services/push/contracts'
import type {
  ProviderSendResult,
  PushProvider,
  PushProviderRegistration
} from '../../src/services/push/contracts'
import type { PushPluginDefinition } from '../../src/plugins/push/types'
import type { ExecutablePlugin, PluginInitOptions } from '../../src/plugins/types'
import type { DrizzleDB } from '../../src/drizzle/index'
import type { Env } from '../../src/types/index'
import { clients, pushOutbox } from '../../src/models'







function createFixturePush({ id, name }: { id: number; name: string }): ExecutablePlugin {
  let pushOutbox: PluginInitOptions['pushOutbox']
  return {
    id, name, capabilities: ['fixture-push'],
    init(opts) { pushOutbox = opts.pushOutbox },
    async onMessageCreate(ctx) {
      if (!pushOutbox || !ctx.message) return
      await pushOutbox.enqueueForUserDevices({
        userId: ctx.userId, messageId: ctx.message.id, appid: ctx.message.appId,
        date: ctx.message.date || ctx.now, platform: 'fixture_a',
        title: ctx.message.title, message: ctx.message.content,
        priority: ctx.message.priority, extras: ctx.message.extras
      })
    }
  }
}

function runtimeDrizzleFor(testDb: TestDb): DrizzleDB {
  const adapterClient = {
    prepare: (text: string) => ({
      bind: (...values: unknown[]) => ({
        first: async () => testDb.sqlite.prepare(text).get(...values) ?? null
      })
    })
  }
  return new Proxy(asDrizzle(testDb), {
    get: (target, prop) => (prop === '$client' ? adapterClient : Reflect.get(target, prop))
  }) as DrizzleDB
}

function getOutboxRow(testDb: TestDb, id: number) {
  return testDb.db.select().from(pushOutbox).where(eq(pushOutbox.id, id)).all()[0]
}

function getClientRow(testDb: TestDb, id: number) {
  return testDb.db.select().from(clients).where(eq(clients.id, id)).all()[0]
}

async function enqueue(
  testDb: TestDb,
  input: { messageId: number; platform?: 'fixture_a' | 'fixture_b'; appid?: number; date?: string }
) {
  const outbox = new PushOutboxService(asDrizzle(testDb))
  const result = await outbox.enqueueForUserDevices({
    userId: 7,
    messageId: input.messageId,
    appid: input.appid ?? 42,
    date: input.date ?? '2026-10-19T12:00:00.000Z',
    platform: input.platform ?? 'fixture_a',
    title: 'hello',
    message: 'world'
  })
  return result.outboxIds[0]
}


function recordingProvider(name: 'fixture_a' | 'fixture_b', send: jest.Mock): PushProvider {
  return { name, send: send as unknown as PushProvider['send'] }
}

function definitionFor(
  platform: 'fixture_a' | 'fixture_b',
  createRuntime: PushPluginDefinition['createRuntime']
): PushPluginDefinition {
  return { modulePath: `test/${platform}`, platform, createRuntime }
}


function disabledDefinition(platform: 'fixture_a' | 'fixture_b'): PushPluginDefinition {
  return definitionFor(platform, async (): Promise<PushProviderRegistration> => ({
    platform,
    provider: null,
    policy: DEFAULT_PUSH_DELIVERY_POLICY
  }))
}

function providingDefinition(
  platform: 'fixture_a' | 'fixture_b',
  provider: PushProvider,
  policy = DEFAULT_PUSH_DELIVERY_POLICY
): PushPluginDefinition {
  return definitionFor(platform, async (): Promise<PushProviderRegistration> => ({
    platform,
    provider,
    policy
  }))
}

function makeQueueMessage(outboxId: number) {
  return {
    body: { outboxId, traceId: 'trace-integration', attempt: 0, enqueueAt: new Date().toISOString() },
    ack: jest.fn(),
    retry: jest.fn()
  }
}

function makeBatch(msg: ReturnType<typeof makeQueueMessage>) {
  return {
    messages: [msg],
    queue: 'woe-push-queue',
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
    retryAll: jest.fn(),
    ackAll: jest.fn()
  } as unknown as MessageBatch<unknown>
}

function cronConsumer(testDb: TestDb, providers: any) {
  const outbox = new PushOutboxService(asDrizzle(testDb))
  return new PushDispatcher(outbox as any, providers).runOnce()
}

describe('plugin runtime over real SQLite outbox (injected definitions)', () => {
  test('deduplicates repeated enqueue from multiple user plugin instances into one row', async () => {
    const testDb = createTestDb()
    seedClient(testDb)

    const outbox = new PushOutboxService(asDrizzle(testDb))
    const instanceA = createFixturePush({ id: 1, name: 'Push FixtureA A' })
    const instanceB = createFixturePush({ id: 2, name: 'Push FixtureA B' })
    await instanceA.init({ config: undefined, pushOutbox: outbox as any })
    await instanceB.init({ config: undefined, pushOutbox: outbox as any })

    const ctx = {
      userId: 7,
      now: '2026-10-19T12:00:00.000Z',
      message: { id: 501, appId: 42, date: '2026-10-19T12:00:00.000Z', content: 'hello' }
    }
    await instanceA.onMessageCreate?.(ctx as any)
    await instanceB.onMessageCreate?.(ctx as any)

    const rows = testDb.db.select().from(pushOutbox).all()
    expect(rows).toHaveLength(1)
    expect(rows[0].messageId).toBe(501)
  })

  test('consumes an already-persisted row without creating any user plugin instance', async () => {
    const testDb = createTestDb()
    seedClient(testDb)
    const outboxId = await enqueue(testDb, { messageId: 502 })


    const send = jest.fn(async (): Promise<ProviderSendResult> => ({ ok: true, retriable: false }))
    const runtime = await createPushRuntime(runtimeDrizzleFor(testDb), {} as Env, {
      definitions: [providingDefinition('fixture_a', recordingProvider('fixture_a', send))]
    })

    await cronConsumer(testDb, runtime.providers)

    expect(send).toHaveBeenCalledTimes(1)
    expect(getOutboxRow(testDb, outboxId).status).toBe('success')
  })

  test('recovers a suspended persisted job in a fresh runtime', async () => {
    const testDb = createTestDb()
    seedClient(testDb)
    const outboxId = await enqueue(testDb, { messageId: 503 })
    const initialRow = getOutboxRow(testDb, outboxId)


    const noProviderRuntime = await createPushRuntime(runtimeDrizzleFor(testDb), {} as Env, {
      definitions: [disabledDefinition('fixture_a')]
    })
    await cronConsumer(testDb, noProviderRuntime.providers)

    const suspendedRow = getOutboxRow(testDb, outboxId)
    expect(suspendedRow.status).toBe('pending')
    expect(suspendedRow.attemptCount).toBe(initialRow.attemptCount)
    expect(suspendedRow.nextRetryAt).not.toBeNull()


    testDb.db
      .update(pushOutbox)
      .set({ nextRetryAt: '2000-01-01T00:00:00.000Z' })
      .where(eq(pushOutbox.id, outboxId))
      .run()


    const send = jest.fn(async (): Promise<ProviderSendResult> => ({ ok: true, retriable: false }))
    const recoveredRuntime = await createPushRuntime(runtimeDrizzleFor(testDb), {} as Env, {
      definitions: [providingDefinition('fixture_a', recordingProvider('fixture_a', send))]
    })
    await cronConsumer(testDb, recoveredRuntime.providers)

    const finalRow = getOutboxRow(testDb, outboxId)
    expect(finalRow.status).toBe('success')
    expect(send).toHaveBeenCalledTimes(1)
  })

  test('isolates one provider initialization failure while the other platform delivers', async () => {
    const testDb = createTestDb()
    seedClient(testDb, { platform: 'fixture_b', deviceToken: 'fixture_b-token', deviceUid: 'device-fixture_b' })
    seedClient(testDb, { platform: 'fixture_a', deviceToken: 'fixture_a-token', deviceUid: 'device-fixture_a' })
    const fixture_bRow = await enqueue(testDb, { messageId: 504, platform: 'fixture_b' })
    const fixture_aRow = await enqueue(testDb, { messageId: 504, platform: 'fixture_a' })

    const logSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const send = jest.fn(async (): Promise<ProviderSendResult> => ({ ok: true, retriable: false }))

    const runtime = await createPushRuntime(runtimeDrizzleFor(testDb), {} as Env, {
      definitions: [
        definitionFor('fixture_a', async () => {
          throw new Error('secret-sentinel')
        }),
        providingDefinition('fixture_b', recordingProvider('fixture_b', send))
      ]
    })

    expect(runtime.providers.get('fixture_a')).toBeNull()
    expect(runtime.providers.get('fixture_b')).not.toBeNull()
    expect(runtime.providers.getPolicy('fixture_a')).toEqual({ maxRetries: 3, retryBackoffMs: 2000 })
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain('secret-sentinel')

    await cronConsumer(testDb, runtime.providers)

    expect(send).toHaveBeenCalledTimes(1)
    expect(getOutboxRow(testDb, fixture_bRow).status).toBe('success')

    const fixture_aFinal = getOutboxRow(testDb, fixture_aRow)
    expect(fixture_aFinal.status).toBe('pending')
    expect(fixture_aFinal.attemptCount).toBe(0)
    logSpy.mockRestore()
  })

  test('keeps per-platform policies independent of FixtureA state keys', async () => {
    const testDb = createTestDb()

    testDb.sqlite
      .prepare(
        "INSERT INTO system_state (key, value) VALUES ('push.fixture_a.max_retries','5'),('push.fixture_a.retry_backoff_ms','7000')"
      )
      .run()
    seedClient(testDb, { platform: 'fixture_b', deviceToken: 'fixture_b-token' })

    const outboxId = await enqueue(testDb, { messageId: 505, platform: 'fixture_b' })

    const configuredDefinition: PushPluginDefinition = {
      modulePath: 'test/configured-policy', platform: 'fixture_a',
      async createRuntime(ctx): Promise<PushProviderRegistration> {
        return { platform: 'fixture_a', provider: null, policy: {
          maxRetries: Number(await ctx.getStateValue('push.fixture_a.max_retries')),
          retryBackoffMs: Number(await ctx.getStateValue('push.fixture_a.retry_backoff_ms'))
        } }
      }
    }
    const runtime = await createPushRuntime(runtimeDrizzleFor(testDb), {} as Env, {
      definitions: [configuredDefinition, disabledDefinition('fixture_b')]
    })


    expect(runtime.providers.getPolicy('fixture_a')).toEqual({ maxRetries: 5, retryBackoffMs: 7000 })
    expect(runtime.providers.getPolicy('fixture_b')).toEqual({ maxRetries: 3, retryBackoffMs: 2000 })



    testDb.db.update(pushOutbox).set({ attemptCount: 2 }).where(eq(pushOutbox.id, outboxId)).run()

    const send = jest.fn(async (): Promise<ProviderSendResult> => ({
      ok: false,
      retriable: true,
      errorMessage: '503'
    }))
    const fixture_bRuntime = await createPushRuntime(runtimeDrizzleFor(testDb), {} as Env, {
      definitions: [providingDefinition('fixture_b', recordingProvider('fixture_b', send), { maxRetries: 3, retryBackoffMs: 2000 })]
    })
    await cronConsumer(testDb, fixture_bRuntime.providers)

    const deadRow = getOutboxRow(testDb, outboxId)
    expect(deadRow.status).toBe('dead')
    expect(deadRow.attemptCount).toBe(3)


    const secondId = await enqueue(testDb, { messageId: 506, platform: 'fixture_b' })
    const retriableOnce = jest.fn(async (): Promise<ProviderSendResult> => ({
      ok: false,
      retriable: true,
      errorMessage: '503'
    }))
    const fixture_bRuntime2 = await createPushRuntime(runtimeDrizzleFor(testDb), {} as Env, {
      definitions: [providingDefinition('fixture_b', recordingProvider('fixture_b', retriableOnce), { maxRetries: 3, retryBackoffMs: 2000 })]
    })
    const before = Date.now()
    await cronConsumer(testDb, fixture_bRuntime2.providers)
    const retryRow = getOutboxRow(testDb, secondId)
    expect(retryRow.status).toBe('pending')
    expect(retryRow.attemptCount).toBe(1)
    const backoff = Date.parse(retryRow.nextRetryAt as string) - before
    expect(backoff).toBeGreaterThanOrEqual(1500)
    expect(backoff).toBeLessThanOrEqual(2100)
  })
})

describe('at-least-once and delayed publish recovery with a shared runtime', () => {
  test('does not re-send an already successful row for a duplicate queue message', async () => {
    const testDb = createTestDb()
    seedClient(testDb)
    const outboxId = await enqueue(testDb, { messageId: 507 })

    const send = jest.fn(async (): Promise<ProviderSendResult> => ({ ok: true, retriable: false }))
    const runtime = await createPushRuntime(runtimeDrizzleFor(testDb), {} as Env, {
      definitions: [providingDefinition('fixture_a', recordingProvider('fixture_a', send))]
    })
    const queue = { sendBatch: jest.fn().mockResolvedValue(undefined) }
    const outbox = new PushOutboxService(asDrizzle(testDb))

    const first = makeQueueMessage(outboxId)
    await consumePushQueueBatch(makeBatch(first), {
      outbox: outbox as any,
      providers: runtime.providers,
      queue: queue as any
    })
    expect(first.ack).toHaveBeenCalledTimes(1)
    expect(getOutboxRow(testDb, outboxId).status).toBe('success')


    const second = makeQueueMessage(outboxId)
    await consumePushQueueBatch(makeBatch(second), {
      outbox: outbox as any,
      providers: runtime.providers,
      queue: queue as any
    })

    expect(send).toHaveBeenCalledTimes(1)
    expect(second.ack).toHaveBeenCalledTimes(1)
    expect(getOutboxRow(testDb, outboxId).status).toBe('success')
  })

  test('leaves a row pending when delayed publish fails, and cron completes it later', async () => {
    const testDb = createTestDb()
    seedClient(testDb)
    const outboxId = await enqueue(testDb, { messageId: 508 })

    const failingSend = jest.fn(async (): Promise<ProviderSendResult> => ({
      ok: false,
      retriable: true,
      errorMessage: '503'
    }))
    const queueRuntime = await createPushRuntime(runtimeDrizzleFor(testDb), {} as Env, {
      definitions: [providingDefinition('fixture_a', recordingProvider('fixture_a', failingSend))]
    })
    const outbox = new PushOutboxService(asDrizzle(testDb))
    const failingQueue = { sendBatch: jest.fn().mockRejectedValue(new Error('queue unavailable')) }
    const msg = makeQueueMessage(outboxId)

    await consumePushQueueBatch(makeBatch(msg), {
      outbox: outbox as any,
      providers: queueRuntime.providers,
      queue: failingQueue as any
    })


    expect(msg.retry).toHaveBeenCalledTimes(1)
    expect(msg.ack).not.toHaveBeenCalled()
    const pendingRow = getOutboxRow(testDb, outboxId)
    expect(pendingRow.status).toBe('pending')
    expect(pendingRow.attemptCount).toBe(1)


    testDb.db
      .update(pushOutbox)
      .set({ nextRetryAt: '2000-01-01T00:00:00.000Z' })
      .where(eq(pushOutbox.id, outboxId))
      .run()

    const recoveredSend = jest.fn(async (): Promise<ProviderSendResult> => ({ ok: true, retriable: false }))
    const cronRuntime = await createPushRuntime(runtimeDrizzleFor(testDb), {} as Env, {
      definitions: [providingDefinition('fixture_a', recordingProvider('fixture_a', recoveredSend))]
    })
    await cronConsumer(testDb, cronRuntime.providers)

    expect(recoveredSend).toHaveBeenCalledTimes(1)
    expect(getOutboxRow(testDb, outboxId).status).toBe('success')
  })
})

describe('injected generic provider persists outcomes through both consumers', () => {
  const outcomes = [
    { name: 'success', expectedStatus: 'success', expectedTokenStatus: 'active' },
    { name: 'invalid target', expectedStatus: 'dead', expectedTokenStatus: 'invalid' }
  ] as const
  const consumers = ['queue', 'cron'] as const
  const cases = consumers.flatMap((consumer, consumerIndex) =>
    outcomes.map((outcome, outcomeIndex) => ({
      consumer, outcome, messageId: 700 + consumerIndex * outcomes.length + outcomeIndex
    }))
  )
  test.each(cases)('$consumer | $outcome.name', async ({ consumer, outcome, messageId }) => {
    const testDb = createTestDb()
    const client = seedClient(testDb, { platform: 'fixture_a', deviceToken: 'integration-device-token' })
    const send = jest.fn(async (): Promise<ProviderSendResult> => outcome.name === 'success'
      ? { ok: true, retriable: false }
      : { ok: false, retriable: false, failureKind: 'invalid-target', errorCode: 'FIXTURE_INVALID_TARGET' })
    const runtime = await createPushRuntime(runtimeDrizzleFor(testDb), {} as Env, {
      definitions: [providingDefinition('fixture_a', recordingProvider('fixture_a', send), { maxRetries: 5, retryBackoffMs: 7000 })]
    })
    expect(runtime.providers.getPolicy('fixture_a')).toEqual({ maxRetries: 5, retryBackoffMs: 7000 })
    const outbox = new PushOutboxService(asDrizzle(testDb))
    const outboxId = await enqueue(testDb, { messageId })
    const queue = { sendBatch: jest.fn().mockResolvedValue(undefined) }
    if (consumer === 'queue') {
      const msg = makeQueueMessage(outboxId)
      await consumePushQueueBatch(makeBatch(msg), { outbox: outbox as any, providers: runtime.providers, queue: queue as any })
      expect(msg.ack).toHaveBeenCalledTimes(1)
      expect(queue.sendBatch).not.toHaveBeenCalled()
    } else {
      await new PushDispatcher(outbox as any, runtime.providers).runOnce()
    }
    expect(send).toHaveBeenCalledTimes(1)
    expect((send.mock.calls as unknown[][])[0][0]).toMatchObject({
      deviceToken: client.deviceToken, messageId, appid: 42, date: '2026-10-19T12:00:00.000Z'
    })
    const finalRow = getOutboxRow(testDb, outboxId)
    const finalClient = getClientRow(testDb, client.id)
    expect(finalRow.status).toBe(outcome.expectedStatus)
    expect(finalClient.tokenStatus).toBe(outcome.expectedTokenStatus)
    if (outcome.name === 'invalid target') {
      expect(finalRow.attemptCount).toBe(1)
      expect(finalClient.deviceToken).toBeNull()
    } else {
      expect(finalClient.deviceToken).toBe(client.deviceToken)
    }
  })
})
