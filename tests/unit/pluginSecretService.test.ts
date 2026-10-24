







import { eq } from 'drizzle-orm'
import { createPluginJobsTestDb } from '../helpers/pluginJobsTestDb'
import { asDrizzle } from '../helpers/testDb'
import type { TestDb } from '../helpers/testDb'
import { pluginConfigs } from '../../src/models'
import {
  PluginSecretError,
  PluginSecretService,
  SECRET_MASK,
  createPluginSecretAccess,
  type PluginSecretEnv
} from '../../src/services/pluginSecretService'

const MASTER_KEY_BYTES = Uint8Array.from({ length: 32 }, (_, i) => i + 1)
const MASTER_KEY = Buffer.from(MASTER_KEY_BYTES).toString('base64')

function secretEnv(overrides: Partial<PluginSecretEnv> = {}): PluginSecretEnv {
  return {
    PLUGIN_SECRET_MASTER_KEY: MASTER_KEY,
    PLUGIN_SECRET_KEY_VERSION: '1',
    ...overrides
  }
}

function makeService(overrides: Partial<PluginSecretEnv> = {}): PluginSecretService {
  return new PluginSecretService(secretEnv(overrides))
}

type Envelope = {
  v: number
  keyVersion: number
  entries: Array<{ path: string; iv: string; ciphertext: string }>
}

function parseEnvelope(raw: string | null): Envelope {
  expect(raw).not.toBeNull()
  return JSON.parse(raw as string) as Envelope
}

function saveInput(overrides: Record<string, unknown> = {}) {
  return {
    pluginId: 11,
    userId: 7,
    configYaml: 'apiKey: sk-live\nmodel: gpt-4o\n',
    encryptedSecret: null as string | null,
    secretFields: ['apiKey'] as readonly string[],
    ...overrides
  }
}

async function expectSecretError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code })
}

function parseYaml(yaml: string): unknown {

  const YAML = require('yaml') as typeof import('yaml')
  return YAML.parseDocument(yaml).toJS()
}

