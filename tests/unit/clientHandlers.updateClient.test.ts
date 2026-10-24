

















import { ClientHandlers } from '../../src/handlers/clientHandlers'
import { createTestDb, asDrizzle, seedClient } from '../helpers/testDb'
import { clients } from '../../src/models'
import { eq } from 'drizzle-orm'

const FIXED_PAST = '2020-01-01T00:00:00.000Z'

function makeHandlers() {
  const testDb = createTestDb()
  const handlers = new ClientHandlers(asDrizzle(testDb))
  return { testDb, handlers }
}

function getRow(testDb: ReturnType<typeof createTestDb>, id: number) {
  return testDb.db.select().from(clients).where(eq(clients.id, id)).all()[0]
}

describe('ClientHandlers updateClient', () => {
  test('name-only update keeps token, device fields, status and metadata (omitted fields are not cleared)', async () => {
    const { testDb, handlers } = makeHandlers()
    const seed = seedClient(testDb, {
      appVersion: '1.2.3',
      deviceModel: 'Pixel 9 Pro',
      tokenUpdatedAt: FIXED_PAST,
      tokenStatus: 'invalid',
      deviceToken: 'old-push-token'
    })

    const res = await handlers.updateClient(7, String(seed.id), { name: 'Renamed' })
    const body = await res.json() as any

    expect(res.status).toBe(200)
    expect(body.name).toBe('Renamed')
    expect(body.token).toBe(seed.token)
    expect(body.deviceUid).toBe('device-abc')
    expect(body.deviceToken).toBe('old-push-token')
    expect(body.tokenUpdatedAt).toBe(FIXED_PAST)
    expect(body.tokenStatus).toBe('invalid')

    const row = getRow(testDb, seed.id)
    expect(row.token).toBe(seed.token)
    expect(row.deviceUid).toBe('device-abc')
    expect(row.deviceToken).toBe('old-push-token')
    expect(row.tokenUpdatedAt).toBe(FIXED_PAST)
    expect(row.tokenStatus).toBe('invalid')
    expect(row.appVersion).toBe('1.2.3')
    expect(row.deviceModel).toBe('Pixel 9 Pro')
  })

  test('updates only deviceUid when submitted alone', async () => {
    const { testDb, handlers } = makeHandlers()
    const seed = seedClient(testDb, { tokenUpdatedAt: FIXED_PAST, tokenStatus: 'active', deviceToken: 'old-push-token' })

    const res = await handlers.updateClient(7, String(seed.id), {
      name: 'Renamed',
      deviceUid: '  device-new  '
    })
    const body = await res.json() as any

    expect(res.status).toBe(200)
    expect(body.deviceUid).toBe('device-new')
    expect(body.token).toBe(seed.token)

    const row = getRow(testDb, seed.id)
    expect(row.deviceUid).toBe('device-new')
    expect(row.deviceToken).toBe('old-push-token')
    expect(row.tokenUpdatedAt).toBe(FIXED_PAST)
    expect(row.tokenStatus).toBe('active')
  })

  test('updates only deviceToken when submitted alone', async () => {
    const { testDb, handlers } = makeHandlers()
    const seed = seedClient(testDb, { tokenUpdatedAt: FIXED_PAST, tokenStatus: 'active' })

    const res = await handlers.updateClient(7, String(seed.id), {
      name: 'Renamed',
      deviceToken: '  fresh-push-token  '
    })
    const body = await res.json() as any

    expect(res.status).toBe(200)
    expect(body.deviceToken).toBe('fresh-push-token')
    expect(body.tokenUpdatedAt).not.toBe(FIXED_PAST)
    expect(body.token).toBe(seed.token)

    const row = getRow(testDb, seed.id)
    expect(row.deviceToken).toBe('fresh-push-token')
    expect(row.deviceUid).toBe('device-abc')
    expect(row.tokenUpdatedAt).not.toBe(FIXED_PAST)
    expect(row.tokenStatus).toBe('active')
  })

  test('updates deviceUid and deviceToken together', async () => {
    const { testDb, handlers } = makeHandlers()
    const seed = seedClient(testDb, { tokenStatus: 'expired', tokenUpdatedAt: FIXED_PAST })

    const res = await handlers.updateClient(7, String(seed.id), {
      name: 'Renamed',
      deviceUid: 'device-2',
      deviceToken: 'push-2'
    })
    const body = await res.json() as any

    expect(res.status).toBe(200)
    expect(body.token).toBe(seed.token)

    const row = getRow(testDb, seed.id)
    expect(row.deviceUid).toBe('device-2')
    expect(row.deviceToken).toBe('push-2')
    expect(row.tokenUpdatedAt).not.toBe(FIXED_PAST)
    expect(row.tokenStatus).toBe('active')
  })

  test('null clears deviceUid and deviceToken; tokenStatus keeps its value and tokenUpdatedAt is nulled', async () => {

    for (const status of ['active', 'inactive', 'invalid', 'expired'] as const) {
      const { testDb, handlers } = makeHandlers()
      const seed = seedClient(testDb, { tokenStatus: status, tokenUpdatedAt: FIXED_PAST })

      const res = await handlers.updateClient(7, String(seed.id), {
        name: 'Renamed',
        deviceUid: null,
        deviceToken: null
      })
      const body = await res.json() as any

      expect(res.status).toBe(200)
      expect(body.deviceUid).toBeNull()
      expect(body.deviceToken).toBeNull()
      expect(body.tokenUpdatedAt).toBeNull()
      expect(body.tokenStatus).toBe(status)
      expect(body.token).toBe(seed.token)

      const row = getRow(testDb, seed.id)
      expect(row.deviceUid).toBeNull()
      expect(row.deviceToken).toBeNull()
      expect(row.tokenUpdatedAt).toBeNull()
      expect(row.tokenStatus).toBe(status)
      expect(row.token).toBe(seed.token)
    }
  })

  test('deviceUid conflicting with another client of the same user returns 409 without partial update', async () => {
    const { testDb, handlers } = makeHandlers()
    seedClient(testDb, { deviceUid: 'device-abc', name: 'Device A' })
    const other = seedClient(testDb, {
      deviceUid: 'device-other',
      name: 'Device B',
      deviceToken: 'push-b',
      tokenStatus: 'inactive'
    })

    const res = await handlers.updateClient(7, String(other.id), {
      name: 'Hijacked Name',
      deviceUid: 'device-abc',
      deviceToken: 'hijack-token'
    })
    const body = await res.json() as any

    expect(res.status).toBe(409)
    expect(body.errorCode).toBe(409)


    const row = getRow(testDb, other.id)
    expect(row.name).toBe('Device B')
    expect(row.deviceUid).toBe('device-other')
    expect(row.deviceToken).toBe('push-b')
    expect(row.tokenStatus).toBe('inactive')
  })

  test('returns 404 when the client belongs to another user', async () => {
    const { testDb, handlers } = makeHandlers()
    const seed = seedClient(testDb, { userId: 8 })

    const res = await handlers.updateClient(7, String(seed.id), { name: 'Renamed' })
    expect(res.status).toBe(404)
    expect(getRow(testDb, seed.id).name).toBe('Old Device')
  })

  test('returns 404 for a nonexistent client id', async () => {
    const { testDb, handlers } = makeHandlers()
    const res = await handlers.updateClient(7, '9999', { name: 'Renamed' })
    expect(res.status).toBe(404)
  })

  test('returns 400 "Invalid client ID" for a non-numeric id (NaN guard parity with updatePushState)', async () => {

    const { handlers } = makeHandlers()

    const res = await handlers.updateClient(7, 'abc', { name: 'X' })
    const body = await res.json() as any

    expect(res.status).toBe(400)
    expect(body.errorDescription).toBe('Invalid client ID')
  })

  test.each([
    ['missing name', {}],
    ['empty name', { name: '' }],
    ['non-string name', { name: 123 }],
    ['boolean name', { name: true }],
    ['whitespace-only deviceUid', { name: 'N', deviceUid: '   ' }],
    ['empty string deviceUid', { name: 'N', deviceUid: '' }],
    ['non-string deviceUid', { name: 'N', deviceUid: 42 }],
    ['object deviceUid', { name: 'N', deviceUid: { uid: 'x' } }],
    ['whitespace-only deviceToken', { name: 'N', deviceToken: '  ' }],
    ['empty string deviceToken', { name: 'N', deviceToken: '' }],
    ['non-string deviceToken', { name: 'N', deviceToken: false }],
    ['array deviceToken', { name: 'N', deviceToken: ['t'] }]
  ])('returns 400 for %s and leaves the row untouched', async (_label, payload) => {
    const { testDb, handlers } = makeHandlers()
    const seed = seedClient(testDb, { appVersion: '1.0', deviceToken: 'old-push-token' })

    const res = await handlers.updateClient(7, String(seed.id), payload)
    expect(res.status).toBe(400)

    const row = getRow(testDb, seed.id)
    expect(row.name).toBe('Old Device')
    expect(row.deviceUid).toBe('device-abc')
    expect(row.deviceToken).toBe('old-push-token')
  })

  test('whitespace-only non-empty name is stored as-is (gotify binding:"required" parity)', async () => {
    const { testDb, handlers } = makeHandlers()
    const seed = seedClient(testDb)

    const res = await handlers.updateClient(7, String(seed.id), { name: '   ' })
    const body = await res.json() as any

    expect(res.status).toBe(200)
    expect(body.name).toBe('   ')
    expect(getRow(testDb, seed.id).name).toBe('   ')
  })

  test('ignores unknown fields (token/platform are never writable via PUT)', async () => {
    const { testDb, handlers } = makeHandlers()
    const seed = seedClient(testDb, { platform: 'fixture_a', tokenStatus: 'active' })

    const res = await handlers.updateClient(7, String(seed.id), {
      name: 'Renamed',
      unknownField: { nested: true },
      token: 'client-token-hijack',
      platform: 'fixture_b'
    })
    const body = await res.json() as any

    expect(res.status).toBe(200)
    expect(body.name).toBe('Renamed')
    expect(body.token).toBe(seed.token)
    expect(body.platform).toBe('fixture_a')

    const row = getRow(testDb, seed.id)
    expect(row.token).toBe(seed.token)
    expect(row.platform).toBe('fixture_a')
  })

  test('accepts a full echoed Woe Client object without error and keeps the token', async () => {
    const { testDb, handlers } = makeHandlers()
    const seed = seedClient(testDb, {
      appVersion: '2.0.0',
      deviceModel: 'Mate 70',
      tokenUpdatedAt: FIXED_PAST,
      tokenStatus: 'active'
    })


    const res = await handlers.updateClient(7, String(seed.id), {
      id: seed.id,
      token: seed.token,
      name: 'Echoed Name',
      platform: 'fixture_b',
      deviceUid: 'device-abc',
      deviceToken: 'old-push-token',
      tokenUpdatedAt: FIXED_PAST,
      tokenStatus: 'active',
      appVersion: '2.0.0',
      deviceModel: 'Mate 70',
      lastUsed: '2026-01-01T00:00:00.000Z',
      elevatedUntil: null,
      expiresAfterInactivitySeconds: 432000
    })
    const body = await res.json() as any

    expect(res.status).toBe(200)
    expect(body.name).toBe('Echoed Name')
    expect(body.token).toBe(seed.token)
    expect(body.platform).toBe('fixture_a')

    const row = getRow(testDb, seed.id)
    expect(row.token).toBe(seed.token)
    expect(row.platform).toBe('fixture_a')
    expect(row.appVersion).toBe('2.0.0')
    expect(row.deviceModel).toBe('Mate 70')

    expect(row.expiresAfterInactivitySeconds).toBe(432000)
  })

  test('fresh deviceToken reactivates invalid/expired clients', async () => {
    for (const degraded of ['invalid', 'expired'] as const) {
      const { testDb, handlers } = makeHandlers()
      const seed = seedClient(testDb, { tokenStatus: degraded, tokenUpdatedAt: FIXED_PAST })

      const res = await handlers.updateClient(7, String(seed.id), {
        name: 'Renamed',
        deviceToken: 'fresh-token'
      })
      const body = await res.json() as any

      expect(res.status).toBe(200)
      expect(body.tokenStatus).toBe('active')

      const row = getRow(testDb, seed.id)
      expect(row.tokenStatus).toBe('active')
      expect(row.deviceToken).toBe('fresh-token')
      expect(row.tokenUpdatedAt).not.toBe(FIXED_PAST)
      expect(row.token).toBe(seed.token)
    }
  })

  test('fresh deviceToken keeps inactive clients inactive', async () => {
    const { testDb, handlers } = makeHandlers()
    const seed = seedClient(testDb, { tokenStatus: 'inactive', tokenUpdatedAt: FIXED_PAST })

    const res = await handlers.updateClient(7, String(seed.id), {
      name: 'Renamed',
      deviceToken: 'fresh-token'
    })
    const body = await res.json() as any

    expect(res.status).toBe(200)
    expect(body.tokenStatus).toBe('inactive')
    expect(getRow(testDb, seed.id).tokenStatus).toBe('inactive')
  })

  test.each([
    ['array', ['name']],
    ['string', 'name'],
    ['number', 42],
    ['boolean', true],
    ['null', null]
  ])('returns 400 "Invalid JSON body" for %s body', async (_label, payload) => {
    const { testDb, handlers } = makeHandlers()
    const seed = seedClient(testDb)

    const res = await handlers.updateClient(7, String(seed.id), payload)
    const body = await res.json() as any

    expect(res.status).toBe(400)
    expect(body.errorDescription).toBe('Invalid JSON body')
    expect(getRow(testDb, seed.id).name).toBe('Old Device')
  })
})

