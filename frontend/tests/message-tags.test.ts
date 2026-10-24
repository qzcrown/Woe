import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { defineComponent, h } from 'vue'

import type { Message, MessageJob } from '@/types'

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
import MessageDetailModal from '@/components/MessageDetailModal.vue'
import { messageJobsApi } from '@/services/api'
import { authService, AuthStrategy } from '@/services/auth'
import { useAlertProvider } from '@/composables/useAlert'
import { useConfirmDialogProvider } from '@/composables/useConfirmDialog'
import { extractMessageTags } from '@/utils/messageTags'

const baseMessage = (extras?: Record<string, unknown>): Message => ({
  id: 1,
  appid: 1,
  title: 'Alert',
  message: 'Deploy finished',
  date: '2026-10-23T08:00:00Z',
  priority: 1,
  extras
})

const job = (overrides: Partial<MessageJob> = {}): MessageJob => ({
  jobId: 11,
  pluginId: 9,
  status: 'pending',
  result: null,
  error: null,
  createdAt: '2026-10-23T08:00:00Z',
  completedAt: null,
  ...overrides
})

const wrappers = new Set<VueWrapper>()

const mountModal = (message: Message) => {
  const Provider = defineComponent({
    setup() {
      useAlertProvider()
      useConfirmDialogProvider()
      return () => h(MessageDetailModal, { message })
    }
  })
  const wrapper = mount(Provider, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: { Teleport: true }
    }
  })
  wrappers.add(wrapper)
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  i18n.global.locale.value = 'en-US'
  http.get.mockImplementation((url: string) => {
    if (url === '/application/1') {
      return Promise.resolve({ data: { id: 1, name: 'App', description: '', sortKey: '', image: '', internal: false } })
    }
    return Promise.resolve({ data: [] })
  })
})

afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('extractMessageTags', () => {
  it('returns the string array stored under woe::tags', () => {
    expect(extractMessageTags({ 'woe::tags': ['alert', 'deploy'] })).toEqual(['alert', 'deploy'])
  })

  it('hides missing, non-array and mixed-type values without throwing', () => {
    expect(extractMessageTags(undefined)).toEqual([])
    expect(extractMessageTags({})).toEqual([])
    expect(extractMessageTags({ 'woe::tags': 'alert' })).toEqual([])
    expect(extractMessageTags({ 'woe::tags': { 0: 'alert' } })).toEqual([])
    expect(extractMessageTags({ 'woe::tags': ['alert', 1] })).toEqual([])
    expect(extractMessageTags({ 'woe::tags': ['alert', null] })).toEqual([])
    expect(extractMessageTags({ 'woe::tags': ['alert', ''] })).toEqual([])
    expect(extractMessageTags({ 'woe::tags': [] })).toEqual([])
  })
})

describe('messageJobsApi', () => {
  it('uses the client token strategy for both root and /api/v1 prefixes', () => {
    authService.setToken('client', 'client-token')

    expect(authService.getAuthStrategy('/message/12/jobs', 'POST').strategy)
      .toBe(AuthStrategy.CLIENT_TOKEN_HEADER)
    expect(authService.getAuthStrategy('/message/12/jobs', 'GET').strategy)
      .toBe(AuthStrategy.CLIENT_TOKEN_HEADER)

    const config = authService.applyAuth(
      { url: '/api/v1/message/12/jobs', method: 'post' },
      '/api/v1/message/12/jobs'
    )
    expect(config.headers['X-Gotify-Key']).toBe('client-token')
  })

  it('triggers a job with the plugin id in the body', async () => {
    http.post.mockResolvedValue({ data: { jobId: 11, status: 'pending' } })

    const response = await messageJobsApi.trigger(12, 34)

    expect(http.post).toHaveBeenCalledWith('/message/12/jobs', { pluginId: 34 })
    expect(response.data).toEqual({ jobId: 11, status: 'pending' })
  })

  it('lists jobs and keeps messageDeleted', async () => {
    const payload = {
      messageDeleted: true,
      jobs: [job({ status: 'success', result: { tags: ['alert'] }, completedAt: '2026-10-23T08:01:00Z' })]
    }
    http.get.mockResolvedValue({ data: payload })

    const response = await messageJobsApi.list(12, 34)

    expect(http.get).toHaveBeenCalledWith('/message/12/jobs', { params: { pluginId: 34 } })
    expect(response.data).toEqual(payload)
  })
})

describe('MessageDetailModal message tags', () => {
  it('renders read-only tag chips from woe::tags', async () => {
    const wrapper = mountModal(baseMessage({ 'woe::tags': ['alert', 'deploy'] }))
    await flushPromises()

    expect(wrapper.find('.message-tags-section').exists()).toBe(true)
    expect(wrapper.findAll('.message-tag-chip').map(chip => chip.text())).toEqual(['alert', 'deploy'])
  })

  it('does not render the tag section without valid tags', async () => {
    const wrapper = mountModal(baseMessage({ 'woe::tags': 'alert' }))
    await flushPromises()

    expect(wrapper.find('.message-tags-section').exists()).toBe(false)
    expect(wrapper.find('.ai-tag-panel').exists()).toBe(false)
  })

  it('does not discover plugins or start tasks, including after unmount with an application request pending', async () => {
    let resolveApplication!: (value: unknown) => void
    http.get.mockImplementation(() => new Promise(resolve => { resolveApplication = resolve }))
    const wrapper = mountModal(baseMessage())
    await flushPromises()
    expect(http.get.mock.calls.map(([url]) => url)).toEqual(['/application/1'])
    wrapper.unmount()
    wrappers.delete(wrapper)
    resolveApplication({ data: { id: 1, name: 'Late application' } })
    await flushPromises()
    expect(http.get.mock.calls.map(([url]) => url)).toEqual(['/application/1'])
    expect(http.post).not.toHaveBeenCalled()
  })
})
