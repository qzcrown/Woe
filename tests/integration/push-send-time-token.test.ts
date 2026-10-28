




















import { PushOutboxService } from '../../src/services/push/outboxService'
import type { EnqueueForUserDevicesResult } from '../../src/services/push/outboxService'
import { ProviderRegistry } from '../../src/services/push/providerRegistry'
import type { ProviderSendResult } from '../../src/services/push/contracts'
import { PushDispatcher } from '../../src/services/push/dispatcher'
import { consumePushQueueBatch } from '../../src/services/push/queueConsumer'
import { ClientHandlers } from '../../src/handlers/clientHandlers'
import { createTestDb, asDrizzle, seedClient as seedBaseClient } from '../helpers/testDb'
import { clients, pushOutbox } from '../../src/models'
import { eq } from 'drizzle-orm'

const seedClient: typeof seedBaseClient = (testDb, overrides = {}) =>
  seedBaseClient(testDb, { platform: 'web', ...overrides })

let messageSeq = 0


const readyProviders = new ProviderRegistry([
  {
    platform: 'web',
    provider: {
      name: 'web',
      send: async (): Promise<ProviderSendResult> => ({ ok: true, retriable: false })
    },
    policy: { maxRetries: 3, retryBackoffMs: 2000 }
  }
])


function accepted(result: EnqueueForUserDevicesResult) {
  if (result.status !== 'accepted') {
    throw new Error(`expected accepted enqueue, got unavailable: ${result.reason}`)
  }
  return result
}


async function enqueue(testDb: ReturnType<typeof createTestDb>) {
  messageSeq += 1
  const service = new PushOutboxService(asDrizzle(testDb))
  const result = await service.enqueueForUserDevices(
    {
      userId: 7,
      messageId: messageSeq,
      appid: 42,
      date: '2026-09-24T10:00:00.000Z',
      platform: 'web',
      message: 'hello'
    },
    readyProviders as any
  )
  return { messageId: messageSeq, result }
}

function getRow(testDb: ReturnType<typeof createTestDb>, id: number) {
  return testDb.db.select().from(pushOutbox).where(eq(pushOutbox.id, id)).all()[0]
}

function firstOutboxRow(testDb: ReturnType<typeof createTestDb>) {
  return testDb.db.select().from(pushOutbox).all()[0]
}


function makeRecordingProvider(sendImpl?: jest.Mock) {
  const send =
    sendImpl ??
    jest.fn(async () => ({ ok: true, retriable: false }))
  return {
    providers: {
      get: jest.fn().mockReturnValue({ name: 'web', send }),
      getPolicy: jest.fn().mockReturnValue({ maxRetries: 3, retryBackoffMs: 2000 }),
      resolve: jest.fn().mockImplementation((platform: string) => ({
        status: 'ready' as const,
        provider: { name: platform, send },
        policy: { maxRetries: 3, retryBackoffMs: 2000 }
      }))
    },
    send
  }
}


function runDispatcher(testDb: ReturnType<typeof createTestDb>, providers: any, options: any = {}) {
  const outbox = new PushOutboxService(asDrizzle(testDb))
  const dispatcher = new PushDispatcher(outbox as any, providers, options)
  return dispatcher.runOnce()
}

describe('端到端：dispatcher.runOnce 真实链路（真库 + mock provider）', () => {
  test('入队 → 泵消费 → 用发送时解析的 token 成功，行终态 success，载荷不含 deviceToken', async () => {
    const testDb = createTestDb()
    const client = seedClient(testDb)
    const { result } = await enqueue(testDb)
    expect(accepted(result).count).toBe(1)

    const { providers, send } = makeRecordingProvider()
    await runDispatcher(testDb, providers)

    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].deviceToken).toBe(client.deviceToken)
    const row = getRow(testDb, accepted(result).outboxIds[0])
    expect(row.status).toBe('success')
    expect(row.lastError).toBeNull()
  })
})

