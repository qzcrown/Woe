











export type PluginConfigErrorCode =
  | 'config'
  | 'secret-config'
  | 'secret-decrypt-failed'
  | 'secret-reentry-required'
  | 'outbound-blocked'








export type PluginJobErrorCode =
  | 'config'
  | 'secret-decrypt-failed'
  | 'not-found'
  | 'invalid-existing-tags'
  | 'provider-auth'
  | 'provider-quota'
  | 'provider-rate-limit'
  | 'provider-model'
  | 'provider-timeout'
  | 'provider-network'
  | 'provider-invalid-envelope'
  | 'provider-reasoning-budget'
  | 'invalid-output'
  | 'outbound-blocked'
  | 'downstream-rejected'
  | 'limit-exceeded'
  | 'quota-read-failed'
  | 'dead-timeout'
  | 'enqueue-send-failed'
  | 'write-failed'
  | 'plugin-unavailable'
  | 'internal'

export type PluginSkipCode = 'capacity-full'

export type PluginEnqueueErrorCode =
  | PluginConfigErrorCode
  | 'quota-exceeded'
  | 'quota-read-failed'
  | 'plugin-unavailable'

export type PluginConfigFailure = {
  errorCode: PluginConfigErrorCode
}

export type PluginTaskFailure = {
  errorCode: PluginJobErrorCode
  retriable: boolean
  retryAfterMs?: number
  httpStatus?: number
}










export type PluginTaskResult =
  | { ok: true; result?: unknown; quotaConsumed?: boolean; skipped?: never }
  | { ok: true; skipped: { code: PluginSkipCode }; result?: unknown; quotaConsumed?: boolean }
  | { ok: false; failure: PluginTaskFailure; quotaConsumed?: boolean }

export type PluginEventOutcome =
  | { status: 'ok' }
  | { status: 'skipped'; code: PluginSkipCode | PluginConfigErrorCode | PluginEnqueueErrorCode }












export interface OutboundPolicyOptions {

  allowHttp?: boolean

  allowPrivateNetwork?: boolean





  allowQuery?: boolean
}

export interface PluginTask {
  run(input: { attempt: number; timeoutMs: number }): Promise<PluginTaskResult>
}

export interface PluginJobContext {
  jobId: number
  userId: number
  pluginId: number
  subjectType: string
  subjectId: number
  payload: unknown
}

export interface PluginTaskDefinition {
  modulePath: string
  supportedSubjectTypes: readonly string[]
  quotaNamespace?: string

  secretFields?: readonly string[]




  manualTrigger?: boolean




  outbound?: OutboundPolicyOptions


  validateConfig?(ctx: {
    config: unknown
    host: PluginHostContext
  }): Promise<PluginConfigFailure | void>





  prepareJob?(ctx: {
    userId: number
    pluginId: number
    subjectType: string
    subjectId: number
    config: unknown
    host: PluginHostContext
    now: string
  }): Promise<{ payload?: unknown } | { error: PluginConfigFailure }>


  createTask(ctx: {
    config: unknown
    job: PluginJobContext
    host: PluginHostContext
  }): Promise<PluginTask>
}

export type PluginTaskBehavior = Pick<
  PluginTaskDefinition,
  'validateConfig' | 'prepareJob' | 'createTask'
> & Partial<Pick<PluginTaskDefinition, 'outbound'>>

export type StaticTaskFactory = () => PluginTaskBehavior
export type RuntimeTaskFactory = (
  env: import('../../types/index.ts').Env
) => PluginTaskBehavior





export interface MessageAccess {
  getMessage(messageId: number): Promise<{
    id: number

    appId: number

    date: string
    priority: number
    title?: string
    content: string
    extras: Record<string, unknown>
  } | null>
}

export interface ApplicationAccess {

  getApplication(appId: number): Promise<{ id: number; name: string } | null>
}

export interface TagAccess {
  getTags(messageId: number): Promise<
    | { ok: true; tags: string[] }
    | { ok: false; reason: 'not-found' | 'invalid-tags' }
  >
  appendTags(
    messageId: number,
    tags: string[]
  ): Promise<
    | { status: 'updated' | 'unchanged'; tags: string[] }
    | { status: 'not-found' | 'invalid-existing-tags' | 'corrupted' }
  >
}

export interface PluginSecretAccess {

  get(path: string): Promise<string | null>
  has(path: string): Promise<boolean>

  paths(): readonly string[]
}

export interface OutboundHttp {

  fetch(input: {
    url: string
    method?: string
    headers?: Record<string, string>
    body?: string
    timeoutMs: number
  }): Promise<Response>
}

export interface PluginHostContext {
  userId: number
  pluginId: number
  messages: MessageAccess
  tags: TagAccess
  applications: ApplicationAccess
  secrets: PluginSecretAccess
  http: OutboundHttp
}





export interface PluginJobsAccess {

  enqueue(input: {
    subjectType: string
    subjectId: number
    payload?: unknown
  }): Promise<PluginEventOutcome>
}







export type PluginJobsFactory = (input: {
  userId: number
  pluginId: number
}) => PluginJobsAccess
