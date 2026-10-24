import { describe, it, expect } from 'vitest'
import { isAppTokenRequestCurrent, type AppTokenRequestContext } from '@/utils/appTokenRequestGuard'





const baseContext = (overrides: Partial<AppTokenRequestContext> = {}): AppTokenRequestContext => ({
  appId: 1,
  pageGeneration: 3,
  appGeneration: 2,
  requestSequence: 7,
  sessionRevision: 5,
  clientToken: 'client-token',
  storedValue: 'encrypted-snapshot',
  disposed: false,
  ...overrides,
})

describe('isAppTokenRequestCurrent', () => {
  it('全部归属字段相同且未 disposed → true', () => {
    expect(isAppTokenRequestCurrent(baseContext(), baseContext())).toBe(true)
  })

  it.each([
    ['appId', { appId: 2 }],
    ['pageGeneration', { pageGeneration: 4 }],
    ['appGeneration', { appGeneration: 9 }],
    ['requestSequence', { requestSequence: 8 }],
    ['sessionRevision', { sessionRevision: 6 }],
  ] as const)('captured 与 current 的 %s 不同 → false', (_name, override) => {
    expect(isAppTokenRequestCurrent(baseContext(), baseContext(override))).toBe(false)

    expect(isAppTokenRequestCurrent(baseContext(override), baseContext())).toBe(false)
  })

  it('clientToken 变化 → false(含 null 交替)', () => {
    expect(isAppTokenRequestCurrent(baseContext(), baseContext({ clientToken: 'other-tab-token' }))).toBe(false)
    expect(isAppTokenRequestCurrent(baseContext(), baseContext({ clientToken: null }))).toBe(false)
    expect(isAppTokenRequestCurrent(baseContext({ clientToken: null }), baseContext())).toBe(false)
  })

  it('storedValue 变化 → false(含 null 交替)', () => {
    expect(isAppTokenRequestCurrent(baseContext(), baseContext({ storedValue: 'new-ciphertext' }))).toBe(false)
    expect(isAppTokenRequestCurrent(baseContext(), baseContext({ storedValue: null }))).toBe(false)
    expect(isAppTokenRequestCurrent(baseContext({ storedValue: null }), baseContext())).toBe(false)
  })

  it('same client token 但 sessionRevision 变化 → false(登出→重登录同 token 罕见但守卫必须生效)', () => {
    expect(
      isAppTokenRequestCurrent(
        baseContext(),
        baseContext({ sessionRevision: 6 })
      )
    ).toBe(false)
  })

  it('跨 tab 轮换:clientToken 变化而本 tab 内存 revision 未变 → false', () => {
    expect(
      isAppTokenRequestCurrent(
        baseContext(),
        baseContext({ clientToken: 'rotated-by-other-tab' })
      )
    ).toBe(false)
  })

  it('disposed 任一为 true → false', () => {
    expect(isAppTokenRequestCurrent(baseContext({ disposed: true }), baseContext())).toBe(false)
    expect(isAppTokenRequestCurrent(baseContext(), baseContext({ disposed: true }))).toBe(false)
    expect(isAppTokenRequestCurrent(baseContext({ disposed: true }), baseContext({ disposed: true }))).toBe(false)
  })

  it('disposed 优先于字段比较:即使全部字段相同也 false', () => {
    expect(
      isAppTokenRequestCurrent(baseContext({ disposed: true }), baseContext({ disposed: true }))
    ).toBe(false)
  })

  it('纯函数:不修改任何输入对象', () => {
    const captured = baseContext()
    const current = baseContext()
    const capturedCopy = { ...captured }
    const currentCopy = { ...current }
    isAppTokenRequestCurrent(captured, current)
    expect(captured).toEqual(capturedCopy)
    expect(current).toEqual(currentCopy)
  })
})
