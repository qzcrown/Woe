import { moduleDescriptors } from '../../generated/plugins/catalog.ts'
import { serverModules } from '../../generated/plugins/server.ts'
import type { PushPluginDefinition } from '../push/types.ts'

const pushModules = serverModules as Readonly<Record<string, {
  push?: Pick<PushPluginDefinition, 'createRuntime'>
}>>

export const BUILTIN_PUSH_PLUGINS: readonly PushPluginDefinition[] = moduleDescriptors.flatMap(
  (descriptor): PushPluginDefinition[] => {
    if (!descriptor.push) return []
    const push = pushModules[descriptor.modulePath]?.push
    if (!push) throw new Error(`Missing generated push factory: ${descriptor.modulePath}`)
    return [{
      modulePath: descriptor.modulePath,


      platform: descriptor.push.platform,
      createRuntime: push.createRuntime
    }]
  }
)
