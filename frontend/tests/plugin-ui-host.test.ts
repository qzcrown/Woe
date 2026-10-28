import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const mocks = vi.hoisted(() => ({
  getPlugins: vi.fn(),
  listJobs: vi.fn(),
  triggerJob: vi.fn(),
  quotaList: vi.fn(),
  quotaSetLimit: vi.fn(),
  quotaClearLimit: vi.fn(),
  getSessionRevision: vi.fn(),
  getClientCredential: vi.fn(),
  getClientId: vi.fn()
}))

vi.mock('@/services/api', () => ({
  pluginApi: { getPlugins: mocks.getPlugins },
  messageJobsApi: { list: mocks.listJobs, trigger: mocks.triggerJob },
  adminQuotaApi: {
    list: mocks.quotaList,
    setLimit: mocks.quotaSetLimit,
    clearLimit: mocks.quotaClearLimit
  }
}))
vi.mock('@/services/auth', () => ({
  clientTokenStorageKey: () => 'woe_client_token',
  clientIdStorageKey: () => 'woe_client_id',
  authService: {
    subscribeSessionChanges: () => () => {},
    getSessionRevision: mocks.getSessionRevision,
    getClientCredentialForRevocation: mocks.getClientCredential,
    getClientId: mocks.getClientId
  }
}))

import { createPluginUiHost } from '@/plugins/host'

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSessionRevision.mockReturnValue(0)
  mocks.getClientCredential.mockReturnValue('client-token-a')
  mocks.getClientId.mockReturnValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PluginUiHost.api wrapper', () => {
  it('unwraps plugin instances and forwards the host signal', async () => {
    mocks.getPlugins.mockResolvedValue({ data: [{ id: 9, modulePath: 'builtin/example-task' }] })

    const host = createPluginUiHost({ ownerId: 7 })
    const plugins = await host.api.listPlugins()

    expect(mocks.getPlugins).toHaveBeenCalledWith({ signal: host.signal, sessionGuard: host.isCurrent })
    expect(plugins).toEqual([{ id: 9, modulePath: 'builtin/example-task' }])
  })

  it('unwraps job list and trigger responses with the host signal', async () => {
    mocks.listJobs.mockResolvedValue({ data: { messageDeleted: false, jobs: [] } })
    mocks.triggerJob.mockResolvedValue({ data: { jobId: 11, status: 'pending' } })

    const host = createPluginUiHost({ ownerId: 7 })
    await host.api.listJobs(1, 9)
    await host.api.triggerJob(1, 9)

    expect(mocks.listJobs).toHaveBeenCalledWith(1, 9, { signal: host.signal, sessionGuard: host.isCurrent })
    expect(mocks.triggerJob).toHaveBeenCalledWith(1, 9, { signal: host.signal, sessionGuard: host.isCurrent })
  })

  it('unwraps quota users and routes null limits to clearLimit', async () => {
    mocks.quotaList.mockResolvedValue({ data: { users: [{ userId: 5 }] } })
    mocks.quotaSetLimit.mockResolvedValue({ data: {} })
    mocks.quotaClearLimit.mockResolvedValue({ data: {} })

    const host = createPluginUiHost({ ownerId: 7 })
    const users = await host.api.listQuotas('ai')
    await host.api.setQuota('ai', 5, 0)
    await host.api.setQuota('ai', 5, null)

    expect(mocks.quotaList).toHaveBeenCalledWith('ai', { signal: host.signal, sessionGuard: host.isCurrent })
    expect(users).toEqual([{ userId: 5 }])
    expect(mocks.quotaSetLimit).toHaveBeenCalledWith('ai', 5, 0, { signal: host.signal, sessionGuard: host.isCurrent })
    expect(mocks.quotaClearLimit).toHaveBeenCalledWith('ai', 5, { signal: host.signal, sessionGuard: host.isCurrent })
  })
})

describe('PluginUiHost 生命周期快照', () => {
  it('dispose 中止 signal 并令 isCurrent 恒为 false', () => {
    const host = createPluginUiHost({ ownerId: 7 })

    expect(host.ownerId).toBe(7)
    expect(host.isCurrent()).toBe(true)

    host.dispose()
    expect(host.signal.aborted).toBe(true)
    expect(host.isCurrent()).toBe(false)

    host.dispose()
    expect(host.signal.aborted).toBe(true)
  })

  it('会话 revision 变化后 isCurrent 为 false', () => {
    const host = createPluginUiHost({ ownerId: 7 })
    mocks.getSessionRevision.mockReturnValue(1)
    expect(host.isCurrent()).toBe(false)
  })

  it('client 凭据快照变化后 isCurrent 为 false', () => {
    const host = createPluginUiHost({ ownerId: 7 })
    mocks.getClientCredential.mockReturnValue('client-token-b')
    expect(host.isCurrent()).toBe(false)
  })

  it('会话属主（ownerId 快照）变化后 isCurrent 为 false', () => {
    mocks.getClientId.mockReturnValue(7)
    const host = createPluginUiHost({ ownerId: 7 })
    expect(host.isCurrent()).toBe(true)

    mocks.getClientId.mockReturnValue(8)
    expect(host.isCurrent()).toBe(false)
  })
})

describe('宿主组件无 AI 专属残留', () => {
  const hostFiles = [
    'views/Messages.vue',
    'views/Users.vue',
    'views/Clients.vue',
    'components/MessageDetailModal.vue'
  ]

  const forbiddenPatterns: Array<[RegExp, string]> = [
    [/example-?task/i, 'Example Task 模块标识'],
    [/aiTag(ger)?/i, 'AI Tag 工具/文案引用'],
    [/aiQuota/i, 'AI 配额文案或状态'],
    [/adminQuotaApi/, '管理员配额 API 直连'],
    [/messageJobsApi/, '插件任务 API 直连']
  ]

  it.each(hostFiles)('%s 不残留 AI 专属 import、字符串与样式', (relative) => {
    const content = fs.readFileSync(path.join(frontendRoot, relative), 'utf8')
    const violations = forbiddenPatterns
      .filter(([pattern]) => pattern.test(content))
      .map(([, label]) => label)
    expect(violations).toEqual([])
  })
})
