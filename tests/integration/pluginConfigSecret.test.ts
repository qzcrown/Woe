jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn()
}), { virtual: true })








import { eq } from 'drizzle-orm'
import { createPluginJobsTestDb } from '../helpers/pluginJobsTestDb'
import { asDrizzle } from '../helpers/testDb'
import type { TestDb } from '../helpers/testDb'
import { pluginConfigs, pluginLogs } from '../../src/models'
import type { Env } from '../../src/types/index'
import {
  getPluginSecretFields,
  registerPluginTask,
  resetPluginTaskRegistry
} from '../../src/plugins/jobs/registry'
import { register } from '../../src/plugins/registry'
import { PluginManager } from '../../src/plugins/manager'
import { PluginSecretService } from '../../src/services/pluginSecretService'
import { PluginHandlers } from '../../src/handlers/pluginHandlers'

const MASTER_KEY = Buffer.from(
  Uint8Array.from({ length: 32 }, (_, i) => i + 1)
).toString('base64')

const SECRET_MODULE = 'test/ai-secret'
const DOTTED_MODULE = 'test/dotted-secret'

const PLAIN_MODULE = 'test/plain-event'
register(PLAIN_MODULE, ({ id, name }) => ({
  id,
  name,
  capabilities: ['test'],
  configExample: 'plain: true',
  init() {}
}))

const WEBHOOKER_MODULE = SECRET_MODULE

function secretEnv(overrides: Partial<Env> = {}): Env {
  return {
    PLUGIN_SECRET_MASTER_KEY: MASTER_KEY,
    PLUGIN_SECRET_KEY_VERSION: '1',
    ...overrides
  } as Env
}

function configRequest(body: string): Request {
  return new Request('http://localhost/plugin/1/config', {
    method: 'POST',
    headers: { 'content-type': 'application/x-yaml' },
    body
  })
}

async function bodyJson(response: Response): Promise<any> {
  return (await response.json()) as any
}

