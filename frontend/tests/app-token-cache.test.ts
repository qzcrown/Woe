import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import CryptoJS from 'crypto-js'
import { authService, appTokenStorageKey, clientTokenStorageKey, parseAppTokenStorageKey } from '@/services/auth'





const APP_KEY = 'woe_auth_app_1_token'

const ENCRYPTION_KEY = 'woe-default-key'

const storePayload = (payload: unknown): string => {
  const encrypted = CryptoJS.AES.encrypt(JSON.stringify(payload), ENCRYPTION_KEY).toString()
  localStorage.setItem(APP_KEY, encrypted)
  return encrypted
}

describe('getAppToken 结构加固(既有 getter 语义:损坏→清除存储→null)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('合法存储值照常返回(既有行为保留)', () => {
    authService.setAppToken(1, 'A-app-token')
    const info = authService.getAppToken(1)
    expect(info).not.toBeNull()
    expect(info!.token).toBe('A-app-token')
    expect(info!.type).toBe('app')
  })

  it('无 expires 字段的合法结构照常返回', () => {
    storePayload({ token: 'legacy-tok', type: 'app' })
    expect(authService.getAppToken(1)?.token).toBe('legacy-tok')
  })

  it('损坏密文 → null 且清除存储', () => {
    localStorage.setItem(APP_KEY, '%%%corrupt-not-ciphertext%%%')
    expect(authService.getAppToken(1)).toBeNull()
    expect(localStorage.getItem(APP_KEY)).toBeNull()
  })

  it('损坏 JSON(可解密但不可解析)→ null 且清除存储', () => {
    localStorage.setItem(APP_KEY, CryptoJS.AES.encrypt('not-json{{', ENCRYPTION_KEY).toString())
    expect(authService.getAppToken(1)).toBeNull()
    expect(localStorage.getItem(APP_KEY)).toBeNull()
  })

  it.each([
    ['token 缺失', { type: 'app', expires: new Date(Date.now() + 86400_000).toISOString() }],
    ['token 为数字', { token: 123, type: 'app' }],
    ['token 为空串', { token: '', type: 'app' }],
    ['token 为对象', { token: { v: 1 }, type: 'app' }],
    ["type 不是 'app'", { token: 'x', type: 'client' }],
    ['type 缺失', { token: 'x' }],
  ])('结构损坏:%s → null 且清除存储(旧实现会原样返回)', (_name, payload) => {
    storePayload(payload)
    expect(authService.getAppToken(1)).toBeNull()
    expect(localStorage.getItem(APP_KEY)).toBeNull()
  })

  it.each([
    ['已过期', { token: 'x', type: 'app', expires: new Date(Date.now() - 1000).toISOString() }],
    ['Invalid Date 字符串', { token: 'x', type: 'app', expires: 'not-a-date' }],
    ['Invalid Date 对象', { token: 'x', type: 'app', expires: {} }],
    ['expires 数字 0', { token: 'x', type: 'app', expires: 0 }],
  ])('期限损坏:%s → null 且清除存储(旧实现对 Invalid Date 会原样返回)', (_name, payload) => {
    storePayload(payload)
    expect(authService.getAppToken(1)).toBeNull()
    expect(localStorage.getItem(APP_KEY)).toBeNull()
  })

  it('setAppToken 仍写原存储键并带默认 30 天本地期限', () => {
    authService.setAppToken(1, 'gtfya.PRIVATE')
    const raw = localStorage.getItem(APP_KEY)
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(
      CryptoJS.AES.decrypt(raw!, ENCRYPTION_KEY).toString(CryptoJS.enc.Utf8)
    ) as { token: string; type: string; expires: string }
    expect(parsed.token).toBe('gtfya.PRIVATE')
    expect(parsed.type).toBe('app')
    const days = (new Date(parsed.expires).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
    expect(days).toBeGreaterThan(29.9)
    expect(days).toBeLessThan(30.1)
  })
})

