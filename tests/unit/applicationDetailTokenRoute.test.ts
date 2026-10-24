













jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn()
}), { virtual: true })

import { application } from '../../src/routes/application'
import { hashPasswordOnce } from '../helpers/passwordHash'
import { createMessageTestDb } from '../helpers/messageTestDb'
import { makeD1Sqlite } from '../helpers/d1Sqlite'
import { makeExecutionCtxStub, type ExecutionCtxStub } from '../helpers/executionContext'
import { applications, clients } from '../../src/models'
import type { TestDb } from '../helpers/testDb'
import { derivePublicForm, makeTestPrivateForm } from '../helpers/enhancedTokenTestSupport'

const OWNER_USER_ID = 7
const OTHER_USER_ID = 8
const OTHER_ADMIN_ID = 9

const LEGACY_APP_ID = 1
const LEGACY_TOKEN = 'A-app-token'

const ENHANCED_APP_ID = 3

const OTHER_APP_ID = 2
const OWNER_CLIENT_TOKEN = 'C-owner-token'
const OTHER_CLIENT_TOKEN = 'C-other-token'

interface Fixture {
  testDb: TestDb
  env: Record<string, unknown>
  executionCtx: ExecutionCtxStub
  fetchDetail: (id: string, headers?: Record<string, string>) => Promise<Response>
}


function addPassColumn(testDb: TestDb): void {
  testDb.sqlite.exec("ALTER TABLE `users` ADD COLUMN `pass` text NOT NULL DEFAULT ''")
}

async function makeFixture(): Promise<Fixture> {
  const testDb = createMessageTestDb()
  addPassColumn(testDb)

  const ownerPass = await hashPasswordOnce('correct-horse')
  const otherPass = await hashPasswordOnce('other-horse')
  const adminPass = await hashPasswordOnce('admin-horse')


  const insertUser = testDb.sqlite.prepare(
    'INSERT INTO users (id, name, pass, admin, disabled) VALUES (?, ?, ?, ?, ?)'
  )
  insertUser.run(OWNER_USER_ID, 'alice', ownerPass, 0, 0)
  insertUser.run(OTHER_USER_ID, 'bob', otherPass, 0, 0)
  insertUser.run(OTHER_ADMIN_ID, 'root', adminPass, 1, 0)


  const privateForm = makeTestPrivateForm()
  const publicForm = await derivePublicForm(privateForm)

  testDb.db
    .insert(applications)
    .values([
      { id: LEGACY_APP_ID, userId: OWNER_USER_ID, token: LEGACY_TOKEN, name: 'Legacy App' },
      { id: OTHER_APP_ID, userId: OTHER_USER_ID, token: 'A-other-app-token', name: 'Other App' },
      { id: ENHANCED_APP_ID, userId: OWNER_USER_ID, token: publicForm, name: 'Enhanced App' }
    ])
    .run()


  testDb.db
    .insert(clients)
    .values([
      {
        id: 5,
        userId: OWNER_USER_ID,
        token: OWNER_CLIENT_TOKEN,
        name: 'Owner Device',
        platform: 'web',
        deviceUid: 'device-owner',
        deviceToken: null,
        tokenStatus: 'active',
        lastUsed: new Date().toISOString(),
        elevatedUntil: null,
        expiresAfterInactivitySeconds: 0,
        expiresAt: null
      },
      {
        id: 6,
        userId: OTHER_USER_ID,
        token: OTHER_CLIENT_TOKEN,
        name: 'Other Device',
        platform: 'web',
        deviceUid: 'device-other',
        deviceToken: null,
        tokenStatus: 'active',
        lastUsed: new Date().toISOString(),
        elevatedUntil: null,
        expiresAfterInactivitySeconds: 0,
        expiresAt: null
      }
    ])
    .run()

  const env = { DB: makeD1Sqlite(testDb) }
  const executionCtx = makeExecutionCtxStub()

  const fetchDetail = async (id: string, headers: Record<string, string> = {}) =>
    (await application.fetch(
      new Request(`http://localhost/${id}`, { headers }),
      env,
      executionCtx
    )) as Response

  return { testDb, env, executionCtx, fetchDetail }
}