describe('plugin config secret integration', () => {
  let testDb: TestDb
  let drizzle: ReturnType<typeof asDrizzle>
  let handlers: PluginHandlers

  beforeEach(() => {
    resetPluginTaskRegistry()
    registerPluginTask({
      modulePath: SECRET_MODULE,
      supportedSubjectTypes: ['message'],
      secretFields: ['apiKey'],
      createTask: async () => ({ run: async () => ({ ok: true as const }) })
    })

    testDb = createPluginJobsTestDb()
    drizzle = asDrizzle(testDb)
    handlers = new PluginHandlers(drizzle, secretEnv())
  })

  afterEach(() => {
    resetPluginTaskRegistry()
  })

  function seedPlugin(modulePath: string, overrides: Partial<typeof pluginConfigs.$inferInsert> = {}) {
    const [row] = testDb.db
      .insert(pluginConfigs)
      .values({
        userId: 7,
        name: 'instance',
        token: `token-${modulePath}`,
        modulePath,
        enabled: 1,
        configYaml: '',
        ...overrides
      })
      .returning()
      .all()
    return row
  }

  function row(id: number): typeof pluginConfigs.$inferSelect {
    const [found] = testDb.db
      .select()
      .from(pluginConfigs)
      .where(eq(pluginConfigs.id, id))
      .all()
    return found
  }

  test('POST 明文 -> 200；config_yaml 掩码、encrypted_secret 有 entry、DB 无明文', async () => {
    const plugin = seedPlugin(SECRET_MODULE)

    const response = await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest('apiKey: sk-live\nmodel: gpt-4o\n'),
      true
    )

    expect(response.status).toBe(200)
    await expect(bodyJson(response)).resolves.toEqual({})

    const stored = row(plugin.id)
    expect(stored.configYaml).not.toContain('sk-live')
    expect(stored.configYaml).toContain('***')
    expect(stored.encryptedSecret).not.toBeNull()
    expect(stored.encryptedSecret).not.toContain('sk-live')

    const envelope = JSON.parse(stored.encryptedSecret as string)
    expect(envelope).toMatchObject({ v: 1, keyVersion: 1 })
    expect(envelope.entries).toHaveLength(1)
    expect(envelope.entries[0].path).toBe('apiKey')
  })

  test('GET 返回 ***，不返回明文/密文', async () => {
    const plugin = seedPlugin(SECRET_MODULE)
    await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest('apiKey: sk-live\nmodel: gpt-4o\n'),
      true
    )

    const response = await handlers.getPluginConfig(7, String(plugin.id), true)
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('application/x-yaml')
    expect(text).toContain('***')
    expect(text).not.toContain('sk-live')
    expect(text).not.toContain('ciphertext')
  })

  test('再次提交 GET 结果（***）-> 200 且密文完全不变', async () => {
    const plugin = seedPlugin(SECRET_MODULE)
    await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest('apiKey: sk-live\n'),
      true
    )
    const first = row(plugin.id)

    const getResponse = await handlers.getPluginConfig(7, String(plugin.id), true)
    const masked = await getResponse.text()

    const response = await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest(masked),
      true
    )

    expect(response.status).toBe(200)
    const second = row(plugin.id)
    expect(second.encryptedSecret).toBe(first.encryptedSecret)
    expect(second.configYaml).toBe(first.configYaml)
  })

  test('提交新明文 -> 密文变化且解密得到新值（通过 host 端口验证）', async () => {
    const plugin = seedPlugin(SECRET_MODULE)
    await handlers.updatePluginConfig(7, String(plugin.id), configRequest('apiKey: sk-old\n'), true)
    const first = row(plugin.id)

    const response = await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest('apiKey: sk-new\n'),
      true
    )
    expect(response.status).toBe(200)
    const second = row(plugin.id)
    expect(second.encryptedSecret).not.toBe(first.encryptedSecret)

    const { createPluginSecretAccess } = await import('../../src/services/pluginSecretService')
    const access = createPluginSecretAccess(drizzle, secretEnv(), 7, plugin.id, {
      modulePath: SECRET_MODULE,
      supportedSubjectTypes: ['message'],
      secretFields: ['apiKey'],
      createTask: async () => ({ run: async () => ({ ok: true as const }) })
    })
    await expect(access.get('apiKey')).resolves.toBe('sk-new')
  })

  test('清空 secret -> encrypted_secret 置 NULL', async () => {
    const plugin = seedPlugin(SECRET_MODULE)
    await handlers.updatePluginConfig(7, String(plugin.id), configRequest('apiKey: sk-live\n'), true)
    expect(row(plugin.id).encryptedSecret).not.toBeNull()

    const response = await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest('apiKey: ""\nmodel: gpt-4o\n'),
      true
    )

    expect(response.status).toBe(200)
    const stored = row(plugin.id)
    expect(stored.encryptedSecret).toBeNull()
    expect(stored.configYaml).not.toContain('sk-live')
  })

  test('重复 YAML key -> 400 secret-config，且不写库', async () => {
    const plugin = seedPlugin(SECRET_MODULE, { configYaml: 'apiKey: "***"\nmodel: gpt-4o\n' })
    const before = row(plugin.id)

    const response = await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest('apiKey: a\napiKey: b\n'),
      true
    )

    expect(response.status).toBe(400)
    await expect(bodyJson(response)).resolves.toMatchObject({ errorCode: 'secret-config' })
    expect(row(plugin.id).configYaml).toBe(before.configYaml)
  })

  test('数组 secret -> 400 secret-config', async () => {
    const plugin = seedPlugin(SECRET_MODULE)

    const response = await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest('apiKey:\n  - a\n  - b\n'),
      true
    )

    expect(response.status).toBe(400)
    await expect(bodyJson(response)).resolves.toMatchObject({ errorCode: 'secret-config' })
  })

  test('新 path 提交 *** 且无旧密文 -> 400 secret-config', async () => {
    const plugin = seedPlugin(SECRET_MODULE, { configYaml: 'apiKey: "***"\n' })

    const response = await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest('apiKey: "***"\n'),
      true
    )

    expect(response.status).toBe(400)
    await expect(bodyJson(response)).resolves.toMatchObject({ errorCode: 'secret-config' })
  })

  test('主密钥缺失 -> 503 且 DB 未被写入（fail-closed）', async () => {
    const plugin = seedPlugin(SECRET_MODULE, { configYaml: 'model: gpt-4o\n' })
    const noKeyHandlers = new PluginHandlers(drizzle, {} as Env)

    const response = await noKeyHandlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest('apiKey: sk-live\n'),
      true
    )

    expect(response.status).toBe(503)
    await expect(bodyJson(response)).resolves.toMatchObject({
      errorCode: 'secret-key-unavailable'
    })
    const stored = row(plugin.id)
    expect(stored.configYaml).toBe('model: gpt-4o\n')
    expect(stored.encryptedSecret).toBeNull()
  })

  test('主密钥 base64 非法 / 长度非 32 -> 503', async () => {
    const plugin = seedPlugin(SECRET_MODULE)

    for (const masterKey of ['!!!!', Buffer.from('short').toString('base64')]) {
      const badHandlers = new PluginHandlers(
        drizzle,
        { PLUGIN_SECRET_MASTER_KEY: masterKey, PLUGIN_SECRET_KEY_VERSION: '1' } as Env
      )
      const response = await badHandlers.updatePluginConfig(
        7,
        String(plugin.id),
        configRequest('apiKey: sk-live\n'),
        true
      )
      expect(response.status).toBe(503)
      await expect(bodyJson(response)).resolves.toMatchObject({
        errorCode: 'secret-key-unavailable'
      })
    }
    expect(row(plugin.id).encryptedSecret).toBeNull()
  })

  test('主密钥 base64 合法但长度非 32 字节：保存 503，执行期 get 返回 null（不抛）', async () => {
    const plugin = seedPlugin(SECRET_MODULE)
    const wrongKeyEnv = {
      PLUGIN_SECRET_MASTER_KEY: Buffer.from(
        Uint8Array.from({ length: 16 }, (_, i) => i + 1)
      ).toString('base64'),
      PLUGIN_SECRET_KEY_VERSION: '1'
    } as Env
    const badHandlers = new PluginHandlers(drizzle, wrongKeyEnv)

    const rejected = await badHandlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest('apiKey: sk-live\n'),
      true
    )
    expect(rejected.status).toBe(503)
    await expect(bodyJson(rejected)).resolves.toMatchObject({
      errorCode: 'secret-key-unavailable'
    })
    expect(row(plugin.id).encryptedSecret).toBeNull()


    const accepted = await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest('apiKey: sk-live\n'),
      true
    )
    expect(accepted.status).toBe(200)
    expect(row(plugin.id).encryptedSecret).not.toBeNull()

    const { createPluginSecretAccess } = await import('../../src/services/pluginSecretService')
    const access = createPluginSecretAccess(drizzle, wrongKeyEnv, 7, plugin.id, {
      modulePath: SECRET_MODULE,
      supportedSubjectTypes: ['message'],
      secretFields: ['apiKey'],
      createTask: async () => ({ run: async () => ({ ok: true as const }) })
    })
    await expect(access.get('apiKey')).resolves.toBeNull()
    await expect(access.has('apiKey')).resolves.toBe(true)
  })

  test('keyVersion 不一致 + *** -> 409 secret-reentry-required', async () => {
    const plugin = seedPlugin(SECRET_MODULE)
    await handlers.updatePluginConfig(7, String(plugin.id), configRequest('apiKey: sk-live\n'), true)

    const v2Handlers = new PluginHandlers(
      drizzle,
      { PLUGIN_SECRET_MASTER_KEY: MASTER_KEY, PLUGIN_SECRET_KEY_VERSION: '2' } as Env
    )
    const response = await v2Handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest('apiKey: "***"\n'),
      true
    )

    expect(response.status).toBe(409)
    await expect(bodyJson(response)).resolves.toMatchObject({
      errorCode: 'secret-reentry-required'
    })
  })

  test('历史明文：GET 只显示 ***，且 host.get 返回 null', async () => {
    const plugin = seedPlugin(SECRET_MODULE, {
      configYaml: 'apiKey: sk-legacy\nmodel: gpt-4o\n',
      encryptedSecret: null
    })

    const response = await handlers.getPluginConfig(7, String(plugin.id), true)
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(text).not.toContain('sk-legacy')
    expect(text).toContain('***')

    const { createPluginSecretAccess } = await import('../../src/services/pluginSecretService')
    const access = createPluginSecretAccess(drizzle, secretEnv(), 7, plugin.id, {
      modulePath: SECRET_MODULE,
      supportedSubjectTypes: ['message'],
      secretFields: ['apiKey'],
      createTask: async () => ({ run: async () => ({ ok: true as const }) })
    })
    await expect(access.get('apiKey')).resolves.toBeNull()
    await expect(access.has('apiKey')).resolves.toBe(false)
  })

  test('envelope 损坏 + *** -> 409 secret-decrypt-failed', async () => {
    const plugin = seedPlugin(SECRET_MODULE, {
      configYaml: 'apiKey: "***"\n',
      encryptedSecret: '{broken'
    })

    const response = await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest('apiKey: "***"\n'),
      true
    )

    expect(response.status).toBe(409)
    await expect(bodyJson(response)).resolves.toMatchObject({
      errorCode: 'secret-decrypt-failed'
    })
  })

  test('字面含点 key（a.b）无法安全抽取 -> 400 secret-config，且不写库', async () => {
    registerPluginTask({
      modulePath: DOTTED_MODULE,
      supportedSubjectTypes: ['message'],
      secretFields: ['a.b'],
      createTask: async () => ({ run: async () => ({ ok: true as const }) })
    })
    const plugin = seedPlugin(DOTTED_MODULE, { configYaml: 'model: gpt-4o\n' })
    const before = row(plugin.id)

    const response = await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest('a.b: sk-live\n'),
      true
    )

    expect(response.status).toBe(400)
    await expect(bodyJson(response)).resolves.toMatchObject({ errorCode: 'secret-config' })

    const stored = row(plugin.id)
    expect(stored.configYaml).toBe(before.configYaml)
    expect(stored.configYaml).not.toContain('sk-live')
    expect(stored.encryptedSecret).toBeNull()
  })

  test('历史脏数据（a.b 明文已入库）-> GET 400 secret-config，响应不含明文', async () => {
    registerPluginTask({
      modulePath: DOTTED_MODULE,
      supportedSubjectTypes: ['message'],
      secretFields: ['a.b'],
      createTask: async () => ({ run: async () => ({ ok: true as const }) })
    })
    const plugin = seedPlugin(DOTTED_MODULE, {
      configYaml: 'a.b: sk-live\nmodel: gpt-4o\n',
      encryptedSecret: null
    })

    const response = await handlers.getPluginConfig(7, String(plugin.id), true)
    const text = await response.text()

    expect(response.status).toBe(400)
    expect(text).not.toContain('sk-live')
    expect(JSON.parse(text)).toMatchObject({ errorCode: 'secret-config' })
  })

  test('非任务插件（独立非任务夹具）保持原样：原文写入/原文返回，不改 encrypted_secret', async () => {
    const original = '# keep this comment\ndelay: 1000\n\n\ntarget_url: http://localhost:8080\n'
    const plugin = seedPlugin(PLAIN_MODULE, {
      configYaml: 'delay: 1\n',
      encryptedSecret: 'sentinel'
    })

    const response = await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest(original),
      true
    )
    expect(response.status).toBe(200)

    const stored = row(plugin.id)
    expect(stored.configYaml).toBe(original)
    expect(stored.encryptedSecret).toBe('sentinel')

    const getResponse = await handlers.getPluginConfig(7, String(plugin.id), true)
    await expect(getResponse.text()).resolves.toBe(original)
  })

  test('属主校验保持不变：其他用户更新/读取返回 404', async () => {
    const plugin = seedPlugin(SECRET_MODULE)

    const updateResponse = await handlers.updatePluginConfig(
      8,
      String(plugin.id),
      configRequest('apiKey: sk-live\n'),
      true
    )
    expect(updateResponse.status).toBe(404)

    const getResponse = await handlers.getPluginConfig(8, String(plugin.id), true)
    expect(getResponse.status).toBe(404)
    expect(row(plugin.id).configYaml).toBe('')
  })

  test('非管理员权限校验保持不变：无权限 403，有权限 200', async () => {

    testDb.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS \`user_plugin_permissions\` (
        \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        \`user_id\` integer NOT NULL,
        \`module_path\` text NOT NULL,
        \`created_at\` text DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `)
    const plugin = seedPlugin(SECRET_MODULE, { userId: 9 })

    const forbidden = await handlers.updatePluginConfig(
      9,
      String(plugin.id),
      configRequest('apiKey: sk-live\n'),
      false
    )
    expect(forbidden.status).toBe(403)

    testDb.sqlite
      .prepare('INSERT INTO user_plugin_permissions (user_id, module_path) VALUES (?, ?)')
      .run(9, SECRET_MODULE)
    const allowed = await handlers.updatePluginConfig(
      9,
      String(plugin.id),
      configRequest('apiKey: sk-live\n'),
      false
    )
    expect(allowed.status).toBe(200)
  })

  test('既有构造兼容：new PluginHandlers(drizzle) 对非任务插件仍可用', async () => {
    const legacyHandlers = new PluginHandlers(drizzle)
    const plugin = seedPlugin(PLAIN_MODULE)

    const response = await legacyHandlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest('delay: 2000\n'),
      true
    )
    expect(response.status).toBe(200)
    expect(row(plugin.id).configYaml).toBe('delay: 2000\n')
  })

  test('属主校验对 独立任务夹具 任务插件同样生效：其他用户更新/读取返回 404', async () => {
    const plugin = seedPlugin(WEBHOOKER_MODULE)

    const updateResponse = await handlers.updatePluginConfig(
      8,
      String(plugin.id),
      configRequest('targetUrl: https://example.com/hook\napiKey: tok\n'),
      true
    )
    expect(updateResponse.status).toBe(404)
    expect(row(plugin.id).configYaml).toBe('')
  })
})

