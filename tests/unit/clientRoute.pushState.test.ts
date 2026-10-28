const mockUpdatePushState = jest.fn().mockResolvedValue(
  new Response(JSON.stringify({
    id: 11,
    token: 'Ctoken',
    name: 'Pixel 9',
    platform: 'huawei',
    deviceUid: 'device-1',
    deviceToken: 'token-1',
    tokenUpdatedAt: '2026-03-11T10:00:00.000Z',
    tokenStatus: 'inactive',
    lastUsed: null
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
)

const mockCreateClient = jest.fn().mockResolvedValue(new Response(null, { status: 200 }))

jest.mock('../../src/drizzle/index.ts', () => ({
  createDrizzle: jest.fn(() => ({ __name: 'drizzle-mock' }))
}))

jest.mock('../../src/middleware/auth.ts', () => ({
  Authenticator: jest.fn().mockImplementation(() => ({
    authenticateBasic: jest.fn().mockResolvedValue(null),
    authenticate: jest.fn().mockResolvedValue({ tokenType: 'client', userId: 7, resourceId: 11 })
  }))
}))

jest.mock('../../src/handlers/clientHandlers.ts', () => ({
  ClientHandlers: jest.fn().mockImplementation(() => ({
    getAllClients: jest.fn(),
    createClient: mockCreateClient,
    getClient: jest.fn(),
    updateClient: jest.fn(),
    updatePushState: mockUpdatePushState,
    deleteClient: jest.fn()
  }))
}))

import { client } from '../../src/routes/client'

describe('client route push state', () => {
  test('updates the push state for an authenticated client', async () => {
    const response = await client.fetch(
      new Request('http://localhost/11/push-state', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-gotify-key': 'client-token'
        },
        body: JSON.stringify({ state: 'inactive' })
      }),
      {
        DB: {} as any
      } as any,
      {
        waitUntil: jest.fn(),
        passThroughOnException: jest.fn()
      } as any
    )

    expect(response.status).toBe(200)
    expect(mockUpdatePushState).toHaveBeenCalledWith(7, '11', 'inactive')
  })
})

describe('client route platform passthrough', () => {
  beforeEach(() => {
    mockCreateClient.mockReset()
    mockCreateClient.mockResolvedValue(new Response(null, { status: 200 }))
  })

  test('POST /client forwards arbitrary platform strings to the handler verbatim', async () => {
    const response = await client.fetch(
      new Request('http://localhost/', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-gotify-key': 'client-token'
        },
        body: JSON.stringify({ name: 'Acme Phone', platform: 'acme-push' })
      }),
      {
        DB: {} as any
      } as any,
      {
        waitUntil: jest.fn(),
        passThroughOnException: jest.fn()
      } as any
    )

    expect(response.status).toBe(200)
    expect(mockCreateClient).toHaveBeenCalledWith(7, { name: 'Acme Phone', platform: 'acme-push' })
  })

  test('POST /client relays the handler 409 plugin-unavailable response unchanged', async () => {
    mockCreateClient.mockResolvedValue(
      new Response(JSON.stringify({
        error: 'Conflict',
        errorCode: 409,
        errorDescription: 'platform is not declared by any push plugin (plugin-unavailable)'
      }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      })
    )

    const response = await client.fetch(
      new Request('http://localhost/', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-gotify-key': 'client-token'
        },
        body: JSON.stringify({ name: 'Legacy Device', platform: 'legacy-vendor' })
      }),
      {
        DB: {} as any
      } as any,
      {
        waitUntil: jest.fn(),
        passThroughOnException: jest.fn()
      } as any
    )

    expect(response.status).toBe(409)
    const body = await response.json() as any
    expect(body.errorDescription).toContain('plugin-unavailable')
    expect(mockCreateClient).toHaveBeenCalledWith(7, { name: 'Legacy Device', platform: 'legacy-vendor' })
  })
})
