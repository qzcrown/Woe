import { ProviderRegistry } from '../../src/services/push/providerRegistry'
import { DEFAULT_PUSH_DELIVERY_POLICY } from '../../src/services/push/contracts'
import type {
  ProviderSendInput,
  ProviderSendResult,
  PushProvider,
  PushProviderRegistration
} from '../../src/services/push/contracts'

function createFakeProvider(name: 'huawei' | 'apple'): PushProvider {
  return {
    name,
    send: async (_input: ProviderSendInput): Promise<ProviderSendResult> => ({
      ok: true,
      retriable: false
    })
  }
}

describe('provider registry', () => {
  test('returns the provider instance registered for a platform', () => {
    const huawei = createFakeProvider('huawei')
    const apple = createFakeProvider('apple')
    const registry = new ProviderRegistry([
      { platform: 'huawei', provider: huawei, policy: { maxRetries: 4, retryBackoffMs: 3000 } },
      { platform: 'apple', provider: apple, policy: { maxRetries: 2, retryBackoffMs: 1000 } }
    ])

    expect(registry.get('huawei')).toBe(huawei)
    expect(registry.get('apple')).toBe(apple)
  })

  test('returns each platform policy independently', () => {
    const registry = new ProviderRegistry([
      { platform: 'huawei', provider: createFakeProvider('huawei'), policy: { maxRetries: 4, retryBackoffMs: 3000 } },
      { platform: 'apple', provider: createFakeProvider('apple'), policy: { maxRetries: 2, retryBackoffMs: 1000 } }
    ])

    expect(registry.getPolicy('huawei')).toEqual({ maxRetries: 4, retryBackoffMs: 3000 })
    expect(registry.getPolicy('apple')).toEqual({ maxRetries: 2, retryBackoffMs: 1000 })
  })

  test('retains policy for a disabled platform', () => {
    const registry = new ProviderRegistry([
      { platform: 'huawei', provider: null, policy: { maxRetries: 5, retryBackoffMs: 7000 } }
    ]);
    expect(registry.get('huawei')).toBeNull();
    expect(registry.getPolicy('huawei')).toEqual({ maxRetries: 5, retryBackoffMs: 7000 });
    expect(registry.getPolicy('apple')).toBeNull();
  })

  test('returns null provider and null policy for unknown platforms', () => {
    const registry = new ProviderRegistry([
      { platform: 'apple', provider: createFakeProvider('apple'), policy: { maxRetries: 2, retryBackoffMs: 1000 } }
    ])

    expect(registry.get('huawei')).toBeNull()
    expect(registry.getPolicy('huawei')).toBeNull()
  })

  test('throws when the same platform is registered twice', () => {
    expect(
      () =>
        new ProviderRegistry([
          { platform: 'huawei', provider: createFakeProvider('huawei'), policy: { maxRetries: 1, retryBackoffMs: 1 } },
          { platform: 'huawei', provider: createFakeProvider('huawei'), policy: { maxRetries: 2, retryBackoffMs: 2 } }
        ])
    ).toThrow()
  })

  test('throws when provider name does not match registration platform', () => {
    expect(
      () =>
        new ProviderRegistry([
          { platform: 'huawei', provider: createFakeProvider('apple'), policy: { maxRetries: 1, retryBackoffMs: 1 } }
        ])
    ).toThrow()
  })

  test('is unaffected by external mutation of the input array and policies', () => {
    const policy = { maxRetries: 5, retryBackoffMs: 7000 }
    const entries: PushProviderRegistration[] = [
      { platform: 'huawei', provider: createFakeProvider('huawei'), policy }
    ]
    const registry = new ProviderRegistry(entries)


    policy.maxRetries = 99
    policy.retryBackoffMs = 99

    entries.push({
      platform: 'apple',
      provider: createFakeProvider('apple'),
      policy: { maxRetries: 1, retryBackoffMs: 1 }
    })

    expect(registry.getPolicy('huawei')).toEqual({ maxRetries: 5, retryBackoffMs: 7000 })
    expect(registry.getPolicy('apple')).toBeNull()
  })

  test('returns a fresh policy copy that external mutation cannot change', () => {
    const registry = new ProviderRegistry([
      { platform: 'huawei', provider: createFakeProvider('huawei'), policy: { maxRetries: 5, retryBackoffMs: 7000 } }
    ])

    const first = registry.getPolicy('huawei')
    expect(first).toEqual({ maxRetries: 5, retryBackoffMs: 7000 })

    first!.maxRetries = 99
    first!.retryBackoffMs = 99

    const second = registry.getPolicy('huawei')
    expect(second).toEqual({ maxRetries: 5, retryBackoffMs: 7000 })
    expect(second).not.toBe(first)
  })

  test('exposes an immutable default policy', () => {
    expect(DEFAULT_PUSH_DELIVERY_POLICY).toEqual({ maxRetries: 3, retryBackoffMs: 2000 })
    expect(Object.isFrozen(DEFAULT_PUSH_DELIVERY_POLICY)).toBe(true)
  })
})
