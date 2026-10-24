






import type { PluginConfigErrorCode } from '../../jobs/types.ts'
import type { FilterConfig } from '../../types.ts'


export type WebhookerHeaderValue = string | number | boolean

export interface WebhookerConfig {

  targetUrl: string

  method: string

  timeoutMs: number

  headers?: Record<string, WebhookerHeaderValue>

  body?: string

  filter?: FilterConfig
}

export type WebhookerConfigResult =
  | { ok: true; config: WebhookerConfig }
  | { ok: false; errorCode: PluginConfigErrorCode }






export interface WebhookerPayload {
  url: string
  method: string
  headers: Record<string, string>
  body: string
}
