















jest.mock('file-type', () => ({ fileTypeFromBuffer: jest.fn() }), { virtual: true })

jest.mock('../../src/services/migrationRunner.ts', () => ({
  MigrationRunner: class {
    async runPendingMigrations(): Promise<void> {}
  }
}))

jest.mock('../../src/plugins/jobs/registry.ts', () => {
  const actual = jest.requireActual('../../src/plugins/jobs/registry.ts')
  return {
    ...actual,
    getQuotaNamespaces: () => ['route-quota'],
    getQuotaNamespaceModulePaths: (namespace: string) =>
      namespace === 'route-quota' ? ['test/route-jobs'] : []
  }
})

import app from '../../src/app'
import { createDrizzle } from '../../src/drizzle/index'
import { registerPluginTask } from '../../src/plugins/jobs/registry'
import { createPluginJobsTestDb } from '../helpers/pluginJobsTestDb'
import { jobErrorMessage } from '../../src/services/pluginJobs/pluginJobLog'
import { makeD1Sqlite } from '../helpers/d1Sqlite'
import { makeExecutionCtxStub, type ExecutionCtxStub } from '../helpers/executionContext'
import { hashPasswordOnce } from '../helpers/passwordHash'
import { applications, clients, messages, pluginConfigs, userPluginPermissions } from '../../src/models'
import type { TestDb } from '../helpers/testDb'

const ROUTE_MODULE = 'test/route-jobs'
const VALID_CONFIG = 'provider: route\nmodel: "route-model"\n'
const INVALID_CONFIG = 'provider: route\nmodel: "invalid"\n'

const OWNER_ID = 1
const OTHER_ID = 2
const ADMIN_ID = 9
const OWNER_CLIENT_TOKEN = 'Cowner-token'
const OTHER_CLIENT_TOKEN = 'Cother-token'
const OWNER_APP_TOKEN = 'Aowner-app-token'
const PLUGIN_ID = 10

registerPluginTask({
  modulePath: ROUTE_MODULE,
  supportedSubjectTypes: ['message'],
  quotaNamespace: 'route-quota',
  secretFields: ['apiKey'],
  async validateConfig({ config, host }) {
    if ((config as { model?: string } | null)?.model !== 'route-model') {
      return { errorCode: 'config' as const }
    }
    if ((config as { provider?: string }).provider === 'secret-required') {
      const hasSecret = await host.secrets.has('apiKey')
      if (!hasSecret) return { errorCode: 'secret-config' as const }
    }
  },
  async createTask() {
    throw new Error('route tests must not execute tasks')
  }
})


const NO_MESSAGE_MODULE = 'test/no-message-subject'
registerPluginTask({
  modulePath: NO_MESSAGE_MODULE,
  supportedSubjectTypes: ['application'],
  async createTask() {
    throw new Error('route tests must not execute tasks')
  }
})


const EVENT_ONLY_MODULE = 'test/event-only-task'
registerPluginTask({
  modulePath: EVENT_ONLY_MODULE,
  supportedSubjectTypes: ['message'],
  manualTrigger: false,
  async createTask() {
    throw new Error('route tests must not execute tasks')
  }
})


const OUTBOUND_BLOCKED_MODULE = 'test/outbound-blocked-prepare'
registerPluginTask({
  modulePath: OUTBOUND_BLOCKED_MODULE,
  supportedSubjectTypes: ['message'],
  async prepareJob() {
    return { error: { errorCode: 'outbound-blocked' as const } }
  },
  async createTask() {
    throw new Error('route tests must not execute tasks')
  }
})


const EVENT_ONLY_PLUGIN_ID = 15

const OUTBOUND_BLOCKED_PLUGIN_ID = 16

interface FixtureOptions {

  kv?: Record<string, string>

  kvReadFails?: boolean

  queueFails?: boolean
}

interface Fixture {
  testDb: TestDb
  env: Record<string, unknown>
  executionCtx: ExecutionCtxStub
  kvStore: Map<string, string>
  kvGet: jest.Mock
  kvPut: jest.Mock
  kvDelete: jest.Mock
  queueSend: jest.Mock
  request: (
    path: string,
    init?: Omit<RequestInit, 'body'> & { body?: unknown; token?: string; basic?: [string, string] }
  ) => Promise<Response>
}

