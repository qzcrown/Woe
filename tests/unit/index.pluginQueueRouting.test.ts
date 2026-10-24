








const cleanupSpy = jest.fn().mockResolvedValue({ success: true, deletedCount: 0 })
const cleanupOutboxSpy = jest.fn().mockResolvedValue({ success: true, deletedCount: 0 })
const cleanupPluginJobsSpy = jest.fn().mockResolvedValue({ success: true, deleted: 0, deadMarked: 0 })
const reclaimSpy = jest.fn().mockResolvedValue(0)
const runOnceSpy = jest.fn().mockResolvedValue(undefined)
const consumePushSpy = jest.fn().mockResolvedValue(undefined)
const consumePluginJobsSpy = jest.fn().mockResolvedValue(undefined)
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
  PushDispatcher: jest.fn().mockImplementation(() => ({ runOnce: runOnceSpy }))
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
  consumePushQueueBatch: (...args: any[]) => consumePushSpy(...args)
}))

jest.mock('../../src/services/pluginJobs/pluginJobQueueConsumer.ts', () => ({
  PluginJobQueueConsumer: jest.fn().mockImplementation(() => ({
    consume: consumePluginJobsSpy
  }))
}))

jest.mock('../../src/services/clientExpiry.ts', () => ({
  cleanupExpiredClients: (...args: any[]) => cleanupExpiredClientsSpy(...args)
}))

jest.mock('../../src/app.ts', () => ({
  __esModule: true,
  default: { fetch: jest.fn() }
}))

import worker from '../../src/index.ts'
import { PUSH_QUEUE_NAME, PLUGIN_JOB_QUEUE_NAME } from '../../src/constants/queueNames.ts'

function createBatch(queue: string, messageCount = 0) {
  return {
    queue,
    messages: Array.from({ length: messageCount }, () => ({
      body: {},
      ack: jest.fn(),
      retry: jest.fn()
    })),
    retryAll: jest.fn(),
    ackAll: jest.fn()
  }
}

describe('worker queue routing by batch.queue', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreatePushRuntime.mockResolvedValue({ providers: mockRuntimeProviders })
  })

  test('plugin job queue name constant is stable (Task 9 must align wrangler)', () => {
    expect(PLUGIN_JOB_QUEUE_NAME).toBe('woe-plugin-jobs')
    expect(PUSH_QUEUE_NAME).toBe('woe-push-queue')
  })

  test('plugin job batch is routed to the job consumer without requiring PUSH_QUEUE', async () => {
    const batch = createBatch(PLUGIN_JOB_QUEUE_NAME)
    const env = { DB: {} } as any

    await (worker as any).queue(batch, env, {})

    expect(consumePluginJobsSpy).toHaveBeenCalledTimes(1)
    expect(consumePluginJobsSpy.mock.calls[0][0]).toBe(batch)
    expect(consumePushSpy).not.toHaveBeenCalled()
    expect(batch.retryAll).not.toHaveBeenCalled()
    expect(batch.ackAll).not.toHaveBeenCalled()

    expect(mockCreatePushRuntime).not.toHaveBeenCalled()
  })

  test('plugin job queue name can be overridden per environment', async () => {
    const batch = createBatch('custom-plugin-jobs')
    const env = { DB: {}, PLUGIN_JOB_QUEUE_NAME: 'custom-plugin-jobs' } as any

    await (worker as any).queue(batch, env, {})

    expect(consumePluginJobsSpy).toHaveBeenCalledTimes(1)
    expect(consumePushSpy).not.toHaveBeenCalled()
  })

  test('push batch still requires the PUSH_QUEUE binding and retries all', async () => {
    const batch = createBatch(PUSH_QUEUE_NAME)

    await (worker as any).queue(batch, { DB: {} }, {})

    expect(batch.retryAll).toHaveBeenCalledTimes(1)
    expect(consumePushSpy).not.toHaveBeenCalled()
    expect(consumePluginJobsSpy).not.toHaveBeenCalled()
    expect(mockCreatePushRuntime).not.toHaveBeenCalled()
  })

  test('push batch with binding goes to the push consumer', async () => {
    const batch = createBatch(PUSH_QUEUE_NAME)
    const env = { DB: {}, PUSH_QUEUE: { sendBatch: jest.fn() } } as any

    await (worker as any).queue(batch, env, {})

    expect(consumePushSpy).toHaveBeenCalledTimes(1)
    expect(consumePluginJobsSpy).not.toHaveBeenCalled()
    expect(batch.retryAll).not.toHaveBeenCalled()
  })

  test('unknown queue logs a fixed error with queue name and count, then ackAll', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const batch = createBatch('some-other-queue', 2)

    await (worker as any).queue(batch, { DB: {} }, {})

    expect(batch.ackAll).toHaveBeenCalledTimes(1)
    expect(batch.retryAll).not.toHaveBeenCalled()
    expect(consumePushSpy).not.toHaveBeenCalled()
    expect(consumePluginJobsSpy).not.toHaveBeenCalled()

    expect(errorSpy).toHaveBeenCalledWith(
      '[Queue] unknown queue queue=some-other-queue count=2'
    )
    errorSpy.mockRestore()
  })

  test('plugin job consumer failure retries all messages', async () => {
    consumePluginJobsSpy.mockRejectedValueOnce(new Error('boom'))
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const batch = createBatch(PLUGIN_JOB_QUEUE_NAME)

    await (worker as any).queue(batch, { DB: {} }, {})

    expect(batch.retryAll).toHaveBeenCalledTimes(1)

    expect(errorSpy).toHaveBeenCalledWith(
      `[Plugin Job] dispatch failed queue=${PLUGIN_JOB_QUEUE_NAME}`
    )
    errorSpy.mockRestore()
  })
})

describe('scheduled plugin job cleanup wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreatePushRuntime.mockResolvedValue({ providers: mockRuntimeProviders })
  })

  test('scheduled runs plugin job cleanup alongside existing cleanups', async () => {
    await worker.scheduled({ cron: '0 2 * * *' } as any, { DB: {} } as any, {} as any)

    expect(cleanupSpy).toHaveBeenCalledWith(30)
    expect(cleanupPluginJobsSpy).toHaveBeenCalledTimes(1)
    expect(runOnceSpy).toHaveBeenCalledTimes(1)
    expect(cleanupExpiredClientsSpy).toHaveBeenCalledTimes(1)
  })

  test('plugin job cleanup failure is isolated from other scheduled tasks', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    cleanupPluginJobsSpy.mockRejectedValueOnce(new Error('D1 down'))

    await expect(
      worker.scheduled({ cron: '0 2 * * *' } as any, { DB: {} } as any, {} as any)
    ).resolves.toBeUndefined()

    expect(cleanupSpy).toHaveBeenCalledWith(30)
    expect(cleanupOutboxSpy).toHaveBeenCalledWith(30)
    expect(runOnceSpy).toHaveBeenCalledTimes(1)
    expect(cleanupExpiredClientsSpy).toHaveBeenCalledTimes(1)
    errorSpy.mockRestore()
  })
})
