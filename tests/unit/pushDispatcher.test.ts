import { PushDispatcher } from '../../src/services/push/dispatcher'
import { SUSPEND_RETRY_AT_DELAY_MS } from '../../src/services/push/contracts'









function makeOutboxStub(jobs: any[]) {
  return {
    getDueJobs: jest.fn().mockResolvedValue(jobs),
    markProcessing: jest.fn().mockResolvedValue(true),
    getPushTargetByClientId: jest.fn().mockResolvedValue({
      kind: 'ready',
      clientId: 1,
      platform: 'fixture_a',
      deviceToken: 'token-1',
      tokenUpdatedAt: '2026-09-24T00:00:00.000Z',
      tokenStatus: 'active'
    }),
    markSuccess: jest.fn().mockResolvedValue(undefined),
    scheduleRetry: jest.fn().mockResolvedValue(undefined),
    markDead: jest.fn().mockResolvedValue(undefined),
    suspend: jest.fn().mockResolvedValue(undefined)
  }
}


function makeResolver(provider: any | null) {
  return {
    get: jest.fn().mockReturnValue(provider),
    getPolicy: jest.fn().mockReturnValue({ maxRetries: 3, retryBackoffMs: 2000 })
  }
}

function makeValidJob(id: number) {
  return {
    id,
    userId: 7,
    messageId: 100 + id,
    platform: 'fixture_a',
    clientId: 1,
    payloadJson: JSON.stringify({
      userId: 7,
      platform: 'fixture_a',
      messageId: 100 + id,
      appid: 42,
      date: '2026-02-28T11:59:00.000Z',
      title: 'hello',
      message: 'world'
    }),
    attemptCount: 0
  }
}