describe('端到端：queueConsumer 消费入口真实链路（真库 + mock provider + mock queue）', () => {
  function makeMsg(outboxId: number) {
    return {
      body: { outboxId, traceId: 'trace-e2e', attempt: 0, enqueueAt: new Date().toISOString() },
      ack: jest.fn(),
      retry: jest.fn()
    }
  }

  function makeBatch(msg: any) {
    return { messages: [msg], queue: 'woe-push-queue', retryAll: jest.fn(), ackAll: jest.fn() } as any
  }

  test('Queue 消息 → claim → 发送成功 → 行 success + msg.ack', async () => {
    const testDb = createTestDb()
    const client = seedClient(testDb)
    const { result } = await enqueue(testDb)

    const { providers, send } = makeRecordingProvider()
    const msg = makeMsg(accepted(result).outboxIds[0])
    await consumePushQueueBatch(makeBatch(msg), {
      outbox: new PushOutboxService(asDrizzle(testDb)) as any,
      providers: providers as any,
      queue: { sendBatch: jest.fn().mockResolvedValue(undefined) } as any
    })

    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].deviceToken).toBe(client.deviceToken)
    expect(getRow(testDb, accepted(result).outboxIds[0]).status).toBe('success')
    expect(msg.ack).toHaveBeenCalledTimes(1)
  })

  test('可重试失败 → 行写回 pending+nextRetryAt+attemptCount=1 并发布延迟消息（真库行状态）', async () => {
    const testDb = createTestDb()
    seedClient(testDb)
    const { result } = await enqueue(testDb)

    const failingSend = jest.fn().mockResolvedValue({ ok: false, retriable: true, errorMessage: '503' })
    const { providers } = makeRecordingProvider(failingSend)
    const queue = { sendBatch: jest.fn().mockResolvedValue(undefined) }
    const msg = makeMsg(accepted(result).outboxIds[0])
    await consumePushQueueBatch(makeBatch(msg), {
      outbox: new PushOutboxService(asDrizzle(testDb)) as any,
      providers: providers as any,
      queue: queue as any
    })

    const row = getRow(testDb, accepted(result).outboxIds[0])
    expect(row.status).toBe('pending')
    expect(row.attemptCount).toBe(1)
    expect(row.nextRetryAt).not.toBeNull()
    expect(row.lastError).toBe('503')
    expect(queue.sendBatch).toHaveBeenCalledTimes(1)
    expect(msg.ack).toHaveBeenCalledTimes(1)
  })
})

describe('用例 2：token 变化后重复入队仍一行，发送用新 token', () => {
  test('PUT 轮换后同消息重复入队 → count=0 一行；发送用新 token', async () => {
    const testDb = createTestDb()
    const client = seedClient(testDb)
    const { messageId, result: first } = await enqueue(testDb)
    expect(accepted(first).count).toBe(1)

    testDb.db.update(clients).set({ deviceToken: 'rotated-token' }).where(eq(clients.id, client.id)).run()

    const service = new PushOutboxService(asDrizzle(testDb))
    const second = await service.enqueueForUserDevices(
      {
        userId: 7,
        messageId,
        appid: 42,
        date: '2026-09-24T10:00:00.000Z',
        platform: 'web',
        message: 'hello'
      },
      readyProviders as any
    )
    expect(accepted(second).count).toBe(0)
    expect(testDb.db.select().from(pushOutbox).all()).toHaveLength(1)

    const { providers, send } = makeRecordingProvider()
    await runDispatcher(testDb, providers)

    expect(send.mock.calls[0][0].deviceToken).toBe('rotated-token')
    expect(getRow(testDb, accepted(first).outboxIds[0]).status).toBe('success')
  })
})

describe('用例 3/4：pending 行发送时使用经 PUT / POST 更新的最新 token', () => {
  test('用例 3：PUT 路径 updateClient 写新 deviceToken → 发送用新 token', async () => {
    const testDb = createTestDb()
    const client = seedClient(testDb)
    const { result } = await enqueue(testDb)

    const handlers = new ClientHandlers(asDrizzle(testDb))
    const res = await handlers.updateClient(7, String(client.id), { name: client.name, deviceToken: 'put-new-token' })
    expect(res.status).toBe(200)

    const { providers, send } = makeRecordingProvider()
    await runDispatcher(testDb, providers)

    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].deviceToken).toBe('put-new-token')
    expect(getRow(testDb, accepted(result).outboxIds[0]).status).toBe('success')
  })

  test('用例 4：POST 重注册 createClient upsert 轮换 deviceToken → 同一断言', async () => {
    const testDb = createTestDb()
    const client = seedClient(testDb)
    const { result } = await enqueue(testDb)

    const handlers = new ClientHandlers(asDrizzle(testDb))
    const res = await handlers.createClient(7, {
      name: 'Re-registered',
      platform: 'web',
      deviceUid: client.deviceUid ?? undefined,
      deviceToken: 'post-new-token'
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.id).toBe(client.id)

    const { providers, send } = makeRecordingProvider()
    await runDispatcher(testDb, providers)

    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].deviceToken).toBe('post-new-token')
    expect(getRow(testDb, accepted(result).outboxIds[0]).status).toBe('success')
  })
})

