


















import { and, eq, gt, inArray, lt, sql } from 'drizzle-orm'
import type { DrizzleDB } from '../../drizzle/index.ts'
import { pluginConfigs, pluginJobs } from '../../models/index.ts'
import { jobErrorMessage, writeJobLog } from './pluginJobLog.ts'

const TERMINAL_STATUSES = ['success', 'failed', 'dead'] as const

const TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const PENDING_STALE_MS = 24 * 60 * 60 * 1000


const MAX_RECONCILE_BATCHES = 10

const DEFAULT_RECONCILE_BATCH_SIZE = 200

export interface PluginJobCleanupOptions {

  hasTaskDefinition(modulePath: string): boolean

  batchSize?: number
}

export interface PluginJobCleanupResult {
  deleted: number
  deadMarked: number

  unavailableFailed: number
}


export function toSqliteUtcTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

type WriteResult = { meta?: { changes?: number }; changes?: number }

const affectedRows = (result: WriteResult | undefined | null): number =>
  result?.meta?.changes ?? result?.changes ?? 0

export async function cleanupPluginJobs(
  drizzle: DrizzleDB,
  now: Date,
  options: PluginJobCleanupOptions
): Promise<PluginJobCleanupResult> {
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_RECONCILE_BATCH_SIZE)
  const maxReconcileRows = MAX_RECONCILE_BATCHES * batchSize
  let unavailableFailed = 0



  let cursor = 0
  let reconcileCandidates = 0
  while (reconcileCandidates < maxReconcileRows) {
    const rows = await drizzle
      .select({
        id: pluginJobs.id,
        pluginId: pluginJobs.pluginId,
        userId: pluginJobs.userId,
        modulePath: pluginConfigs.modulePath
      })
      .from(pluginJobs)
      .leftJoin(pluginConfigs, eq(pluginConfigs.id, pluginJobs.pluginId))
      .where(and(eq(pluginJobs.status, 'pending'), gt(pluginJobs.id, cursor)))
      .orderBy(pluginJobs.id)
      .limit(batchSize)

    if (rows.length === 0) break
    cursor = rows[rows.length - 1].id


    const targets = rows
      .filter((row) => row.modulePath === null || !options.hasTaskDefinition(row.modulePath))
      .slice(0, maxReconcileRows - reconcileCandidates)
    reconcileCandidates += targets.length

    if (targets.length > 0) {


      const hitRows = await drizzle
        .update(pluginJobs)
        .set({
          status: 'failed',
          completedAt: sql`CURRENT_TIMESTAMP`,
          updatedAt: sql`CURRENT_TIMESTAMP`,
          lastErrorCode: 'plugin-unavailable',
          lastErrorMessage: jobErrorMessage('plugin-unavailable')
        })
        .where(and(inArray(pluginJobs.id, targets.map((row) => row.id)), eq(pluginJobs.status, 'pending')))
        .returning({
          id: pluginJobs.id,
          pluginId: pluginJobs.pluginId,
          userId: pluginJobs.userId
        })

      for (const row of hitRows) {
        await writeJobLog(drizzle, {
          pluginId: row.pluginId,
          userId: row.userId,
          event: 'plugin_job.failed',
          status: 0,
          error: 'plugin-unavailable'
        })
      }
      unavailableFailed += hitRows.length
    }

    if (rows.length < batchSize) break
  }

  const deadBefore = toSqliteUtcTimestamp(new Date(now.getTime() - PENDING_STALE_MS))
  const deleteBefore = toSqliteUtcTimestamp(new Date(now.getTime() - TERMINAL_RETENTION_MS))



  let deadMarked = 0
  let deadCursor = 0
  while (true) {
    const rows = await drizzle
      .select({
        id: pluginJobs.id,
        pluginId: pluginJobs.pluginId,
        userId: pluginJobs.userId,
        modulePath: pluginConfigs.modulePath
      })
      .from(pluginJobs)
      .leftJoin(pluginConfigs, eq(pluginConfigs.id, pluginJobs.pluginId))
      .where(
        and(
          eq(pluginJobs.status, 'pending'),
          gt(pluginJobs.id, deadCursor),
          lt(pluginJobs.createdAt, deadBefore)
        )
      )
      .orderBy(pluginJobs.id)
      .limit(batchSize)

    if (rows.length === 0) break
    deadCursor = rows[rows.length - 1].id

    const targets = rows.filter(
      (row) => row.modulePath !== null && options.hasTaskDefinition(row.modulePath)
    )
    if (targets.length > 0) {
      const deadRows = await drizzle
        .update(pluginJobs)
        .set({
          status: 'dead',
          completedAt: sql`CURRENT_TIMESTAMP`,
          updatedAt: sql`CURRENT_TIMESTAMP`,
          lastErrorCode: 'dead-timeout',
          lastErrorMessage: jobErrorMessage('dead-timeout')
        })
        .where(
          and(
            inArray(pluginJobs.id, targets.map((row) => row.id)),
            eq(pluginJobs.status, 'pending'),
            lt(pluginJobs.createdAt, deadBefore)
          )
        )
        .returning({
          id: pluginJobs.id,
          pluginId: pluginJobs.pluginId,
          userId: pluginJobs.userId
        })


      for (const row of deadRows) {
        await writeJobLog(drizzle, {
          pluginId: row.pluginId,
          userId: row.userId,
          event: 'plugin_job.dead',
          status: 0,
          error: 'dead-timeout'
        })
      }
      deadMarked += deadRows.length
    }

    if (rows.length < batchSize) break
  }

  const deleteResult = await drizzle
    .delete(pluginJobs)
    .where(
      and(
        inArray(pluginJobs.status, [...TERMINAL_STATUSES]),
        lt(pluginJobs.createdAt, deleteBefore)
      )
    )

  return {
    deleted: affectedRows(deleteResult as unknown as WriteResult),
    deadMarked,
    unavailableFailed
  }
}
