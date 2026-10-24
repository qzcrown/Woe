













jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn()
}), { virtual: true })

import { fileTypeFromBuffer } from 'file-type'
import { ApplicationHandlers } from '../../src/handlers/applicationHandlers'
import { UserHandlers } from '../../src/handlers/userHandlers'
import { PluginHandlers } from '../../src/handlers/pluginHandlers'

const DEFAULT_APP_IMAGE = 'static/defaultapp.png'


function createHandlerDrizzle(options: {
  selectRows?: Array<Record<string, unknown>>
  selectRow?: Record<string, unknown> | null
  insertRows?: Array<Record<string, unknown>>
  updateRows?: Array<Record<string, unknown>>
} = {}) {
  const state = {
    updatePayloads: [] as Array<Record<string, unknown>>,
    insertPayload: null as Record<string, unknown> | null
  }
  const selectRows = options.selectRows ?? []
  const selectRow = options.selectRow === undefined ? selectRows[0] ?? null : options.selectRow

  const whereMock = jest.fn(() => ({
    orderBy: jest.fn().mockResolvedValue(selectRows),
    get: jest.fn().mockResolvedValue(selectRow)
  }))



  const updateWhereResult: any = Promise.resolve({ meta: { changes: 1 } })
  updateWhereResult.returning = jest.fn().mockResolvedValue(options.updateRows ?? [])

  const drizzle = {
    select: jest.fn(() => ({ from: jest.fn(() => ({ where: whereMock })) })),
    insert: jest.fn(() => ({
      values: jest.fn((payload: Record<string, unknown>) => {
        state.insertPayload = payload
        return { returning: jest.fn().mockResolvedValue(options.insertRows ?? []) }
      })
    })),
    update: jest.fn(() => ({
      set: jest.fn((payload: Record<string, unknown>) => {
        state.updatePayloads.push(payload)
        return { where: jest.fn(() => updateWhereResult) }
      })
    })),
    $client: {
      prepare: jest.fn(() => ({
        bind: () => ({ first: async () => null })
      }))
    }
  }
  return { drizzle, state }
}

function createImagesBinding() {
  const outputMock = jest.fn().mockImplementation(async (opts: ImageOutputOptions) => ({
    contentType: () => opts.format,
    image: () => new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([9, 9, 9]))
        controller.close()
      }
    })
  }))
  const inputMock = jest.fn().mockReturnValue({ output: outputMock })
  return { input: inputMock, info: jest.fn() } as unknown as ImagesBinding
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

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'user',
    nickname: 'user',
    email: 'u@example.test',
    avatar: null,
    description: null,
    admin: false,
    disabled: false,
    createdAt: '2026-10-05 08:30:00',
    ...overrides
  }
}

function pluginRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 7,
    name: 'Plugin A',
    token: 'P-plugin-token',
    modulePath: 'example/not-registered',
    enabled: 1,
    icon: null,
    configYaml: '',
    createdAt: '2026-10-05 08:30:00',
    ...overrides
  }
}


function pngRequest(url: string) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: new Uint8Array([137, 80, 78, 71, 1, 2, 3])
  })
}

beforeEach(() => {
  ;(fileTypeFromBuffer as jest.Mock).mockResolvedValue({ ext: 'png', mime: 'image/png' })
})

