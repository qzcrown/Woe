import { ExecutablePlugin, PluginContext, PluginInitOptions } from '../types.ts'

export function createWebhooker({ id, name }: { id: number; name: string }): ExecutablePlugin {
  let conf: any = {}

  return {
    id,
    name,
    capabilities: ['webhooker', 'messenger'],
    init(opts: PluginInitOptions) {
      conf = opts.config || {}
    },
    async onMessageCreate(ctx: PluginContext) {
      const url = conf.targetUrl
      if (!url) return
      const payload = {
        pluginId: id,
        userId: ctx.userId,
        event: 'message.create',
        message: ctx.message,
        at: ctx.now
      }
      const controller = new AbortController()
      const timeout = conf.timeoutMs ?? 3000
      const to = setTimeout(() => controller.abort(), timeout)
      try {
        await fetch(url, {
          method: conf.method || 'POST',
          headers: { 'Content-Type': 'application/json', ...(conf.headers || {}) },
          body: JSON.stringify(payload),
          signal: controller.signal
        })
      } catch {}
      clearTimeout(to)
    }
  }
}

