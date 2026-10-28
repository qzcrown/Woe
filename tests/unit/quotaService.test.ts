





import { eq } from 'drizzle-orm'
import { createPluginJobsTestDb } from '../helpers/pluginJobsTestDb'
import { asDrizzle } from '../helpers/testDb'
import type { TestDb } from '../helpers/testDb'
import { pluginConfigs, systemState } from '../../src/models'
import {
  DEFAULT_DAILY_LIMIT,
  QuotaService,
  type QuotaServiceEnv
} from '../../src/services/quota/quotaService'

function utcToday(): string {
  return new Date().toISOString().slice(0, 10)
}

interface MemoryKvOptions {
  initial?: Record<string, string>
  failGet?: boolean
  failPut?: boolean
}

function createMemoryKv(options: MemoryKvOptions = {}) {
  const store = new Map<string, string>(Object.entries(options.initial ?? {}))
  const kv = {
    async get(key: string): Promise<string | null> {
      if (options.failGet) throw new Error('kv get failed')
      return store.get(key) ?? null
    },
    async put(key: string, value: string): Promise<void> {
      if (options.failPut) throw new Error('kv put failed')
      store.set(key, value)
    },
    async delete(key: string): Promise<void> {
      store.delete(key)
    }
  }
  return { kv, store }
}

function quotaEnv(overrides: QuotaServiceEnv = {}): QuotaServiceEnv {
  return { ...overrides }
}

function seedPlugin(
  testDb: TestDb,
  overrides: Partial<typeof pluginConfigs.$inferInsert> = {}
): typeof pluginConfigs.$inferSelect {
  const [row] = testDb.db
    .insert(pluginConfigs)
    .values({
      userId: 7,
      name: 'quota-task',
      token: 'token-ai',
      modulePath: 'test/public-task',
      enabled: 1,
      usageCount: 0,
      ...overrides
    })
    .returning()
    .all()
  return row
}

function seedSystemState(testDb: TestDb, key: string, value: string): void {
  testDb.db.insert(systemState).values({ key, value }).run()
}

