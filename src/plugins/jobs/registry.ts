



















import type { Env } from '../../types/index.ts'
import type { PluginTaskDefinition } from './types.ts'
import { moduleDescriptors } from '../../generated/plugins/catalog.ts'
import { serverModules } from '../../generated/plugins/server.ts'
import {
  builtinPluginTasks,
  createBuiltinPluginTasks
} from '../builtin/pluginTasks.ts'

export interface PluginTaskRegistry {
  resolve(modulePath: string): PluginTaskDefinition | null
  has(modulePath: string): boolean
}

const definitions = new Map<string, PluginTaskDefinition>()

const secretFieldsByModule = new Map<string, readonly string[]>()

function loadBuiltins(): void {
  for (const metadata of moduleDescriptors) {
    secretFieldsByModule.set(metadata.modulePath, metadata.secretFields ?? [])
  }
  for (const definition of builtinPluginTasks) {
    if (definitions.has(definition.modulePath)) {
      throw new Error(`plugin task already registered: ${definition.modulePath}`)
    }
    definitions.set(definition.modulePath, definition)
  }
}

loadBuiltins()






export interface PluginConfigParserEntry {
  parse: (raw: unknown) => { ok: boolean }
  errorDescription: string
}


const FALLBACK_CONFIG_ERROR_DESCRIPTION = 'Invalid plugin config'

type GeneratedServerModule = { configParser?: (raw: unknown) => { ok: boolean } }

const configParsers = new Map<string, PluginConfigParserEntry>()
for (const descriptor of moduleDescriptors) {
  const parser = (serverModules as Readonly<Record<string, GeneratedServerModule>>)[
    descriptor.modulePath
  ]?.configParser
  if (!parser) continue
  configParsers.set(descriptor.modulePath, {
    parse: parser,
    errorDescription: descriptor.configErrorDescription ?? FALLBACK_CONFIG_ERROR_DESCRIPTION
  })
}





export function getPluginConfigParser(modulePath: string): PluginConfigParserEntry | null {
  return configParsers.get(modulePath) ?? null
}


const quotaNamespaces: readonly string[] = Object.freeze(
  [
    ...new Set(
      moduleDescriptors
        .map((descriptor) => descriptor.task?.quotaNamespace)
        .filter((value): value is string => value !== undefined)
    )
  ].sort()
)

const quotaModulePaths = new Map<string, readonly string[]>()
for (const namespace of quotaNamespaces) {
  quotaModulePaths.set(
    namespace,
    Object.freeze(
      moduleDescriptors
        .filter((descriptor) => descriptor.task?.quotaNamespace === namespace)
        .map((descriptor) => descriptor.modulePath)
        .sort()
    )
  )
}


export function getQuotaNamespaces(): readonly string[] {
  return quotaNamespaces
}


export function getQuotaNamespaceModulePaths(namespace: string): readonly string[] {
  return quotaModulePaths.get(namespace) ?? []
}


export function registerPluginTask(definition: PluginTaskDefinition): void {
  if (definitions.has(definition.modulePath)) {
    throw new Error(`plugin task already registered: ${definition.modulePath}`)
  }
  definitions.set(definition.modulePath, definition)
  secretFieldsByModule.set(definition.modulePath, definition.secretFields ?? [])
}


export function resolvePluginTask(modulePath: string): PluginTaskDefinition | null {
  return definitions.get(modulePath) ?? null
}





export function getPluginSecretFields(modulePath: string): readonly string[] {
  return secretFieldsByModule.get(modulePath) ?? []
}


export function hasPluginTask(modulePath: string): boolean {
  return definitions.has(modulePath)
}





export function createPluginTaskRegistry(env: Env): PluginTaskRegistry {
  const local = new Map<string, PluginTaskDefinition>()

  for (const definition of createBuiltinPluginTasks(env)) {
    local.set(definition.modulePath, definition)
  }
  for (const [modulePath, definition] of definitions) {
    if (!local.has(modulePath)) local.set(modulePath, definition)
  }

  return {
    resolve: (modulePath) => local.get(modulePath) ?? null,
    has: (modulePath) => local.has(modulePath)
  }
}





export function resetPluginTaskRegistry(): void {
  definitions.clear()
  secretFieldsByModule.clear()
  loadBuiltins()
}
