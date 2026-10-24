

















import { auth } from '../../src/routes/auth'
import { Authenticator } from '../../src/middleware/auth'
import { hashPasswordOnce } from '../helpers/passwordHash'
import { generateEnhancedToken } from '../../src/utils/enhancedToken'
import { createTestDb, asDrizzle, seedClient } from '../helpers/testDb'
import type { TestDb } from '../helpers/testDb'
import { makeD1Sqlite } from '../helpers/d1Sqlite'
import { clients, pushOutbox } from '../../src/models'
import { eq } from 'drizzle-orm'
import { signFourFieldToken } from '../helpers/enhancedTokenTestSupport'

const USER_PASSWORD = 'integration-pass-7'


const openDbs: TestDb[] = []

interface AuthFixture {
  testDb: TestDb

  env: Record<string, unknown>

  drizzle: ReturnType<typeof asDrizzle>
}


async function makeAuthFixture(): Promise<AuthFixture> {
  const testDb = createTestDb()
  openDbs.push(testDb)

  testDb.sqlite.exec('ALTER TABLE users ADD COLUMN pass text')
  const passHash = await hashPasswordOnce(USER_PASSWORD)
  testDb.sqlite
    .prepare('INSERT INTO users (id, name, pass, admin, disabled) VALUES (?, ?, ?, ?, ?)')
    .run(7, 'user7', passHash, 0, 0)

  testDb.sqlite.exec(`
    CREATE TABLE \`applications\` (
      \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      \`user_id\` integer NOT NULL,
      \`token\` text NOT NULL UNIQUE,
      \`name\` text NOT NULL,
      \`sort_key\` text DEFAULT '' NOT NULL,
      \`description\` text,
      \`default_priority\` integer DEFAULT 0,
      \`image\` text,
      \`internal\` integer DEFAULT 0,
      \`last_used\` text,
      \`created_at\` text DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` text DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX \`idx_applications_user_sort_key\`
      ON \`applications\` (\`user_id\`,\`sort_key\`,\`id\`);
  `)
  return { testDb, env: { DB: makeD1Sqlite(testDb) }, drizzle: asDrizzle(testDb) }
}


function logoutRequest(url: string, headers: Record<string, string>) {
  return new Request(url, { method: 'POST', headers })
}

const GOTIFY_401_DESCRIPTION =
  'you need to provide a valid access token or user credentials to access this api'

function getClientRow(testDb: TestDb, id: number) {
  return testDb.db.select().from(clients).where(eq(clients.id, id)).all()[0]
}


function seedOutbox(
  testDb: TestDb,
  messageId: number,
  overrides: Partial<typeof pushOutbox.$inferInsert> = {}
): typeof pushOutbox.$inferSelect {
  const base: typeof pushOutbox.$inferInsert = {
    userId: 7,
    messageId,
    platform: 'test-platform',
    clientId: 11,
    payloadJson: '{"title":"t"}',
    status: 'pending',
    ...overrides
  }
  const [row] = testDb.db.insert(pushOutbox).values(base).returning().all()
  return row
}

afterEach(() => {
  while (openDbs.length) {
    openDbs.pop()!.sqlite.close()
  }
})

