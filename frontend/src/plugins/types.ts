import type {
  Message,
  MessageJobsResponse,
  Plugin,
  QuotaUser,
  TriggerMessageJobResponse,
  User
} from '@/types'









export interface PluginUiHost {

  readonly ownerId: number

  readonly sessionRevision: number

  readonly signal: AbortSignal
  readonly requestOptions: { signal: AbortSignal; sessionGuard: () => boolean }

  readonly api: PluginUiApi
  readonly notify: {
    success(message: string): void
    error(error: unknown, fallback: string): void
  }

  isCurrent(): boolean

  dispose(): void
}


export interface PluginUiApi {
  listPlugins(): Promise<Plugin[]>
  listJobs(messageId: number, pluginId: number, callGuard?: () => boolean): Promise<MessageJobsResponse>
  triggerJob(messageId: number, pluginId: number, callGuard?: () => boolean): Promise<TriggerMessageJobResponse>
  listQuotas(namespace: string): Promise<QuotaUser[]>
  setQuota(namespace: string, userId: number, limit: number | null): Promise<void>
}


export interface ConfigEditorProps {
  configYaml: string
  plugin: Plugin
  host: PluginUiHost
  saving: boolean
}


export type ConfigEditorEmits = {
  (event: 'save', yaml: string): void
  (event: 'cancel'): void
}


export interface MessageActionsProps {
  message: Message
  instances: readonly Plugin[]
  host: PluginUiHost
}


export type MessageActionsEmits = {
  (event: 'update-tags', payload: { messageId: number; tags: string[] }): void
}


export interface AdminPanelProps {
  user: User
  namespace: string
  host: PluginUiHost
}
