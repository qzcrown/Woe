












import type { Env } from '../../types/index.ts'
import type { PluginTaskDefinition } from './types.ts'
import {
  builtinPluginTaskMetadata,
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
  for (const metadata of builtinPluginTaskMetadata) {
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
