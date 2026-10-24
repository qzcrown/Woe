

















import { ClientHandlers } from '../../src/handlers/clientHandlers'
import { Authenticator } from '../../src/middleware/auth'
import { generateEnhancedToken } from '../../src/utils/enhancedToken'
import { createTestDb, asDrizzle, seedClient } from '../helpers/testDb'
import type { TestDb } from '../helpers/testDb'
import { makeD1Sqlite } from '../helpers/d1Sqlite'
import { clients, pushOutbox } from '../../src/models'
import { eq } from 'drizzle-orm'
import { signFourFieldToken } from '../helpers/enhancedTokenTestSupport'


const openDbs: TestDb[] = []


function makeLogoutFixture() {
  const testDb = createTestDb()
  openDbs.push(testDb)
  const insertUser = testDb.sqlite.prepare(
    'INSERT INTO users (id, name, admin, disabled) VALUES (?, ?, ?, ?)'
  )
  insertUser.run(7, 'user7', 0, 0)
  insertUser.run(8, 'user8', 0, 0)
  const handlers = new ClientHandlers(asDrizzle(testDb), makeD1Sqlite(testDb))
  return { testDb, handlers }
}

function getClientRow(testDb: TestDb, id: number) {
  return testDb.db.select().from(clients).where(eq(clients.id, id)).all()[0]
}

function getOutboxRow(testDb: TestDb, id: number) {
  return testDb.db.select().from(pushOutbox).where(eq(pushOutbox.id, id)).all()[0]
}


