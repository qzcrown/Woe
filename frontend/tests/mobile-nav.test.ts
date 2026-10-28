import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { defineComponent, h, nextTick } from 'vue'

vi.mock('@/services/websocket', () => ({
  wsService: { connect: vi.fn(), disconnect: vi.fn() },
}))

import Layout from '@/components/Layout.vue'
import i18n from '@/locales'
import { useAuthStore } from '@/stores/auth'

const adminUser = { id: 1, name: 'crown', nickname: 'crown', admin: true } as unknown as import('@/types').User
const plainUser = { id: 2, name: 'alice', nickname: 'alice', admin: false } as unknown as import('@/types').User

const navPaths = ['/', '/messages', '/applications', '/clients', '/plugins', '/users', '/settings']

const mountLayout = () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      ...navPaths.map((path) => ({ path, component: defineComponent({ render: () => h('div') }) })),
      { path: '/:pathMatch(.*)*', component: defineComponent({ render: () => h('div') }) },
    ],
  })

  const wrapper = mount(Layout, {
    attachTo: document.body,
    global: {
      plugins: [pinia, router, i18n],
      stubs: { EditProfileModal: { template: '<div />' } },
    },
  })
  return { wrapper, router }
}

const hamburger = (wrapper: ReturnType<typeof mount>) =>
  wrapper.find('.hamburger-btn')
const menuPanel = (wrapper: ReturnType<typeof mount>) =>
  wrapper.find('#mobile-menu')

beforeEach(() => {

  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    })
  }
  localStorage.clear()
  vi.clearAllMocks()
  i18n.global.locale.value = 'en-US'
})

describe('移动端导航折叠（汉堡菜单）', () => {
  it('初始收起：aria-expanded=false，面板无 open 类', async () => {
    const { wrapper } = mountLayout()
    useAuthStore().user = adminUser
    await flushPromises()
    expect(hamburger(wrapper).exists()).toBe(true)
    expect(hamburger(wrapper).attributes('aria-expanded')).toBe('false')
    expect(hamburger(wrapper).attributes('aria-controls')).toBe('mobile-menu')
    expect(menuPanel(wrapper).classes()).not.toContain('open')
    wrapper.unmount()
  })

  it('点击展开：aria-expanded=true、面板 open，含导航链接与语言/登出附加区', async () => {
    const { wrapper } = mountLayout()
    useAuthStore().user = adminUser
    await flushPromises()
    await hamburger(wrapper).trigger('click')
    expect(hamburger(wrapper).attributes('aria-expanded')).toBe('true')
    expect(menuPanel(wrapper).classes()).toContain('open')
    const links = menuPanel(wrapper).findAll('a.nav-item')
    expect(links).toHaveLength(navPaths.length)
    expect(links.map((l) => l.attributes('href'))).toEqual(navPaths)

    expect(menuPanel(wrapper).find('.mobile-extra .lang-btn').exists()).toBe(true)
    expect(menuPanel(wrapper).find('.mobile-profile').exists()).toBe(true)
    expect(menuPanel(wrapper).find('.mobile-extra .logout-btn').exists()).toBe(true)
    wrapper.unmount()
  })

  it('路由跳转后自动收起', async () => {
    const { wrapper, router } = mountLayout()
    useAuthStore().user = adminUser
    await flushPromises()
    await hamburger(wrapper).trigger('click')
    expect(menuPanel(wrapper).classes()).toContain('open')
    await router.push('/messages')
    await nextTick()
    expect(menuPanel(wrapper).classes()).not.toContain('open')
    expect(hamburger(wrapper).attributes('aria-expanded')).toBe('false')
    wrapper.unmount()
  })

  it('展开后焦点移入首个链接，Escape 收起并回焦汉堡', async () => {
    const { wrapper } = mountLayout()
    useAuthStore().user = adminUser
    await flushPromises()
    await hamburger(wrapper).trigger('click')
    await nextTick()
    expect(document.activeElement?.getAttribute('href')).toBe('/')

    expect(hamburger(wrapper).attributes('aria-label')).toBe('Close menu')
    await menuPanel(wrapper).trigger('keydown.escape')
    await nextTick()
    expect(menuPanel(wrapper).classes()).not.toContain('open')
    expect(hamburger(wrapper).attributes('aria-expanded')).toBe('false')
    expect(hamburger(wrapper).attributes('aria-label')).toBe('Open menu')
    expect(document.activeElement).toBe(hamburger(wrapper).element)
    wrapper.unmount()
  })

  it('点击当前路由的链接同样收起面板', async () => {
    const { wrapper } = mountLayout()
    useAuthStore().user = adminUser
    await flushPromises()
    await hamburger(wrapper).trigger('click')
    expect(menuPanel(wrapper).classes()).toContain('open')

    await menuPanel(wrapper).findAll('a.nav-item')[0].trigger('click')
    await nextTick()
    expect(menuPanel(wrapper).classes()).not.toContain('open')
    wrapper.unmount()
  })

  it('附加区语言切换生效', async () => {
    const { wrapper } = mountLayout()
    useAuthStore().user = adminUser
    await flushPromises()
    await hamburger(wrapper).trigger('click')
    await menuPanel(wrapper).find('.mobile-extra .lang-btn').trigger('click')
    await nextTick()
    expect(i18n.global.locale.value).toBe('zh-CN')
    wrapper.unmount()
  })

  it('非 admin：面板不含用户入口', async () => {
    const { wrapper } = mountLayout()
    useAuthStore().user = plainUser
    await flushPromises()
    await hamburger(wrapper).trigger('click')
    const hrefs = menuPanel(wrapper).findAll('a.nav-item').map((l) => l.attributes('href'))
    expect(hrefs).not.toContain('/users')
    expect(hrefs).toHaveLength(navPaths.length - 1)
    wrapper.unmount()
  })
})
