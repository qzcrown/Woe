










jest.mock('file-type', () => ({ fileTypeFromBuffer: jest.fn() }), { virtual: true })

jest.mock('../../src/services/migrationRunner.ts', () => ({
  MigrationRunner: class {
    async runPendingMigrations(): Promise<void> {}
  }
}))






let mockQuotaModulePaths: readonly string[] | null = null
jest.mock('../../src/plugins/jobs/registry.ts', () => {
  const actual = jest.requireActual('../../src/plugins/jobs/registry.ts')
  return {
    ...actual,
    getQuotaNamespaces: () => ['route-quota'],
    getQuotaNamespaceModulePaths: (namespace: string) => {
      if (namespace !== 'route-quota') return []
      return mockQuotaModulePaths ?? ['test/quota-module']
    }
  }
})

import app from '../../src/app'
import { createPluginJobsTestDb } from '../helpers/pluginJobsTestDb'
import { makeD1Sqlite } from '../helpers/d1Sqlite'
import { makeExecutionCtxStub, type ExecutionCtxStub } from '../helpers/executionContext'
import { hashPasswordOnce } from '../helpers/passwordHash'
import { clients, pluginConfigs } from '../../src/models'
import { QuotaService } from '../../src/services/quota/quotaService'
import type { TestDb } from '../helpers/testDb'

const ADMIN_ID = 1
const USER_ID = 2
const ADMIN_CLIENT_TOKEN = 'Cadmin-token'
const USER_CLIENT_TOKEN = 'Cuser-token'
const QUOTA_TASK_PLUGIN_ID = 10
const DISABLED_QUOTA_TASK_PLUGIN_ID = 11
const OTHER_MODULE_PLUGIN_ID = 12
const QUOTA_MODULE = 'test/quota-module'

const VALID_CONFIG = 'model: route-model\n'

interface FixtureOptions {
  kv?: Record<string, string>
  kvReadFails?: boolean
  kvWriteFails?: boolean
}

interface Fixture {
  testDb: TestDb
  env: Record<string, unknown>
  executionCtx: ExecutionCtxStub
  kvStore: Map<string, string>
  kvGet: jest.Mock
  kvPut: jest.Mock
  kvDelete: jest.Mock
  request: (
    path: string,
    init?: Omit<RequestInit, 'body'> & { body?: unknown; token?: string; basic?: [string, string] }
  ) => Promise<Response>
}

