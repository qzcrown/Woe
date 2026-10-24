import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios'
import CryptoJS from 'crypto-js'




vi.mock('@/services/websocket', () => ({
  wsService: {
    connect: vi.fn(),
    disconnect: vi.fn(),
  },
}))

import { wsService } from '@/services/websocket'
import api, { authApi, logoutHttpClient } from '@/services/api'
import { authService } from '@/services/auth'
import { useAuthStore } from '@/stores/auth'
import Layout from '@/components/Layout.vue'
import i18n from '@/locales'


afterEach(() => {
  vi.restoreAllMocks()
})



interface CapturedRequest {
  config: InternalAxiosRequestConfig
  url: string
  method: string
  headers: Record<string, string>
  auth?: { username: string; password: string }
  data: any

  respond: (status: number, data?: unknown) => void

  fail: (error: AxiosError) => void
}


function installDeferredAdapter(instance: AxiosInstance): CapturedRequest[] {
  const queue: CapturedRequest[] = []
  instance.defaults.adapter = ((config: InternalAxiosRequestConfig) => {
    return new Promise((resolve, reject) => {
      queue.push({
        config,
        url: config.url ?? '',
        method: (config.method ?? 'get').toUpperCase(),
        headers: (config.headers ?? {}) as Record<string, string>,
        auth: config.auth,
        data: config.data,
        respond: (status: number, data: unknown = {}) => {
          const response = { data, status, statusText: String(status), headers: {}, config }
          if (status >= 200 && status < 300) {
            resolve(response as any)
          } else {
            reject(
              new AxiosError(
                `Request failed with status code ${status}`,
                status === 401 ? AxiosError.ERR_BAD_REQUEST : undefined,
                config,
                undefined,
                response as any
              )
            )
          }
        },
        fail: (error: AxiosError) => reject(error),
      })
    })
  }) as any
  return queue
}

const failWithNetwork = (req: CapturedRequest) =>
  req.fail(new AxiosError('Network Error', undefined, req.config))

const failWithTimeout = (req: CapturedRequest) =>
  req.fail(new AxiosError('timeout of 10000ms exceeded', AxiosError.ECONNABORTED, req.config))


const takeRequest = async (queue: CapturedRequest[]): Promise<CapturedRequest> => {
  for (let i = 0; i < 500 && queue.length === 0; i++) {
    await Promise.resolve()
  }
  const req = queue.shift()
  if (!req) throw new Error('expected a dispatched HTTP request but none was captured')
  return req
}

const expectNoRequest = async (queue: CapturedRequest[]) => {
  for (let i = 0; i < 500; i++) await Promise.resolve()
  expect(queue.length).toBe(0)
}


const installLocationStub = () => {
  const stub = {
    href: 'http://localhost/',
    origin: 'http://localhost',
    protocol: 'http:',
    host: 'localhost',
    pathname: '/',
    assign: vi.fn(),
    replace: vi.fn(),
  }
  Object.defineProperty(window, 'location', { configurable: true, writable: true, value: stub })
  return stub
}



const userA = { id: 1, name: 'alice', nickname: 'Alice', email: 'a@x.test', admin: true, disabled: false }
const clientA = { id: 11, token: 'client-token-A' }






const writeCorruptClientTokenStorage = (token: unknown) => {
  const payload = JSON.stringify({
    token,
    type: 'client',
    expires: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    lastUsed: new Date().toISOString(),
  })
  localStorage.setItem('woe_auth_client_token', CryptoJS.AES.encrypt(payload, 'woe-default-key').toString())
}





const writeCorruptExpiresClientTokenStorage = (expires: unknown) => {
  const payload = JSON.stringify({
    token: 'client-token-valid',
    type: 'client',
    expires,
    lastUsed: new Date().toISOString(),
  })
  localStorage.setItem('woe_auth_client_token', CryptoJS.AES.encrypt(payload, 'woe-default-key').toString())
}


const loginAs = async (queue: CapturedRequest[], username: string, user: unknown, client: { id: number; token: string }) => {
  const store = useAuthStore()
  const pending = store.login(username, 'password')
  const userReq = await takeRequest(queue)
  expect(userReq.url).toBe('/current/user')
  userReq.respond(200, user)
  const clientReq = await takeRequest(queue)
  expect(clientReq.url).toBe('/client')
  clientReq.respond(200, client)
  await expect(pending).resolves.toBe(true)
  return store
}



