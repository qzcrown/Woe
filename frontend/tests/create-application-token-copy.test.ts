import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import CryptoJS from 'crypto-js'
import CreateApplicationModal from '@/components/CreateApplicationModal.vue'
import { authService } from '@/services/auth'
import { base64UrlEncode } from '@/utils/enhancedToken'






const mocks = vi.hoisted(() => ({
  createApplication: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn()
}))

vi.mock('@/components/BaseModal.vue', () => ({
  default: {
    name: 'BaseModal',
    emits: ['close'],
    template: '<div class="base-modal-stub"><slot name="title" /><slot /><slot name="footer" /></div>'
  }
}))
vi.mock('@/utils/errorHandler', () => ({
  showError: mocks.showError,
  showSuccess: mocks.showSuccess
}))
vi.mock('@/services/api', () => ({
  applicationApi: { createApplication: mocks.createApplication },
  clientApi: { elevateClient: vi.fn() },
  authApi: { login: vi.fn(), logout: vi.fn() }
}))

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
  settled: boolean
}

const defer = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  const d: Deferred<T> = { promise, resolve, reject, settled: false }
  const wrap = (fn: (v: unknown) => void) => (v: unknown) => {
    d.settled = true
    fn(v)
  }
  d.resolve = wrap(resolve) as (value: T) => void
  d.reject = wrap(reject) as (error: unknown) => void
  return d
}

const flush = async (rounds = 30): Promise<void> => {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve()
  }
  await nextTick()
}

const SEED2 = new Uint8Array(32)
SEED2[0] = 2
const PRIVATE_FORM = 'gtfya.AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const PRIVATE_FORM_2 = `gtfya.${base64UrlEncode(SEED2)}`

const storedTokenOf = (id: number): string | null => {
  const raw = localStorage.getItem(`woe_auth_app_${id}_token`)
  if (raw === null) return null
  const parsed = JSON.parse(
    CryptoJS.AES.decrypt(raw, 'woe-default-key').toString(CryptoJS.enc.Utf8)
  ) as { token?: string }
  return parsed.token ?? null
}

const storedRawOf = (id: number): string | null =>
  localStorage.getItem(`woe_auth_app_${id}_token`)



const realSubscribe = authService.subscribeSessionChanges.bind(authService)
const unsubscribeCalls = vi.fn()

import i18n from '@/locales'

const writeText = vi.fn()
let activeWrapper: VueWrapper | null = null

const mountModal = (): VueWrapper => {
  activeWrapper = mount(CreateApplicationModal, { global: { plugins: [i18n] } })
  return activeWrapper
}

const fillAndSubmit = async (wrapper: VueWrapper): Promise<void> => {
  await wrapper.find('input[type="text"]').setValue('My App')
  await wrapper.find('form').trigger('submit')
  await flush()
}

const copyButton = (wrapper: VueWrapper) => wrapper.find('.btn.copy')

beforeEach(() => {
  localStorage.clear()
  vi.resetAllMocks()
  unsubscribeCalls.mockClear()
  vi.spyOn(authService, 'subscribeSessionChanges').mockImplementation((listener) => {
    const unsubscribe = realSubscribe(listener)
    return () => {
      unsubscribeCalls()
      unsubscribe()
    }
  })
  i18n.global.locale.value = 'en-US'
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true
  })
  writeText.mockResolvedValue(undefined)
  authService.setToken('client', 'test-client-token')
})

afterEach(() => {
  activeWrapper?.unmount()
  activeWrapper = null
  vi.restoreAllMocks()
  vi.useRealTimers()
})




