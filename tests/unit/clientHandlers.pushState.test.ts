import { ClientHandlers } from '../../src/handlers/clientHandlers'

function createPushStateDrizzleMock(initialClient: any | null) {
  const state = {
    updatedPayload: null as Record<string, any> | null,
    updateCalls: 0
  }

  return {
    __state: state,
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          get: jest.fn().mockResolvedValue(initialClient)
        }))
      }))
    })),
    update: jest.fn(() => ({
      set: jest.fn((payload: Record<string, any>) => {
        state.updatedPayload = payload
        return {
          where: jest.fn(() => ({
            returning: jest.fn().mockImplementation(() => {
              state.updateCalls += 1
              if (!initialClient) return Promise.resolve([])
              return Promise.resolve([
                {
                  ...initialClient,
                  ...payload
                }
              ])
            })
          }))
        }
      })
    }))
  }
}

describe('ClientHandlers updatePushState', () => {
  test('updates push state to inactive for an owned client', async () => {
    const drizzleMock = createPushStateDrizzleMock({
      id: 11,
      userId: 7,
      token: 'Ctoken',
      name: 'Pixel 9',
      platform: 'fixture_a',
      deviceUid: 'device-1',
      deviceToken: 'token-1',
      tokenUpdatedAt: '2026-03-11T10:00:00.000Z',
      tokenStatus: 'active',
      lastUsed: null
    })
    const handlers = new ClientHandlers(drizzleMock as any)

    const response = await handlers.updatePushState(7, '11', 'inactive')
    const body = await response.json() as any

    expect(response.status).toBe(200)
    expect(body.tokenStatus).toBe('inactive')
    expect(drizzleMock.__state.updatedPayload).toEqual(
      expect.objectContaining({ tokenStatus: 'inactive' })
    )
  })

  test('rejects activation when client has no device token', async () => {
    const drizzleMock = createPushStateDrizzleMock({
      id: 11,
      userId: 7,
      token: 'Ctoken',
      name: 'Pixel 9',
      platform: 'fixture_a',
      deviceUid: 'device-1',
      deviceToken: null,
      tokenUpdatedAt: null,
      tokenStatus: 'inactive',
      lastUsed: null
    })
    const handlers = new ClientHandlers(drizzleMock as any)

    const response = await handlers.updatePushState(7, '11', 'active')

    expect(response.status).toBe(409)
    expect(drizzleMock.__state.updateCalls).toBe(0)
  })

  test('rejects unsupported state values', async () => {
    const drizzleMock = createPushStateDrizzleMock({
      id: 11,
      userId: 7,
      token: 'Ctoken',
      name: 'Pixel 9',
      platform: 'fixture_a',
      deviceUid: 'device-1',
      deviceToken: 'token-1',
      tokenUpdatedAt: '2026-03-11T10:00:00.000Z',
      tokenStatus: 'active',
      lastUsed: null
    })
    const handlers = new ClientHandlers(drizzleMock as any)

    const response = await handlers.updatePushState(7, '11', 'expired' as any)

    expect(response.status).toBe(400)
    expect(drizzleMock.__state.updateCalls).toBe(0)
  })
})
