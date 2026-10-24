import { ProviderRegistry } from '../../src/services/push/providerRegistry'
import { DEFAULT_PUSH_DELIVERY_POLICY } from '../../src/services/push/contracts'
import type {
  ProviderSendInput,
  ProviderSendResult,
  PushProvider,
  PushProviderRegistration
} from '../../src/services/push/contracts'

function createFakeProvider(name: 'fixture_a' | 'fixture_b'): PushProvider {
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
    const fixture_a = createFakeProvider('fixture_a')
    const fixture_b = createFakeProvider('fixture_b')
    const registry = new ProviderRegistry([
      { platform: 'fixture_a', provider: fixture_a, policy: { maxRetries: 4, retryBackoffMs: 3000 } },
      { platform: 'fixture_b', provider: fixture_b, policy: { maxRetries: 2, retryBackoffMs: 1000 } }
    ])

    expect(registry.get('fixture_a')).toBe(fixture_a)
    expect(registry.get('fixture_b')).toBe(fixture_b)
  })

  test('returns each platform policy independently', () => {
    const registry = new ProviderRegistry([
      { platform: 'fixture_a', provider: createFakeProvider('fixture_a'), policy: { maxRetries: 4, retryBackoffMs: 3000 } },
      { platform: 'fixture_b', provider: createFakeProvider('fixture_b'), policy: { maxRetries: 2, retryBackoffMs: 1000 } }
    ])

    expect(registry.getPolicy('fixture_a')).toEqual({ maxRetries: 4, retryBackoffMs: 3000 })
    expect(registry.getPolicy('fixture_b')).toEqual({ maxRetries: 2, retryBackoffMs: 1000 })
  })

  test('retains policy for a disabled platform', () => {
    const registry = new ProviderRegistry([
      { platform: 'fixture_a', provider: null, policy: { maxRetries: 5, retryBackoffMs: 7000 } }
    ]);
    expect(registry.get('fixture_a')).toBeNull();
    expect(registry.getPolicy('fixture_a')).toEqual({ maxRetries: 5, retryBackoffMs: 7000 });
    expect(registry.getPolicy('fixture_b')).toBeNull();
  })

  test('returns null provider and null policy for unknown platforms', () => {
    const registry = new ProviderRegistry([
      { platform: 'fixture_b', provider: createFakeProvider('fixture_b'), policy: { maxRetries: 2, retryBackoffMs: 1000 } }
    ])

    expect(registry.get('fixture_a')).toBeNull()
    expect(registry.getPolicy('fixture_a')).toBeNull()
  })

  test('throws when the same platform is registered twice', () => {
    expect(
      () =>
        new ProviderRegistry([
          { platform: 'fixture_a', provider: createFakeProvider('fixture_a'), policy: { maxRetries: 1, retryBackoffMs: 1 } },
          { platform: 'fixture_a', provider: createFakeProvider('fixture_a'), policy: { maxRetries: 2, retryBackoffMs: 2 } }
        ])
    ).toThrow()
  })

  test('throws when provider name does not match registration platform', () => {
    expect(
      () =>
        new ProviderRegistry([
          { platform: 'fixture_a', provider: createFakeProvider('fixture_b'), policy: { maxRetries: 1, retryBackoffMs: 1 } }
        ])
    ).toThrow()
  })

  test('is unaffected by external mutation of the input array and policies', () => {
    const policy = { maxRetries: 5, retryBackoffMs: 7000 }
    const entries: PushProviderRegistration[] = [
      { platform: 'fixture_a', provider: createFakeProvider('fixture_a'), policy }
    ]
    const registry = new ProviderRegistry(entries)


    policy.maxRetries = 99
    policy.retryBackoffMs = 99

    entries.push({
      platform: 'fixture_b',
      provider: createFakeProvider('fixture_b'),
      policy: { maxRetries: 1, retryBackoffMs: 1 }
    })

    expect(registry.getPolicy('fixture_a')).toEqual({ maxRetries: 5, retryBackoffMs: 7000 })
    expect(registry.getPolicy('fixture_b')).toBeNull()
  })

  test('returns a fresh policy copy that external mutation cannot change', () => {
    const registry = new ProviderRegistry([
      { platform: 'fixture_a', provider: createFakeProvider('fixture_a'), policy: { maxRetries: 5, retryBackoffMs: 7000 } }
    ])

    const first = registry.getPolicy('fixture_a')
    expect(first).toEqual({ maxRetries: 5, retryBackoffMs: 7000 })

    first!.maxRetries = 99
    first!.retryBackoffMs = 99

    const second = registry.getPolicy('fixture_a')
    expect(second).toEqual({ maxRetries: 5, retryBackoffMs: 7000 })
    expect(second).not.toBe(first)
  })

  test('exposes an immutable default policy', () => {
    expect(DEFAULT_PUSH_DELIVERY_POLICY).toEqual({ maxRetries: 3, retryBackoffMs: 2000 })
    expect(Object.isFrozen(DEFAULT_PUSH_DELIVERY_POLICY)).toBe(true)
  })
})
