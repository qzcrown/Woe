import { consumePushQueueBatch } from '../../src/services/push/queueConsumer'

function makeQueueMessage(body: unknown) {
  return {
    id: 'msg-1',
    timestamp: new Date('2026-02-28T12:00:00.000Z'),
    body,
    attempts: 1,
    retry: jest.fn(),
    ack: jest.fn()
  }
}

function makeBatch(message: any): MessageBatch<unknown> {
  return {
    messages: [message],
    queue: 'woe-push-queue',

    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
    retryAll: jest.fn(),
    ackAll: jest.fn()
  }
}





function makeOutboxStub(jobOverrides: Record<string, any> = {}) {
  return {
    getJobById: jest.fn().mockResolvedValue({
      id: 1,
      userId: 7,
      messageId: 100,
      platform: 'huawei',
      clientId: 1,
      payloadJson: JSON.stringify({
        userId: 7,
        platform: 'huawei',
        messageId: 100,
        appid: 42,
        date: '2026-02-28T11:59:00.000Z',
        title: 'hello',
        message: 'world'
      }),
      attemptCount: 0,
      ...jobOverrides
    }),
    markProcessing: jest.fn().mockResolvedValue('lease-1'),
    getPushTargetByClientId: jest.fn().mockResolvedValue({
      kind: 'ready',
      clientId: 1,
      platform: 'huawei',
      deviceToken: 'token-1',
      tokenUpdatedAt: '2026-09-24T00:00:00.000Z',
      tokenStatus: 'active'
    }),
    markSuccess: jest.fn().mockResolvedValue(undefined),
    scheduleRetry: jest.fn().mockResolvedValue(true),
    markDead: jest.fn().mockResolvedValue(undefined),
    suspend: jest.fn().mockResolvedValue(undefined)
  }
}


function makeResolver(provider: any | null) {
  return {
    get: jest.fn().mockReturnValue(provider),
    getPolicy: jest.fn().mockReturnValue({ maxRetries: 3, retryBackoffMs: 2000 }),
    resolve: jest.fn().mockImplementation(() =>
      provider
        ? { status: 'ready' as const, provider, policy: { maxRetries: 3, retryBackoffMs: 2000 } }
        : { status: 'disabled' as const, provider: null, policy: { maxRetries: 3, retryBackoffMs: 2000 } }
    )
  }
}

function makeQueue() {
  return { sendBatch: jest.fn().mockResolvedValue(undefined) }
}

describe('queue consumer', () => {
  test('marks success when provider send succeeds', async () => {
    const message = makeQueueMessage({ outboxId: 1, traceId: 'trace-1', attempt: 0, enqueueAt: '2026-02-28T12:00:00.000Z' })
    const outbox = makeOutboxStub()

    const provider = {
      send: jest.fn().mockResolvedValue({ ok: true, retriable: false })
    }

    const providers = makeResolver(provider)

    const queue = makeQueue()

    await consumePushQueueBatch(makeBatch(message), {
      outbox: outbox as any,
      providers: providers as any,
      queue: queue as any
    })

    expect(outbox.markProcessing).toHaveBeenCalledWith(1)
    expect(outbox.getPushTargetByClientId).toHaveBeenCalledWith(1)
    expect(provider.send).toHaveBeenCalledTimes(1)

    expect(provider.send.mock.calls[0][0].deviceToken).toBe('token-1')
    expect(outbox.markSuccess).toHaveBeenCalledWith(1, 'lease-1')
    expect(outbox.scheduleRetry).not.toHaveBeenCalled()
    expect(outbox.markDead).not.toHaveBeenCalled()
    expect(message.ack).toHaveBeenCalledTimes(1)
  })

  test('schedules retry and requeues on retriable failure', async () => {
    const message = makeQueueMessage({ outboxId: 1, traceId: 'trace-2', attempt: 0, enqueueAt: '2026-02-28T12:00:00.000Z' })
    const outbox = makeOutboxStub({ id: 2, messageId: 101, payloadJson: JSON.stringify({ userId: 7, platform: 'huawei', messageId: 101, appid: 42, date: '2026-02-28T11:59:00.000Z', title: 'hello', message: 'world' }) })

    const providers = makeResolver({
      send: jest.fn().mockResolvedValue({ ok: false, retriable: true, errorMessage: 'network' })
    })

    const queue = makeQueue()

    await consumePushQueueBatch(makeBatch(message), {
      outbox: outbox as any,
      providers: providers as any,
      queue: queue as any
    })

    expect(outbox.markSuccess).not.toHaveBeenCalled()
    expect(outbox.scheduleRetry).toHaveBeenCalledTimes(1)
    expect(outbox.markDead).not.toHaveBeenCalled()
    expect(queue.sendBatch).toHaveBeenCalledTimes(1)
    expect(message.ack).toHaveBeenCalledTimes(1)
  })

  test('marks dead on terminal provider failure', async () => {
    const message = makeQueueMessage({ outboxId: 1, traceId: 'trace-3', attempt: 0, enqueueAt: '2026-02-28T12:00:00.000Z' })
    const outbox = makeOutboxStub({ id: 3, messageId: 102, attemptCount: 2, payloadJson: JSON.stringify({ userId: 7, platform: 'huawei', messageId: 102, appid: 42, date: '2026-02-28T11:59:00.000Z', title: 'hello', message: 'world' }) })

    const providers = makeResolver({
      send: jest.fn().mockResolvedValue({ ok: false, retriable: false, errorMessage: 'invalid token' })
    })

    await consumePushQueueBatch(makeBatch(message), {
      outbox: outbox as any,
      providers: providers as any,
      queue: makeQueue() as any
    })

    expect(outbox.markSuccess).not.toHaveBeenCalled()
    expect(outbox.scheduleRetry).not.toHaveBeenCalled()
    expect(outbox.markDead).toHaveBeenCalledTimes(1)
    expect(message.ack).toHaveBeenCalledTimes(1)
  })

  test('skips duplicate delivery when processing lock is not acquired', async () => {
    const message = makeQueueMessage({ outboxId: 1, traceId: 'trace-4', attempt: 0, enqueueAt: '2026-02-28T12:00:00.000Z' })
    const outbox = makeOutboxStub({ id: 4, messageId: 103, payloadJson: JSON.stringify({ userId: 7, platform: 'huawei', messageId: 103, appid: 42, date: '2026-02-28T11:59:00.000Z', title: 'hello', message: 'world' }) })
    outbox.markProcessing = jest.fn().mockResolvedValue(null)

    const provider = {
      send: jest.fn().mockResolvedValue({ ok: true, retriable: false })
    }

    await consumePushQueueBatch(makeBatch(message), {
      outbox: outbox as any,
      providers: makeResolver(provider) as any,
      queue: makeQueue() as any
    })

    expect(provider.send).not.toHaveBeenCalled()
    expect(message.ack).toHaveBeenCalledTimes(1)
  })

  test('marks dead when outbox payload misses deeplink contract fields', async () => {
    const message = makeQueueMessage({ outboxId: 1, traceId: 'trace-5', attempt: 0, enqueueAt: '2026-02-28T12:00:00.000Z' })
    const outbox = makeOutboxStub({
      id: 5,
      messageId: 104,
      payloadJson: JSON.stringify({
        userId: 7,
        platform: 'huawei',
        title: 'hello',
        message: 'world'
      })
    })

    const provider = {
      send: jest.fn().mockResolvedValue({ ok: true, retriable: false })
    }

    await consumePushQueueBatch(makeBatch(message), {
      outbox: outbox as any,
      providers: makeResolver(provider) as any,
      queue: makeQueue() as any
    })

    expect(provider.send).not.toHaveBeenCalled()
    expect(outbox.markDead).toHaveBeenCalledWith(5, 1, 'Invalid outbox payload', 'lease-1')
    expect(message.ack).toHaveBeenCalledTimes(1)
  })

  test('acks invalid queue payload without retrying poison message', async () => {
    const message = makeQueueMessage({ outboxId: 'bad-id' })

    await consumePushQueueBatch(makeBatch(message), {
      outbox: {
        getJobById: jest.fn(),
        markProcessing: jest.fn(),
        getPushTargetByClientId: jest.fn(),
        markSuccess: jest.fn(),
        scheduleRetry: jest.fn(),
        markDead: jest.fn()
      } as any,
      providers: makeResolver(null) as any,
      queue: makeQueue() as any
    })

    expect(message.ack).toHaveBeenCalledTimes(1)
    expect(message.retry).not.toHaveBeenCalled()
  })
})

