import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import CryptoJS from 'crypto-js'
import ApplicationDetail from '@/views/ApplicationDetail.vue'
import { authService } from '@/services/auth'
import { ForbiddenError } from '@/types'
import { base64UrlEncode, derivePublicForm } from '@/utils/enhancedToken'
import { useElevatedAction } from '@/composables/useElevatedAction'
import { useConfirmDialogProvider } from '@/composables/useConfirmDialog'








const mocks = vi.hoisted(() => ({
  getApplication: vi.fn(),
  getApplicationMessages: vi.fn(),
  regenerateToken: vi.fn(),
  deleteApplication: vi.fn(),
  uploadApplicationImage: vi.fn(),
  deleteApplicationImage: vi.fn(),
  createApplication: vi.fn(),
  elevateClient: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn()
}))

vi.mock('@/components/Layout.vue', () => ({
  default: { name: 'Layout', template: '<div><slot /></div>' }
}))
vi.mock('@/components/ApplicationIcon.vue', () => ({
  default: {
    name: 'ApplicationIcon',
    props: ['name', 'image', 'size', 'showUploadOverlay', 'showDeleteButton'],
    emits: ['upload', 'delete'],
    template: '<div class="app-icon-stub" />'
  }
}))
vi.mock('@/components/EmptyState.vue', () => ({
  default: {
    name: 'EmptyState',
    props: ['type', 'title', 'description', 'size'],
    template: '<div class="empty-state-stub">{{ title }}</div>'
  }
}))
vi.mock('@/components/LoadingSpinner.vue', () => ({
  default: {
    name: 'LoadingSpinner',
    props: ['text', 'size', 'variant'],
    template: '<div class="loading-spinner-stub">{{ text }}</div>'
  }
}))
vi.mock('@/components/EditApplicationModal.vue', () => ({
  default: {
    name: 'EditApplicationModal',
    props: ['application'],
    emits: ['close', 'updated'],
    template: '<div class="edit-modal-stub" />'
  }
}))
vi.mock('@/utils/errorHandler', () => ({
  showError: mocks.showError,
  showSuccess: mocks.showSuccess
}))
vi.mock('@/services/api', () => ({
  applicationApi: {
    getApplication: mocks.getApplication,
    getApplicationMessages: mocks.getApplicationMessages,
    regenerateToken: mocks.regenerateToken,
    deleteApplication: mocks.deleteApplication,
    uploadApplicationImage: mocks.uploadApplicationImage,
    deleteApplicationImage: mocks.deleteApplicationImage,
    createApplication: mocks.createApplication
  },
  clientApi: { elevateClient: mocks.elevateClient },
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


const PRIVATE_FORM = 'gtfya.AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const PUBLIC_FORM = 'gtfya.zswVB9wd3XKVlRwpCIjwla25BE0bc9aW5t8GXWg71Pw'
const SEED2 = new Uint8Array(32)
SEED2[0] = 2
const PRIVATE_FORM_2 = `gtfya.${base64UrlEncode(SEED2)}`
const PUBLIC_FORM_2 = derivePublicForm(PRIVATE_FORM_2)
expect(PUBLIC_FORM_2).not.toBeNull()


const ENCRYPTION_KEY = 'woe-default-key'

const storedTokenOf = (id: number): string | null => {
  const raw = localStorage.getItem(`woe_auth_app_${id}_token`)
  if (raw === null) return null
  const parsed = JSON.parse(
    CryptoJS.AES.decrypt(raw, ENCRYPTION_KEY).toString(CryptoJS.enc.Utf8)
  ) as { token?: string }
  return parsed.token ?? null
}

const storedRawOf = (id: number): string | null =>
  localStorage.getItem(`woe_auth_app_${id}_token`)



interface DetailResponse { data: Record<string, unknown> }
interface MessagesResponse {
  data: { messages: Array<Record<string, unknown>>; paging: Record<string, unknown> }
}

const makeApp = (id: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  name: `App ${id}`,
  sortKey: '',
  description: `desc ${id}`,
  image: '',
  internal: false,
  defaultPriority: 0,
  ...extra
})

const makeMessages = (ids: number[]): MessagesResponse => ({
  data: {
    messages: ids.map((id) => ({ id, title: `m${id}`, message: `body ${id}`, priority: 1, date: '2026-01-01T00:00:00Z' })),
    paging: { size: ids.length, since: 0, limit: 20 }
  }
})


const pendingDetails = new Map<number, Array<Deferred<DetailResponse>>>()
const pendingMessages = new Map<number, Array<Deferred<MessagesResponse>>>()

const useDeferredApis = (): void => {
  mocks.getApplication.mockImplementation((id: number) => {
    const d = defer<DetailResponse>()
    const list = pendingDetails.get(id) ?? []
    list.push(d)
    pendingDetails.set(id, list)
    return d.promise
  })
  mocks.getApplicationMessages.mockImplementation((id: number) => {
    const d = defer<MessagesResponse>()
    const list = pendingMessages.get(id) ?? []
    list.push(d)
    pendingMessages.set(id, list)
    return d.promise
  })
}


const resolveDetail = (id: number, token: string | undefined, extra: Record<string, unknown> = {}): void => {
  const d = (pendingDetails.get(id) ?? []).find((item) => !item.settled)
  if (!d) throw new Error(`no pending detail for id ${id}`)
  d.resolve({ data: makeApp(id, { ...extra, ...(token !== undefined ? { token } : {}) }) })
}

const rejectDetail = (id: number, error: unknown): void => {
  const d = (pendingDetails.get(id) ?? []).find((item) => !item.settled)
  if (!d) throw new Error(`no pending detail for id ${id}`)
  d.reject(error)
}


const resolveMessages = (id: number, ids: number[], withNext = false): void => {
  const d = (pendingMessages.get(id) ?? []).find((item) => !item.settled)
  if (!d) throw new Error(`no pending messages for id ${id}`)
  const res = makeMessages(ids)
  if (withNext) res.data.paging = { ...res.data.paging, next: 99 }
  d.resolve(res)
}

const detailCallsFor = (id: number): number =>
  mocks.getApplication.mock.calls.filter((call) => call[0] === id).length

const messageCallsFor = (id: number): number =>
  mocks.getApplicationMessages.mock.calls.filter((call) => call[0] === id).length


const useImmediateApis = (detailTokens: Map<number, string | undefined>): void => {
  mocks.getApplication.mockImplementation(async (id: number) => ({
    data: makeApp(id, detailTokens.has(id) ? { token: detailTokens.get(id) } : {})
  }))
  mocks.getApplicationMessages.mockImplementation(async (id: number) => makeMessages([id * 10]))
}



import i18n from '@/locales'

const Dummy = defineComponent({ template: '<div class="dummy-page" />' })

const buildRouter = (): Router =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: Dummy },
      { path: '/applications', component: Dummy },
      { path: '/messages', component: Dummy },
      { path: '/applications/:id', component: ApplicationDetail }
    ]
  })

let router: Router
let confirmContext: ReturnType<typeof useConfirmDialogProvider> | null = null
let activeWrapper: VueWrapper | null = null

const mountDetail = async (startId: number): Promise<VueWrapper> => {
  router = buildRouter()
  await router.push(`/applications/${startId}`)
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)

  const { RouterView } = await import('vue-router')
  const HarnessWithView = defineComponent({
    setup() {
      confirmContext = useConfirmDialogProvider()
      return () => h(RouterView)
    }
  })
  activeWrapper = mount(HarnessWithView, { global: { plugins: [i18n, router, pinia] } })
  return activeWrapper
}

const detailComponent = (wrapper: VueWrapper) => wrapper.findComponent(ApplicationDetail)

const confirmCurrentDialog = (): void => {
  confirmContext!.handleConfirm()
}

const writeText = vi.fn()

const TOKEN_MASK = '••••••••'

beforeEach(() => {
  localStorage.clear()
  vi.resetAllMocks()
  pendingDetails.clear()
  pendingMessages.clear()
  confirmContext = null
  i18n.global.locale.value = 'en-US'
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true
  })

  authService.setToken('client', 'test-client-token')
  writeText.mockResolvedValue(undefined)
})

afterEach(() => {
  activeWrapper?.unmount()
  activeWrapper = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})





