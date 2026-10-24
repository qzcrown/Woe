import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, type Component } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'



const hoisted = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
}))

vi.mock('axios', () => ({
  default: {
    create: () => ({
      post: hoisted.post,
      get: hoisted.get,
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
    }),
  },
}))

import { authService, AuthStrategy } from '@/services/auth'
import { messageApi } from '@/services/api'
import Applications from '@/views/Applications.vue'
import Clients from '@/views/Clients.vue'
import i18n from '@/locales'
import { useAlertProvider } from '@/composables/useAlert'
import { useConfirmDialogProvider } from '@/composables/useConfirmDialog'

describe('POST /message 认证策略（Gotify V3）', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    authService.setToken('client', 'client-token-abc')

    authService.setAppToken(7, 'app-token-xyz')
  })

  it('getAuthStrategy 对 POST /message 返回 client token 策略', () => {
    const authConfig = authService.getAuthStrategy('/message', 'POST', 7)
    expect(authConfig.strategy).toBe(AuthStrategy.CLIENT_TOKEN_HEADER)
    expect(authConfig.token).toBe('client-token-abc')
  })

  it('applyAuth 对 POST /message 注入 client token 而非 app token', () => {
    const config = authService.applyAuth({ url: '/message', method: 'post' }, '/message')
    expect(config.headers['X-Gotify-Key']).toBe('client-token-abc')
    expect(config.headers['X-Gotify-Key']).not.toBe('app-token-xyz')
  })
})

describe('createMessage 请求体（Gotify V3）', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    hoisted.post.mockResolvedValue({ data: { id: 1, message: 'hi' } })
  })

  it('createMessage 请求体包含 appid', async () => {
    await messageApi.createMessage(7, { message: 'hi', title: 't', priority: 1 })
    expect(hoisted.post).toHaveBeenCalledTimes(1)
    const [url, body] = hoisted.post.mock.calls[0]
    expect(url).toBe('/message')
    expect(body).toMatchObject({ message: 'hi', title: 't', priority: 1, appid: 7 })
  })

  it('createMessage 保留 extras 并携带 appid', async () => {
    const extras = { 'client::display': { contentType: 'text/markdown' } }
    await messageApi.createMessage(3, { message: 'hi', extras })
    const [, body] = hoisted.post.mock.calls[0]
    expect(body.appid).toBe(3)
    expect(body.extras).toEqual(extras)
  })
})





describe('列表视图不消费 GET token 字段（Gotify V3 show-once）', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    i18n.global.locale.value = 'en-US'

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  })

  const mountView = (component: Component) => {
    const pinia = createPinia()
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/:pathMatch(.*)*', component: defineComponent({ setup: () => () => h('div') }) }
      ]
    })


    const Provider = defineComponent({
      setup() {
        useConfirmDialogProvider()
        useAlertProvider()
        return () => h(component)
      }
    })
    return mount(Provider, {
      global: { plugins: [pinia, router, i18n] }
    })
  }

  it('Applications 列表不展示 GET token；无本地 token 时不占位，仅提供重新生成入口', async () => {
    const getToken = 'GET-app-token-should-not-display'
    hoisted.get.mockResolvedValue({
      data: [
        { id: 5, token: getToken, name: 'Demo', description: '', defaultPriority: 0, internal: false, lastUsed: '' }
      ]
    })
    const wrapper = mountView(Applications)
    await flushPromises()
    await flushPromises()

    const html = wrapper.html()
    expect(html).not.toContain(getToken)
    expect(html).not.toContain(`${getToken.substring(0, 8)}...${getToken.substring(getToken.length - 4)}`)
    expect(wrapper.find('.app-token').exists()).toBe(false)
    expect(wrapper.find('.regenerate-btn').exists()).toBe(true)
    expect(wrapper.find('.token-copy-btn').exists()).toBe(false)
  })

  it('Applications 列表不提供令牌展示/复制入口;本地已知 token 不进 DOM', async () => {


    const localToken = 'gtfya.AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    const serverPublicForm = 'gtfya.zswVB9wd3XKVlRwpCIjwla25BE0bc9aW5t8GXWg71Pw'
    authService.setAppToken(5, localToken)
    hoisted.get
      .mockResolvedValueOnce({
        data: [
          { id: 5, token: undefined, name: 'Demo', description: '', defaultPriority: 0, internal: false, lastUsed: '' }
        ]
      })
      .mockResolvedValueOnce({ data: { id: 5, token: serverPublicForm } })
    const wrapper = mountView(Applications)
    await flushPromises()
    await flushPromises()


    expect(wrapper.find('.app-token').exists()).toBe(false)
    expect(wrapper.find('.token-copy-btn').exists()).toBe(false)
    expect(wrapper.html()).not.toContain(localToken)
    expect(wrapper.html()).not.toContain(serverPublicForm)
    expect(wrapper.find('.regenerate-btn').exists()).toBe(true)
  })

  it('Clients 列表不展示 GET token，也不渲染 token 占位行', async () => {
    const getToken = 'GET-client-token-should-not-display'
    hoisted.get.mockResolvedValue({
      data: [{ id: 9, token: getToken, name: 'Dev Client' }]
    })
    const wrapper = mountView(Clients)
    await flushPromises()

    const html = wrapper.html()
    expect(html).not.toContain(getToken)
    expect(html).not.toContain(getToken.substring(0, 8))
    expect(wrapper.find('.client-token').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Token unavailable')
    expect(wrapper.find('.client-actions .copy-btn').exists()).toBe(false)
  })
})