describe('QuotaService: 限额解析', () => {
  let testDb: TestDb
  let drizzle: ReturnType<typeof asDrizzle>
  let pluginId: number

  beforeEach(() => {
    testDb = createPluginJobsTestDb()
    drizzle = asDrizzle(testDb)
    pluginId = seedPlugin(testDb).id
  })

  test(`无 system_state、无 KV 覆盖时默认 ${DEFAULT_DAILY_LIMIT}`, async () => {
    const service = new QuotaService(drizzle, quotaEnv(), ['ai'])

    await expect(service.check('ai', 7, pluginId)).resolves.toEqual({
      status: 'ok',
      limit: DEFAULT_DAILY_LIMIT,
      used: 0,
      source: 'default'
    })
  })

  test('system_state 缺键 -> 默认 1000', async () => {
    seedSystemState(testDb, 'other_key', '5')
    const service = new QuotaService(drizzle, quotaEnv(), ['ai'])

    const result = await service.check('ai', 7, pluginId)
    expect(result).toMatchObject({ status: 'ok', limit: DEFAULT_DAILY_LIMIT, source: 'default' })
  })

  test('system_state 覆盖默认限额', async () => {
    seedSystemState(testDb, 'ai_user_daily_limit', '42')
    const service = new QuotaService(drizzle, quotaEnv(), ['ai'])

    await expect(service.check('ai', 7, pluginId)).resolves.toEqual({
      status: 'ok',
      limit: 42,
      used: 0,
      source: 'default'
    })
  })

  test('KV 覆盖优先于 system_state', async () => {
    seedSystemState(testDb, 'ai_user_daily_limit', '42')
    const { kv } = createMemoryKv({ initial: { 'ai:limit:7': '5' } })
    const service = new QuotaService(drizzle, quotaEnv({ QUOTA_KV: kv as unknown as KVNamespace }), ['ai'])

    await expect(service.check('ai', 7, pluginId)).resolves.toEqual({
      status: 'ok',
      limit: 5,
      used: 0,
      source: 'override'
    })
  })

  test('覆盖 "0" -> limit 0 -> exceeded（0 是合法禁用值）', async () => {
    const { kv } = createMemoryKv({ initial: { 'ai:limit:7': '0' } })
    const service = new QuotaService(drizzle, quotaEnv({ QUOTA_KV: kv as unknown as KVNamespace }), ['ai'])

    await expect(service.check('ai', 7, pluginId)).resolves.toEqual({
      status: 'exceeded',
      limit: 0,
      used: 0,
      source: 'override'
    })
  })

  test('删除覆盖后回落默认', async () => {
    const { kv, store } = createMemoryKv({ initial: { 'ai:limit:7': '5' } })
    const service = new QuotaService(drizzle, quotaEnv({ QUOTA_KV: kv as unknown as KVNamespace }), ['ai'])

    await expect(service.setUserOverride('ai', 7, null)).resolves.toEqual({ status: 'ok' })
    expect(store.has('ai:limit:7')).toBe(false)
    await expect(service.check('ai', 7, pluginId)).resolves.toMatchObject({
      status: 'ok',
      limit: DEFAULT_DAILY_LIMIT,
      source: 'default'
    })
  })

  test.each(['-1', 'abc', '1.5', '', ' 5x'])('非法覆盖值 %p -> invalid-limit（不回落默认）', async (raw) => {
    const { kv } = createMemoryKv({ initial: { 'ai:limit:7': raw } })
    const service = new QuotaService(drizzle, quotaEnv({ QUOTA_KV: kv as unknown as KVNamespace }), ['ai'])

    await expect(service.check('ai', 7, pluginId)).resolves.toEqual({ status: 'invalid-limit' })
    await expect(service.describeUserQuota('ai', 7, pluginId)).resolves.toEqual({
      ok: false,
      reason: 'invalid-limit'
    })
  })

  test.each(['-1', 'abc', '1.5'])('非法 system_state 默认值 %p -> invalid-limit', async (raw) => {
    seedSystemState(testDb, 'ai_user_daily_limit', raw)
    const service = new QuotaService(drizzle, quotaEnv(), ['ai'])

    await expect(service.check('ai', 7, pluginId)).resolves.toEqual({ status: 'invalid-limit' })
    await expect(service.describeUserQuota('ai', 7, pluginId)).resolves.toEqual({
      ok: false,
      reason: 'invalid-limit'
    })
  })

  test('KV 读取抛错 -> read-failed', async () => {
    const { kv } = createMemoryKv({ failGet: true })
    const service = new QuotaService(drizzle, quotaEnv({ QUOTA_KV: kv as unknown as KVNamespace }), ['ai'])

    await expect(service.check('ai', 7, pluginId)).resolves.toEqual({ status: 'read-failed' })
    await expect(service.describeUserQuota('ai', 7, pluginId)).resolves.toEqual({
      ok: false,
      reason: 'read-failed'
    })
  })

  test('usage 读取失败（插件行不存在）-> read-failed', async () => {
    const service = new QuotaService(drizzle, quotaEnv(), ['ai'])
    await expect(service.check('ai', 7, 999999)).resolves.toEqual({ status: 'read-failed' })
  })

  test('不支持的 namespace 视为配置错误（抛错）', async () => {
    const service = new QuotaService(drizzle, quotaEnv(), ['ai'])
    await expect(service.check('billing', 7, pluginId)).rejects.toThrow(/namespace/)
    await expect(service.consume('billing', 7, pluginId, true)).rejects.toThrow(/namespace/)
  })
})

