import { describe, it, expect, afterEach, vi } from 'vitest'











vi.mock('@/services/api', () => ({
  default: {
    get: vi.fn(async () => ({
      data: { initialized: true, hasAdmin: true, canInitialize: false },
    })),
  },
}))


const authState = vi.hoisted(() => ({
  user: null as { admin: boolean } | null,
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    isAuthenticated: true,
    get user() {
      return authState.user
    },
    checkAuth: vi.fn(async () => true),
  }),
}))







async function loadRouter(baseUrl: string, pathname: string) {
  vi.resetModules()
  vi.stubEnv('BASE_URL', baseUrl)
  window.history.replaceState(null, '', pathname)
  const { default: router } = await import('@/router')
  return router
}

afterEach(() => {
  vi.unstubAllEnvs()
  window.history.replaceState(null, '', '/')
})

describe('路由 history base 与部署 base 对齐', () => {
  it('根路径部署(BASE_URL=/):深链 /applications/5 的应用内路径与 href 均为 /applications/5', async () => {
    const router = await loadRouter('/', '/applications/5')


    expect(router.options.history.location).toBe('/applications/5')

    const resolved = router.resolve({ name: 'ApplicationDetail', params: { id: '5' } })
    expect(resolved.name).toBe('ApplicationDetail')
    expect(resolved.href).toBe('/applications/5')
  })

  it('代理子路径部署(BASE_URL=/proxy/):深链 /proxy/applications/5 剥离 base 后为 /applications/5', async () => {
    const router = await loadRouter('/proxy/', '/proxy/applications/5')

    expect(router.options.history.location).toBe('/applications/5')

    const resolved = router.resolve({ name: 'ApplicationDetail', params: { id: '5' } })
    expect(resolved.name).toBe('ApplicationDetail')
    expect(resolved.href).toBe('/proxy/applications/5')
  })

  it('代理子路径部署:href 不重复拼接 proxy 前缀', async () => {
    const router = await loadRouter('/proxy/', '/proxy/applications/5')

    const resolved = router.resolve({ name: 'ApplicationDetail', params: { id: '5' } })
    expect(resolved.href).not.toContain('/proxy/proxy')
    expect(resolved.href).not.toContain('proxy/proxy')
  })
})

describe('404 兜底路由', () => {
  it('未知路径 resolve 到 NotFound', async () => {
    const router = await loadRouter('/', '/no/such/page')

    expect(router.resolve('/no/such/page').name).toBe('NotFound')
  })

  it('深层未知路径同样命中兜底', async () => {
    const router = await loadRouter('/', '/applications/5/unknown/deeper')

    expect(router.resolve('/applications/5/unknown/deeper').name).toBe('NotFound')
  })
})

describe('/users admin 守卫', () => {
  it('/users 路由声明 requiresAdmin', async () => {
    const router = await loadRouter('/', '/users')

    expect(router.resolve('/users').meta.requiresAdmin).toBe(true)
  })



  it('非 admin 导航 /users 重定向回首页', { timeout: 15000 }, async () => {
    authState.user = { admin: false }
    const router = await loadRouter('/', '/')

    await router.push('/users')
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('user 未水合时守卫先 checkAuth 再判定（刷新直达场景）', async () => {
    authState.user = null
    const router = await loadRouter('/', '/')

    await router.push('/users')

    expect(router.currentRoute.value.path).toBe('/')
  })

  it('admin 导航 /users 放行', { timeout: 15000 }, async () => {
    authState.user = { admin: true }
    const router = await loadRouter('/', '/')

    await router.push('/users')
    expect(router.currentRoute.value.name).toBe('Users')
  })
})