describe('四态展示与复制', () => {
  it('legacy:固定掩码展示,眼睛切明文,clipboard 取原值,成功无 toast', async () => {
    const tokens = new Map([[1, 'legacy-app-token']])
    useImmediateApis(tokens)
    const wrapper = await mountDetail(1)
    await flush()

    const code = wrapper.find('.token-display code')
    expect(code.exists()).toBe(true)
    expect(code.text()).toBe(TOKEN_MASK)

    expect(wrapper.text()).not.toContain('legacy-app-token')


    await wrapper.find('.token-toggle-btn').trigger('click')
    await flush()
    expect(wrapper.find('.token-display code').text()).toBe('legacy-app-token')

    await wrapper.find('.token-toggle-btn').trigger('click')
    await flush()
    expect(wrapper.find('.token-display code').text()).toBe(TOKEN_MASK)


    expect(wrapper.find('.token-copy-btn').exists()).toBe(true)
    await wrapper.find('.token-copy-btn').trigger('click')
    await flush()
    expect(writeText).toHaveBeenCalledWith('legacy-app-token')
    expect(wrapper.find('.token-copy-btn').html()).toContain('lucide-check')
    expect(mocks.showSuccess).not.toHaveBeenCalled()
  })

  it('valid:server publicForm 不进 DOM/剪贴板,展示与复制均为本地 privateForm', async () => {
    authService.setAppToken(2, PRIVATE_FORM)
    const tokens = new Map([[2, PUBLIC_FORM]])
    useImmediateApis(tokens)
    const wrapper = await mountDetail(2)
    await flush()

    expect(wrapper.find('.token-display code').text()).toBe(TOKEN_MASK)
    expect(wrapper.text()).not.toContain(PUBLIC_FORM)

    await wrapper.find('.token-toggle-btn').trigger('click')
    await flush()

    expect(wrapper.find('.token-display code').text()).toBe(PRIVATE_FORM)
    expect(wrapper.text()).not.toContain(PUBLIC_FORM)

    await wrapper.find('.token-copy-btn').trigger('click')
    await flush()
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith(PRIVATE_FORM)
    expect(writeText).not.toHaveBeenCalledWith(PUBLIC_FORM)
  })

  it.each([
    ['unknown(gtfy 异常 + 有本地缓存)', 3, 'gtfygarbage', PRIVATE_FORM, true],
    ['unknown(无本地凭据)', 4, PUBLIC_FORM, null, false],
    ['invalid(本地与 server 不匹配)', 5, PUBLIC_FORM, PRIVATE_FORM_2, false]
  ])('%s:令牌模块整节隐藏,仅操作行保留刷新入口;invalid 条件删除缓存', async (
    _label, id, serverToken, localToken, hasLocal
  ) => {
    if (hasLocal && typeof localToken === 'string') authService.setAppToken(id, localToken)
    const tokens = new Map([[id, serverToken]])
    useImmediateApis(tokens)
    const wrapper = await mountDetail(id)
    await flush()

    expect(wrapper.find('.token-display').exists()).toBe(false)
    expect(wrapper.find('.token-toggle-btn').exists()).toBe(false)
    expect(wrapper.find('.token-copy-btn').exists()).toBe(false)

    expect(wrapper.text()).not.toContain('Application Token')

    expect(wrapper.find('.regenerate-btn').exists()).toBe(true)

    if (id === 3) {

      expect(storedTokenOf(3)).toBe(PRIVATE_FORM)
    }
    if (id === 5) {

      expect(storedRawOf(5)).toBeNull()
    }
    expect(writeText).not.toHaveBeenCalled()
  })
})





describe('路由复用与竞态', () => {
  it('路由参数切换时组件实例复用(不重新 mounted)', async () => {
    useDeferredApis()
    const wrapper = await mountDetail(1)
    resolveDetail(1, 'legacy-1')
    await flush()
    resolveMessages(1, [11])
    await flush()
    const uidBefore = detailComponent(wrapper).vm.$.uid

    await router.push('/applications/2')
    await flush()
    resolveDetail(2, 'legacy-2')
    await flush()
    resolveMessages(2, [22])
    await flush()

    expect(detailComponent(wrapper).vm.$.uid).toBe(uidBefore)
    expect(wrapper.text()).toContain('App 2')
  })

  it('app 1 响应晚于切换:token、metadata、messages、loading 均不覆盖 app 2', async () => {
    useDeferredApis()
    const wrapper = await mountDetail(1)
    await flush()
    expect(mocks.getApplication).toHaveBeenCalledWith(1)


    await router.push('/applications/2')
    await flush()
    resolveDetail(2, 'legacy-2')
    await flush()
    resolveMessages(2, [22])
    await flush()


    resolveDetail(1, 'legacy-1', { description: 'OLD DESC' })
    await flush()
    expect(messageCallsFor(1)).toBe(0)


    expect(wrapper.text()).toContain('App 2')
    expect(wrapper.text()).toContain('desc 2')
    expect(wrapper.text()).not.toContain('OLD DESC')
    expect(wrapper.text()).not.toContain('legacy-1')

    expect(wrapper.find('.token-display code').text()).toBe(TOKEN_MASK)
    await wrapper.find('.token-toggle-btn').trigger('click')
    await flush()
    expect(wrapper.find('.token-display code').text()).toBe('legacy-2')
    expect(wrapper.find('.token-display code').text()).not.toBe('legacy-1')
    await wrapper.find('.token-toggle-btn').trigger('click')
    await flush()
    expect(wrapper.findAll('.message-item').length).toBe(1)
    expect(wrapper.text()).not.toContain('m11')

    expect(wrapper.find('.loading-spinner-stub').exists()).toBe(false)
    expect(mocks.showError).not.toHaveBeenCalled()
  })

  it('tokenVisible 与复制反馈随目标切换复位', async () => {
    authService.setAppToken(1, PRIVATE_FORM)
    useImmediateApis(new Map([[1, PUBLIC_FORM]]))
    const wrapper = await mountDetail(1)
    await flush()

    await wrapper.find('.token-toggle-btn').trigger('click')
    await wrapper.find('.token-copy-btn').trigger('click')
    await flush()
    expect(wrapper.find('.token-display code').text()).toBe(PRIVATE_FORM)
    expect(wrapper.find('.token-copy-btn').html()).toContain('lucide-check')


    vi.useFakeTimers()
    useImmediateApis(new Map([[2, 'gtfygarbage']]))
    await router.push('/applications/2')
    await flush()
    await flush()
    expect(wrapper.find('.token-toggle-btn').exists()).toBe(false)
    expect(wrapper.find('.token-copy-btn').exists()).toBe(false)
    expect(wrapper.text()).not.toContain(PRIVATE_FORM)

    vi.advanceTimersByTime(2000)
    await flush()
    expect(mocks.showError).not.toHaveBeenCalled()

    expect(writeText).toHaveBeenCalledTimes(1)
  })

  it('旧目标在途分页响应不追加到新目标', async () => {
    useDeferredApis()
    const wrapper = await mountDetail(1)
    resolveDetail(1, 'legacy-1')
    await flush()
    resolveMessages(1, [11], true)
    await flush()
    expect(wrapper.findAll('.message-item').length).toBe(1)


    await wrapper.find('.load-more-btn').trigger('click')
    await flush()
    await router.push('/applications/2')
    await flush()
    resolveDetail(2, 'legacy-2')
    await flush()
    resolveMessages(2, [22, 23])
    await flush()


    resolveMessages(1, [12, 13])
    await flush()

    const items = wrapper.findAll('.message-item')
    expect(items.length).toBe(2)
    expect(wrapper.text()).not.toContain('m12')
    expect(wrapper.text()).not.toContain('m13')
    expect(mocks.showError).not.toHaveBeenCalled()
  })
})



