
















import { validateOutboundUrl } from '../../../services/http/outboundPolicy.ts'
import { resolveVariables } from '../../template.ts'
import type { Env } from '../../../types/index.ts'
import type { ExecutablePlugin, PluginContext } from '../../types.ts'
import type {
  MessageAccess,
  OutboundPolicyOptions,
  PluginConfigFailure,
  PluginHostContext,
  PluginTask,
  PluginTaskDefinition
} from '../../jobs/types.ts'
import {
  isAuthTokenDeclared,
  resolveWebhookerConfig,
  WEBHOOKER_MODULE_PATH
} from './config.ts'
import { createWebhookerTask } from './task.ts'
import type { WebhookerPayload } from './types.ts'


export const WEBHOOKER_MAX_PAYLOAD_BYTES = 64 * 1024


export const WEBHOOKER_CONFIG_EXAMPLE = `# Webhooker Configuration
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
  X-User-Id: "#{USER_ID}"
  X-App-Id: "#{APP_ID}"

# Recommended: store the bearer token via the platform secret service
# (it is masked as *** after saving and injected as "Authorization: Bearer ..." on delivery).
# Legacy plaintext "headers.Authorization" still works, but the two cannot coexist.
# authToken: "***"

# Filter Configuration (Optional)
# Controls which messages trigger this plugin
filter:
  # Match messages with any of these tags (set in extras["woe::filter::tags"])
  tags: ["webhook", "alert", "critical"]

  # Minimum priority threshold (message.priority >= this value)
  # Note: Uses message.priority directly, not from extras
  minPriority: 5`


type HostMessage = NonNullable<Awaited<ReturnType<MessageAccess['getMessage']>>>






function toRenderContext(input: {
  userId: number
  now: string
  message: HostMessage
  application: { id: number; name: string } | null
}): PluginContext {
  const ctx: PluginContext = {
    userId: input.userId,
    now: input.now,
    message: {
      id: input.message.id,
      appId: input.message.appId,
      date: input.message.date,
      title: input.message.title,
      priority: input.message.priority,
      content: input.message.content,
      extras: input.message.extras
    }
  }
  if (input.application) ctx.application = input.application
  return ctx
}






function buildWebhookerBody(
  bodyConfig: string | undefined,
  ctx: PluginContext,
  pluginId: number
): string {
  if (bodyConfig === undefined) {
    return JSON.stringify({
      pluginId,
      userId: ctx.userId,
      event: 'message.create',
      message: ctx.message,
      at: ctx.now
    })
  }

  let parsedBody: unknown
  try {
    parsedBody = JSON.parse(bodyConfig)
  } catch {
    parsedBody = bodyConfig
  }

  const resolvedBody = resolveVariables(parsedBody, ctx)
  if (typeof resolvedBody === 'object') {
    return JSON.stringify(resolvedBody)
  }
  return String(resolvedBody)
}


interface WebhookerPrepareContext {
  userId: number
  pluginId: number
  subjectType: string
  subjectId: number
  config: unknown
  host: PluginHostContext
  now: string
}









async function renderWebhookerSnapshot(
  ctx: WebhookerPrepareContext,
  outbound: OutboundPolicyOptions
): Promise<{ payload: WebhookerPayload } | { error: PluginConfigFailure }> {
  const resolved = resolveWebhookerConfig(ctx.config)
  if (!resolved.ok) return { error: { errorCode: resolved.errorCode } }



  const message = await ctx.host.messages.getMessage(ctx.subjectId)
  if (!message) return { error: { errorCode: 'config' } }

  const application = await ctx.host.applications.getApplication(message.appId)
  const renderCtx = toRenderContext({
    userId: ctx.userId,
    now: ctx.now,
    message,
    application
  })



  const url = resolveVariables(resolved.config.targetUrl, renderCtx) as string
  if (!validateOutboundUrl(url, outbound).ok) {
    return { error: { errorCode: 'outbound-blocked' } }
  }


  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (resolved.config.headers) {
    for (const [name, value] of Object.entries(resolved.config.headers)) {
      headers[name] = String(resolveVariables(value, renderCtx))
    }
  }

  const payload: WebhookerPayload = {
    url,
    method: resolved.config.method,
    headers,
    body: buildWebhookerBody(resolved.config.body, renderCtx, ctx.pluginId)
  }

  if (new TextEncoder().encode(JSON.stringify(payload)).length > WEBHOOKER_MAX_PAYLOAD_BYTES) {
    return { error: { errorCode: 'config' } }
  }
  return { payload }
}





export const WEBHOOKER_TASK_METADATA = {
  modulePath: WEBHOOKER_MODULE_PATH,
  supportedSubjectTypes: ['message'],
  secretFields: ['authToken'],
  manualTrigger: false
} as const





async function validateWebhookerConfig({
  config,
  host
}: {
  config: unknown
  host: PluginHostContext
}): Promise<PluginConfigFailure | void> {
  const resolved = resolveWebhookerConfig(config)
  if (!resolved.ok) return { errorCode: resolved.errorCode }

  if (isAuthTokenDeclared(config)) {
    const hasToken = await host.secrets.has('authToken')
    if (!hasToken) return { errorCode: 'secret-config' }
  }
  return
}


function configFailureTask(): PluginTask {
  return {
    async run() {
      return {
        ok: false,
        failure: { errorCode: 'config', retriable: false },
        quotaConsumed: false
      }
    }
  }
}





export function createWebhookerTaskDefinition(
  outbound: OutboundPolicyOptions = {}
): PluginTaskDefinition {

  const policy: OutboundPolicyOptions = { ...outbound, allowQuery: true }

  return {
    ...WEBHOOKER_TASK_METADATA,
    outbound: policy,

    validateConfig: validateWebhookerConfig,

    prepareJob: (ctx) => renderWebhookerSnapshot(ctx, policy),



    async createTask(): Promise<PluginTask> {
      throw new Error('webhooker task definition requires env')
    }
  }
}


export function createWebhookerStaticDefinition(): PluginTaskDefinition {
  return createWebhookerTaskDefinition()
}





function webhookerEnvFlag(value: string | undefined): boolean {
  return typeof value === 'string' && value.toLowerCase() === 'true'
}










export function createWebhookerDefinition(env: Env): PluginTaskDefinition {


  const relaxations: OutboundPolicyOptions = {}
  if (webhookerEnvFlag(env.WEBHOOKER_ALLOW_HTTP)) relaxations.allowHttp = true
  if (webhookerEnvFlag(env.WEBHOOKER_ALLOW_PRIVATE_NETWORK)) {
    relaxations.allowPrivateNetwork = true
  }

  const base = createWebhookerTaskDefinition(relaxations)

  return {
    ...base,



    async createTask({ config, job, host }) {
      const resolved = resolveWebhookerConfig(config)
      if (!resolved.ok) return configFailureTask()

      return createWebhookerTask({
        config: resolved.config,
        authTokenDeclared: isAuthTokenDeclared(config),
        payload: job.payload,
        host
      })
    }
  }
}







export function createWebhookerPlugin({ id, name }: { id: number; name: string }): ExecutablePlugin {
  return {
    id,
    name,
    capabilities: ['webhooker', 'messenger'],
    configExample: WEBHOOKER_CONFIG_EXAMPLE,


    init() {},

    async onMessageCreate(ctx) {
      if (!ctx.message || !ctx.jobs) {
        return { status: 'skipped', code: 'plugin-unavailable' }
      }
      return ctx.jobs.enqueue({
        subjectType: 'message',
        subjectId: ctx.message.id
      })
    }
  }
}