describe('PushDispatcher', () => {
  test('dispatcher marks job success when provider send succeeds', async () => {
    const outbox = makeOutboxStub([
      {
        id: 1,
        userId: 7,
        messageId: 100,
        platform: 'fixture_a',
        clientId: 1,
        payloadJson: JSON.stringify({
          userId: 7,
          platform: 'fixture_a',
          messageId: 100,
          appid: 42,
          date: '2026-02-28T11:59:00.000Z',
          title: 'hello',
          message: 'world'
        }),
        attemptCount: 0
      }
    ])

    const providers = makeResolver({
      name: 'fixture_a',
      send: jest.fn().mockResolvedValue({ ok: true, retriable: false })
    })

    const dispatcher = new PushDispatcher(outbox as any, providers as any)

    await dispatcher.runOnce()

    expect(outbox.markSuccess).toHaveBeenCalledTimes(1)
    expect(outbox.scheduleRetry).toHaveBeenCalledTimes(0)
    expect(outbox.markDead).toHaveBeenCalledTimes(0)

    expect(outbox.getPushTargetByClientId).toHaveBeenCalledWith(1)
  })

  test('dispatcher schedules retry for retriable failures', async () => {
    const outbox = makeOutboxStub([
      {
        id: 2,
        userId: 7,
        messageId: 101,
        platform: 'fixture_a',
        clientId: 1,
        payloadJson: JSON.stringify({
          userId: 7,
          platform: 'fixture_a',
          messageId: 101,
          appid: 42,
          date: '2026-02-28T11:59:00.000Z',
          title: 'hello',
          message: 'world'
        }),
        attemptCount: 0
      }
    ])

    const providers = makeResolver({
      name: 'fixture_a',
      send: jest.fn().mockResolvedValue({ ok: false, retriable: true, errorMessage: 'network' })
    })

    const dispatcher = new PushDispatcher(outbox as any, providers as any)

    await dispatcher.runOnce()

    expect(outbox.markSuccess).toHaveBeenCalledTimes(0)
    expect(outbox.scheduleRetry).toHaveBeenCalledTimes(1)
    expect(outbox.markDead).toHaveBeenCalledTimes(0)
  })

  test('dispatcher marks legacy payloads dead when deeplink contract fields are missing', async () => {
    const provider = {
      name: 'fixture_a',
      send: jest.fn().mockResolvedValue({ ok: true, retriable: false })
    }

    const outbox = makeOutboxStub([
      {
        id: 3,
        userId: 7,
        messageId: 102,
        platform: 'fixture_a',

        payloadJson: JSON.stringify({
          userId: 7,
          platform: 'fixture_a',
          deviceToken: 'token-1',
          title: 'hello',
          message: 'world'
        }),
        attemptCount: 0
      }
    ])

    const dispatcher = new PushDispatcher(outbox as any, makeResolver(provider) as any)

    await dispatcher.runOnce()

    expect(provider.send).not.toHaveBeenCalled()
    expect(outbox.markDead).toHaveBeenCalledWith(3, 1, 'Invalid outbox payload')
  })

  test('dispatcher suspends job when provider is missing instead of dead-lettering', async () => {
    const outbox = makeOutboxStub([makeValidJob(4)])
    const providers = makeResolver(null)

    const dispatcher = new PushDispatcher(outbox as any, providers as any)

    const before = Date.now()
    await dispatcher.runOnce()
    const after = Date.now()

    expect(outbox.suspend).toHaveBeenCalledTimes(1)
    expect(outbox.suspend).toHaveBeenCalledWith(
      4,
      expect.any(String),
      expect.stringContaining('no provider for platform fixture_a')
    )
    expect(outbox.markDead).not.toHaveBeenCalled()

    const retryAt = Date.parse(outbox.suspend.mock.calls[0][1])
    expect(retryAt).toBeGreaterThanOrEqual(before + SUSPEND_RETRY_AT_DELAY_MS)
    expect(retryAt).toBeLessThanOrEqual(after + SUSPEND_RETRY_AT_DELAY_MS)
  })

  test('dispatcher suspends job on provider suspend classification', async () => {
    const outbox = makeOutboxStub([makeValidJob(5)])
    const providers = makeResolver({
      name: 'fixture_a',
      send: jest.fn().mockResolvedValue({ ok: false, retriable: false, failureKind: 'suspend', errorCode: 'FIXTURE_CONFIG_MISSING', errorMessage: 'config missing' })
    })

    const dispatcher = new PushDispatcher(outbox as any, providers as any)

    await dispatcher.runOnce()

    expect(outbox.suspend).toHaveBeenCalledTimes(1)
    expect(outbox.suspend).toHaveBeenCalledWith(
      5,
      expect.any(String),
      expect.stringContaining('config missing')
    )
    expect(outbox.markDead).not.toHaveBeenCalled()
  })

  test('dispatcher dead-letters FIXTURE_NOT_IMPLEMENTED placeholder instead of suspending', async () => {
    const outbox = makeOutboxStub([makeValidJob(6)])
    const providers = makeResolver({
      name: 'fixture_b',
      send: jest.fn().mockResolvedValue({ ok: false, retriable: false, errorCode: 'FIXTURE_NOT_IMPLEMENTED' })
    })

    const dispatcher = new PushDispatcher(outbox as any, providers as any)

    await dispatcher.runOnce()

    expect(outbox.markDead).toHaveBeenCalledWith(6, 1, 'FIXTURE_NOT_IMPLEMENTED')
    expect(outbox.suspend).not.toHaveBeenCalled()
  })

  test('dispatcher drains due jobs across batches until a short batch', async () => {
    const outbox = makeOutboxStub([])
    outbox.getDueJobs
      .mockResolvedValueOnce([makeValidJob(7), makeValidJob(8)])
      .mockResolvedValueOnce([makeValidJob(9)])
    const provider = {
      name: 'fixture_a',
      send: jest.fn().mockResolvedValue({ ok: true, retriable: false })
    }

    const dispatcher = new PushDispatcher(outbox as any, makeResolver(provider) as any, {
      batchSize: 2
    })

    await dispatcher.runOnce()

    expect(outbox.getDueJobs).toHaveBeenCalledTimes(2)
    expect(provider.send).toHaveBeenCalledTimes(3)
    expect(outbox.markSuccess).toHaveBeenCalledTimes(3)
  })

  test('dispatcher bounds the drain loop when the due set never shortens', async () => {
    const outbox = makeOutboxStub([])
    outbox.getDueJobs.mockImplementation(() => Promise.resolve([makeValidJob(10), makeValidJob(11)]))
    const provider = {
      name: 'fixture_a',
      send: jest.fn().mockResolvedValue({ ok: true, retriable: false })
    }

    const dispatcher = new PushDispatcher(outbox as any, makeResolver(provider) as any, {
      batchSize: 2
    })

    await dispatcher.runOnce()

    expect(outbox.getDueJobs).toHaveBeenCalledTimes(10)
    expect(provider.send).toHaveBeenCalledTimes(20)
  })
})
