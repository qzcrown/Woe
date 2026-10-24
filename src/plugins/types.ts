import type { PluginEventOutcome, PluginJobsAccess } from './jobs/types.ts'

export interface PluginContext {
  userId: number
  now: string
  message?: {
    id: number
    appId: number
    date?: string
    title?: string
    priority?: number
    content: string
    extras?: Record<string, any>
  }
  application?: { id: number; name: string }
  client?: { id: number; name: string }

  jobs?: PluginJobsAccess
}

export interface PluginInitOptions {
  config: Record<string, any> | undefined

  jobs?: PluginJobsAccess
  pushOutbox?: {
    enqueueForUserDevices(input: {
      userId: number
      messageId: number
      appid: number
      date: string
      platform: string
      title?: string
      message: string
      priority?: number
      extras?: Record<string, any>
    }): Promise<{

      count: number

      outboxIds: number[]
    }>
  }
}

export interface ExecutablePlugin {
  id: number
  name: string
  capabilities: string[]
  init(opts: PluginInitOptions): Promise<void> | void
  onMessageCreate?(ctx: PluginContext): Promise<PluginEventOutcome | void> | PluginEventOutcome | void
  onMessageDelete?(ctx: PluginContext): Promise<void> | void
  onApplicationCreate?(ctx: PluginContext): Promise<void> | void
  onClientCreate?(ctx: PluginContext): Promise<void> | void
  renderDisplay?(ctx: PluginContext): Promise<string> | string
  configExample?: string
}









export interface FilterConfig {

  tags?: string[]

  minPriority?: number
}





export interface FilterTags {

  tags: string[]
}




export interface FilterResult {

  allowed: boolean

  reason?: string
}
