jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn()
}), { virtual: true })








import { eq } from 'drizzle-orm'
import { createPluginJobsTestDb } from '../helpers/pluginJobsTestDb'
import { asDrizzle } from '../helpers/testDb'
import type { TestDb } from '../helpers/testDb'
import { pluginConfigs } from '../../src/models'
import type { Env } from '../../src/types/index'
import {
  getPluginSecretFields,
  registerPluginTask,
  resetPluginTaskRegistry
} from '../../src/plugins/jobs/registry'
import { PluginHandlers } from '../../src/handlers/pluginHandlers'

const MASTER_KEY = Buffer.from(
  Uint8Array.from({ length: 32 }, (_, i) => i + 1)
).toString('base64')

const SECRET_MODULE = 'test/ai-secret'
const DOTTED_MODULE = 'test/dotted-secret'

const PLAIN_MODULE = 'builtin/displayer'

const WEBHOOKER_MODULE = 'builtin/webhooker'

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

  test('非任务插件（displayer）保持原样：原文写入/原文返回，不改 encrypted_secret', async () => {
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

  test('属主校验对 webhooker 任务插件同样生效：其他用户更新/读取返回 404', async () => {
    const plugin = seedPlugin(WEBHOOKER_MODULE)

    const updateResponse = await handlers.updatePluginConfig(
      8,
      String(plugin.id),
      configRequest('targetUrl: https://example.com/hook\nauthToken: tok\n'),
      true
    )
    expect(updateResponse.status).toBe(404)
    expect(row(plugin.id).configYaml).toBe('')
  })
})

describe('webhooker 配置保存与 authToken secret（Task 2）', () => {
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

  test('webhooker 声明 secretFields=[authToken]（静态目录，reset 后仍在）', () => {
    expect(getPluginSecretFields(WEBHOOKER_MODULE)).toEqual(['authToken'])
  })

  test('authToken 明文保存 -> 掩码入库 + envelope entry，DB 无明文', async () => {
    const plugin = seedPlugin(WEBHOOKER_MODULE)

    const response = await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest('targetUrl: https://example.com/hook\nauthToken: tok-plain\n'),
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
    expect(envelope.entries[0].path).toBe('authToken')
    expect(stored.encryptedSecret).not.toContain('tok-plain')
  })

  test('authToken 经 host 端口可解密回明文', async () => {
    const plugin = seedPlugin(WEBHOOKER_MODULE)
    await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest('targetUrl: https://example.com/hook\nauthToken: tok-plain\n'),
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
        secretFields: ['authToken'],
        createTask: async () => ({ run: async () => ({ ok: true as const }) })
      }
    )
    await expect(access.get('authToken')).resolves.toBe('tok-plain')
    await expect(access.has('authToken')).resolves.toBe(true)
  })

  test('掩码回环：GET 返回 *** -> 再保存密文不变', async () => {
    const plugin = seedPlugin(WEBHOOKER_MODULE)
    await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest('targetUrl: https://example.com/hook\nauthToken: tok-plain\n'),
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

  test('清除 authToken -> encrypted_secret 置 NULL', async () => {
    const plugin = seedPlugin(WEBHOOKER_MODULE)
    await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest('targetUrl: https://example.com/hook\nauthToken: tok-plain\n'),
      true
    )
    expect(row(plugin.id).encryptedSecret).not.toBeNull()

    const response = await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest('targetUrl: https://example.com/hook\nauthToken: ""\n'),
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

  test('authToken 与 headers.Authorization 并存 -> 400 config，不写库', async () => {
    const plugin = seedPlugin(WEBHOOKER_MODULE, {
      configYaml: 'targetUrl: https://example.com/hook\n'
    })
    const before = row(plugin.id)

    const response = await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest(
        'targetUrl: https://example.com/hook\nauthToken: tok\nheaders:\n  authorization: Bearer x\n'
      ),
      true
    )

    expect(response.status).toBe(400)
    await expect(bodyJson(response)).resolves.toMatchObject({ errorCode: 'config' })
    expect(row(plugin.id).configYaml).toBe(before.configYaml)
    expect(row(plugin.id).encryptedSecret).toBeNull()
  })

  test('非法配置（缺 targetUrl）-> 400 config，不写库', async () => {
    const plugin = seedPlugin(WEBHOOKER_MODULE, {
      configYaml: 'targetUrl: https://example.com/hook\n'
    })
    const before = row(plugin.id)

    const response = await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest('method: POST\ntimeoutMs: 5000\n'),
      true
    )

    expect(response.status).toBe(400)
    await expect(bodyJson(response)).resolves.toMatchObject({ errorCode: 'config' })
    expect(row(plugin.id).configYaml).toBe(before.configYaml)
  })

  test('非法 timeoutMs -> 400 config；合法边界 1..120000 -> 200', async () => {
    const plugin = seedPlugin(WEBHOOKER_MODULE)

    const rejected = await handlers.updatePluginConfig(
      7,
      String(plugin.id),
      configRequest('targetUrl: https://example.com/hook\ntimeoutMs: 120001\n'),
      true
    )
    expect(rejected.status).toBe(400)
    await expect(bodyJson(rejected)).resolves.toMatchObject({ errorCode: 'config' })

    for (const timeoutMs of [1, 120000]) {
      const accepted = await handlers.updatePluginConfig(
        7,
        String(plugin.id),
        configRequest(`targetUrl: https://example.com/hook\ntimeoutMs: ${timeoutMs}\n`),
        true
      )
      expect(accepted.status).toBe(200)
    }
  })
})
