












import { createPushRuntime } from '../../src/services/push/runtime'
import { DEFAULT_PUSH_DELIVERY_POLICY } from '../../src/services/push/contracts'
import type { PushProvider, PushProviderRegistration, ProviderSendResult } from '../../src/services/push/contracts'
import type { PushProviderFactoryContext, PushPluginDefinition } from '../../src/plugins/push/types'
import type { DrizzleDB } from '../../src/drizzle/index'
import type { Env } from '../../src/types/index'

const envFixture = {} as unknown as Env

function createFakeProvider(name: 'fixture_a' | 'fixture_b'): PushProvider {
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
  platform: 'fixture_a' | 'fixture_b',
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
    const fixture_aProvider = createFakeProvider('fixture_a')
    const fixture_bProvider = createFakeProvider('fixture_b')
    const fixture_aCalls = jest.fn()
    const fixture_bCalls = jest.fn()

    const runtime = await createPushRuntime(makeDrizzle(), envFixture, {
      definitions: [
        makeDefinition('test/push-fixture-a', 'fixture_a', fixture_aCalls, fixture_aProvider),
        makeDefinition('test/push-fixture-b', 'fixture_b', fixture_bCalls, fixture_bProvider)
      ]
    })

    expect(fixture_aCalls).toHaveBeenCalledTimes(1)
    expect(fixture_bCalls).toHaveBeenCalledTimes(1)
    expect(runtime.providers.get('fixture_a')).toBe(fixture_aProvider)
    expect(runtime.providers.get('fixture_b')).toBe(fixture_bProvider)


    expect(runtime.providers.get('fixture_a')).toBe(fixture_aProvider)
    expect(runtime.providers.get('fixture_a')).toBe(fixture_aProvider)
    expect(fixture_aCalls).toHaveBeenCalledTimes(1)
  })

  test('re-reads configuration per invocation without cross-instance pollution', async () => {
    const state: Record<string, string> = {
      'push.fixture_a.max_retries': '4',
      'push.fixture_a.retry_backoff_ms': '1500'
    }
    const drizzle = makeDrizzle(state)
    const definition: PushPluginDefinition = {
      modulePath: 'test/fixture_a',
      platform: 'fixture_a',
      async createRuntime(ctx: PushProviderFactoryContext): Promise<PushProviderRegistration> {
        const maxRetries = Number(await ctx.getStateValue('push.fixture_a.max_retries'))
        const retryBackoffMs = Number(await ctx.getStateValue('push.fixture_a.retry_backoff_ms'))
        return {
          platform: 'fixture_a',
          provider: createFakeProvider('fixture_a'),
          policy: { maxRetries, retryBackoffMs }
        }
      }
    }

    const first = await createPushRuntime(drizzle, envFixture, { definitions: [definition] })
    expect(first.providers.getPolicy('fixture_a')).toEqual({ maxRetries: 4, retryBackoffMs: 1500 })


    state['push.fixture_a.max_retries'] = '6'
    state['push.fixture_a.retry_backoff_ms'] = '2500'

    const second = await createPushRuntime(drizzle, envFixture, { definitions: [definition] })
    expect(second.providers.getPolicy('fixture_a')).toEqual({ maxRetries: 6, retryBackoffMs: 2500 })


    expect(first.providers.getPolicy('fixture_a')).toEqual({ maxRetries: 4, retryBackoffMs: 1500 })
    expect(first.providers.get('fixture_a')).not.toBe(second.providers.get('fixture_a'))
  })

  test('rejects a duplicate platform before invoking any factory', async () => {
    let factoryRan = false
    const definitions: PushPluginDefinition[] = [
      {
        modulePath: 'dup/a',
        platform: 'fixture_a',
        async createRuntime(): Promise<PushProviderRegistration> {
          factoryRan = true
          return { platform: 'fixture_a', provider: createFakeProvider('fixture_a'), policy: DEFAULT_PUSH_DELIVERY_POLICY }
        }
      },
      {
        modulePath: 'dup/b',
        platform: 'fixture_a',
        async createRuntime(): Promise<PushProviderRegistration> {
          factoryRan = true
          return { platform: 'fixture_a', provider: createFakeProvider('fixture_a'), policy: DEFAULT_PUSH_DELIVERY_POLICY }
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
        platform: 'fixture_a',
        async createRuntime(): Promise<PushProviderRegistration> {
          factoryRan = true
          return { platform: 'fixture_a', provider: createFakeProvider('fixture_a'), policy: DEFAULT_PUSH_DELIVERY_POLICY }
        }
      },
      {
        modulePath: 'dup/module',
        platform: 'fixture_b',
        async createRuntime(): Promise<PushProviderRegistration> {
          factoryRan = true
          return { platform: 'fixture_b', provider: createFakeProvider('fixture_b'), policy: DEFAULT_PUSH_DELIVERY_POLICY }
        }
      }
    ]

    await expect(createPushRuntime(makeDrizzle(), envFixture, { definitions })).rejects.toThrow()
    expect(factoryRan).toBe(false)
  })

  test('isolates one provider initialization failure', async () => {
    const fixture_bProvider = createFakeProvider('fixture_b')
    const logSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    const throwing: PushPluginDefinition = {
      modulePath: 'test/push-fixture-a',
      platform: 'fixture_a',
      async createRuntime(): Promise<PushProviderRegistration> {
        throw new Error('secret-sentinel')
      }
    }
    const fixture_bDefinition: PushPluginDefinition = {
      modulePath: 'test/push-fixture-b',
      platform: 'fixture_b',
      async createRuntime(): Promise<PushProviderRegistration> {
        return { platform: 'fixture_b', provider: fixture_bProvider, policy: DEFAULT_PUSH_DELIVERY_POLICY }
      }
    }

    const runtime = await createPushRuntime(makeDrizzle(), envFixture, {
      definitions: [throwing, fixture_bDefinition]
    })

    expect(runtime.providers.get('fixture_a')).toBeNull()
    expect(runtime.providers.getPolicy('fixture_a')).toEqual({ maxRetries: 3, retryBackoffMs: 2000 })
    expect(runtime.providers.get('fixture_b')).toBe(fixture_bProvider)
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain('secret-sentinel')


    const logged = JSON.stringify(logSpy.mock.calls)
    expect(logged).toContain('PUSH_PROVIDER_INIT_FAILED')
    expect(logged).toContain('test/push-fixture-a')
  })

  test('isolates a factory that returns a mismatched platform', async () => {
    const fixture_bProvider = createFakeProvider('fixture_b')
    jest.spyOn(console, 'error').mockImplementation(() => {})

    const wrongPlatform: PushPluginDefinition = {
      modulePath: 'test/push-fixture-a',
      platform: 'fixture_a',
      async createRuntime(): Promise<PushProviderRegistration> {
        return { platform: 'fixture_b', provider: fixture_bProvider, policy: DEFAULT_PUSH_DELIVERY_POLICY }
      }
    }
    const fixture_bDefinition: PushPluginDefinition = {
      modulePath: 'test/push-fixture-b',
      platform: 'fixture_b',
      async createRuntime(): Promise<PushProviderRegistration> {
        return { platform: 'fixture_b', provider: fixture_bProvider, policy: DEFAULT_PUSH_DELIVERY_POLICY }
      }
    }

    const runtime = await createPushRuntime(makeDrizzle(), envFixture, {
      definitions: [wrongPlatform, fixture_bDefinition]
    })

    expect(runtime.providers.get('fixture_a')).toBeNull()
    expect(runtime.providers.getPolicy('fixture_a')).toEqual({ maxRetries: 3, retryBackoffMs: 2000 })
    expect(runtime.providers.get('fixture_b')).toBe(fixture_bProvider)
  })

  test('isolates a factory that returns a provider whose name mismatches the platform', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})

    const wrongName: PushPluginDefinition = {
      modulePath: 'test/push-fixture-a',
      platform: 'fixture_a',
      async createRuntime(): Promise<PushProviderRegistration> {
        return { platform: 'fixture_a', provider: createFakeProvider('fixture_b'), policy: DEFAULT_PUSH_DELIVERY_POLICY }
      }
    }
    const fixture_bDefinition: PushPluginDefinition = {
      modulePath: 'test/push-fixture-b',
      platform: 'fixture_b',
      async createRuntime(): Promise<PushProviderRegistration> {
        return { platform: 'fixture_b', provider: createFakeProvider('fixture_b'), policy: DEFAULT_PUSH_DELIVERY_POLICY }
      }
    }

    const runtime = await createPushRuntime(makeDrizzle(), envFixture, {
      definitions: [wrongName, fixture_bDefinition]
    })

    expect(runtime.providers.get('fixture_a')).toBeNull()
    expect(runtime.providers.getPolicy('fixture_a')).toEqual({ maxRetries: 3, retryBackoffMs: 2000 })
    expect(runtime.providers.get('fixture_b')).not.toBeNull()
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
      platform: 'fixture_a',
      async createRuntime(ctx: PushProviderFactoryContext): Promise<PushProviderRegistration> {
        observed = await ctx.getStateValue('push.fixture_a.max_retries')
        return { platform: 'fixture_a', provider: null, policy: DEFAULT_PUSH_DELIVERY_POLICY }
      }
    }

    const runtime = await createPushRuntime(failingDrizzle, envFixture, { definitions: [probe] })

    expect(observed).toBeNull()
    expect(runtime.providers.get('fixture_a')).toBeNull()
  })

  test('getBinding exposes only string bindings', async () => {
    let projectId: string | undefined
    let queueBinding: string | undefined
    const probe: PushPluginDefinition = {
      modulePath: 'test/bindings',
      platform: 'fixture_a',
      async createRuntime(ctx: PushProviderFactoryContext): Promise<PushProviderRegistration> {
        projectId = ctx.getBinding('FIXTURE_PROJECT_ID')
        queueBinding = ctx.getBinding('PUSH_QUEUE')
        return { platform: 'fixture_a', provider: null, policy: DEFAULT_PUSH_DELIVERY_POLICY }
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
      platform: 'fixture_a',
      async createRuntime(ctx: PushProviderFactoryContext): Promise<PushProviderRegistration> {
        await ctx.fetchFn('https://example.test')
        return { platform: 'fixture_a', provider: createFakeProvider('fixture_a'), policy: DEFAULT_PUSH_DELIVERY_POLICY }
      }
    }

    const runtime = await createPushRuntime(makeDrizzle(), envFixture, { definitions: [probe] })

    expect(runtime.providers.get('fixture_a')).not.toBeNull()
    expect(receivers).toHaveLength(1)
    expect(receivers[0]).toBe(globalThis)
  })

  test('keeps an explicit fetch reference without rebinding', async () => {
    const injected = jest.fn().mockResolvedValue(undefined) as unknown as typeof fetch
    let captured: typeof fetch | undefined
    const probe: PushPluginDefinition = {
      modulePath: 'test/explicit-fetch',
      platform: 'fixture_b',
      async createRuntime(ctx: PushProviderFactoryContext): Promise<PushProviderRegistration> {
        captured = ctx.fetchFn
        return { platform: 'fixture_b', provider: createFakeProvider('fixture_b'), policy: DEFAULT_PUSH_DELIVERY_POLICY }
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
