

export interface BuiltinPluginInfo {
  modulePath: string
  name: string
  capabilities: string[]
  author: string
  license: string
  website: string
}


export const BUILTIN_PLUGINS: BuiltinPluginInfo[] = [
  {
    modulePath: 'builtin/webhooker',
    name: 'Webhooker',
    capabilities: ['webhooker', 'messenger'],
    author: 'qzcrown',
    license: 'GPL-3.0-only',
    website: 'https://github.com/qzcrown/woe'
  },
  {
    modulePath: 'builtin/displayer',
    name: 'Displayer',
    capabilities: ['displayer'],
    author: 'qzcrown',
    license: 'GPL-3.0-only',
    website: 'https://github.com/qzcrown/woe'
  }
]
