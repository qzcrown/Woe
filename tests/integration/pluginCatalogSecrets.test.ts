jest.mock('file-type', () => ({ fileTypeFromBuffer: jest.fn() }), { virtual: true })
jest.mock('../../src/generated/plugins/catalog.ts', () => ({
  moduleDescriptors: ['frontend', 'push'].map(kind => ({
    modulePath: `test/catalog-${kind}`, name: kind, capabilities: [kind],
    author: 'fixture', license: 'test', website: 'https://example.invalid',
    secretFields: ['apiKey'],
    ...(kind === 'push' ? { push: { platform: 'testos' } } : { frontend: {} })
  }))
}))

import { eq } from 'drizzle-orm'
import { createPluginJobsTestDb } from '../helpers/pluginJobsTestDb'
import { asDrizzle } from '../helpers/testDb'
import { PluginHandlers } from '../../src/handlers/pluginHandlers'
import { PluginManager } from '../../src/plugins/manager'
import { pluginConfigs, pluginLogs } from '../../src/models'
import { registerPluginTask, resetPluginTaskRegistry } from '../../src/plugins/jobs/registry'
import type { Env } from '../../src/types/index'

const env = { PLUGIN_SECRET_MASTER_KEY: Buffer.alloc(32, 7).toString('base64') } as Env
const request = (body: string) => new Request('https://example.invalid/plugin/config', {
  method: 'POST', headers: { 'content-type': 'application/x-yaml' }, body
})

describe('full catalog secret and event boundaries', () => {
  beforeEach(resetPluginTaskRegistry)

  test.each(['frontend', 'push'])('%s-only secrets are encrypted, masked and retained by ***', async kind => {
    const db = createPluginJobsTestDb()
    try {
      const [plugin] = db.db.insert(pluginConfigs).values({
        userId: 7, name: kind, token: `P-${kind}`, modulePath: `test/catalog-${kind}`,
        configYaml: 'apiKey: legacy-credential\n'
      }).returning().all()
      const handler = new PluginHandlers(asDrizzle(db), env)
      expect(await (await handler.getPluginConfig(7, String(plugin.id), true)).text()).not.toContain('legacy-credential')
      expect((await handler.updatePluginConfig(7, String(plugin.id), request('apiKey: new-credential\n'), true)).status).toBe(200)
      const stored = db.db.select().from(pluginConfigs).where(eq(pluginConfigs.id, plugin.id)).get()!
      expect(stored.configYaml).not.toContain('new-credential')
      expect(stored.encryptedSecret).toBeTruthy()
      const read = await (await handler.getPluginConfig(7, String(plugin.id), true)).text()
      expect(read).toContain('***')
      expect(read).not.toContain('new-credential')
      expect((await handler.updatePluginConfig(7, String(plugin.id), request('apiKey: "***"\n'), true)).status).toBe(200)
      expect(db.db.select().from(pluginConfigs).get()!.encryptedSecret).toBe(stored.encryptedSecret)
    } finally { db.sqlite.close() }
  })

  test('known modules without event factories do not log unavailable; removed ones do', async () => {
    const db = createPluginJobsTestDb()
    try {
      db.sqlite.prepare('INSERT INTO users(id,name,admin,disabled) VALUES (7,?,1,0)').run('admin')
      registerPluginTask({ modulePath: 'test/task-only', supportedSubjectTypes: ['message'],
        createTask: async () => ({ run: async () => ({ ok: true }) }) })
      for (const modulePath of ['test/catalog-frontend', 'test/catalog-push', 'test/task-only', 'test/removed']) {
        db.db.insert(pluginConfigs).values({ userId: 7, name: modulePath, token: `P-${modulePath}`, modulePath, enabled: 1 }).run()
      }
      const manager = new PluginManager(asDrizzle(db))
      await manager.emit(7, 'message.create', { userId: 7, now: '2026-10-26' })
      await manager.emit(7, 'message.create', { userId: 7, now: '2026-10-26' })
      const rows = db.db.select().from(pluginLogs).all()
      const removed = db.db.select().from(pluginConfigs).where(eq(pluginConfigs.modulePath, 'test/removed')).get()!
      expect(rows).toHaveLength(2)
      expect(rows.every(row => row.pluginId === removed.id && row.error === 'plugin-unavailable')).toBe(true)
    } finally { db.sqlite.close() }
  })
})