let apiQueue: CapturedRequest[]
let logoutQueue: CapturedRequest[]
let locationStub: ReturnType<typeof installLocationStub>

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  setActivePinia(createPinia())
  apiQueue = installDeferredAdapter(api)
  logoutQueue = installDeferredAdapter(logoutHttpClient)
  locationStub = installLocationStub()
})

describe('Web 登录与显式登出(凭据快照吊销)', () => {
  it('登录 POST /client 传 expiresAfterInactivitySeconds=604800 并保存响应 token;登出保留 woe_device_uid', async () => {
    const store = useAuthStore()
    const pending = store.login('alice', 'password')

    const userReq = await takeRequest(apiQueue)
    expect(userReq.url).toBe('/current/user')
    expect(userReq.auth).toEqual({ username: 'alice', password: 'password' })
    userReq.respond(200, userA)

    const clientReq = await takeRequest(apiQueue)
    expect(clientReq.url).toBe('/client')
    expect(clientReq.method).toBe('POST')
    expect(clientReq.auth).toEqual({ username: 'alice', password: 'password' })
    const body = JSON.parse(clientReq.data as string)
    expect(body.expiresAfterInactivitySeconds).toBe(604800)
    expect(body.platform).toBe('web')
    const deviceUid = localStorage.getItem('woe_device_uid')
    expect(deviceUid).toBeTruthy()
    expect(body.deviceUid).toBe(deviceUid)
    clientReq.respond(200, clientA)

    await expect(pending).resolves.toBe(true)
    expect(authService.getToken('client')?.token).toBe('client-token-A')
    expect(authService.getClientId()).toBe(11)
    expect(store.user).toEqual(userA)
    expect(wsService.connect).toHaveBeenCalledWith('client-token-A')

    const logoutPromise = store.logout()
    const revokeReq = await takeRequest(logoutQueue)
    revokeReq.respond(200, {})
    await expect(logoutPromise).resolves.toBe('confirmed')

    expect(localStorage.getItem('woe_device_uid')).toBe(deviceUid)
  })

  it('吊销请求等待中:本地认证已清、本机 WS 已断,调用方可立即进入登录页(不等网络)', async () => {
    const store = await loginAs(apiQueue, 'alice', userA, clientA)

    const logoutPromise = store.logout()

    expect(authService.getToken('client')).toBeNull()
    expect(authService.getClientId()).toBeNull()
    expect(store.authenticated).toBe(false)
    expect(store.user).toBeNull()
    expect(wsService.disconnect).toHaveBeenCalledTimes(1)


    const revokeReq = await takeRequest(logoutQueue)
    expect(revokeReq.url).toBe('/auth/logout')
    expect(revokeReq.method).toBe('POST')
    expect(revokeReq.headers['X-Gotify-Key']).toBe('client-token-A')

    revokeReq.respond(200, {})
    await expect(logoutPromise).resolves.toBe('confirmed')
  })

  it('无凭据登出返回 no-credential 且不发请求;重复点击不重复发请求(幂等)', async () => {
    const store = useAuthStore()
    await expect(store.logout()).resolves.toBe('no-credential')
    await expectNoRequest(logoutQueue)


    await loginAs(apiQueue, 'alice', userA, clientA)
    const first = store.logout()
    const second = await store.logout()
    expect(second).toBe('no-credential')
    const revokeReq = await takeRequest(logoutQueue)
    revokeReq.respond(200, {})
    await expect(first).resolves.toBe('confirmed')
    await expectNoRequest(logoutQueue)
  })

  it('本地期限已过但 token 仍存:仍尝试吊销(服务端为权威,前端存储期限不是凭据期限)', async () => {
    authService.setToken('client', 'locally-expired-token', new Date(Date.now() - 60_000))
    const store = useAuthStore()
    const logoutPromise = store.logout()
    const revokeReq = await takeRequest(logoutQueue)
    expect(revokeReq.headers['X-Gotify-Key']).toBe('locally-expired-token')
    revokeReq.respond(200, {})
    await expect(logoutPromise).resolves.toBe('confirmed')
  })

  it('损坏存储按无凭据处理:不发请求', async () => {
    localStorage.setItem('woe_auth_client_token', '%%%corrupt-not-ciphertext%%%')
    const store = useAuthStore()
    await expect(store.logout()).resolves.toBe('no-credential')
    await expectNoRequest(logoutQueue)
  })

  it.each([
    ['token 为对象', {}],
    ['token 为空串', ''],
    ['token 为 null', null],
  ])('可解析但结构损坏的存储(%s):getter 视为无凭据、isTokenValid 为 false、登出不发请求', async (_name, corruptToken) => {
    writeCorruptClientTokenStorage(corruptToken)



    expect(authService.getClientCredentialForRevocation()).toBeNull()
    expect(authService.isTokenValid('client')).toBe(false)


    const store = useAuthStore()
    await expect(store.logout()).resolves.toBe('no-credential')
    await expectNoRequest(logoutQueue)
  })

  it.each([
    ['expires 不可转换(toString 为 null)', { toString: null }],
    ['expires 为对象(Invalid Date)', {}],
  ])('期限字段损坏的存储(%s):getToken 不抛错、清除凭据返回 null;吊销 getter 不受期限影响', (_name, corruptExpires) => {
    writeCorruptExpiresClientTokenStorage(corruptExpires)



    expect(authService.getClientCredentialForRevocation()).toBe('client-token-valid')



    expect(() => authService.getToken('client')).not.toThrow()
    expect(authService.getToken('client')).toBeNull()
    expect(localStorage.getItem('woe_auth_client_token')).toBeNull()
    expect(authService.isTokenValid('client')).toBe(false)
  })

  it.each([
    ['网络错误', (req: CapturedRequest) => failWithNetwork(req)],
    ['超时', (req: CapturedRequest) => failWithTimeout(req)],
    ['服务端 500', (req: CapturedRequest) => req.respond(500, { error: 'Failed to logout' })],
  ])('吊销失败(%s):本地退出仍完成,结果为 not-confirmed', async (_name, fail) => {
    const store = await loginAs(apiQueue, 'alice', userA, clientA)
    const logoutPromise = store.logout()
    const revokeReq = await takeRequest(logoutQueue)
    fail(revokeReq)
    await expect(logoutPromise).resolves.toBe('not-confirmed')
    expect(authService.getToken('client')).toBeNull()
    expect(store.user).toBeNull()
    expect(store.authenticated).toBe(false)
    expect(wsService.disconnect).toHaveBeenCalledTimes(1)
  })

  it('吊销 401 → already-unusable(此次认证被拒,不能当作服务端已删除凭据)', async () => {
    const store = await loginAs(apiQueue, 'alice', userA, clientA)
    const logoutPromise = store.logout()
    const revokeReq = await takeRequest(logoutQueue)
    revokeReq.respond(401, { error: 'unauthorized' })
    await expect(logoutPromise).resolves.toBe('already-unusable')

    expect(authService.getToken('client')).toBeNull()
    expect(store.authenticated).toBe(false)
  })
})

