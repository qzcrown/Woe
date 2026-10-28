import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { defineComponent, h } from 'vue'

import type { Message, MessageJob, Plugin } from '@/types'

const http = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn()
}))


const catalogOverride = vi.hoisted(() => ({
  messageActions: null as null | readonly unknown[]
}))

vi.mock('@/plugins/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/plugins/catalog')>()
  return {
    ...actual,
    getPluginMessageActions: () =>
      catalogOverride.messageActions === null
        ? actual.getPluginMessageActions()
        : (catalogOverride.messageActions as never)
  }
})

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
import { useAlertProvider } from '@/composables/useAlert'
import { useConfirmDialogProvider } from '@/composables/useConfirmDialog'
import {
  MESSAGE_TAGS_EXTRAS_KEY,
  extractMessageTags
} from '@/utils/messageTags'
import {
  PLUGIN_JOB_POLL_INTERVAL_MS,
  PLUGIN_JOB_POLL_MAX_ATTEMPTS,
  createJobPoller
} from '@/utils/pluginJobPolling'

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


const NEUTRAL_PLUGIN: Plugin = {
  id: 9,
  name: 'Neutral Plugin',
  token: 'plugin-token',
  enabled: true,
  modulePath: 'builtin/neutral-widget',
  capabilities: ['messenger']
}


