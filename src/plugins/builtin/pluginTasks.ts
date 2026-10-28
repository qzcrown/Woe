import type { Env } from '../../types/index.ts'
import { moduleDescriptors } from '../../generated/plugins/catalog.ts'
import { serverModules } from '../../generated/plugins/server.ts'
import type { ModuleDescriptor } from '../moduleCatalog.ts'
import type {
  OutboundPolicyOptions,
  PluginTaskBehavior,
  PluginTaskDefinition,
  RuntimeTaskFactory,
  StaticTaskFactory
} from '../jobs/types.ts'

export interface BuiltinPluginTaskMetadata {
  modulePath: string
  supportedSubjectTypes: readonly string[]
  quotaNamespace?: string
  secretFields?: readonly string[]
  manualTrigger?: boolean
  outbound?: OutboundPolicyOptions
}

interface GeneratedTaskFactories {
  staticFactory: StaticTaskFactory
  runtimeFactory: RuntimeTaskFactory
}

interface GeneratedTaskEntry {
  metadata: BuiltinPluginTaskMetadata
  factories: GeneratedTaskFactories
}

const taskModules = serverModules as Readonly<Record<string, { task?: GeneratedTaskFactories }>>

function readMetadata(descriptor: ModuleDescriptor): BuiltinPluginTaskMetadata | null {
  if (!descriptor.task) return null
  return {
    modulePath: descriptor.modulePath,
    supportedSubjectTypes: descriptor.task.supportedSubjectTypes,
    ...(descriptor.task.quotaNamespace === undefined
      ? {}
      : { quotaNamespace: descriptor.task.quotaNamespace }),
    secretFields: descriptor.secretFields,
    ...(descriptor.task.manualTrigger === undefined
      ? {}
      : { manualTrigger: descriptor.task.manualTrigger }),
    ...(descriptor.task.outbound === undefined ? {} : { outbound: descriptor.task.outbound })
  }
}

function readGeneratedTasks(): GeneratedTaskEntry[] {
  const entries: GeneratedTaskEntry[] = []
  for (const descriptor of moduleDescriptors) {
    const metadata = readMetadata(descriptor)
    if (!metadata) continue
    const factories = taskModules[descriptor.modulePath]?.task
    if (!factories) throw new Error(`Missing generated task factories: ${descriptor.modulePath}`)
    entries.push({ metadata, factories })
  }
  return entries
}

function assembleDefinition(
  metadata: BuiltinPluginTaskMetadata,
  behavior: PluginTaskBehavior
): PluginTaskDefinition {
  return {
    ...behavior,
    ...metadata,
    ...(behavior.outbound === undefined ? {} : { outbound: behavior.outbound })
  }
}

const generatedTasks = readGeneratedTasks()

export const builtinPluginTaskMetadata: readonly BuiltinPluginTaskMetadata[] = generatedTasks.map(
  entry => entry.metadata
)

export const builtinPluginTasks: readonly PluginTaskDefinition[] = generatedTasks.map(entry =>
  assembleDefinition(entry.metadata, entry.factories.staticFactory())
)

export function createBuiltinPluginTasks(env: Env): PluginTaskDefinition[] {
  return generatedTasks.map(entry =>
    assembleDefinition(entry.metadata, entry.factories.runtimeFactory(env))
  )
}
