







import { and, eq, sql } from 'drizzle-orm'
import type { DrizzleDB } from '../../drizzle/index.ts'
import { pluginConfigs } from '../../models/index.ts'


type WriteResult = { meta?: { changes?: number }; changes?: number }

function affectedRows(result: WriteResult | undefined | null): number {
  return result?.meta?.changes ?? result?.changes ?? 0
}

export interface UsageState {
  usageDay: string | null
  usageCount: number
}

export class QuotaUsageStore {
  constructor(private drizzle: DrizzleDB) {}





  async readUsageState(pluginId: number, userId: number): Promise<UsageState> {
    const row = await this.drizzle
      .select({
        usageDay: pluginConfigs.usageDay,
        usageCount: pluginConfigs.usageCount
      })
      .from(pluginConfigs)
      .where(and(eq(pluginConfigs.id, pluginId), eq(pluginConfigs.userId, userId)))
      .get()

    if (!row) throw new Error('plugin config not found for quota usage')

    return {
      usageDay: row.usageDay ?? null,
      usageCount: row.usageCount ?? 0
    }
  }


  async readUsage(pluginId: number, userId: number, today: string): Promise<number> {
    const state = await this.readUsageState(pluginId, userId)
    return state.usageDay === today ? state.usageCount : 0
  }









  async consumeUsage(pluginId: number, userId: number, today: string): Promise<boolean> {
    try {
      const result = await this.drizzle
        .update(pluginConfigs)
        .set({
          usageCount: sql`CASE WHEN ${pluginConfigs.usageDay} = ${today} THEN ${pluginConfigs.usageCount} + 1 ELSE 1 END`,
          usageDay: today
        })
        .where(and(eq(pluginConfigs.id, pluginId), eq(pluginConfigs.userId, userId)))

      return affectedRows(result as unknown as WriteResult) > 0
    } catch {
      return false
    }
  }
}