const LateUpdateSlot = defineComponent({
  props: {
    message: { type: Object, required: true },
    instances: { type: Array, default: () => [] },
    host: { type: Object, required: true }
  },
  emits: ['update-tags'],
  setup: () => () => h('div', { class: 'late-update-slot' })
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
    if (url === '/plugin') {
      return Promise.resolve({ data: [NEUTRAL_PLUGIN] })
    }
    if (url === '/message/1/jobs') {
      return Promise.resolve({ data: { messageDeleted: false, jobs: [] } })
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
  it('exposes the woe::tags extras key as a core constant', () => {
    expect(MESSAGE_TAGS_EXTRAS_KEY).toBe('woe::tags')
  })

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
  it('triggers a job with the plugin id in the body', async () => {
    http.post.mockResolvedValue({ data: { jobId: 11, status: 'pending' } })

    const response = await messageJobsApi.trigger(12, 34)

    expect(http.post).toHaveBeenCalledWith('/message/12/jobs', { pluginId: 34 })
    expect(response.data).toEqual({ jobId: 11, status: 'pending' })
  })

  it('forwards an abort signal to list and trigger requests', async () => {
    const controller = new AbortController()
    http.get.mockResolvedValue({ data: { messageDeleted: false, jobs: [] } })
    http.post.mockResolvedValue({ data: { jobId: 11, status: 'pending' } })

    await messageJobsApi.list(12, 34, { signal: controller.signal })
    await messageJobsApi.trigger(12, 34, { signal: controller.signal })

    expect(http.get).toHaveBeenCalledWith('/message/12/jobs', {
      params: { pluginId: 34 },
      signal: controller.signal
    })
    expect(http.post).toHaveBeenCalledWith('/message/12/jobs', { pluginId: 34 }, {
      signal: controller.signal
    })
  })
})

describe('createJobPoller', () => {
  it('stops after a successful job and reports the result', async () => {
    vi.useFakeTimers()
    const fetchJobs = vi
      .fn()
      .mockResolvedValueOnce({ messageDeleted: false, jobs: [job()] })
      .mockResolvedValueOnce({
        messageDeleted: false,
        jobs: [job({ status: 'success', result: { tags: ['alert'] }, completedAt: '2026-10-23T08:01:00Z' })]
      })
    const onUpdate = vi.fn()

    const poller = createJobPoller({ fetchJobs, onUpdate })
    poller.start()
    await vi.advanceTimersByTimeAsync(PLUGIN_JOB_POLL_INTERVAL_MS)
    await flushPromises()
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'pending' }))

    await vi.advanceTimersByTimeAsync(PLUGIN_JOB_POLL_INTERVAL_MS)
    await flushPromises()
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
      state: 'success',
      job: expect.objectContaining({ status: 'success' })
    }))

    await vi.advanceTimersByTimeAsync(PLUGIN_JOB_POLL_INTERVAL_MS * 5)
    await flushPromises()
    expect(fetchJobs).toHaveBeenCalledTimes(2)
  })

  it('stops on a failed job and exposes its error', async () => {
    vi.useFakeTimers()
    const failure = { code: 'limit-exceeded', message: 'quota exceeded' }
    const fetchJobs = vi.fn().mockResolvedValue({
      messageDeleted: false,
      jobs: [job({ status: 'failed', error: failure, completedAt: '2026-10-23T08:01:00Z' })]
    })
    const onUpdate = vi.fn()

    const poller = createJobPoller({ fetchJobs, onUpdate })
    poller.start()
    await vi.advanceTimersByTimeAsync(PLUGIN_JOB_POLL_INTERVAL_MS)
    await flushPromises()

    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
      state: 'failed',
      job: expect.objectContaining({ error: failure })
    }))
    await vi.advanceTimersByTimeAsync(PLUGIN_JOB_POLL_INTERVAL_MS * 3)
    expect(fetchJobs).toHaveBeenCalledTimes(1)
  })

  it('keeps polling pending jobs up to 30 attempts at a 2s interval by default', async () => {
    vi.useFakeTimers()
    expect(PLUGIN_JOB_POLL_INTERVAL_MS).toBe(2000)
    expect(PLUGIN_JOB_POLL_MAX_ATTEMPTS).toBe(30)

    const fetchJobs = vi.fn().mockResolvedValue({ messageDeleted: false, jobs: [job()] })
    const onUpdate = vi.fn()

    const poller = createJobPoller({ fetchJobs, onUpdate })
    poller.start()

    for (let attempt = 0; attempt < PLUGIN_JOB_POLL_MAX_ATTEMPTS; attempt += 1) {
      await vi.advanceTimersByTimeAsync(PLUGIN_JOB_POLL_INTERVAL_MS)
      await flushPromises()
    }
    expect(fetchJobs).toHaveBeenCalledTimes(PLUGIN_JOB_POLL_MAX_ATTEMPTS)

    await vi.advanceTimersByTimeAsync(PLUGIN_JOB_POLL_INTERVAL_MS)
    await flushPromises()
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'timeout' }))

    await vi.advanceTimersByTimeAsync(PLUGIN_JOB_POLL_INTERVAL_MS * 2)
    expect(fetchJobs).toHaveBeenCalledTimes(PLUGIN_JOB_POLL_MAX_ATTEMPTS)
  })

  it('stops polling when stop is called', async () => {
    vi.useFakeTimers()
    const fetchJobs = vi.fn().mockResolvedValue({ messageDeleted: false, jobs: [job()] })

    const poller = createJobPoller({ fetchJobs })
    poller.start()
    await vi.advanceTimersByTimeAsync(PLUGIN_JOB_POLL_INTERVAL_MS)
    await flushPromises()
    expect(fetchJobs).toHaveBeenCalledTimes(1)

    poller.stop()
    await vi.advanceTimersByTimeAsync(PLUGIN_JOB_POLL_INTERVAL_MS * 4)
    expect(fetchJobs).toHaveBeenCalledTimes(1)
  })
})

