












import { ClientHandlers } from '../../src/handlers/clientHandlers'
import { Authenticator } from '../../src/middleware/auth'
import { resolveTokenForLookup } from '../../src/utils/enhancedToken'
import { createTestDb, asDrizzle, seedClient } from '../helpers/testDb'
import { clients } from '../../src/models'
import { and, eq } from 'drizzle-orm'

function makeHandlers() {
  const testDb = createTestDb()
  const handlers = new ClientHandlers(asDrizzle(testDb))
  return { testDb, handlers }
}


function makeRawDb(testDb: ReturnType<typeof createTestDb>) {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return { sql, args }
        }
      }
    },
    async batch(statements: Array<{ sql: string; args: unknown[] }>) {
      return statements.map((statement) => {
        const prepared = testDb.sqlite.prepare(statement.sql)
        if (statement.sql.trimStart().startsWith('UPDATE')) {
          prepared.run(...statement.args)
          return { results: [] }
        }
        return { results: prepared.all(...statement.args) }
      })
    }
  }
}

function getRows(testDb: ReturnType<typeof createTestDb>, userId: number, deviceUid: string) {
  return testDb.db
    .select()
    .from(clients)
    .where(and(eq(clients.userId, userId), eq(clients.deviceUid, deviceUid)))
    .all()
}

