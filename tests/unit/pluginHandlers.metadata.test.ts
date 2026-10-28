jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn()
}), { virtual: true })

jest.mock('../../src/generated/plugins/catalog.ts', () => ({
  moduleDescriptors: [
    {
      modulePath: 'test/metadata-event',
      name: 'Metadata Event',
      capabilities: ['test-event'],
      author: 'fixture-author',
      license: 'fixture-license',
      website: 'https://example.invalid/event',
      secretFields: []
    },
    {
      modulePath: 'test/metadata-task',
      name: 'Metadata Task',
      capabilities: ['test-task', 'messenger'],
      author: 'fixture-author',
      license: 'fixture-license',
      website: 'https://example.invalid/task',
      secretFields: []
    }
  ]
}))

import { PluginHandlers } from '../../src/handlers/pluginHandlers'
import { register } from '../../src/plugins/registry'
import { registerPluginTask } from '../../src/plugins/jobs/registry'

const EVENT_MODULE = 'test/metadata-event'
const TASK_MODULE = 'test/metadata-task'
register(EVENT_MODULE, ({ id, name }) => ({
  id,
  name,
  capabilities: ['test-event'],
  configExample: 'event: true',
  init() {}
}))
registerPluginTask({
  modulePath: TASK_MODULE,
  supportedSubjectTypes: ['message'],
  createTask: async () => ({ run: async () => ({ ok: true as const }) })
})

function createPluginListDrizzleMock(pluginRows: Array<Record<string, unknown>>) {
  const orderByMock = jest.fn().mockResolvedValue(pluginRows)
  const whereMock = jest.fn().mockReturnValue({ orderBy: orderByMock })
  const fromMock = jest.fn().mockReturnValue({ where: whereMock })
  const selectMock = jest.fn().mockReturnValue({ from: fromMock })

  return {
    select: selectMock
  } as any
}

describe('PluginHandlers metadata', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('getAllPlugins includes metadata fields and runtime configExample', async () => {
    const drizzle = createPluginListDrizzleMock([
      {
        id: 1,
        userId: 7,
        name: 'Event Instance',
        token: 'P-token-1',
        modulePath: EVENT_MODULE,
        enabled: 1,
        icon: null,
        configYaml: ''
      }
    ])
    const handlers = new PluginHandlers(drizzle)
    const getConfigExampleSpy = jest
      .spyOn(handlers as any, 'getConfigExample')
      .mockResolvedValue('runtime-config-example')

    const response = await handlers.getAllPlugins(7, true)
    const body = await response.json() as Array<{
      capabilities: string[]
      author: string
      license: string
      website: string
      configExample: string
    }>

    expect(response.status).toBe(200)
    expect(body).toHaveLength(1)
    expect(body[0].capabilities).toEqual(['test-event'])
    expect(body[0].author).toBe('fixture-author')
    expect(body[0].license).toBe('fixture-license')
    expect(body[0].website).toBe('https://example.invalid/event')
    expect(getConfigExampleSpy).toHaveBeenCalledWith(EVENT_MODULE)
    expect(body[0].configExample).toBe('runtime-config-example')
  })

  test('getAllPlugins resolves metadata by modulePath instead of instance name', async () => {
    const drizzle = createPluginListDrizzleMock([
      {
        id: 2,
        userId: 7,
        name: 'Renamed Plugin',
        token: 'P-token-2',
        modulePath: TASK_MODULE,
        enabled: 1,
        icon: null,
        configYaml: ''
      }
    ])
    const handlers = new PluginHandlers(drizzle)

    const response = await handlers.getAllPlugins(7, true)
    const body = await response.json() as Array<{ capabilities: string[] }>

    expect(response.status).toBe(200)
    expect(body).toHaveLength(1)
    expect(body[0].capabilities).toEqual(['test-task', 'messenger'])
  })

  test('getAllPlugins marks ghost module unavailable and never calls configExample factory for it', async () => {
    const drizzle = createPluginListDrizzleMock([
      {
        id: 3,
        userId: 7,
        name: 'Ghost Instance',
        token: 'P-token-3',
        modulePath: 'test/ghost-module',
        enabled: 1,
        icon: null,
        configYaml: 'apiKey: sk-legacy\n'
      }
    ])
    const handlers = new PluginHandlers(drizzle)
    const configExampleSpy = jest
      .spyOn(handlers as any, 'getConfigExample')
      .mockResolvedValue('should-not-be-used')

    const response = await handlers.getAllPlugins(7, true)
    const body = await response.json() as Array<{
      modulePath: string
      availability: string
      configExample: string
    }>

    expect(response.status).toBe(200)
    expect(body).toHaveLength(1)

    expect(body[0]).toMatchObject({
      modulePath: 'test/ghost-module',
      availability: 'unavailable',
      configExample: ''
    })
    expect(configExampleSpy).not.toHaveBeenCalled()
  })
})
