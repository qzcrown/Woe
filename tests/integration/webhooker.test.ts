/**
 * Integration tests for webhooker plugin
 * Tests the complete webhooker functionality with mocked fetch
 */

/// <reference types="node"/>

import { createWebhooker } from '../../src/plugins/builtin/webhooker'
import { PluginContext } from '../../src/plugins/types'
import { parseYaml } from '../../src/utils/yaml'

// Mock fetch globally
const mockFetch = jest.fn()
global.fetch = mockFetch

function createMockContext(overrides: Partial<PluginContext> = {}): PluginContext {
  return {
    userId: 123,
    now: '2024-01-24 10:00:00',
    message: {
      id: 1000,
      appId: 1,
      title: 'Critical Alert',
      content: 'System failure detected',
      priority: 9
    },
    application: {
      id: 1,
      name: 'Monitoring'
    },
    ...overrides
  }
}

describe('Webhooker Integration Tests', () => {
  let plugin: ReturnType<typeof createWebhooker>

  beforeEach(() => {
    // Create fresh plugin instance for each test
    plugin = createWebhooker({ id: 1, name: 'test-webhooker' })
    mockFetch.mockReset()
    mockFetch.mockResolvedValue(new Response('OK', { status: 200 }))
  })

  afterEach(() => {
    mockFetch.mockReset()
  })

  describe('Default behavior (no custom body)', () => {
    test('should send default body when no body config', async () => {
      const config = {
        targetUrl: 'https://example.com/webhook',
        method: 'POST'
      }

      await plugin.init({ config })
      const ctx = createMockContext()
      await plugin.onMessageCreate!(ctx)

      expect(mockFetch).toHaveBeenCalledTimes(1)

      const [url, options] = mockFetch.mock.calls[0]
      expect(url).toBe('https://example.com/webhook')
      expect(options?.method).toBe('POST')

      const body = JSON.parse(options?.body as string)
      expect(body.pluginId).toBe(1)
      expect(body.userId).toBe(123)
      expect(body.event).toBe('message.create')
      expect(body.message).toEqual(ctx.message)
      expect(body.at).toBe('2024-01-24 10:00:00')
    })
  })

  describe('Custom body with variable resolution', () => {
    test('should send custom body with resolved variables', async () => {
      const yamlConfig = `
targetUrl: https://api.test.com/endpoint
method: POST
body: |
  {
    "from": "noreply@example.com",
    "to": "user@example.com",
    "subject": "#{MESSAGE_TITLE}",
    "text": "#{MESSAGE}\\nApp: #{APP_NAME}"
  }
`
      const config = parseYaml(yamlConfig)

      await plugin.init({ config })
      const ctx = createMockContext()
      await plugin.onMessageCreate!(ctx)

      expect(mockFetch).toHaveBeenCalledTimes(1)

      const [url, options] = mockFetch.mock.calls[0]
      expect(url).toBe('https://api.test.com/endpoint')
      expect(options?.method).toBe('POST')

      const body = JSON.parse(options?.body as string)
      expect(body.from).toBe('noreply@example.com')
      expect(body.to).toBe('user@example.com')
      expect(body.subject).toBe('Critical Alert')
      expect(body.text).toContain('System failure detected')
      expect(body.text).toContain('Monitoring')
    })

    test('should resolve variables in headers', async () => {
      const config = {
        targetUrl: 'https://api.test.com/endpoint',
        method: 'POST',
        headers: {
          Authorization: 'Bearer secret-token',
          'X-User-Id': '#{USER_ID}',
          'X-App-Id': '#{APP_ID}'
        }
      }

      await plugin.init({ config })
      const ctx = createMockContext()
      await plugin.onMessageCreate!(ctx)

      const [, options] = mockFetch.mock.calls[0]
      const headers = options?.headers as Record<string, string>

      expect(headers.Authorization).toBe('Bearer secret-token')
      expect(headers['X-User-Id']).toBe('123')
      expect(headers['X-App-Id']).toBe('1')
    })
  })

  describe('Mailgun configuration test', () => {
    test('should work with Mailgun-style configuration', async () => {
      // Use direct config object to test webhooker logic (YAML parsing has limitations)
      const config = {
        targetUrl: 'https://api.mailgun.net/v3/qzcrown.xyz/messages',
        method: 'POST',
        timeoutMs: 5000,
        body: `{
  "from": "noreply@qzcrown.xyz",
  "to": "wgwg112233@gmail.com",
  "subject": "#{MESSAGE_TITLE}",
  "text": "#{MESSAGE}\\n#{APP_NAME}\\n#{NOW}"
}`,
        headers: {
          Authorization: 'Basic YXBpOmtleS0zOWQ4MzFmZmI1ZjI5M2ZkMzQ3ZTM2ZjIxZThjNzdmNA==',
          'X-User-Id': '#{USER_ID}',
          'X-App-Id': '#{APP_ID}'
        }
      }

      await plugin.init({ config })
      const ctx = createMockContext()
      await plugin.onMessageCreate!(ctx)

      expect(mockFetch).toHaveBeenCalledTimes(1)

      const [url, options] = mockFetch.mock.calls[0]
      expect(url).toBe('https://api.mailgun.net/v3/qzcrown.xyz/messages')
      expect(options?.method).toBe('POST')

      // Verify headers
      const headers = options?.headers as Record<string, string>
      expect(headers.Authorization).toBe('Basic YXBpOmtleS0zOWQ4MzFmZmI1ZjI5M2ZkMzQ3ZTM2ZjIxZThjNzdmNA==')
      expect(headers['X-User-Id']).toBe('123')
      expect(headers['X-App-Id']).toBe('1')

      // Verify body
      const body = JSON.parse(options?.body as string)
      expect(body.from).toBe('noreply@qzcrown.xyz')
      expect(body.to).toBe('wgwg112233@gmail.com')
      expect(body.subject).toBe('Critical Alert')
      expect(body.text).toContain('System failure detected')
      expect(body.text).toContain('Monitoring')
      expect(body.text).toContain('2024-01-24 10:00:00')
    })
  })

  describe('Variable resolution edge cases', () => {
    test('should handle missing message title', async () => {
      const config = {
        targetUrl: 'https://example.com/webhook',
        body: '{"subject": "#{MESSAGE_TITLE}", "text": "#{MESSAGE}"}'
      }

      await plugin.init({ config })
      const ctx = createMockContext({ message: { ...createMockContext().message!, title: undefined as any } })
      await plugin.onMessageCreate!(ctx)

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)

      // Undefined variable should remain as placeholder
      expect(body.subject).toBe('#{MESSAGE_TITLE}')
      expect(body.text).toBe('System failure detected')
    })

    test('should handle missing application', async () => {
      const config = {
        targetUrl: 'https://example.com/webhook',
        body: '{"app": "#{APP_NAME}", "message": "#{MESSAGE}"}'
      }

      await plugin.init({ config })
      const ctx = createMockContext({ application: undefined as any })
      await plugin.onMessageCreate!(ctx)

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)

      expect(body.app).toBe('#{APP_NAME}')
      expect(body.message).toBe('System failure detected')
    })
  })

  describe('Request options', () => {
    test('should use custom timeout from config', async () => {
      const config = {
        targetUrl: 'https://example.com/webhook',
        timeoutMs: 10000
      }

      await plugin.init({ config })
      const ctx = createMockContext()

      // Start the request but don't wait for it
      const promise = plugin.onMessageCreate!(ctx)

      // Give it a moment to set up the timeout
      await new Promise(resolve => setTimeout(resolve, 10))

      await promise

      // The timeout should be configured (we can't directly test AbortSignal timeout,
      // but we can verify no errors were thrown)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    test('should use default timeout when not specified', async () => {
      const config = {
        targetUrl: 'https://example.com/webhook'
      }

      await plugin.init({ config })
      const ctx = createMockContext()
      await plugin.onMessageCreate!(ctx)

      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('Error handling', () => {
    test('should silently handle fetch errors', async () => {
      const config = {
        targetUrl: 'https://example.com/webhook'
      }

      await plugin.init({ config })
      const ctx = createMockContext()

      mockFetch.mockRejectedValue(new Error('Network error'))

      // Should not throw
      await expect(plugin.onMessageCreate!(ctx)).resolves.toBeUndefined()
    })

    test('should handle invalid JSON in body config', async () => {
      const config = {
        targetUrl: 'https://example.com/webhook',
        body: 'not valid json #{USER_ID}'
      }

      await plugin.init({ config })
      const ctx = createMockContext()
      await plugin.onMessageCreate!(ctx)

      const [, options] = mockFetch.mock.calls[0]
      // Should fall back to plain text with variable replacement
      expect(options?.body).toContain('123')
    })
  })

  describe('Skip conditions', () => {
    test('should not send request if targetUrl is missing', async () => {
      const config = {
        method: 'POST'
      }

      await plugin.init({ config })
      const ctx = createMockContext()
      await plugin.onMessageCreate!(ctx)

      expect(mockFetch).not.toHaveBeenCalled()
    })

    test('should not send request if targetUrl is empty', async () => {
      const config = {
        targetUrl: ''
      }

      await plugin.init({ config })
      const ctx = createMockContext()
      await plugin.onMessageCreate!(ctx)

      expect(mockFetch).not.toHaveBeenCalled()
    })
  })
})

export {}
