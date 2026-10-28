jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn()
}), { virtual: true })

const mockHashPassword = jest.fn(async (pass: string) => `hashed:${pass}`)

jest.mock('../../src/middleware/auth.ts', () => ({
  hashPassword: mockHashPassword,
  randomTokenString: jest.fn((len: number) => 'r'.repeat(len)),
  TOKEN_RANDOM_LENGTH: 22
}))

import { ApplicationHandlers } from '../../src/handlers/applicationHandlers'
import { ClientHandlers } from '../../src/handlers/clientHandlers'
import { UserHandlers } from '../../src/handlers/userHandlers'
import { PluginHandlers } from '../../src/handlers/pluginHandlers'
import { register } from '../../src/plugins/registry'

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/


function createApplicationDrizzleMock(rows: Array<Record<string, unknown>>) {
  const orderByMock = jest.fn().mockResolvedValue(rows)
  const selectMock = jest.fn(() => ({
    from: jest.fn(() => ({
      where: jest.fn(() => ({ orderBy: orderByMock }))
    }))
  }))
  const returningMock = jest.fn().mockImplementation(async () => rows.slice(0, 1))
  const drizzle = {
    select: selectMock,
    insert: jest.fn(() => ({
      values: jest.fn(() => ({ returning: returningMock }))
    })),
    update: jest.fn(() => ({
      set: jest.fn(() => ({
        where: jest.fn(() => ({ returning: returningMock }))
      }))
    }))
  }
  return { drizzle, returningMock }
}


function createClientDrizzleMock(rows: Array<Record<string, unknown>>) {
  const getMock = jest.fn().mockResolvedValue(rows[0])
  const orderByMock = jest.fn().mockResolvedValue(rows)
  const returningMock = jest.fn().mockImplementation(async () => rows.slice(0, 1))
  const selectMock = jest.fn(() => ({
    from: jest.fn(() => ({
      where: jest.fn(() => ({ orderBy: orderByMock, get: getMock }))
    }))
  }))
  const drizzle = {
    select: selectMock,
    insert: jest.fn(() => ({
      values: jest.fn(() => ({ returning: returningMock }))
    })),
    update: jest.fn(() => ({
      set: jest.fn(() => ({
        where: jest.fn(() => ({ returning: returningMock }))
      }))
    }))
  }
  return { drizzle, getMock, returningMock }
}


function createUserDrizzleMock(rows: Array<Record<string, unknown>>, getResult: unknown = rows[0]) {
  const getMock = jest.fn().mockResolvedValue(getResult)
  const orderByMock = jest.fn().mockResolvedValue(rows)
  const returningMock = jest.fn().mockImplementation(async () => rows.slice(0, 1))
  const selectMock = jest.fn(() => ({
    from: jest.fn(() => ({
      where: jest.fn(() => ({ orderBy: orderByMock, get: getMock }))
    }))
  }))
  const drizzle = {
    select: selectMock,
    insert: jest.fn(() => ({
      values: jest.fn(() => ({ returning: returningMock }))
    })),
    update: jest.fn(() => ({
      set: jest.fn(() => ({
        where: jest.fn(() => ({ returning: returningMock }))
      }))
    }))
  }
  return { drizzle, getMock, returningMock }
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    name: 'alice',
    nickname: 'Alice',
    email: 'alice@example.com',
    avatar: null,
    description: null,
    admin: 0,
    disabled: 0,
    createdAt: '2026-10-05 08:30:00',
    ...overrides
  }
}

function applicationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 7,
    token: 'A-app-token',
    name: 'App A',
    sortKey: 'a',
    description: '',
    defaultPriority: 0,
    image: '',
    internal: false,
    lastUsed: null,
    createdAt: '2026-10-05 08:30:00',
    ...overrides
  }
}

function clientRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    userId: 7,
    token: 'C-client-token',
    name: 'Pixel 9',
    platform: 'huawei',
    deviceUid: null,
    deviceToken: null,
    tokenUpdatedAt: null,
    tokenStatus: 'active',
    appVersion: null,
    deviceModel: null,
    lastUsed: null,
    elevatedUntil: null,
    createdAt: '2026-10-05 08:30:00',
    ...overrides
  }
}

function pluginRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 3,
    userId: 7,
    name: 'Webhooker Instance',
    token: 'P-plugin-token',
    modulePath: 'builtin/webhooker',
    enabled: 1,
    icon: null,
    configYaml: '',
    createdAt: '2026-10-05 08:30:00',
    ...overrides
  }
}

describe('createdAt serialization ', () => {
  beforeAll(() => {

    register('builtin/webhooker', () => ({}) as any)
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('GET /application 响应包含 RFC3339 createdAt', async () => {
    const { drizzle } = createApplicationDrizzleMock([applicationRow()])
    const handlers = new ApplicationHandlers(drizzle as any)

    const response = await handlers.getAllApplications(7)
    const body = await response.json() as Array<Record<string, unknown>>

    expect(response.status).toBe(200)
    expect(body[0].createdAt).toBe('2026-10-05T08:30:00Z')
    expect(body[0].createdAt).toMatch(RFC3339)
  })

  test('GET /client 响应包含 createdAt', async () => {
    const { drizzle } = createClientDrizzleMock([clientRow()])
    const handlers = new ClientHandlers(drizzle as any)

    const response = await handlers.getAllClients(7)
    const body = await response.json() as Array<Record<string, unknown>>

    expect(response.status).toBe(200)
    expect(body[0].createdAt).toBe('2026-10-05T08:30:00Z')
    expect(body[0].createdAt).toMatch(RFC3339)
  })

  test('GET /current/user 与 GET /user 响应包含 createdAt', async () => {
    const { drizzle } = createUserDrizzleMock([userRow()])
    const handlers = new UserHandlers(drizzle as any)

    const currentResponse = await handlers.getCurrentUser(7)
    const currentBody = await currentResponse.json() as Record<string, unknown>
    expect(currentResponse.status).toBe(200)
    expect(currentBody.createdAt).toBe('2026-10-05T08:30:00Z')
    expect(currentBody.createdAt).toMatch(RFC3339)

    const userResponse = await handlers.getUser('7')
    const userBody = await userResponse.json() as Record<string, unknown>
    expect(userResponse.status).toBe(200)
    expect(userBody.createdAt).toBe('2026-10-05T08:30:00Z')
  })

  test('POST /user 与 PUT /user 响应包含 createdAt', async () => {

    const { drizzle } = createUserDrizzleMock([userRow()], null)
    const handlers = new UserHandlers(drizzle as any)

    const createResponse = await handlers.createUser('alice', 'secret')
    const createBody = await createResponse.json() as Record<string, unknown>
    expect(createResponse.status).toBe(200)
    expect(createBody.createdAt).toBe('2026-10-05T08:30:00Z')

    const updateResponse = await handlers.updateUser('7', { name: 'alice2' })
    const updateBody = await updateResponse.json() as Record<string, unknown>
    expect(updateResponse.status).toBe(200)
    expect(updateBody.createdAt).toBe('2026-10-05T08:30:00Z')
  })

  test('POST /application 与 PUT /application 响应包含 createdAt', async () => {
    const { drizzle } = createApplicationDrizzleMock([applicationRow()])
    const handlers = new ApplicationHandlers(drizzle as any)

    const createResponse = await handlers.createApplication(7, 'App A')
    const createBody = await createResponse.json() as Record<string, unknown>
    expect(createResponse.status).toBe(200)
    expect(createBody.createdAt).toBe('2026-10-05T08:30:00Z')

    const updateResponse = await handlers.updateApplication(7, '1', { name: 'App A2' })
    const updateBody = await updateResponse.json() as Record<string, unknown>
    expect(updateResponse.status).toBe(200)
    expect(updateBody.createdAt).toBe('2026-10-05T08:30:00Z')
  })

  test('POST /client 与 PUT /client 响应包含 createdAt', async () => {
    const { drizzle } = createClientDrizzleMock([clientRow()])
    const handlers = new ClientHandlers(drizzle as any)

    const createResponse = await handlers.createClient(7, 'Pixel 9')
    const createBody = await createResponse.json() as Record<string, unknown>
    expect(createResponse.status).toBe(200)
    expect(createBody.createdAt).toBe('2026-10-05T08:30:00Z')

    const updateResponse = await handlers.updateClient(7, '11', { name: 'Pixel 9 Pro' })
    const updateBody = await updateResponse.json() as Record<string, unknown>
    expect(updateResponse.status).toBe(200)
    expect(updateBody.createdAt).toBe('2026-10-05T08:30:00Z')
  })

  test('POST /plugin 与 GET /plugin 响应包含 createdAt', async () => {

    const { drizzle } = createUserDrizzleMock([pluginRow()], null)
    const handlers = new PluginHandlers(drizzle as any)

    const createResponse = await handlers.createPlugin(1, new Request('http://localhost/plugin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modulePath: 'builtin/webhooker', name: 'Webhooker Instance' })
    }))
    const createBody = await createResponse.json() as Record<string, unknown>
    expect(createResponse.status).toBe(200)
    expect(createBody.createdAt).toBe('2026-10-05T08:30:00Z')

    const listResponse = await handlers.getAllPlugins(7, true)
    const listBody = await listResponse.json() as Array<Record<string, unknown>>
    expect(listResponse.status).toBe(200)
    expect(listBody[0].createdAt).toBe('2026-10-05T08:30:00Z')
  })

  test('GET /user/:id/applications 模型字段完整且包含 createdAt', async () => {
    const { drizzle } = createUserDrizzleMock([applicationRow()])
    const handlers = new UserHandlers(drizzle as any)

    const response = await handlers.getUserApplications(7)
    const body = await response.json() as Array<Record<string, unknown>>

    expect(response.status).toBe(200)
    expect(body[0]).toEqual({
      id: 1,

      name: 'App A',
      description: '',
      internal: false,

      image: 'static/defaultapp.png',
      lastUsed: null,
      defaultPriority: 0,
      createdAt: '2026-10-05T08:30:00Z'
    })
  })

  test('GET /user/:id/clients 模型字段完整且包含 createdAt', async () => {
    const { drizzle } = createUserDrizzleMock([clientRow()])
    const handlers = new UserHandlers(drizzle as any)

    const response = await handlers.getUserClients(7)
    const body = await response.json() as Array<Record<string, unknown>>

    expect(response.status).toBe(200)
    expect(body[0]).toEqual({
      id: 11,

      token: '',
      name: 'Pixel 9',
      lastUsed: null,
      createdAt: '2026-10-05T08:30:00Z'
    })
  })

  test('createdAt 列为 NULL 的旧行序列化为 null 不报错', async () => {
    const users = createUserDrizzleMock([userRow({ createdAt: null })])
    const userHandlers = new UserHandlers(users.drizzle as any)
    const userResponse = await userHandlers.getUser('7')
    const userBody = await userResponse.json() as Record<string, unknown>
    expect(userResponse.status).toBe(200)
    expect(userBody.createdAt).toBeNull()


    const legacyUser: Record<string, unknown> = userRow()
    delete legacyUser.createdAt
    const legacyUsers = createUserDrizzleMock([legacyUser])
    const legacyUserHandlers = new UserHandlers(legacyUsers.drizzle as any)
    const legacyResponse = await legacyUserHandlers.getAllUsers()
    const legacyBody = await legacyResponse.json() as Array<Record<string, unknown>>
    expect(legacyResponse.status).toBe(200)
    expect(legacyBody[0].createdAt).toBeNull()

    const apps = createApplicationDrizzleMock([applicationRow({ createdAt: null })])
    const appHandlers = new ApplicationHandlers(apps.drizzle as any)
    const appResponse = await appHandlers.getAllApplications(7)
    const appBody = await appResponse.json() as Array<Record<string, unknown>>
    expect(appResponse.status).toBe(200)
    expect(appBody[0].createdAt).toBeNull()

    const clientsMock = createClientDrizzleMock([clientRow({ createdAt: null })])
    const clientHandlers = new ClientHandlers(clientsMock.drizzle as any)
    const clientResponse = await clientHandlers.getAllClients(7)
    const clientBody = await clientResponse.json() as Array<Record<string, unknown>>
    expect(clientResponse.status).toBe(200)
    expect(clientBody[0].createdAt).toBeNull()

    const plugins = createUserDrizzleMock([pluginRow({ createdAt: null })])
    const pluginHandlers = new PluginHandlers(plugins.drizzle as any)
    const pluginResponse = await pluginHandlers.getAllPlugins(7, true)
    const pluginBody = await pluginResponse.json() as Array<Record<string, unknown>>
    expect(pluginResponse.status).toBe(200)
    expect(pluginBody[0].createdAt).toBeNull()
  })
})
