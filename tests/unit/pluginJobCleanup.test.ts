












import { eq } from 'drizzle-orm'
import type { TestDb } from '../helpers/testDb.ts'
import { asDrizzle } from '../helpers/testDb.ts'
import { createPluginJobsTestDb } from '../helpers/pluginJobsTestDb.ts'
import { pluginConfigs, pluginJobs, pluginLogs } from '../../src/models/index.ts'
import { cleanupPluginJobs } from '../../src/services/pluginJobs/cleanup.ts'

const USER_ID = 7
const NOW = new Date('2026-10-23T12:00:00.000Z')

function seedPluginRow(db: TestDb, modulePath: string) {
  const [row] = db.db
    .insert(pluginConfigs)
    .values({
      userId: USER_ID,
      name: 'Cleanup Fixture',
      token: `token-${Math.random().toString(36).slice(2)}`,
      modulePath,
      enabled: 1
    })
    .returning()
    .all()
  return row
}

function seedPendingJob(
  db: TestDb,
  pluginId: number,
  values: { subjectId: number; status?: string; createdAt?: string } = { subjectId: 1 }
) {
  const [row] = db.db
    .insert(pluginJobs)
    .values({
      userId: USER_ID,
      pluginId,
      subjectType: 'message',
      subjectId: values.subjectId,
      status: values.status ?? 'pending',
      createdAt: values.createdAt
    })
    .returning()
    .all()
  return row
}

function jobRow(db: TestDb, id: number) {
  return db.db.select().from(pluginJobs).where(eq(pluginJobs.id, id)).get()!
}

function logs(db: TestDb) {
  return db.db.select().from(pluginLogs).all()
}

