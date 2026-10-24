








import { ClientHandlers } from '../../src/handlers/clientHandlers'
import { resolveTokenForLookup } from '../../src/utils/enhancedToken'
import { clients } from '../../src/models'

jest.mock('../../src/plugins/manager.ts', () => ({
  PluginManager: class {
    async emit(): Promise<void> {}
  }
}))

const FAKE_ROW = {
  id: 11,
  userId: 7,
  token: 'Cnewtoken',
  name: 'Pixel 9',
  platform: 'fixture_a',
  deviceUid: 'device-abc',
  deviceToken: 'new-push-token',
  tokenUpdatedAt: '2026-09-24T00:00:00.000Z',
  tokenStatus: 'active',
  appVersion: null,
  deviceModel: null,
  lastUsed: null,
  elevatedUntil: null
}

function createShapeMock() {
  const calls: string[] = []
  const seen: { conflictConfig: any; valuesPayload: any } = { conflictConfig: null, valuesPayload: null }

  const builder: any = {
    values(payload: any) {
      seen.valuesPayload = payload
      return builder
    },
    onConflictDoUpdate(cfg: { target: unknown; set: unknown }) {
      calls.push('onConflictDoUpdate')
      seen.conflictConfig = cfg

      expect(Array.isArray(cfg.target)).toBe(true)
      expect(cfg.target).toHaveLength(2)
      expect(cfg.target).toEqual([clients.userId, clients.deviceUid])
      expect(typeof cfg.set).toBe('object')
      return builder
    },
    returning: () => Promise.resolve([FAKE_ROW])
  }

  return {
    calls,
    seen,
    drizzle: {
      select: () => {
        calls.push('select')
        throw new Error('device upsert path must not pre-SELECT')
      },
      update: () => {
        calls.push('update')
        return { set: () => ({ where: () => Promise.resolve() }) }
      },
      insert: () => {
        calls.push('insert')
        return builder
      }
    }
  }
}


function joinedSqlText(fragment: any): string {
  expect(Array.isArray(fragment?.queryChunks)).toBe(true)
  return fragment.queryChunks
    .map((chunk: any) => {
      if (typeof chunk === 'string') return chunk

      if (Array.isArray(chunk?.value)) return chunk.value.join('')
      return ''
    })
    .join('')
}

describe('ClientHandlers device upsert statement shape', () => {
  test('raw D1 batch path returns the batch upsert row without a second insert', async () => {
    const calls: string[] = []
    const prepared = (sql: string) => ({ bind: (..._args: unknown[]) => ({ sql }) })
    const rawDb = {
      prepare: prepared,
      batch: async (statements: Array<{ sql: string }>) => {
        calls.push(...statements.map((statement) => statement.sql.startsWith('UPDATE') ? 'claim' : 'upsert'))
        return [{ results: [] }, { results: [{
          id: 11,
          user_id: 7,
          token: 'Cnewtoken',
          name: 'Pixel 9',
          platform: 'fixture_a',
          device_uid: 'device-abc',
          device_token: 'new-push-token',
          token_updated_at: '2026-09-24T00:00:00.000Z',
          token_status: 'active',
          app_version: null,
          device_model: null,
          last_used: null,
          elevated_until: null
        }] }]
      }
    }
    const drizzle = {
      update: () => { throw new Error('raw batch path must not use drizzle update') },
      insert: () => { throw new Error('raw batch path must not use drizzle insert') }
    }
    const handlers = new ClientHandlers(drizzle as any, rawDb as any)
    const response = await handlers.createClient(7, {
      name: 'Pixel 9', platform: 'fixture_a', deviceUid: 'device-abc', deviceToken: 'new-push-token'
    })
    const body = await response.json() as any
    expect(response.status).toBe(200)
    expect(body.deviceToken).toBe('new-push-token')
    expect(body.deviceUid).toBe('device-abc')
    expect(calls).toEqual(['claim', 'upsert'])
  })

  test('with deviceToken: single INSERT + ON CONFLICT DO UPDATE, no pre-select, no UPDATE', async () => {
    const { calls, seen, drizzle } = createShapeMock()
    const handlers = new ClientHandlers(drizzle as any)

    const res = await handlers.createClient(7, {
      name: 'Pixel 9',
      platform: 'fixture_a',
      deviceUid: 'device-abc',
      deviceToken: 'new-push-token'
    })
    const body = await res.json() as any

    expect(res.status).toBe(200)

    expect(body.token).toMatch(/^gtfyc\.[A-Za-z0-9\-_]{43}$/)
    expect(seen.valuesPayload.token).toMatch(/^gtfyc\.[A-Za-z0-9\-_]{43}$/)
    expect(body.token).not.toBe(seen.valuesPayload.token)
    await expect(resolveTokenForLookup(body.token)).resolves.toBe(seen.valuesPayload.token)

    expect(calls).toEqual(['update', 'insert', 'onConflictDoUpdate'])

    const set = seen.conflictConfig.set as Record<string, any>
    expect(Object.keys(set).sort()).toEqual(
      ['appVersion', 'deviceModel', 'deviceToken', 'expiresAfterInactivitySeconds', 'expiresAt', 'platform', 'token', 'tokenStatus', 'tokenUpdatedAt'].sort()
    )


    expect(set.token).toBe(seen.valuesPayload.token)


    expect(set.expiresAfterInactivitySeconds).toBe(seen.valuesPayload.expiresAfterInactivitySeconds)
    expect(set.expiresAt).toBe(seen.valuesPayload.expiresAt)

    expect(set).not.toHaveProperty('name')

    expect(set.tokenStatus).toBe('active')

    expect(seen.valuesPayload.tokenStatus).toBe('active')
    expect(seen.valuesPayload.deviceToken).toBe('new-push-token')
    expect(typeof seen.valuesPayload.tokenUpdatedAt).toBe('string')
  })

  test('without deviceToken: SET 不触及 deviceToken/tokenUpdatedAt，状态 CASE 保留已知降级值', async () => {
    const { calls, seen, drizzle } = createShapeMock()
    const handlers = new ClientHandlers(drizzle as any)

    const res = await handlers.createClient(7, {
      name: 'Pixel 9',
      platform: 'fixture_a',
      deviceUid: 'device-abc',
      appVersion: '   '
    })
    expect(res.status).toBe(200)

    expect(calls).toEqual(['insert', 'onConflictDoUpdate'])

    const set = seen.conflictConfig.set as Record<string, any>

    expect(set).not.toHaveProperty('deviceToken')
    expect(set).not.toHaveProperty('tokenUpdatedAt')

    expect(joinedSqlText(set.tokenStatus)).toContain('CASE WHEN')
    expect(joinedSqlText(set.tokenStatus)).toContain("IN ('invalid', 'expired')")

    expect(set.appVersion).toBeNull()
    expect(seen.valuesPayload.appVersion).toBeNull()
    expect(seen.valuesPayload.deviceToken).toBeNull()
    expect(seen.valuesPayload.tokenUpdatedAt).toBeNull()
  })
})

export {}