describe('QuotaService: 用量与 UTC 日切换', () => {
  let testDb: TestDb
  let drizzle: ReturnType<typeof asDrizzle>
  let pluginId: number

  beforeEach(() => {
    testDb = createPluginJobsTestDb()
    drizzle = asDrizzle(testDb)
    pluginId = seedPlugin(testDb).id
  })

  function usageRow(): { usageDay: string | null; usageCount: number; updatedAt: string } {
    const [row] = testDb.db
      .select({
        usageDay: pluginConfigs.usageDay,
        usageCount: pluginConfigs.usageCount,
        updatedAt: pluginConfigs.updatedAt
      })
      .from(pluginConfigs)
      .where(eq(pluginConfigs.id, pluginId))
      .all()
    return row
  }

  test('旧 UTC 日 usage_day -> used 0（只读，不改库）', async () => {
    testDb.db
      .update(pluginConfigs)
      .set({ usageDay: '2020-01-01', usageCount: 42 })
      .where(eq(pluginConfigs.id, pluginId))
      .run()
    const service = new QuotaService(drizzle, quotaEnv(), ['ai'])

    await expect(service.check('ai', 7, pluginId)).resolves.toMatchObject({ status: 'ok', used: 0 })
    expect(usageRow()).toMatchObject({ usageDay: '2020-01-01', usageCount: 42 })
  })

  test('同一 UTC 日 -> 返回 usage_count', async () => {
    testDb.db
      .update(pluginConfigs)
      .set({ usageDay: utcToday(), usageCount: 3 })
      .where(eq(pluginConfigs.id, pluginId))
      .run()
    const service = new QuotaService(drizzle, quotaEnv(), ['ai'])

    await expect(service.check('ai', 7, pluginId)).resolves.toMatchObject({ used: 3 })
  })

  test('consumeUsage：旧日期重置为 1；同日连续两次为 2', async () => {
    const { QuotaUsageStore } = await import('../../src/services/quota/quotaUsageStore')
    const store = new QuotaUsageStore(drizzle)
    const today = utcToday()

    testDb.db
      .update(pluginConfigs)
      .set({ usageDay: '2020-01-01', usageCount: 42 })
      .where(eq(pluginConfigs.id, pluginId))
      .run()

    await expect(store.consumeUsage(pluginId, 7, today)).resolves.toBe(true)
    expect(usageRow()).toMatchObject({ usageDay: today, usageCount: 1 })

    await expect(store.consumeUsage(pluginId, 7, today)).resolves.toBe(true)
    expect(usageRow()).toMatchObject({ usageDay: today, usageCount: 2 })
  })

  test('consumeUsage 不改 plugin_configs.updated_at', async () => {
    testDb.db
      .update(pluginConfigs)
      .set({ updatedAt: '2020-01-01 00:00:00' })
      .where(eq(pluginConfigs.id, pluginId))
      .run()
    const { QuotaUsageStore } = await import('../../src/services/quota/quotaUsageStore')

    await new QuotaUsageStore(drizzle).consumeUsage(pluginId, 7, utcToday())
    expect(usageRow().updatedAt).toBe('2020-01-01 00:00:00')
  })

  test('readUsage 旧日期返回 0 且不写库', async () => {
    testDb.db
      .update(pluginConfigs)
      .set({ usageDay: '2020-01-01', usageCount: 9 })
      .where(eq(pluginConfigs.id, pluginId))
      .run()
    const { QuotaUsageStore } = await import('../../src/services/quota/quotaUsageStore')

    await expect(
      new QuotaUsageStore(drizzle).readUsage(pluginId, 7, utcToday())
    ).resolves.toBe(0)
    expect(usageRow()).toMatchObject({ usageDay: '2020-01-01', usageCount: 9 })
  })

  test('used == limit -> exceeded；used < limit -> ok', async () => {
    const { kv } = createMemoryKv({ initial: { 'ai:limit:7': '3' } })
    const service = new QuotaService(drizzle, quotaEnv({ QUOTA_KV: kv as unknown as KVNamespace }), ['ai'])

    testDb.db
      .update(pluginConfigs)
      .set({ usageDay: utcToday(), usageCount: 2 })
      .where(eq(pluginConfigs.id, pluginId))
      .run()
    await expect(service.check('ai', 7, pluginId)).resolves.toMatchObject({
      status: 'ok',
      limit: 3,
      used: 2
    })

    testDb.db
      .update(pluginConfigs)
      .set({ usageCount: 3 })
      .where(eq(pluginConfigs.id, pluginId))
      .run()
    await expect(service.check('ai', 7, pluginId)).resolves.toMatchObject({
      status: 'exceeded',
      limit: 3,
      used: 3
    })
  })
})