describe('cleanupPluginJobs 缺失模块对账（空 task catalog、无 Queue binding）', () => {
  test('缺失模块的 fresh pending（<24h）下一 cron 即 failed/plugin-unavailable，而非 dead-timeout', async () => {
    const testDb = createPluginJobsTestDb()
    const plugin = seedPluginRow(testDb, 'test/cleanup-removed-module')
    const job = seedPendingJob(testDb, plugin.id, {
      subjectId: 101,
      createdAt: '2026-10-23 11:00:00'
    })

    const result = await cleanupPluginJobs(asDrizzle(testDb), NOW, {
      hasTaskDefinition: () => false
    })

    expect(result.unavailableFailed).toBe(1)
    expect(result.deadMarked).toBe(0)
    const row = jobRow(testDb, job.id)
    expect(row.status).toBe('failed')
    expect(row.lastErrorCode).toBe('plugin-unavailable')
    expect(row.lastErrorMessage).toBe('plugin is not available')
    expect(row.completedAt).not.toBeNull()

    expect(logs(testDb)).toHaveLength(1)
    expect(logs(testDb)[0]).toMatchObject({
      pluginId: plugin.id,
      userId: USER_ID,
      event: 'plugin_job.failed',
      status: 0,
      error: 'plugin-unavailable'
    })
  })

  test('配置行不存在的 pending 同样立即 failed/plugin-unavailable', async () => {
    const testDb = createPluginJobsTestDb()

    const job = seedPendingJob(testDb, 999_123, { subjectId: 102 })

    const result = await cleanupPluginJobs(asDrizzle(testDb), NOW, {
      hasTaskDefinition: () => true
    })

    expect(result.unavailableFailed).toBe(1)
    const row = jobRow(testDb, job.id)
    expect(row.status).toBe('failed')
    expect(row.lastErrorCode).toBe('plugin-unavailable')
    expect(logs(testDb)).toHaveLength(1)
  })

  test('已知模块 <24h 保持 pending、>24h 才 dead/dead-timeout（原逻辑不受对账影响）', async () => {
    const testDb = createPluginJobsTestDb()
    const plugin = seedPluginRow(testDb, 'test/cleanup-known-module')
    const fresh = seedPendingJob(testDb, plugin.id, {
      subjectId: 201,
      createdAt: '2026-10-23 11:00:00'
    })
    const stale = seedPendingJob(testDb, plugin.id, {
      subjectId: 202,
      createdAt: '2026-10-21 00:00:00'
    })

    const result = await cleanupPluginJobs(asDrizzle(testDb), NOW, {
      hasTaskDefinition: () => true
    })

    expect(result.unavailableFailed).toBe(0)
    expect(result.deadMarked).toBe(1)
    expect(jobRow(testDb, fresh.id).status).toBe('pending')
    const staleRow = jobRow(testDb, stale.id)
    expect(staleRow.status).toBe('dead')
    expect(staleRow.lastErrorCode).toBe('dead-timeout')
    expect(logs(testDb)).toHaveLength(1)
    expect(logs(testDb)[0]).toMatchObject({ event: 'plugin_job.dead', error: 'dead-timeout' })
  })

  test('终态行不被对账回写（只以 status=pending 为条件）', async () => {
    const testDb = createPluginJobsTestDb()
    const plugin = seedPluginRow(testDb, 'test/cleanup-terminal-kept')
    const failed = seedPendingJob(testDb, plugin.id, {
      subjectId: 301,
      status: 'failed',
      createdAt: '2026-10-23 11:00:00'
    })
    const success = seedPendingJob(testDb, plugin.id, {
      subjectId: 302,
      status: 'success',
      createdAt: '2026-10-23 11:00:00'
    })

    const result = await cleanupPluginJobs(asDrizzle(testDb), NOW, {
      hasTaskDefinition: () => false
    })

    expect(result.unavailableFailed).toBe(0)
    expect(jobRow(testDb, failed.id).status).toBe('failed')
    expect(jobRow(testDb, failed.id).lastErrorCode).toBeNull()
    expect(jobRow(testDb, success.id).status).toBe('success')
    expect(logs(testDb)).toHaveLength(0)
  })

  test('批次受限：每轮最多 10 批 × batchSize，剩余行下一轮继续', async () => {
    const testDb = createPluginJobsTestDb()
    const plugin = seedPluginRow(testDb, 'test/cleanup-batched')

    const jobs = Array.from({ length: 25 }, (_, i) =>
      seedPendingJob(testDb, plugin.id, { subjectId: 400 + i })
    )

    const first = await cleanupPluginJobs(asDrizzle(testDb), NOW, {
      hasTaskDefinition: () => false,
      batchSize: 2
    })

    expect(first.unavailableFailed).toBe(20)
    const statuses = jobs.map((job) => jobRow(testDb, job.id).status)
    expect(statuses.filter((s) => s === 'failed')).toHaveLength(20)
    expect(statuses.filter((s) => s === 'pending')).toHaveLength(5)

    expect(logs(testDb)).toHaveLength(20)


    const second = await cleanupPluginJobs(asDrizzle(testDb), NOW, {
      hasTaskDefinition: () => false,
      batchSize: 2
    })
    expect(second.unavailableFailed).toBe(5)
    expect(
      jobs.filter((job) => jobRow(testDb, job.id).status === 'pending')
    ).toHaveLength(0)
  })

  test('已知模块 pending 混布时对账跳过它们（cursor 分页不遗漏后置的缺失模块行）', async () => {
    const testDb = createPluginJobsTestDb()
    const knownPlugin = seedPluginRow(testDb, 'test/cleanup-mixed-known')
    const removedPlugin = seedPluginRow(testDb, 'test/cleanup-mixed-removed')
    const known = seedPendingJob(testDb, knownPlugin.id, {
      subjectId: 501,
      createdAt: '2026-10-23 11:00:00'
    })

    const removed = seedPendingJob(testDb, removedPlugin.id, {
      subjectId: 502,
      createdAt: '2026-10-23 11:00:00'
    })

    const result = await cleanupPluginJobs(asDrizzle(testDb), NOW, {
      hasTaskDefinition: (modulePath) => modulePath === 'test/cleanup-mixed-known',
      batchSize: 1
    })

    expect(result.unavailableFailed).toBe(1)
    expect(jobRow(testDb, known.id).status).toBe('pending')
    expect(jobRow(testDb, removed.id).status).toBe('failed')
    expect(jobRow(testDb, removed.id).lastErrorCode).toBe('plugin-unavailable')
  })

  test('超过 10 批的已知模块不消耗对账预算，后置 stale unknown 仍立即 failed', async () => {
    const testDb = createPluginJobsTestDb()
    const knownPlugin = seedPluginRow(testDb, 'test/cleanup-known-budget')
    const removedPlugin = seedPluginRow(testDb, 'test/cleanup-unknown-after-known')
    const known = Array.from({ length: 21 }, (_, i) =>
      seedPendingJob(testDb, knownPlugin.id, {
        subjectId: 600 + i,
        createdAt: '2026-10-23 11:00:00'
      })
    )
    const removed = seedPendingJob(testDb, removedPlugin.id, {
      subjectId: 699,
      createdAt: '2026-10-21 00:00:00'
    })

    const result = await cleanupPluginJobs(asDrizzle(testDb), NOW, {
      hasTaskDefinition: (modulePath) => modulePath === 'test/cleanup-known-budget',
      batchSize: 2
    })

    expect(result.unavailableFailed).toBe(1)
    expect(result.deadMarked).toBe(0)
    expect(known.every((job) => jobRow(testDb, job.id).status === 'pending')).toBe(true)
    expect(jobRow(testDb, removed.id)).toMatchObject({
      status: 'failed',
      lastErrorCode: 'plugin-unavailable'
    })
    expect(logs(testDb)).toHaveLength(1)
    expect(logs(testDb)[0]).toMatchObject({ event: 'plugin_job.failed', error: 'plugin-unavailable' })
  })

  test('超出本轮对账预算的 stale unknown 保持 pending，不得被 dead-timeout 回写', async () => {
    const testDb = createPluginJobsTestDb()
    const removedPlugin = seedPluginRow(testDb, 'test/cleanup-unreconciled-unknown')
    const jobs = Array.from({ length: 21 }, (_, i) =>
      seedPendingJob(testDb, removedPlugin.id, {
        subjectId: 700 + i,
        createdAt: '2026-10-21 00:00:00'
      })
    )

    const first = await cleanupPluginJobs(asDrizzle(testDb), NOW, {
      hasTaskDefinition: () => false,
      batchSize: 2
    })

    expect(first.unavailableFailed).toBe(20)
    expect(first.deadMarked).toBe(0)
    expect(jobs.filter((job) => jobRow(testDb, job.id).status === 'failed')).toHaveLength(20)
    expect(jobs.filter((job) => jobRow(testDb, job.id).status === 'pending')).toHaveLength(1)
    expect(logs(testDb)).toHaveLength(20)

    const second = await cleanupPluginJobs(asDrizzle(testDb), NOW, {
      hasTaskDefinition: () => false,
      batchSize: 2
    })
    expect(second.unavailableFailed).toBe(1)
    expect(second.deadMarked).toBe(0)
    expect(jobs.every((job) => jobRow(testDb, job.id).status === 'failed')).toBe(true)
    expect(logs(testDb)).toHaveLength(21)
  })
})