describe('独立任务夹具的配置保存与 apiKey secret', () => {
  let testDb: TestDb
  let drizzle: ReturnType<typeof asDrizzle>
  let handlers: PluginHandlers

  beforeEach(() => {
    resetPluginTaskRegistry()
    registerPluginTask({
      modulePath: SECRET_MODULE,
      supportedSubjectTypes: ['message'],
      secretFields: ['apiKey'],
      createTask: async () => ({ run: async () => ({ ok: true as const }) })
    })
    testDb = createPluginJobsTestDb()
    drizzle = asDrizzle(testDb)
    handlers = new PluginHandlers(drizzle, secretEnv())
  })

  afterEach(() => {
    resetPluginTaskRegistry()
  })

  function seedPlugin(modulePath: string, overrides: Partial<typeof pluginConfigs.$inferInsert> = {}) {
    const [row] = testDb.db
      .insert(pluginConfigs)
      .values({
        userId: 7,
        name: 'instance',
        token: `token-${modulePath}`,
        modulePath,
        enabled: 1,
        configYaml: '',
        ...overrides
      })
      .returning()
      .all()
    return row
  }

  function row(id: number): typeof pluginConfigs.$inferSelect {
    const [found] = testDb.db
      .select()
      .from(pluginConfigs)
      .where(eq(pluginConfigs.id, id))
      .all()
    return found
  }

  test('独立任务夹具 声明 secretFields=[apiKey]（静态目录，reset 后仍在）', () => {
    expect(getPluginSecretFields(WEBHOOKER_MODULE)).toEqual(['apiKey'])
  })

  test('apiKey 明文保存 -> 掩码入库 + envelope entry，DB 无明文', async () => {
    const plugin = seedPlugin(WEBHOOKER_MODULE)

    const response = await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest('targetUrl: https://example.com/hook\napiKey: tok-plain\n'),
      true
    )

    expect(response.status).toBe(200)
    await expect(bodyJson(response)).resolves.toEqual({})

    const stored = row(plugin.id)
    expect(stored.configYaml).not.toContain('tok-plain')
    expect(stored.configYaml).toContain('***')
    expect(stored.configYaml).toContain('targetUrl')

    const envelope = JSON.parse(stored.encryptedSecret as string)
    expect(envelope).toMatchObject({ v: 1, keyVersion: 1 })
    expect(envelope.entries).toHaveLength(1)
    expect(envelope.entries[0].path).toBe('apiKey')
    expect(stored.encryptedSecret).not.toContain('tok-plain')
  })

  test('apiKey 经 host 端口可解密回明文', async () => {
    const plugin = seedPlugin(WEBHOOKER_MODULE)
    await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest('targetUrl: https://example.com/hook\napiKey: tok-plain\n'),
      true
    )

    const { createPluginSecretAccess } = await import('../../src/services/pluginSecretService')
    const access = createPluginSecretAccess(
      drizzle,
      secretEnv(),
      7,
      plugin.id,
      {
        modulePath: WEBHOOKER_MODULE,
        supportedSubjectTypes: ['message'],
        secretFields: ['apiKey'],
        createTask: async () => ({ run: async () => ({ ok: true as const }) })
      }
    )
    await expect(access.get('apiKey')).resolves.toBe('tok-plain')
    await expect(access.has('apiKey')).resolves.toBe(true)
  })

  test('掩码回环：GET 返回 *** -> 再保存密文不变', async () => {
    const plugin = seedPlugin(WEBHOOKER_MODULE)
    await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest('targetUrl: https://example.com/hook\napiKey: tok-plain\n'),
      true
    )
    const first = row(plugin.id)

    const getResponse = await handlers.getPluginConfig(7, String(plugin.id), true)
    const masked = await getResponse.text()
    expect(masked).toContain('***')

    const response = await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest(masked),
      true
    )
    expect(response.status).toBe(200)
    const second = row(plugin.id)
    expect(second.encryptedSecret).toBe(first.encryptedSecret)
  })

  test('清除 apiKey -> encrypted_secret 置 NULL', async () => {
    const plugin = seedPlugin(WEBHOOKER_MODULE)
    await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest('targetUrl: https://example.com/hook\napiKey: tok-plain\n'),
      true
    )
    expect(row(plugin.id).encryptedSecret).not.toBeNull()

    const response = await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest('targetUrl: https://example.com/hook\napiKey: ""\n'),
      true
    )

    expect(response.status).toBe(200)
    expect(row(plugin.id).encryptedSecret).toBeNull()
  })

  test('存量兼容：headers.Authorization 明文合法保存，不迁移不掩码', async () => {
    const plugin = seedPlugin(WEBHOOKER_MODULE, { encryptedSecret: null })

    const response = await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest(
        'targetUrl: https://example.com/hook\nheaders:\n  Authorization: Bearer legacy-token\n'
      ),
      true
    )

    expect(response.status).toBe(200)
    const stored = row(plugin.id)

    expect(stored.configYaml).toContain('Bearer legacy-token')

    const getResponse = await handlers.getPluginConfig(7, String(plugin.id), true)
    await expect(getResponse.text()).resolves.toContain('Bearer legacy-token')
  })

})

