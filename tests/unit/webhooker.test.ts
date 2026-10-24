









import { parse } from 'yaml'
import { resolveVariables } from '../../src/plugins/template'
import type { PluginContext } from '../../src/plugins/types'
import type { PluginHostContext } from '../../src/plugins/jobs/types'
import {
  createWebhookerStaticDefinition
} from '../../src/plugins/builtin/webhooker/definition'


function createMockContext(overrides: Partial<PluginContext> = {}): PluginContext {
  return {
    userId: 123,
    now: '2024-01-24 10:00:00',
    message: {
      id: 1000,
      appId: 1,
      title: 'Test Alert',
      content: 'Test message content',
      priority: 5
    },
    application: {
      id: 1,
      name: 'TestApp'
    },
    ...overrides
  }
}


function createHost(ctx: PluginContext): PluginHostContext {
  return {
    userId: ctx.userId,
    pluginId: 1,
    messages: {
      getMessage: jest.fn(async () => ({
        id: ctx.message?.id ?? 1000,
        appId: ctx.message?.appId ?? 1,
        date: '2024-01-24T09:59:00.000Z',
        priority: ctx.message?.priority ?? 0,
        title: ctx.message?.title,
        content: ctx.message?.content ?? '',
        extras: {}
      }))
    },
    applications: {
      getApplication: jest.fn(async () => ctx.application ?? null)
    },
    tags: { getTags: jest.fn(), appendTags: jest.fn() },
    secrets: { get: jest.fn(async () => null), has: jest.fn(async () => false), paths: () => [] },
    http: { fetch: jest.fn() }
  }
}


async function renderSnapshot(
  configYaml: string,
  ctx: PluginContext = createMockContext()
): Promise<Record<string, unknown>> {
  const definition = createWebhookerStaticDefinition()
  const prepared = await definition.prepareJob!({
    userId: ctx.userId,
    pluginId: 1,
    subjectType: 'message',
    subjectId: ctx.message?.id ?? 1000,
    config: parse(configYaml),
    host: createHost(ctx),
    now: ctx.now
  })
  if (!('payload' in prepared)) {
    throw new Error(`expected payload, got error: ${JSON.stringify(prepared)}`)
  }
  return prepared.payload as Record<string, unknown>
}

describe('prepareJob：body 构造（旧 buildRequestBody 语义迁移）', () => {
  test('should use default body when no config', async () => {
    const payload = await renderSnapshot(`
targetUrl: https://example.com/webhook
`)
    const body = JSON.parse(payload.body as string)

    expect(payload.url).toBe('https://example.com/webhook')
    expect(payload.method).toBe('POST')
    expect(body.pluginId).toBe(1)
    expect(body.userId).toBe(123)
    expect(body.event).toBe('message.create')

    expect(body.message).toEqual({
      id: 1000,
      appId: 1,
      date: '2024-01-24T09:59:00.000Z',
      priority: 5,
      title: 'Test Alert',
      content: 'Test message content',
      extras: {}
    })
    expect(body.at).toBe('2024-01-24 10:00:00')
  })

  test('should parse and resolve custom JSON body', async () => {
    const payload = await renderSnapshot(`
targetUrl: https://example.com/webhook
body: '{"subject": "#{MESSAGE_TITLE}", "text": "#{MESSAGE}"}'
`)
    const body = JSON.parse(payload.body as string)

    expect(body.subject).toBe('Test Alert')
    expect(body.text).toBe('Test message content')
  })

  test('should handle Mailgun-style body with newlines', async () => {
    const payload = await renderSnapshot(`
targetUrl: https://example.com/webhook
body: |
  {"from": "noreply@example.com", "to": "user@example.com", "subject": "#{MESSAGE_TITLE}", "text": "#{MESSAGE}\\n#{APP_NAME}\\n#{NOW}"}
`)
    const body = JSON.parse(payload.body as string)

    expect(body.from).toBe('noreply@example.com')
    expect(body.to).toBe('user@example.com')
    expect(body.subject).toBe('Test Alert')
    expect(body.text).toContain('Test message content')
    expect(body.text).toContain('TestApp')
    expect(body.text).toContain('2024-01-24 10:00:00')
  })

  test('should handle invalid JSON gracefully (plain text fallback)', async () => {
    const payload = await renderSnapshot(`
targetUrl: https://example.com/webhook
body: 'plain text with #{USER_ID}'
`)
    expect(payload.body).toBe('plain text with 123')
  })

  test('should keep unresolved variables as-is', async () => {
    const payload = await renderSnapshot(`
targetUrl: https://example.com/webhook
body: '{"test": "#{UNDEFINED_VAR}"}'
`)

    expect(JSON.parse(payload.body as string)).toEqual({ test: '#{UNDEFINED_VAR}' })
  })

  test('缺 targetUrl 的配置：prepareJob 按 config 拒绝，不建快照（旧「静默跳过」语义收紧为显式拒绝）', async () => {
    const definition = createWebhookerStaticDefinition()
    const prepared = await definition.prepareJob!({
      userId: 123,
      pluginId: 1,
      subjectType: 'message',
      subjectId: 1000,
      config: { method: 'POST' },
      host: createHost(createMockContext()),
      now: '2024-01-24 10:00:00'
    })
    expect(prepared).toEqual({ error: { errorCode: 'config' } })
  })
})

