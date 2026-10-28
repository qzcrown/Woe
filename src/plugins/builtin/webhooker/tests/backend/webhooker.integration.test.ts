












/// <reference types="node"/>

import { parse } from 'yaml'
import type { Env } from '../../../../../../src/types/index'
import type { PluginContext } from '../../../../../../src/plugins/types'
import type { PluginHostContext, PluginTask } from '../../../../../../src/plugins/jobs/types'
import { OutboundHttpError } from '../../../../../../src/services/http/outboundPolicy'
import {
  createWebhookerDefinition
} from '../../../../../../src/plugins/builtin/webhooker/definition'


const httpFetch = jest.fn()

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

function createHost(secret: string | null = null): PluginHostContext {
  return {
    userId: 123,
    pluginId: 1,
    messages: {
      getMessage: jest.fn(async () => ({
        id: 1000,
        appId: 1,
        date: '2024-01-24T09:59:00.000Z',
        priority: 9,
        title: 'Critical Alert',
        content: 'System failure detected',
        extras: {}
      }))
    },
    applications: { getApplication: jest.fn(async () => ({ id: 1, name: 'Monitoring' })) },
    tags: { getTags: jest.fn(), appendTags: jest.fn() },
    secrets: {
      get: jest.fn(async () => secret),
      has: jest.fn(async () => secret !== null),
      paths: () => []
    },
    http: { fetch: httpFetch }
  }
}


async function buildTask(
  config: unknown,
  host = createHost()
): Promise<{ task: PluginTask; payload: Record<string, unknown> }> {
  const definition = createWebhookerDefinition({} as Env)
  const prepared = await definition.prepareJob!({
    userId: 123,
    pluginId: 1,
    subjectType: 'message',
    subjectId: 1000,
    config,
    host,
    now: '2024-01-24 10:00:00'
  })
  if (!('payload' in prepared)) {
    throw new Error(`prepareJob rejected: ${JSON.stringify(prepared)}`)
  }
  const task = await definition.createTask({
    config,
    job: {
      jobId: 1,
      userId: 123,
      pluginId: 1,
      subjectType: 'message',
      subjectId: 1000,
      payload: prepared.payload
    },
    host
  })
  return { task, payload: prepared.payload as Record<string, unknown> }
}


const fromYaml = (yaml: string) => parse(yaml)

