export interface PluginContext {
  userId: number
  now: string
  message?: {
    id: number
    appId: number
    title?: string
    priority?: number
    content: string
    extras?: Record<string, any>
  }
  application?: { id: number; name: string }
  client?: { id: number; name: string }
}

export interface PluginInitOptions {
  config: Record<string, any> | undefined
}

export interface ExecutablePlugin {
  id: number
  name: string
  capabilities: string[]
  init(opts: PluginInitOptions): Promise<void> | void
  onMessageCreate?(ctx: PluginContext): Promise<void> | void
  onMessageDelete?(ctx: PluginContext): Promise<void> | void
  onApplicationCreate?(ctx: PluginContext): Promise<void> | void
  onClientCreate?(ctx: PluginContext): Promise<void> | void
  renderDisplay?(ctx: PluginContext): Promise<string> | string
}

