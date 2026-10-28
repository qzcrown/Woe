import { readFileSync } from 'fs'
import { parse } from 'yaml'
import type { MessageJobView } from '../src/routes/messageJobs.ts'

export type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

export interface Endpoint {
  path: string
  methods: Method[]
}

export const expected: Endpoint[] = [
  { path: '/admin/quotas/{namespace}/{userId}', methods: ['PUT'] },
  { path: '/admin/quotas/{namespace}/users', methods: ['GET'] },
  { path: '/application', methods: ['GET', 'POST'] },
  { path: '/application/{id}', methods: ['DELETE', 'GET', 'PUT'] },
  { path: '/application/{id}/image', methods: ['DELETE', 'POST'] },
  { path: '/application/{id}/message', methods: ['DELETE', 'GET'] },
  { path: '/application/{id}/security', methods: ['PUT'] },
  { path: '/auth/logout', methods: ['POST'] },
  { path: '/client', methods: ['GET', 'POST'] },
  { path: '/client/{id}', methods: ['DELETE', 'GET', 'PUT'] },
  { path: '/client/{id}/deactivate', methods: ['POST'] },
  { path: '/client/{id}/elevate', methods: ['POST'] },
  { path: '/client/{id}/push-state', methods: ['PUT'] },
  { path: '/current/user', methods: ['GET'] },
  { path: '/current/user/password', methods: ['POST'] },
  { path: '/gotifyinfo', methods: ['GET'] },
  { path: '/health', methods: ['GET'] },
  { path: '/image/{filename}', methods: ['GET'] },
  { path: '/init/admin', methods: ['POST'] },
  { path: '/init/status', methods: ['GET'] },
  { path: '/message', methods: ['DELETE', 'GET', 'POST'] },
  { path: '/message/{id}', methods: ['DELETE', 'GET'] },
  { path: '/message/{id}/jobs', methods: ['GET', 'POST'] },
  { path: '/message/count', methods: ['GET'] },
  { path: '/plugin', methods: ['GET', 'POST'] },
  { path: '/plugin/{id}', methods: ['DELETE'] },
  { path: '/plugin/{id}/config', methods: ['GET', 'POST'] },
  { path: '/plugin/{id}/disable', methods: ['POST'] },
  { path: '/plugin/{id}/display', methods: ['GET'] },
  { path: '/plugin/{id}/enable', methods: ['POST'] },
  { path: '/plugin/{id}/image', methods: ['DELETE', 'POST'] },
  { path: '/plugin/{id}/logs', methods: ['GET'] },
  { path: '/plugin/{id}/name', methods: ['PUT'] },
  { path: '/plugin/available', methods: ['GET'] },
  { path: '/static/defaultapp.png', methods: ['GET'] },
  { path: '/status', methods: ['GET'] },
  { path: '/stream', methods: ['GET'] },
  { path: '/user', methods: ['GET', 'POST'] },
  { path: '/user/{id}', methods: ['DELETE', 'GET', 'POST', 'PUT'] },
  { path: '/user/{id}/applications', methods: ['GET'] },
  { path: '/user/{id}/avatar', methods: ['DELETE', 'POST'] },
  { path: '/user/{id}/clients', methods: ['GET'] },
  { path: '/user/{id}/disabled', methods: ['PUT'] },
  { path: '/user/{id}/plugin-permissions', methods: ['GET', 'PUT'] },
  { path: '/user/{id}/plugins', methods: ['GET'] },
  { path: '/user/{id}/profile', methods: ['PUT'] },
  { path: '/version', methods: ['GET'] }
]