describe('同 app 重载与轮换隔离', () => {
  it('图片上传触发重载:旧 GET 不删缓存,新 GET 比对成功仍 valid(默认掩码)', async () => {
    authService.setAppToken(1, PRIVATE_FORM)
    useImmediateApis(new Map([[1, PUBLIC_FORM]]))
    const wrapper = await mountDetail(1)
    await flush()
    expect(wrapper.find('.token-display').exists()).toBe(true)
    expect(messageCallsFor(1)).toBe(1)


    mocks.uploadApplicationImage.mockResolvedValue({})
    const file = new File(['x'], 'icon.png')
    await wrapper.findComponent({ name: 'ApplicationIcon' }).vm.$emit('upload', file)
    await flush()
    expect(mocks.uploadApplicationImage).toHaveBeenCalledWith(1, file)

    expect(detailCallsFor(1)).toBe(2)
    await flush()

    expect(wrapper.find('.token-display').exists()).toBe(true)
    expect(wrapper.find('.token-display code').text()).toBe(TOKEN_MASK)
    expect(wrapper.text()).not.toContain(PUBLIC_FORM)
    expect(storedTokenOf(1)).toBe(PRIVATE_FORM)
  })

  it('编辑完成触发重载同样保持令牌校验语义', async () => {
    authService.setAppToken(1, PRIVATE_FORM)
    useImmediateApis(new Map([[1, PUBLIC_FORM]]))
    const wrapper = await mountDetail(1)
    await flush()

    await wrapper.find('.edit-btn').trigger('click')
    await flush()
    await wrapper.findComponent({ name: 'EditApplicationModal' }).vm.$emit('updated')
    await flush()
    expect(detailCallsFor(1)).toBe(2)
    await flush()
    expect(wrapper.find('.token-display code').text()).toBe(TOKEN_MASK)
    expect(storedTokenOf(1)).toBe(PRIVATE_FORM)
  })

})

