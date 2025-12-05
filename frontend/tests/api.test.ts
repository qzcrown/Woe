import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { api } from '@/services/api'
import { setupServer } from 'msw/node'
import { rest } from 'msw'

// Setup mock server
const server = setupServer(
  rest.get('/health', (req, res, ctx) => {
    return res(
      ctx.status(200),
      ctx.json({
        health: 'green',
        database: 'green'
      })
    )
  }),
  
  rest.get('/version', (req, res, ctx) => {
    return res(
      ctx.status(200),
      ctx.json({
        version: '2.0.0',
        commit: 'abc123',
        buildDate: '2023-01-01T00:00:00Z'
      })
    )
  }),
  
  rest.get('/application', (req, res, ctx) => {
    return res(
      ctx.status(200),
      ctx.json([
        {
          id: 1,
          token: 'test-token-12345678',
          name: 'Test App',
          description: 'A test application',
          image: 'test-image.jpg',
          internal: false,
          defaultPriority: 1,
          lastUsed: '2023-01-01T00:00:00Z'
        }
      ])
    )
  }),
  
  rest.get('/message', (req, res, ctx) => {
    const limit = req.url.searchParams.get('limit') || '100'
    const since = req.url.searchParams.get('since') || '0'
    
    return res(
      ctx.status(200),
      ctx.json({
        messages: [
          {
            id: 1,
            appid: 1,
            title: 'Test Message',
            message: 'This is a test message',
            date: '2023-01-01T00:00:00Z',
            priority: 1
          }
        ],
        paging: {
          size: 1,
          since: parseInt(since),
          limit: parseInt(limit),
          next: limit === '10' ? '/message?since=1&limit=10' : null
        }
      })
    )
  }),
  
  rest.get('/plugin', (req, res, ctx) => {
    return res(
      ctx.status(200),
      ctx.json([
        {
          id: 1,
          name: 'Test Plugin',
          token: 'plugin-token-123',
          enabled: true,
          modulePath: 'github.com/test/plugin',
          capabilities: ['display', 'config'],
          author: 'Test Author',
          license: 'MIT',
          website: 'https://example.com'
        }
      ])
    )
  })
)

beforeEach(() => {
  // Reset any request handlers or state if needed
})

afterEach(() => {
  // Clean up after each test
})

describe('API Service', () => {
  it('should fetch health status', async () => {
    const response = await api.get('/health')
    
    expect(response.status).toBe(200)
    expect(response.data).toEqual({
      health: 'green',
      database: 'green'
    })
  })

  it('should fetch version info', async () => {
    const response = await api.get('/version')
    
    expect(response.status).toBe(200)
    expect(response.data).toEqual({
      version: '2.0.0',
      commit: 'abc123',
      buildDate: '2023-01-01T00:00:00Z'
    })
  })

  it('should fetch applications', async () => {
    const response = await api.get('/application')
    
    expect(response.status).toBe(200)
    expect(response.data).toHaveLength(1)
    expect(response.data[0]).toEqual(
      expect.objectContaining({
        id: 1,
        name: 'Test App',
        description: 'A test application'
      })
    )
  })

  it('should fetch messages with pagination', async () => {
    const response = await api.get('/message?limit=10&since=0')
    
    expect(response.status).toBe(200)
    expect(response.data).toHaveProperty('messages')
    expect(response.data).toHaveProperty('paging')
    expect(response.data.messages).toHaveLength(1)
    expect(response.data.paging).toEqual(
      expect.objectContaining({
        limit: 10,
        since: 0
      })
    )
  })

  it('should fetch plugins', async () => {
    const response = await api.get('/plugin')
    
    expect(response.status).toBe(200)
    expect(response.data).toHaveLength(1)
    expect(response.data[0]).toEqual(
      expect.objectContaining({
        id: 1,
        name: 'Test Plugin',
        enabled: true
      })
    )
  })
})