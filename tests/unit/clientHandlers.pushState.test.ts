import { ClientHandlers } from '../../src/handlers/clientHandlers'
import { scanAcmePushPackage } from '../helpers/scanTestPackages'

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
      platform: 'huawei',
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
      platform: 'huawei',
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
      platform: 'huawei',
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


function createInsertDrizzleMock() {
  const insertedPayloads: Record<string, any>[] = []
  const insertMock = jest.fn(() => ({
    values: jest.fn((payload: Record<string, any>) => {
      insertedPayloads.push(payload)
      return {
        returning: jest.fn().mockResolvedValue([
          {
            id: 21,
            userId: 7,
            token: 'public-form',
            name: 'Acme Phone',
            platform: payload.platform,
            deviceUid: null,
            deviceToken: null,
            tokenUpdatedAt: null,
            tokenStatus: 'active',
            appVersion: null,
            deviceModel: null,
            lastUsed: null,
            elevatedUntil: null,
            expiresAfterInactivitySeconds: 0,
            createdAt: '2026-10-25T00:00:00.000Z'
          }
        ])
      }
    })
  }))
  return { insert: insertMock, __insert: insertMock, __insertedPayloads: insertedPayloads }
}

describe('ClientHandlers createClient platform validation', () => {
  test('accepts a scanned acme-push platform and stores it verbatim', async () => {
    const fixture = scanAcmePushPackage()
    try {
      expect(fixture.pushPlatforms).toEqual(['acme-push'])
      const drizzleMock = createInsertDrizzleMock()
      const handlers = new ClientHandlers(drizzleMock as any, undefined, fixture.pushPlatforms)

      const response = await handlers.createClient(7, { name: 'Acme Phone', platform: 'acme-push' })
      const body = await response.json() as any

      expect(response.status).toBe(200)
      expect(drizzleMock.__insert).toHaveBeenCalledTimes(1)
      expect(drizzleMock.__insertedPayloads[0].platform).toBe('acme-push')
      expect(body.platform).toBe('acme-push')
    } finally {
      fixture.dispose()
    }
  })

  test('rejects an undeclared platform string with 409 plugin-unavailable instead of coercing to unknown', async () => {
    const fixture = scanAcmePushPackage()
    try {
      const drizzleMock = createInsertDrizzleMock()
      const handlers = new ClientHandlers(drizzleMock as any, undefined, fixture.pushPlatforms)

      const response = await handlers.createClient(7, { name: 'Legacy Device', platform: 'legacy-vendor' })
      const body = await response.json() as any

      expect(response.status).toBe(409)
      expect(body.errorDescription).toContain('plugin-unavailable')
      expect(drizzleMock.__insert).not.toHaveBeenCalled()
    } finally {
      fixture.dispose()
    }
  })

  test('rejects non-string and empty platform values with 400', async () => {
    const fixture = scanAcmePushPackage()
    try {
      const drizzleMock = createInsertDrizzleMock()
      const handlers = new ClientHandlers(drizzleMock as any, undefined, fixture.pushPlatforms)

      const nonString = await handlers.createClient(7, { name: 'X', platform: 123 as unknown as string })
      expect(nonString.status).toBe(400)

      const empty = await handlers.createClient(7, { name: 'X', platform: '' })
      expect(empty.status).toBe(400)

      expect(drizzleMock.__insert).not.toHaveBeenCalled()
    } finally {
      fixture.dispose()
    }
  })

  test('keeps core web/unknown semantics and the unknown default', async () => {
    const fixture = scanAcmePushPackage()
    try {
      const drizzleMock = createInsertDrizzleMock()
      const handlers = new ClientHandlers(drizzleMock as any, undefined, fixture.pushPlatforms)

      const web = await handlers.createClient(7, { name: 'Browser', platform: 'web' })
      expect(web.status).toBe(200)

      const omitted = await handlers.createClient(7, { name: 'Legacy' })
      expect(omitted.status).toBe(200)

      expect(drizzleMock.__insert).toHaveBeenCalledTimes(2)
    } finally {
      fixture.dispose()
    }
  })
})

describe('ClientHandlers historical platform output', () => {
  test('returns legacy platform strings verbatim on read', async () => {
    const legacyRow = {
      id: 31,
      userId: 7,
      token: '',
      name: 'Legacy Device',
      platform: 'legacy-vendor',
      deviceUid: 'device-legacy',
      deviceToken: null,
      tokenUpdatedAt: null,
      tokenStatus: 'active',
      appVersion: null,
      deviceModel: null,
      lastUsed: null,
      elevatedUntil: null,
      expiresAfterInactivitySeconds: 0,
      createdAt: '2026-01-01T00:00:00.000Z'
    }
    const drizzleMock = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            orderBy: jest.fn().mockResolvedValue([legacyRow])
          }))
        }))
      }))
    }
    const handlers = new ClientHandlers(drizzleMock as any)

    const response = await handlers.getAllClients(7)
    const body = await response.json() as any

    expect(response.status).toBe(200)
    expect(body[0].platform).toBe('legacy-vendor')
  })
})
