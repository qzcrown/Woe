import { moduleDescriptors } from '../generated/plugins/catalog.ts'

export interface BuiltinPluginInfo {
  modulePath: string
  name: string
  capabilities: string[]
  author: string
  license: string
  website: string
}

export const BUILTIN_PLUGINS: BuiltinPluginInfo[] = moduleDescriptors.map(descriptor => ({
  modulePath: descriptor.modulePath,
  name: descriptor.name,
  capabilities: [...descriptor.capabilities],
  author: descriptor.author,
  license: descriptor.license,
  website: descriptor.website
}))