describe('getAppTokenStorageSnapshot 只读快照', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('返回原始加密值,不解密、不校验、不修改存储', () => {
    authService.setAppToken(1, 'tok-1')
    const first = authService.getAppTokenStorageSnapshot(1)
    const second = authService.getAppTokenStorageSnapshot(1)
    expect(first).not.toBeNull()
    expect(first).toBe(second)
    expect(first).toBe(localStorage.getItem(APP_KEY))
    expect(typeof first).toBe('string')
  })

  it('损坏内容也原样返回(快照不做任何结构判断)', () => {
    localStorage.setItem(APP_KEY, '%%%corrupt%%%')
    expect(authService.getAppTokenStorageSnapshot(1)).toBe('%%%corrupt%%%')
    expect(localStorage.getItem(APP_KEY)).toBe('%%%corrupt%%%')
  })

  it('缺失返回 null,且不创建任何键', () => {
    expect(authService.getAppTokenStorageSnapshot(42)).toBeNull()
    expect(localStorage.getItem('woe_auth_app_42_token')).toBeNull()
  })
})

describe('removeAppTokenIfUnchanged 条件删除', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('快照一致 → true 并删除', () => {
    authService.setAppToken(1, 'tok-1')
    const snapshot = authService.getAppTokenStorageSnapshot(1)
    expect(authService.removeAppTokenIfUnchanged(1, snapshot)).toBe(true)
    expect(localStorage.getItem(APP_KEY)).toBeNull()
  })

  it('expectedStoredValue 为 null → false,不删除任何数据', () => {
    authService.setAppToken(1, 'tok-1')
    expect(authService.removeAppTokenIfUnchanged(1, null)).toBe(false)
    expect(localStorage.getItem(APP_KEY)).not.toBeNull()
  })

  it('存储已变化(新令牌写入)→ false,新令牌完整保留', () => {
    authService.setAppToken(1, 'tok-old')
    const staleSnapshot = authService.getAppTokenStorageSnapshot(1)
    authService.setAppToken(1, 'tok-new')
    expect(authService.removeAppTokenIfUnchanged(1, staleSnapshot)).toBe(false)
    expect(authService.getAppToken(1)?.token).toBe('tok-new')
    expect(localStorage.getItem(APP_KEY)).toBe(authService.getAppTokenStorageSnapshot(1))
  })

  it('键不存在(快照非 null 但已丢失)→ false', () => {
    expect(authService.removeAppTokenIfUnchanged(1, 'ghost-value')).toBe(false)
  })

  it('原始字符串比较:损坏密文的快照同样可条件删除', () => {
    localStorage.setItem(APP_KEY, '%%%corrupt%%%')
    const snapshot = authService.getAppTokenStorageSnapshot(1)
    expect(authService.removeAppTokenIfUnchanged(1, snapshot)).toBe(true)
    expect(localStorage.getItem(APP_KEY)).toBeNull()
  })
})