describe('PluginSecretService: 保存与掩码', () => {
  test('新明文：配置写入 ***、envelope 有独立 IV，DB 中不含明文', async () => {
    const service = makeService()

    const result = await service.processConfigForSave(saveInput())

    expect(result.configYaml).not.toContain('sk-live')
    expect(result.configYaml).toContain('***')
    expect(parseYaml(result.configYaml)).toEqual({ apiKey: SECRET_MASK, model: 'gpt-4o' })

    const envelope = parseEnvelope(result.encryptedSecret)
    expect(envelope.v).toBe(1)
    expect(envelope.keyVersion).toBe(1)
    expect(envelope.entries).toHaveLength(1)
    expect(envelope.entries[0].path).toBe('apiKey')

    expect(Buffer.from(envelope.entries[0].iv, 'base64')).toHaveLength(12)
    expect(envelope.entries[0].ciphertext).not.toContain('sk-live')


    expect(JSON.stringify(result)).not.toContain('sk-live')
  })

  test('再次提交 *** 保留旧密文（同 IV 同 ciphertext）且可解出原值', async () => {
    const service = makeService()
    const first = await service.processConfigForSave(saveInput())
    const firstEnvelope = parseEnvelope(first.encryptedSecret)

    const second = await service.processConfigForSave(
      saveInput({
        configYaml: first.configYaml,
        encryptedSecret: first.encryptedSecret
      })
    )
    const secondEnvelope = parseEnvelope(second.encryptedSecret)

    expect(secondEnvelope.keyVersion).toBe(firstEnvelope.keyVersion)
    expect(secondEnvelope.entries[0].iv).toBe(firstEnvelope.entries[0].iv)
    expect(secondEnvelope.entries[0].ciphertext).toBe(firstEnvelope.entries[0].ciphertext)

    await expect(
      service.readSecret({
        pluginId: 11,
        userId: 7,
        encryptedSecret: second.encryptedSecret,
        path: 'apiKey'
      })
    ).resolves.toBe('sk-live')
  })

  test('提交新明文：密文变化、解出新值、keyVersion 不变', async () => {
    const service = makeService()
    const first = await service.processConfigForSave(saveInput())

    const second = await service.processConfigForSave(
      saveInput({
        configYaml: 'apiKey: sk-new-secret\nmodel: gpt-4o\n',
        encryptedSecret: first.encryptedSecret
      })
    )
    const before = parseEnvelope(first.encryptedSecret)
    const after = parseEnvelope(second.encryptedSecret)

    expect(after.keyVersion).toBe(1)
    expect(after.entries[0].ciphertext).not.toBe(before.entries[0].ciphertext)
    await expect(
      service.readSecret({
        pluginId: 11,
        userId: 7,
        encryptedSecret: second.encryptedSecret,
        path: 'apiKey'
      })
    ).resolves.toBe('sk-new-secret')
  })

  test('空字符串/字段删除：entry 删除；全部删除时 encrypted_secret 为 NULL', async () => {
    const service = makeService()
    const first = await service.processConfigForSave(saveInput())

    for (const configYaml of ['apiKey: ""\nmodel: gpt-4o\n', 'model: gpt-4o\n']) {
      const cleared = await service.processConfigForSave(
        saveInput({ configYaml, encryptedSecret: first.encryptedSecret })
      )
      expect(cleared.encryptedSecret).toBeNull()
      expect(cleared.configYaml).not.toContain('apiKey')
    }
  })

  test('全部 entry 删除且旧存储为 null 时也返回 null', async () => {
    const service = makeService()
    const result = await service.processConfigForSave(
      saveInput({ configYaml: 'model: gpt-4o\n', encryptedSecret: null })
    )
    expect(result.encryptedSecret).toBeNull()
  })

  test('path 改名（apiKey -> provider.apiKey）：旧 entry 删除、新 entry 建立', async () => {
    const service = makeService()
    const first = await service.processConfigForSave(saveInput())

    const renamed = await service.processConfigForSave({
      pluginId: 11,
      userId: 7,
      configYaml: 'provider:\n  apiKey: sk-nested\n',
      encryptedSecret: first.encryptedSecret,
      secretFields: ['provider.apiKey']
    })
    const envelope = parseEnvelope(renamed.encryptedSecret)

    expect(envelope.entries.map((entry) => entry.path)).toEqual(['provider.apiKey'])
    expect(parseYaml(renamed.configYaml)).toEqual({
      provider: { apiKey: SECRET_MASK }
    })
    await expect(
      service.readSecret({
        pluginId: 11,
        userId: 7,
        encryptedSecret: renamed.encryptedSecret,
        path: 'provider.apiKey'
      })
    ).resolves.toBe('sk-nested')
  })

  test('新 path 提交 *** 且无旧密文 -> secret-config', async () => {
    const service = makeService()
    await expectSecretError(
      service.processConfigForSave(
        saveInput({ configYaml: 'apiKey: "***"\n', secretFields: ['apiKey'] })
      ),
      'secret-config'
    )
  })

  test('重复 YAML key -> secret-config（不静默取最后一个）', async () => {
    const service = makeService()
    await expectSecretError(
      service.processConfigForSave(saveInput({ configYaml: 'apiKey: a\napiKey: b\n' })),
      'secret-config'
    )
  })

  test('secret 值为数组 -> secret-config', async () => {
    const service = makeService()
    await expectSecretError(
      service.processConfigForSave(saveInput({ configYaml: 'apiKey:\n  - a\n  - b\n' })),
      'secret-config'
    )
  })

  test('secret 值为非字符串标量 -> secret-config', async () => {
    const service = makeService()
    await expectSecretError(
      service.processConfigForSave(saveInput({ configYaml: 'apiKey: 12345\n' })),
      'secret-config'
    )
  })

  test('YAML 语法错误 -> secret-config', async () => {
    const service = makeService()
    await expectSecretError(
      service.processConfigForSave(saveInput({ configYaml: 'apiKey: [unclosed\n' })),
      'secret-config'
    )
  })

  test('path 命中字面含点 key（a.b）-> secret-config，不静默跳过', async () => {
    const service = makeService()
    await expectSecretError(
      service.processConfigForSave(
        saveInput({ configYaml: 'a.b: sk-live\n', secretFields: ['a.b'] })
      ),
      'secret-config'
    )
  })

  test('path 的中间节点是标量（provider: sk-live）-> secret-config', async () => {
    const service = makeService()
    await expectSecretError(
      service.processConfigForSave(
        saveInput({ configYaml: 'provider: sk-live\n', secretFields: ['provider.apiKey'] })
      ),
      'secret-config'
    )
  })

  test('path 的中间节点不存在 -> 视为未设置（保留 continue 语义）', async () => {
    const service = makeService()
    const saved = await service.processConfigForSave(
      saveInput({ configYaml: 'apiKey: sk-live\n', secretFields: ['provider.apiKey'] })
    )
    expect(saved.encryptedSecret).toBeNull()

    const masked = await service.maskConfigForRead({
      configYaml: 'apiKey: sk-live\n',
      secretFields: ['provider.apiKey']
    })
    expect(parseYaml(masked)).toEqual({ apiKey: 'sk-live' })
  })

  test('不记录明文/密文/IV（console 无调用）', async () => {
    const spies = [
      jest.spyOn(console, 'log').mockImplementation(() => {}),
      jest.spyOn(console, 'warn').mockImplementation(() => {}),
      jest.spyOn(console, 'error').mockImplementation(() => {})
    ]
    const service = makeService()
    await service.processConfigForSave(saveInput())

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    }
  })
})