describe('声明化保存校验兼容', () => {
  let testDb: TestDb
  let drizzle: ReturnType<typeof asDrizzle>
  let handlers: PluginHandlers

  beforeEach(() => {
    resetPluginTaskRegistry()
    testDb = createPluginJobsTestDb()
    drizzle = asDrizzle(testDb)
    handlers = new PluginHandlers(drizzle, secretEnv())
  })

  afterEach(() => {
    resetPluginTaskRegistry()
  })

  function seedPlugin(modulePath: string, overrides: Partial<typeof pluginConfigs.$inferInsert> = {}) {
    const [row] = testDb.db
      .insert(pluginConfigs)
      .values({
        userId: 7,
        name: 'instance',
        token: `token-${modulePath}`,
        modulePath,
        enabled: 1,
        configYaml: '',
        ...overrides
      })
      .returning()
      .all()
    return row
  }

  function row(id: number): typeof pluginConfigs.$inferSelect {
    const [found] = testDb.db
      .select()
      .from(pluginConfigs)
      .where(eq(pluginConfigs.id, id))
      .all()
    return found
  }

  test('未知模块不再原文写入：availability 守卫 409 拒绝', async () => {
    const plugin = seedPlugin('unknown/module')

    const response = await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest('not: [closed\n'),
      true
    )

    expect(response.status).toBe(409)
    await expect(bodyJson(response)).resolves.toMatchObject({
      errorCode: 'plugin-unavailable'
    })
    expect(row(plugin.id).configYaml).toBe('')
    expect(row(plugin.id).encryptedSecret).toBeNull()
  })

  test('已知无 parser 非任务插件不校验：独立非任务夹具 任意内容原文写入（本阶段旧行为）', async () => {
    const plugin = seedPlugin(PLAIN_MODULE)

    const response = await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest('definitely: not-validated\n'),
      true
    )

    expect(response.status).toBe(200)
    expect(row(plugin.id).configYaml).toBe('definitely: not-validated\n')
    expect(row(plugin.id).encryptedSecret).toBeNull()
  })
})

