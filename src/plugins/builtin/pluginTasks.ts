















import type { Env } from '../../types/index.ts'
import type { OutboundPolicyOptions, PluginTaskDefinition } from '../jobs/types.ts'
import {
  createWebhookerDefinition,
  createWebhookerStaticDefinition,
  WEBHOOKER_TASK_METADATA
} from './webhooker/definition.ts'

export interface BuiltinPluginTaskMetadata {
  modulePath: string
  supportedSubjectTypes: readonly string[]
  quotaNamespace?: string
  secretFields?: readonly string[]

  manualTrigger?: boolean





  outbound?: OutboundPolicyOptions
}










export const builtinPluginTaskMetadata: readonly BuiltinPluginTaskMetadata[] = [
  WEBHOOKER_TASK_METADATA
]

export const builtinPluginTasks: readonly PluginTaskDefinition[] = [
  createWebhookerStaticDefinition()
]

export function createBuiltinPluginTasks(env: Env): PluginTaskDefinition[] {
  return [createWebhookerDefinition(env)]
}