async function makeFixture(options: FixtureOptions = {}): Promise<Fixture> {
  const testDb = createPluginJobsTestDb()
  testDb.sqlite.exec("ALTER TABLE `users` ADD COLUMN `pass` text NOT NULL DEFAULT ''")

  const adminPass = await hashPasswordOnce('admin-pass')
  const userPass = await hashPasswordOnce('user-pass')
  const insertUser = testDb.sqlite.prepare(
    'INSERT INTO users (id, name, pass, admin, disabled) VALUES (?, ?, ?, ?, ?)'
  )
  insertUser.run(ADMIN_ID, 'root', adminPass, 1, 0)
  insertUser.run(USER_ID, 'alice', userPass, 0, 0)

  testDb.db
    .insert(clients)
    .values([
      {
        id: 5,
        userId: ADMIN_ID,
        token: ADMIN_CLIENT_TOKEN,
        name: 'Admin Device',
        platform: 'web',
        deviceUid: 'device-admin',
        tokenStatus: 'active',
        lastUsed: new Date().toISOString(),

        elevatedUntil: null,
        expiresAfterInactivitySeconds: 0,
        expiresAt: null
      },
      {
        id: 6,
        userId: USER_ID,
        token: USER_CLIENT_TOKEN,
        name: 'User Device',
        platform: 'web',
        deviceUid: 'device-user',
        tokenStatus: 'active',
        lastUsed: new Date().toISOString(),
        elevatedUntil: null,
        expiresAfterInactivitySeconds: 0,
        expiresAt: null
      }
    ])
    .run()

  testDb.db
    .insert(pluginConfigs)
    .values([
      {
        id: QUOTA_TASK_PLUGIN_ID,
        userId: ADMIN_ID,
        name: 'Quota Task',
        token: 'plugin-token-10',
        modulePath: QUOTA_MODULE,
        configYaml: VALID_CONFIG,
        enabled: 1,

        encryptedSecret: 'super-secret-ciphertext',
        usageDay: '2020-01-01',
        usageCount: 3
      },
      {
        id: DISABLED_QUOTA_TASK_PLUGIN_ID,
        userId: ADMIN_ID,
        name: 'Disabled Quota Task',
        token: 'plugin-token-11',
        modulePath: QUOTA_MODULE,
        configYaml: VALID_CONFIG,
        enabled: 0,
        usageDay: null,
        usageCount: 9
      },
      {
        id: OTHER_MODULE_PLUGIN_ID,
        userId: USER_ID,
        name: 'Other Plugin',
        token: 'plugin-token-12',
        modulePath: 'other/plugin',
        configYaml: 'apiKey: plaintext-key\n',
        enabled: 1,
        usageDay: null,
        usageCount: 0
      }
    ])
    .run()

  testDb.sqlite
    .prepare("INSERT INTO system_state (key, value) VALUES ('route-quota_user_daily_limit', '42')")
    .run()

  const kvStore = new Map<string, string>(Object.entries(options.kv ?? {}))
  const kvGet = jest.fn(async (key: string) => {
    if (options.kvReadFails) throw new Error('kv read failed')
    return kvStore.get(key) ?? null
  })
  const kvPut = jest.fn(async (key: string, value: string) => {
    if (options.kvWriteFails) throw new Error('kv write failed')
    kvStore.set(key, value)
  })
  const kvDelete = jest.fn(async (key: string) => {
    if (options.kvWriteFails) throw new Error('kv delete failed')
    kvStore.delete(key)
  })

  const env: Record<string, unknown> = {
    DB: makeD1Sqlite(testDb),
    QUOTA_KV: { get: kvGet, put: kvPut, delete: kvDelete }
  }
  const executionCtx = makeExecutionCtxStub()

  const request: Fixture['request'] = async (path, init = {}) => {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) }
    if (init.token) headers['x-gotify-key'] = init.token
    if (init.basic) {
      headers.authorization = `Basic ${Buffer.from(`${init.basic[0]}:${init.basic[1]}`).toString('base64')}`
    }
    const requestInit: RequestInit = { method: init.method ?? 'GET', headers }
    if (init.body !== undefined) {
      headers['content-type'] = 'application/json'
      requestInit.body = JSON.stringify(init.body)
    }
    return await app.fetch(new Request(`http://localhost${path}`, requestInit), env, executionCtx)
  }

  return { testDb, env, executionCtx, kvStore, kvGet, kvPut, kvDelete, request }
}

async function readJson(response: Response): Promise<any> {
  return await response.json()
}


function seedExtraTagger(fx: Fixture, id: number, userId: number, token: string): void {
  fx.testDb.db
    .insert(pluginConfigs)
    .values({
      id,
      userId,
      name: `Quota Task ${id}`,
      token,
      modulePath: QUOTA_MODULE,
      configYaml: VALID_CONFIG,
      enabled: 1,
      usageDay: null,
      usageCount: 0
    })
    .run()
}

describe('admin quota authentication and namespace validation', () => {
  test('no credentials -> 401', async () => {
    const fx = await makeFixture()
    const response = await fx.request('/admin/quotas/route-quota/users')
    expect(response.status).toBe(401)
  })

  test('non-admin client token -> 403', async () => {
    const fx = await makeFixture()
    const response = await fx.request('/admin/quotas/route-quota/users', { token: USER_CLIENT_TOKEN })
    expect(response.status).toBe(403)
  })

  test('non-admin Basic -> 403', async () => {
    const fx = await makeFixture()
    const response = await fx.request('/admin/quotas/route-quota/users', { basic: ['alice', 'user-pass'] })
    expect(response.status).toBe(403)
  })

  test('admin client token without elevation is allowed', async () => {
    const fx = await makeFixture()
    const response = await fx.request('/admin/quotas/route-quota/users', { token: ADMIN_CLIENT_TOKEN })
    expect(response.status).toBe(200)
  })

  test('Basic admin is allowed', async () => {
    const fx = await makeFixture()
    const response = await fx.request('/admin/quotas/route-quota/users', { basic: ['root', 'admin-pass'] })
    expect(response.status).toBe(200)
  })

  test('root path and /api/v1 both respond', async () => {
    for (const path of ['/admin/quotas/route-quota/users', '/api/v1/admin/quotas/route-quota/users']) {
      const fx = await makeFixture()
      const response = await fx.request(path, { token: ADMIN_CLIENT_TOKEN })
      expect(response.status).toBe(200)
    }
  })

  test.each(['openai', 'Ai', 'AI'])('unsupported namespace %s -> 400', async (namespace) => {
    const fx = await makeFixture()
    const response = await fx.request(`/admin/quotas/${namespace}/users`, {
      token: ADMIN_CLIENT_TOKEN
    })
    expect(response.status).toBe(400)
  })
})