describe('独立吊销 HTTP 客户端', () => {
  it('派发前全局 token 已换为 B:发送 header 仍是捕获的 A token,且不带 Basic/app token', async () => {

    authService.setToken('client', 'client-token-B')
    authService.setAppToken(7, 'app-token-xyz')

    const pending = authApi.logout('captured-token-A')
    const req = await takeRequest(logoutQueue)
    expect(req.url).toBe('/auth/logout')
    expect(req.method).toBe('POST')
    expect(req.headers['X-Gotify-Key']).toBe('captured-token-A')
    expect(req.headers['X-Gotify-Key']).not.toBe('client-token-B')
    expect(req.headers['Authorization']).toBeUndefined()
    expect(req.auth).toBeUndefined()

    req.respond(200, {})
    await expect(pending).resolves.toBeTruthy()

    expect(authService.getToken('client')?.token).toBe('client-token-B')
  })
})

describe('Layout 登出按钮', () => {
  it('点击后立即导航 /login(不等网络);吊销失败仅告警且不宣称服务端已删除凭据', async () => {
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
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const pinia = createPinia()
    setActivePinia(pinia)
    authService.setToken('client', 'client-token-A')
    const store = useAuthStore()
    store.user = userA as any

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', component: defineComponent({ setup: () => () => h('div') }) },
        { path: '/', component: defineComponent({ setup: () => () => h('div') }) },
      ],
    })
    const wrapper = mount(Layout, { global: { plugins: [pinia, router, i18n] } })

    await wrapper.find('.logout-btn').trigger('click')
    await flushPromises()


    expect(authService.getToken('client')).toBeNull()
    expect(router.currentRoute.value.path).toBe('/login')

    const revokeReq = await takeRequest(logoutQueue)
    revokeReq.respond(500, { error: 'Failed to logout' })
    await flushPromises()


    expect(warnSpy).toHaveBeenCalled()
    const message = warnSpy.mock.calls.map((c) => String(c[0])).join(' ')
    expect(message).toContain('not confirmed')
    expect(message).not.toMatch(/deleted|已删除/i)
    warnSpy.mockRestore()
  })
})