describe('未知模块配置保护', () => {
  let testDb: TestDb
  let drizzle: ReturnType<typeof asDrizzle>
  let handlers: PluginHandlers

  beforeEach(() => {
    resetPluginTaskRegistry()
    testDb = createPluginJobsTestDb()
    drizzle = asDrizzle(testDb)
    handlers = new PluginHandlers(drizzle, secretEnv())
  })

  afterEach(() => {
    resetPluginTaskRegistry()
  })

  function seedPlugin(modulePath: string, overrides: Partial<typeof pluginConfigs.$inferInsert> = {}) {
    const [row] = testDb.db
      .insert(pluginConfigs)
      .values({
        userId: 7,
        name: 'instance',
        token: `token-${modulePath}`,
        modulePath,
        enabled: 1,
        configYaml: '',
        ...overrides
      })
      .returning()
      .all()
    return row
  }

  function row(id: number): typeof pluginConfigs.$inferSelect {
    const [found] = testDb.db
      .select()
      .from(pluginConfigs)
      .where(eq(pluginConfigs.id, id))
      .all()
    return found
  }


  async function seedValidEnvelopeRow(modulePath: string) {
    const plugin = seedPlugin(modulePath, { configYaml: 'placeholder\n' })
    const prepared = await new PluginSecretService(secretEnv()).processConfigForSave({
      pluginId: plugin.id,
      userId: 7,
      configYaml: 'apiKey: sk-envelope-live\nmodel: gpt-4o\n',
      encryptedSecret: null,
      secretFields: ['apiKey']
    })
    testDb.sqlite
      .prepare('UPDATE plugin_configs SET config_yaml = ?, encrypted_secret = ? WHERE id = ?')
      .run(prepared.configYaml, prepared.encryptedSecret, plugin.id)
    return plugin.id
  }

  test('三态残留（历史明文 / 有效 envelope / 损坏 envelope+***）：所有读均 409，无敏感值，DB 完全不变', async () => {
    const ghostPlain = seedPlugin('test/ghost-plain', {
      configYaml: 'apiKey: sk-legacy-plain\nmodel: gpt-4o\n',
      encryptedSecret: null
    })
    const ghostEnvelopeId = await seedValidEnvelopeRow('test/ghost-envelope')
    const ghostBroken = seedPlugin('test/ghost-broken', {
      configYaml: 'apiKey: "***"\nmodel: gpt-4o\n',
      encryptedSecret: '{broken'
    })

    const before = [row(ghostPlain.id), row(ghostEnvelopeId), row(ghostBroken.id)]

    const cases: Array<{ id: number; secret: string }> = [
      { id: ghostPlain.id, secret: 'sk-legacy-plain' },
      { id: ghostEnvelopeId, secret: 'sk-envelope-live' },
      { id: ghostBroken.id, secret: '' }
    ]
    for (const item of cases) {
      const getResponse = await handlers.getPluginConfig(7, String(item.id), true)
      const text = await getResponse.text()
      expect(getResponse.status).toBe(409)
      expect(JSON.parse(text)).toMatchObject({ errorCode: 'plugin-unavailable' })
      if (item.secret) expect(text).not.toContain(item.secret)
      expect(text).not.toContain('***')
      expect(text).not.toContain('ciphertext')

      const displayResponse = await handlers.getPluginDisplay(7, String(item.id))
      expect(displayResponse.status).toBe(409)
      const displayText = await displayResponse.text()
      expect(JSON.parse(displayText)).toMatchObject({ errorCode: 'plugin-unavailable' })
      if (item.secret) expect(displayText).not.toContain(item.secret)
    }

    expect(row(ghostPlain.id)).toEqual(before[0])
    expect(row(ghostEnvelopeId)).toEqual(before[1])
    expect(row(ghostBroken.id)).toEqual(before[2])
  })

  test('写路径全 409：POST config（含明文）/ enable 均拒绝且 DB 完全不变', async () => {
    const ghost = seedPlugin('test/ghost-write', {
      configYaml: 'apiKey: sk-legacy-write\n',
      encryptedSecret: null,
      enabled: 0
    })
    const before = row(ghost.id)

    const postResponse = await handlers.updatePluginConfig(
      7,
      String(ghost.id),
      configRequest('apiKey: sk-rotate-attempt\n'),
      true
    )
    expect(postResponse.status).toBe(409)
    const postText = await postResponse.text()
    expect(JSON.parse(postText)).toMatchObject({ errorCode: 'plugin-unavailable' })
    expect(postText).not.toContain('sk-rotate-attempt')
    expect(postText).not.toContain('sk-legacy-write')

    const enableResponse = await handlers.enablePlugin(7, String(ghost.id), true)
    expect(enableResponse.status).toBe(409)
    await expect(bodyJson(enableResponse)).resolves.toMatchObject({
      errorCode: 'plugin-unavailable'
    })

    expect(row(ghost.id)).toEqual(before)
  })

  test('disable 保持可用：未知实例可禁用（删除代码不等于删数据）', async () => {
    const ghost = seedPlugin('test/ghost-disable', { enabled: 1 })

    const response = await handlers.disablePlugin(7, String(ghost.id), true)

    expect(response.status).toBe(200)
    expect(row(ghost.id).enabled).toBe(0)
  })

  test('非管理员无权限的未知实例：仍 403（权限检查先于 availability）', async () => {
    const ghost = seedPlugin('test/ghost-noPerm', { userId: 9 })

    const response = await handlers.updatePluginConfig(
      9,
      String(ghost.id),
      configRequest('apiKey: x\n'),
      false
    )

    expect(response.status).toBe(403)
  })

  test('已知无 secret 插件不受影响：独立事件夹具 GET/POST/enable 仍可用', async () => {
    const plugin = seedPlugin(PLAIN_MODULE, { enabled: 0, configYaml: 'delay: 1\n' })

    const getResponse = await handlers.getPluginConfig(7, String(plugin.id), true)
    expect(getResponse.status).toBe(200)
    await expect(getResponse.text()).resolves.toBe('delay: 1\n')

    const postResponse = await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest('delay: 2000\n'),
      true
    )
    expect(postResponse.status).toBe(200)

    const enableResponse = await handlers.enablePlugin(7, String(plugin.id), true)
    expect(enableResponse.status).toBe(200)
    expect(row(plugin.id).enabled).toBe(1)
    expect(row(plugin.id).configYaml).toBe('delay: 2000\n')
  })

  test('恢复同 modulePath：重新应用 secretFields 规则，历史明文遮蔽且 host 不把明文当凭据', async () => {
    const RESTORED = 'test/ghost-restored'
    register(RESTORED, ({ id, name }) => ({
      id,
      name,
      capabilities: [],
      configExample: 'model: gpt-4o\n',
      init: async () => {},
      onMessageCreate: async () => ({ status: 'ok' as const })
    }))
    registerPluginTask({
      modulePath: RESTORED,
      supportedSubjectTypes: ['message'],
      secretFields: ['apiKey'],
      createTask: async () => ({ run: async () => ({ ok: true as const }) })
    })
    const ghost = seedPlugin(RESTORED, {
      configYaml: 'apiKey: sk-legacy-restore\nmodel: gpt-4o\n',
      encryptedSecret: null
    })

    const getResponse = await handlers.getPluginConfig(7, String(ghost.id), true)
    const masked = await getResponse.text()
    expect(getResponse.status).toBe(200)
    expect(masked).not.toContain('sk-legacy-restore')
    expect(masked).toContain('***')


    const { createPluginSecretAccess } = await import('../../src/services/pluginSecretService')
    const access = createPluginSecretAccess(drizzle, secretEnv(), 7, ghost.id, {
      modulePath: RESTORED,
      supportedSubjectTypes: ['message'],
      secretFields: ['apiKey'],
      createTask: async () => ({ run: async () => ({ ok: true as const }) })
    })
    await expect(access.get('apiKey')).resolves.toBeNull()
    await expect(access.has('apiKey')).resolves.toBe(false)


    const postResponse = await handlers.updatePluginConfig(
      7,
      String(ghost.id),
      configRequest('apiKey: sk-fresh\nmodel: gpt-4o\n'),
      true
    )
    expect(postResponse.status).toBe(200)
    const stored = row(ghost.id)
    expect(stored.configYaml).not.toContain('sk-fresh')
    expect(stored.configYaml).toContain('***')
    expect(stored.encryptedSecret).not.toBeNull()

    const enableResponse = await handlers.enablePlugin(7, String(ghost.id), true)
    expect(enableResponse.status).toBe(200)
    expect(row(ghost.id).enabled).toBe(1)
  })
})