describe('Variable Resolution', () => {
  test('should resolve all supported variables', () => {
    const body = {
      message: '#{MESSAGE}',
      title: '#{MESSAGE_TITLE}',
      userId: '#{USER_ID}',
      appId: '#{APP_ID}',
      app: '#{APP_NAME}',
      time: '#{NOW}'
    }
    const ctx = createMockContext()

    const resolved = resolveVariables(body, ctx)

    expect(resolved.message).toBe('Test message content')
    expect(resolved.title).toBe('Test Alert')
    expect(resolved.userId).toBe('123')
    expect(resolved.appId).toBe('1')
    expect(resolved.app).toBe('TestApp')
    expect(resolved.time).toBe('2024-01-24 10:00:00')
  })

  test('should resolve nested variables in object', () => {
    const body = {
      data: {
        message: '#{MESSAGE}',
        user: { id: '#{USER_ID}' }
      }
    }
    const resolved = resolveVariables(body, createMockContext())

    expect(resolved.data.message).toBe('Test message content')
    expect(resolved.data.user.id).toBe('123')
  })

  test('should resolve variables in array', () => {
    const body = { items: ['#{MESSAGE}', '#{MESSAGE_TITLE}'] }
    const resolved = resolveVariables(body, createMockContext())

    expect(resolved.items[0]).toBe('Test message content')
    expect(resolved.items[1]).toBe('Test Alert')
  })

  test('should keep unresolved variables as-is', () => {
    const body = { defined: '#{MESSAGE}', undefined: '#{UNDEFINED_VAR}' }
    const resolved = resolveVariables(body, createMockContext())

    expect(resolved.defined).toBe('Test message content')
    expect(resolved.undefined).toBe('#{UNDEFINED_VAR}')
  })

  test('should handle missing context data gracefully', () => {
    const body = { title: '#{MESSAGE_TITLE}' }
    const ctx = createMockContext({ message: undefined })
    const resolved = resolveVariables(body, ctx)


    expect(resolved.title).toBe('#{MESSAGE_TITLE}')
  })
})

describe('Full Workflow Test（YAML -> prepareJob 快照）', () => {
  test('should parse YAML config and build snapshot with variables', async () => {
    const yamlConfig = `
targetUrl: https://mail.example.com/v3/example.com/messages
method: POST
timeoutMs: 5000
body: |
  {
    "from": "noreply@example.com",
    "to": "user@example.com",
    "subject": "#{MESSAGE_TITLE}",
    "text": "#{MESSAGE}\\nApp: #{APP_NAME}"
  }
`
    const payload = await renderSnapshot(yamlConfig)

    expect(payload.url).toBe('https://mail.example.com/v3/example.com/messages')
    expect(payload.method).toBe('POST')

    expect(payload).not.toHaveProperty('timeoutMs')

    const body = JSON.parse(payload.body as string)
    expect(body.from).toBe('noreply@example.com')
    expect(body.to).toBe('user@example.com')
    expect(body.subject).toBe('Test Alert')
    expect(body.text).toContain('Test message content')
    expect(body.text).toContain('TestApp')
  })
})

export {}