describe('QuotaService: consume 软限额语义', () => {
  let testDb: TestDb
  let drizzle: ReturnType<typeof asDrizzle>
  let pluginId: number

  beforeEach(() => {
    testDb = createPluginJobsTestDb()
    drizzle = asDrizzle(testDb)
    pluginId = seedPlugin(testDb).id
  })

  test('quotaConsumed=false -> skipped 且不写库', async () => {
    const service = new QuotaService(drizzle, quotaEnv(), ['ai'])

    await expect(service.consume('ai', 7, pluginId, false)).resolves.toEqual({ status: 'skipped' })
    const [row] = testDb.db.select().from(pluginConfigs).where(eq(pluginConfigs.id, pluginId)).all()
    expect(row.usageDay).toBeNull()
    expect(row.usageCount).toBe(0)
  })

  test('quotaConsumed=true -> 写入当前日 +1', async () => {
    const service = new QuotaService(drizzle, quotaEnv(), ['ai'])

    await expect(service.consume('ai', 7, pluginId, true)).resolves.toEqual({ status: 'consumed' })
    const [row] = testDb.db.select().from(pluginConfigs).where(eq(pluginConfigs.id, pluginId)).all()
    expect(row.usageDay).toBe(utcToday())
    expect(row.usageCount).toBe(1)
  })

  test('usage 写失败 -> write-failed（不抛错、不影响调用方）', async () => {
    const service = new QuotaService(drizzle, quotaEnv(), ['ai'])
    await expect(service.consume('ai', 7, 999999, true)).resolves.toEqual({
      status: 'write-failed'
    })
  })

  test('超出软限额时 consume 仍成功（配额是 advisory）', async () => {
    const { kv } = createMemoryKv({ initial: { 'ai:limit:7': '0' } })
    const service = new QuotaService(drizzle, quotaEnv({ QUOTA_KV: kv as unknown as KVNamespace }), ['ai'])

    await expect(service.check('ai', 7, pluginId)).resolves.toMatchObject({ status: 'exceeded' })
    await expect(service.consume('ai', 7, pluginId, true)).resolves.toEqual({ status: 'consumed' })
  })
})

describe('QuotaService: describeUserQuota / setUserOverride', () => {
  let testDb: TestDb
  let drizzle: ReturnType<typeof asDrizzle>
  let pluginId: number

  beforeEach(() => {
    testDb = createPluginJobsTestDb()
    drizzle = asDrizzle(testDb)
    pluginId = seedPlugin(testDb, {
      usageDay: '2020-01-01',
      usageCount: 3
    }).id
    seedSystemState(testDb, 'ai_user_daily_limit', '42')
  })

  test('describeUserQuota 返回 default/override/effective/usage 与 source', async () => {
    const { kv } = createMemoryKv({ initial: { 'ai:limit:7': '5' } })
    const service = new QuotaService(drizzle, quotaEnv({ QUOTA_KV: kv as unknown as KVNamespace }), ['ai'])

    await expect(service.describeUserQuota('ai', 7, pluginId)).resolves.toEqual({
      ok: true,
      defaultLimit: 42,
      overrideLimit: 5,
      effectiveLimit: 5,
      usageDay: '2020-01-01',
      usageCount: 3,
      usageToday: 0,
      source: 'override'
    })
  })

  test('describeUserQuota 无覆盖时为 null，source=default', async () => {
    const service = new QuotaService(drizzle, quotaEnv(), ['ai'])

    await expect(service.describeUserQuota('ai', 7, pluginId)).resolves.toMatchObject({
      ok: true,
      overrideLimit: null,
      effectiveLimit: 42,
      source: 'default'
    })
  })

  test('同 UTC 日 usageToday 等于 usageCount', async () => {
    testDb.db
      .update(pluginConfigs)
      .set({ usageDay: utcToday(), usageCount: 3 })
      .where(eq(pluginConfigs.id, pluginId))
      .run()
    const service = new QuotaService(drizzle, quotaEnv(), ['ai'])

    await expect(service.describeUserQuota('ai', 7, pluginId)).resolves.toMatchObject({
      ok: true,
      usageDay: utcToday(),
      usageCount: 3,
      usageToday: 3
    })
  })

  test('setUserOverride 写入 KV；0 与正整数字符串化', async () => {
    const { kv, store } = createMemoryKv()
    const service = new QuotaService(drizzle, quotaEnv({ QUOTA_KV: kv as unknown as KVNamespace }), ['ai'])

    await expect(service.setUserOverride('ai', 7, 0)).resolves.toEqual({ status: 'ok' })
    expect(store.get('ai:limit:7')).toBe('0')

    await expect(service.setUserOverride('ai', 7, 25)).resolves.toEqual({ status: 'ok' })
    expect(store.get('ai:limit:7')).toBe('25')
  })

  test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'setUserOverride 非法值 %p -> invalid',
    async (limit) => {
      const { kv, store } = createMemoryKv()
      const service = new QuotaService(drizzle, quotaEnv({ QUOTA_KV: kv as unknown as KVNamespace }), ['ai'])

      await expect(service.setUserOverride('ai', 7, limit)).resolves.toEqual({ status: 'invalid' })
      expect(store.size).toBe(0)
    }
  )

  test('setUserOverride KV 写失败 -> write-failed', async () => {
    const { kv } = createMemoryKv({ failPut: true })
    const service = new QuotaService(drizzle, quotaEnv({ QUOTA_KV: kv as unknown as KVNamespace }), ['ai'])

    await expect(service.setUserOverride('ai', 7, 10)).resolves.toEqual({
      status: 'write-failed'
    })
  })
})

