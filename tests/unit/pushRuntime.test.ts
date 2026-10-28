












import { createPushRuntime, createPushResolverFactory } from '../../src/services/push/runtime'
import { DEFAULT_PUSH_DELIVERY_POLICY } from '../../src/services/push/contracts'
import type { PushProvider, PushProviderRegistration, ProviderSendResult } from '../../src/services/push/contracts'
import type { PushProviderFactoryContext, PushPluginDefinition } from '../../src/plugins/push/types'
import type { DrizzleDB } from '../../src/drizzle/index'
import type { Env } from '../../src/types/index'
import { scanAcmePushPackage } from '../helpers/scanTestPackages'

const envFixture = {} as unknown as Env

function createFakeProvider(name: string): PushProvider {
  return {
    name,
    send: async (): Promise<ProviderSendResult> => ({ ok: true, retriable: false })
  }
}


function makeDrizzle(state: Record<string, string> = {}): DrizzleDB {
  return {
    $client: {
      prepare: (_sql: string) => ({
        bind: (key: string) => ({
          first: async () => (key in state ? { value: state[key] } : null)
        })
      })
    }
  } as unknown as DrizzleDB
}


function makeDefinition(
  modulePath: string,
  platform: string,
  onCall: () => void,
  provider: PushProvider
): PushPluginDefinition {
  return {
    modulePath,
    platform,
    async createRuntime(): Promise<PushProviderRegistration> {
      onCall()
      return { platform, provider, policy: DEFAULT_PUSH_DELIVERY_POLICY }
    }
  }
}

