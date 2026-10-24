import { createPushRuntime } from '../../src/services/push/runtime'
import type { DrizzleDB } from '../../src/drizzle/index'
import type { Env } from '../../src/types/index'

describe('public push provider catalog', () => {
  test('default catalog is empty and performs no configuration reads or network requests', async () => {
    const prepare = jest.fn()
    const fetchFn = jest.fn() as unknown as typeof fetch
    const runtime = await createPushRuntime({ $client: { prepare } } as unknown as DrizzleDB, {} as Env, { fetchFn })
    for (const platform of ['fixture_a', 'fixture_b', 'unknown']) {
      expect(runtime.providers.get(platform)).toBeNull()
      expect(runtime.providers.getPolicy(platform)).toBeNull()
    }
    expect(prepare).not.toHaveBeenCalled()
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
