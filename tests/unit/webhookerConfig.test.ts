










import {
  DEFAULT_WEBHOOKER_TIMEOUT_MS,
  WEBHOOKER_MAX_TIMEOUT_MS,
  WEBHOOKER_MODULE_PATH,
  resolveWebhookerConfig
} from '../../src/plugins/builtin/webhooker/config'

const minimal = { targetUrl: 'https://example.com/webhook' }

function expectConfigError(raw: unknown) {
  expect(resolveWebhookerConfig(raw)).toEqual({ ok: false, errorCode: 'config' })
}

describe('resolveWebhookerConfig：模块与常量', () => {
  test('modulePath 与现有 registry 注册一致；timeout 默认与现有运行时一致', () => {
    expect(WEBHOOKER_MODULE_PATH).toBe('builtin/webhooker')

    expect(DEFAULT_WEBHOOKER_TIMEOUT_MS).toBe(3000)
    expect(WEBHOOKER_MAX_TIMEOUT_MS).toBe(120000)
  })
})

describe('resolveWebhookerConfig：基础 schema', () => {
  test('仅 targetUrl：method 默认 POST、timeoutMs 默认 3000、可选字段缺省', () => {
    expect(resolveWebhookerConfig(minimal)).toEqual({
      ok: true,
      config: {
        targetUrl: 'https://example.com/webhook',
        method: 'POST',
        timeoutMs: 3000
      }
    })
  })

  test('全量字段原样通过（含 filter，语义保留）', () => {
    const raw = {
      targetUrl: 'https://example.com/webhook/#{USER_ID}',
      method: 'PUT',
      timeoutMs: 5000,
      body: '{"text": "#{MESSAGE}"}',
      headers: { 'X-User-Id': '#{USER_ID}', 'X-Count': 3, 'X-Flag': true },
      filter: { tags: ['webhook', 'alert'], minPriority: 5 }
    }
    expect(resolveWebhookerConfig(raw)).toEqual({
      ok: true,
      config: {
        targetUrl: 'https://example.com/webhook/#{USER_ID}',
        method: 'PUT',
        timeoutMs: 5000,
        body: '{"text": "#{MESSAGE}"}',
        headers: { 'X-User-Id': '#{USER_ID}', 'X-Count': 3, 'X-Flag': true },
        filter: { tags: ['webhook', 'alert'], minPriority: 5 }
      }
    })
  })

  test('未知字段忽略（含历史注释字段与 example task 的 apiKey 占位写法）', () => {
    expect(resolveWebhookerConfig({ ...minimal, legacy: 'delay', apiKey: '***' }).ok).toBe(true)
  })

  test('raw 非对象（null/数组/字符串）-> config', () => {
    expectConfigError(null)
    expectConfigError(undefined)
    expectConfigError([])
    expectConfigError('targetUrl: https://example.com')
    expectConfigError(42)
  })

  test('timeoutMs：整数 1..120000 合法（边界值）', () => {
    expect(resolveWebhookerConfig({ ...minimal, timeoutMs: 1 }).ok).toBe(true)
    expect(
      resolveWebhookerConfig({ ...minimal, timeoutMs: WEBHOOKER_MAX_TIMEOUT_MS }).ok
    ).toBe(true)
  })

  test('timeoutMs：0 / 超上限 / 非整数 / 非数字 -> config', () => {
    expectConfigError({ ...minimal, timeoutMs: 0 })
    expectConfigError({ ...minimal, timeoutMs: WEBHOOKER_MAX_TIMEOUT_MS + 1 })
    expectConfigError({ ...minimal, timeoutMs: 1.5 })
    expectConfigError({ ...minimal, timeoutMs: '5000' })
  })
})

describe('resolveWebhookerConfig：targetUrl 模板静态部分', () => {
  test('路径段变量模板合法（现有 configExample 形态）', () => {
    expect(resolveWebhookerConfig({ targetUrl: 'https://example.com/webhook/#{USER_ID}' }).ok).toBe(
      true
    )
  })

  test('主机段变量模板合法（变量替换后仍是合法 URL）', () => {
    expect(resolveWebhookerConfig({ targetUrl: 'https://#{SUBDOMAIN}.example.com/hook' }).ok).toBe(
      true
    )
  })

  test('query string 模板合法（webhooker 显式放行 query，属 prepareJob 策略）', () => {
    expect(resolveWebhookerConfig({ targetUrl: 'https://example.com/hook?token=#{TOKEN}' }).ok).toBe(
      true
    )
  })

  test('http scheme 字面值合法（是否放行属部署级 outbound 策略，parser 保持 env 无关）', () => {
    expect(resolveWebhookerConfig({ targetUrl: 'http://192.168.1.10:8080/hook' }).ok).toBe(true)
  })

  test('缺失 / 非字符串 / 空白 -> config', () => {
    expectConfigError({})
    expectConfigError({ targetUrl: 123 })
    expectConfigError({ targetUrl: '   ' })
    expectConfigError({ targetUrl: '' })
  })

  test('静态部分语法非法（非 URL、带空格）-> config', () => {
    expectConfigError({ targetUrl: 'not a url' })
    expectConfigError({ targetUrl: 'https://exa mple.com/hook' })
  })

  test('scheme 字面值非 http/https -> config（含变量占位 scheme）', () => {
    expectConfigError({ targetUrl: 'ftp://example.com/hook' })
    expectConfigError({ targetUrl: 'file:///etc/passwd' })
    expectConfigError({ targetUrl: '#{SCHEME}://example.com/hook' })
  })
})