async function makeFixture(options: FixtureOptions = {}): Promise<Fixture> {
  const testDb = createPluginJobsTestDb()

  testDb.sqlite.exec("ALTER TABLE `users` ADD COLUMN `pass` text NOT NULL DEFAULT ''")

  const ownerPass = await hashPasswordOnce('owner-pass')
  const otherPass = await hashPasswordOnce('other-pass')
  const adminPass = await hashPasswordOnce('admin-pass')
  const insertUser = testDb.sqlite.prepare(
    'INSERT INTO users (id, name, pass, admin, disabled) VALUES (?, ?, ?, ?, ?)'
  )
  insertUser.run(OWNER_ID, 'alice', ownerPass, 0, 0)
  insertUser.run(OTHER_ID, 'bob', otherPass, 0, 0)
  insertUser.run(ADMIN_ID, 'root', adminPass, 1, 0)

  testDb.db
    .insert(applications)
    .values([
      { id: 1, userId: OWNER_ID, token: OWNER_APP_TOKEN, name: 'Owner App' },
      { id: 2, userId: OTHER_ID, token: 'Aother-app-token', name: 'Other App' }
    ])
    .run()


  testDb.db
    .insert(clients)
    .values([
      {
        id: 5,
        userId: OWNER_ID,
        token: OWNER_CLIENT_TOKEN,
        name: 'Owner Device',
        platform: 'web',
        deviceUid: 'device-owner',
        tokenStatus: 'active',
        lastUsed: new Date().toISOString(),
        elevatedUntil: null,
        expiresAfterInactivitySeconds: 0,
        expiresAt: null
      },
      {
        id: 6,
        userId: OTHER_ID,
        token: OTHER_CLIENT_TOKEN,
        name: 'Other Device',
        platform: 'web',
        deviceUid: 'device-other',
        tokenStatus: 'active',
        lastUsed: new Date().toISOString(),
        elevatedUntil: null,
        expiresAfterInactivitySeconds: 0,
        expiresAt: null
      }
    ])
    .run()

  testDb.db
    .insert(messages)
    .values([
      { id: 1, userid: OWNER_ID, appid: 1, message: 'owner message' },
      { id: 2, userid: OTHER_ID, appid: 2, message: 'other message' }
    ])
    .run()

  testDb.db
    .insert(pluginConfigs)
    .values([
      {
        id: PLUGIN_ID,
        userId: OWNER_ID,
        name: 'Example Task',
        token: 'plugin-token-10',
        modulePath: ROUTE_MODULE,
        configYaml: VALID_CONFIG,
        enabled: 1
      },
      {
        id: 11,
        userId: OTHER_ID,
        name: 'Other Example Task',
        token: 'plugin-token-11',
        modulePath: ROUTE_MODULE,
        configYaml: VALID_CONFIG,
        enabled: 1
      },
      {
        id: 12,
        userId: OWNER_ID,
        name: 'Disabled Example Task',
        token: 'plugin-token-12',
        modulePath: ROUTE_MODULE,
        configYaml: VALID_CONFIG,
        enabled: 0
      },
      {
        id: 13,
        userId: OWNER_ID,
        name: 'Application Only',
        token: 'plugin-token-13',
        modulePath: NO_MESSAGE_MODULE,
        configYaml: null,
        enabled: 1
      },
      {
        id: 14,
        userId: OWNER_ID,
        name: 'Broken Config',
        token: 'plugin-token-14',
        modulePath: ROUTE_MODULE,
        configYaml: INVALID_CONFIG,
        enabled: 1
      },
      {
        id: EVENT_ONLY_PLUGIN_ID,
        userId: OWNER_ID,
        name: 'Event Only Task',
        token: 'plugin-token-15',
        modulePath: EVENT_ONLY_MODULE,
        configYaml: null,
        enabled: 1
      },
      {
        id: OUTBOUND_BLOCKED_PLUGIN_ID,
        userId: OWNER_ID,
        name: 'Outbound Blocked Prepare',
        token: 'plugin-token-16',
        modulePath: OUTBOUND_BLOCKED_MODULE,
        configYaml: null,
        enabled: 1
      }
    ])
    .run()



  testDb.db
    .insert(userPluginPermissions)
    .values([
      { userId: OWNER_ID, modulePath: ROUTE_MODULE },
      { userId: OWNER_ID, modulePath: NO_MESSAGE_MODULE },
      { userId: OWNER_ID, modulePath: EVENT_ONLY_MODULE },
      { userId: OWNER_ID, modulePath: OUTBOUND_BLOCKED_MODULE }
    ])
    .run()

  const kvStore = new Map<string, string>(Object.entries(options.kv ?? {}))
  const kvGet = jest.fn(async (key: string) => {
    if (options.kvReadFails) throw new Error('kv read failed')
    return kvStore.get(key) ?? null
  })
  const kvPut = jest.fn(async (key: string, value: string) => {
    kvStore.set(key, value)
  })
  const kvDelete = jest.fn(async (key: string) => {
    kvStore.delete(key)
  })
  const queueSend = jest.fn(async () => {
    if (options.queueFails) throw new Error('queue send failed')
    return undefined
  })

  const env: Record<string, unknown> = {
    DB: makeD1Sqlite(testDb),
    QUOTA_KV: { get: kvGet, put: kvPut, delete: kvDelete },
    PLUGIN_JOB_QUEUE: { send: queueSend }
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

  return { testDb, env, executionCtx, kvStore, kvGet, kvPut, kvDelete, queueSend, request }
}

async function readJson(response: Response): Promise<any> {
  return await response.json()
}

interface SeedJobOverrides {
  userId?: number
  pluginId?: number
  subjectId?: number
  status?: string
  result?: string | null
  lastErrorCode?: string | null
  lastErrorMessage?: string | null
  createdAt?: string
  completedAt?: string | null
}


function seedJob(testDb: TestDb, overrides: SeedJobOverrides = {}): number {
  const row = {
    user_id: overrides.userId ?? OWNER_ID,
    plugin_id: overrides.pluginId ?? PLUGIN_ID,
    subject_type: 'message',
    subject_id: overrides.subjectId ?? 1,
    payload: JSON.stringify({ prompt: 'secret-prompt-text' }),
    status: overrides.status ?? 'success',
    result: overrides.result === undefined ? JSON.stringify({ tags: ['告警'] }) : overrides.result,
    last_error_code: overrides.lastErrorCode ?? null,
    last_error_message: overrides.lastErrorMessage ?? null,
    created_at: overrides.createdAt ?? '2026-10-01 00:00:00',
    updated_at: overrides.createdAt ?? '2026-10-01 00:00:00',
    completed_at: overrides.completedAt === undefined ? '2026-10-01 00:00:01' : overrides.completedAt
  }
  const columns = Object.keys(row)
  const placeholders = columns.map(() => '?').join(',')
  const info = testDb.sqlite
    .prepare(`INSERT INTO plugin_jobs (${columns.join(',')}) VALUES (${placeholders})`)
    .run(...Object.values(row))
  return Number(info.lastInsertRowid)
}

function jobCount(testDb: TestDb): number {
  return (testDb.sqlite.prepare('SELECT COUNT(*) AS c FROM plugin_jobs').get() as { c: number }).c
}

function enqueueRejectedCount(testDb: TestDb): number {
  return (
    testDb.sqlite
      .prepare("SELECT COUNT(*) AS c FROM plugin_logs WHERE event = 'plugin_job.enqueue_rejected'")
      .get() as { c: number }
  ).c
}


function enqueueRejectedCodes(testDb: TestDb): string[] {
  const rows = testDb.sqlite
    .prepare("SELECT error FROM plugin_logs WHERE event = 'plugin_job.enqueue_rejected' ORDER BY id")
    .all() as { error: string | null }[]
  return rows.map((row) => row.error ?? '')
}

describe('POST /message/:id/jobs mount and auth matrix', () => {
  test('root path and /api/v1 both enqueue (client token)', async () => {
    for (const prefix of ['/message/1/jobs', '/api/v1/message/1/jobs']) {
      const fx = await makeFixture()
      const response = await fx.request(prefix, {
        method: 'POST',
        token: OWNER_CLIENT_TOKEN,
        body: { pluginId: PLUGIN_ID }
      })

      expect(response.status).toBe(202)
      const body = await readJson(response)
      expect(body.status).toBe('pending')
      expect(typeof body.jobId).toBe('number')
      expect(Object.keys(body).sort()).toEqual(['jobId', 'status'])
    }
  })

  test('no credentials -> 401 and no job', async () => {
    const fx = await makeFixture()
    const response = await fx.request('/message/1/jobs', {
      method: 'POST',
      body: { pluginId: PLUGIN_ID }
    })

    expect(response.status).toBe(401)
    expect(jobCount(fx.testDb)).toBe(0)
  })

  test('application token is rejected with 401', async () => {
    const fx = await makeFixture()
    const response = await fx.request('/message/1/jobs', {
      method: 'POST',
      token: OWNER_APP_TOKEN,
      body: { pluginId: PLUGIN_ID }
    })

    expect(response.status).toBe(401)
    expect(jobCount(fx.testDb)).toBe(0)
  })

  test('Basic auth is accepted', async () => {
    const fx = await makeFixture()
    const response = await fx.request('/message/1/jobs', {
      method: 'POST',
      basic: ['alice', 'owner-pass'],
      body: { pluginId: PLUGIN_ID }
    })

    expect(response.status).toBe(202)
    expect(jobCount(fx.testDb)).toBe(1)
  })

  test.each(['abc', '0', '-1'])('invalid message id %s -> 400', async (id) => {
    const fx = await makeFixture()
    const response = await fx.request(`/message/${id}/jobs`, {
      method: 'POST',
      token: OWNER_CLIENT_TOKEN,
      body: { pluginId: PLUGIN_ID }
    })

    expect(response.status).toBe(400)
    expect(jobCount(fx.testDb)).toBe(0)
  })

  test.each([
    ['missing', {}],
    ['string', { pluginId: '10' }],
    ['zero', { pluginId: 0 }],
    ['negative', { pluginId: -1 }],
    ['fraction', { pluginId: 1.5 }]
  ])('invalid pluginId (%s) -> 400', async (_label, body) => {
    const fx = await makeFixture()
    const response = await fx.request('/message/1/jobs', {
      method: 'POST',
      token: OWNER_CLIENT_TOKEN,
      body
    })

    expect(response.status).toBe(400)
    expect(jobCount(fx.testDb)).toBe(0)
  })
})

describe('POST /message/:id/jobs validation mapping', () => {
  test('message not found -> 404', async () => {
    const fx = await makeFixture()
    const response = await fx.request('/message/999/jobs', {
      method: 'POST',
      token: OWNER_CLIENT_TOKEN,
      body: { pluginId: PLUGIN_ID }
    })

    expect(response.status).toBe(404)
    expect(jobCount(fx.testDb)).toBe(0)
  })

  test('message owned by another user -> 404', async () => {
    const fx = await makeFixture()
    const response = await fx.request('/message/2/jobs', {
      method: 'POST',
      token: OWNER_CLIENT_TOKEN,
      body: { pluginId: PLUGIN_ID }
    })

    expect(response.status).toBe(404)
    expect(jobCount(fx.testDb)).toBe(0)
  })

  test('plugin not found or not owned -> 404', async () => {
    const fx = await makeFixture()

    const missing = await fx.request('/message/1/jobs', {
      method: 'POST',
      token: OWNER_CLIENT_TOKEN,
      body: { pluginId: 999 }
    })
    expect(missing.status).toBe(404)

    const notOwned = await fx.request('/message/1/jobs', {
      method: 'POST',
      token: OWNER_CLIENT_TOKEN,
      body: { pluginId: 11 }
    })
    expect(notOwned.status).toBe(404)
    expect(jobCount(fx.testDb)).toBe(0)
  })

  test('disabled plugin -> 409', async () => {
    const fx = await makeFixture()
    const response = await fx.request('/message/1/jobs', {
      method: 'POST',
      token: OWNER_CLIENT_TOKEN,
      body: { pluginId: 12 }
    })

    expect(response.status).toBe(409)
    expect(jobCount(fx.testDb)).toBe(0)
  })

  test('plugin without message subject support -> 409', async () => {
    const fx = await makeFixture()
    const response = await fx.request('/message/1/jobs', {
      method: 'POST',
      token: OWNER_CLIENT_TOKEN,
      body: { pluginId: 13 }
    })

    expect(response.status).toBe(409)
    expect(jobCount(fx.testDb)).toBe(0)
  })

  test('invalid plugin config -> 409', async () => {
    const fx = await makeFixture()
    const response = await fx.request('/message/1/jobs', {
      method: 'POST',
      token: OWNER_CLIENT_TOKEN,
      body: { pluginId: 14 }
    })

    expect(response.status).toBe(409)
    expect(jobCount(fx.testDb)).toBe(0)
  })

  test('manualTrigger=false 的插件：POST 一律 409，存在 pending job 也不返回 202', async () => {
    const fx = await makeFixture()

    seedJob(fx.testDb, {
      pluginId: EVENT_ONLY_PLUGIN_ID,
      status: 'pending',
      result: null,
      completedAt: null
    })

    const response = await fx.request('/message/1/jobs', {
      method: 'POST',
      token: OWNER_CLIENT_TOKEN,
      body: { pluginId: EVENT_ONLY_PLUGIN_ID }
    })

    expect(response.status).toBe(409)
    expect((await readJson(response)).errorDescription).toBe(
      'Plugin is not available for message jobs'
    )

    expect(jobCount(fx.testDb)).toBe(1)
    expect(fx.queueSend).not.toHaveBeenCalled()
    expect(enqueueRejectedCodes(fx.testDb)).toEqual(['plugin-unavailable'])
  })

  test('prepareJob 被 outbound-blocked 拒绝 -> 409 且固定文案为出站专用', async () => {
    const fx = await makeFixture()
    const response = await fx.request('/message/1/jobs', {
      method: 'POST',
      token: OWNER_CLIENT_TOKEN,
      body: { pluginId: OUTBOUND_BLOCKED_PLUGIN_ID }
    })

    expect(response.status).toBe(409)
    const body = await readJson(response)
    expect(body.errorCode).toBe(409)
    expect(body.errorDescription).toBe('Plugin outbound target is not allowed')
    expect(jobCount(fx.testDb)).toBe(0)
    expect(fx.queueSend).not.toHaveBeenCalled()
    expect(enqueueRejectedCodes(fx.testDb)).toEqual(['outbound-blocked'])
  })

  test('quota exceeded -> 429', async () => {
    const fx = await makeFixture({ kv: { 'route-quota:limit:1': '0' } })
    const response = await fx.request('/message/1/jobs', {
      method: 'POST',
      token: OWNER_CLIENT_TOKEN,
      body: { pluginId: PLUGIN_ID }
    })

    expect(response.status).toBe(429)
    expect(jobCount(fx.testDb)).toBe(0)
    expect(enqueueRejectedCount(fx.testDb)).toBe(1)
  })

  test('quota read failure -> 503', async () => {
    const fx = await makeFixture({ kvReadFails: true })
    const response = await fx.request('/message/1/jobs', {
      method: 'POST',
      token: OWNER_CLIENT_TOKEN,
      body: { pluginId: PLUGIN_ID }
    })

    expect(response.status).toBe(503)
    expect(jobCount(fx.testDb)).toBe(0)
  })

  test('message owned by another user + disabled plugin -> 404 (message ownership first)', async () => {
    const fx = await makeFixture()

    const response = await fx.request('/message/2/jobs', {
      method: 'POST',
      token: OWNER_CLIENT_TOKEN,
      body: { pluginId: 12 }
    })

    expect(response.status).toBe(404)
    expect(jobCount(fx.testDb)).toBe(0)
  })

  test('concurrent unique conflict wrapped by drizzle -> 202 with the existing job', async () => {
    const fx = await makeFixture()


    const wrapped = Object.assign(
      new Error(
        'Failed query: insert into "plugin_jobs" ("user_id", "plugin_id", "subject_type", "subject_id", "status", "payload") values (?, ?, ?, ?, ?, ?) params: 1,10,message,1,pending,'
      ),
      {
        cause: Object.assign(
          new Error(
            'UNIQUE constraint failed: plugin_jobs.plugin_id, plugin_jobs.subject_type, plugin_jobs.subject_id'
          ),
          { code: 'SQLITE_CONSTRAINT_UNIQUE' }
        )
      }
    )



    const probe = createDrizzle(fx.env.DB as never)
    const proto = Object.getPrototypeOf(probe) as { insert: (...args: any[]) => any }
    const realInsert = proto.insert
    let existingJobId: number | undefined
    const insertSpy = jest.spyOn(proto, 'insert')
    insertSpy.mockImplementation(function (this: unknown, table: any, ...rest: any[]) {
      if (table?.[Symbol.for('drizzle:Name')] === 'plugin_jobs') {
        const info = fx.testDb.sqlite
          .prepare(
            `INSERT INTO plugin_jobs (user_id, plugin_id, subject_type, subject_id, status)
             VALUES (?, ?, ?, ?, 'pending')`
          )
          .run(OWNER_ID, PLUGIN_ID, 'message', 1)
        existingJobId = Number(info.lastInsertRowid)
        return { values: () => ({ returning: () => Promise.reject(wrapped) }) }
      }
      return realInsert.call(this, table, ...rest)
    })

    try {
      const response = await fx.request('/message/1/jobs', {
        method: 'POST',
        token: OWNER_CLIENT_TOKEN,
        body: { pluginId: PLUGIN_ID }
      })

      expect(insertSpy).toHaveBeenCalledTimes(1)
      expect(response.status).toBe(202)
      expect(await readJson(response)).toEqual({ jobId: existingJobId, status: 'pending' })

      expect(jobCount(fx.testDb)).toBe(1)
    } finally {
      insertSpy.mockRestore()
    }
  })

  test('queue send failure -> 503 and the job is terminal failed', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const fx = await makeFixture({ queueFails: true })
    const response = await fx.request('/message/1/jobs', {
      method: 'POST',
      token: OWNER_CLIENT_TOKEN,
      body: { pluginId: PLUGIN_ID }
    })

    expect(response.status).toBe(503)
    expect(jobCount(fx.testDb)).toBe(1)
    const row = fx.testDb.sqlite.prepare('SELECT status, last_error_code FROM plugin_jobs').get() as any
    expect(row).toMatchObject({ status: 'failed', last_error_code: 'enqueue-send-failed' })

    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(String(errorSpy.mock.calls[0][0])).toMatch(
      /^\[Plugin Job\] enqueue send failed job=\d+ plugin=\d+ code=enqueue-send-failed$/
    )
    errorSpy.mockRestore()
  })

  test('pending dedupe: second POST returns the same job without a second quota check', async () => {
    const fx = await makeFixture()

    const first = await fx.request('/message/1/jobs', {
      method: 'POST',
      token: OWNER_CLIENT_TOKEN,
      body: { pluginId: PLUGIN_ID }
    })
    expect(first.status).toBe(202)
    const firstBody = await readJson(first)
    const kvCallsAfterFirst = fx.kvGet.mock.calls.length
    expect(kvCallsAfterFirst).toBe(1)

    const second = await fx.request('/message/1/jobs', {
      method: 'POST',
      token: OWNER_CLIENT_TOKEN,
      body: { pluginId: PLUGIN_ID }
    })
    expect(second.status).toBe(202)
    expect(await readJson(second)).toEqual(firstBody)
    expect(jobCount(fx.testDb)).toBe(1)

    expect(fx.kvGet.mock.calls.length).toBe(kvCallsAfterFirst)
    expect(enqueueRejectedCount(fx.testDb)).toBe(0)
  })
})