describe('QuotaService: describeNamespaceQuotas 批量读取', () => {
  let testDb: TestDb
  let drizzle: ReturnType<typeof asDrizzle>
  let pluginA: number
  let pluginB: number

  beforeEach(() => {
    testDb = createPluginJobsTestDb()
    drizzle = asDrizzle(testDb)
    pluginA = seedPlugin(testDb, { userId: 7 }).id
    pluginB = seedPlugin(testDb, { userId: 8 }).id
    seedSystemState(testDb, 'ai_user_daily_limit', '42')
  })

  test('默认限额只读一次；逐行返回 override/usage/usageToday', async () => {
    const { kv } = createMemoryKv({ initial: { 'ai:limit:8': '5' } })
    const service = new QuotaService(drizzle, quotaEnv({ QUOTA_KV: kv as unknown as KVNamespace }), ['ai'])
    const readDefaultLimit = jest.spyOn(service as any, 'readDefaultLimit')
    const today = utcToday()

    const result = await service.describeNamespaceQuotas('ai', [
      { userId: 7, pluginId: pluginA, usageDay: today, usageCount: 3 },
      { userId: 8, pluginId: pluginB, usageDay: '2020-01-01', usageCount: 9 }
    ])

    expect(readDefaultLimit).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      ok: true,
      rows: [
        {
          ok: true,
          defaultLimit: 42,
          overrideLimit: null,
          effectiveLimit: 42,
          usageDay: today,
          usageCount: 3,
          usageToday: 3,
          source: 'default'
        },
        {
          ok: true,
          defaultLimit: 42,
          overrideLimit: 5,
          effectiveLimit: 5,
          usageDay: '2020-01-01',
          usageCount: 9,
          usageToday: 0,
          source: 'override'
        }
      ]
    })
    readDefaultLimit.mockRestore()
  })

  test('任一行 KV 读失败 -> 整体 read-failed（不部分成功）', async () => {
    const kv = {
      async get(key: string): Promise<string | null> {
        if (key === 'ai:limit:8') throw new Error('kv down for one row')
        return null
      },
      async put(): Promise<void> {},
      async delete(): Promise<void> {}
    }
    const service = new QuotaService(drizzle, quotaEnv({ QUOTA_KV: kv as unknown as KVNamespace }), ['ai'])

    await expect(
      service.describeNamespaceQuotas('ai', [
        { userId: 7, pluginId: pluginA, usageDay: null, usageCount: 0 },
        { userId: 8, pluginId: pluginB, usageDay: null, usageCount: 0 }
      ])
    ).resolves.toEqual({ ok: false, reason: 'read-failed' })
  })

  test('任一行非法覆盖值 -> 整体 invalid-limit', async () => {
    const { kv } = createMemoryKv({ initial: { 'ai:limit:8': 'abc' } })
    const service = new QuotaService(drizzle, quotaEnv({ QUOTA_KV: kv as unknown as KVNamespace }), ['ai'])

    await expect(
      service.describeNamespaceQuotas('ai', [
        { userId: 7, pluginId: pluginA, usageDay: null, usageCount: 0 },
        { userId: 8, pluginId: pluginB, usageDay: null, usageCount: 0 }
      ])
    ).resolves.toEqual({ ok: false, reason: 'invalid-limit' })
  })

  test('system_state 读取失败 -> read-failed', async () => {
    const service = new QuotaService(drizzle, quotaEnv(), ['ai'])
    testDb.sqlite.exec('DROP TABLE system_state')

    await expect(
      service.describeNamespaceQuotas('ai', [
        { userId: 7, pluginId: pluginA, usageDay: null, usageCount: 0 }
      ])
    ).resolves.toEqual({ ok: false, reason: 'read-failed' })
  })

  test('空实例列表 -> ok:true 与空 rows', async () => {
    const service = new QuotaService(drizzle, quotaEnv(), ['ai'])

    await expect(service.describeNamespaceQuotas('ai', [])).resolves.toEqual({
      ok: true,
      rows: []
    })
  })
})

