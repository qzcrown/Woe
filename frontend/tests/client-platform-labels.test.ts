import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { defineComponent, h } from 'vue'

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

vi.mock('@/components/Layout.vue', () => ({
  default: defineComponent({ name: 'Layout', template: '<div><slot /></div>' })
}))
vi.mock('@/components/LoadingSpinner.vue', () => ({
  default: defineComponent({
    name: 'LoadingSpinner',
    props: ['text', 'size', 'variant'],
    template: '<div class="loading-spinner-stub" />'
  })
}))

import i18n from '@/locales'
import Clients from '@/views/Clients.vue'
import { useAlertProvider } from '@/composables/useAlert'
import { useConfirmDialogProvider } from '@/composables/useConfirmDialog'
import type { Client } from '@/types'

const client = (id: number, platform?: string): Client => ({
  id,
  name: `Client ${id}`,
  token: 'token',
  platform,
  tokenStatus: 'active'
}) as Client

let wrapper: VueWrapper | null = null

const mountClients = async (): Promise<VueWrapper> => {
  const Provider = defineComponent({
    setup() {
      useAlertProvider()
      useConfirmDialogProvider()
      return () => h(Clients)
    }
  })
  wrapper = mount(Provider, {
    global: { plugins: [createPinia(), i18n] }
  })
  await flushPromises()
  return wrapper
}

const platformTexts = (view: VueWrapper) =>
  view.findAll('.platform-badge').map(badge => badge.text())

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  i18n.global.locale.value = 'en-US'
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.restoreAllMocks()
})

describe('Clients.vue 平台显示', () => {
  it('handles core web and unknown platforms without a package', async () => {
    http.get.mockResolvedValue({
      data: [client(1, 'web'), client(2, 'unknown')]
    })

    const view = await mountClients()

    expect(platformTexts(view)).toEqual(['Web', 'Unknown'])
  })

  it('renders the generic unavailable label for historical platforms of removed packages', async () => {
    http.get.mockResolvedValue({
      data: [client(1, 'symbian'), client(2)]
    })

    const view = await mountClients()

    expect(i18n.global.t('clients.platformUnavailable')).toBe('Unavailable')

    expect(platformTexts(view)).toEqual(['Unavailable', 'Unknown'])
  })
})
