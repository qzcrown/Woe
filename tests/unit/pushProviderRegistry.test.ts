import { ProviderRegistry } from '../../src/services/push/providerRegistry'
import { DEFAULT_PUSH_DELIVERY_POLICY } from '../../src/services/push/contracts'
import type { PushProvider, ProviderSendResult } from '../../src/services/push/contracts'
import { scanAcmePushPackage } from '../helpers/scanTestPackages'

describe('ProviderRegistry.resolve four-state availability', () => {
  const readyProvider: PushProvider = {
    name: 'huawei',
    send: async (): Promise<ProviderSendResult> => ({ ok: true, retriable: false })
  }

  test('distinguishes ready / disabled / init-failed / unregistered', () => {
    const registry = new ProviderRegistry([
      { platform: 'huawei', provider: readyProvider, policy: { maxRetries: 5, retryBackoffMs: 500 } },
      { platform: 'apple', provider: null, policy: { maxRetries: 2, retryBackoffMs: 200 } },
      { platform: 'acme-push', provider: null, policy: DEFAULT_PUSH_DELIVERY_POLICY, initFailed: true }
    ])

    expect(registry.resolve('huawei')).toEqual({
      status: 'ready',
      provider: readyProvider,
      policy: { maxRetries: 5, retryBackoffMs: 500 }
    })
    expect(registry.resolve('apple')).toEqual({
      status: 'disabled',
      provider: null,
      policy: { maxRetries: 2, retryBackoffMs: 200 }
    })
    expect(registry.resolve('acme-push')).toEqual({
      status: 'init-failed',
      provider: null,
      policy: { maxRetries: 3, retryBackoffMs: 2000 }
    })
    expect(registry.resolve('legacy-vendor')).toEqual({
      status: 'unregistered',
      provider: null,
      policy: null
    })
  })

  test('resolve returns defensive policy copies', () => {
    const policy = { maxRetries: 4, retryBackoffMs: 400 }
    const registry = new ProviderRegistry([{ platform: 'huawei', provider: readyProvider, policy }])

    const first = registry.resolve('huawei')
    if (first.status !== 'ready') {
      throw new Error('expected huawei to resolve ready')
    }
    first.policy.maxRetries = 99
    expect(registry.resolve('huawei').policy).toEqual({ maxRetries: 4, retryBackoffMs: 400 })
  })

  test('still rejects duplicate platform registrations', () => {
    expect(() =>
      new ProviderRegistry([
        { platform: 'acme-push', provider: null, policy: DEFAULT_PUSH_DELIVERY_POLICY },
        { platform: 'acme-push', provider: null, policy: DEFAULT_PUSH_DELIVERY_POLICY, initFailed: true }
      ])
    ).toThrow(/Duplicate push provider registration for platform: acme-push/)
  })

  test('scanned acme-push package joins the runtime platform set outside the closed union', () => {
    const fixture = scanAcmePushPackage()
    try {
      expect(fixture.pushPlatforms).toEqual(['acme-push'])

      const [platform] = fixture.pushPlatforms
      const provider: PushProvider = {
        name: platform,
        send: async (): Promise<ProviderSendResult> => ({ ok: true, retriable: false })
      }
      const registry = new ProviderRegistry([
        { platform, provider, policy: DEFAULT_PUSH_DELIVERY_POLICY }
      ])

      expect(registry.get(platform)).toBe(provider)
      expect(registry.resolve(platform)).toMatchObject({ status: 'ready', provider })
    } finally {
      fixture.dispose()
    }
  })
})