function readDocumentedEndpoints(): Endpoint[] {
  const document = parse(readFileSync('tests/fixtures/api-contract.yaml', 'utf8')) as {
    paths?: Record<string, Record<string, unknown>>
  }

  return Object.entries(document.paths ?? {})
    .map(([path, operations]) => ({
      path,
      methods: Object.keys(operations)
        .map((method) => method.toUpperCase() as Method)
        .sort()
    }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

function readDocumentedResponses(path: string, method: string): string[] {
  const document = parse(readFileSync('tests/fixtures/api-contract.yaml', 'utf8')) as {
    paths?: Record<string, Record<string, { responses?: Record<string, unknown> }>>
  }

  return Object.keys(document.paths?.[path]?.[method]?.responses ?? {}).sort()
}

function readOperation(path: string, method: string): Record<string, any> {
  const document = parse(readFileSync('tests/fixtures/api-contract.yaml', 'utf8')) as {
    paths?: Record<string, Record<string, Record<string, any>>>
  }

  return document.paths?.[path]?.[method] ?? {}
}

describe('API contract', () => {
  test('api-contract fixture path and method snapshot matches the expected contract', () => {
    expect(readDocumentedEndpoints()).toEqual(expected)
  })

  test('docs/api.yaml documents 400 for GET /message/{id}', () => {
    expect(readDocumentedResponses('/message/{id}', 'get')).toEqual(
      expect.arrayContaining(['200', '400', '401', '404'])
    )
  })

  test('docs/api.yaml documents 409 for PUT /client/{id}/push-state', () => {
    expect(readDocumentedResponses('/client/{id}/push-state', 'put')).toEqual(
      expect.arrayContaining(['200', '400', '401', '404', '409'])
    )
  })

  test('docs/api.yaml documents parsed safe integer priorities for all message encodings', () => {
    const content = readOperation('/message', 'post').requestBody.content
    for (const media of ['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
      const priority = content[media].schema.properties.priority
      expect(priority.minimum).toBe(-9007199254740991)
      expect(priority.maximum).toBe(9007199254740991)
      expect(priority.description).toContain('safe integer')
    }
    expect(content['application/json'].schema.properties.priority.nullable).toBe(true)
  })

  test('docs/api.yaml requires client token or basic auth for GET /current/user', () => {
    expect(readOperation('/current/user', 'get').security).toEqual([
      { ClientToken: [] },
      { BasicAuth: [] }
    ])
  })

  test('docs/api.yaml requires client token or basic auth for GET /stream', () => {
    expect(readOperation('/stream', 'get').security).toEqual([
      { ClientToken: [] },
      { BasicAuth: [] }
    ])
  })

  test('docs/api.yaml documents POST /user as optional anonymous or client/basic auth only', () => {
    expect(readOperation('/user', 'post').security).toEqual([
      {},
      { ClientToken: [] },
      { BasicAuth: [] }
    ])
  })

  test('docs/api.yaml documents sortKey on Application and ApplicationParams', () => {
    const document = parse(readFileSync('tests/fixtures/api-contract.yaml', 'utf8')) as {
      components?: { schemas?: Record<string, { properties?: Record<string, { type?: string }> }> }
    }

    const applicationSchema = document.components?.schemas?.Application
    const applicationParamsSchema = document.components?.schemas?.ApplicationParams

    expect(applicationSchema?.properties?.sortKey?.type).toBe('string')
    expect(applicationParamsSchema?.properties?.sortKey?.type).toBe('string')
  })

  test('MessageJobView keys match the documented MessageJob schema exactly', () => {

    const viewKeys = Object.keys({
      jobId: 0,
      pluginId: 0,
      status: 'pending',
      result: null,
      error: null,
      createdAt: null,
      completedAt: null
    } satisfies MessageJobView).sort()

    const document = parse(readFileSync('tests/fixtures/api-contract.yaml', 'utf8')) as {
      components?: { schemas?: Record<string, { properties?: Record<string, unknown> }> }
    }
    const documentedKeys = Object.keys(
      document.components?.schemas?.MessageJob?.properties ?? {}
    ).sort()

    expect(viewKeys).toEqual(documentedKeys)
  })

  test('docs/api.yaml documents plugin metadata fields on PluginConf', () => {
    const document = parse(readFileSync('tests/fixtures/api-contract.yaml', 'utf8')) as {
      components?: { schemas?: Record<string, { properties?: Record<string, { type?: string; items?: { type?: string } }> }> }
    }

    const pluginConfSchema = document.components?.schemas?.PluginConf

    expect(pluginConfSchema?.properties?.capabilities?.type).toBe('array')
    expect(pluginConfSchema?.properties?.capabilities?.items?.type).toBe('string')
    expect(pluginConfSchema?.properties?.author?.type).toBe('string')
    expect(pluginConfSchema?.properties?.license?.type).toBe('string')
    expect(pluginConfSchema?.properties?.website?.type).toBe('string')
    expect(pluginConfSchema?.properties?.configExample?.type).toBe('string')
  })

  test('docs/api.yaml marks required fields for Application, PluginConf and VersionInfo', () => {
    const document = parse(readFileSync('tests/fixtures/api-contract.yaml', 'utf8')) as {
      components?: { schemas?: Record<string, { required?: string[] }> }
    }

    const applicationRequired = document.components?.schemas?.Application?.required ?? []
    const pluginConfRequired = document.components?.schemas?.PluginConf?.required ?? []
    const versionInfoRequired = document.components?.schemas?.VersionInfo?.required ?? []


    expect(applicationRequired).not.toContain('token')
    expect(applicationRequired).toEqual(
      expect.arrayContaining(['id', 'name', 'sortKey', 'description', 'internal', 'image'])
    )
    expect(pluginConfRequired).toEqual(
      expect.arrayContaining(['id', 'name', 'token', 'modulePath', 'enabled', 'capabilities'])
    )
    expect(versionInfoRequired).toEqual(
      expect.arrayContaining(['version', 'commit', 'buildDate'])
    )
  })

  test('docs/api.yaml application token visibility is described per operation, not by the old empty-string claim', () => {


    const listDescription = readOperation('/application', 'get').description as string
    expect(listDescription).toContain('omit')
    expect(listDescription).not.toContain('`token: ""`')


    const detailDescription = readOperation('/application/{id}', 'get').description as string
    expect(detailDescription).toContain('public')
    expect(detailDescription).toContain('legacy')
    expect(detailDescription).not.toContain('empty `token` string')

    expect(Object.keys(readOperation('/application/{id}', 'get').responses ?? {})).toContain('404')


    const userAppsDescription = readOperation('/user/{id}/applications', 'get').description as string
    expect(userAppsDescription).toContain('omit')
    expect(userAppsDescription).not.toContain('`token: ""`')


    const imageDeleteDescription = readOperation('/application/{id}/image', 'delete').description as string
    expect(imageDeleteDescription).toContain('still returns `token: ""`')
    const imageUploadDescription = readOperation('/application/{id}/image', 'post').description as string
    expect(imageUploadDescription).toContain('stored token value')
  })
})
