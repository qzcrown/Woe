import { parseYaml } from '../utils/yaml.ts'
import { ExecutablePlugin, PluginContext } from './types.ts'
import { register as reg, resolve as res } from './registry.ts'
import { createWebhooker } from './builtin/webhooker.ts'
import { createDisplayer } from './builtin/displayer.ts'

reg('builtin/webhooker', createWebhooker)
reg('builtin/displayer', createDisplayer)

export type PluginEvent = 'message.create' | 'message.delete' | 'application.create' | 'client.create'

export class PluginManager {
  private cache: Map<number, ExecutablePlugin[]> = new Map()
  constructor(private db: D1Database) {}

  async loadForUser(userId: number): Promise<ExecutablePlugin[]> {
    const cached = this.cache.get(userId)
    if (cached) return cached
    const result = await this.db.prepare(`
      SELECT id, name, module_path as modulePath, config_yaml as configYaml
      FROM plugin_configs
      WHERE user_id = ? AND enabled = 1
    `).bind(userId).all()
    const plugins: ExecutablePlugin[] = []
    for (const row of result.results) {
      const p = res(row.modulePath as string, row.id as number, row.name as string)
      if (!p) continue
      const conf = parseYaml(row.configYaml as string | null)
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
      let status = 'ok'
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
        await this.db.prepare(`
          INSERT INTO plugin_logs (plugin_id, user_id, event, status, duration_ms, error)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(p.id, userId, event, status, duration, errMsg || null).run()
      } catch {}
    }
  }
}