describe('MessageDetailModal 通用标签展示', () => {
  it('rebuilds visible tags when the modal switches to another message', async () => {
    const Provider = defineComponent({
      props: { message: { type: Object, required: true } },
      setup(props) {
        useAlertProvider()
        useConfirmDialogProvider()
        return () => h(MessageDetailModal, { message: props.message as Message })
      }
    })
    const wrapper = mount(Provider, {
      props: { message: baseMessage({ 'woe::tags': ['message-A-tag'] }) },
      global: { plugins: [createPinia(), i18n], stubs: { Teleport: true } }
    })
    await flushPromises()
    expect(wrapper.findAll('.tag-chip').map(chip => chip.text())).toEqual(['message-A-tag'])
    await wrapper.setProps({ message: { ...baseMessage({}), id: 2 } })
    expect(wrapper.find('.message-tags-section').exists()).toBe(false)
  })

  it('rebuilds visible tags from the next message and supports a same-id refresh', async () => {
    const Provider = defineComponent({
      props: { message: { type: Object, required: true } },
      setup(props) {
        useAlertProvider()
        useConfirmDialogProvider()
        return () => h(MessageDetailModal, { message: props.message as Message })
      }
    })
    const wrapper = mount(Provider, {
      props: { message: baseMessage({ 'woe::tags': ['message-A-tag'] }) },
      global: { plugins: [createPinia(), i18n], stubs: { Teleport: true } }
    })
    await flushPromises()
    await wrapper.setProps({ message: { ...baseMessage({ 'woe::tags': ['message-B-tag'] }), id: 2 } })
    expect(wrapper.findAll('.tag-chip').map(chip => chip.text())).toEqual(['message-B-tag'])
    await wrapper.setProps({ message: { ...baseMessage({ 'woe::tags': ['message-B-refresh'] }), id: 2 } })
    expect(wrapper.findAll('.tag-chip').map(chip => chip.text())).toEqual(['message-B-refresh'])
  })

  it('renders read-only tag chips from woe::tags', async () => {
    const wrapper = mountModal(baseMessage({ 'woe::tags': ['alert', 'deploy'] }))
    await flushPromises()

    expect(wrapper.find('.message-tags-section').exists()).toBe(true)
    expect(wrapper.findAll('.tag-chip').map(chip => chip.text())).toEqual(['alert', 'deploy'])
  })

  it('does not render the tag section without valid tags', async () => {
    const wrapper = mountModal(baseMessage({ 'woe::tags': 'alert' }))
    await flushPromises()

    expect(wrapper.find('.message-tags-section').exists()).toBe(false)
  })

  it('ignores a late tag update for the previous message after switching to B', async () => {

    catalogOverride.messageActions = [{ modulePath: 'test/late-update', component: LateUpdateSlot }]
    let wrapper: VueWrapper | undefined
    try {
      const Provider = defineComponent({
        props: { message: { type: Object, required: true } },
        setup(props) {
          useAlertProvider()
          useConfirmDialogProvider()
          return () => h(MessageDetailModal, { message: props.message as Message })
        }
      })
      wrapper = mount(Provider, {
        props: { message: baseMessage({ 'woe::tags': ['message-A-tag'] }) },
        global: { plugins: [createPinia(), i18n], stubs: { Teleport: true } }
      })
      wrappers.add(wrapper)
      const modal = wrapper.findComponent(MessageDetailModal)
      await flushPromises()
      expect(wrapper.findAll('.tag-chip').map(chip => chip.text())).toEqual(['message-A-tag'])

      await wrapper.setProps({ message: { ...baseMessage({ 'woe::tags': ['message-B-tag'] }), id: 2 } })
      await flushPromises()
      expect(wrapper.findAll('.tag-chip').map(chip => chip.text())).toEqual(['message-B-tag'])

      const slot = wrapper.findComponent(LateUpdateSlot)
      expect(slot.exists()).toBe(true)
      slot.vm.$emit('update-tags', { messageId: 1, tags: ['message-A-late'] })
      await flushPromises()
      expect(wrapper.findAll('.tag-chip').map(chip => chip.text())).toEqual(['message-B-tag'])
      expect(modal.emitted('tags-updated')).toBeUndefined()

      slot.vm.$emit('update-tags', { messageId: 2, tags: ['message-B-fresh'] })
      await flushPromises()
      expect(wrapper.findAll('.tag-chip').map(chip => chip.text())).toEqual(['message-B-fresh'])
      expect(modal.emitted('tags-updated')).toEqual([[{ id: 2, tags: ['message-B-fresh'] }]])
    } finally {
      wrapper?.unmount()
      if (wrapper) wrappers.delete(wrapper)
      catalogOverride.messageActions = null
    }
  })

  it('keeps the read-only display working when no plugin contributes message actions', async () => {

    catalogOverride.messageActions = []
    try {
      const wrapper = mountModal(baseMessage({ 'woe::tags': ['alert'] }))
      await flushPromises()

      expect(wrapper.find('.message-tags-section').exists()).toBe(true)
      expect(wrapper.findAll('.tag-chip').map(chip => chip.text())).toEqual(['alert'])
      expect(wrapper.find('.plugin-message-actions').exists()).toBe(false)
    } finally {
      catalogOverride.messageActions = null
    }
  })
})