describe('创建成功与复制反馈', () => {
  it('创建成功:token 展示+写缓存,复制取完整值,Check 图标 1500ms 复位,无成功 toast', async () => {
    vi.useFakeTimers()
    mocks.createApplication.mockResolvedValue({ data: { id: 9, token: PRIVATE_FORM } })
    const wrapper = mountModal()
    await fillAndSubmit(wrapper)


    expect(wrapper.find('.token-value code').text()).toBe(PRIVATE_FORM)
    expect(storedTokenOf(9)).toBe(PRIVATE_FORM)
    expect(wrapper.emitted('created')).toHaveLength(1)

    expect(wrapper.text()).toContain('only on creation or regeneration')


    await copyButton(wrapper).trigger('click')
    await flush()
    expect(writeText).toHaveBeenCalledWith(PRIVATE_FORM)
    expect(copyButton(wrapper).html()).toContain('lucide-check')
    expect(mocks.showSuccess).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1499)
    await flush()
    expect(copyButton(wrapper).html()).toContain('lucide-check')
    vi.advanceTimersByTime(1)
    await flush()
    expect(copyButton(wrapper).html()).toContain('lucide-copy')
  })

  it('连续复制乱序完成:从最近有效成功起计时;失败 showError 无 toast', async () => {
    vi.useFakeTimers()
    mocks.createApplication.mockResolvedValue({ data: { id: 9, token: PRIVATE_FORM } })
    const wrapper = mountModal()
    await fillAndSubmit(wrapper)

    const firstClip = defer<void>()
    const secondClip = defer<void>()
    let clipCall = 0
    writeText.mockImplementation(() => (clipCall++ === 0 ? firstClip.promise : secondClip.promise))

    await copyButton(wrapper).trigger('click')
    vi.advanceTimersByTime(1000)
    await copyButton(wrapper).trigger('click')
    await flush()

    secondClip.resolve()
    await flush()
    expect(copyButton(wrapper).html()).toContain('lucide-check')


    firstClip.resolve()
    await flush()
    expect(copyButton(wrapper).html()).toContain('lucide-check')

    vi.advanceTimersByTime(1500)
    await flush()
    expect(copyButton(wrapper).html()).toContain('lucide-copy')
    expect(mocks.showError).not.toHaveBeenCalled()
  })

  it('复制失败:showError、无成功图标、无成功 toast', async () => {
    vi.useFakeTimers()
    mocks.createApplication.mockResolvedValue({ data: { id: 9, token: PRIVATE_FORM } })
    const wrapper = mountModal()
    await fillAndSubmit(wrapper)

    writeText.mockRejectedValue(new Error('denied'))
    await copyButton(wrapper).trigger('click')
    await flush()

    expect(mocks.showError).toHaveBeenCalled()
    expect(mocks.showSuccess).not.toHaveBeenCalled()
    expect(copyButton(wrapper).html()).toContain('lucide-copy')
  })

  it('卸载时复制在途:迟到完成无副作用,timer 清理', async () => {
    vi.useFakeTimers()
    mocks.createApplication.mockResolvedValue({ data: { id: 9, token: PRIVATE_FORM } })
    const wrapper = mountModal()
    await fillAndSubmit(wrapper)

    const clip = defer<void>()
    writeText.mockImplementation(() => clip.promise)
    await copyButton(wrapper).trigger('click')
    await flush()

    wrapper.unmount()
    activeWrapper = null
    clip.resolve()
    await flush()
    vi.advanceTimersByTime(2000)
    await flush()
    expect(mocks.showError).not.toHaveBeenCalled()
  })
})





describe('会话变更与订阅生命周期', () => {
  it('token 展示中会话变更:展示失效、复制反馈与 timer 清理', async () => {
    vi.useFakeTimers()
    mocks.createApplication.mockResolvedValue({ data: { id: 9, token: PRIVATE_FORM } })
    const wrapper = mountModal()
    await fillAndSubmit(wrapper)
    expect(wrapper.find('.token-value').exists()).toBe(true)

    authService.setToken('client', 'new-client-token')
    await flush()


    expect(wrapper.find('.token-value').exists()).toBe(false)
    expect(wrapper.text()).not.toContain(PRIVATE_FORM)

    vi.advanceTimersByTime(2000)
    await flush()
    expect(mocks.showError).not.toHaveBeenCalled()
  })

  it('创建请求在途会话变更:迟到响应不 setAppToken、不 emit created', async () => {
    const createdDeferreds: Array<Deferred<{ data: { id: number; token: string } }>> = []
    mocks.createApplication.mockImplementation(() => {
      const d = defer<{ data: { id: number; token: string } }>()
      createdDeferreds.push(d)
      return d.promise
    })
    const wrapper = mountModal()
    await fillAndSubmit(wrapper)


    authService.setToken('client', 'another-session-token')
    createdDeferreds[0].resolve({ data: { id: 12, token: PRIVATE_FORM_2 } })
    await flush()

    expect(storedRawOf(12)).toBeNull()
    expect(wrapper.emitted('created')).toBeUndefined()
    expect(wrapper.find('.token-value').exists()).toBe(false)
  })

  it('卸载取消会话订阅', async () => {
    const wrapper = mountModal()
    await flush()
    expect(unsubscribeCalls).not.toHaveBeenCalled()

    wrapper.unmount()
    activeWrapper = null
    expect(unsubscribeCalls).toHaveBeenCalled()
  })

  it('关闭(取消)按钮 emit close', async () => {
    const wrapper = mountModal()
    const cancel = wrapper.findAll('button').find((b) => b.text() === 'Cancel')
    expect(cancel).toBeTruthy()
    await cancel!.trigger('click')
    await flush()
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
    activeWrapper = null
    expect(unsubscribeCalls).toHaveBeenCalled()
  })
})