describe('GET /admin/quotas/:namespace/users', () => {
  test('lists only enabled quota-task instances with full typed fields', async () => {
    const fx = await makeFixture()
    const response = await fx.request('/admin/quotas/route-quota/users', { token: ADMIN_CLIENT_TOKEN })
    expect(response.status).toBe(200)

    const body = await readJson(response)
    expect(body.users).toHaveLength(1)
    const row = body.users[0]

    expect(row).toEqual({
      userId: ADMIN_ID,
      pluginId: QUOTA_TASK_PLUGIN_ID,
      defaultLimit: 42,
      overrideLimit: null,
      effectiveLimit: 42,
      usageDay: '2020-01-01',
      usageCount: 3,
      usageToday: 0,
      source: 'default'
    })
    expect(typeof row.userId).toBe('number')
    expect(typeof row.pluginId).toBe('number')
    expect(typeof row.defaultLimit).toBe('number')
    expect(typeof row.effectiveLimit).toBe('number')
    expect(typeof row.usageCount).toBe('number')
    expect(typeof row.usageToday).toBe('number')
  })

  test('override -> source=override and effectiveLimit=override', async () => {
    const fx = await makeFixture({ kv: { [`route-quota:limit:${ADMIN_ID}`]: '5' } })
    const response = await fx.request('/admin/quotas/route-quota/users', { token: ADMIN_CLIENT_TOKEN })
    const row = (await readJson(response)).users[0]

    expect(row.overrideLimit).toBe(5)
    expect(row.effectiveLimit).toBe(5)
    expect(row.source).toBe('override')
  })

  test('usageToday is usageCount on the current UTC day and 0 for older days', async () => {
    const fx = await makeFixture()
    const today = new Date().toISOString().slice(0, 10)
    fx.testDb.sqlite
      .prepare('UPDATE plugin_configs SET usage_day = ?, usage_count = 7 WHERE id = ?')
      .run(today, QUOTA_TASK_PLUGIN_ID)

    const response = await fx.request('/admin/quotas/route-quota/users', { token: ADMIN_CLIENT_TOKEN })
    const row = (await readJson(response)).users[0]

    expect(row.usageDay).toBe(today)
    expect(row.usageCount).toBe(7)
    expect(row.usageToday).toBe(7)
  })

  test('KV read failure -> 503 (no partial success)', async () => {
    const fx = await makeFixture({ kvReadFails: true })
    const response = await fx.request('/admin/quotas/route-quota/users', { token: ADMIN_CLIENT_TOKEN })

    expect(response.status).toBe(503)
  })

  test('system_state default limit is read once for N enabled instances', async () => {
    const fx = await makeFixture()
    seedExtraTagger(fx, 20, USER_ID, 'plugin-token-20')
    seedExtraTagger(fx, 21, USER_ID, 'plugin-token-21')


    const readDefaultLimit = jest.spyOn(QuotaService.prototype as any, 'readDefaultLimit')
    try {
      const response = await fx.request('/admin/quotas/route-quota/users', { token: ADMIN_CLIENT_TOKEN })
      expect(response.status).toBe(200)

      const body = await readJson(response)
      expect(body.users).toHaveLength(3)
      expect(body.users.map((row: any) => row.pluginId)).toEqual([
        QUOTA_TASK_PLUGIN_ID,
        20,
        21
      ])
      expect(readDefaultLimit).toHaveBeenCalledTimes(1)
    } finally {
      readDefaultLimit.mockRestore()
    }
  })

  test('one instance KV read failure fails the whole response with 503', async () => {
    const fx = await makeFixture()
    seedExtraTagger(fx, 20, USER_ID, 'plugin-token-20')


    fx.kvGet.mockImplementation(async (key: string) => {
      if (key === `route-quota:limit:${USER_ID}`) throw new Error('kv read failed for one row')
      return null
    })

    const response = await fx.request('/admin/quotas/route-quota/users', { token: ADMIN_CLIENT_TOKEN })

    expect(response.status).toBe(503)
    expect(await readJson(response)).toMatchObject({ errorCode: 503 })
  })

  test('response never leaks secrets, config or prompts', async () => {
    const fx = await makeFixture()
    const response = await fx.request('/admin/quotas/route-quota/users', { token: ADMIN_CLIENT_TOKEN })
    const serialized = JSON.stringify(await readJson(response))

    expect(serialized).not.toContain('super-secret-ciphertext')
    expect(serialized).not.toContain('plaintext-key')
    expect(serialized).not.toContain('apiKey')
    expect(serialized).not.toContain('config_yaml')
    expect(serialized).not.toContain('encrypted_secret')
    expect(serialized).not.toContain('provider')
  })
})

