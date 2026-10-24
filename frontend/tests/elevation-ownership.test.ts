import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  revision: 1, token: 'a' as string | null, clientId: 7 as number | null,
  elevateClient: vi.fn(), markElevated: vi.fn(),
  store: { user: { name: 'alice' }, elevatedUntil: null as Date | null }
}))
vi.mock('@/services/api', () => ({ clientApi: { elevateClient: mocks.elevateClient } }))
vi.mock('@/services/auth', () => ({ authService: {
  getSessionRevision: () => mocks.revision,
  getClientCredentialForRevocation: () => mocks.token,
  getClientId: () => mocks.clientId
} }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ ...mocks.store, markElevated: mocks.markElevated }) }))
const defer = <T>() => {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
let ui: ReturnType<typeof import('@/composables/useElevatedAction')['useElevatedAction']>
let ForbiddenErrorClass: typeof import('@/types')['ForbiddenError']
const forbidden = () => new ForbiddenErrorClass('session not elevated')
const actionOf = (value = 'ok') => vi.fn().mockRejectedValueOnce(forbidden()).mockResolvedValue(value)
const resultOf = (promise: Promise<unknown>) => promise.then(value => ({ value }), error => ({ error }))
const cancelled = (result: { error?: unknown; value?: unknown }) => expect(result.error).toMatchObject({ name: 'ElevationCancelledError' })
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks()
  mocks.revision = 1; mocks.token = 'a'; mocks.clientId = 7
  mocks.store.user = { name: 'alice' }; mocks.store.elevatedUntil = null
  mocks.elevateClient.mockResolvedValue(undefined)
  ForbiddenErrorClass = (await import('@/types')).ForbiddenError
  ui = (await import('@/composables/useElevatedAction')).useElevatedAction()
})

