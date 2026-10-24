







jest.mock('../../src/utils/enhancedToken.ts', () => ({
  generateEnhancedToken: jest.fn(() => ({
    publicForm: 'C-public-form',
    privateForm: 'C.private.form'
  }))
}))

import { ClientHandlers } from '../../src/handlers/clientHandlers'


function createClientDrizzleMock(rows: Array<Record<string, unknown>>, getResult: unknown = rows[0]) {
  const getMock = jest.fn().mockResolvedValue(getResult)
  const orderByMock = jest.fn().mockResolvedValue(rows)
  const returningMock = jest.fn().mockImplementation(async () => rows.slice(0, 1))
  const drizzle = {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({ orderBy: orderByMock, get: getMock }))
      }))
    })),
    update: jest.fn(() => ({
      set: jest.fn(() => ({
        where: jest.fn(() => ({ returning: returningMock }))
      }))
    }))
  }
  return { drizzle, getMock, returningMock }
}

function clientRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    userId: 7,
    token: 'C-public-form',
    name: 'Pixel 9',
    platform: 'fixture_a',
    deviceUid: null,
    deviceToken: null,
    tokenUpdatedAt: null,
    tokenStatus: 'active',
    appVersion: null,
    deviceModel: null,
    lastUsed: null,
    elevatedUntil: null,
    expiresAfterInactivitySeconds: 0,
    expiresAt: null,
    createdAt: '2026-10-05 08:30:00',
    ...overrides
  }
}

describe('Client 序列化：过期 elevatedUntil 归一化为 null（gotify v3 GetClients 语义）', () => {
  test('GET /client 列表：过期提升 → elevatedUntil 为 null；未过期 → 原值；NULL → null', async () => {
    const expired = new Date(Date.now() - 60 * 1000).toISOString()
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const { drizzle } = createClientDrizzleMock([
      clientRow({ id: 1, elevatedUntil: expired }),
      clientRow({ id: 2, elevatedUntil: future }),
      clientRow({ id: 3, elevatedUntil: null })
    ])
    const handlers = new ClientHandlers(drizzle as any)

    const response = await handlers.getAllClients(7)
    const body = await response.json() as Array<Record<string, unknown>>

    expect(response.status).toBe(200)
    expect(body[0].elevatedUntil).toBeNull()
    expect(body[1].elevatedUntil).toBe(future)
    expect(body[2].elevatedUntil).toBeNull()

    expect('elevatedUntil' in body[0]).toBe(true)
  })

  test('GET /client/{id} 单查：过期提升 → null；未过期 → 原值', async () => {
    const expired = new Date(Date.now() - 60 * 1000).toISOString()
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()

    const expiredMock = createClientDrizzleMock([clientRow({ elevatedUntil: expired })])
    const expiredRes = await new ClientHandlers(expiredMock.drizzle as any).getClient(7, '11')
    const expiredBody = await expiredRes.json() as Record<string, unknown>
    expect(expiredRes.status).toBe(200)
    expect(expiredBody.elevatedUntil).toBeNull()

    const futureMock = createClientDrizzleMock([clientRow({ elevatedUntil: future })])
    const futureRes = await new ClientHandlers(futureMock.drizzle as any).getClient(7, '11')
    const futureBody = await futureRes.json() as Record<string, unknown>
    expect(futureRes.status).toBe(200)
    expect(futureBody.elevatedUntil).toBe(future)
  })

  test('写响应（PUT /client/{id} 返回行）：过期提升同样归一化为 null', async () => {
    const expired = new Date(Date.now() - 60 * 1000).toISOString()
    const { drizzle } = createClientDrizzleMock([clientRow({ elevatedUntil: expired })])
    const handlers = new ClientHandlers(drizzle as any)

    const response = await handlers.updateClient(7, '11', { name: 'Pixel 9 Pro' })
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body.elevatedUntil).toBeNull()
  })

  test('提升恰好到期（== now 边界）：视为过期 → null（V3 !now.Before 语义）', async () => {
    const justExpired = new Date(Date.now() - 1).toISOString()
    const { drizzle } = createClientDrizzleMock([clientRow({ elevatedUntil: justExpired })])
    const handlers = new ClientHandlers(drizzle as any)

    const response = await handlers.getAllClients(7)
    const body = await response.json() as Array<Record<string, unknown>>

    expect(body[0].elevatedUntil).toBeNull()
  })
})
