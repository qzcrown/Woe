import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { defineComponent, h } from 'vue'

const mocks = vi.hoisted(() => ({ getPlugins: vi.fn() }))
vi.mock('@/services/api', () => ({

  pluginApi: { getPlugins: mocks.getPlugins, enable: vi.fn(), disable: vi.fn() },
  authApi: { login: vi.fn(), getCurrentUser: vi.fn(), logout: vi.fn() },
  clientApi: { createClient: vi.fn(), elevateClient: vi.fn() },
}))
vi.mock('@/services/websocket', () => ({
  wsService: { connect: vi.fn(), disconnect: vi.fn() },
}))

import Plugins from '@/views/Plugins.vue'
import i18n from '@/locales'
import { useAuthStore } from '@/stores/auth'
import type { User } from '@/types'

const mountPlugins = () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/users', component: defineComponent({ render: () => h('div') }) },
      { path: '/:pathMatch(.*)*', component: defineComponent({ render: () => h('div') }) },
    ],
  })
  return mount(Plugins, {
    global: {
      plugins: [pinia, router, i18n],
      stubs: {
        Layout: { template: '<div><slot /></div>' },

        PluginIcon: { template: '<div class="plugin-icon-stub" />' },
      },
    },
  })
}

const adminUser = { id: 1, name: 'crown', admin: true } as unknown as User
const plainUser = { id: 2, name: 'alice', admin: false } as unknown as User

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  i18n.global.locale.value = 'en-US'
  mocks.getPlugins.mockResolvedValue({ data: [] })
})

describe('Plugins 空态按角色分流', () => {
  it('admin：给出去用户页添加的入口与面向管理员的指引，不再外链 gotify 文档', async () => {
    const wrapper = mountPlugins()
    useAuthStore().user = adminUser
    await flushPromises()
    expect(wrapper.text()).toContain('Plugins are assigned per user from the Users page')
    const link = wrapper.find('.empty-action-btn')
    expect(link.exists()).toBe(true)
    expect(link.text()).toBe('Add Plugins in Users')
    expect(link.attributes('href')).toContain('/users')
    expect(wrapper.html()).not.toContain('gotify.net')
    wrapper.unmount()
  })

  it('普通用户：只提示联系管理员，无任何操作入口', async () => {
    const wrapper = mountPlugins()
    useAuthStore().user = plainUser
    await flushPromises()
    expect(wrapper.text()).toContain('You do not have any plugins yet')
    expect(wrapper.find('.empty-action-btn').exists()).toBe(false)
    expect(wrapper.html()).not.toContain('gotify.net')
    wrapper.unmount()
  })

  it('已有插件实例时不渲染空态', async () => {

    mocks.getPlugins.mockResolvedValue({ data: [{ id: 1, name: 'Example Task', enabled: true }] })
    const wrapper = mountPlugins()
    useAuthStore().user = adminUser
    await flushPromises()
    expect(wrapper.text()).not.toContain('Add Plugins in Users')
    expect(wrapper.find('.plugin-card').exists()).toBe(true)
    wrapper.unmount()
  })
})
