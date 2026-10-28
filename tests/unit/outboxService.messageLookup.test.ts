import { PushOutboxService } from '../../src/services/push/outboxService'

describe('PushOutboxService message lookup helpers', () => {
  test('returns pending outbox ids by message', async () => {
    const drizzleMock = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            orderBy: jest.fn().mockResolvedValue([{ id: 10 }, { id: 11 }])
          }))
        }))
      }))
    }

    const outbox = new PushOutboxService(drizzleMock as any)
    const ids = await outbox.getPendingJobIdsByMessage(7, 101)

    expect(ids).toEqual([10, 11])
  })

  test('returns outbox job by id', async () => {
    const drizzleMock = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({
              id: 33,
              userId: 7,
              messageId: 101,
              platform: 'huawei',
              clientId: 1,
              payloadJson: '{"message":"x","platform":"huawei","deviceToken":"t"}',
              status: 'pending',
              attemptCount: 0,
              nextRetryAt: null,
              lastError: null,
              createdAt: null,
              updatedAt: null
            })
          }))
        }))
      }))
    }

    const outbox = new PushOutboxService(drizzleMock as any)
    const job = await outbox.getJobById(33)

    expect(job?.id).toBe(33)
    expect(job?.platform).toBe('huawei')
  })
})