describe('PluginSecretService: 主密钥与 keyVersion fail-closed', () => {
  test.each([
    ['缺失', undefined],
    ['空串', ''],
    ['base64 非法', '!!!!not-base64!!!!'],
    ['解码后非 32 字节', Buffer.from('short-key').toString('base64')]
  ])('主密钥%s -> secret-key-unavailable，且不回退明文', async (_label, masterKey) => {
    const service = new PluginSecretService({
      PLUGIN_SECRET_MASTER_KEY: masterKey,
      PLUGIN_SECRET_KEY_VERSION: '1'
    })
    await expectSecretError(service.processConfigForSave(saveInput()), 'secret-key-unavailable')
  })

  test('keyVersion 不一致 + *** 保留请求 -> secret-reentry-required', async () => {
    const v1 = makeService()
    const first = await v1.processConfigForSave(saveInput())

    const v2 = makeService({ PLUGIN_SECRET_KEY_VERSION: '2' })
    await expectSecretError(
      v2.processConfigForSave(
        saveInput({
          configYaml: 'apiKey: "***"\n',
          encryptedSecret: first.encryptedSecret
        })
      ),
      'secret-reentry-required'
    )
  })

  test('keyVersion 不一致 + 新明文：用新版本重新加密', async () => {
    const v1 = makeService()
    const first = await v1.processConfigForSave(saveInput())

    const v2 = makeService({ PLUGIN_SECRET_KEY_VERSION: '2' })
    const second = await v2.processConfigForSave(
      saveInput({
        configYaml: 'apiKey: sk-rotated\n',
        encryptedSecret: first.encryptedSecret
      })
    )
    expect(parseEnvelope(second.encryptedSecret).keyVersion).toBe(2)
    await expect(
      v2.readSecret({
        pluginId: 11,
        userId: 7,
        encryptedSecret: second.encryptedSecret,
        path: 'apiKey'
      })
    ).resolves.toBe('sk-rotated')
  })

  test('keyVersion 非法（0 / 负数 / 非整数）-> secret-key-unavailable', async () => {
    for (const version of ['0', '-1', '1.5', 'abc']) {
      const service = makeService({ PLUGIN_SECRET_KEY_VERSION: version })
      await expectSecretError(service.processConfigForSave(saveInput()), 'secret-key-unavailable')
    }
  })

  test('主密钥缺失时读取侧 get 返回 null（fail-closed，不抛错）', async () => {
    const service = new PluginSecretService({})
    const first = await makeService().processConfigForSave(saveInput())

    await expect(
      service.readSecret({
        pluginId: 11,
        userId: 7,
        encryptedSecret: first.encryptedSecret,
        path: 'apiKey'
      })
    ).resolves.toBeNull()
  })
})

