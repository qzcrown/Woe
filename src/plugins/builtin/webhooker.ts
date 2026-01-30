import { ExecutablePlugin, PluginContext, PluginInitOptions } from '../types.ts'

function buildRequestBody(
  bodyConfig: string | undefined,
  ctx: PluginContext,
  pluginId: number,
  resolveVariables: (value: any, ctx: PluginContext) => any
): string {
  // 1. No body config: use default format for backward compatibility
  if (!bodyConfig) {
    return JSON.stringify({
      pluginId: pluginId,
      userId: ctx.userId,
      event: 'message.create',
      message: ctx.message,
      at: ctx.now
    })
  }

  // 2. Try to parse as JSON, fall back to string if fails
  let parsedBody: any
  try {
    parsedBody = JSON.parse(bodyConfig)
  } catch {
    parsedBody = bodyConfig
  }

  // 3. Use resolveVariables for variable substitution
  const resolvedBody = resolveVariables(parsedBody, ctx)

  // 4. Serialize to string
  if (typeof resolvedBody === 'object') {
    return JSON.stringify(resolvedBody)
  }
  return String(resolvedBody)
}

export function createWebhooker({ id, name }: { id: number; name: string }): ExecutablePlugin {
  let conf: any = {}

  return {
    id,
    name,
    capabilities: ['webhooker', 'messenger'],
    configExample: `# Webhooker Configuration
# Supported variables: #{MESSAGE}, #{MESSAGE_ID}, #{USER_ID}, #{NOW}, #{APP_NAME} etc.
targetUrl: https://example.com/webhook/#{USER_ID}
method: POST
timeoutMs: 5000

# You can use variables in the request body
body: |
  {
    "message": "#{MESSAGE}",
    "title": "#{MESSAGE_TITLE}",
    "from_app": "#{APP_NAME}",
    "timestamp": "#{NOW}"
  }

# Custom headers can also use variables
headers:
  Authorization: Bearer your-token
  X-User-Id: "#{USER_ID}"
  X-App-Id: "#{APP_ID}"`,
    init(opts: PluginInitOptions) {
      conf = opts.config || {}
    },
    async onMessageCreate(ctx: PluginContext) {
      // Import resolveVariables
      const { resolveVariables } = await import('../template.ts')

      // Resolve variables in configuration
      const resolved = resolveVariables(conf, ctx)

      const url = resolved.targetUrl
      if (!url) return

      const controller = new AbortController()
      const timeout = resolved.timeoutMs ?? 3000
      const to = setTimeout(() => controller.abort(), timeout)

      try {
        // Use resolved headers (user headers can override default Content-Type)
        // Default Content-Type first, then user headers override it
        const headers = {
          'Content-Type': 'application/json',
          ...(resolved.headers || {})
        }

        // Build request body (custom or default)
        const body = buildRequestBody(conf.body, ctx, id, resolveVariables)

        let res = await fetch(url, {
          method: resolved.method || 'POST',
          headers,
          body,
          signal: controller.signal
        })
      } catch (error) {
        // console.error('Webhooker error:', error)
        console.error('Webhooker error:', error)
      }
      clearTimeout(to)
    }
  }
}