describe('POST /auth/logout 真实链路（真实 route + Authenticator + ClientHandlers + 真库）', () => {
  test('旧 C token 经真实认证登出：200 {}、行删除、outbox 冲销、旧 token 再认证 401', async () => {
    const { testDb, env } = await makeAuthFixture()
    const client = seedClient(testDb, { token: 'ColdRouteLogout' })
    const pending = seedOutbox(testDb, 1001, { clientId: client.id, status: 'pending' })
    const processing = seedOutbox(testDb, 1002, { clientId: client.id, status: 'processing' })
    const success = seedOutbox(testDb, 1003, { clientId: client.id, status: 'success' })

    const response = await auth.fetch(
      logoutRequest('http://localhost/auth/logout', { 'x-gotify-key': 'ColdRouteLogout' }),
      env as any,
      {} as any
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({})


    expect(getClientRow(testDb, client.id)).toBeUndefined()
    expect(
      testDb.db.select().from(pushOutbox).where(eq(pushOutbox.id, pending.id)).all()[0]
    ).toMatchObject({ status: 'dead', lastError: 'Client logged out' })
    expect(
      testDb.db.select().from(pushOutbox).where(eq(pushOutbox.id, processing.id)).all()[0]
    ).toMatchObject({ status: 'dead', lastError: 'Client logged out' })
    expect(
      testDb.db.select().from(pushOutbox).where(eq(pushOutbox.id, success.id)).all()[0]
    ).toMatchObject({ status: 'success', lastError: null })


    const authenticator = new Authenticator(asDrizzle(testDb))
    await expect(
      authenticator.requireClient(
        logoutRequest('http://localhost/auth/logout', { 'x-gotify-key': 'ColdRouteLogout' }),
        {} as any
      )
    ).resolves.toBeNull()


    const second = await auth.fetch(
      logoutRequest('http://localhost/auth/logout', { 'x-gotify-key': 'ColdRouteLogout' }),
      env as any,
      {} as any
    )
    expect(second.status).toBe(401)
    await expect(second.json()).resolves.toEqual({
      error: 'Unauthorized',
      errorCode: 401,
      errorDescription: GOTIFY_401_DESCRIPTION
    })
  })

  test('gtfy privateForm（库中 publicForm）经真实认证登出并使旧凭据失效', async () => {
    const { testDb, env } = await makeAuthFixture()
    const { publicForm, privateForm } = generateEnhancedToken('client')
    const client = seedClient(testDb, { token: publicForm })
    const pending = seedOutbox(testDb, 2001, { clientId: client.id, status: 'pending' })

    const response = await auth.fetch(
      logoutRequest('http://localhost/auth/logout', { 'x-gotify-key': privateForm }),
      env as any,
      {} as any
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({})
    expect(getClientRow(testDb, client.id)).toBeUndefined()
    expect(
      testDb.db.select().from(pushOutbox).where(eq(pushOutbox.id, pending.id)).all()[0]
    ).toMatchObject({ status: 'dead', lastError: 'Client logged out' })


    const authenticator = new Authenticator(asDrizzle(testDb))
    await expect(
      authenticator.requireClient(
        logoutRequest('http://localhost/auth/logout', { 'x-gotify-key': privateForm }),
        {} as any
      )
    ).resolves.toBeNull()
  })

  test('4 段式签名凭据（时效窗口内，Bearer 头提取）同样可登出', async () => {
    const { testDb, env } = await makeAuthFixture()
    const { publicForm, privateForm } = generateEnhancedToken('client')
    const client = seedClient(testDb, { token: publicForm })
    const fourField = signFourFieldToken(privateForm, Math.floor(Date.now() / 1000))

    const response = await auth.fetch(
      logoutRequest('http://localhost/auth/logout', { authorization: `Bearer ${fourField}` }),
      env as any,
      {} as any
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({})
    expect(getClientRow(testDb, client.id)).toBeUndefined()
  })

  test('有效 app token（requireApp 前置证真）登出 → 401', async () => {
    const { testDb, env, drizzle } = await makeAuthFixture()
    testDb.sqlite
      .prepare('INSERT INTO applications (user_id, token, name) VALUES (?, ?, ?)')
      .run(7, 'AappRouteMatrix', 'Matrix App')
    const appRequest = logoutRequest('http://localhost/auth/logout', {
      'x-gotify-key': 'AappRouteMatrix'
    })


    const authenticator = new Authenticator(drizzle)
    await expect(authenticator.requireApp(appRequest)).resolves.toMatchObject({
      userId: 7,
      tokenType: 'app'
    })

    const response = await auth.fetch(appRequest, env as any, {} as any)
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: 'Unauthorized',
      errorCode: 401,
      errorDescription: GOTIFY_401_DESCRIPTION
    })
  })

  test('Basic 认证可识别用户但无 client 上下文 → 403，且不修改任何行', async () => {
    const { testDb, env, drizzle } = await makeAuthFixture()
    const client = seedClient(testDb, { token: 'CbasicBystander' })
    const pending = seedOutbox(testDb, 3001, { clientId: client.id, status: 'pending' })
    const basic = btoa(`user7:${USER_PASSWORD}`)
    const basicRequest = logoutRequest('http://localhost/auth/logout', {
      authorization: `Basic ${basic}`
    })


    const authenticator = new Authenticator(drizzle)
    await expect(authenticator.requireClient(basicRequest, {} as any)).resolves.toEqual({
      userId: 7,
      isAdmin: false,
      tokenType: 'client'
    })

    const response = await auth.fetch(basicRequest, env as any, {} as any)
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Forbidden',
      errorCode: 403,
      errorDescription: 'no client auth provided'
    })


    expect(getClientRow(testDb, client.id)).toBeDefined()
    expect(
      testDb.db.select().from(pushOutbox).where(eq(pushOutbox.id, pending.id)).all()[0]
    ).toMatchObject({ status: 'pending', lastError: null })
  })

  test('闲置过期 client token → 401 且行不被删除', async () => {
    const { testDb, env } = await makeAuthFixture()
    const expiredAt = new Date(Date.now() - 60_000).toISOString()
    const client = seedClient(testDb, { token: 'CexpiredRoute', expiresAt: expiredAt })

    const response = await auth.fetch(
      logoutRequest('http://localhost/auth/logout', { 'x-gotify-key': 'CexpiredRoute' }),
      env as any,
      {} as any
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: 'Unauthorized',
      errorCode: 401,
      errorDescription: GOTIFY_401_DESCRIPTION
    })

    expect(getClientRow(testDb, client.id)).toBeDefined()
  })

  test('无凭据 → 401（矩阵补全；分发层用例见 workerRouting 测试）', async () => {
    const { env } = await makeAuthFixture()
    const response = await auth.fetch(
      logoutRequest('http://localhost/auth/logout', {}),
      env as any,
      {} as any
    )
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: 'Unauthorized',
      errorCode: 401,
      errorDescription: GOTIFY_401_DESCRIPTION
    })
  })

  test('MESSAGE_STREAM_HUB 断流 best-effort：DO 不可用时仍 200，错误日志不含凭据', async () => {
    const { testDb } = await makeAuthFixture()
    const client = seedClient(testDb, { token: 'CdoUnavailable' })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const env = { DB: makeD1Sqlite(testDb), MESSAGE_STREAM_HUB: {} as any } as any

    try {
      const response = await auth.fetch(
        logoutRequest('http://localhost/auth/logout', { 'x-gotify-key': 'CdoUnavailable' }),
        env,
        {} as any
      )

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({})
      expect(getClientRow(testDb, client.id)).toBeUndefined()


      expect(errorSpy).toHaveBeenCalled()
      const logged = errorSpy.mock.calls
        .map((callArgs) =>
          callArgs.map((a) => (a instanceof Error ? a.message : String(a))).join(' ')
        )
        .join('\n')
      expect(logged).toContain('disconnect')
      expect(logged).not.toContain('CdoUnavailable')
      expect(logged).not.toContain('/auth/logout')
    } finally {
      errorSpy.mockRestore()
    }
  })
})