describe('缺失实例事件观测', () => {
  let testDb: TestDb
  let drizzle: ReturnType<typeof asDrizzle>

  const GHOST_MODULE = 'test/ghost-emit'

  beforeEach(() => {
    resetPluginTaskRegistry()
    testDb = createPluginJobsTestDb()
    drizzle = asDrizzle(testDb)
  })

  afterEach(() => {
    resetPluginTaskRegistry()
  })

  function seedUser(id: number, admin = 0) {
    testDb.sqlite
      .prepare('INSERT INTO users (id, name, admin, disabled) VALUES (?, ?, ?, 0)')
      .run(id, `user-${id}`, admin)
  }

  function seedPlugin(
    modulePath: string,
    overrides: Partial<typeof pluginConfigs.$inferInsert> = {}
  ) {
    const [row] = testDb.db
      .insert(pluginConfigs)
      .values({
        userId: 7,
        name: 'ghost-instance',
        token: `token-${modulePath}`,
        modulePath,
        enabled: 1,
        configYaml: 'apiKey: sk-legacy-emit\n',
        ...overrides
      })
      .returning()
      .all()
    return row
  }

  function logs(pluginId: number): Array<typeof pluginLogs.$inferSelect> {
    return testDb.db
      .select()
      .from(pluginLogs)
      .where(eq(pluginLogs.pluginId, pluginId))
      .all()
  }

  function tableCount(table: string): number {
    return (
      testDb.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
    ).n
  }

  const emitCtx = () => ({
    userId: 7,
    now: new Date().toISOString(),
    message: { id: 1, appId: 1, content: 'hello' }
  })

  test('emit 为每个缺失实例写一条 <event>.skipped：status=1、error=plugin-unavailable、durationMs=0', async () => {
    seedUser(7, 1)
    const ghost = seedPlugin(GHOST_MODULE)

    const pm = new PluginManager(drizzle)
    await pm.emit(7, 'message.create', emitCtx())

    const rows = logs(ghost.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      pluginId: ghost.id,
      userId: 7,
      event: 'message.create.skipped',
      status: 1,
      durationMs: 0,
      error: 'plugin-unavailable'
    })

    expect(tableCount('plugin_jobs')).toBe(0)
    expect(tableCount('push_outbox')).toBe(0)
  })

  test('重复 emit（含缓存后的 loadForUser）每次恰好一条', async () => {
    seedUser(7, 1)
    const ghost = seedPlugin(GHOST_MODULE)

    const pm = new PluginManager(drizzle)
    await pm.emit(7, 'message.create', emitCtx())
    await pm.emit(7, 'message.create', emitCtx())
    await pm.emit(7, 'message.delete', emitCtx())

    const rows = logs(ghost.id)
    expect(rows.filter(l => l.event === 'message.create.skipped')).toHaveLength(2)
    expect(rows.filter(l => l.event === 'message.delete.skipped')).toHaveLength(1)
  })

  test('无权限用户（非 admin 且未授权）：不写 skipped', async () => {
    seedUser(8, 0)
    const ghost = seedPlugin(GHOST_MODULE, { userId: 8 })

    const pm = new PluginManager(drizzle)
    await pm.emit(8, 'message.create', { ...emitCtx(), userId: 8 })

    expect(logs(ghost.id)).toHaveLength(0)
  })

  test('disabled 实例：不写 skipped', async () => {
    seedUser(7, 1)
    const ghost = seedPlugin(GHOST_MODULE, { enabled: 0 })

    const pm = new PluginManager(drizzle)
    await pm.emit(7, 'message.create', emitCtx())

    expect(logs(ghost.id)).toHaveLength(0)
  })

  test('已知插件入队拒绝（skipCode）不写 plugin_logs，与缺失实例观测互不重复', async () => {
    seedUser(7, 1)
    const ghost = seedPlugin(GHOST_MODULE)
    const KNOWN = 'test/known-skip'
    register(KNOWN, ({ id, name }) => ({
      id,
      name,
      capabilities: [],
      init: async () => {},
      onMessageCreate: async () => ({ status: 'skipped' as const, code: 'quota-exceeded' })
    }))
    const known = seedPlugin(KNOWN, { name: 'known-skip' })

    const pm = new PluginManager(drizzle)
    await pm.emit(7, 'message.create', emitCtx())


    expect(logs(known.id)).toHaveLength(0)

    expect(logs(ghost.id)).toHaveLength(1)
    expect(logs(ghost.id)[0].event).toBe('message.create.skipped')
  })
})