describe('subscribeSessionChanges 会话变更通知', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it("setToken/removeToken('client')/clearAllAuth 的 revision 变化同步触发订阅", () => {
    const listener = vi.fn()
    authService.subscribeSessionChanges(listener)

    const before = authService.getSessionRevision()
    authService.setToken('client', 'ct-1')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(authService.getSessionRevision()).toBe(before + 1)

    authService.removeToken('client')
    expect(listener).toHaveBeenCalledTimes(2)

    authService.clearAllAuth()
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('app token 写入/删除不改变会话 revision,不触发订阅', () => {
    const listener = vi.fn()
    authService.subscribeSessionChanges(listener)
    authService.setToken('app', 'at-1')
    authService.setAppToken(1, 'at-1')
    authService.removeToken('app')
    expect(listener).not.toHaveBeenCalled()
  })

  it('取消订阅后不再调用(可重复取消)', () => {
    const listener = vi.fn()
    const unsubscribe = authService.subscribeSessionChanges(listener)
    authService.setToken('client', 'ct-1')
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    unsubscribe()
    authService.setToken('client', 'ct-2')
    authService.clearAllAuth()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('同一 listener 订阅两次:通知各收到;每次取消只解除一次注册', () => {
    const listener = vi.fn()
    const unsubscribeFirst = authService.subscribeSessionChanges(listener)
    const unsubscribeSecond = authService.subscribeSessionChanges(listener)

    authService.setToken('client', 'ct-1')
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribeFirst()
    authService.setToken('client', 'ct-2')
    expect(listener).toHaveBeenCalledTimes(3)

    unsubscribeSecond()
    authService.setToken('client', 'ct-3')
    authService.clearAllAuth()
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('订阅回调异常被隔离:不中断其他订阅者,不改变 setToken/clearAllAuth 结果', () => {
    const throwing = vi.fn(() => {
      throw new Error('subscriber boom')
    })
    const healthy = vi.fn()
    authService.subscribeSessionChanges(throwing)
    authService.subscribeSessionChanges(healthy)

    expect(() => authService.setToken('client', 'ct-1')).not.toThrow()
    expect(healthy).toHaveBeenCalled()
    expect(authService.getToken('client')?.token).toBe('ct-1')


    authService.setToken('client', 'ct-2')
    expect(() => authService.clearAllAuth()).not.toThrow()
    expect(authService.getToken('client')).toBeNull()
    expect(localStorage.getItem('woe_auth_client_token')).toBeNull()
    expect(healthy.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})

describe('存储键助手(语义化 storage 过滤)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('clientTokenStorageKey/appTokenStorageKey 与 authService 实际存储键一致', () => {
    expect(clientTokenStorageKey()).toBe('woe_auth_client_token')
    expect(appTokenStorageKey(7)).toBe('woe_auth_app_7_token')
    authService.setAppToken(7, 'tok-7')
    expect(localStorage.getItem(appTokenStorageKey(7))).not.toBeNull()
  })

  it('parseAppTokenStorageKey:应用键解析出 appId,其余键返回 null', () => {
    expect(parseAppTokenStorageKey('woe_auth_app_42_token')).toBe(42)
    expect(parseAppTokenStorageKey(appTokenStorageKey(1))).toBe(1)
    expect(parseAppTokenStorageKey('woe_auth_client_token')).toBeNull()
    expect(parseAppTokenStorageKey('woe_auth_preferences')).toBeNull()
    expect(parseAppTokenStorageKey('woe_auth_app_x_token')).toBeNull()
    expect(parseAppTokenStorageKey('woe_auth_app_1_token_suffix')).toBeNull()
  })
})

describe('浏览器拒绝本地存储访问', () => {
  beforeEach(() => { vi.restoreAllMocks(); localStorage.clear() })
  afterEach(() => vi.restoreAllMocks())

  it.each(['getAppToken', 'getAppTokenStorageSnapshot'] as const)('%s读取受限时返回null，页面可fail-closed', method => {
    authService.setAppToken(1, 'existing-token')
    const raw = localStorage.getItem(APP_KEY)
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError')
    })
    expect(authService[method](1)).toBeNull()
    read.mockRestore()
    expect(localStorage.getItem(APP_KEY)).toBe(raw)
  })

  it('损坏缓存清理被拒绝时，getter仍返回null而不抛出', () => {
    localStorage.setItem(APP_KEY, '%%%corrupt%%%')
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError')
    })
    expect(authService.getAppToken(1)).toBeNull()
    expect(localStorage.getItem(APP_KEY)).toBe('%%%corrupt%%%')
  })

  it('条件删除被拒绝时返回false，不让详情解析重试循环或误报删除成功', () => {
    authService.setAppToken(1, 'existing-token')
    const raw = localStorage.getItem(APP_KEY)!
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError')
    })
    expect(authService.removeAppTokenIfUnchanged(1, raw)).toBe(false)
    expect(localStorage.getItem(APP_KEY)).toBe(raw)
  })
})

describe('会话快照存储被拒绝', () => {
  beforeEach(() => { vi.restoreAllMocks(); localStorage.clear() })
  afterEach(() => vi.restoreAllMocks())
  it.each(['getClientCredentialForRevocation', 'getClientId'] as const)('%s读取拒绝时返回null而不抛入详情批次/提权归属检查', method => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError')
    })
    expect(authService[method]()).toBeNull()
  })
})

describe('同引用订阅的独立生命周期', () => {
  it('同一退订重复调用不移除其他注册', () => {
    const listener = vi.fn()
    const first = authService.subscribeSessionChanges(listener)
    const second = authService.subscribeSessionChanges(listener)
    try {
      first()
      first()
      authService.setToken('client', 'subscription-current')
      expect(listener).toHaveBeenCalledTimes(1)
    } finally {
      first()
      second()
    }
  })

  it('退订后一次同引用注册保留前一次与其他订阅的通知顺序', () => {
    const calls: string[] = []
    const listener = () => calls.push('listener')
    const first = authService.subscribeSessionChanges(listener)
    const middle = authService.subscribeSessionChanges(() => calls.push('middle'))
    const last = authService.subscribeSessionChanges(listener)
    try {
      last()
      authService.setToken('client', 'subscription-order')
      expect(calls).toEqual(['listener', 'middle'])
    } finally {
      first()
      middle()
      last()
    }
  })
})
