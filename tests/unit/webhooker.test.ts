/**
 * Unit tests for webhooker plugin
 * Tests YAML parsing, body building, and variable resolution
 */

import { parseYaml } from '../../src/utils/yaml'
import { resolveVariables } from '../../src/plugins/template'
import { PluginContext } from '../../src/plugins/types'

// Mock buildRequestBody function (copied from webhooker.ts for testing)
function buildRequestBody(
  bodyConfig: string | undefined,
  ctx: PluginContext,
  pluginId: number,
  resolveVariablesFn: (value: any, ctx: PluginContext) => any
): string {
  if (!bodyConfig) {
    return JSON.stringify({
      pluginId: pluginId,
      userId: ctx.userId,
      event: 'message.create',
      message: ctx.message,
      at: ctx.now
    })
  }

  let parsedBody: any
  try {
    parsedBody = JSON.parse(bodyConfig)
  } catch {
    parsedBody = bodyConfig
  }

  const resolvedBody = resolveVariablesFn(parsedBody, ctx)

  if (typeof resolvedBody === 'object') {
    return JSON.stringify(resolvedBody)
  }
  return String(resolvedBody)
}

// Helper to create mock context
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

describe('YAML Multi-line Parser', () => {
  test('should parse multi-line string with | syntax', () => {
    const yaml = `
body: |
  {
    "key": "value"
  }
`
    const result = parseYaml(yaml)
    expect(result).toBeDefined()
    expect(result!.body).toContain('"key": "value"')
  })

  test('should preserve newlines in multi-line value', () => {
    const yaml = `
body: |
  line 1
  line 2
  line 3
`
    const result = parseYaml(yaml)
    expect(result!.body).toBe('line 1\nline 2\nline 3')
  })

  test('should handle variables in multi-line body', () => {
    const yaml = `
body: |
  {
    "subject": "#{MESSAGE_TITLE}"
  }
`
    const result = parseYaml(yaml)
    expect(result!.body).toContain('#{MESSAGE_TITLE}')
  })

  test('should parse other yaml properties alongside multi-line', () => {
    const yaml = `
targetUrl: https://example.com
method: POST
timeoutMs: 5000
body: |
  {"key": "value"}
`
    const result = parseYaml(yaml)
    expect(result!.targetUrl).toBe('https://example.com')
    expect(result!.method).toBe('POST')
    expect(result!.timeoutMs).toBe(5000)
    expect(result!.body).toContain('"key": "value"')
  })
})

describe('buildRequestBody', () => {
  test('should use default body when no config', () => {
    const ctx = createMockContext()
    const body = buildRequestBody(undefined, ctx, 1, resolveVariables)
    const parsed = JSON.parse(body)

    expect(parsed.pluginId).toBe(1)
    expect(parsed.userId).toBe(123)
    expect(parsed.event).toBe('message.create')
    expect(parsed.message).toEqual(ctx.message)
    expect(parsed.at).toBe('2024-01-24 10:00:00')
  })

  test('should parse and resolve custom JSON body', () => {
    const bodyConfig = '{"subject": "#{MESSAGE_TITLE}", "text": "#{MESSAGE}"}'
    const ctx = createMockContext()
    const body = buildRequestBody(bodyConfig, ctx, 1, resolveVariables)
    const parsed = JSON.parse(body)

    expect(parsed.subject).toBe('Test Alert')
    expect(parsed.text).toBe('Test message content')
  })

  test('should handle Mailgun-style body with newlines', () => {
    const bodyConfig = JSON.stringify({
      from: 'noreply@example.com',
      to: 'user@example.com',
      subject: '#{MESSAGE_TITLE}',
      text: '#{MESSAGE}\n#{APP_NAME}\n#{NOW}'
    })
    const ctx = createMockContext()
    const body = buildRequestBody(bodyConfig, ctx, 1, resolveVariables)
    const parsed = JSON.parse(body)

    expect(parsed.from).toBe('noreply@example.com')
    expect(parsed.to).toBe('user@example.com')
    expect(parsed.subject).toBe('Test Alert')
    expect(parsed.text).toContain('Test message content')
    expect(parsed.text).toContain('TestApp')
    expect(parsed.text).toContain('2024-01-24 10:00:00')
  })

  test('should handle invalid JSON gracefully', () => {
    const bodyConfig = 'plain text with #{USER_ID}'
    const ctx = createMockContext()
    const body = buildRequestBody(bodyConfig, ctx, 1, resolveVariables)

    expect(body).toContain('123')
  })

  test('should keep unresolved variables as-is', () => {
    const bodyConfig = '{"test": "#{UNDEFINED_VAR}"}'
    const ctx = createMockContext()
    const body = buildRequestBody(bodyConfig, ctx, 1, resolveVariables)
    const parsed = JSON.parse(body)

    expect(parsed.test).toBe('#{UNDEFINED_VAR}')
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
    expect(resolved.appId).toBe('1')  // resolveVariables returns string
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
    const ctx = createMockContext()

    const resolved = resolveVariables(body, ctx)

    expect(resolved.data.message).toBe('Test message content')
    expect(resolved.data.user.id).toBe('123')
  })

  test('should resolve variables in array', () => {
    const body = {
      items: ['#{MESSAGE}', '#{MESSAGE_TITLE}']
    }
    const ctx = createMockContext()

    const resolved = resolveVariables(body, ctx)

    expect(resolved.items[0]).toBe('Test message content')
    expect(resolved.items[1]).toBe('Test Alert')
  })

  test('should keep unresolved variables as-is', () => {
    const body = {
      defined: '#{MESSAGE}',
      undefined: '#{UNDEFINED_VAR}'
    }
    const ctx = createMockContext()

    const resolved = resolveVariables(body, ctx)

    expect(resolved.defined).toBe('Test message content')
    expect(resolved.undefined).toBe('#{UNDEFINED_VAR}')
  })

  test('should handle missing context data gracefully', () => {
    const body = {
      title: '#{MESSAGE_TITLE}'
    }
    const ctx = createMockContext({ message: undefined })

    const resolved = resolveVariables(body, ctx)

    // Missing variables should remain as placeholders
    expect(resolved.title).toBe('#{MESSAGE_TITLE}')
  })
})

describe('Full Workflow Test', () => {
  test('should parse YAML config and build body with variables', () => {
    const yamlConfig = `
targetUrl: https://api.mailgun.net/v3/example.com/messages
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
    const config = parseYaml(yamlConfig)
    const ctx = createMockContext()

    // Verify YAML parsing
    expect(config!.targetUrl).toBe('https://api.mailgun.net/v3/example.com/messages')
    expect(config!.method).toBe('POST')
    expect(config!.timeoutMs).toBe(5000)
    expect(config!.body).toContain('noreply@example.com')

    // Verify body building with variable resolution
    const body = buildRequestBody(config!.body, ctx, 1, resolveVariables)
    const parsed = JSON.parse(body)

    expect(parsed.from).toBe('noreply@example.com')
    expect(parsed.to).toBe('user@example.com')
    expect(parsed.subject).toBe('Test Alert')
    expect(parsed.text).toContain('Test message content')
    expect(parsed.text).toContain('TestApp')
  })
})

export {}