describe('QuotaService: 声明化 namespace 集合', () => {
  let testDb: TestDb
  let drizzle: ReturnType<typeof asDrizzle>
  let pluginId: number

  beforeEach(() => {
    testDb = createPluginJobsTestDb()
    drizzle = asDrizzle(testDb)
    pluginId = seedPlugin(testDb).id
    seedSystemState(testDb, 'vision_user_daily_limit', '7')
  })

  test('新增 namespace 由调用方声明：vision 与 ai 各自独立的默认/覆盖键', async () => {
    const { kv, store } = createMemoryKv({ initial: { 'vision:limit:7': '2' } })
    const service = new QuotaService(
      drizzle,
      quotaEnv({ QUOTA_KV: kv as unknown as KVNamespace }),
      ['ai', 'vision']
    )

    await expect(service.check('vision', 7, pluginId)).resolves.toMatchObject({
      status: 'ok',
      limit: 2,
      source: 'override'
    })
    await expect(service.setUserOverride('vision', 8, 5)).resolves.toEqual({ status: 'ok' })
    expect(store.get('vision:limit:8')).toBe('5')


    await expect(service.check('ai', 7, pluginId)).resolves.toMatchObject({
      status: 'ok',
      limit: DEFAULT_DAILY_LIMIT
    })
  })

  test('未声明的 namespace 仍拒绝（billing 不在 [ai, vision]）', async () => {
    const service = new QuotaService(drizzle, quotaEnv(), ['ai', 'vision'])

    await expect(service.check('billing', 7, pluginId)).rejects.toThrow(/namespace/)
    await expect(service.consume('billing', 7, pluginId, true)).rejects.toThrow(/namespace/)
    await expect(service.setUserOverride('billing', 7, 5)).rejects.toThrow(/namespace/)
  })

  test('零 namespace 集合拒绝一切 namespace（fail-closed，不回落全局默认）', async () => {
    const service = new QuotaService(drizzle, quotaEnv(), [])

    await expect(service.check('ai', 7, pluginId)).rejects.toThrow(/namespace/)
    await expect(service.consume('ai', 7, pluginId, true)).rejects.toThrow(/namespace/)
    await expect(service.describeUserQuota('ai', 7, pluginId)).rejects.toThrow(/namespace/)
    await expect(service.describeNamespaceQuotas('ai', [])).rejects.toThrow(/namespace/)
    await expect(service.setUserOverride('ai', 7, 5)).rejects.toThrow(/namespace/)
  })
})