function basicAuthHeader(username: string, password: string): Record<string, string> {
  return { authorization: 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64') }
}


async function expectNoToken(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json() as Record<string, unknown>
  expect(body).not.toHaveProperty('token')
  return body
}

describe('GET /application/:id 详情令牌路由契约（真认证 + 真库）', () => {
  test('匿名 → 401，无 token', async () => {
    const { fetchDetail } = await makeFixture()

    const response = await fetchDetail(String(LEGACY_APP_ID))

    expect(response.status).toBe(401)
    const body = await expectNoToken(response)
    expect(body).toMatchObject({
      error: 'Unauthorized',
      errorCode: 401,
      errorDescription: 'Client token or Basic auth required'
    })
  })

  test('owner 的 app token → 401（详情要求 client/Basic，不接受 app token），无 token', async () => {
    const { fetchDetail } = await makeFixture()

    const response = await fetchDetail(String(LEGACY_APP_ID), { 'x-gotify-key': LEGACY_TOKEN })

    expect(response.status).toBe(401)
    await expectNoToken(response)
  })

  test('无效 client token → 401，无 token', async () => {
    const { fetchDetail } = await makeFixture()

    const response = await fetchDetail(String(LEGACY_APP_ID), { 'x-gotify-key': 'C-no-such-token' })

    expect(response.status).toBe(401)
    await expectNoToken(response)
  })

  test('owner 未提升 client token → 200 返回存储明文 + no-store（详情不要求 elevation）', async () => {
    const { fetchDetail } = await makeFixture()

    const response = await fetchDetail(String(LEGACY_APP_ID), { 'x-gotify-key': OWNER_CLIENT_TOKEN })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toHaveProperty('token', LEGACY_TOKEN)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  test('owner Basic → 200 返回存储明文 + no-store', async () => {
    const { fetchDetail } = await makeFixture()

    const response = await fetchDetail(
      String(LEGACY_APP_ID),
      basicAuthHeader('alice', 'correct-horse')
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toHaveProperty('token', LEGACY_TOKEN)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  test('owner 读取 gtfy 行 → 200 返回库中 publicForm（非可用凭据）+ no-store', async () => {
    const { fetchDetail } = await makeFixture()
    const publicForm = await derivePublicForm(makeTestPrivateForm())

    const response = await fetchDetail(String(ENHANCED_APP_ID), { 'x-gotify-key': OWNER_CLIENT_TOKEN })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toHaveProperty('token', publicForm)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  test('他人 client token → 404，无 token（属主过滤经真库 WHERE）', async () => {
    const { fetchDetail } = await makeFixture()

    const response = await fetchDetail(String(LEGACY_APP_ID), { 'x-gotify-key': OTHER_CLIENT_TOKEN })

    expect(response.status).toBe(404)
    const body = await expectNoToken(response)
    expect(body).toMatchObject({ error: 'Not Found', errorCode: 404 })
  })

  test('他人 Basic → 404，无 token', async () => {
    const { fetchDetail } = await makeFixture()

    const response = await fetchDetail(
      String(LEGACY_APP_ID),
      basicAuthHeader('bob', 'other-horse')
    )

    expect(response.status).toBe(404)
    await expectNoToken(response)
  })

  test('他人 admin Basic → 404，无 token（管理员不旁路属主过滤）', async () => {
    const { fetchDetail } = await makeFixture()

    const response = await fetchDetail(
      String(LEGACY_APP_ID),
      basicAuthHeader('root', 'admin-horse')
    )

    expect(response.status).toBe(404)
    await expectNoToken(response)
  })

  test('非法 id → 400（参数校验前置，保留现有 id 校验）', async () => {
    const { fetchDetail } = await makeFixture()

    const response = await fetchDetail('abc', basicAuthHeader('alice', 'correct-horse'))

    expect(response.status).toBe(400)
    const body = await expectNoToken(response)
    expect(body).toMatchObject({
      error: 'Bad Request',
      errorCode: 400,
      errorDescription: 'Invalid id parameter: must be a positive integer'
    })
  })
})
