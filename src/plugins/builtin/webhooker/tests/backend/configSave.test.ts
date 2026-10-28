jest.mock('file-type', () => ({ fileTypeFromBuffer: jest.fn() }), { virtual: true })

import { eq } from 'drizzle-orm'
import { createPluginJobsTestDb } from '../../../../../../tests/helpers/pluginJobsTestDb'
import { asDrizzle } from '../../../../../../tests/helpers/testDb'
import { pluginConfigs } from '../../../../../../src/models'
import { PluginHandlers } from '../../../../../../src/handlers/pluginHandlers'
import type { Env } from '../../../../../../src/types/index'

const MASTER_KEY = Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => i + 1)).toString('base64')

describe('Webhooker config save error description', () => {
  test('invalid config returns the manifest description without replacing stored YAML', async () => {
    const testDb = createPluginJobsTestDb()
    const original = 'targetUrl: https://example.com/hook\n'
    const [plugin] = testDb.db
      .insert(pluginConfigs)
      .values({
        userId: 7,
        name: 'Webhooker',
        token: 'webhooker-config-save',
        modulePath: 'builtin/webhooker',
        configYaml: original,
        enabled: 1
      })
      .returning()
      .all()
    const env = {
      PLUGIN_SECRET_MASTER_KEY: MASTER_KEY,
      PLUGIN_SECRET_KEY_VERSION: '1'
    } as Env
    const handlers = new PluginHandlers(asDrizzle(testDb), env)
    const response = await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      new Request('http://localhost/plugin/1/config', {
        method: 'POST',
        headers: { 'content-type': 'application/x-yaml' },
        body: 'method: POST\n'
      }),
      true
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Bad Request',
      errorCode: 'config',
      errorDescription: 'Invalid Webhooker config'
    })
    const stored = testDb.db.select().from(pluginConfigs).where(eq(pluginConfigs.id, plugin.id)).get()!
    expect(stored.configYaml).toBe(original)
  })
})
