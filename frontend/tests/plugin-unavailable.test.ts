import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { defineComponent, h } from 'vue'

const mocks = vi.hoisted(() => ({
  getPlugins: vi.fn(),
  getConfig: vi.fn(),
  getLogs: vi.fn(),
  getDisplay: vi.fn(),
  getUsers: vi.fn(),
  getUserApplications: vi.fn(),
  getUserClients: vi.fn(),
  getUserPlugins: vi.fn(),
  getPluginPermissions: vi.fn(),
  getAvailablePlugins: vi.fn(),
}))

vi.mock('@/services/api', () => ({
  pluginApi: {
    getPlugins: mocks.getPlugins,
    getConfig: mocks.getConfig,
    updateConfig: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    getDisplay: mocks.getDisplay,
    getLogs: mocks.getLogs,
    getAvailablePlugins: mocks.getAvailablePlugins,
  },
  userApi: {
    getUsers: mocks.getUsers,
    getUserApplications: mocks.getUserApplications,
    getUserClients: mocks.getUserClients,
    getUserPlugins: mocks.getUserPlugins,
    getPluginPermissions: mocks.getPluginPermissions,
  },
  authApi: { login: vi.fn(), getCurrentUser: vi.fn(), logout: vi.fn() },
  clientApi: { createClient: vi.fn(), elevateClient: vi.fn() },
}))
vi.mock('@/services/websocket', () => ({
  wsService: { connect: vi.fn(), disconnect: vi.fn() },
}))
vi.mock('@/services/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/auth')>()
  return {
    ...actual,
    withElevationRetry: async <T>(fn: () => Promise<T>) => fn(),
  }
})

import PluginDetail from '@/views/PluginDetail.vue'
import Users from '@/views/Users.vue'
import i18n from '@/locales'
import { useAuthStore } from '@/stores/auth'
import { useConfirmDialogProvider } from '@/composables/useConfirmDialog'
import type { Plugin, User } from '@/types'


const ghostPlugin: Plugin = {
  id: 5,
  name: 'Ghost Instance',
  token: 'P-ghost',
  enabled: false,
  modulePath: 'builtin/removed-plugin',
  icon: undefined,
  capabilities: [],
  author: '',
  license: '',
  website: '',
  configExample: '',
  availability: 'unavailable',
}

const adminUser = { id: 1, name: 'crown', admin: true } as unknown as User

function stubs() {
  return {
    Layout: { template: '<div><slot /></div>' },
    PluginIcon: { template: '<div class="plugin-icon-stub" />' },
    UserAvatar: { template: '<div class="avatar-stub" />' },
  }
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  i18n.global.locale.value = 'en-US'
  mocks.getLogs.mockResolvedValue({ data: [] })
  mocks.getAvailablePlugins.mockResolvedValue({ data: [] })
})

describe('PluginDetail：未知模块 availability 锁定', () => {
  const mountDetail = async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().user = adminUser
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/plugin/:id', component: PluginDetail }],
    })
    router.push('/plugin/5')
    await router.isReady()
    mocks.getPlugins.mockResolvedValue({ data: [ghostPlugin] })

    mocks.getConfig.mockRejectedValue(
      Object.assign(new Error('conflict'), { statusCode: 409, errorCode: 'plugin-unavailable' })
    )
    const wrapper = mount(PluginDetail, { global: { plugins: [pinia, router, i18n], stubs: stubs() } })
    await flushPromises()
    return wrapper
  }

  it('显示模块不可用提示，enable 按钮禁用（disable 保持可用不受此场景影响）', async () => {
    const wrapper = await mountDetail()

    expect(wrapper.text()).toContain('Module unavailable')
    expect(wrapper.text()).toContain('no longer installed')

    const enableBtn = wrapper.find('button.toggle-btn')
    expect(enableBtn.exists()).toBe(true)
    expect((enableBtn.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('配置区锁定：不出现 Edit 按钮，也不请求 display', async () => {
    const wrapper = await mountDetail()

    const editBtn = wrapper.find('button.edit-btn')
    expect(editBtn.exists()).toBe(false)

    expect(mocks.getDisplay).not.toHaveBeenCalled()
  })
})

describe('Users：未知模块实例徽标', () => {
  it('用户插件列表为 unavailable 实例展示模块不可用标记', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().user = adminUser
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/users', component: defineComponent({ render: () => h('div') }) },
        { path: '/:pathMatch(.*)*', component: defineComponent({ render: () => h('div') }) },
      ],
    })
    mocks.getUsers.mockResolvedValue({ data: [{ id: 2, name: 'alice', admin: false, disabled: false }] })
    mocks.getUserApplications.mockResolvedValue({ data: [] })
    mocks.getUserClients.mockResolvedValue({ data: [] })
    mocks.getUserPlugins.mockResolvedValue({ data: [ghostPlugin] })
    mocks.getPluginPermissions.mockResolvedValue({ data: [] })


    const Host = defineComponent({
      setup() {
        useConfirmDialogProvider()
        return () => h(Users)
      },
    })
    const wrapper = mount(Host, { global: { plugins: [pinia, router, i18n], stubs: stubs() } })
    await flushPromises()


    await wrapper.find('button.toggle-btn').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Ghost Instance')
    expect(wrapper.text()).toContain('Module unavailable')
  })
})