describe('用例 6/7：发送窗口内目标变化守卫', () => {
  test('用例 6：发送窗口内 token 轮换 + 不可重试错误 → 不 markDead、scheduleRetry 附注、下轮用新 token 成功', async () => {
    const testDb = createTestDb()
    const client = seedClient(testDb)
    const { result } = await enqueue(testDb)


    const send = jest.fn()
      .mockImplementationOnce(async () => {
        testDb.db.update(clients).set({ deviceToken: 'concurrent-rotation' }).where(eq(clients.id, client.id)).run()
        return { ok: false, retriable: false, errorMessage: 'non-retriable boom' }
      })
      .mockImplementation(async () => ({ ok: true, retriable: false }))
    const { providers } = makeRecordingProvider(send)

    await runDispatcher(testDb, providers)

    const row = getRow(testDb, accepted(result).outboxIds[0])
    expect(row.status).toBe('pending')
    expect(row.attemptCount).toBe(1)
    expect(row.lastError).toContain('client target changed during send')
    expect(row.lastError).toContain('non-retriable boom')


    testDb.db.update(pushOutbox).set({ nextRetryAt: '2000-01-01T00:00:00.000Z' }).where(eq(pushOutbox.id, row.id)).run()
    await runDispatcher(testDb, providers)

    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1][0].deviceToken).toBe('concurrent-rotation')
    expect(getRow(testDb, row.id).status).toBe('success')
  })

  test('用例 7：同场景 token 未变 + 不可重试错误 → 照旧 markDead（attemptCount +1）', async () => {
    const testDb = createTestDb()
    seedClient(testDb)
    const { result } = await enqueue(testDb)

    const send = jest.fn().mockResolvedValue({ ok: false, retriable: false, errorMessage: 'invalid token' })
    const { providers } = makeRecordingProvider(send)

    await runDispatcher(testDb, providers)

    const row = getRow(testDb, accepted(result).outboxIds[0])
    expect(row.status).toBe('dead')
    expect(row.attemptCount).toBe(1)
    expect(row.lastError).toBe('invalid token')
  })

  test('用例 12 变体：失败期间 client 被删除 → 即使不可重试也 scheduleRetry', async () => {
    const testDb = createTestDb()
    const client = seedClient(testDb)
    const { result } = await enqueue(testDb)

    const send = jest.fn().mockImplementationOnce(async () => {
      testDb.db.delete(clients).where(eq(clients.id, client.id)).run()
      return { ok: false, retriable: false, errorMessage: 'boom' }
    })
    const { providers } = makeRecordingProvider(send)

    await runDispatcher(testDb, providers)

    const row = getRow(testDb, accepted(result).outboxIds[0])
    expect(row.status).toBe('pending')
    expect(row.lastError).toContain('client target changed during send')
    expect(row.attemptCount).toBe(1)
  })

  test('用例 12 变体：失败期间平台变化（web → legacy-vendor）→ scheduleRetry', async () => {
    const testDb = createTestDb()
    const client = seedClient(testDb)
    const { result } = await enqueue(testDb)

    const send = jest.fn().mockImplementationOnce(async () => {
      testDb.db.update(clients).set({ platform: 'legacy-vendor' }).where(eq(clients.id, client.id)).run()
      return { ok: false, retriable: false, errorMessage: 'boom' }
    })
    const { providers } = makeRecordingProvider(send)

    await runDispatcher(testDb, providers)

    const row = getRow(testDb, accepted(result).outboxIds[0])
    expect(row.status).toBe('pending')
    expect(row.lastError).toContain('client target changed during send')
  })

  test('用例 12 变体：失败期间 push-state 关推（inactive）→ scheduleRetry（不 dead Suppressed）', async () => {
    const testDb = createTestDb()
    const client = seedClient(testDb)
    const { result } = await enqueue(testDb)

    const send = jest.fn().mockImplementationOnce(async () => {
      testDb.db.update(clients).set({ tokenStatus: 'inactive' }).where(eq(clients.id, client.id)).run()
      return { ok: false, retriable: false, errorMessage: 'boom' }
    })
    const { providers } = makeRecordingProvider(send)

    await runDispatcher(testDb, providers)

    const row = getRow(testDb, accepted(result).outboxIds[0])
    expect(row.status).toBe('pending')
    expect(row.lastError).toContain('client target changed during send')
  })
})

