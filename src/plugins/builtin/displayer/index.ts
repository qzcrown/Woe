import { ExecutablePlugin, PluginContext, PluginInitOptions } from '../../types.ts'

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
titlePrefix: "Priority #{MESSAGE_PRIORITY} - "

# Filter Configuration (Optional)
# Controls which messages this displayer handles
filter:
  # Match messages with any of these tags
  tags: ["display", "ui", "notification"]

  # Minimum priority threshold (message.priority >= this value)
  # Note: Uses message.priority directly, not from extras
  minPriority: 0`,
    init(opts: PluginInitOptions) {
      conf = opts.config || {}
    },
    async renderDisplay(ctx: PluginContext): Promise<string> {

      const { resolveVariables } = await import('../../template.ts')


      const resolved = resolveVariables(conf, ctx) as typeof conf

      const lines: string[] = []


      if (resolved.messageFormat) {
        lines.push(resolved.messageFormat)
      } else {

        lines.push(`Plugin ID: ${id}`)
        lines.push(`Name: ${name}`)
        lines.push(`Now: ${ctx.now}`)
      }


      if (resolved.showTitle && ctx.message?.title) {
        const prefix = resolved.titlePrefix || ''
        lines.unshift(`${prefix}${ctx.message.title}`)
      }

      return lines.join('\n')
    }
  }
}