describe('同 app 重载与轮换隔离(可控轮换 promise)', () => {
  it('旧 GET 晚于轮换:不删新缓存;轮换后重查恢复 valid 且默认掩码', async () => {
    authService.setAppToken(1, PRIVATE_FORM)
    useDeferredApis()
    const rotation = defer<{ data: { regenerateToken: { token: string } } }>()
    mocks.regenerateToken.mockImplementation(() => rotation.promise)

    const wrapper = await mountDetail(1)
    resolveDetail(1, PUBLIC_FORM)
    await flush()
    resolveMessages(1, [11])
    await flush()


    await wrapper.find('.regenerate-btn').trigger('click')
    await flush()
    window.dispatchEvent(new StorageEvent('storage', { key: 'woe_auth_app_1_token' }))
    await flush()
    expect(detailCallsFor(1)).toBe(2)

    confirmCurrentDialog()
    await flush()
    expect(mocks.regenerateToken).toHaveBeenCalledWith(1)


    rotation.resolve({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
    await flush()
    await flush()
    expect(storedTokenOf(1)).toBe(PRIVATE_FORM_2)
    expect(wrapper.find('.token-display code').text()).toBe(PRIVATE_FORM_2)


    resolveDetail(1, PUBLIC_FORM)
    await flush()
    expect(storedTokenOf(1)).toBe(PRIVATE_FORM_2)
    expect(wrapper.find('.token-display code').text()).toBe(PRIVATE_FORM_2)
    expect(mocks.showError).not.toHaveBeenCalled()


    window.dispatchEvent(new StorageEvent('storage', { key: 'woe_auth_app_1_token' }))
    await flush()
    resolveDetail(1, PUBLIC_FORM_2!)
    await flush()
    expect(wrapper.find('.token-display').exists()).toBe(true)
    expect(wrapper.find('.token-display code').text()).toBe(TOKEN_MASK)
    expect(storedTokenOf(1)).toBe(PRIVATE_FORM_2)
    await wrapper.find('.token-copy-btn').trigger('click')
    await flush()
    expect(writeText).toHaveBeenLastCalledWith(PRIVATE_FORM_2)
  })
})





describe('轮换归属守卫', () => {
  it('确认期间换 route:确认后不派发、不写缓存、不弹新目标 toast', async () => {
    authService.setAppToken(1, PRIVATE_FORM)
    useImmediateApis(new Map([[1, PUBLIC_FORM]]))
    const wrapper = await mountDetail(1)
    await flush()

    await wrapper.find('.regenerate-btn').trigger('click')
    await flush()
    expect(confirmContext!.state.value.visible).toBe(true)

    useImmediateApis(new Map<number, string | undefined>([[2, 'legacy-2']]))
    await router.push('/applications/2')
    await flush()
    confirmCurrentDialog()
    await flush()

    expect(mocks.regenerateToken).not.toHaveBeenCalled()
    expect(storedRawOf(1)).not.toBeNull()
    expect(wrapper.text()).toContain('App 2')
    expect(mocks.showSuccess).not.toHaveBeenCalled()
    expect(mocks.showError).not.toHaveBeenCalled()
  })

  it('确认期间换会话:不派发轮换', async () => {
    authService.setAppToken(1, PRIVATE_FORM)
    useImmediateApis(new Map([[1, PUBLIC_FORM]]))
    const wrapper = await mountDetail(1)
    await flush()

    await wrapper.find('.regenerate-btn').trigger('click')
    await flush()
    authService.setToken('client', 'new-client-token')
    confirmCurrentDialog()
    await flush()

    expect(mocks.regenerateToken).not.toHaveBeenCalled()
    expect(storedRawOf(1)).not.toBeNull()
    expect(mocks.showSuccess).not.toHaveBeenCalled()
  })

  it('同 app 重复轮换:仅派发一次', async () => {
    authService.setAppToken(1, PRIVATE_FORM)
    useImmediateApis(new Map([[1, PUBLIC_FORM]]))
    const rotation = defer<{ data: { regenerateToken: { token: string } } }>()
    mocks.regenerateToken.mockImplementation(() => rotation.promise)
    const wrapper = await mountDetail(1)
    await flush()

    await wrapper.find('.regenerate-btn').trigger('click')
    await flush()
    confirmCurrentDialog()
    await flush()
    expect(mocks.regenerateToken).toHaveBeenCalledTimes(1)

    await wrapper.find('.regenerate-btn').trigger('click')
    await flush()
    expect(confirmContext!.state.value.visible).toBe(false)
    expect(mocks.regenerateToken).toHaveBeenCalledTimes(1)

    rotation.resolve({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
    await flush()
    expect(storedTokenOf(1)).toBe(PRIVATE_FORM_2)
  })

  it('卸载后轮换响应到达:不写凭据、不弹 toast', async () => {
    authService.setAppToken(1, PRIVATE_FORM)
    useImmediateApis(new Map([[1, PUBLIC_FORM]]))
    const rotation = defer<{ data: { regenerateToken: { token: string } } }>()
    mocks.regenerateToken.mockImplementation(() => rotation.promise)
    const wrapper = await mountDetail(1)
    await flush()

    await wrapper.find('.regenerate-btn').trigger('click')
    await flush()
    confirmCurrentDialog()
    await flush()
    expect(mocks.regenerateToken).toHaveBeenCalledTimes(1)

    wrapper.unmount()
    rotation.resolve({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
    await flush()


    expect(storedTokenOf(1)).toBe(PRIVATE_FORM)
    expect(mocks.showSuccess).not.toHaveBeenCalled()
    expect(mocks.showError).not.toHaveBeenCalled()
  })

  it('提权期间换会话:重试闭包取消,敏感重试不发送', async () => {
    authService.setAppToken(1, PRIVATE_FORM)
    authService.setClientId(7)
    useImmediateApis(new Map([[1, PUBLIC_FORM]]))
    mocks.regenerateToken.mockRejectedValueOnce(new ForbiddenError('session not elevated'))
    const retry = defer<{ data: { regenerateToken: { token: string } } }>()
    mocks.regenerateToken.mockImplementationOnce(() => retry.promise)

    const wrapper = await mountDetail(1)
    await flush()

    await wrapper.find('.regenerate-btn').trigger('click')
    await flush()
    confirmCurrentDialog()
    await flush()
    expect(mocks.regenerateToken).toHaveBeenCalledTimes(1)


    authService.setToken('client', 'another-client-token')
    const { handleElevationConfirm } = useElevatedAction()
    handleElevationConfirm('pw-123')
    await flush()

    expect(mocks.elevateClient).not.toHaveBeenCalled()
    expect(mocks.regenerateToken).toHaveBeenCalledTimes(1)
    expect(storedTokenOf(1)).toBe(PRIVATE_FORM)

    expect(mocks.showError).not.toHaveBeenCalled()


    mocks.regenerateToken.mockReset()
    void retry
  })
})




describe('轮换存储异常', () => {
  it.each([true, false])('轮换期间重查迟到，保存失败时不能覆盖新私钥（已有缓存：%s）', async cached => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    if (cached) authService.setAppToken(1, PRIVATE_FORM)
    useDeferredApis()
    const rotation = defer<{ data: { regenerateToken: { token: string } } }>()
    mocks.regenerateToken.mockReturnValue(rotation.promise)
    const wrapper = await mountDetail(1)
    resolveDetail(1, PUBLIC_FORM)
    await flush()
    vi.spyOn(authService, 'setAppToken').mockImplementation(() => { throw new Error('quota exceeded') })

    await wrapper.find('.regenerate-btn').trigger('click')
    confirmCurrentDialog()
    await flush()


    window.dispatchEvent(new StorageEvent('storage', { key: 'woe_auth_app_1_token' }))
    await flush()
    expect(detailCallsFor(1)).toBe(2)
    rotation.resolve({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
    await flush()
    expect(wrapper.find('.token-display code').text()).toBe(PRIVATE_FORM_2)

    resolveDetail(1, PUBLIC_FORM)
    await flush()
    expect(wrapper.find('.token-copy-btn').exists()).toBe(true)
    await wrapper.find('.token-copy-btn').trigger('click')
    await flush()
    expect(writeText).toHaveBeenLastCalledWith(PRIVATE_FORM_2)
    expect(storedTokenOf(1)).toBe(cached ? PRIVATE_FORM : null)
    expect(detailCallsFor(1)).toBe(2)
  })

  it('轮换 HTTP 成功但 setAppToken 抛错:内存保留新 privateForm 可展示可复制,提示存储失败,缓存确未写入', async () => {


    useImmediateApis(new Map([[1, PUBLIC_FORM]]))
    mocks.regenerateToken.mockResolvedValue({
      data: { regenerateToken: { token: PRIVATE_FORM_2 } }
    })
    const setSpy = vi.spyOn(authService, 'setAppToken').mockImplementation(() => {
      throw new Error('quota exceeded')
    })

    const wrapper = await mountDetail(1)
    await flush()

    expect(wrapper.find('.token-display').exists()).toBe(false)

    await wrapper.find('.regenerate-btn').trigger('click')
    await flush()
    confirmCurrentDialog()
    await flush()


    expect(wrapper.find('.token-display code').text()).toBe(PRIVATE_FORM_2)
    await wrapper.find('.token-toggle-btn').trigger('click')
    await flush()
    expect(wrapper.find('.token-display code').text()).toBe(TOKEN_MASK)
    expect(wrapper.text()).not.toContain(PRIVATE_FORM_2)
    await wrapper.find('.token-toggle-btn').trigger('click')
    await flush()
    expect(wrapper.find('.token-display code').text()).toBe(PRIVATE_FORM_2)
    await wrapper.find('.token-copy-btn').trigger('click')
    await flush()
    expect(writeText).toHaveBeenLastCalledWith(PRIVATE_FORM_2)


    const shownContexts = mocks.showError.mock.calls.map((call) => call[1])
    expect(shownContexts).toContain('The new token was generated but could not be saved in this browser. Copy and save it before leaving.')
    expect(shownContexts).not.toContain('Token refreshed. Copy and store it now.')
    expect(mocks.showSuccess).not.toHaveBeenCalled()


    expect(storedRawOf(1)).toBeNull()
    expect(storedTokenOf(1)).toBeNull()

    setSpy.mockRestore()
  })
})




describe('会话与 storage 失效', () => {
  const setupValidApp = async (): Promise<VueWrapper> => {
    authService.setAppToken(1, PRIVATE_FORM)
    useDeferredApis()
    const wrapper = await mountDetail(1)
    resolveDetail(1, PUBLIC_FORM)
    await flush()
    resolveMessages(1, [11])
    await flush()
    expect(wrapper.find('.token-copy-btn').exists()).toBe(true)
    return wrapper
  }

  it('storage 事件:立即隐藏,重查恢复 valid', async () => {
    const wrapper = await setupValidApp()

    window.dispatchEvent(new StorageEvent('storage', { key: 'woe_auth_app_1_token' }))
    await flush()

    expect(wrapper.find('.token-copy-btn').exists()).toBe(false)
    expect(detailCallsFor(1)).toBe(2)
    resolveDetail(1, PUBLIC_FORM)
    await flush()
    expect(wrapper.find('.token-copy-btn').exists()).toBe(true)


    const before = mocks.getApplication.mock.calls.length
    window.dispatchEvent(new StorageEvent('storage', { key: 'locale' }))
    await flush()
    expect(mocks.getApplication.mock.calls.length).toBe(before)
  })

  it('本应用缓存键写入撞在途 GET:静默重查,不闪可重试错误态', async () => {
    authService.setAppToken(1, PRIVATE_FORM)
    useDeferredApis()
    const wrapper = await mountDetail(1)

    await flush()
    expect(wrapper.find('.loading-container').exists()).toBe(true)


    window.dispatchEvent(new StorageEvent('storage', { key: 'woe_auth_app_1_token' }))
    await flush()

    expect(wrapper.find('.loading-container').exists()).toBe(true)


    resolveDetail(1, PUBLIC_FORM)
    await flush()

    expect(detailCallsFor(1)).toBe(2)


    resolveDetail(1, PUBLIC_FORM)
    await flush()
    resolveMessages(1, [11])
    await flush()
    expect(wrapper.find('.loading-container').exists()).toBe(false)
    expect(wrapper.find('.error-message').exists()).toBe(false)
    expect(wrapper.find('.retry-btn').exists()).toBe(false)
    expect(wrapper.find('.token-display').exists()).toBe(true)
  })

  it('当前 401(真实既有失效路径 clearAllAuth):隐藏且不重查;旧 200 不恢复 token', async () => {
    const wrapper = await setupValidApp()


    window.dispatchEvent(new StorageEvent('storage', { key: 'woe_auth_app_1_token' }))
    await flush()
    expect(detailCallsFor(1)).toBe(2)


    authService.clearAllAuth()
    await flush()
    expect(wrapper.find('.token-copy-btn').exists()).toBe(false)

    expect(detailCallsFor(1)).toBe(2)


    resolveDetail(1, PUBLIC_FORM)
    await flush()
    expect(wrapper.find('.token-copy-btn').exists()).toBe(false)


    authService.setToken('client', 'relogin-token')
    await flush()
    expect(detailCallsFor(1)).toBe(3)
    resolveDetail(1, PUBLIC_FORM)
    await flush()
    expect(wrapper.find('.token-copy-btn').exists()).toBe(false)


    authService.setAppToken(1, PRIVATE_FORM)
    window.dispatchEvent(new StorageEvent('storage', { key: 'woe_auth_app_1_token' }))
    await flush()
    resolveDetail(1, PUBLIC_FORM)
    await flush()
    expect(wrapper.find('.token-copy-btn').exists()).toBe(true)
  })

  it('详情 GET 网络失败:隐藏但不删凭据;错误展示并可重试', async () => {
    authService.setAppToken(1, PRIVATE_FORM)
    useDeferredApis()
    const wrapper = await mountDetail(1)
    rejectDetail(1, new Error('network down'))
    await flush()

    expect(wrapper.find('.token-display').exists()).toBe(false)
    expect(storedTokenOf(1)).toBe(PRIVATE_FORM)
    expect(wrapper.text()).toContain('Retry')
    expect(mocks.showError).toHaveBeenCalled()


    useImmediateApis(new Map([[1, PUBLIC_FORM]]))
    await wrapper.find('.retry-btn').trigger('click')
    await flush()
    expect(wrapper.find('.token-display').exists()).toBe(true)
  })

  it('换凭据撞上在途详情 GET:清空并按新会话重载,迟到旧响应不回写', async () => {
    useDeferredApis()
    const wrapper = await mountDetail(1)
    await flush()
    expect(wrapper.find('.loading-spinner-stub').exists()).toBe(true)


    authService.setToken('client', 'cross-tab-token')
    await flush()
    expect(detailCallsFor(1)).toBe(2)
    expect(wrapper.text()).not.toContain('App 1')


    resolveDetail(1, 'legacy-1')
    await flush()
    expect(wrapper.find('.loading-spinner-stub').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('App 1')


    resolveDetail(1, 'legacy-1')
    await flush()
    expect(wrapper.find('.retry-btn').exists()).toBe(false)
    expect(wrapper.text()).toContain('App 1')
    resolveMessages(1, [21])
    await flush()
    expect(wrapper.find('.loading-spinner-stub').exists()).toBe(false)
    expect(mocks.showError).not.toHaveBeenCalled()
  })
})





describe('复制反馈生命周期', () => {
  const setupValidApp = async (): Promise<VueWrapper> => {
    authService.setAppToken(1, PRIVATE_FORM)
    useImmediateApis(new Map([[1, PUBLIC_FORM]]))
    const wrapper = await mountDetail(1)
    await flush()
    return wrapper
  }

  const copyButton = (wrapper: VueWrapper) => wrapper.find('.token-copy-btn')

  it('t=0/t=1000ms 连续复制,乱序完成:从最近有效成功起 1500ms 复位', async () => {
    vi.useFakeTimers()
    const wrapper = await setupValidApp()
    const firstClip = defer<void>()
    const secondClip = defer<void>()
    let clipCall = 0
    writeText.mockImplementation(() => (clipCall++ === 0 ? firstClip.promise : secondClip.promise))

    await copyButton(wrapper).trigger('click')
    await flush()
    expect(copyButton(wrapper).html()).toContain('lucide-copy')

    vi.advanceTimersByTime(1000)
    await copyButton(wrapper).trigger('click')
    await flush()
    expect(copyButton(wrapper).html()).toContain('lucide-copy')

    secondClip.resolve()
    await flush()
    expect(copyButton(wrapper).html()).toContain('lucide-check')

    firstClip.resolve()
    await flush()
    expect(copyButton(wrapper).html()).toContain('lucide-check')

    vi.advanceTimersByTime(1499)
    await flush()
    expect(copyButton(wrapper).html()).toContain('lucide-check')

    vi.advanceTimersByTime(1)
    await flush()
    expect(copyButton(wrapper).html()).toContain('lucide-copy')
    expect(mocks.showSuccess).not.toHaveBeenCalled()
  })

  it('复制失败:showError、无成功 toast、无成功图标;迟到失败无副作用', async () => {
    vi.useFakeTimers()
    const wrapper = await setupValidApp()
    const firstClip = defer<void>()
    const secondClip = defer<void>()
    let clipCall = 0
    writeText.mockImplementation(() => (clipCall++ === 0 ? firstClip.promise : secondClip.promise))

    await copyButton(wrapper).trigger('click')
    vi.advanceTimersByTime(50)
    await copyButton(wrapper).trigger('click')
    await flush()
    secondClip.resolve()
    await flush()
    expect(copyButton(wrapper).html()).toContain('lucide-check')

    firstClip.reject(new Error('late failure'))
    await flush()
    expect(mocks.showError).not.toHaveBeenCalled()
    expect(copyButton(wrapper).html()).toContain('lucide-check')

    vi.advanceTimersByTime(1500)
    await flush()
    expect(copyButton(wrapper).html()).toContain('lucide-copy')
  })

  it('复制失败(非乱序):showError 且无成功反馈', async () => {
    vi.useFakeTimers()
    const wrapper = await setupValidApp()
    writeText.mockRejectedValue(new Error('denied'))
    await copyButton(wrapper).trigger('click')
    await flush()
    expect(mocks.showError).toHaveBeenCalled()
    expect(mocks.showSuccess).not.toHaveBeenCalled()
    expect(copyButton(wrapper).html()).toContain('lucide-copy')
  })

  it('卸载后剪贴板迟到完成:无副作用,timer 清理', async () => {
    vi.useFakeTimers()
    const wrapper = await setupValidApp()
    const clip = defer<void>()
    writeText.mockImplementation(() => clip.promise)

    await copyButton(wrapper).trigger('click')
    await flush()
    wrapper.unmount()

    clip.resolve()
    await flush()
    vi.advanceTimersByTime(2000)
    await flush()
    expect(mocks.showError).not.toHaveBeenCalled()
    expect(mocks.showSuccess).not.toHaveBeenCalled()
  })
})

describe('跨标签页敏感操作与消息归属', () => {
  const replaceClientFromOtherTab = (): void => {
    localStorage.setItem('woe_auth_client_token', CryptoJS.AES.encrypt(JSON.stringify({
      token: 'other-tab-client', type: 'client', expires: new Date(Date.now() + 86400000).toISOString()
    }), ENCRYPTION_KEY).toString())
  }

  it('跨 tab 换凭据发生在确认期间:不派发轮换', async () => {
    useImmediateApis(new Map([[1, undefined]]))
    const wrapper = await mountDetail(1)
    await flush()
    await wrapper.find('.regenerate-btn').trigger('click')
    replaceClientFromOtherTab()
    confirmCurrentDialog()
    await flush()
    expect(mocks.regenerateToken).not.toHaveBeenCalled()
  })

  it('跨 tab 换凭据发生在轮换 HTTP 在途:迟到私钥不缓存/不展示', async () => {
    useImmediateApis(new Map([[1, undefined]]))
    const rotation = defer<{ data: { regenerateToken: { token: string } } }>()
    mocks.regenerateToken.mockReturnValue(rotation.promise)
    const wrapper = await mountDetail(1)
    await flush()
    await wrapper.find('.regenerate-btn').trigger('click')
    confirmCurrentDialog()
    await flush()
    replaceClientFromOtherTab()
    rotation.resolve({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
    await flush()
    expect(storedRawOf(1)).toBeNull()
    expect(wrapper.find('.token-copy-btn').exists()).toBe(false)
    expect(mocks.showSuccess).not.toHaveBeenCalled()
  })

  it('跨 tab 换凭据后旧消息响应不写入当前页面', async () => {
    useDeferredApis()
    const wrapper = await mountDetail(1)
    resolveDetail(1, 'legacy-1')
    await flush()
    replaceClientFromOtherTab()
    resolveMessages(1, [11])
    await flush()
    expect(wrapper.findAll('.message-item')).toHaveLength(0)
  })
})

describe('详情令牌重查乱序', () => {
  it('最新重查成功后，较早的网络失败不能隐藏已验证令牌', async () => {
    authService.setAppToken(1, PRIVATE_FORM)
    useDeferredApis()
    const wrapper = await mountDetail(1)
    resolveDetail(1, PUBLIC_FORM)
    await flush()
    window.dispatchEvent(new StorageEvent('storage', { key: 'woe_auth_app_1_token' }))
    await flush()
    window.dispatchEvent(new StorageEvent('storage', { key: 'woe_auth_app_1_token' }))
    await flush()
    const pending = pendingDetails.get(1)!
    expect(pending).toHaveLength(3)
    pending[2].resolve({ data: makeApp(1, { token: PUBLIC_FORM }) })
    await flush()
    expect(wrapper.find('.token-copy-btn').exists()).toBe(true)
    pending[1].reject(new Error('older network failure'))
    await flush()
    expect(wrapper.find('.token-copy-btn').exists()).toBe(true)
    await wrapper.find('.token-copy-btn').trigger('click')
    await flush()
    expect(writeText).toHaveBeenLastCalledWith(PRIVATE_FORM)
  })

  it('最新重查 unknown 后，较早的 legacy 响应不能复活复制入口', async () => {
    useDeferredApis()
    const wrapper = await mountDetail(1)
    resolveDetail(1, 'legacy-initial')
    await flush()
    window.dispatchEvent(new StorageEvent('storage', { key: 'woe_auth_app_1_token' }))
    await flush()
    window.dispatchEvent(new StorageEvent('storage', { key: 'woe_auth_app_1_token' }))
    await flush()
    const pending = pendingDetails.get(1)!
    pending[2].resolve({ data: makeApp(1) })
    await flush()
    expect(wrapper.find('.token-copy-btn').exists()).toBe(false)
    pending[1].resolve({ data: makeApp(1, { token: 'legacy-stale' }) })
    await flush()
    expect(wrapper.find('.token-copy-btn').exists()).toBe(false)
  })
})

describe('详情复制反馈与轮换控件', () => {
  it('成功后再次复制失败:原成功反馈仍在1500ms到期恢复', async () => {
    vi.useFakeTimers()
    useImmediateApis(new Map([[1, 'legacy-1']]))
    const wrapper = await mountDetail(1)
    await flush()
    writeText.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'))
    const copy = wrapper.find('.token-copy-btn')
    await copy.trigger('click')
    await flush()
    vi.advanceTimersByTime(1000)
    await copy.trigger('click')
    await flush()
    vi.advanceTimersByTime(500)
    await flush()
    expect(copy.html()).toContain('lucide-copy')
  })

  it('轮换确认/HTTP等待期间按钮实际disabled，取消后恢复', async () => {
    useImmediateApis(new Map([[1, undefined]]))
    const wrapper = await mountDetail(1)
    await flush()
    await wrapper.find('.regenerate-btn').trigger('click')
    await flush()
    expect(wrapper.find('.regenerate-btn').attributes('disabled')).toBeDefined()
    confirmContext!.handleCancel()
    await flush()
    expect(wrapper.find('.regenerate-btn').attributes('disabled')).toBeUndefined()
  })

  it.each(['gtfygarbage', 'gtfya.short', 'gtfya.a.b.c'])('轮换响应 %s 不写凭据缓存', async (token) => {
    useImmediateApis(new Map([[1, undefined]]))
    mocks.regenerateToken.mockResolvedValue({ data: { regenerateToken: { token } } })
    const wrapper = await mountDetail(1)
    await flush()
    await wrapper.find('.regenerate-btn').trigger('click')
    confirmCurrentDialog()
    await flush()
    expect(storedRawOf(1)).toBeNull()
    expect(wrapper.find('.token-copy-btn').exists()).toBe(false)
    expect(mocks.showError).toHaveBeenCalledTimes(1)
  })
})

describe('详情与真实提权流程连接', () => {
  it.each(['cancel', 'exhausted'])('提权%s后重新验证旧缓存并恢复复制', async (outcome) => {
    authService.setAppToken(1, PRIVATE_FORM)
    authService.setClientId(7)
    useImmediateApis(new Map([[1, PUBLIC_FORM]]))
    mocks.regenerateToken.mockRejectedValueOnce(new ForbiddenError('session not elevated'))
    mocks.elevateClient.mockRejectedValue(new ForbiddenError('wrong password'))
    const wrapper = await mountDetail(1)
    await flush()
    await wrapper.find('.regenerate-btn').trigger('click')
    confirmCurrentDialog()
    await flush()
    expect(wrapper.find('.token-copy-btn').exists()).toBe(false)
    if (outcome === 'cancel') {
      useElevatedAction().handleElevationCancel()
    } else {
      for (let attempt = 0; attempt < 3; attempt++) {
        useElevatedAction().handleElevationConfirm('wrong-password')
        await flush()
      }
    }
    await flush()
    expect(storedTokenOf(1)).toBe(PRIVATE_FORM)
    expect(wrapper.find('.regenerate-btn').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.token-copy-btn').exists()).toBe(true)
    await wrapper.find('.token-copy-btn').trigger('click')
    expect(writeText).toHaveBeenLastCalledWith(PRIVATE_FORM)
    expect(mocks.showError).not.toHaveBeenCalled()
    useElevatedAction().handleElevationCancel()
  })

  it('等待提权密码时详情卸载:不发送提权HTTP、旧私钥不被覆盖', async () => {
    authService.setAppToken(1, PRIVATE_FORM)
    authService.setClientId(7)
    useImmediateApis(new Map([[1, PUBLIC_FORM]]))
    mocks.regenerateToken.mockRejectedValueOnce(new ForbiddenError('session not elevated'))
    const wrapper = await mountDetail(1)
    await flush()
    await wrapper.find('.regenerate-btn').trigger('click')
    confirmCurrentDialog()
    await flush()
    expect(useElevatedAction().isElevationModalOpen.value).toBe(true)
    wrapper.unmount()
    activeWrapper = null
    useElevatedAction().handleElevationConfirm('pw-123')
    await flush()
    expect(mocks.elevateClient).not.toHaveBeenCalled()
    expect(mocks.regenerateToken).toHaveBeenCalledTimes(1)
    expect(storedTokenOf(1)).toBe(PRIVATE_FORM)
    expect(mocks.showError).not.toHaveBeenCalled()
  })
})



describe('storage 事件语义化过滤(仅当前目标应用)', () => {
  const setupValidApp = async (): Promise<VueWrapper> => {
    authService.setAppToken(1, PRIVATE_FORM)
    useDeferredApis()
    const wrapper = await mountDetail(1)
    resolveDetail(1, PUBLIC_FORM)
    await flush()
    resolveMessages(1, [11])
    await flush()
    expect(wrapper.find('.token-copy-btn').exists()).toBe(true)
    return wrapper
  }

  it('他应用键与无关键(woe_auth_preferences)不触发重查;本应用键与 null 照旧', async () => {
    const wrapper = await setupValidApp()
    expect(detailCallsFor(1)).toBe(1)


    window.dispatchEvent(new StorageEvent('storage', { key: 'woe_auth_app_999_token' }))
    await flush()
    expect(detailCallsFor(1)).toBe(1)
    expect(wrapper.find('.token-copy-btn').exists()).toBe(true)


    window.dispatchEvent(new StorageEvent('storage', { key: 'woe_auth_preferences' }))
    await flush()
    expect(detailCallsFor(1)).toBe(1)
    expect(wrapper.find('.token-copy-btn').exists()).toBe(true)


    window.dispatchEvent(new StorageEvent('storage', { key: 'woe_auth_app_1_token' }))
    await flush()
    expect(detailCallsFor(1)).toBe(2)
    resolveDetail(1, PUBLIC_FORM)
    await flush()
    expect(wrapper.find('.token-copy-btn').exists()).toBe(true)


    window.dispatchEvent(new StorageEvent('storage', { key: null }))
    await flush()
    expect(detailCallsFor(1)).toBe(3)
    resolveDetail(1, PUBLIC_FORM)
    await flush()
    expect(wrapper.find('.token-copy-btn').exists()).toBe(true)
  })
})

describe('会话变更的账号内容清理与重载', () => {
  it('换凭据:旧账号 metadata/messages 立即清空,详情与消息以新会话重发', async () => {
    useDeferredApis()
    const wrapper = await mountDetail(1)
    resolveDetail(1, 'legacy-1')
    await flush()
    resolveMessages(1, [11])
    await flush()
    expect(wrapper.text()).toContain('App 1')
    expect(wrapper.text()).toContain('desc 1')
    expect(wrapper.findAll('.message-item').length).toBe(1)


    authService.setToken('client', 'new-account-token')
    await flush()
    expect(wrapper.text()).not.toContain('App 1')
    expect(wrapper.text()).not.toContain('desc 1')
    expect(wrapper.findAll('.message-item').length).toBe(0)
    expect(detailCallsFor(1)).toBe(2)


    resolveDetail(1, 'legacy-1')
    await flush()
    expect(wrapper.text()).toContain('App 1')
    expect(messageCallsFor(1)).toBe(2)
    resolveMessages(1, [22])
    await flush()
    expect(wrapper.findAll('.message-item').length).toBe(1)
  })

  it('登出:账号内容清空且不发出任何请求', async () => {
    authService.setAppToken(1, PRIVATE_FORM)
    useDeferredApis()
    const wrapper = await mountDetail(1)
    resolveDetail(1, PUBLIC_FORM)
    await flush()
    resolveMessages(1, [11])
    await flush()
    expect(wrapper.text()).toContain('App 1')
    expect(wrapper.text()).toContain('desc 1')
    const detailBefore = mocks.getApplication.mock.calls.length
    const messageBefore = mocks.getApplicationMessages.mock.calls.length

    authService.clearAllAuth()
    await flush()

    expect(wrapper.text()).not.toContain('App 1')
    expect(wrapper.text()).not.toContain('desc 1')
    expect(wrapper.find('.token-copy-btn').exists()).toBe(false)
    expect(wrapper.findAll('.message-item').length).toBe(0)
    expect(mocks.getApplication).toHaveBeenCalledTimes(detailBefore)
    expect(mocks.getApplicationMessages).toHaveBeenCalledTimes(messageBefore)
  })
})

describe('真正跨标签页的详情账号清理', () => {
  const setupLoaded = async (): Promise<VueWrapper> => {
    useDeferredApis()
    const wrapper = await mountDetail(1)
    resolveDetail(1, 'legacy-1')
    await flush()
    resolveMessages(1, [11])
    await flush()
    return wrapper
  }

  it('跨tab凭据变化直接清空metadata/messages并重载详情', async () => {
    const wrapper = await setupLoaded()
    const revision = authService.getSessionRevision()
    localStorage.setItem('woe_auth_client_token', CryptoJS.AES.encrypt(JSON.stringify({
      token: 'cross-tab-new-account', type: 'client', expires: new Date(Date.now() + 86400000).toISOString()
    }), ENCRYPTION_KEY).toString())
    window.dispatchEvent(new StorageEvent('storage', { key: 'woe_auth_client_token', storageArea: localStorage }))
    await flush()
    expect(authService.getSessionRevision()).toBe(revision)
    expect(wrapper.text()).not.toContain('App 1')
    expect(wrapper.findAll('.message-item')).toHaveLength(0)
    expect(detailCallsFor(1)).toBe(2)
    resolveDetail(1, 'legacy-new', { name: 'New session application' })
    await flush()
    expect(wrapper.text()).toContain('New session application')
    expect(messageCallsFor(1)).toBe(2)
  })

  it.each(['woe_auth_client_token', null])('跨tab登出 key=%s 清空metadata/messages且不重查', async key => {
    const wrapper = await setupLoaded()
    const detailBefore = detailCallsFor(1)
    const messagesBefore = messageCallsFor(1)
    if (key === null) localStorage.clear()
    else localStorage.removeItem(key)
    window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }))
    await flush()
    expect(wrapper.text()).not.toContain('App 1')
    expect(wrapper.findAll('.message-item')).toHaveLength(0)
    expect(detailCallsFor(1)).toBe(detailBefore)
    expect(messageCallsFor(1)).toBe(messagesBefore)
  })
})


describe('同会话跨tab轮换响应归属', () => {
  const seed3 = new Uint8Array(32)
  seed3[0] = 3
  const PRIVATE_FORM_3 = `gtfya.${base64UrlEncode(seed3)}`
  const PUBLIC_FORM_3 = derivePublicForm(PRIVATE_FORM_3)!
  const startRotation = async () => {
    authService.setAppToken(1, PRIVATE_FORM)
    const rotation = defer<{ data: { regenerateToken: { token: string } } }>()
    mocks.regenerateToken.mockReturnValue(rotation.promise)
    useImmediateApis(new Map([[1, PUBLIC_FORM]]))
    const wrapper = await mountDetail(1)
    await flush()
    await wrapper.find('.regenerate-btn').trigger('click')
    confirmCurrentDialog()
    await flush()
    return { wrapper, rotation }
  }

  it('较晚返回的旧轮换不能覆盖另一tab已生效的新私钥', async () => {
    const { wrapper, rotation } = await startRotation()
    authService.setAppToken(1, PRIVATE_FORM_3)
    useImmediateApis(new Map([[1, PUBLIC_FORM_3]]))
    window.dispatchEvent(new StorageEvent('storage', { key: 'woe_auth_app_1_token' }))
    await flush()
    rotation.resolve({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
    await flush()
    expect(storedTokenOf(1)).toBe(PRIVATE_FORM_3)
    await wrapper.find('.token-copy-btn').trigger('click')
    expect(writeText).toHaveBeenLastCalledWith(PRIVATE_FORM_3)
  })

  it('缓存变更后GET仍确认返回私钥有效时接受该新私钥', async () => {
    const { wrapper, rotation } = await startRotation()
    authService.setAppToken(1, PRIVATE_FORM_3)
    const validation = defer<DetailResponse>()
    mocks.getApplication.mockReturnValueOnce(validation.promise)
    rotation.resolve({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
    await flush()
    expect(storedTokenOf(1)).toBe(PRIVATE_FORM_3)
    validation.resolve({ data: { token: PUBLIC_FORM_2! } })
    await flush()
    expect(storedTokenOf(1)).toBe(PRIVATE_FORM_2)
    await wrapper.find('.token-copy-btn').trigger('click')
    expect(writeText).toHaveBeenLastCalledWith(PRIVATE_FORM_2)
  })

  it('只有storage事件但缓存原值未变时仍接受合法轮换响应', async () => {
    const { wrapper, rotation } = await startRotation()
    window.dispatchEvent(new StorageEvent('storage', { key: 'woe_auth_app_1_token' }))
    await flush()
    rotation.resolve({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
    await flush()
    expect(storedTokenOf(1)).toBe(PRIVATE_FORM_2)
    await wrapper.find('.token-copy-btn').trigger('click')
    expect(writeText).toHaveBeenLastCalledWith(PRIVATE_FORM_2)
  })

  it('验证GET期间再次写入缓存时不以过期验证覆盖更新的私钥', async () => {
    const { wrapper, rotation } = await startRotation()
    authService.setAppToken(1, PRIVATE_FORM_3)
    const validation = defer<DetailResponse>()
    mocks.getApplication.mockReturnValueOnce(validation.promise)
    rotation.resolve({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
    await flush()
    authService.setAppToken(1, PRIVATE_FORM)
    useImmediateApis(new Map([[1, PUBLIC_FORM]]))
    validation.resolve({ data: { token: PUBLIC_FORM_2! } })
    await flush()
    expect(storedTokenOf(1)).toBe(PRIVATE_FORM)
    await wrapper.find('.token-copy-btn').trigger('click')
    expect(writeText).toHaveBeenLastCalledWith(PRIVATE_FORM)
  })

  it('验证GET失败时保留新缓存并隐藏未经验证的返回私钥', async () => {
    const { wrapper, rotation } = await startRotation()
    authService.setAppToken(1, PRIVATE_FORM_3)
    mocks.getApplication.mockRejectedValue(new Error('offline'))
    rotation.resolve({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
    await flush()
    expect(storedTokenOf(1)).toBe(PRIVATE_FORM_3)
    expect(wrapper.find('.token-copy-btn').exists()).toBe(false)
  })

  it.each(['session', 'route'])('验证GET期间%s失效时迟到验证不得保存或展示私钥', async (invalidation) => {
    const { wrapper, rotation } = await startRotation()
    authService.setAppToken(1, PRIVATE_FORM_3)
    const validation = defer<DetailResponse>()
    mocks.getApplication.mockReturnValueOnce(validation.promise)
    rotation.resolve({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
    await flush()
    expect(storedTokenOf(1)).toBe(PRIVATE_FORM_3)
    const raw = storedRawOf(1)
    if (invalidation === 'session') authService.removeToken('client')
    if (invalidation === 'route') await router.push('/applications')
    validation.resolve({ data: { token: PUBLIC_FORM_2! } })
    await flush()
    expect(storedRawOf(1)).toBe(raw)
    expect(wrapper.find('.token-copy-btn').exists()).toBe(false)
  })
})


describe('同目标普通元数据刷新与轮换隔离', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}))

  for (const cached of [false, true]) for (const quota of [false, true]) {
    it.each(['before', 'after', 'failed-before', 'failed-after'])('初始缓存='+cached+' 存储失败='+quota+' 元数据%s轮换仍可复制', async (order) => {
      if (cached) authService.setAppToken(1, PRIVATE_FORM)
      useImmediateApis(new Map([[1, PUBLIC_FORM]]))
      const icon = defer<unknown>()
      const metadata = defer<DetailResponse>()
      const rotation = defer<{ data: { regenerateToken: { token: string } } }>()
      mocks.uploadApplicationImage.mockReturnValue(icon.promise)
      mocks.regenerateToken.mockReturnValue(rotation.promise)
      const wrapper = await mountDetail(1); await flush()
      wrapper.findComponent({ name: 'ApplicationIcon' }).vm.$emit('upload', new File(['a'], 'a.png'))
      await wrapper.find('.regenerate-btn').trigger('click'); confirmCurrentDialog(); await flush()
      mocks.getApplication.mockReturnValueOnce(metadata.promise)
      icon.resolve({}); await flush()
      if (quota) vi.spyOn(authService, 'setAppToken').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError') })
      const finishMetadata = async () => {
        if (order.startsWith('failed')) metadata.reject(new Error('offline'))
        else metadata.resolve({ data: makeApp(1, { token: PUBLIC_FORM, name: 'Updated app' }) })
        await flush()
      }
      if (order.endsWith('before')) {
        await finishMetadata()
        expect(wrapper.find('.token-copy-btn').exists()).toBe(false)
      }
      rotation.resolve({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } }); await flush()
      if (order.endsWith('after')) await finishMetadata()
      expect(wrapper.find('.error-container').exists()).toBe(false)
      expect(wrapper.find('.token-display code').text()).toBe(PRIVATE_FORM_2)
      await wrapper.find('.token-copy-btn').trigger('click'); await flush()
      expect(writeText).toHaveBeenLastCalledWith(PRIVATE_FORM_2)
      expect(storedTokenOf(1)).toBe(quota ? (cached ? PRIVATE_FORM : null) : PRIVATE_FORM_2)
    })
  }

  it('已显示未持久化seed后无关编辑重载仍可复制，旧GET不能删除未变缓存', async () => {
    authService.setAppToken(1, PRIVATE_FORM)
    useImmediateApis(new Map([[1, PUBLIC_FORM]]))
    mocks.regenerateToken.mockResolvedValue({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
    const wrapper = await mountDetail(1); await flush()
    const raw = storedRawOf(1)
    vi.spyOn(authService, 'setAppToken').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError') })
    await wrapper.find('.regenerate-btn').trigger('click'); confirmCurrentDialog(); await flush()
    await wrapper.find('.edit-btn').trigger('click')
    const metadata = defer<DetailResponse>()
    mocks.getApplication.mockReturnValueOnce(metadata.promise)
    wrapper.findComponent({ name: 'EditApplicationModal' }).vm.$emit('updated'); await flush()
    metadata.resolve({ data: makeApp(1, { token: PUBLIC_FORM_2, name: 'Updated app' }) }); await flush()
    expect(wrapper.find('.app-name').text()).toBe('Updated app')
    expect(wrapper.find('.token-display code').text()).toBe(PRIVATE_FORM_2)
    expect(storedRawOf(1)).toBe(raw)
    await wrapper.find('.token-copy-btn').trigger('click')
    expect(writeText).toHaveBeenLastCalledWith(PRIVATE_FORM_2)
  })

  it('A到B再回A后旧轮换仍不能恢复私钥', async () => {
    useImmediateApis(new Map([[1, PUBLIC_FORM], [2, PUBLIC_FORM]]))
    const rotation = defer<{ data: { regenerateToken: { token: string } } }>()
    mocks.regenerateToken.mockReturnValue(rotation.promise)
    const wrapper = await mountDetail(1); await flush()
    await wrapper.find('.regenerate-btn').trigger('click'); confirmCurrentDialog(); await flush()
    await router.push('/applications/2'); await flush()
    await router.push('/applications/1'); await flush()
    rotation.resolve({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } }); await flush()
    expect(storedTokenOf(1)).toBeNull()
    expect(wrapper.find('.token-copy-btn').exists()).toBe(false)
  })
})


it('新派发metadata GET仍校验token，第三方轮换后隐藏旧seed', async () => {
  useImmediateApis(new Map([[1, PUBLIC_FORM]]))
  mocks.regenerateToken.mockResolvedValue({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
  const wrapper = await mountDetail(1); await flush()
  await wrapper.find('.regenerate-btn').trigger('click'); confirmCurrentDialog(); await flush()
  await wrapper.find('.edit-btn').trigger('click')
  wrapper.findComponent({ name: 'EditApplicationModal' }).vm.$emit('updated'); await flush()
  expect(wrapper.find('.token-copy-btn').exists()).toBe(false)
  expect(storedTokenOf(1)).toBeNull()
})


it.each(['404', 'delete'])('目标%s确认删除后，轮换200不能复活seed', async (action) => {
  useImmediateApis(new Map([[1, PUBLIC_FORM]]))
  const rotation = defer<{ data: { regenerateToken: { token: string } } }>()
  mocks.regenerateToken.mockReturnValue(rotation.promise)
  const wrapper = await mountDetail(1); await flush()
  await wrapper.find('.regenerate-btn').trigger('click'); confirmCurrentDialog(); await flush()
  if (action === '404') {
    mocks.getApplication.mockRejectedValueOnce(Object.assign(new Error('deleted'), { statusCode: 404 }))
    await wrapper.find('.edit-btn').trigger('click')
    wrapper.findComponent({ name: 'EditApplicationModal' }).vm.$emit('updated'); await flush()
  } else {
    mocks.deleteApplication.mockResolvedValue({})
    await wrapper.find('.delete-btn').trigger('click'); confirmCurrentDialog(); await flush()
  }
  rotation.resolve({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } }); await flush()
  expect(storedTokenOf(1)).toBeNull()
  expect(wrapper.find('.token-copy-btn').exists()).toBe(false)
})

it.each(['route', 'route-return', 'session', 'unmount'])('metadata GET在%s失效后不能写入内容或私钥', async (action) => {
  useImmediateApis(new Map([[1, PUBLIC_FORM], [2, PUBLIC_FORM]]))
  const wrapper = await mountDetail(1); await flush()
  const metadata = defer<DetailResponse>()
  mocks.getApplication.mockReturnValueOnce(metadata.promise)
  await wrapper.find('.edit-btn').trigger('click')
  wrapper.findComponent({ name: 'EditApplicationModal' }).vm.$emit('updated'); await flush()
  if (action === 'route' || action === 'route-return') { await router.push('/applications/2'); await flush() }
  if (action === 'route-return') { await router.push('/applications/1'); await flush() }
  if (action === 'session') { authService.setToken('client', 'next-client'); await flush() }
  if (action === 'unmount') { wrapper.unmount(); activeWrapper = null }
  metadata.resolve({ data: makeApp(1, { name: 'Stale metadata', token: 'legacy-stale' }) }); await flush()
  if (action !== 'unmount') {
    expect(wrapper.text()).not.toContain('Stale metadata')
    expect(wrapper.find('.token-copy-btn').exists()).toBe(false)
  }
  expect(storedTokenOf(1)).toBeNull()
})


it('metadata GET期间缓存无事件改写时，重新验证当前缓存而不沿用旧显示seed', async () => {
  authService.setAppToken(1, PRIVATE_FORM)
  const tokens = new Map([[1, PUBLIC_FORM]])
  useImmediateApis(tokens)
  const wrapper = await mountDetail(1); await flush()
  const metadata = defer<DetailResponse>()
  mocks.getApplication.mockReturnValueOnce(metadata.promise)
  await wrapper.find('.edit-btn').trigger('click')
  wrapper.findComponent({ name: 'EditApplicationModal' }).vm.$emit('updated'); await flush()
  authService.setAppToken(1, PRIVATE_FORM_2)
  tokens.set(1, PUBLIC_FORM_2!)
  metadata.resolve({ data: makeApp(1, { token: PUBLIC_FORM }) }); await flush()
  await wrapper.find('.token-copy-btn').trigger('click')
  expect(writeText).toHaveBeenLastCalledWith(PRIVATE_FORM_2)
  expect(storedTokenOf(1)).toBe(PRIVATE_FORM_2)
})


it('metadata用内存旧seed判invalid时不误删另一个有效缓存seed', async () => {
  useImmediateApis(new Map([[1, PUBLIC_FORM]]))
  mocks.regenerateToken.mockResolvedValue({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
  const wrapper = await mountDetail(1); await flush()
  await wrapper.find('.regenerate-btn').trigger('click'); confirmCurrentDialog(); await flush()
  authService.setAppToken(1, PRIVATE_FORM)
  const raw = storedRawOf(1)
  await wrapper.find('.edit-btn').trigger('click')
  wrapper.findComponent({ name: 'EditApplicationModal' }).vm.$emit('updated'); await flush()
  expect(storedRawOf(1)).toBe(raw)
  expect(storedTokenOf(1)).toBe(PRIVATE_FORM)
  expect(wrapper.text()).not.toContain(PRIVATE_FORM_2)
  await wrapper.find('.token-copy-btn').trigger('click')
  expect(writeText).toHaveBeenLastCalledWith(PRIVATE_FORM)
})