describe('POST /message/:id/jobs authorization and secret errors', () => {
  const SECRET_REQUIRED_CONFIG = 'provider: secret-required\nmodel: "route-model"\n'

  test('损坏的 secret envelope -> 409（不是 500），不建 job 且日志为 secret-decrypt-failed', async () => {
    const fx = await makeFixture()

    fx.testDb.sqlite
      .prepare('UPDATE plugin_configs SET config_yaml = ?, encrypted_secret = ? WHERE id = ?')
      .run(SECRET_REQUIRED_CONFIG, '{not-json', PLUGIN_ID)

    const response = await fx.request('/message/1/jobs', {
      method: 'POST',
      token: OWNER_CLIENT_TOKEN,
      body: { pluginId: PLUGIN_ID }
    })

    expect(response.status).toBe(409)
    const body = await readJson(response)
    expect(body.errorCode).toBe(409)
    expect(body.errorDescription).toBe('Plugin configuration is invalid')
    expect(jobCount(fx.testDb)).toBe(0)
    expect(fx.queueSend).not.toHaveBeenCalled()
    expect(enqueueRejectedCodes(fx.testDb)).toEqual(['secret-decrypt-failed'])
  })

  test('正常 envelope 仍 202（回归）', async () => {
    const fx = await makeFixture()

    const response = await fx.request('/message/1/jobs', {
      method: 'POST',
      token: OWNER_CLIENT_TOKEN,
      body: { pluginId: PLUGIN_ID }
    })

    expect(response.status).toBe(202)
    const body = await readJson(response)
    expect(body.status).toBe('pending')
    expect(enqueueRejectedCount(fx.testDb)).toBe(0)
  })

  test('非管理员被撤销插件权限 -> 409 plugin-unavailable 且不建 job', async () => {
    const fx = await makeFixture()

    fx.testDb.sqlite
      .prepare('DELETE FROM user_plugin_permissions WHERE user_id = ? AND module_path = ?')
      .run(OWNER_ID, ROUTE_MODULE)

    const response = await fx.request('/message/1/jobs', {
      method: 'POST',
      token: OWNER_CLIENT_TOKEN,
      body: { pluginId: PLUGIN_ID }
    })

    expect(response.status).toBe(409)
    expect((await readJson(response)).errorDescription).toBe(
      'Plugin is not available for message jobs'
    )
    expect(jobCount(fx.testDb)).toBe(0)
    expect(enqueueRejectedCodes(fx.testDb)).toEqual(['plugin-unavailable'])
  })

  test('管理员无需 user_plugin_permissions 也能触发自己的实例', async () => {
    const fx = await makeFixture()
    fx.testDb.db
      .insert(messages)
      .values({ id: 3, userid: ADMIN_ID, appid: 1, message: 'admin message' })
      .run()
    fx.testDb.db
      .insert(pluginConfigs)
      .values({
        id: 20,
        userId: ADMIN_ID,
        name: 'Admin Example Task',
        token: 'plugin-token-20',
        modulePath: ROUTE_MODULE,
        configYaml: VALID_CONFIG,
        enabled: 1
      })
      .run()

    const response = await fx.request('/message/3/jobs', {
      method: 'POST',
      basic: ['root', 'admin-pass'],
      body: { pluginId: 20 }
    })

    expect(response.status).toBe(202)
    expect(jobCount(fx.testDb)).toBe(1)
    expect(enqueueRejectedCount(fx.testDb)).toBe(0)
  })
})

