import { ExecutablePlugin, PluginContext, PluginInitOptions } from '../types.ts'

export function createDisplayer({ id, name }: { id: number; name: string }): ExecutablePlugin {
  let conf: any = {}
  return {
    id,
    name,
    capabilities: ['displayer'],
    init(opts: PluginInitOptions) {
      conf = opts.config || {}
    },
    renderDisplay(ctx: PluginContext): string {
      const lines = [
        `Plugin ID: ${id}`,
        `Name: ${name}`,
        `Now: ${ctx.now}`,
        `Config: ${JSON.stringify(conf)}`
      ]
      return lines.join('\n')
    }
  }
}