describe('用例 8/9：发送前闸门 dead（不调 provider）', () => {
  test('用例 8：push-state 关推（真实 updatePushState）→ dead Suppressed，clients 行不受影响', async () => {
    const testDb = createTestDb()
    const client = seedClient(testDb)
    const { result } = await enqueue(testDb)

    const handlers = new ClientHandlers(asDrizzle(testDb))
    const res = await handlers.updatePushState(7, String(client.id), 'inactive')
    expect(res.status).toBe(200)

    const { providers, send } = makeRecordingProvider()
    await runDispatcher(testDb, providers)

    expect(send).not.toHaveBeenCalled()
    const row = getRow(testDb, accepted(result).outboxIds[0])
    expect(row.status).toBe('dead')
    expect(row.lastError).toContain('Suppressed')
    expect(row.lastError).toContain('token_status=inactive')

    const clientRow = testDb.db.select().from(clients).where(eq(clients.id, client.id)).all()[0]
    expect(clientRow.tokenStatus).toBe('inactive')
    expect(clientRow.deviceToken).toBe(client.deviceToken)
  })

  test('用例 9a：client 已删除 → dead Undeliverable: client deleted，不调 provider', async () => {
    const testDb = createTestDb()
    const client = seedClient(testDb)
    const { result } = await enqueue(testDb)


    testDb.db.delete(clients).where(eq(clients.id, client.id)).run()

    const { providers, send } = makeRecordingProvider()
    await runDispatcher(testDb, providers)

    expect(send).not.toHaveBeenCalled()
    const row = getRow(testDb, accepted(result).outboxIds[0])
    expect(row.status).toBe('dead')
    expect(row.lastError).toBe('Undeliverable: client deleted')
  })

  test('用例 9b：PUT 清空 deviceToken（null）→ dead Undeliverable: no device token，不调 provider', async () => {
    const testDb = createTestDb()
    const client = seedClient(testDb)
    const { result } = await enqueue(testDb)

    const handlers = new ClientHandlers(asDrizzle(testDb))
    const res = await handlers.updateClient(7, String(client.id), { name: client.name, deviceToken: null })
    expect(res.status).toBe(200)

    const { providers, send } = makeRecordingProvider()
    await runDispatcher(testDb, providers)

    expect(send).not.toHaveBeenCalled()
    const row = getRow(testDb, accepted(result).outboxIds[0])
    expect(row.status).toBe('dead')
    expect(row.lastError).toBe('Undeliverable: no device token')
  })

  test('用例 12 前半：选中目标后到 claim 前清空 token → gate dead（同 9b 路径）', async () => {
    const testDb = createTestDb()
    const client = seedClient(testDb)
    const { result } = await enqueue(testDb)

    testDb.db.update(clients).set({ deviceToken: '' }).where(eq(clients.id, client.id)).run()

    const { providers, send } = makeRecordingProvider()
    await runDispatcher(testDb, providers)

    expect(send).not.toHaveBeenCalled()
    const row = getRow(testDb, accepted(result).outboxIds[0])
    expect(row.status).toBe('dead')
    expect(row.lastError).toBe('Undeliverable: no device token')
  })
})

describe('用例 10：payload 瘦身回归（真库入队产物）', () => {
  test('enqueueForUserDevices 写出的 payloadJson 键集不含 deviceToken，且管线正常解析发送', async () => {
    const testDb = createTestDb()
    seedClient(testDb)
    const { result } = await enqueue(testDb)

    const row = getRow(testDb, accepted(result).outboxIds[0])
    const payload = JSON.parse(row.payloadJson)
    expect(Object.keys(payload).sort()).toEqual(
      ['appid', 'date', 'extras', 'message', 'messageId', 'platform', 'priority', 'title', 'userId']
    )
    expect(payload.deviceToken).toBeUndefined()

    const { providers, send } = makeRecordingProvider()
    await runDispatcher(testDb, providers)
    expect(send).toHaveBeenCalledTimes(1)
    expect(getRow(testDb, row.id).status).toBe('success')
  })
})