describe('ClientHandlers device upsert', () => {
  test('createClient updates device fields but preserves an existing display name on re-registration', async () => {
    const { testDb, handlers } = makeHandlers()
    const seed = seedClient(testDb, {
      name: 'Web Renamed',
      tokenUpdatedAt: '2020-01-01T00:00:00.000Z',
      appVersion: '1.0.0',
      deviceModel: 'Old Model'
    })

    const res = await handlers.createClient(7, {
      name: 'Pixel 9',
      platform: 'fixture_a',
      deviceUid: 'device-abc',
      deviceToken: 'new-push-token',
      appVersion: '  ',
      deviceModel: 'Pixel 9 Pro'
    })
    const body = await res.json() as any

    expect(res.status).toBe(200)
    expect(body.name).toBe('Web Renamed')
    expect(body.deviceUid).toBe('device-abc')

    const rows = getRows(testDb, 7, 'device-abc')
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(seed.id)
    expect(rows[0].name).toBe('Web Renamed')
    expect(rows[0].deviceToken).toBe('new-push-token')
    expect(rows[0].token).not.toBe(seed.token)
    expect(rows[0].tokenUpdatedAt).not.toBe('2020-01-01T00:00:00.000Z')
    expect(rows[0].tokenStatus).toBe('active')

    expect(rows[0].appVersion).toBeNull()
    expect(rows[0].deviceModel).toBe('Pixel 9 Pro')
  })

  test('createClient reactivates push when same device re-registers with a token', async () => {
    const { testDb, handlers } = makeHandlers()
    seedClient(testDb, { tokenStatus: 'inactive' })

    const res = await handlers.createClient(7, {
      name: 'Pixel 9',
      platform: 'fixture_a',
      deviceUid: 'device-abc',
      deviceToken: 'new-push-token'
    })
    const body = await res.json() as any

    expect(res.status).toBe(200)
    expect(body.tokenStatus).toBe('active')
    expect(getRows(testDb, 7, 'device-abc')[0].tokenStatus).toBe('active')
  })

  test('createClient reactivates invalid device when a fresh token is provided', async () => {

    for (const degraded of ['invalid', 'expired', 'weird'] as const) {
      const { testDb, handlers } = makeHandlers()
      seedClient(testDb, { tokenStatus: degraded })

      const res = await handlers.createClient(7, {
        name: 'Pixel 9',
        platform: 'fixture_a',
        deviceUid: 'device-abc',
        deviceToken: 'new-push-token'
      })
      const body = await res.json() as any

      expect(res.status).toBe(200)
      expect(body.tokenStatus).toBe('active')
      expect(getRows(testDb, 7, 'device-abc')[0].tokenStatus).toBe('active')
      expect(getRows(testDb, 7, 'device-abc')[0].deviceToken).toBe('new-push-token')
    }
  })

  test('createClient creates a new client when deviceUid does not exist', async () => {
    const { testDb, handlers } = makeHandlers()

    const res = await handlers.createClient(7, {
      name: 'Mate 70',
      platform: 'fixture_a',
      deviceUid: 'device-new',
      deviceToken: 'token-new'
    })
    const body = await res.json() as any

    expect(res.status).toBe(200)
    expect(body.name).toBe('Mate 70')
    expect(body.deviceUid).toBe('device-new')

    const rows = getRows(testDb, 7, 'device-new')
    expect(rows).toHaveLength(1)
    expect(rows[0].deviceToken).toBe('token-new')
    expect(rows[0].tokenStatus).toBe('active')
  })

  test.each(['drizzle', 'raw D1 batch'] as const)('same user re-registering with a new deviceUid can reclaim its existing device token (%s)', async (path) => {
    const testDb = createTestDb()
    const old = seedClient(testDb, {
      deviceUid: 'old-device-uid',
      deviceToken: 'stable-hms-token'
    })
    const handlers = new ClientHandlers(asDrizzle(testDb), path === 'raw D1 batch' ? makeRawDb(testDb) as any : undefined)

    const res = await handlers.createClient(7, {
      name: 'Reinstalled device',
      platform: 'fixture_a',
      deviceUid: 'new-device-uid',
      deviceToken: 'stable-hms-token'
    })
    const body = await res.json() as any

    expect(res.status).toBe(200)
    expect(body.deviceUid).toBe('new-device-uid')
    expect(body.deviceToken).toBe('stable-hms-token')

    const rows = testDb.db.select().from(clients).where(eq(clients.userId, 7)).all()
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.id === old.id)).toMatchObject({
      deviceUid: 'old-device-uid',
      deviceToken: null,
      tokenStatus: 'inactive'
    })
    expect(rows.find((row) => row.deviceUid === 'new-device-uid')).toMatchObject({
      deviceToken: 'stable-hms-token',
      tokenStatus: 'active'
    })
  })

  test('createClient normalizes unknown token_status to active when re-registering without deviceToken', async () => {
    const { testDb, handlers } = makeHandlers()

    seedClient(testDb, { tokenStatus: 'weird' })

    const res = await handlers.createClient(7, {
      name: 'Pixel 9',
      platform: 'fixture_a',
      deviceUid: 'device-abc'
    })
    const body = await res.json() as any

    expect(res.status).toBe(200)
    expect(body.tokenStatus).toBe('active')
    expect(getRows(testDb, 7, 'device-abc')[0].tokenStatus).toBe('active')
  })

  test('createClient without new deviceToken keeps old deviceToken, tokenUpdatedAt and degraded status', async () => {
    const fixedPast = '2021-05-05T05:05:05.005Z'

    for (const degraded of ['invalid', 'expired', 'inactive'] as const) {
      const { testDb, handlers } = makeHandlers()
      seedClient(testDb, {
        tokenStatus: degraded,
        deviceToken: 'kept-push-token',
        tokenUpdatedAt: fixedPast
      })

      const res = await handlers.createClient(7, {
        name: 'Renamed',
        platform: 'fixture_b',
        deviceUid: 'device-abc'
      })
      expect(res.status).toBe(200)

      const row = getRows(testDb, 7, 'device-abc')[0]
      expect(row.tokenStatus).toBe(degraded)
      expect(row.deviceToken).toBe('kept-push-token')
      expect(row.tokenUpdatedAt).toBe(fixedPast)
    }
  })

  test('registering the same device twice keeps one row and preserves its display name', async () => {
    const { testDb, handlers } = makeHandlers()

    const first = await handlers.createClient(7, {
      name: 'First Name',
      platform: 'fixture_a',
      deviceUid: 'device-xyz',
      deviceToken: 'push-1'
    })
    const firstBody = await first.json() as any
    expect(first.status).toBe(200)

    const second = await handlers.createClient(7, {
      name: 'Second Name',
      platform: 'fixture_a',
      deviceUid: 'device-xyz',
      deviceToken: 'push-2'
    })
    const secondBody = await second.json() as any
    expect(second.status).toBe(200)

    const rows = getRows(testDb, 7, 'device-xyz')
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('First Name')


    expect(rows[0].token).not.toBe(secondBody.token)
    await expect(resolveTokenForLookup(secondBody.token)).resolves.toBe(rows[0].token)
    await expect(resolveTokenForLookup(firstBody.token)).resolves.not.toBe(rows[0].token)
    expect(rows[0].deviceToken).toBe('push-2')
    expect(rows[0].id).toBe(firstBody.id)
  })

  test('createClient with a deviceToken but no deviceUid neither claims nor crashes (token dropped by design)', async () => {
    const { testDb, handlers } = makeHandlers()

    seedClient(testDb, { userId: 8, deviceUid: 'other-uid', deviceToken: 'claimed-token' })

    const res = await handlers.createClient(7, { name: 'No UID', platform: 'web', deviceToken: 'claimed-token' })
    const body = await res.json() as any

    expect(res.status).toBe(200)
    expect(body.deviceUid).toBeNull()
    expect(body.deviceToken).toBeNull()

    const otherRow = getRows(testDb, 8, 'other-uid')[0]
    expect(otherRow.deviceToken).toBe('claimed-token')
    expect(otherRow.tokenStatus).toBe('active')


    const res2 = await handlers.createClient(7, { name: 'No UID', platform: 'web', deviceToken: 'claimed-token' })
    expect(res2.status).toBe(200)
  })

  test('two registrations without deviceUid create two rows', async () => {
    const { testDb, handlers } = makeHandlers()

    const a = await handlers.createClient(7, { name: 'Browser A', platform: 'web' })
    const b = await handlers.createClient(7, { name: 'Browser B', platform: 'web' })
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)

    const rows = testDb.db.select().from(clients).where(eq(clients.userId, 7)).all()
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map(r => r.name))).toEqual(new Set(['Browser A', 'Browser B']))
    expect(rows.every(r => r.deviceUid === null)).toBe(true)
  })
})