describe('push runtime assembly', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    jest.restoreAllMocks()
    globalThis.fetch = originalFetch
  })

  test('initializes each definition exactly once and reuses provider instances', async () => {
    const huaweiProvider = createFakeProvider('huawei')
    const appleProvider = createFakeProvider('apple')
    const huaweiCalls = jest.fn()
    const appleCalls = jest.fn()

    const runtime = await createPushRuntime(makeDrizzle(), envFixture, {
      definitions: [
        makeDefinition('test/push-fixture-a', 'huawei', huaweiCalls, huaweiProvider),
        makeDefinition('test/push-fixture-b', 'apple', appleCalls, appleProvider)
      ]
    })

    expect(huaweiCalls).toHaveBeenCalledTimes(1)
    expect(appleCalls).toHaveBeenCalledTimes(1)
    expect(runtime.providers.get('huawei')).toBe(huaweiProvider)
    expect(runtime.providers.get('apple')).toBe(appleProvider)


    expect(runtime.providers.get('huawei')).toBe(huaweiProvider)
    expect(runtime.providers.get('huawei')).toBe(huaweiProvider)
    expect(huaweiCalls).toHaveBeenCalledTimes(1)
  })

  test('re-reads configuration per invocation without cross-instance pollution', async () => {
    const state: Record<string, string> = {
      'push.huawei.max_retries': '4',
      'push.huawei.retry_backoff_ms': '1500'
    }
    const drizzle = makeDrizzle(state)
    const definition: PushPluginDefinition = {
      modulePath: 'test/huawei',
      platform: 'huawei',
      async createRuntime(ctx: PushProviderFactoryContext): Promise<PushProviderRegistration> {
        const maxRetries = Number(await ctx.getStateValue('push.huawei.max_retries'))
        const retryBackoffMs = Number(await ctx.getStateValue('push.huawei.retry_backoff_ms'))
        return {
          platform: 'huawei',
          provider: createFakeProvider('huawei'),
          policy: { maxRetries, retryBackoffMs }
        }
      }
    }

    const first = await createPushRuntime(drizzle, envFixture, { definitions: [definition] })
    expect(first.providers.getPolicy('huawei')).toEqual({ maxRetries: 4, retryBackoffMs: 1500 })


    state['push.huawei.max_retries'] = '6'
    state['push.huawei.retry_backoff_ms'] = '2500'

    const second = await createPushRuntime(drizzle, envFixture, { definitions: [definition] })
    expect(second.providers.getPolicy('huawei')).toEqual({ maxRetries: 6, retryBackoffMs: 2500 })


    expect(first.providers.getPolicy('huawei')).toEqual({ maxRetries: 4, retryBackoffMs: 1500 })
    expect(first.providers.get('huawei')).not.toBe(second.providers.get('huawei'))
  })

  test('assembles exactly the providers declared by the current generated catalog', async () => {
    const { BUILTIN_PUSH_PLUGINS } = await import('../../src/plugins/builtin/pushPlugins')
    const runtime = await createPushRuntime(
      makeDrizzle({ 'push.huawei.enabled_global': '0' }),
      envFixture
    )

    for (const platform of ['huawei', 'apple']) {
      const declared = BUILTIN_PUSH_PLUGINS.some(definition => definition.platform === platform)
      const resolution = runtime.providers.resolve(platform)
      if (!declared) {
        expect(resolution.status).toBe('unregistered')
      } else if (platform === 'huawei') {
        expect(resolution).toMatchObject({
          status: 'disabled',
          provider: null,
          policy: { maxRetries: 3, retryBackoffMs: 2000 }
        })
      } else {
        expect(resolution.status).toBe('ready')
      }
    }
    expect(runtime.providers.resolve('legacy-vendor').status).toBe('unregistered')
  })

  test('rejects a duplicate platform before invoking any factory', async () => {
    let factoryRan = false
    const definitions: PushPluginDefinition[] = [
      {
        modulePath: 'dup/a',
        platform: 'huawei',
        async createRuntime(): Promise<PushProviderRegistration> {
          factoryRan = true
          return { platform: 'huawei', provider: createFakeProvider('huawei'), policy: DEFAULT_PUSH_DELIVERY_POLICY }
        }
      },
      {
        modulePath: 'dup/b',
        platform: 'huawei',
        async createRuntime(): Promise<PushProviderRegistration> {
          factoryRan = true
          return { platform: 'huawei', provider: createFakeProvider('huawei'), policy: DEFAULT_PUSH_DELIVERY_POLICY }
        }
      }
    ]

    await expect(createPushRuntime(makeDrizzle(), envFixture, { definitions })).rejects.toThrow()
    expect(factoryRan).toBe(false)
  })

  test('rejects a duplicate modulePath before invoking any factory', async () => {
    let factoryRan = false
    const definitions: PushPluginDefinition[] = [
      {
        modulePath: 'dup/module',
        platform: 'huawei',
        async createRuntime(): Promise<PushProviderRegistration> {
          factoryRan = true
          return { platform: 'huawei', provider: createFakeProvider('huawei'), policy: DEFAULT_PUSH_DELIVERY_POLICY }
        }
      },
      {
        modulePath: 'dup/module',
        platform: 'apple',
        async createRuntime(): Promise<PushProviderRegistration> {
          factoryRan = true
          return { platform: 'apple', provider: createFakeProvider('apple'), policy: DEFAULT_PUSH_DELIVERY_POLICY }
        }
      }
    ]

    await expect(createPushRuntime(makeDrizzle(), envFixture, { definitions })).rejects.toThrow()
    expect(factoryRan).toBe(false)
  })

  test('isolates one provider initialization failure', async () => {
    const appleProvider = createFakeProvider('apple')
    const logSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    const throwing: PushPluginDefinition = {
      modulePath: 'test/push-fixture-a',
      platform: 'huawei',
      async createRuntime(): Promise<PushProviderRegistration> {
        throw new Error('secret-sentinel')
      }
    }
    const appleDefinition: PushPluginDefinition = {
      modulePath: 'test/push-fixture-b',
      platform: 'apple',
      async createRuntime(): Promise<PushProviderRegistration> {
        return { platform: 'apple', provider: appleProvider, policy: DEFAULT_PUSH_DELIVERY_POLICY }
      }
    }

    const runtime = await createPushRuntime(makeDrizzle(), envFixture, {
      definitions: [throwing, appleDefinition]
    })

    expect(runtime.providers.get('huawei')).toBeNull()
    expect(runtime.providers.getPolicy('huawei')).toEqual({ maxRetries: 3, retryBackoffMs: 2000 })
    expect(runtime.providers.get('apple')).toBe(appleProvider)
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain('secret-sentinel')


    const logged = JSON.stringify(logSpy.mock.calls)
    expect(logged).toContain('PUSH_PROVIDER_INIT_FAILED')
    expect(logged).toContain('test/push-fixture-a')
  })

  test('isolates a factory that returns a mismatched platform', async () => {
    const appleProvider = createFakeProvider('apple')
    jest.spyOn(console, 'error').mockImplementation(() => {})

    const wrongPlatform: PushPluginDefinition = {
      modulePath: 'test/push-fixture-a',
      platform: 'huawei',
      async createRuntime(): Promise<PushProviderRegistration> {
        return { platform: 'apple', provider: appleProvider, policy: DEFAULT_PUSH_DELIVERY_POLICY }
      }
    }
    const appleDefinition: PushPluginDefinition = {
      modulePath: 'test/push-fixture-b',
      platform: 'apple',
      async createRuntime(): Promise<PushProviderRegistration> {
        return { platform: 'apple', provider: appleProvider, policy: DEFAULT_PUSH_DELIVERY_POLICY }
      }
    }

    const runtime = await createPushRuntime(makeDrizzle(), envFixture, {
      definitions: [wrongPlatform, appleDefinition]
    })

    expect(runtime.providers.get('huawei')).toBeNull()
    expect(runtime.providers.getPolicy('huawei')).toEqual({ maxRetries: 3, retryBackoffMs: 2000 })
    expect(runtime.providers.get('apple')).toBe(appleProvider)
  })

  test('isolates a factory that returns a provider whose name mismatches the platform', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})

    const wrongName: PushPluginDefinition = {
      modulePath: 'test/push-fixture-a',
      platform: 'huawei',
      async createRuntime(): Promise<PushProviderRegistration> {
        return { platform: 'huawei', provider: createFakeProvider('apple'), policy: DEFAULT_PUSH_DELIVERY_POLICY }
      }
    }
    const appleDefinition: PushPluginDefinition = {
      modulePath: 'test/push-fixture-b',
      platform: 'apple',
      async createRuntime(): Promise<PushProviderRegistration> {
        return { platform: 'apple', provider: createFakeProvider('apple'), policy: DEFAULT_PUSH_DELIVERY_POLICY }
      }
    }

    const runtime = await createPushRuntime(makeDrizzle(), envFixture, {
      definitions: [wrongName, appleDefinition]
    })

    expect(runtime.providers.get('huawei')).toBeNull()
    expect(runtime.providers.getPolicy('huawei')).toEqual({ maxRetries: 3, retryBackoffMs: 2000 })
    expect(runtime.providers.get('apple')).not.toBeNull()
  })

  test('getStateValue returns null when the D1 read fails', async () => {
    const failingDrizzle = {
      $client: {
        prepare: () => ({
          bind: () => ({
            first: async () => {
              throw new Error('d1 unavailable')
            }
          })
        })
      }
    } as unknown as DrizzleDB

    let observed: string | null | undefined
    const probe: PushPluginDefinition = {
      modulePath: 'test/probe',
      platform: 'huawei',
      async createRuntime(ctx: PushProviderFactoryContext): Promise<PushProviderRegistration> {
        observed = await ctx.getStateValue('push.huawei.max_retries')
        return { platform: 'huawei', provider: null, policy: DEFAULT_PUSH_DELIVERY_POLICY }
      }
    }

    const runtime = await createPushRuntime(failingDrizzle, envFixture, { definitions: [probe] })

    expect(observed).toBeNull()
    expect(runtime.providers.get('huawei')).toBeNull()
  })

  test('getBinding exposes only string bindings', async () => {
    let projectId: string | undefined
    let queueBinding: string | undefined
    const probe: PushPluginDefinition = {
      modulePath: 'test/bindings',
      platform: 'huawei',
      async createRuntime(ctx: PushProviderFactoryContext): Promise<PushProviderRegistration> {
        projectId = ctx.getBinding('FIXTURE_PROJECT_ID')
        queueBinding = ctx.getBinding('PUSH_QUEUE')
        return { platform: 'huawei', provider: null, policy: DEFAULT_PUSH_DELIVERY_POLICY }
      }
    }

    await createPushRuntime(
      makeDrizzle(),
      { FIXTURE_PROJECT_ID: 'project-1', PUSH_QUEUE: {} } as unknown as Env,
      { definitions: [probe] }
    )

    expect(projectId).toBe('project-1')
    expect(queueBinding).toBeUndefined()
  })

  test('binds the default fetch to globalThis', async () => {
    const receivers: unknown[] = []
    globalThis.fetch = function (this: unknown) {
      receivers.push(this)
      return Promise.resolve(undefined as unknown as Response)
    } as unknown as typeof fetch

    const probe: PushPluginDefinition = {
      modulePath: 'test/default-fetch',
      platform: 'huawei',
      async createRuntime(ctx: PushProviderFactoryContext): Promise<PushProviderRegistration> {
        await ctx.fetchFn('https://example.test')
        return { platform: 'huawei', provider: createFakeProvider('huawei'), policy: DEFAULT_PUSH_DELIVERY_POLICY }
      }
    }

    const runtime = await createPushRuntime(makeDrizzle(), envFixture, { definitions: [probe] })

    expect(runtime.providers.get('huawei')).not.toBeNull()
    expect(receivers).toHaveLength(1)
    expect(receivers[0]).toBe(globalThis)
  })

  test('keeps an explicit fetch reference without rebinding', async () => {
    const injected = jest.fn().mockResolvedValue(undefined) as unknown as typeof fetch
    let captured: typeof fetch | undefined
    const probe: PushPluginDefinition = {
      modulePath: 'test/explicit-fetch',
      platform: 'apple',
      async createRuntime(ctx: PushProviderFactoryContext): Promise<PushProviderRegistration> {
        captured = ctx.fetchFn
        return { platform: 'apple', provider: createFakeProvider('apple'), policy: DEFAULT_PUSH_DELIVERY_POLICY }
      }
    }

    await createPushRuntime(makeDrizzle(), envFixture, { definitions: [probe], fetchFn: injected })

    expect(captured).toBe(injected)
  })
})