describe('GET /message/:id/jobs', () => {
  test('root path and /api/v1 both respond', async () => {
    for (const prefix of ['/message/1/jobs', '/api/v1/message/1/jobs']) {
      const fx = await makeFixture()
      const response = await fx.request(prefix, { token: OWNER_CLIENT_TOKEN })

      expect(response.status).toBe(200)
      expect(await readJson(response)).toEqual({ messageDeleted: false, jobs: [] })
    }
  })

  test('no credentials -> 401; application token -> 401', async () => {
    const fx = await makeFixture()
    seedJob(fx.testDb)

    const anonymous = await fx.request('/message/1/jobs')
    expect(anonymous.status).toBe(401)

    const appToken = await fx.request('/message/1/jobs', { token: OWNER_APP_TOKEN })
    expect(appToken.status).toBe(401)
  })

  test('Basic auth can read jobs', async () => {
    const fx = await makeFixture()
    const jobId = seedJob(fx.testDb)

    const response = await fx.request('/message/1/jobs', { basic: ['alice', 'owner-pass'] })
    expect(response.status).toBe(200)
    const body = await readJson(response)
    expect(body.jobs.map((job: any) => job.jobId)).toEqual([jobId])
  })

  test('message missing and no job -> 404', async () => {
    const fx = await makeFixture()
    const response = await fx.request('/message/999/jobs', { token: OWNER_CLIENT_TOKEN })

    expect(response.status).toBe(404)
  })

  test('message deleted but jobs exist -> messageDeleted history', async () => {
    const fx = await makeFixture()
    const jobId = seedJob(fx.testDb)
    fx.testDb.sqlite.prepare('DELETE FROM messages WHERE id = 1').run()

    const response = await fx.request('/message/1/jobs', { token: OWNER_CLIENT_TOKEN })

    expect(response.status).toBe(200)
    const body = await readJson(response)
    expect(body.messageDeleted).toBe(true)
    expect(body.jobs).toHaveLength(1)
    expect(body.jobs[0].jobId).toBe(jobId)
  })

  test('message deleted with a pluginId that matches no job -> 200 with empty history', async () => {
    const fx = await makeFixture()

    seedJob(fx.testDb, { pluginId: PLUGIN_ID })
    fx.testDb.sqlite.prepare('DELETE FROM messages WHERE id = 1').run()

    const response = await fx.request('/message/1/jobs?pluginId=11', {
      token: OWNER_CLIENT_TOKEN
    })

    expect(response.status).toBe(200)
    expect(await readJson(response)).toEqual({ messageDeleted: true, jobs: [] })
  })

  test('non-owner -> 404 even if the message exists', async () => {
    const fx = await makeFixture()
    seedJob(fx.testDb)

    const response = await fx.request('/message/1/jobs', { token: OTHER_CLIENT_TOKEN })
    expect(response.status).toBe(404)
  })

  test('at most 20 newest jobs are returned', async () => {
    const fx = await makeFixture()
    for (let i = 0; i < 25; i += 1) {
      seedJob(fx.testDb, {
        status: 'success',
        createdAt: `2026-10-01 00:00:${String(i).padStart(2, '0')}`
      })
    }

    const response = await fx.request('/message/1/jobs', { token: OWNER_CLIENT_TOKEN })
    expect(response.status).toBe(200)
    const body = await readJson(response)
    expect(body.jobs).toHaveLength(20)
    expect(body.jobs[0].jobId).toBe(25)
    expect(body.jobs[19].jobId).toBe(6)
  })

  test('jobs are ordered newest first (created_at DESC, id DESC)', async () => {
    const fx = await makeFixture()
    const older = seedJob(fx.testDb, { createdAt: '2026-10-01 00:00:00' })
    const newest = seedJob(fx.testDb, { createdAt: '2026-10-03 00:00:00' })
    const middle = seedJob(fx.testDb, { createdAt: '2026-10-02 00:00:00' })

    const response = await fx.request('/message/1/jobs', { token: OWNER_CLIENT_TOKEN })
    const body = await readJson(response)

    expect(body.jobs.map((job: any) => job.jobId)).toEqual([newest, middle, older])
  })

  test('error is returned only for failed/dead jobs', async () => {
    const fx = await makeFixture()
    seedJob(fx.testDb, { status: 'pending', result: null, completedAt: null })
    seedJob(fx.testDb, { status: 'success', result: JSON.stringify({ tags: ['x'] }) })
    seedJob(fx.testDb, {
      status: 'failed',
      result: null,
      lastErrorCode: 'provider-timeout',
      lastErrorMessage: 'provider timeout'
    })
    seedJob(fx.testDb, {
      status: 'dead',
      result: null,
      lastErrorCode: 'dead-timeout',
      lastErrorMessage: 'job deadline exceeded'
    })

    const response = await fx.request('/message/1/jobs', { token: OWNER_CLIENT_TOKEN })
    const body = await readJson(response)
    const byStatus = Object.fromEntries(body.jobs.map((job: any) => [job.status, job]))

    expect(byStatus.pending.error).toBeNull()
    expect(byStatus.success.error).toBeNull()

    expect(byStatus.failed.error).toEqual({
      code: 'provider-timeout',
      message: jobErrorMessage('provider-timeout')
    })
    expect(byStatus.dead.error).toEqual({
      code: 'dead-timeout',
      message: jobErrorMessage('dead-timeout')
    })
    expect(byStatus.pending.result).toBeNull()
    expect(byStatus.pending.completedAt).toBeNull()
  })

  test('result is returned verbatim and payload is never exposed', async () => {
    const fx = await makeFixture()
    seedJob(fx.testDb, { result: JSON.stringify({ tags: ['告警', '部署'] }) })

    const response = await fx.request('/message/1/jobs', { token: OWNER_CLIENT_TOKEN })
    const body = await readJson(response)
    const job = body.jobs[0]

    expect(job.result).toEqual({ tags: ['告警', '部署'] })
    expect(Object.keys(job).sort()).toEqual([
      'completedAt',
      'createdAt',
      'error',
      'jobId',
      'pluginId',
      'result',
      'status'
    ])
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('payload')
    expect(serialized).not.toContain('secret-prompt-text')
  })

  test('unparseable result is reported as null, not 500', async () => {
    const fx = await makeFixture()
    seedJob(fx.testDb, { result: '{not-json' })

    const response = await fx.request('/message/1/jobs', { token: OWNER_CLIENT_TOKEN })
    expect(response.status).toBe(200)
    expect((await readJson(response)).jobs[0].result).toBeNull()
  })

  test('pluginId filter applies; invalid pluginId -> 400', async () => {
    const fx = await makeFixture()
    const pluginJob = seedJob(fx.testDb, { pluginId: PLUGIN_ID })
    seedJob(fx.testDb, { pluginId: 11 })

    const filtered = await fx.request(`/message/1/jobs?pluginId=${PLUGIN_ID}`, {
      token: OWNER_CLIENT_TOKEN
    })
    expect(filtered.status).toBe(200)
    const body = await readJson(filtered)
    expect(body.jobs.map((job: any) => job.jobId)).toEqual([pluginJob])

    for (const raw of ['abc', '0', '-1']) {
      const invalid = await fx.request(`/message/1/jobs?pluginId=${raw}`, {
        token: OWNER_CLIENT_TOKEN
      })
      expect(invalid.status).toBe(400)
    }
  })
})