describe('ClientHandlers device upsert 冲突路径过期列全量替换（最终评审）', () => {
  function makeSetup(path: 'drizzle' | 'raw D1 batch') {
    const testDb = createTestDb()

    testDb.sqlite.prepare('INSERT INTO users (id, name, admin, disabled) VALUES (?, ?, ?, ?)').run(7, 'user7', 0, 0)
    const handlers = new ClientHandlers(
      asDrizzle(testDb),
      path === 'raw D1 batch' ? (makeRawDb(testDb) as any) : undefined
    )
    const auth = new Authenticator(asDrizzle(testDb))
    return { testDb, handlers, auth }
  }

  test.each(['drizzle', 'raw D1 batch'] as const)(
    '已过期行重注册后新签 token 可认证（%s：expires_at 被替换而非残留）',
    async (path) => {
      const { testDb, handlers, auth } = makeSetup(path)
      seedClient(testDb, {
        expiresAfterInactivitySeconds: 600,
        expiresAt: new Date(Date.now() - 60_000).toISOString()
      })

      const res = await handlers.createClient(7, {
        name: 'Pixel 9',
        platform: 'fixture_a',
        deviceUid: 'device-abc',
        deviceToken: 'new-push-token'
      })
      const body = await res.json() as any
      expect(res.status).toBe(200)

      const row = getRows(testDb, 7, 'device-abc')[0]

      expect(row.expiresAfterInactivitySeconds).toBe(0)
      expect(row.expiresAt).toBeNull()

      await expect(resolveTokenForLookup(body.token)).resolves.toBe(row.token)
      const result = await auth.authenticate(new Request('http://localhost/client', {
        headers: { 'X-Gotify-Key': body.token }
      }))
      expect(result).toEqual({
        userId: 7,
        isAdmin: false,
        tokenType: 'client',
        resourceId: row.id,

        clientId: row.id,
        elevatedUntil: null,

        clientTokenLookup: row.token
      })
    }
  )

  test.each(['drizzle', 'raw D1 batch'] as const)(
    '冲突路径持久化请求中的 expiresAfterInactivitySeconds（%s：替换旧值而非忽略）',
    async (path) => {
      const { testDb, handlers } = makeSetup(path)
      seedClient(testDb, { expiresAfterInactivitySeconds: 0, expiresAt: null })

      const res = await handlers.createClient(7, {
        name: 'Pixel 9',
        platform: 'fixture_a',
        deviceUid: 'device-abc',
        deviceToken: 'new-push-token',
        expiresAfterInactivitySeconds: 3600
      })
      const body = await res.json() as any
      expect(res.status).toBe(200)

      const row = getRows(testDb, 7, 'device-abc')[0]
      expect(row.expiresAfterInactivitySeconds).toBe(3600)
      expect(new Date(row.expiresAt!).getTime()).toBeGreaterThan(Date.now() + 3500_000)
      expect(row.expiresAt).toBe(body.expiresAt)
    }
  )
})

export {}