describe('应用响应媒体契约（applicationHandlers）', () => {
  test('GET /application 列表：旧/新/空/NULL image 全部规范化', async () => {
    const { drizzle } = createHandlerDrizzle({
      selectRows: [
        applicationRow({ id: 1, image: '/api/v1/image/app-images/1-1' }),
        applicationRow({ id: 2, image: 'image/app-images/2-2' }),
        applicationRow({ id: 3, image: '' }),
        applicationRow({ id: 4, image: null })
      ]
    })
    const handlers = new ApplicationHandlers(drizzle as any)

    const response = await handlers.getAllApplications(7)
    const body = await response.json() as Array<Record<string, unknown>>

    expect(response.status).toBe(200)
    expect(body.map(app => app.image)).toEqual([
      'image/app-images/1-1',
      'image/app-images/2-2',
      DEFAULT_APP_IMAGE,
      DEFAULT_APP_IMAGE
    ])

    expect(body.every(app => !('token' in app))).toBe(true)
  })

  test('GET /application/:id 详情：旧/新/空 image 规范化', async () => {
    const cases: Array<[string | null, string]> = [
      ['/api/v1/image/app-images/1-1', 'image/app-images/1-1'],
      ['image/app-images/2-2', 'image/app-images/2-2'],
      ['', DEFAULT_APP_IMAGE],
      [null, DEFAULT_APP_IMAGE]
    ]
    for (const [stored, expected] of cases) {
      const { drizzle } = createHandlerDrizzle({ selectRow: applicationRow({ image: stored }) })
      const handlers = new ApplicationHandlers(drizzle as any)

      const response = await handlers.getApplication(7, '1')
      const body = await response.json() as Record<string, unknown>

      expect(response.status).toBe(200)
      expect(body.image).toBe(expected)
    }
  })

  test('POST /application 创建：image 规范化（默认返回默认图路径）', async () => {
    const { drizzle, state } = createHandlerDrizzle({
      insertRows: [applicationRow({ image: null })]
    })
    const handlers = new ApplicationHandlers(drizzle as any)

    const response = await handlers.createApplication(7, 'App A')
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body.image).toBe(DEFAULT_APP_IMAGE)

    expect(state.insertPayload).toBeDefined()
    expect(state.insertPayload).not.toHaveProperty('image')
  })

  test('PUT /application/:id 更新：image 规范化', async () => {
    const { drizzle } = createHandlerDrizzle({
      updateRows: [applicationRow({ image: '/api/v1/image/app-images/1-1' })]
    })
    const handlers = new ApplicationHandlers(drizzle as any)

    const response = await handlers.updateApplication(7, '1', { name: 'New' })
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body.image).toBe('image/app-images/1-1')
  })

  test('POST /application/:id/image 上传：响应规范化，写库值与 R2 key 保持旧格式', async () => {
    const { drizzle, state } = createHandlerDrizzle({
      selectRow: { id: 1, userId: 7 },
      updateRows: [applicationRow({ image: '/api/v1/image/app-images/1-123' })]
    })
    const handlers = new ApplicationHandlers(drizzle as any)
    const putMock = jest.fn().mockResolvedValue({ etag: 'ok' })
    const deleteMock = jest.fn()

    const response = await handlers.uploadApplicationImage(
      7, '1', false,
      pngRequest('http://localhost/application/1/image'),
      { R2: { put: putMock, delete: deleteMock }, IMAGES: createImagesBinding() }
    )
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)

    expect(body.image).toMatch(/^image\/app-images\/1-\d+$/)

    const imageUpdate = state.updatePayloads.find(p => 'image' in p)
    expect(imageUpdate?.image).toMatch(/^\/api\/v1\/image\/app-images\/1-\d+$/)

    expect(putMock.mock.calls[0][0]).toMatch(/^app-images\/1-\d+$/)
  })
})