describe('用例 11：旧 payload 兼容', () => {
  function insertRow(
    testDb: ReturnType<typeof createTestDb>,
    payload: Record<string, any>,
    overrides: Partial<typeof pushOutbox.$inferInsert> = {}
  ) {
    messageSeq += 1
    testDb.db.insert(pushOutbox).values({
      userId: 7,
      messageId: messageSeq,
      platform: 'web',
      payloadJson: JSON.stringify({
        userId: 7,
        platform: 'web',
        messageId: messageSeq,
        appid: 42,
        date: '2026-09-24T10:00:00.000Z',
        title: 't',
        message: 'm',
        ...payload
      }),
      status: 'pending',
      attemptCount: 0,
      ...overrides
    }).run()
    return messageSeq
  }

  test('含 deviceToken 旧快照 + client_id 绑定 → provider 收到当前 client token（非载荷快照）', async () => {
    const testDb = createTestDb()
    const client = seedClient(testDb, { deviceToken: 'current-db-token' })
    const messageId = insertRow(testDb, { deviceToken: 'stale-payload-snapshot' }, { clientId: client.id })

    const { providers, send } = makeRecordingProvider()
    await runDispatcher(testDb, providers)

    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].deviceToken).toBe('current-db-token')
    const row = testDb.db.select().from(pushOutbox).where(eq(pushOutbox.messageId, messageId)).all()[0]
    expect(row.status).toBe('success')
  })

  test('client_id IS NULL 且载荷含 deviceToken → legacy 快照发送成功', async () => {
    const testDb = createTestDb()
    const messageId = insertRow(testDb, { deviceToken: 'legacy-snapshot-token' }, { clientId: null })

    const { providers, send } = makeRecordingProvider()
    await runDispatcher(testDb, providers)

    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].deviceToken).toBe('legacy-snapshot-token')
    const row = testDb.db.select().from(pushOutbox).where(eq(pushOutbox.messageId, messageId)).all()[0]
    expect(row.status).toBe('success')
  })

  test('client_id IS NULL 且载荷无 deviceToken → dead Undeliverable: no client binding', async () => {
    const testDb = createTestDb()
    const messageId = insertRow(testDb, {}, { clientId: null })

    const { providers, send } = makeRecordingProvider()
    await runDispatcher(testDb, providers)

    expect(send).not.toHaveBeenCalled()
    const row = testDb.db.select().from(pushOutbox).where(eq(pushOutbox.messageId, messageId)).all()[0]
    expect(row.status).toBe('dead')
    expect(row.lastError).toBe('Undeliverable: no client binding')

    expect(row.attemptCount).toBe(0)
  })
})

describe('用例 14：attemptCount 口径', () => {
  test('gate dead 保留原 attemptCount（不 +1）', async () => {
    const testDb = createTestDb()
    const client = seedClient(testDb)
    const { result } = await enqueue(testDb)

    testDb.db.update(pushOutbox).set({ attemptCount: 2 }).where(eq(pushOutbox.id, accepted(result).outboxIds[0])).run()

    const handlers = new ClientHandlers(asDrizzle(testDb))
    await handlers.updatePushState(7, String(client.id), 'inactive')

    const { providers, send } = makeRecordingProvider()
    await runDispatcher(testDb, providers)

    const row = getRow(testDb, accepted(result).outboxIds[0])
    expect(row.status).toBe('dead')
    expect(row.attemptCount).toBe(2)
    expect(send).not.toHaveBeenCalled()
  })

  test('provider 可重试失败 → scheduleRetry 计数 +1', async () => {
    const testDb = createTestDb()
    seedClient(testDb)
    const { result } = await enqueue(testDb)

    const send = jest.fn().mockResolvedValue({ ok: false, retriable: true, errorMessage: '503' })
    const { providers } = makeRecordingProvider(send)
    await runDispatcher(testDb, providers)

    const row = getRow(testDb, accepted(result).outboxIds[0])
    expect(row.status).toBe('pending')
    expect(row.attemptCount).toBe(1)
  })

  test('provider 不可重试失败 → markDead 计数 +1（同用例 7 真库断言）', async () => {
    const testDb = createTestDb()
    seedClient(testDb)
    const { result } = await enqueue(testDb)
    testDb.db.update(pushOutbox).set({ attemptCount: 4 }).where(eq(pushOutbox.id, accepted(result).outboxIds[0])).run()

    const send = jest.fn().mockResolvedValue({ ok: false, retriable: false, errorMessage: 'invalid token' })
    const { providers } = makeRecordingProvider(send)
    await runDispatcher(testDb, providers)

    const row = getRow(testDb, accepted(result).outboxIds[0])
    expect(row.status).toBe('dead')
    expect(row.attemptCount).toBe(5)
  })
})