describe('创建响应校验', () => {
  it.each([
    ['缺失(undefined)', { id: 13 }],
    ['非字符串(数字)', { id: 13, token: 12345 }],
    ['空字符串', { id: 13, token: '' }]
  ])('token %s:不写缓存、不可复制,emit created 后关闭弹窗', async (_label, data) => {
    mocks.createApplication.mockResolvedValue({ data })
    const wrapper = mountModal()
    await fillAndSubmit(wrapper)

    expect(storedRawOf(13)).toBeNull()
    expect(wrapper.emitted('created')).toHaveLength(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.find('.token-value').exists()).toBe(false)
    expect(writeText).not.toHaveBeenCalled()

    expect(mocks.showError).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('no usable token was returned')
    )
  })
})




describe('创建存储异常', () => {
  it('setAppToken 失败:保留内存副本可复制,提示存储失败而非成功,缓存为空', async () => {
    vi.useFakeTimers()
    mocks.createApplication.mockResolvedValue({ data: { id: 14, token: PRIVATE_FORM_2 } })
    const setSpy = vi.spyOn(authService, 'setAppToken').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    const wrapper = mountModal()
    await fillAndSubmit(wrapper)


    expect(wrapper.find('.token-value code').text()).toBe(PRIVATE_FORM_2)
    expect(wrapper.emitted('created')).toHaveLength(1)
    await copyButton(wrapper).trigger('click')
    await flush()
    expect(writeText).toHaveBeenCalledWith(PRIVATE_FORM_2)


    const shownContexts = mocks.showError.mock.calls.map((call) => call[1])
    expect(shownContexts).toContain('The new token was generated but could not be saved in this browser. Copy and save it before leaving.')
    expect(mocks.showSuccess).not.toHaveBeenCalled()


    expect(storedRawOf(14)).toBeNull()
    setSpy.mockRestore()
  })
})

describe('创建弹窗跨标签页会话隔离', () => {
  it('已展示私钥遇到跨 tab 换凭据事件:立即隐藏、无法继续复制', async () => {
    mocks.createApplication.mockResolvedValue({ data: { id: 9, token: PRIVATE_FORM } })
    const wrapper = mountModal()
    await fillAndSubmit(wrapper)
    localStorage.setItem('woe_auth_client_token', CryptoJS.AES.encrypt(JSON.stringify({
      token: 'other-tab-client', type: 'client', expires: new Date(Date.now() + 86400000).toISOString()
    }), 'woe-default-key').toString())
    window.dispatchEvent(new StorageEvent('storage', { key: 'woe_auth_client_token' }))
    await flush()
    expect(wrapper.find('.token-value').exists()).toBe(false)
    expect(writeText).not.toHaveBeenCalled()
  })
})

describe('创建复制计时、响应校验与重复提交', () => {
  it('成功后再次复制失败:原成功反馈仍在1500ms到期恢复', async () => {
    vi.useFakeTimers()
    mocks.createApplication.mockResolvedValue({ data: { id: 9, token: PRIVATE_FORM } })
    const wrapper = mountModal()
    await fillAndSubmit(wrapper)
    writeText.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'))
    await copyButton(wrapper).trigger('click')
    await flush()
    vi.advanceTimersByTime(1000)
    await copyButton(wrapper).trigger('click')
    await flush()
    vi.advanceTimersByTime(500)
    await flush()
    expect(copyButton(wrapper).html()).toContain('lucide-copy')
  })

  it.each(['gtfygarbage', 'gtfya.short', 'gtfya.a.b.c', '   '])('创建响应 %s 不缓存、不复制', async (token) => {
    mocks.createApplication.mockResolvedValue({ data: { id: 9, token } })
    const wrapper = mountModal()
    await fillAndSubmit(wrapper)
    expect(storedRawOf(9)).toBeNull()
    expect(wrapper.find('.token-value').exists()).toBe(false)
    expect(wrapper.emitted('created')).toHaveLength(1)
  })

  it('HTTP等待期间重复表单提交只创建一次', async () => {
    const creation = defer<{ data: { id: number; token: string } }>()
    mocks.createApplication.mockReturnValue(creation.promise)
    const wrapper = mountModal()
    await fillAndSubmit(wrapper)
    await wrapper.find('form').trigger('submit')
    await flush()
    expect(mocks.createApplication).toHaveBeenCalledTimes(1)
    creation.resolve({ data: { id: 9, token: PRIVATE_FORM } })
    await flush()
  })
})