describe('提权入口的会话与调用者归属', () => {
  it('已失效调用者不派发首个危险操作', async () => {
    const action = vi.fn().mockResolvedValue('ok')
    cancelled(await resultOf(ui.withElevation(action, () => false)))
    expect(action).not.toHaveBeenCalled()
  })
  it('旧操作迟到403不打开新会话提权弹窗', async () => {
    const response = defer<never>()
    const result = resultOf(ui.withElevation(() => response.promise))
    mocks.token = 'b'; response.reject(forbidden()); await flush()
    expect(ui.isElevationModalOpen.value).toBe(false)
    ui.handleElevationCancel()
    cancelled(await result)
    expect(mocks.elevateClient).not.toHaveBeenCalled()
  })
  it('旧动作迟到200也不能作为当前操作成功返回', async () => {
    const response = defer<string>()
    const result = resultOf(ui.withElevation(() => response.promise))
    mocks.clientId = 8
    response.resolve('old-success')
    cancelled(await result)
    expect(mocks.elevateClient).not.toHaveBeenCalled()
  })


  describe.each(['initial', 'retry'] as const)('%s危险操作在途', phase => {
    it.each([
      ['revision', 'success'], ['revision', 'failure'],
      ['token', 'success'], ['token', 'failure'],
      ['clientId', 'success'], ['clientId', 'failure']
    ] as const)('%s变化后迟到%s抛会话变化错误且不继续旧操作', async (field, outcome) => {
      const { isElevationCancelled, isElevationSessionChanged } = await import('@/composables/useElevatedAction')
      const response = defer<string>()
      const action = vi.fn().mockReturnValue(response.promise)
      if (phase === 'retry') action.mockRejectedValueOnce(forbidden())
      const result = resultOf(ui.withElevation(action))
      if (phase === 'retry') {
        await flush(); ui.handleElevationConfirm('pw'); await flush()
        expect(action).toHaveBeenCalledTimes(2)
      }
      const marksBeforeChange = mocks.markElevated.mock.calls.length
      if (field === 'revision') mocks.revision++
      if (field === 'token') mocks.token = 'b'
      if (field === 'clientId') mocks.clientId = 8
      if (outcome === 'success') response.resolve('server-committed')
      else response.reject(forbidden())
      const settled = await result
      expect(isElevationSessionChanged('error' in settled ? settled.error : undefined)).toBe(true)
      expect(isElevationCancelled('error' in settled ? settled.error : undefined)).toBe(true)
      expect(settled).not.toHaveProperty('value')
      expect(ui.isElevationModalOpen.value).toBe(false)
      expect(action).toHaveBeenCalledTimes(phase === 'initial' ? 1 : 2)
      expect(mocks.elevateClient).toHaveBeenCalledTimes(phase === 'initial' ? 0 : 1)
      expect(mocks.markElevated).toHaveBeenCalledTimes(marksBeforeChange)
    })

    it.each(['success', 'failure'] as const)('仅调用者失效时迟到%s仍是静默取消', async outcome => {
      const { isElevationCancelled, isElevationSessionChanged } = await import('@/composables/useElevatedAction')
      let current = true
      const response = defer<string>()
      const action = vi.fn().mockReturnValue(response.promise)
      if (phase === 'retry') action.mockRejectedValueOnce(forbidden())
      const result = resultOf(ui.withElevation(action, () => current))
      if (phase === 'retry') {
        await flush(); ui.handleElevationConfirm('pw'); await flush()
        expect(action).toHaveBeenCalledTimes(2)
      }
      current = false
      if (outcome === 'success') response.resolve('server-committed')
      else response.reject(forbidden())
      const settled = await result
      expect(isElevationCancelled('error' in settled ? settled.error : undefined)).toBe(true)
      expect(isElevationSessionChanged('error' in settled ? settled.error : undefined)).toBe(false)
      expect(ui.isElevationModalOpen.value).toBe(false)
      expect(action).toHaveBeenCalledTimes(phase === 'initial' ? 1 : 2)
    })
  })
  it.each(['revision', 'token', 'clientId', 'caller'] as const)('密码返回时%s失效，不派发提权', async field => {
    let current = true
    const action = actionOf()
    const result = resultOf(ui.withElevation(action, () => current))
    await flush()
    expect(ui.isElevationModalOpen.value).toBe(true)
    if (field === 'revision') mocks.revision++
    if (field === 'token') mocks.token = 'b'
    if (field === 'clientId') mocks.clientId = 8
    if (field === 'caller') current = false
    ui.handleElevationConfirm('pw')
    cancelled(await result)
    expect(mocks.elevateClient).not.toHaveBeenCalled()
    expect(mocks.markElevated).not.toHaveBeenCalled()
    expect(action).toHaveBeenCalledTimes(1)
  })
  it.each(['success', 'failure'] as const)('提权HTTP迟到%s，不写软缓存或留错误弹窗', async outcome => {
    const http = defer<void>(); mocks.elevateClient.mockReturnValue(http.promise)
    const action = actionOf(), result = resultOf(ui.withElevation(action))
    await flush(); ui.handleElevationConfirm('pw'); await flush()
    mocks.token = 'b'
    if (outcome === 'success') http.resolve(); else http.reject(forbidden())
    await flush()
    expect(mocks.markElevated).not.toHaveBeenCalled()
    expect(ui.isElevationModalOpen.value).toBe(false)
    ui.handleElevationCancel()
    cancelled(await result)
    expect(action).toHaveBeenCalledTimes(1)
  })
  it('同会话共享提权，失效等待者不阻断有效等待者', async () => {
    let current = true
    const first = actionOf('first'), second = actionOf('second')
    const firstResult = resultOf(ui.withElevation(first, () => current))
    const secondResult = resultOf(ui.withElevation(second))
    await flush(); current = false; ui.handleElevationConfirm('pw')
    cancelled(await firstResult)
    expect(await secondResult).toEqual({ value: 'second' })
    expect(mocks.elevateClient).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)
    expect(mocks.markElevated).toHaveBeenCalledTimes(1)
  })
  it('新会话不复用旧HTTP，旧完成不关闭新弹窗', async () => {
    const http = defer<void>(); mocks.elevateClient.mockReturnValueOnce(http.promise).mockResolvedValue(undefined)
    const oldAction = actionOf('old'), oldResult = resultOf(ui.withElevation(oldAction))
    await flush(); ui.handleElevationConfirm('alice-pw'); await flush()
    mocks.token = 'b'; mocks.clientId = 8; mocks.store.user = { name: 'bob' }
    const newResult = resultOf(ui.withElevation(actionOf('new')))
    await flush()
    expect(ui.elevationModalLoading.value).toBe(false)
    expect(ui.isElevationModalOpen.value).toBe(true)
    http.resolve(); cancelled(await oldResult)
    expect(ui.isElevationModalOpen.value).toBe(true)
    expect(mocks.markElevated).not.toHaveBeenCalled()
    ui.handleElevationConfirm('bob-pw')
    expect(await newResult).toEqual({ value: 'new' })
    expect(mocks.elevateClient).toHaveBeenLastCalledWith(8, 900, { username: 'bob', password: 'bob-pw' })
  })
  it('新会话替换旧密码等待，不复用新密码', async () => {
    const oldAction = actionOf('old'), oldResult = resultOf(ui.withElevation(oldAction))
    await flush(); mocks.token = 'b'; mocks.clientId = 8
    const newResult = resultOf(ui.withElevation(actionOf('new')))
    await flush(); ui.handleElevationConfirm('new-pw')
    expect(await newResult).toEqual({ value: 'new' })
    cancelled(await oldResult)
    expect(mocks.elevateClient).toHaveBeenCalledTimes(1)
    expect(oldAction).toHaveBeenCalledTimes(1)
  })
  it('会话变化打断密码等待:抛 ElevationSessionChangedError,仍是取消子类', async () => {
    const { isElevationCancelled, isElevationSessionChanged } = await import('@/composables/useElevatedAction')
    const oldAction = actionOf('old'), oldResult = resultOf(ui.withElevation(oldAction))
    await flush(); mocks.token = 'b'; mocks.clientId = 8
    const newResult = resultOf(ui.withElevation(actionOf('new')))
    await flush()
    const { error } = await oldResult
    cancelled({ error })
    expect(isElevationCancelled(error)).toBe(true)
    expect(isElevationSessionChanged(error)).toBe(true)

    ui.handleElevationConfirm('new-pw')
    expect(await newResult).toEqual({ value: 'new' })
  })
  it('同会话调用者失效:普通取消,非会话变化子类', async () => {
    const { isElevationSessionChanged } = await import('@/composables/useElevatedAction')
    let current = true
    const oldResult = resultOf(ui.withElevation(actionOf('old'), () => current))
    await flush()
    current = false
    const newResult = resultOf(ui.withElevation(actionOf('new')))
    await flush()
    const { error } = await oldResult
    cancelled({ error })
    expect(isElevationSessionChanged(error)).toBe(false)
    ui.handleElevationConfirm('new-pw')
    expect(await newResult).toEqual({ value: 'new' })
  })
  it('原调用者全部失效时，同会话新操作替换旧密码流程', async () => {
    let current = true
    const oldAction = actionOf('old')
    const oldResult = resultOf(ui.withElevation(oldAction, () => current))
    await flush()
    current = false
    const newResult = resultOf(ui.withElevation(actionOf('new')))
    await flush()
    cancelled(await oldResult)
    ui.handleElevationConfirm('new-pw')
    expect(await newResult).toEqual({ value: 'new' })
    expect(mocks.elevateClient).toHaveBeenCalledTimes(1)
    expect(oldAction).toHaveBeenCalledTimes(1)
  })
  it('提权完成前调用者失效，不写软缓存或重试', async () => {
    let current = true
    const http = defer<void>(); mocks.elevateClient.mockReturnValue(http.promise)
    const action = actionOf(), result = resultOf(ui.withElevation(action, () => current))
    await flush(); ui.handleElevationConfirm('pw'); await flush()
    current = false; http.resolve()
    cancelled(await result)
    expect(mocks.markElevated).not.toHaveBeenCalled()
    expect(action).toHaveBeenCalledTimes(1)
  })
  it('正常错误密码可重输，成功只重试危险操作一次', async () => {
    mocks.elevateClient.mockRejectedValueOnce(forbidden()).mockResolvedValue(undefined)
    const action = actionOf(), result = resultOf(ui.withElevation(action))
    await flush(); ui.handleElevationConfirm('bad'); await flush()
    expect(ui.elevationModalError.value).toBe('wrongPassword')
    ui.handleElevationConfirm('good')
    expect(await result).toEqual({ value: 'ok' })
    expect(action).toHaveBeenCalledTimes(2)
    expect(mocks.markElevated).toHaveBeenCalledTimes(1)
  })
  it('用户取消密码框，不派发提权或重试', async () => {
    const action = actionOf()
    const result = resultOf(ui.withElevation(action))
    await flush()
    ui.handleElevationCancel()
    cancelled(await result)
    expect(mocks.elevateClient).not.toHaveBeenCalled()
    expect(action).toHaveBeenCalledTimes(1)
  })
  it('当前会话三次错误仍按原协议显示次数耗尽提示', async () => {
    mocks.elevateClient.mockRejectedValue(forbidden())
    const result = resultOf(ui.withElevation(actionOf()))
    await flush()
    for (let attempt = 0; attempt < 3; attempt++) {
      ui.handleElevationConfirm('bad')
      await flush()
    }
    cancelled(await result)
    expect(mocks.elevateClient).toHaveBeenCalledTimes(3)
    expect(ui.elevationModalMode.value).toBe('message')
    expect(ui.elevationModalMessageKey.value).toBe('elevate.attemptsExhausted')
    expect(mocks.markElevated).not.toHaveBeenCalled()
  })
})