describe('409 错误识别（结构化，不依赖 instanceof）', () => {

  function rejectingDrizzleMock(reason: unknown) {
    return {
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            returning: jest.fn(() => Promise.reject(reason))
          }))
        }))
      }))
    }
  }

  async function callUpdateClient(reason: unknown) {
    const handlers = new ClientHandlers(rejectingDrizzleMock(reason) as any)
    return handlers.updateClient(7, '1', { name: 'Renamed' })
  }

  test('drizzle 包装错误（cause 链一层）：外层非约束信息，cause 携带复合索引冲突 → 409', async () => {
    const wrapped = Object.assign(new Error('wrapped failure'), {
      cause: Object.assign(new Error('UNIQUE constraint failed: clients.user_id, clients.device_uid'), {
        name: 'SqliteError'
      })
    })

    const res = await callUpdateClient(wrapped)
    const body = await res.json() as any

    expect(res.status).toBe(409)
    expect(body.errorCode).toBe(409)
  })

  test('错误约束（clients.token 唯一，非复合索引）→ 500 而非 409', async () => {
    const res = await callUpdateClient(new Error('UNIQUE constraint failed: clients.token'))

    expect(res.status).toBe(500)
  })

  test('非对象 throw（字符串 "boom"）→ 500 且不崩溃', async () => {
    const res = await callUpdateClient('boom')

    expect(res.status).toBe(500)
  })

  test('嵌套两层 cause 携带复合索引冲突 → 409', async () => {
    const sqliteLike = Object.assign(new Error('UNIQUE constraint failed: clients.user_id, clients.device_uid'), {
      name: 'SqliteError'
    })
    const level1 = Object.assign(new Error('drizzle wrapper'), { cause: sqliteLike })
    const level0 = Object.assign(new Error('outer wrapper'), { cause: level1 })

    const res = await callUpdateClient(level0)
    const body = await res.json() as any

    expect(res.status).toBe(409)
    expect(body.errorCode).toBe(409)
  })
})

export {}
