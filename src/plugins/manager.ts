import { parseYaml } from '../utils/yaml.ts'
import { ExecutablePlugin, PluginContext } from './types.ts'
import { register as reg, resolve as res } from './registry.ts'
import { createWebhooker } from './builtin/webhooker.ts'
import { createDisplayer } from './builtin/displayer.ts'
import { DrizzleDB } from '../drizzle/index.ts'
import { pluginConfigs, pluginLogs } from '../models/index.ts'
import { eq, and } from 'drizzle-orm'

reg('builtin/webhooker', createWebhooker)
reg('builtin/displayer', createDisplayer)

export type PluginEvent = 'message.create' | 'message.delete' | 'application.create' | 'client.create'

export class PluginManager {
  private cache: Map<number, ExecutablePlugin[]> = new Map()
  constructor(private drizzle: DrizzleDB) {}

  async loadForUser(userId: number): Promise<ExecutablePlugin[]> {
    const cached = this.cache.get(userId)
    if (cached) return cached
    
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
      const p = res(row.modulePath, row.id, row.name)
      if (!p) continue
      const conf = parseYaml(row.configYaml || null)
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
      
      try {
        switch (event) {
          case 'message.create':
            if (p.onMessageCreate) await p.onMessageCreate(ctx)
            break
          case 'message.delete':
            if (p.onMessageDelete) await p.onMessageDelete(ctx)
            break
          case 'application.create':
            if (p.onApplicationCreate) await p.onApplicationCreate(ctx)
            break
          case 'client.create':
            if (p.onClientCreate) await p.onClientCreate(ctx)
            break
        }
      } catch (e) {
        status = 'error'
        errMsg = e instanceof Error ? e.message : 'unknown'
      }
      
      const duration = Date.now() - start
      
      try {
        await this.drizzle
          .insert(pluginLogs)
          .values({
            pluginId: p.id,
            userId,
            event,
            status: status === 'ok' ? 1 : 0,
            durationMs: duration,
            error: errMsg || null
          })
      } catch {}
    }
  }
}
