







jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn()
}), { virtual: true })

jest.mock('../../src/generated/plugins/catalog.ts', () => ({
  moduleDescriptors: [
    {

      modulePath: 'test/catalog-push-only',
      name: 'Catalog Push Only',
      capabilities: ['test-push', 'messenger'],
      author: 'fixture-author',
      license: 'fixture-license',
      website: 'https://example.invalid/push-only',
      push: { platform: 'testos' },
      secretFields: []
    },
    {

      modulePath: 'test/catalog-frontend-only',
      name: 'Catalog Frontend Only',
      capabilities: ['test-frontend'],
      author: 'fixture-author',
      license: 'fixture-license',
      website: 'https://example.invalid/frontend-only',
      frontend: { locales: { 'en-US': 'locales/en-US.ts' } },
      secretFields: []
    }
  ]
}))

import { PluginHandlers } from '../../src/handlers/pluginHandlers'

const PUSH_ONLY_MODULE = 'test/catalog-push-only'
const FRONTEND_ONLY_MODULE = 'test/catalog-frontend-only'
const GHOST_MODULE = 'test/catalog-ghost'

function pluginRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 7,
    name: 'Instance',
    token: 'P-token',
    modulePath: PUSH_ONLY_MODULE,
    enabled: 1,
    icon: null,
    configYaml: '',
    ...overrides
  }
}


function createListDrizzleMock(rows: Array<Record<string, unknown>>) {
  return {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          orderBy: jest.fn().mockResolvedValue(rows)
        }))
      }))
    }))
  } as any
}


function createGetDrizzleMock(getResults: unknown[]) {
  const get = jest.fn()
  for (const result of getResults) get.mockResolvedValueOnce(result)
  return {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({ get }))
      }))
    })),
    __get: get
  } as any
}


function createInsertDrizzleMock() {
  return {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          get: jest.fn().mockResolvedValue(undefined)
        }))
      }))
    })),
    insert: jest.fn(() => ({
      values: jest.fn(() => ({
        returning: jest.fn().mockResolvedValue([
          { id: 9, createdAt: '2026-10-05T08:30:00Z' }
        ])
      }))
    }))
  } as any
}

describe('PluginHandlers catalog availability', () => {
  test('getAllPlugins marks push-only and frontend-only catalog modules available', async () => {
    const drizzle = createListDrizzleMock([
      pluginRow({ id: 1, name: 'Push Instance', modulePath: PUSH_ONLY_MODULE }),
      pluginRow({ id: 2, name: 'Frontend Instance', modulePath: FRONTEND_ONLY_MODULE })
    ])
    const handlers = new PluginHandlers(drizzle)
    const configExampleSpy = jest
      .spyOn(handlers as any, 'getConfigExample')
      .mockResolvedValue('catalog-config-example')

    const response = await handlers.getAllPlugins(7, true)
    const body = await response.json() as Array<{
      modulePath: string
      availability: string
      configExample: string
    }>

    expect(response.status).toBe(200)
    expect(body).toHaveLength(2)

    expect(body[0]).toMatchObject({
      modulePath: PUSH_ONLY_MODULE,
      availability: 'available'
    })
    expect(body[1]).toMatchObject({
      modulePath: FRONTEND_ONLY_MODULE,
      availability: 'available'
    })

    expect(configExampleSpy).toHaveBeenCalledWith(PUSH_ONLY_MODULE)
    expect(configExampleSpy).toHaveBeenCalledWith(FRONTEND_ONLY_MODULE)
    expect(body[0].configExample).toBe('catalog-config-example')
  })

  test('catalog 与注册表都不含的模块仍 unavailable（不放宽既有语义）', async () => {
    const drizzle = createListDrizzleMock([
      pluginRow({ id: 3, name: 'Ghost', modulePath: GHOST_MODULE })
    ])
    const handlers = new PluginHandlers(drizzle)

    const response = await handlers.getAllPlugins(7, true)
    const body = await response.json() as Array<{
      modulePath: string
      availability: string
      configExample: string
    }>

    expect(body[0]).toMatchObject({
      modulePath: GHOST_MODULE,
      availability: 'unavailable',
      configExample: ''
    })
  })

  test('getPluginConfig serves push-only catalog module instead of 409', async () => {
    const drizzle = createGetDrizzleMock([
      { modulePath: PUSH_ONLY_MODULE },
      { configYaml: 'platform: testos\n' }
    ])
    const handlers = new PluginHandlers(drizzle)

    const response = await handlers.getPluginConfig(7, '1', true)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('application/x-yaml')
    await expect(response.text()).resolves.toContain('platform: testos')
  })

  test('createPlugin accepts push-only catalog modulePath instead of 400', async () => {
    const drizzle = createInsertDrizzleMock()
    const handlers = new PluginHandlers(drizzle)

    const response = await handlers.createPlugin(1, new Request('http://localhost/plugin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        modulePath: PUSH_ONLY_MODULE,
        name: 'Push Only Instance'
      })
    }))
    const body = await response.json() as Record<string, unknown>


    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      modulePath: PUSH_ONLY_MODULE,
      name: 'Push Only Instance'
    })
  })

  test('createPlugin rejects modulePath outside catalog and registries', async () => {
    const drizzle = createInsertDrizzleMock()
    const handlers = new PluginHandlers(drizzle)

    const response = await handlers.createPlugin(1, new Request('http://localhost/plugin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modulePath: GHOST_MODULE, name: 'Ghost Instance' })
    }))

    expect(response.status).toBe(400)
    expect(drizzle.insert).not.toHaveBeenCalled()
  })
})
