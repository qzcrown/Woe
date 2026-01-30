import { parse } from 'yaml'
import { ExecutablePlugin, PluginContext } from './types.ts'
import { register as reg, resolve as res } from './registry.ts'
import { createWebhooker } from './builtin/webhooker.ts'
import { createDisplayer } from './builtin/displayer.ts'
import { DrizzleDB } from '../drizzle/index.ts'
import { pluginConfigs, pluginLogs, userPluginPermissions, users } from '../models/index.ts'
import { eq, and, inArray } from 'drizzle-orm'

reg('builtin/webhooker', createWebhooker)
reg('builtin/displayer', createDisplayer)

export type PluginEvent = 'message.create' | 'message.delete' | 'application.create' | 'client.create'

export class PluginManager {
  private cache: Map<number, ExecutablePlugin[]> = new Map()
  constructor(private drizzle: DrizzleDB) {}

  private async isUserAdmin(userId: number): Promise<boolean> {
    try {
      const result = await this.drizzle
        .select({ admin: users.admin })
        .from(users)
        .where(and(eq(users.id, userId), eq(users.disabled, false)))
        .get()
      return result ? Boolean(result.admin) : false
    } catch {
      return false
    }
  }

  private async getUserPermittedPlugins(userId: number): Promise<Set<string>> {
    const permissions = await this.drizzle
      .select({ modulePath: userPluginPermissions.modulePath })
      .from(userPluginPermissions)
      .where(eq(userPluginPermissions.userId, userId))
    return new Set(permissions.map(p => p.modulePath))
  }

  async loadForUser(userId: number): Promise<ExecutablePlugin[]> {
    // Check if user is disabled
    const userResult = await this.drizzle
      .select({ disabled: users.disabled })
      .from(users)
      .where(eq(users.id, userId))
      .get()

    if (!userResult || userResult.disabled) {
      // Disabled user's plugins should not be loaded
      return []
    }

    const cached = this.cache.get(userId)
    if (cached) return cached

    // Check if user is admin
    const isAdmin = await this.isUserAdmin(userId)
    
    // Get permitted plugins for non-admin users
    const permittedPlugins = isAdmin ? null : await this.getUserPermittedPlugins(userId)
    
    const pluginConfigsResult = await this.drizzle
      .select({
        id: pluginConfigs.id,
        name: pluginConfigs.name,
        modulePath: pluginConfigs.modulePath,
        configYaml: pluginConfigs.configYaml
      })
      .from(pluginConfigs)
      .where(and(eq(pluginConfigs.userId, userId), eq(pluginConfigs.enabled, 1)))
      .all()
    
    const plugins: ExecutablePlugin[] = []
    for (const row of pluginConfigsResult) {
      // Skip plugins that user doesn't have permission for (non-admin only)
      if (!isAdmin && permittedPlugins && !permittedPlugins.has(row.modulePath)) {
        continue
      }
      
      const p = res(row.modulePath, row.id, row.name)
      if (!p) continue
      const conf = row.configYaml ? parse(row.configYaml) as Record<string, any> : undefined
      await p.init({ config: conf })
      plugins.push(p)
    }
    
    this.cache.set(userId, plugins)
    return plugins
  }

  invalidate(userId: number) {
    this.cache.delete(userId)
  }

  async emit(userId: number, event: PluginEvent, ctx: PluginContext): Promise<void> {
    const plugins = await this.loadForUser(userId)
    for (const p of plugins) {
      const start = Date.now()
      let status: 'ok' | 'error' = 'ok'
      let errMsg = ''
      let handlerExecuted = false

      try {
        switch (event) {
          case 'message.create':
            if (p.onMessageCreate) {
              await p.onMessageCreate(ctx)
              handlerExecuted = true
            }
            break
          case 'message.delete':
            if (p.onMessageDelete) {
              await p.onMessageDelete(ctx)
              handlerExecuted = true
            }
            break
          case 'application.create':
            if (p.onApplicationCreate) {
              await p.onApplicationCreate(ctx)
              handlerExecuted = true
            }
            break
          case 'client.create':
            if (p.onClientCreate) {
              await p.onClientCreate(ctx)
              handlerExecuted = true
            }
            break
        }
      } catch (e) {
        status = 'error'
        errMsg = e instanceof Error ? e.message : 'unknown'
      }

      // Only log if a handler was actually executed
      if (!handlerExecuted) continue

      const duration = Date.now() - start
      // 预先计算 status 值，避免 Drizzle ORM 序列化三元表达式时转换为浮点数格式（1.0）
      const statusValue = status === 'ok' ? 1 : 0

      try {
        await this.drizzle
          .insert(pluginLogs)
          .values({
            pluginId: p.id,
            userId,
            event,
            status: statusValue,
            durationMs: duration,
            error: errMsg || null
          })
      } catch {}
    }
  }
}
