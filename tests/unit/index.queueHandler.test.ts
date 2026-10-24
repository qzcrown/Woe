const cleanupSpy = jest.fn().mockResolvedValue({ success: true, deletedCount: 0 })
const cleanupOutboxSpy = jest.fn().mockResolvedValue({ success: true, deletedCount: 0 })

const cleanupPluginJobsSpy = jest.fn().mockResolvedValue({
  success: true,
  deleted: 0,
  deadMarked: 0
})
const reclaimSpy = jest.fn().mockResolvedValue(0)
const runOnceSpy = jest.fn().mockResolvedValue(undefined)
const consumeSpy = jest.fn().mockResolvedValue(undefined)
const cleanupExpiredClientsSpy = jest.fn().mockResolvedValue(0)


const mockRuntimeProviders = { get: jest.fn(), getPolicy: jest.fn() }

const mockCreatePushRuntime = jest.fn().mockResolvedValue({ providers: mockRuntimeProviders })

jest.mock('../../src/services/cleanupService.ts', () => ({
  CleanupService: jest.fn().mockImplementation(() => ({
    cleanupOldPluginLogs: cleanupSpy,
    cleanupPushOutbox: cleanupOutboxSpy,
    cleanupPluginJobs: cleanupPluginJobsSpy
  }))
}))

jest.mock('../../src/services/push/dispatcher.ts', () => ({
  PushDispatcher: jest.fn().mockImplementation(() => ({
    runOnce: runOnceSpy
  }))
}))

jest.mock('../../src/services/push/runtime.ts', () => ({
  createPushRuntime: (...args: any[]) => mockCreatePushRuntime(...args)
}))

jest.mock('../../src/drizzle/index.ts', () => ({
  createDrizzle: jest.fn(() => ({ __name: 'drizzle' }))
}))

jest.mock('../../src/services/push/outboxService.ts', () => ({
  PushOutboxService: jest.fn().mockImplementation(() => ({
    getDueJobs: jest.fn().mockResolvedValue([]),
    markProcessing: jest.fn(),
    markSuccess: jest.fn(),
    scheduleRetry: jest.fn(),
    markDead: jest.fn(),
    suspend: jest.fn(),
    reclaimStaleProcessing: reclaimSpy
  }))
}))

jest.mock('../../src/services/push/queueConsumer.ts', () => ({
  consumePushQueueBatch: (...args: any[]) => consumeSpy(...args)
}))

jest.mock('../../src/services/clientExpiry.ts', () => ({
  cleanupExpiredClients: (...args: any[]) => cleanupExpiredClientsSpy(...args)
}))

jest.mock('../../src/app.ts', () => ({
  __esModule: true,
  default: {
    fetch: jest.fn()
  }
}))

import worker from '../../src/index'
import { PushDispatcher } from '../../src/services/push/dispatcher'

describe('worker queue handler and scheduled', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreatePushRuntime.mockResolvedValue({ providers: mockRuntimeProviders })
  })

  test('scheduled cleans plugin logs and runs push reconciliation pump', async () => {
    const env = { DB: {} } as any

    await worker.scheduled({ cron: '* * * * *' } as any, env, {} as any)

    expect(cleanupSpy).toHaveBeenCalledWith(30)
    expect(reclaimSpy).toHaveBeenCalledTimes(1)
    expect(runOnceSpy).toHaveBeenCalledTimes(1)
    expect(cleanupOutboxSpy).toHaveBeenCalledWith(30)

    expect(mockCreatePushRuntime).toHaveBeenCalledWith({ __name: 'drizzle' }, env)
    expect(PushDispatcher).toHaveBeenCalledWith(expect.anything(), mockRuntimeProviders)
  })

  test('scheduled triggers expired-client cleanup ', async () => {
    await worker.scheduled(
      { cron: '0 2 * * *' } as any,
      { DB: {} } as any,
      {} as any
    )


    expect(cleanupExpiredClientsSpy).toHaveBeenCalledTimes(1)
    expect(cleanupExpiredClientsSpy.mock.calls[0][1]).toBeUndefined()
  })

  test('scheduled expired-client cleanup receives a stream hub when MESSAGE_STREAM_HUB is bound', async () => {
    await worker.scheduled(
      { cron: '0 2 * * *' } as any,
      { DB: {}, MESSAGE_STREAM_HUB: { idFromName: jest.fn(), get: jest.fn() } } as any,
      {} as any
    )

    expect(cleanupExpiredClientsSpy).toHaveBeenCalledTimes(1)
    const streamHub = cleanupExpiredClientsSpy.mock.calls[0][1]
    expect(streamHub).toBeDefined()
    expect(typeof streamHub.disconnectClient).toBe('function')
  })

  test('scheduled expired-client cleanup failure is isolated from other tasks', async () => {
    cleanupExpiredClientsSpy.mockRejectedValueOnce(new Error('D1 down'))

    await expect(
      worker.scheduled(
        { cron: '0 2 * * *' } as any,
        { DB: {} } as any,
        {} as any
      )
    ).resolves.toBeUndefined()

    expect(cleanupSpy).toHaveBeenCalledWith(30)
    expect(runOnceSpy).toHaveBeenCalledTimes(1)
  })

  test('scheduled reconciliation failure is isolated from plugin log cleanup', async () => {
    reclaimSpy.mockRejectedValueOnce(new Error('D1 down'))

    await expect(
      worker.scheduled(
        { cron: '* * * * *' } as any,
        { DB: {} } as any,
        {} as any
      )
    ).resolves.toBeUndefined()

    expect(cleanupSpy).toHaveBeenCalledWith(30)
    expect(runOnceSpy).not.toHaveBeenCalled()
  })

  test('queue handler delegates to queue consumer with runtime providers', async () => {
    expect(typeof (worker as any).queue).toBe('function')

    const env = { DB: {}, PUSH_QUEUE: { sendBatch: jest.fn().mockResolvedValue(undefined) } } as any
    const batch = {
      messages: [],
      queue: 'woe-push-queue',
      retryAll: jest.fn(),
      ackAll: jest.fn()
    }

    await (worker as any).queue(batch, env, {})

    expect(consumeSpy).toHaveBeenCalledTimes(1)
    expect(consumeSpy.mock.calls[0][0]).toBe(batch)
    expect(consumeSpy.mock.calls[0][1].providers).toBe(mockRuntimeProviders)
    expect(consumeSpy.mock.calls[0][1].queue).toBe(env.PUSH_QUEUE)

    expect(mockCreatePushRuntime).toHaveBeenCalledWith({ __name: 'drizzle' }, env)
  })

  test('queue handler retries all messages when PUSH_QUEUE binding is missing', async () => {
    const batch = {
      messages: [],
      queue: 'woe-push-queue',
      retryAll: jest.fn(),
      ackAll: jest.fn()
    }

    await (worker as any).queue(batch, { DB: {} }, {})

    expect(batch.retryAll).toHaveBeenCalledTimes(1)
    expect(consumeSpy).not.toHaveBeenCalled()
    expect(mockCreatePushRuntime).not.toHaveBeenCalled()
  })
})
