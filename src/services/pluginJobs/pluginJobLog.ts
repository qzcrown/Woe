






import { pluginLogs } from '../../models/index.ts'
import type { DrizzleDB } from '../../drizzle/index.ts'


export const PLUGIN_JOB_LOG_EVENTS = [
  'plugin_job.failed',
  'plugin_job.dead',
  'plugin_job.enqueue_rejected',
  'plugin_job.quota_rejected',
  'plugin_job.skipped'
] as const

export type PluginJobLogEvent = (typeof PLUGIN_JOB_LOG_EVENTS)[number]





const JOB_ERROR_MESSAGES: Record<string, string> = {
  config: 'plugin configuration is invalid',
  'secret-config': 'plugin secret is missing or invalid',
  'secret-decrypt-failed': 'plugin secret could not be decrypted',
  'secret-reentry-required': 'plugin secret must be re-entered',
  'not-found': 'job subject not found',
  'invalid-existing-tags': 'existing tags are invalid',
  'provider-auth': 'downstream service authentication failed',
  'provider-quota': 'downstream service quota exhausted',
  'provider-rate-limit': 'downstream service rate limited the request',
  'provider-model': 'downstream service rejected the requested model',
  'provider-timeout': 'downstream request timed out',
  'provider-network': 'downstream network request failed',
  'provider-invalid-envelope': 'downstream response was invalid',
  'invalid-output': 'plugin produced invalid output',
  'outbound-blocked': 'outbound request was blocked by policy',
  'downstream-rejected': 'downstream service rejected the request',
  'limit-exceeded': 'quota limit exceeded',
  'quota-read-failed': 'quota state could not be read',
  'dead-timeout': 'plugin job timed out before completion',
  'enqueue-send-failed': 'plugin job could not be enqueued',
  'write-failed': 'plugin job result could not be written',
  'plugin-unavailable': 'plugin is not available',
  internal: 'plugin job failed unexpectedly',
  'quota-exceeded': 'quota limit exceeded'
}


export const FALLBACK_JOB_ERROR_MESSAGE = 'plugin job failed'

export function jobErrorMessage(code: string): string {
  return JOB_ERROR_MESSAGES[code] ?? FALLBACK_JOB_ERROR_MESSAGE
}

export interface JobLogInput {
  pluginId: number
  userId: number
  event: PluginJobLogEvent

  status?: number

  error?: string
}


export async function writeJobLog(drizzle: DrizzleDB, input: JobLogInput): Promise<void> {
  try {
    await drizzle.insert(pluginLogs).values({
      pluginId: input.pluginId,
      userId: input.userId,
      event: input.event,
      status: input.status ?? 0,
      error: input.error ?? null
    })
  } catch {
    console.error(`[Plugin Job Log] write failed event=${input.event}`)
  }
}