describe('用户响应媒体契约（userHandlers）', () => {
  test('GET /user 列表：avatar 旧/新规范化、空值保持 null', async () => {
    const { drizzle } = createHandlerDrizzle({
      selectRows: [
        userRow({ id: 1, avatar: '/api/v1/image/user-avatars/1-1' }),
        userRow({ id: 2, avatar: 'image/user-avatars/2-2' }),
        userRow({ id: 3, avatar: null })
      ]
    })
    const handlers = new UserHandlers(drizzle as any)

    const response = await handlers.getAllUsers()
    const body = await response.json() as Array<Record<string, unknown>>

    expect(response.status).toBe(200)
    expect(body.map(u => u.avatar)).toEqual([
      'image/user-avatars/1-1',
      'image/user-avatars/2-2',
      null
    ])
  })

  test('GET /user/:id 与 GET /current/user：avatar 规范化、空值保持 null', async () => {
    for (const [stored, expected] of [
      ['/api/v1/image/user-avatars/1-1', 'image/user-avatars/1-1'],
      [null, null]
    ] as Array<[string | null, string | null]>) {
      const { drizzle } = createHandlerDrizzle({ selectRow: userRow({ avatar: stored }) })
      const handlers = new UserHandlers(drizzle as any)

      const userRes = await handlers.getUser('1')
      const userBody = await userRes.json() as Record<string, unknown>
      expect(userBody.avatar).toBe(expected)

      const currentRes = await handlers.getCurrentUser(1)
      const currentBody = await currentRes.json() as Record<string, unknown>
      expect(currentBody.avatar).toBe(expected)
    }
  })

  test('GET /user/:id/applications：image 旧/新/空 规范化（含默认图 fallback）', async () => {
    const { drizzle } = createHandlerDrizzle({
      selectRows: [
        applicationRow({ id: 1, image: '/api/v1/image/app-images/1-1' }),
        applicationRow({ id: 2, image: 'image/app-images/2-2' }),
        applicationRow({ id: 3, image: null })
      ]
    })
    const handlers = new UserHandlers(drizzle as any)

    const response = await handlers.getUserApplications(7)
    const body = await response.json() as Array<Record<string, unknown>>

    expect(response.status).toBe(200)
    expect(body.map(app => app.image)).toEqual([
      'image/app-images/1-1',
      'image/app-images/2-2',
      DEFAULT_APP_IMAGE
    ])
  })

  test('GET /user/:id/plugins：icon 旧/新规范化、空值保持 null', async () => {
    const { drizzle } = createHandlerDrizzle({
      selectRows: [
        pluginRow({ id: 1, icon: '/api/v1/image/plugin-images/1-1' }),
        pluginRow({ id: 2, icon: 'image/plugin-images/2-2' }),
        pluginRow({ id: 3, icon: null })
      ]
    })
    const handlers = new UserHandlers(drizzle as any)

    const response = await handlers.getUserPlugins(7)
    const body = await response.json() as Array<Record<string, unknown>>

    expect(response.status).toBe(200)
    expect(body.map(p => p.icon)).toEqual([
      'image/plugin-images/1-1',
      'image/plugin-images/2-2',
      null
    ])
  })

  test('POST /user/:id/avatar 上传：响应规范化，写库值与 R2 key 保持旧格式', async () => {
    const { drizzle, state } = createHandlerDrizzle({
      selectRow: { id: 1 },
      updateRows: [userRow({ avatar: '/api/v1/image/user-avatars/1-123' })]
    })
    const handlers = new UserHandlers(drizzle as any)
    const putMock = jest.fn().mockResolvedValue({ etag: 'ok' })

    const response = await handlers.uploadUserAvatar(
      1, 1, true,
      pngRequest('http://localhost/user/1/avatar'),
      { R2: { put: putMock, delete: jest.fn() }, IMAGES: createImagesBinding() }
    )
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body.avatar).toMatch(/^image\/user-avatars\/1-\d+$/)

    const avatarUpdate = state.updatePayloads.find(p => 'avatar' in p)
    expect(avatarUpdate?.avatar).toMatch(/^\/api\/v1\/image\/user-avatars\/1-\d+$/)
    expect(putMock.mock.calls[0][0]).toMatch(/^user-avatars\/1-\d+$/)
  })
})

describe('插件响应媒体契约（pluginHandlers）', () => {
  test('GET /plugin 列表：icon 旧/新规范化、空值保持 null', async () => {
    const { drizzle } = createHandlerDrizzle({
      selectRows: [
        pluginRow({ id: 1, icon: '/api/v1/image/plugin-images/1-1' }),
        pluginRow({ id: 2, icon: 'image/plugin-images/2-2' }),
        pluginRow({ id: 3, icon: null })
      ]
    })
    const handlers = new PluginHandlers(drizzle as any)

    const response = await handlers.getAllPlugins(7, true)
    const body = await response.json() as Array<Record<string, unknown>>

    expect(response.status).toBe(200)
    expect(body.map(p => p.icon)).toEqual([
      'image/plugin-images/1-1',
      'image/plugin-images/2-2',
      null
    ])
  })

  test('POST /plugin/:id/image 图标上传：响应规范化，写库值/R2 key/旧 key 提取保持旧规则', async () => {
    const { drizzle, state } = createHandlerDrizzle({
      selectRow: pluginRow({ id: 1, icon: '/api/v1/image/plugin-images/9-1' })
    })
    const handlers = new PluginHandlers(drizzle as any)
    const putMock = jest.fn().mockResolvedValue({ etag: 'ok' })
    const deleteMock = jest.fn()

    const response = await handlers.uploadPluginIcon(
      7, '1',
      pngRequest('http://localhost/plugin/1/image'),
      { R2: { put: putMock, delete: deleteMock }, IMAGES: createImagesBinding() },
      true
    )
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body.icon).toMatch(/^image\/plugin-images\/1-\d+$/)

    const iconUpdate = state.updatePayloads.find(p => 'icon' in p)
    expect(iconUpdate?.icon).toMatch(/^\/api\/v1\/image\/plugin-images\/1-\d+$/)
    expect(putMock.mock.calls[0][0]).toMatch(/^plugin-images\/1-\d+$/)

    expect(deleteMock).toHaveBeenCalledWith('plugin-images/9-1')
  })
})
