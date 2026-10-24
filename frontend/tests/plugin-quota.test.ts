import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const http = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn()
}))

vi.mock('axios', () => ({
  default: {
    create: () => ({
      get: http.get,
      post: http.post,
      put: http.put,
      delete: http.delete,
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() }
      }
    })
  }
}))

import i18n from '@/locales'
import { adminQuotaApi } from '@/services/api'
import { authService, AuthStrategy } from '@/services/auth'
import {
  canManageQuotas,
  isQuotaDisabled,
  parseQuotaLimitInput,
  quotaInputErrorKey,
  quotaSourceKey
} from '@/utils/quota'
beforeEach(() => {
  vi.clearAllMocks()
  i18n.global.locale.value = 'en-US'
  http.get.mockResolvedValue({ data: { users: [] } })
  http.put.mockResolvedValue({ data: {} })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('adminQuotaApi', () => {
  it('uses the client token strategy for both root and /api/v1 prefixes', () => {
    authService.setToken('client', 'client-token')

    expect(authService.getAuthStrategy('/admin/quotas/ai/users', 'GET').strategy)
      .toBe(AuthStrategy.CLIENT_TOKEN_HEADER)
    expect(authService.getAuthStrategy('/admin/quotas/ai/5', 'PUT').strategy)
      .toBe(AuthStrategy.CLIENT_TOKEN_HEADER)

    const config = authService.applyAuth(
      { url: '/api/v1/admin/quotas/ai/users', method: 'get' },
      '/api/v1/admin/quotas/ai/users'
    )
    expect(config.headers['X-Gotify-Key']).toBe('client-token')
  })

  it('lists ai quota users', async () => {
    http.get.mockResolvedValue({ data: { users: [] } })

    const response = await adminQuotaApi.list()

    expect(http.get).toHaveBeenCalledWith('/admin/quotas/ai/users')
    expect(response.data).toEqual({ users: [] })
  })

  it('sets a numeric limit', async () => {
    await adminQuotaApi.setLimit(5, 500)

    expect(http.put).toHaveBeenCalledWith('/admin/quotas/ai/5', { limit: 500 })
  })

  it('sets zero to disable the user', async () => {
    await adminQuotaApi.setLimit(5, 0)

    expect(http.put).toHaveBeenCalledWith('/admin/quotas/ai/5', { limit: 0 })
  })

  it('clears an override with a null limit', async () => {
    await adminQuotaApi.clearLimit(5)

    expect(http.put).toHaveBeenCalledWith('/admin/quotas/ai/5', { limit: null })
  })
})

describe('quota display helpers', () => {
  it('shows the inherited default when no override exists', () => {
    expect(i18n.global.t('users.aiQuota.inherited')).toBe('Default (no override)')
  })

  it('treats an effective limit of zero as disabled', () => {
    expect(isQuotaDisabled(0)).toBe(true)
    expect(isQuotaDisabled(500)).toBe(false)
  })

  it('maps quota sources to i18n keys present in both locales', () => {
    expect(quotaSourceKey('override')).toBe('users.aiQuota.sourceOverride')
    expect(quotaSourceKey('default')).toBe('users.aiQuota.sourceDefault')
    expect(i18n.global.t(quotaSourceKey('override'))).toBe('Override')
  })

  it('only allows administrators to manage quotas', () => {
    expect(canManageQuotas({ admin: true })).toBe(true)
    expect(canManageQuotas({ admin: false })).toBe(false)
    expect(canManageQuotas(null)).toBe(false)
    expect(canManageQuotas(undefined)).toBe(false)
  })
})

describe('quota limit input parsing', () => {
  it('reports an empty input separately from a malformed one', () => {
    const hint = i18n.global.t(quotaInputErrorKey('empty'))

    expect(parseQuotaLimitInput('')).toEqual({ status: 'empty' })
    expect(parseQuotaLimitInput('   ')).toEqual({ status: 'empty' })
    expect(quotaInputErrorKey('empty')).toBe('users.aiQuota.emptyLimit')
    expect(hint).toContain('Clear override')
  })

  it('rejects malformed values with the format hint', () => {
    expect(quotaInputErrorKey('invalid')).toBe('users.aiQuota.invalidLimit')
    expect(i18n.global.t(quotaInputErrorKey('invalid'))).toBe('Quota must be a non-negative integer')
  })

  it('accepts non-negative integers including zero', () => {
    expect(parseQuotaLimitInput('0')).toEqual({ status: 'ok', limit: 0 })
    expect(parseQuotaLimitInput(' 12 ')).toEqual({ status: 'ok', limit: 12 })
    expect(parseQuotaLimitInput('-1')).toEqual({ status: 'invalid' })
    expect(parseQuotaLimitInput('1.5')).toEqual({ status: 'invalid' })
    expect(parseQuotaLimitInput('abc')).toEqual({ status: 'invalid' })
  })

  it('rejects integers beyond Number.MAX_SAFE_INTEGER (same rule as the backend)', () => {


    expect(parseQuotaLimitInput('9007199254740993')).toEqual({ status: 'invalid' })
    expect(parseQuotaLimitInput('1e21')).toEqual({ status: 'invalid' })
    expect(parseQuotaLimitInput(String(Number.MAX_SAFE_INTEGER))).toEqual({
      status: 'ok',
      limit: Number.MAX_SAFE_INTEGER
    })
  })
})