function seedOutbox(
  testDb: TestDb,
  messageId: number,
  overrides: Partial<typeof pushOutbox.$inferInsert> = {}
): typeof pushOutbox.$inferSelect {
  const base: typeof pushOutbox.$inferInsert = {
    userId: 7,
    messageId,
    platform: 'fixture_a',
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

describe('ClientHandlers logoutClient（三元快照 + 原子 batch）', () => {
  test('正确三元快照删除本人行：pending/processing 冲销 dead，success/failed/已 dead 不动', async () => {
    const { testDb, handlers } = makeLogoutFixture()
    const client = seedClient(testDb, { token: 'ColdLogoutToken1' })
    const pending = seedOutbox(testDb, 101, { clientId: client.id, status: 'pending' })
    const processing = seedOutbox(testDb, 102, { clientId: client.id, status: 'processing' })
    const success = seedOutbox(testDb, 103, { clientId: client.id, status: 'success' })
    const failed = seedOutbox(testDb, 104, { clientId: client.id, status: 'failed', lastError: 'vendor 500' })
    const dead = seedOutbox(testDb, 105, { clientId: client.id, status: 'dead', lastError: 'old reason' })

    const result = await handlers.logoutClient(7, client.id, 'ColdLogoutToken1')
    expect(result).toEqual({ ok: true, revoked: true })

    expect(getClientRow(testDb, client.id)).toBeUndefined()


    expect(getOutboxRow(testDb, pending.id)).toMatchObject({ status: 'dead', lastError: 'Client logged out' })
    expect(getOutboxRow(testDb, pending.id)!.updatedAt).not.toBe(pending.updatedAt)
    expect(getOutboxRow(testDb, pending.id)!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(getOutboxRow(testDb, processing.id)).toMatchObject({ status: 'dead', lastError: 'Client logged out' })


    expect(getOutboxRow(testDb, success.id)).toMatchObject({ status: 'success', lastError: null })
    expect(getOutboxRow(testDb, failed.id)).toMatchObject({ status: 'failed', lastError: 'vendor 500' })
    expect(getOutboxRow(testDb, dead.id)).toMatchObject({ status: 'dead', lastError: 'old reason' })
    expect(getOutboxRow(testDb, dead.id)!.updatedAt).toBe(dead.updatedAt)
  })

  test('同用户另一 client、另一用户 client 与各自 outbox 均不变', async () => {
    const { testDb, handlers } = makeLogoutFixture()
    const target = seedClient(testDb, { token: 'CtargetIsolation', deviceUid: 'device-target' })
    const sameUserOther = seedClient(testDb, { token: 'CsameUserOther', deviceUid: 'device-other' })
    const otherUser = seedClient(testDb, { userId: 8, token: 'CotherUserClient', deviceUid: 'device-user8' })
    const targetPending = seedOutbox(testDb, 201, { clientId: target.id })
    const otherPending = seedOutbox(testDb, 202, { clientId: sameUserOther.id })
    const otherUserPending = seedOutbox(testDb, 203, { userId: 8, clientId: otherUser.id })

    const result = await handlers.logoutClient(7, target.id, 'CtargetIsolation')
    expect(result).toEqual({ ok: true, revoked: true })


    expect(getClientRow(testDb, sameUserOther.id)).toBeDefined()
    expect(getClientRow(testDb, otherUser.id)).toBeDefined()

    expect(getOutboxRow(testDb, targetPending.id)!.status).toBe('dead')
    expect(getOutboxRow(testDb, otherPending.id)).toMatchObject({ status: 'pending', lastError: null })
    expect(getOutboxRow(testDb, otherUserPending.id)).toMatchObject({ status: 'pending', lastError: null })
  })

  test('缺失行、归属不符、同 id 已轮换 token 均 revoked=false 且 outbox 不动', async () => {
    const { testDb, handlers } = makeLogoutFixture()
    const client = seedClient(testDb, { token: 'CrotateGuard' })
    const pending = seedOutbox(testDb, 301, { clientId: client.id })


    await expect(handlers.logoutClient(7, 999999, 'CmissingRow')).resolves.toEqual({ ok: true, revoked: false })

    await expect(handlers.logoutClient(8, client.id, 'CrotateGuard')).resolves.toEqual({ ok: true, revoked: false })

    testDb.sqlite.prepare('UPDATE clients SET token = ? WHERE id = ?').run('CrotatedNewToken', client.id)
    await expect(handlers.logoutClient(7, client.id, 'CrotateGuard')).resolves.toEqual({ ok: true, revoked: false })

    const row = getClientRow(testDb, client.id)
    expect(row.token).toBe('CrotatedNewToken')
    expect(getOutboxRow(testDb, pending.id)).toMatchObject({ status: 'pending', lastError: null })
  })

  test('同一快照重复执行只有首次实际删除', async () => {
    const { testDb, handlers } = makeLogoutFixture()
    const client = seedClient(testDb, { token: 'CrepeatOnce' })

    await expect(handlers.logoutClient(7, client.id, 'CrepeatOnce')).resolves.toEqual({ ok: true, revoked: true })
    await expect(handlers.logoutClient(7, client.id, 'CrepeatOnce')).resolves.toEqual({ ok: true, revoked: false })

    expect(getClientRow(testDb, client.id)).toBeUndefined()
  })

  test('旧快照遇同设备重登录（真实 createClient 轮换 token）：新凭据可认证、新 client 与新任务不动', async () => {
    const { testDb, handlers } = makeLogoutFixture()
    const old = seedClient(testDb, {
      token: 'ColdInterleave',
      deviceUid: 'device-abc',
      deviceToken: 'old-push-token'
    })
    const oldToken = old.token


    const res = await handlers.createClient(7, {
      name: 'Pixel Relogin',
      platform: 'fixture_a',
      deviceUid: 'device-abc',
      deviceToken: 'new-push-token'
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.id).toBe(old.id)

    expect(body).not.toHaveProperty('clientTokenLookup')
    expect(JSON.stringify(body)).not.toContain('ColdInterleave')


    const newTask = seedOutbox(testDb, 501, { clientId: old.id })


    const result = await handlers.logoutClient(7, old.id, oldToken)
    expect(result).toEqual({ ok: true, revoked: false })

    const row = getClientRow(testDb, old.id)
    expect(row.token).not.toBe(oldToken)
    expect(getOutboxRow(testDb, newTask.id)).toMatchObject({ status: 'pending', lastError: null })


    const auth = new Authenticator(asDrizzle(testDb))
    const tokenInfo = await auth.authenticate(
      new Request('http://localhost/client', { headers: { 'X-Gotify-Key': body.token } })
    )
    expect(tokenInfo).toMatchObject({ userId: 7, tokenType: 'client', clientId: old.id })
    expect(tokenInfo!.clientTokenLookup).toBe(row.token)
  })

  test('批内第二条 DELETE 失败：第一条 outbox UPDATE 回滚，client 行保留，500 不泄露凭据', async () => {
    const { testDb, handlers } = makeLogoutFixture()
    const client = seedClient(testDb, { token: 'CrollbackDelete' })
    const pending = seedOutbox(testDb, 601, { clientId: client.id })


    testDb.sqlite.exec(
      `CREATE TRIGGER logout_delete_fail BEFORE DELETE ON clients
       BEGIN SELECT RAISE(ABORT, 'injected delete failure'); END`
    )
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    const result = await handlers.logoutClient(7, client.id, 'CrollbackDelete')

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('logoutClient 应失败')
    expect(result.response.status).toBe(500)
    const errorBody = await result.response.text()
    expect(errorBody).not.toContain('CrollbackDelete')

    for (const callArgs of errorSpy.mock.calls) {
      const text = callArgs.map((a) => (a instanceof Error ? a.message : String(a))).join(' ')
      expect(text).not.toContain('CrollbackDelete')
    }
    errorSpy.mockRestore()


    expect(getClientRow(testDb, client.id)).toBeDefined()
    expect(getOutboxRow(testDb, pending.id)).toMatchObject({ status: 'pending', lastError: null })
  })

  test('批内第一条 UPDATE 失败：client 不被删除（批整体失败）', async () => {
    const { testDb, handlers } = makeLogoutFixture()
    const client = seedClient(testDb, { token: 'CrollbackUpdate' })

    const pending = seedOutbox(testDb, 602, { clientId: client.id })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    testDb.sqlite.exec(
      `CREATE TRIGGER logout_update_fail BEFORE UPDATE ON push_outbox
       BEGIN SELECT RAISE(ABORT, 'injected update failure'); END`
    )

    const result = await handlers.logoutClient(7, client.id, 'CrollbackUpdate')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('logoutClient 应失败')
    expect(result.response.status).toBe(500)
    errorSpy.mockRestore()


    expect(getClientRow(testDb, client.id)).toBeDefined()
    expect(getOutboxRow(testDb, pending.id)).toMatchObject({ status: 'pending', lastError: null })
  })

  test('batch 本身失败（连接/驱动错误）也不删除 client', async () => {
    const testDb = createTestDb()
    openDbs.push(testDb)
    testDb.sqlite
      .prepare('INSERT INTO users (id, name, admin, disabled) VALUES (?, ?, ?, ?)')
      .run(7, 'user7', 0, 0)
    const client = seedClient(testDb, { token: 'CbatchReject' })
    const pending = seedOutbox(testDb, 701, { clientId: client.id })
    const working = makeD1Sqlite(testDb)
    const brokenRawDb = {
      prepare: (working as any).prepare.bind(working),
      batch: async () => {
        throw new Error('injected batch failure')
      }
    }
    const handlers = new ClientHandlers(asDrizzle(testDb), brokenRawDb as any)

    const result = await handlers.logoutClient(7, client.id, 'CbatchReject')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('logoutClient 应失败')
    expect(result.response.status).toBe(500)

    expect(getClientRow(testDb, client.id)).toBeDefined()
    expect(getOutboxRow(testDb, pending.id)).toMatchObject({ status: 'pending', lastError: null })
  })

  test('缺 rawDb binding 返回 500，不提供不原子的 Drizzle fallback', async () => {
    const { testDb } = makeLogoutFixture()
    const handlersWithoutRawDb = new ClientHandlers(asDrizzle(testDb))
    const client = seedClient(testDb, { token: 'CnoRawDb' })
    const pending = seedOutbox(testDb, 801, { clientId: client.id })

    const result = await handlersWithoutRawDb.logoutClient(7, client.id, 'CnoRawDb')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('logoutClient 应失败')
    expect(result.response.status).toBe(500)


    expect(getClientRow(testDb, client.id)).toBeDefined()
    expect(getOutboxRow(testDb, pending.id)).toMatchObject({ status: 'pending', lastError: null })
  })
})

describe('Authenticator clientTokenLookup 快照（认证命中库 lookup 值）', () => {
  test('旧 C token：快照记录库中原值（完整对象断言）', async () => {
    const { testDb } = makeLogoutFixture()
    const client = seedClient(testDb, { token: 'ClegacySnapshot' })
    const auth = new Authenticator(asDrizzle(testDb))

    const result = await auth.authenticate(
      new Request('http://localhost/client', { headers: { 'X-Gotify-Key': 'ClegacySnapshot' } })
    )
    expect(result).toEqual({
      userId: 7,
      isAdmin: false,
      tokenType: 'client',
      resourceId: client.id,
      clientId: client.id,
      elevatedUntil: null,
      clientTokenLookup: 'ClegacySnapshot'
    })
  })

  test('gtfy 增强 token：privateForm 与 4 段式签名凭据的快照均为库中 publicForm', async () => {
    const { testDb } = makeLogoutFixture()
    const { publicForm, privateForm } = generateEnhancedToken('client')
    const client = seedClient(testDb, { token: publicForm })
    const auth = new Authenticator(asDrizzle(testDb))

    const viaPrivate = await auth.authenticate(
      new Request('http://localhost/client', { headers: { 'X-Gotify-Key': privateForm } })
    )
    expect(viaPrivate).not.toBeNull()
    expect(viaPrivate!.clientTokenLookup).toBe(publicForm)
    expect(viaPrivate!.clientTokenLookup).not.toBe(privateForm)

    const nowSec = Math.floor(Date.now() / 1000)
    const fourField = signFourFieldToken(privateForm, nowSec)
    const viaSigned = await auth.authenticate(
      new Request(`http://localhost/client?token=${fourField}`)
    )
    expect(viaSigned).not.toBeNull()
    expect(viaSigned!.clientTokenLookup).toBe(publicForm)
    expect(viaSigned!.clientId).toBe(client.id)
  })

  test('Basic 认证的 TokenInfo 无 clientId 与 clientTokenLookup（现状保持）', async () => {
    const auth = new Authenticator({} as any)
    jest.spyOn(auth, 'authenticateBasic').mockResolvedValue({ id: 9, admin: false } as any)

    const result = await auth.requireClient(
      new Request('http://localhost/client', {
        headers: { Authorization: 'Basic Zm9vOmJhcg==' }
      }),
      {} as any
    )
    expect(result).toEqual({ userId: 9, isAdmin: false, tokenType: 'client' })
  })

  test('app token 认证的 TokenInfo 无 clientTokenLookup', async () => {

    const get = jest.fn()
    get.mockResolvedValueOnce({ id: 10, userId: 1 })
    get.mockResolvedValueOnce({ admin: false })
    const drizzle = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({ where: jest.fn(() => ({ get })) }))
      }))
    }
    const auth = new Authenticator(drizzle as any)

    const result = await auth.authenticate(
      new Request('http://localhost/message', { headers: { 'X-Gotify-Key': 'AappToken' } })
    )
    expect(result).toEqual({ userId: 1, isAdmin: false, tokenType: 'app', resourceId: 10 })
    expect(result!.clientTokenLookup).toBeUndefined()
  })

  test('HTTP 响应不暴露内部快照字段：createClient 响应无 clientTokenLookup、无库中 token', async () => {
    const { testDb, handlers } = makeLogoutFixture()
    const res = await handlers.createClient(7, { name: 'Web', platform: 'web' })
    expect(res.status).toBe(200)
    const body = await res.json() as any

    expect(body).not.toHaveProperty('clientTokenLookup')

    const row = getClientRow(testDb, body.id)
    expect(body.token).not.toBe(row.token)
    expect(JSON.stringify(body)).not.toContain(row.token)
  })
})