describe('PluginSecretService: AAD 绑定与 envelope 完整性', () => {
  test('同一密文换 pluginId/userId/keyVersion 解密必须失败', async () => {
    const service = makeService()
    const saved = await service.processConfigForSave(saveInput())

    const base = {
      encryptedSecret: saved.encryptedSecret,
      path: 'apiKey'
    }

    await expect(service.readSecret({ ...base, pluginId: 12, userId: 7 })).rejects.toMatchObject({
      code: 'secret-decrypt-failed'
    })
    await expect(service.readSecret({ ...base, pluginId: 11, userId: 8 })).rejects.toMatchObject({
      code: 'secret-decrypt-failed'
    })

    const tampered = parseEnvelope(saved.encryptedSecret)
    tampered.keyVersion = 2
    await expect(
      service.readSecret({
        ...base,
        pluginId: 11,
        userId: 7,
        encryptedSecret: JSON.stringify(tampered)
      })
    ).rejects.toMatchObject({ code: 'secret-decrypt-failed' })
  })

  test('IV 长度非法 -> secret-decrypt-failed', async () => {
    const service = makeService()
    const saved = await service.processConfigForSave(saveInput())
    const envelope = parseEnvelope(saved.encryptedSecret)
    envelope.entries[0].iv = Buffer.from('too-short').toString('base64')

    await expect(
      service.readSecret({
        pluginId: 11,
        userId: 7,
        encryptedSecret: JSON.stringify(envelope),
        path: 'apiKey'
      })
    ).rejects.toMatchObject({ code: 'secret-decrypt-failed' })
  })

  test('envelope JSON 非法 -> secret-decrypt-failed', async () => {
    const service = makeService()
    await expect(
      service.readSecret({
        pluginId: 11,
        userId: 7,
        encryptedSecret: '{not-json',
        path: 'apiKey'
      })
    ).rejects.toMatchObject({ code: 'secret-decrypt-failed' })
  })

  test('envelope 结构与版本非法 -> secret-decrypt-failed', async () => {
    const service = makeService()
    for (const raw of [
      JSON.stringify({ v: 2, keyVersion: 1, entries: [] }),
      JSON.stringify({ v: 1, keyVersion: 1, entries: {} }),
      JSON.stringify({ v: 1, keyVersion: 1 })
    ]) {
      await expect(
        service.readSecret({ pluginId: 11, userId: 7, encryptedSecret: raw, path: 'apiKey' })
      ).rejects.toMatchObject({ code: 'secret-decrypt-failed' })
    }
  })

  test('不存在的 path 返回 null（不抛错）', async () => {
    const service = makeService()
    const saved = await service.processConfigForSave(saveInput())

    await expect(
      service.readSecret({
        pluginId: 11,
        userId: 7,
        encryptedSecret: saved.encryptedSecret,
        path: 'otherKey'
      })
    ).resolves.toBeNull()
  })

  test('错误对象可被识别（PluginSecretError）', async () => {
    const service = makeService()
    await expect(
      service.processConfigForSave(saveInput({ configYaml: 'apiKey:\n  - a\n' }))
    ).rejects.toBeInstanceOf(PluginSecretError)
  })
})

describe('PluginSecretService: 读取侧掩码与历史明文', () => {
  test('GET 掩码：secret 字段显示 ***，其余字段保留', async () => {
    const service = makeService()
    const masked = await service.maskConfigForRead({
      configYaml: 'apiKey: sk-historical\nmodel: gpt-4o\nprovider:\n  apiKey: sk-nested\n',
      secretFields: ['apiKey', 'provider.apiKey']
    })

    expect(masked).not.toContain('sk-historical')
    expect(masked).not.toContain('sk-nested')
    expect(parseYaml(masked)).toEqual({
      apiKey: SECRET_MASK,
      model: 'gpt-4o',
      provider: { apiKey: SECRET_MASK }
    })
  })

  test('历史明文：GET 只显示 ***，get() 不把明文当 secret', async () => {
    const testDb: TestDb = createPluginJobsTestDb()
    const drizzle = asDrizzle(testDb)
    const [row] = testDb.db
      .insert(pluginConfigs)
      .values({
        userId: 7,
        name: 'legacy',
        token: 'token-legacy',
        modulePath: 'test/secret',
        enabled: 1,
        configYaml: 'apiKey: sk-legacy\n',
        encryptedSecret: null
      })
      .returning()
      .all()

    const service = makeService()
    const masked = await service.maskConfigForRead({
      configYaml: row.configYaml ?? '',
      secretFields: ['apiKey']
    })
    expect(masked).not.toContain('sk-legacy')

    const access = createPluginSecretAccess(drizzle, secretEnv(), 7, row.id, {
      modulePath: 'test/secret',
      supportedSubjectTypes: ['message'],
      secretFields: ['apiKey'],
      createTask: async () => ({ run: async () => ({ ok: true as const }) })
    })

    await expect(access.get('apiKey')).resolves.toBeNull()
    await expect(access.has('apiKey')).resolves.toBe(false)
  })

  test('GET 掩码：字面含点 key 无法安全掩码 -> secret-config（不返回明文）', async () => {
    const service = makeService()
    await expectSecretError(
      service.maskConfigForRead({ configYaml: 'a.b: sk-live\n', secretFields: ['a.b'] }),
      'secret-config'
    )
  })

  test('GET 掩码空配置返回空字符串（不产生 "null" 文档）', async () => {
    const service = makeService()
    await expect(
      service.maskConfigForRead({ configYaml: '', secretFields: ['apiKey'] })
    ).resolves.toBe('')
  })

  test('secret 字段为数组时 GET 整体掩码，不泄露元素', async () => {
    const service = makeService()
    const masked = await service.maskConfigForRead({
      configYaml: 'apiKey:\n  - sk-in-array\n',
      secretFields: ['apiKey']
    })
    expect(masked).not.toContain('sk-in-array')
    expect(parseYaml(masked)).toEqual({ apiKey: SECRET_MASK })
  })
})

