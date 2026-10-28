import { PushOutboxService } from '../../src/services/push/outboxService'


const readyProviders = {
  get: () => null,
  getPolicy: () => null,
  resolve: (platform: string) => ({
    status: 'ready' as const,
    provider: { name: platform, send: async () => ({ ok: true, retriable: false }) },
    policy: { maxRetries: 3, retryBackoffMs: 2000 }
  })
}

describe('push flow integration', () => {
  test('enqueueForUserDevices creates pending huawei outbox rows for active device tokens', async () => {




    const drizzleMock = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn().mockResolvedValue([
            { id: 1, deviceToken: 'token-1' },
            { id: 2, deviceToken: 'token-2' }
          ])
        }))
      })),
      all: jest.fn().mockResolvedValue([{ id: 11 }, { id: 12 }])
    }

    const outbox = new PushOutboxService(drizzleMock as any)
    const result = await outbox.enqueueForUserDevices(
      {
        userId: 7,
        messageId: 100,
        appid: 42,
        date: '2026-02-27T10:00:00.000Z',
        platform: 'huawei',
        title: 'hello',
        message: 'world',
        priority: 5
      },
      readyProviders as any
    )

    expect(result).toEqual({ status: 'accepted', count: 2, outboxIds: [11, 12] })
    expect(drizzleMock.all).toHaveBeenCalledTimes(1)
  })


  test('enqueueForUserDevices skips clients that are not eligible for active push delivery', async () => {
    const drizzleMock = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn().mockResolvedValue([])
        }))
      })),
      all: jest.fn().mockResolvedValue([])
    }

    const outbox = new PushOutboxService(drizzleMock as any)
    const result = await outbox.enqueueForUserDevices(
      {
        userId: 7,
        messageId: 101,
        appid: 42,
        date: '2026-03-11T10:05:00.000Z',
        platform: 'huawei',
        message: 'world'
      },
      readyProviders as any
    )

    expect(result).toEqual({ status: 'accepted', count: 0, outboxIds: [] })
    expect(drizzleMock.all).not.toHaveBeenCalled()
  })
})