describe('PUT /admin/quotas/:namespace/:userId', () => {
  test('writes a positive override to QUOTA_KV and returns 200', async () => {
    const fx = await makeFixture()
    const response = await fx.request(`/admin/quotas/route-quota/${ADMIN_ID}`, {
      method: 'PUT',
      token: ADMIN_CLIENT_TOKEN,
      body: { limit: 500 }
    })

    expect(response.status).toBe(200)
    expect(await readJson(response)).toEqual({})
    expect(fx.kvPut).toHaveBeenCalledWith(`route-quota:limit:${ADMIN_ID}`, '500')
    expect(fx.kvStore.get(`route-quota:limit:${ADMIN_ID}`)).toBe('500')
  })

  test('limit 0 disables the user and shows up in GET', async () => {
    const fx = await makeFixture()
    const put = await fx.request(`/admin/quotas/route-quota/${ADMIN_ID}`, {
      method: 'PUT',
      token: ADMIN_CLIENT_TOKEN,
      body: { limit: 0 }
    })
    expect(put.status).toBe(200)
    expect(fx.kvStore.get(`route-quota:limit:${ADMIN_ID}`)).toBe('0')

    const get = await fx.request('/admin/quotas/route-quota/users', { token: ADMIN_CLIENT_TOKEN })
    const row = (await readJson(get)).users[0]
    expect(row.overrideLimit).toBe(0)
    expect(row.effectiveLimit).toBe(0)
    expect(row.source).toBe('override')
  })

  test('limit null clears the override and falls back to the default', async () => {
    const fx = await makeFixture({ kv: { [`route-quota:limit:${ADMIN_ID}`]: '5' } })
    const response = await fx.request(`/admin/quotas/route-quota/${ADMIN_ID}`, {
      method: 'PUT',
      token: ADMIN_CLIENT_TOKEN,
      body: { limit: null }
    })

    expect(response.status).toBe(200)
    expect(fx.kvDelete).toHaveBeenCalledWith(`route-quota:limit:${ADMIN_ID}`)
    expect(fx.kvStore.has(`route-quota:limit:${ADMIN_ID}`)).toBe(false)

    const get = await fx.request('/admin/quotas/route-quota/users', { token: ADMIN_CLIENT_TOKEN })
    const row = (await readJson(get)).users[0]
    expect(row.overrideLimit).toBeNull()
    expect(row.effectiveLimit).toBe(42)
    expect(row.source).toBe('default')
  })

  test.each([
    ['negative', { limit: -1 }],
    ['fraction', { limit: 1.5 }],
    ['string', { limit: '500' }],
    ['missing', {}]
  ])('invalid limit (%s) -> 400 and no write', async (_label, body) => {
    const fx = await makeFixture()
    const response = await fx.request(`/admin/quotas/route-quota/${ADMIN_ID}`, {
      method: 'PUT',
      token: ADMIN_CLIENT_TOKEN,
      body
    })

    expect(response.status).toBe(400)
    expect(fx.kvPut).not.toHaveBeenCalled()
  })

  test.each(['abc', '0', '-1'])('invalid userId %s -> 400', async (userId) => {
    const fx = await makeFixture()
    const response = await fx.request(`/admin/quotas/route-quota/${userId}`, {
      method: 'PUT',
      token: ADMIN_CLIENT_TOKEN,
      body: { limit: 5 }
    })

    expect(response.status).toBe(400)
    expect(fx.kvPut).not.toHaveBeenCalled()
  })

  test('unsupported namespace -> 400', async () => {
    const fx = await makeFixture()
    const response = await fx.request(`/admin/quotas/openai/${ADMIN_ID}`, {
      method: 'PUT',
      token: ADMIN_CLIENT_TOKEN,
      body: { limit: 5 }
    })

    expect(response.status).toBe(400)
    expect(fx.kvPut).not.toHaveBeenCalled()
  })

  test('non-admin -> 403; no credentials -> 401', async () => {
    const fx = await makeFixture()

    const forbidden = await fx.request(`/admin/quotas/route-quota/${ADMIN_ID}`, {
      method: 'PUT',
      token: USER_CLIENT_TOKEN,
      body: { limit: 5 }
    })
    expect(forbidden.status).toBe(403)

    const anonymous = await fx.request(`/admin/quotas/route-quota/${ADMIN_ID}`, {
      method: 'PUT',
      body: { limit: 5 }
    })
    expect(anonymous.status).toBe(401)
    expect(fx.kvPut).not.toHaveBeenCalled()
  })

  test('KV write failure -> 503 (put and delete)', async () => {
    const putFixture = await makeFixture({ kvWriteFails: true })
    const putResponse = await putFixture.request(`/admin/quotas/route-quota/${ADMIN_ID}`, {
      method: 'PUT',
      token: ADMIN_CLIENT_TOKEN,
      body: { limit: 5 }
    })
    expect(putResponse.status).toBe(503)

    const deleteFixture = await makeFixture({ kvWriteFails: true })
    const deleteResponse = await deleteFixture.request(`/admin/quotas/route-quota/${ADMIN_ID}`, {
      method: 'PUT',
      token: ADMIN_CLIENT_TOKEN,
      body: { limit: null }
    })
    expect(deleteResponse.status).toBe(503)
  })

  test('invalid JSON body -> 400', async () => {
    const fx = await makeFixture()
    const response = await app.fetch(
      new Request(`http://localhost/admin/quotas/route-quota/${ADMIN_ID}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-gotify-key': ADMIN_CLIENT_TOKEN
        },
        body: '{not-json'
      }),
      fx.env,
      fx.executionCtx
    )

    expect(response.status).toBe(400)
    expect(fx.kvPut).not.toHaveBeenCalled()
  })
})

describe('declared namespaces and multi-module discovery', () => {
  afterEach(() => {
    mockQuotaModulePaths = null
  })

  test('namespace with zero declaring modules -> 400 for both GET and PUT', async () => {
    const fx = await makeFixture()

    const get = await fx.request('/admin/quotas/vision/users', { token: ADMIN_CLIENT_TOKEN })
    expect(get.status).toBe(400)

    const put = await fx.request(`/admin/quotas/vision/${ADMIN_ID}`, {
      method: 'PUT',
      token: ADMIN_CLIENT_TOKEN,
      body: { limit: 5 }
    })
    expect(put.status).toBe(400)
    expect(fx.kvPut).not.toHaveBeenCalled()
  })

  test('declared namespace without enabled instances -> 200 {users: []}', async () => {
    const fx = await makeFixture()
    fx.testDb.sqlite
      .prepare('UPDATE plugin_configs SET enabled = 0 WHERE id = ?')
      .run(QUOTA_TASK_PLUGIN_ID)

    const response = await fx.request('/admin/quotas/route-quota/users', { token: ADMIN_CLIENT_TOKEN })
    expect(response.status).toBe(200)
    expect(await readJson(response)).toEqual({ users: [] })
  })

  test('modules sharing one namespace are all discovered via inArray', async () => {
    const fx = await makeFixture()
    const SHARED_MODULE_PLUGIN_ID = 30
    fx.testDb.db
      .insert(pluginConfigs)
      .values({
        id: SHARED_MODULE_PLUGIN_ID,
        userId: USER_ID,
        name: 'Shared Namespace Plugin',
        token: 'plugin-token-30',
        modulePath: 'test/shared-ai',
        configYaml: VALID_CONFIG,
        enabled: 1,
        usageDay: null,
        usageCount: 4
      })
      .run()
    mockQuotaModulePaths = [QUOTA_MODULE, 'test/shared-ai']

    const response = await fx.request('/admin/quotas/route-quota/users', { token: ADMIN_CLIENT_TOKEN })
    expect(response.status).toBe(200)

    const body = await readJson(response)
    expect(body.users).toHaveLength(2)
    expect(body.users.map((row: any) => row.pluginId)).toEqual([
      QUOTA_TASK_PLUGIN_ID,
      SHARED_MODULE_PLUGIN_ID
    ])
  })
})