describe('resolveWebhookerConfig：method / body / filter 类型', () => {
  test('method 缺省 POST；自定义合法 token 原样通过（fetch 负责大小写归一）', () => {
    expect(resolveWebhookerConfig({ ...minimal, method: 'post' })).toMatchObject({
      ok: true,
      config: { method: 'post' }
    })
  })

  test('method 非法（非字符串 / 空串 / 带空格）-> config', () => {
    expectConfigError({ ...minimal, method: 1 })
    expectConfigError({ ...minimal, method: '' })
    expectConfigError({ ...minimal, method: 'POST /x' })
  })

  test('body 非字符串 -> config', () => {
    expectConfigError({ ...minimal, body: 42 })
    expectConfigError({ ...minimal, body: { text: '#{MESSAGE}' } })
  })

  test('filter：空对象 / 仅 tags / 仅 minPriority 合法', () => {
    expect(resolveWebhookerConfig({ ...minimal, filter: {} }).ok).toBe(true)
    expect(resolveWebhookerConfig({ ...minimal, filter: { tags: ['a'] } }).ok).toBe(true)
    expect(resolveWebhookerConfig({ ...minimal, filter: { minPriority: 3 } }).ok).toBe(true)
  })

  test('filter：类型非法 -> config', () => {
    expectConfigError({ ...minimal, filter: 'tags' })
    expectConfigError({ ...minimal, filter: { tags: 'webhook' } })
    expectConfigError({ ...minimal, filter: { tags: ['a', 1] } })
    expectConfigError({ ...minimal, filter: { minPriority: '5' } })
    expectConfigError({ ...minimal, filter: { minPriority: true } })
    expectConfigError({ ...minimal, filter: { minPriority: Number.NaN } })
  })
})

describe('resolveWebhookerConfig：headers 与 Authorization 冲突（D4）', () => {
  test('headers 缺省不进入 config；标量值 headers 原样通过', () => {
    const resolved = resolveWebhookerConfig({
      ...minimal,
      headers: { 'X-User-Id': '#{USER_ID}', 'X-Count': 2, 'X-Flag': false }
    })
    expect(resolved).toMatchObject({
      ok: true,
      config: {
        headers: { 'X-User-Id': '#{USER_ID}', 'X-Count': 2, 'X-Flag': false }
      }
    })
  })

  test('headers 非法（数组 / 值为嵌套对象 / 值为数组）-> config', () => {
    expectConfigError({ ...minimal, headers: ['Authorization'] })
    expectConfigError({ ...minimal, headers: { 'X-Data': { a: 1 } } })
    expectConfigError({ ...minimal, headers: { 'X-List': ['a'] } })
  })

  test('header 名非法（CRLF 注入形态 / 空串键 / 含空格）-> config（不是可重试网络错误）', () => {



    expectConfigError({ ...minimal, headers: { 'X-Foo\r\nBar': 'v' } })
    expectConfigError({ ...minimal, headers: { '': 'v' } })
    expectConfigError({ ...minimal, headers: { 'X-Foo Bar': 'v' } })
  })

  test('header 名为合法 RFC 7230 token 原样通过（含 tchar 特殊字符）', () => {
    const resolved = resolveWebhookerConfig({
      ...minimal,
      headers: { 'X-Custom_Header.1': 'v', "X'Quote`d~": 'v', 'X!Bang#Hash': 'v' }
    })
    expect(resolved.ok).toBe(true)
  })

  test('headers.Authorization 明文单独存在合法（存量兼容，不迁移不掩码）', () => {
    expect(
      resolveWebhookerConfig({
        ...minimal,
        headers: { Authorization: 'Bearer legacy-token' }
      }).ok
    ).toBe(true)
  })

  test('authToken 与任意大小写形式的 headers.Authorization 并存 -> config', () => {
    for (const name of ['Authorization', 'authorization', 'AUTHORIZATION']) {
      expectConfigError({
        ...minimal,
        authToken: 'tok',
        headers: { [name]: 'Bearer x' }
      })
    }
  })

  test('headers 内两种大小写的 Authorization 并存（无 authToken）-> config', () => {
    expectConfigError({
      ...minimal,
      headers: { Authorization: 'a', authorization: 'b' }
    })
  })

  test('authToken 类型非法 -> config；null / 空串视为清除，合法', () => {
    expectConfigError({ ...minimal, authToken: 12345 })
    expect(resolveWebhookerConfig({ ...minimal, authToken: null }).ok).toBe(true)
    expect(resolveWebhookerConfig({ ...minimal, authToken: '' }).ok).toBe(true)
  })

  test('authToken 值不进入 resolved config（secret 由平台服务管理）', () => {
    const resolved = resolveWebhookerConfig({ ...minimal, authToken: 'tok' })
    expect(resolved.ok).toBe(true)
    if (resolved.ok) {
      expect(JSON.stringify(resolved.config)).not.toContain('tok')
      expect('authToken' in resolved.config).toBe(false)
    }
  })

  test('掩码占位 *** 可原样通过（GET -> 再保存的回环形态）', () => {
    expect(resolveWebhookerConfig({ ...minimal, authToken: '***' }).ok).toBe(true)
  })
})
