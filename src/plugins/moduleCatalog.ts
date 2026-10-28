export interface EntryRef {
  entry: string
  export: string
}

export type VersionMap = Readonly<Record<string, string>>

export interface DependencyDeclaration {
  root?: { dependencies?: VersionMap; devDependencies?: VersionMap }
  frontend?: { dependencies?: VersionMap; devDependencies?: VersionMap }
}

export interface QueueConsumerPolicy {
  maxBatchSize: number
  maxBatchTimeout: number
  maxRetries: number
  maxConcurrency?: number
}

export interface ResourceFragment {
  vars?: Record<string, string | boolean>
  bindings?: Array<{
    name: string
    kind: 'd1' | 'r2' | 'kv' | 'ai' | 'images' | 'durable-object'
    logicalResource: string
    required: boolean
    shared: boolean
  }>
  queues?: Array<{
    logicalResource: string
    producerBinding?: string
    consumer?: QueueConsumerPolicy
  }>
  secrets?: Array<{ name: string; required: boolean; shared: boolean; purpose: string }>
}

export interface TaskDescriptor {
  supportedSubjectTypes: readonly string[]
  quotaNamespace?: string
  manualTrigger?: boolean
  outbound?: import('./jobs/types.ts').OutboundPolicyOptions
}

export interface FrontendDescriptor {
  configEditor?: string
  messageActions?: string
  adminPanel?: string
  clientPlatformLabels?: Readonly<Record<string, string>>
  locales?: Partial<Record<'en-US' | 'zh-CN', string>>
}

export interface PluginPackageManifest {
  modulePath: string
  name: string
  capabilities: string[]
  author: string
  license: string
  website: string
  backend?: {
    event?: EntryRef
    task?: TaskDescriptor & { entry: string; staticExport: string; runtimeExport: string }
    push?: EntryRef & { platform: string }
  }
  config?: { parser?: EntryRef; secretFields?: readonly string[]; errorDescription?: string }
  frontend?: FrontendDescriptor
  assets?: string
  docs?: string
  resources?: ResourceFragment
  dependencies?: DependencyDeclaration
}

export interface ModuleDescriptor {
  modulePath: string
  name: string
  capabilities: readonly string[]
  author: string
  license: string
  website: string
  secretFields: readonly string[]
  configErrorDescription?: string
  task?: TaskDescriptor
  push?: { platform: string }
  frontend?: FrontendDescriptor
  resources?: ResourceFragment
  dependencies?: DependencyDeclaration
}

export interface FrontendModuleDescriptor {
  modulePath: string
  capabilities: readonly string[]
  quotaNamespace?: string
  platforms: readonly string[]
  frontend?: FrontendDescriptor
}

export interface ModuleCatalog {
  get(modulePath: string): ModuleDescriptor | null
  has(modulePath: string): boolean
  list(): readonly ModuleDescriptor[]
  quotaNamespaces(): readonly string[]
  pushPlatforms(): readonly string[]
}

export interface GenerationResult {
  modules: string[]
  fingerprint: string
  files: string[]
}

function cloneReadonly<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(item => cloneReadonly(item))) as T
  }
  if (value !== null && typeof value === 'object') {
    const clone: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) clone[key] = cloneReadonly(child)
    return Object.freeze(clone) as T
  }
  return value
}

export function createModuleCatalog(descriptors: readonly ModuleDescriptor[]): ModuleCatalog {
  const byPath = new Map<string, ModuleDescriptor>()
  for (const input of descriptors) {
    if (byPath.has(input.modulePath)) {
      throw new Error(`Duplicate modulePath "${input.modulePath}" in module catalog`)
    }
    byPath.set(input.modulePath, cloneReadonly(input))
  }
  const list = Object.freeze([...byPath.values()].sort((left, right) =>
    left.modulePath < right.modulePath ? -1 : left.modulePath > right.modulePath ? 1 : 0
  ))
  const quotaNamespaces = Object.freeze([...new Set(
    list.map(descriptor => descriptor.task?.quotaNamespace).filter((value): value is string => value !== undefined)
  )].sort())
  const pushPlatforms = Object.freeze([...new Set(
    list.map(descriptor => descriptor.push?.platform).filter((value): value is string => value !== undefined)
  )].sort())

  return Object.freeze({
    get: (modulePath: string) => byPath.get(modulePath) ?? null,
    has: (modulePath: string) => byPath.has(modulePath),
    list: () => list,
    quotaNamespaces: () => quotaNamespaces,
    pushPlatforms: () => pushPlatforms
  })
}