describe('queue consumer 管线 retry 结果的延迟重发', () => {
  function makeRetriableOutbox() {
    return makeOutboxStub({
      id: 9,
      messageId: 109,
      payloadJson: JSON.stringify({ userId: 7, platform: 'huawei', messageId: 109, appid: 42, date: '2026-02-28T11:59:00.000Z', title: 'hello', message: 'world' })
    })
  }

  function makeRetriableProviders() {
    return makeResolver({
      send: jest.fn().mockResolvedValue({ ok: false, retriable: true, errorMessage: 'network' })
    })
  }

  test('管线返回 retry 后成功发布延迟重试消息（含 delaySeconds 与 attempt+1），ack 原消息', async () => {
    const message = makeQueueMessage({ outboxId: 9, traceId: 'trace-9', attempt: 2, enqueueAt: '2026-02-28T12:00:00.000Z' })
    const outbox = makeRetriableOutbox()
    const queue = makeQueue()

    await consumePushQueueBatch(makeBatch(message), {
      outbox: outbox as any,
      providers: makeRetriableProviders() as any,
      queue: queue as any
    })

    expect(outbox.scheduleRetry).toHaveBeenCalledTimes(1)
    expect(queue.sendBatch).toHaveBeenCalledTimes(1)
    const request = queue.sendBatch.mock.calls[0][0][0]
    expect(request.body.outboxId).toBe(9)
    expect(request.body.traceId).toBe('trace-9')
    expect(request.body.attempt).toBe(3)
    expect(request.delaySeconds).toBeGreaterThanOrEqual(1)
    expect(message.ack).toHaveBeenCalledTimes(1)
    expect(message.retry).not.toHaveBeenCalled()
  })

  test('延迟重发发布失败 → 原消息 msg.retry()（不 ack），outbox 行不被 markDead', async () => {
    const message = makeQueueMessage({ outboxId: 9, traceId: 'trace-9', attempt: 0, enqueueAt: '2026-02-28T12:00:00.000Z' })
    const outbox = makeRetriableOutbox()
    const queue = { sendBatch: jest.fn().mockRejectedValue(new Error('queue unavailable')) }

    await consumePushQueueBatch(makeBatch(message), {
      outbox: outbox as any,
      providers: makeRetriableProviders() as any,
      queue: queue as any
    })


    expect(outbox.scheduleRetry).toHaveBeenCalledTimes(1)
    expect(outbox.markDead).not.toHaveBeenCalled()
    expect(message.retry).toHaveBeenCalledTimes(1)
    expect(message.ack).not.toHaveBeenCalled()
  })
})