describe('push runtime module load', () => {
  test('importing the runtime module performs no configuration read or network request', async () => {
    const previousFetch = globalThis.fetch
    const fetchSpy = jest.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    try {
      jest.resetModules()
      const module = await import('../../src/services/push/runtime')
      expect(typeof module.createPushRuntime).toBe('function')
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      globalThis.fetch = previousFetch
    }
  })
})

describe('push runtime provider availability protocol', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('createPushResolverFactory 每次调用都重新装配并返回当前 resolver', async () => {
    const state: Record<string, string> = { 'push.huawei.max_retries': '4' }
    const drizzle = makeDrizzle(state)
    const calls: number[] = []
    const definition: PushPluginDefinition = {
      modulePath: 'test/huawei',
      platform: 'huawei',
      async createRuntime(ctx: PushProviderFactoryContext): Promise<PushProviderRegistration> {
        calls.push(Number(await ctx.getStateValue('push.huawei.max_retries')))
        return {
          platform: 'huawei',
          provider: createFakeProvider('huawei'),
          policy: { maxRetries: 4, retryBackoffMs: 2000 }
        }
      }
    }

    const factory = createPushResolverFactory(drizzle, envFixture, { definitions: [definition] })
    const first = await factory()
    const second = await factory()


    expect(calls).toEqual([4, 4])
    expect(first).not.toBe(second)
    expect(first.get('huawei')).not.toBe(second.get('huawei'))
    expect(first.resolve('huawei')).toEqual({
      status: 'ready',
      provider: expect.anything(),
      policy: { maxRetries: 4, retryBackoffMs: 2000 }
    })


    state['push.huawei.max_retries'] = '6'
    const third = await factory()
    expect(calls).toEqual([4, 4, 6])
    expect(third.resolve('huawei').status).toBe('ready')
  })

  test('a scanned acme-push definition resolves to ready on its declared platform', async () => {
    const fixture = scanAcmePushPackage()
    try {
      const [platform] = fixture.pushPlatforms
      const provider = createFakeProvider(platform)
      const definition: PushPluginDefinition = {
        modulePath: 'builtin/acme-push',
        platform,
        async createRuntime(): Promise<PushProviderRegistration> {
          return { platform, provider, policy: { maxRetries: 1, retryBackoffMs: 100 } }
        }
      }

      const runtime = await createPushRuntime(makeDrizzle(), envFixture, { definitions: [definition] })

      expect(runtime.providers.resolve(platform)).toEqual({
        status: 'ready',
        provider,
        policy: { maxRetries: 1, retryBackoffMs: 100 }
      })
    } finally {
      fixture.dispose()
    }
  })

  test('resolve separates disabled, init-failed and unregistered without affecting other platforms', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const appleProvider = createFakeProvider('apple')
    const definitions: PushPluginDefinition[] = [
      {

        modulePath: 'builtin/acme-push',
        platform: 'acme-push',
        async createRuntime(): Promise<PushProviderRegistration> {
          return { platform: 'acme-push', provider: null, policy: { maxRetries: 2, retryBackoffMs: 200 } }
        }
      },
      {

        modulePath: 'test/push-fixture-a',
        platform: 'huawei',
        async createRuntime(): Promise<PushProviderRegistration> {
          throw new Error('init-sentinel')
        }
      },
      {

        modulePath: 'test/push-fixture-b',
        platform: 'apple',
        async createRuntime(): Promise<PushProviderRegistration> {
          return { platform: 'apple', provider: appleProvider, policy: DEFAULT_PUSH_DELIVERY_POLICY }
        }
      }
    ]

    const runtime = await createPushRuntime(makeDrizzle(), envFixture, { definitions })

    expect(runtime.providers.resolve('acme-push')).toEqual({
      status: 'disabled',
      provider: null,
      policy: { maxRetries: 2, retryBackoffMs: 200 }
    })
    expect(runtime.providers.resolve('huawei')).toEqual({
      status: 'init-failed',
      provider: null,
      policy: { maxRetries: 3, retryBackoffMs: 2000 }
    })
    expect(runtime.providers.resolve('apple')).toEqual({
      status: 'ready',
      provider: appleProvider,
      policy: { maxRetries: 3, retryBackoffMs: 2000 }
    })
    expect(runtime.providers.resolve('legacy-vendor')).toEqual({
      status: 'unregistered',
      provider: null,
      policy: null
    })
  })
})
