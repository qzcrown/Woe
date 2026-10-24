jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn()
}), { virtual: true })

import { PluginHandlers } from '../../src/handlers/pluginHandlers'

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
        name: 'Displayer Instance',
        token: 'P-token-1',
        modulePath: 'builtin/displayer',
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
    expect(body[0].capabilities).toEqual(['displayer'])
    expect(body[0].author).not.toBe('')
    expect(body[0].license).not.toBe('')
    expect(body[0].website).not.toBe('')
    expect(getConfigExampleSpy).toHaveBeenCalledWith('builtin/displayer')
    expect(body[0].configExample).toBe('runtime-config-example')
  })

  test('getAllPlugins resolves metadata by modulePath instead of instance name', async () => {
    const drizzle = createPluginListDrizzleMock([
      {
        id: 2,
        userId: 7,
        name: 'Renamed Plugin',
        token: 'P-token-2',
        modulePath: 'builtin/webhooker',
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
    expect(body[0].capabilities).toEqual(['webhooker', 'messenger'])
  })
})
