










import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import type { DrizzleDB } from '../../drizzle/index.ts'
import { pluginJobs } from '../../models/index.ts'
import { jobErrorMessage, writeJobLog } from './pluginJobLog.ts'

const TERMINAL_STATUSES = ['success', 'failed', 'dead'] as const

const TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const PENDING_STALE_MS = 24 * 60 * 60 * 1000

export interface PluginJobCleanupResult {
  deleted: number
  deadMarked: number
}


export function toSqliteUtcTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

type WriteResult = { meta?: { changes?: number }; changes?: number }

const affectedRows = (result: WriteResult | undefined | null): number =>
  result?.meta?.changes ?? result?.changes ?? 0

export async function cleanupPluginJobs(
  drizzle: DrizzleDB,
  now: Date = new Date()
): Promise<PluginJobCleanupResult> {
  const deadBefore = toSqliteUtcTimestamp(new Date(now.getTime() - PENDING_STALE_MS))
  const deleteBefore = toSqliteUtcTimestamp(new Date(now.getTime() - TERMINAL_RETENTION_MS))




  const deadRows = await drizzle
    .update(pluginJobs)
    .set({
      status: 'dead',
      completedAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
      lastErrorCode: 'dead-timeout',
      lastErrorMessage: jobErrorMessage('dead-timeout')
    })
    .where(and(eq(pluginJobs.status, 'pending'), lt(pluginJobs.createdAt, deadBefore)))
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

  const deadMarked = deadRows.length

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
    deadMarked
  }
}
