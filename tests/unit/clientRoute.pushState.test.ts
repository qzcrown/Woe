const mockUpdatePushState = jest.fn().mockResolvedValue(
  new Response(JSON.stringify({
    id: 11,
    token: 'Ctoken',
    name: 'Pixel 9',
    platform: 'fixture_a',
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
    createClient: jest.fn(),
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
