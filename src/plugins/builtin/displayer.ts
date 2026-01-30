import { ExecutablePlugin, PluginContext, PluginInitOptions } from '../types.ts'

export function createDisplayer({ id, name }: { id: number; name: string }): ExecutablePlugin {
  let conf: any = {}
  return {
    id,
    name,
    capabilities: ['displayer'],
    configExample: `# Displayer Configuration
# You can use variables to customize the display format
messageFormat: "[#{NOW}] #{APP_NAME}: #{MESSAGE}"
showTitle: true
titlePrefix: "Priority #{MESSAGE_PRIORITY} - "`,
    init(opts: PluginInitOptions) {
      conf = opts.config || {}
    },
    async renderDisplay(ctx: PluginContext): Promise<string> {
      // Import resolveVariables
      const { resolveVariables } = await import('../template.ts')

      // Resolve variables in config
      const resolved = resolveVariables(conf, ctx) as typeof conf

      const lines: string[] = []

      // Use custom format if provided
      if (resolved.messageFormat) {
        lines.push(resolved.messageFormat)
      } else {
        // Default display
        lines.push(`Plugin ID: ${id}`)
        lines.push(`Name: ${name}`)
        lines.push(`Now: ${ctx.now}`)
      }

      // Show title if enabled and message has title
      if (resolved.showTitle && ctx.message?.title) {
        const prefix = resolved.titlePrefix || ''
        lines.unshift(`${prefix}${ctx.message.title}`)
      }

      return lines.join('\n')
    }
  }
}

