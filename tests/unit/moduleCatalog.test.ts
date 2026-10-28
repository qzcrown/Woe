import {
  createModuleCatalog,
  type ModuleDescriptor
} from '../../src/plugins/moduleCatalog.ts'

function descriptor(modulePath: string, overrides: Partial<ModuleDescriptor> = {}): ModuleDescriptor {
  return {
    modulePath,
    name: modulePath,
    capabilities: ['test'],
    author: 'qzcrown',
    license: 'GPL-3.0-only',
    website: 'https://github.com/qzcrown/woe',
    secretFields: [],
    ...overrides
  }
}

describe('createModuleCatalog', () => {
  test('distinguishes an unknown module from a known module with no secrets', () => {
    const catalog = createModuleCatalog([descriptor('builtin/plain')])

    expect(catalog.get('builtin/missing')).toBeNull()
    expect(catalog.has('builtin/missing')).toBe(false)
    expect(catalog.get('builtin/plain')).toMatchObject({
      modulePath: 'builtin/plain',
      secretFields: []
    })
    expect(catalog.has('builtin/plain')).toBe(true)
  })

  test('deduplicates and sorts quota namespaces and push platforms', () => {
    const catalog = createModuleCatalog([
      descriptor('builtin/zeta', {
        task: { supportedSubjectTypes: ['message'], quotaNamespace: 'z-quota' },
        push: { platform: 'z-platform' }
      }),
      descriptor('builtin/alpha', {
        task: { supportedSubjectTypes: ['message'], quotaNamespace: 'a-quota' },
        push: { platform: 'a-platform' }
      }),
      descriptor('builtin/shared', {
        task: { supportedSubjectTypes: ['message'], quotaNamespace: 'a-quota' },
        push: { platform: 'z-platform' }
      }),
      descriptor('builtin/no-capabilities')
    ])

    expect(catalog.quotaNamespaces()).toEqual(['a-quota', 'z-quota'])
    expect(catalog.pushPlatforms()).toEqual(['a-platform', 'z-platform'])
  })

  test('returns detached deeply read-only descriptors and lists', () => {
    const input = descriptor('builtin/alpha', {
      capabilities: ['original'],
      secretFields: ['token'],
      task: { supportedSubjectTypes: ['message'], quotaNamespace: 'quota' },
      frontend: { clientPlatformLabels: { vendor: 'Vendor' } }
    })
    const catalog = createModuleCatalog([input])
    ;(input.capabilities as string[]).push('mutated')
    ;(input.task!.supportedSubjectTypes as string[]).push('mutated')
    input.frontend!.clientPlatformLabels = { vendor: 'Mutated' }

    const listed = catalog.list()
    const fetched = catalog.get('builtin/alpha')!
    expect(listed).toHaveLength(1)
    expect(fetched.capabilities).toEqual(['original'])
    expect(fetched.task!.supportedSubjectTypes).toEqual(['message'])
    expect(fetched.frontend!.clientPlatformLabels).toEqual({ vendor: 'Vendor' })
    expect(Object.isFrozen(listed)).toBe(true)
    expect(Object.isFrozen(fetched)).toBe(true)
    expect(Object.isFrozen(fetched.task!.supportedSubjectTypes)).toBe(true)
    expect(Object.isFrozen(fetched.frontend!.clientPlatformLabels)).toBe(true)
    expect(Object.isFrozen(catalog.quotaNamespaces())).toBe(true)
    expect(Object.isFrozen(catalog.pushPlatforms())).toBe(true)
    expect(() => (listed as ModuleDescriptor[]).push(fetched)).toThrow(TypeError)
    expect(() => (fetched.secretFields as string[]).push('other')).toThrow(TypeError)
  })

  test('rejects duplicate module identities instead of silently overwriting them', () => {
    expect(() => createModuleCatalog([
      descriptor('builtin/same', { name: 'first' }),
      descriptor('builtin/same', { name: 'second' })
    ])).toThrow(/builtin\/same.*modulePath|modulePath.*builtin\/same/)
  })
})
