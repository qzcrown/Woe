import type { D1Database } from "@cloudflare/workers-types";

/**
 * Cleanup Service - 定期清理过期数据
 */
export class CleanupService {
  constructor(private db: D1Database) {}

  /**
   * 清理 30 天前的 plugin_logs 日志
   *
   * @param daysToKeep - 保留的天数，默认 30 天
   * @returns 清理结果，包含成功状态和删除的记录数
   */
  async cleanupOldPluginLogs(daysToKeep: number = 30): Promise<{
    success: boolean;
    deletedCount: number;
    error?: string;
  }> {
    try {
      const result = await this.db
        .prepare(`
          DELETE FROM plugin_logs
          WHERE date(created_at) < date('now', '-' || ? || ' days')
        `)
        .bind(daysToKeep.toString())
        .run();

      const deletedCount = result.meta?.changes || 0;

      console.log(`Cleanup service: Deleted ${deletedCount} old plugin logs (older than ${daysToKeep} days)`);

      return {
        success: true,
        deletedCount,
      };
    } catch (error) {
      console.error("Cleanup service: Failed to delete old plugin logs", error);
      return {
        success: false,
        deletedCount: 0,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * 获取 plugin_logs 表的统计信息
   *
   * @returns 统计信息，包含总数、最早和最晚日志时间
   */
  async getLogsStats(): Promise<{
    totalCount: number;
    oldestLog?: string;
    newestLog?: string;
  }> {
    try {
      // 获取总数
      const countResult = await this.db
        .prepare("SELECT COUNT(*) as count FROM plugin_logs")
        .first<{ count: number }>();

      const totalCount = countResult?.count || 0;

      // 获取最旧和最新的日志时间
      const dateRangeResult = await this.db
        .prepare("SELECT MIN(created_at) as oldest, MAX(created_at) as newest FROM plugin_logs")
        .first<{ oldest: string; newest: string }>();

      return {
        totalCount,
        oldestLog: dateRangeResult?.oldest || undefined,
        newestLog: dateRangeResult?.newest || undefined,
      };
    } catch (error) {
      console.error("Cleanup service: Failed to get logs stats", error);
      return { totalCount: 0 };
    }
  }
}