describe('Webhooker Integration Tests（prepareJob -> createTask -> task.run）', () => {
  beforeEach(() => {
    httpFetch.mockReset()
    httpFetch.mockResolvedValue(new Response('OK', { status: 200 }))
  })

  afterEach(() => {
    httpFetch.mockReset()
  })

  describe('Default behavior (no custom body)', () => {
    test('should send default body when no body config', async () => {
      const { task } = await buildTask({ targetUrl: 'https://example.com/webhook', method: 'POST' })
      await task.run({ attempt: 1, timeoutMs: 20_000 })

      expect(httpFetch).toHaveBeenCalledTimes(1)

      const request = httpFetch.mock.calls[0][0]
      expect(request.url).toBe('https://example.com/webhook')
      expect(request.method).toBe('POST')

      const body = JSON.parse(request.body)
      expect(body.pluginId).toBe(1)
      expect(body.userId).toBe(123)
      expect(body.event).toBe('message.create')
      expect(body.message.content).toBe('System failure detected')
      expect(body.at).toBe('2024-01-24 10:00:00')
    })
  })

  describe('Custom body with variable resolution', () => {
    test('should send custom body with resolved variables', async () => {
      const { task } = await buildTask(
        fromYaml(`
targetUrl: https://api.example.test/endpoint
method: POST
body: |
  {
    "from": "noreply@example.com",
    "to": "user@example.com",
    "subject": "#{MESSAGE_TITLE}",
    "text": "#{MESSAGE}\\nApp: #{APP_NAME}"
  }
`)
      )
      await task.run({ attempt: 1, timeoutMs: 20_000 })

      expect(httpFetch).toHaveBeenCalledTimes(1)

      const request = httpFetch.mock.calls[0][0]
      expect(request.url).toBe('https://api.example.test/endpoint')
      expect(request.method).toBe('POST')

      const body = JSON.parse(request.body)
      expect(body.from).toBe('noreply@example.com')
      expect(body.to).toBe('user@example.com')
      expect(body.subject).toBe('Critical Alert')
      expect(body.text).toContain('System failure detected')
      expect(body.text).toContain('Monitoring')
    })

    test('should resolve variables in headers', async () => {
      const { task } = await buildTask({
        targetUrl: 'https://api.example.test/endpoint',
        method: 'POST',
        headers: {
          Authorization: 'Bearer secret-token',
          'X-User-Id': '#{USER_ID}',
          'X-App-Id': '#{APP_ID}'
        }
      })
      await task.run({ attempt: 1, timeoutMs: 20_000 })

      const { headers } = httpFetch.mock.calls[0][0]

      expect(headers.Authorization).toBe('Bearer secret-token')
      expect(headers['X-User-Id']).toBe('123')
      expect(headers['X-App-Id']).toBe('1')
    })

    test('authToken 声明时注入 Bearer（新推荐用法）', async () => {
      const { task } = await buildTask(
        {
          targetUrl: 'https://api.example.test/endpoint',
          authToken: '***'
        },
        createHost('secret-token')
      )
      await task.run({ attempt: 1, timeoutMs: 20_000 })

      const { headers } = httpFetch.mock.calls[0][0]
      expect(headers.Authorization).toBe('Bearer secret-token')
    })
  })

  describe('Mailgun configuration test', () => {
    test('should work with Mailgun-style configuration', async () => {
      const config = {
        targetUrl: 'https://mail.example.com/v3/example.com/messages',
        method: 'POST',
        timeoutMs: 5000,
        body: `{
  "from": "noreply@example.com",
  "to": "user@example.com",
  "subject": "#{MESSAGE_TITLE}",
  "text": "#{MESSAGE}\\n#{APP_NAME}\\n#{NOW}"
}`,
        headers: {
          Authorization: 'Basic YXBpOmtleS0zOWQ4MzFmZmI1ZjI5M2ZkMzQ3ZTM2ZjIxZThjNzdmNA==',
          'X-User-Id': '#{USER_ID}',
          'X-App-Id': '#{APP_ID}'
        }
      }

      const { task } = await buildTask(config)
      await task.run({ attempt: 1, timeoutMs: 20_000 })

      expect(httpFetch).toHaveBeenCalledTimes(1)

      const request = httpFetch.mock.calls[0][0]
      expect(request.url).toBe('https://mail.example.com/v3/example.com/messages')
      expect(request.method).toBe('POST')

      expect(request.timeoutMs).toBe(5000)


      expect(request.headers.Authorization).toBe(
        'Basic YXBpOmtleS0zOWQ4MzFmZmI1ZjI5M2ZkMzQ3ZTM2ZjIxZThjNzdmNA=='
      )
      expect(request.headers['X-User-Id']).toBe('123')
      expect(request.headers['X-App-Id']).toBe('1')


      const body = JSON.parse(request.body)
      expect(body.from).toBe('noreply@example.com')
      expect(body.to).toBe('user@example.com')
      expect(body.subject).toBe('Critical Alert')
      expect(body.text).toContain('System failure detected')
      expect(body.text).toContain('Monitoring')
      expect(body.text).toContain('2024-01-24 10:00:00')
    })
  })

  describe('Variable resolution edge cases', () => {
    test('should handle missing message title', async () => {
      const host = createHost()
      host.messages.getMessage = jest.fn(async () => ({
        id: 1000,
        appId: 1,
        date: '2024-01-24T09:59:00.000Z',
        priority: 9,
        content: 'System failure detected',
        extras: {}
      }))
      const { task } = await buildTask(
        {
          targetUrl: 'https://example.com/webhook',
          body: '{"subject": "#{MESSAGE_TITLE}", "text": "#{MESSAGE}"}'
        },
        host
      )
      await task.run({ attempt: 1, timeoutMs: 20_000 })

      const { body } = httpFetch.mock.calls[0][0]
      const parsed = JSON.parse(body)

      expect(parsed.subject).toBe('#{MESSAGE_TITLE}')
      expect(parsed.text).toBe('System failure detected')
    })

    test('should handle missing application', async () => {
      const host = createHost()
      host.applications.getApplication = jest.fn(async () => null)
      const { task } = await buildTask(
        {
          targetUrl: 'https://example.com/webhook',
          body: '{"app": "#{APP_NAME}", "message": "#{MESSAGE}"}'
        },
        host
      )
      await task.run({ attempt: 1, timeoutMs: 20_000 })

      const { body } = httpFetch.mock.calls[0][0]
      const parsed = JSON.parse(body)
      expect(parsed.app).toBe('#{APP_NAME}')
      expect(parsed.message).toBe('System failure detected')
    })
  })

  describe('Request options', () => {
    test('should use custom timeout from config (min with platform budget)', async () => {
      const { task } = await buildTask({
        targetUrl: 'https://example.com/webhook',
        timeoutMs: 10000
      })
      await task.run({ attempt: 1, timeoutMs: 20_000 })

      expect(httpFetch).toHaveBeenCalledTimes(1)
      expect(httpFetch.mock.calls[0][0].timeoutMs).toBe(10000)
    })

    test('should use default timeout (3000) when not specified', async () => {
      const { task } = await buildTask({ targetUrl: 'https://example.com/webhook' })
      await task.run({ attempt: 1, timeoutMs: 20_000 })

      expect(httpFetch).toHaveBeenCalledTimes(1)
      expect(httpFetch.mock.calls[0][0].timeoutMs).toBe(3000)
    })
  })

  describe('Error handling', () => {
    test('fetch 网络错误归一为 provider-network（可重试），不再静默吞掉', async () => {
      const { task } = await buildTask({ targetUrl: 'https://example.com/webhook' })


      httpFetch.mockRejectedValue(new OutboundHttpError('network'))

      const result = await task.run({ attempt: 1, timeoutMs: 20_000 })
      expect(result).toEqual({
        ok: false,
        failure: { errorCode: 'provider-network', retriable: true },
        quotaConsumed: true
      })
    })

    test('should handle invalid JSON in body config', async () => {
      const { task } = await buildTask({
        targetUrl: 'https://example.com/webhook',
        body: 'not valid json #{USER_ID}'
      })
      await task.run({ attempt: 1, timeoutMs: 20_000 })


      expect(httpFetch.mock.calls[0][0].body).toContain('123')
    })
  })

  describe('Skip conditions（旧静默跳过语义 -> 显式拒绝）', () => {
    test('should reject snapshot when targetUrl is missing', async () => {
      const definition = createWebhookerDefinition({} as Env)
      const prepared = await definition.prepareJob!({
        userId: 123,
        pluginId: 1,
        subjectType: 'message',
        subjectId: 1000,
        config: { method: 'POST' },
        host: createHost(),
        now: '2024-01-24 10:00:00'
      })
      expect(prepared).toEqual({ error: { errorCode: 'config' } })
      expect(httpFetch).not.toHaveBeenCalled()
    })

    test('should reject snapshot when targetUrl is empty', async () => {
      const definition = createWebhookerDefinition({} as Env)
      const prepared = await definition.prepareJob!({
        userId: 123,
        pluginId: 1,
        subjectType: 'message',
        subjectId: 1000,
        config: { targetUrl: '' },
        host: createHost(),
        now: '2024-01-24 10:00:00'
      })
      expect(prepared).toEqual({ error: { errorCode: 'config' } })
      expect(httpFetch).not.toHaveBeenCalled()
    })
  })
})

export {}