describe('createPluginSecretAccess: 端口语义', () => {
  let testDb: TestDb
  let drizzle: ReturnType<typeof asDrizzle>
  let pluginId: number

  beforeEach(() => {
    testDb = createPluginJobsTestDb()
    drizzle = asDrizzle(testDb)
    const [row] = testDb.db
      .insert(pluginConfigs)
      .values({
        userId: 7,
        name: 'secret-plugin',
        token: 'token-secret',
        modulePath: 'test/secret',
        enabled: 1,
        configYaml: 'apiKey: "***"\n'
      })
      .returning()
      .all()
    pluginId = row.id
  })

  const definition = {
    modulePath: 'test/secret',
    supportedSubjectTypes: ['message'],
    secretFields: ['apiKey', 'provider.apiKey'],
    createTask: async () => ({ run: async () => ({ ok: true as const }) })
  }

  test('未声明的 path 一律 null/false，且不读库报错', async () => {
    const access = createPluginSecretAccess(drizzle, secretEnv(), 7, pluginId, definition)

    await expect(access.get('otherKey')).resolves.toBeNull()
    await expect(access.has('otherKey')).resolves.toBe(false)
  })

  test('paths() 返回声明的 path（存在性用 has）', () => {
    const access = createPluginSecretAccess(drizzle, secretEnv(), 7, pluginId, definition)
    expect(access.paths()).toEqual(['apiKey', 'provider.apiKey'])
  })

  test('has 只查存在性，不依赖主密钥；get 缺主密钥返回 null', async () => {
    const service = makeService()
    const saved = await service.processConfigForSave(
      saveInput({ pluginId, userId: 7 })
    )
    testDb.db
      .update(pluginConfigs)
      .set({ encryptedSecret: saved.encryptedSecret })
      .where(eq(pluginConfigs.id, pluginId))
      .run()

    const okAccess = createPluginSecretAccess(drizzle, secretEnv(), 7, pluginId, definition)
    await expect(okAccess.has('apiKey')).resolves.toBe(true)
    await expect(okAccess.get('apiKey')).resolves.toBe('sk-live')

    const noKeyAccess = createPluginSecretAccess(drizzle, {}, 7, pluginId, definition)
    await expect(noKeyAccess.has('apiKey')).resolves.toBe(true)
    await expect(noKeyAccess.get('apiKey')).resolves.toBeNull()
  })

  test('envelope 损坏：has 与 get 结论一致，均抛 secret-decrypt-failed', async () => {
    testDb.db
      .update(pluginConfigs)
      .set({ encryptedSecret: '{not json' })
      .where(eq(pluginConfigs.id, pluginId))
      .run()

    const access = createPluginSecretAccess(drizzle, secretEnv(), 7, pluginId, definition)
    await expect(access.has('apiKey')).rejects.toMatchObject({ code: 'secret-decrypt-failed' })
    await expect(access.get('apiKey')).rejects.toMatchObject({ code: 'secret-decrypt-failed' })
  })

  test('encrypted_secret 为 NULL：has=false、get=null，均不抛', async () => {
    testDb.db
      .update(pluginConfigs)
      .set({ encryptedSecret: null })
      .where(eq(pluginConfigs.id, pluginId))
      .run()

    const access = createPluginSecretAccess(drizzle, secretEnv(), 7, pluginId, definition)
    await expect(access.has('apiKey')).resolves.toBe(false)
    await expect(access.get('apiKey')).resolves.toBeNull()
  })

  test('解密失败抛出可识别错误（不吞掉）', async () => {
    testDb.db
      .update(pluginConfigs)
      .set({ encryptedSecret: '{broken' })
      .where(eq(pluginConfigs.id, pluginId))
      .run()

    const access = createPluginSecretAccess(drizzle, secretEnv(), 7, pluginId, definition)
    await expect(access.get('apiKey')).rejects.toMatchObject({ code: 'secret-decrypt-failed' })
  })

  test('主密钥 base64 合法但非 32 字节：保存失败、执行期 get 返回 null（不抛）', async () => {
    const wrongKeyEnv = secretEnv({
      PLUGIN_SECRET_MASTER_KEY: Buffer.from(
        Uint8Array.from({ length: 16 }, (_, i) => i + 1)
      ).toString('base64')
    })
    await expectSecretError(
      new PluginSecretService(wrongKeyEnv).processConfigForSave(saveInput({ pluginId, userId: 7 })),
      'secret-key-unavailable'
    )

    const saved = await makeService().processConfigForSave(saveInput({ pluginId, userId: 7 }))
    testDb.db
      .update(pluginConfigs)
      .set({ encryptedSecret: saved.encryptedSecret })
      .where(eq(pluginConfigs.id, pluginId))
      .run()

    const access = createPluginSecretAccess(drizzle, wrongKeyEnv, 7, pluginId, definition)
    await expect(access.get('apiKey')).resolves.toBeNull()

    await expect(access.has('apiKey')).resolves.toBe(true)
  })

  test('密文被篡改一个字节：get 抛 secret-decrypt-failed（不得 fail-closed 成 null）', async () => {
    const saved = await makeService().processConfigForSave(saveInput({ pluginId, userId: 7 }))
    const envelope = parseEnvelope(saved.encryptedSecret)
    const ciphertext = Buffer.from(envelope.entries[0].ciphertext, 'base64')
    ciphertext[0] ^= 0xff
    envelope.entries[0].ciphertext = ciphertext.toString('base64')

    testDb.db
      .update(pluginConfigs)
      .set({ encryptedSecret: JSON.stringify(envelope) })
      .where(eq(pluginConfigs.id, pluginId))
      .run()

    const access = createPluginSecretAccess(drizzle, secretEnv(), 7, pluginId, definition)
    await expect(access.get('apiKey')).rejects.toMatchObject({ code: 'secret-decrypt-failed' })
  })

  test('主密钥无法导入（importKey 失败）：get 返回 null，不抛 secret-key-unavailable', async () => {
    const saved = await makeService().processConfigForSave(saveInput({ pluginId, userId: 7 }))
    testDb.db
      .update(pluginConfigs)
      .set({ encryptedSecret: saved.encryptedSecret })
      .where(eq(pluginConfigs.id, pluginId))
      .run()

    const importKey = jest
      .spyOn(crypto.subtle, 'importKey')
      .mockRejectedValue(new Error('import failed') as never)
    try {
      const access = createPluginSecretAccess(drizzle, secretEnv(), 7, pluginId, definition)
      await expect(access.get('apiKey')).resolves.toBeNull()
    } finally {
      importKey.mockRestore()
    }
  })

  test('其他用户/插件实例读不到同一行的 secret', async () => {
    const service = makeService()
    const saved = await service.processConfigForSave(saveInput({ pluginId, userId: 7 }))
    testDb.db
      .update(pluginConfigs)
      .set({ encryptedSecret: saved.encryptedSecret })
      .where(eq(pluginConfigs.id, pluginId))
      .run()

    const otherUser = createPluginSecretAccess(drizzle, secretEnv(), 8, pluginId, definition)
    await expect(otherUser.get('apiKey')).resolves.toBeNull()
    await expect(otherUser.has('apiKey')).resolves.toBe(false)

    const otherPlugin = createPluginSecretAccess(drizzle, secretEnv(), 7, pluginId + 1, definition)
    await expect(otherPlugin.get('apiKey')).resolves.toBeNull()
  })
})
