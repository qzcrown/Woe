import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import CryptoJS from 'crypto-js'
import Applications from '@/views/Applications.vue'
import { authService } from '@/services/auth'
import { base64UrlEncode, derivePublicForm } from '@/utils/enhancedToken'








const mocks = vi.hoisted(() => ({
  getApplications: vi.fn(),
  getApplication: vi.fn(),
  regenerateToken: vi.fn(),
  deleteApplication: vi.fn(),
  uploadApplicationImage: vi.fn(),
  deleteApplicationImage: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn()
}))

vi.mock('@/components/Layout.vue', () => ({
  default: { name: 'Layout', template: '<div><slot /></div>' }
}))
vi.mock('@/components/ApplicationIcon.vue', () => ({
  default: { name: 'ApplicationIcon', template: '<div class="app-icon-stub" />' }
}))
vi.mock('@/components/CreateApplicationModal.vue', () => ({
  default: { name: 'CreateApplicationModal', emits: ['close', 'created'], template: '<div class="create-modal-stub" />' }
}))
vi.mock('@/components/EditApplicationModal.vue', () => ({
  default: { name: 'EditApplicationModal', emits: ['close', 'updated'], template: '<div class="edit-modal-stub" />' }
}))
vi.mock('@/utils/errorHandler', () => ({
  showError: mocks.showError,
  showSuccess: mocks.showSuccess
}))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() })
}))
vi.mock('@/services/api', () => ({
  applicationApi: {
    getApplications: mocks.getApplications,
    getApplication: mocks.getApplication,
    regenerateToken: mocks.regenerateToken,
    deleteApplication: mocks.deleteApplication,
    uploadApplicationImage: mocks.uploadApplicationImage,
    deleteApplicationImage: mocks.deleteApplicationImage
  },
  clientApi: { elevate: vi.fn() },
  authApi: { login: vi.fn(), logout: vi.fn() }
}))



type ObserverEvent = ['observe' | 'unobserve', Element]

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = []
  static events: ObserverEvent[] = []
  callback: IntersectionObserverCallback
  observed = new Set<Element>()

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    MockIntersectionObserver.instances.push(this)
  }

  observe(el: Element): void {
    this.observed.add(el)
    MockIntersectionObserver.events.push(['observe', el])
  }

  unobserve(el: Element): void {
    this.observed.delete(el)
    MockIntersectionObserver.events.push(['unobserve', el])
  }

  disconnect(): void {
    this.observed.clear()
  }

  takeRecords(): IntersectionObserverEntry[] {
    return []
  }


  emit(isIntersecting: boolean): void {
    const entries = [...this.observed].map(
      (target) => ({ isIntersecting, target }) as IntersectionObserverEntry
    )
    this.callback(entries, this as unknown as IntersectionObserver)
  }
}



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



const makeApps = (count: number): Array<Record<string, unknown>> =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `App ${i + 1}`,
    sortKey: '',
    description: `desc ${i + 1}`,
    image: '',
    internal: false,
    defaultPriority: 0
  }))

type DetailResponse = { data: { token?: string } }
type ListResponse = { data: Array<Record<string, unknown>> }

const detailTokens = new Map<number, string | undefined>()
const pendingDetails = new Map<number, Array<Deferred<DetailResponse>>>()

const detailResponse = (token?: string): DetailResponse => ({ data: { token } })


const useImmediateDetails = (): void => {
  mocks.getApplication.mockImplementation(async (id: number) => detailResponse(detailTokens.get(id)))
}


const useQueuedDeferredDetails = (): void => {
  mocks.getApplication.mockImplementation((id: number) => {
    const d = defer<DetailResponse>()
    const list = pendingDetails.get(id) ?? []
    list.push(d)
    pendingDetails.set(id, list)
    return d.promise
  })
}


const resolveDetail = (id: number, token?: string): void => {
  const d = (pendingDetails.get(id) ?? []).find((item) => !item.settled)
  if (!d) throw new Error(`no pending detail for id ${id}`)
  d.resolve(detailResponse(token))
}

const requestedDetailIds = (): number[] =>
  mocks.getApplication.mock.calls.map((call) => call[0] as number)

const detailCallsFor = (id: number): number =>
  requestedDetailIds().filter((x) => x === id).length



import i18n from '@/locales'
import { useConfirmDialogProvider } from '@/composables/useConfirmDialog'

let confirmContext: ReturnType<typeof useConfirmDialogProvider> | null = null
let activeWrapper: VueWrapper | null = null

const mountPage = (): VueWrapper => {
  const Harness = defineComponent({
    setup() {
      confirmContext = useConfirmDialogProvider()
      return () => h(Applications)
    }
  })
  activeWrapper = mount(Harness, { global: { plugins: [i18n] } })
  return activeWrapper
}

const confirmCurrentDialog = (): void => {
  confirmContext!.handleConfirm()
}

const cards = (wrapper: VueWrapper) => wrapper.findAll('.app-card')
const cardOf = (wrapper: VueWrapper, id: number) =>
  wrapper.findAll('.app-card').find((card) => card.find('h3').text() === `App ${id}`)


const reachBottom = (): void => {
  MockIntersectionObserver.instances[0].emit(true)
}

const leaveBottom = (): void => {
  MockIntersectionObserver.instances[0].emit(false)
}


const reloadViaCreatedEvent = async (wrapper: VueWrapper): Promise<void> => {
  await wrapper.find('.create-btn').trigger('click')
  await flush()
  wrapper.findComponent({ name: 'CreateApplicationModal' }).vm.$emit('created')
  await flush()
}

const writeText = vi.fn()

beforeEach(() => {
  localStorage.clear()
  vi.resetAllMocks()
  detailTokens.clear()
  pendingDetails.clear()
  MockIntersectionObserver.instances = []
  MockIntersectionObserver.events = []
  confirmContext = null
  i18n.global.locale.value = 'en-US'
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true
  })

  authService.setToken('client', 'test-client-token')
  mocks.getApplications.mockResolvedValue({ data: makeApps(23) })
})

afterEach(() => {
  activeWrapper?.unmount()
  activeWrapper = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})



describe('初始窗口与观察器绑定', () => {
  it('loading 期间无卡片;列表返回后渲染 10 卡,真实哨兵被 observe,详情仅前 10 id', async () => {
    useImmediateDetails()
    const wrapper = mountPage()
    expect(wrapper.find('.loading').exists()).toBe(true)
    expect(cards(wrapper).length).toBe(0)

    await flush()

    expect(cards(wrapper).length).toBe(10)

    expect(requestedDetailIds()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

    expect(MockIntersectionObserver.instances.length).toBe(1)
    expect(MockIntersectionObserver.instances[0].observed.size).toBe(1)
    expect(wrapper.find('.sentinel-row').exists()).toBe(true)
  })
})



describe('批次互斥与总并发上限', () => {
  it('首批未完成时连续触底被忽略:仍 10 卡/10 请求,非窗口 id 零请求', async () => {
    useQueuedDeferredDetails()
    const wrapper = mountPage()
    await flush()
    expect(requestedDetailIds().length).toBe(10)

    reachBottom()
    await flush()
    reachBottom()
    await flush()
    reachBottom()
    await flush()


    expect(cards(wrapper).length).toBe(10)
    expect(requestedDetailIds().length).toBe(10)
    expect(requestedDetailIds().every((id) => id >= 1 && id <= 10)).toBe(true)

    for (let id = 11; id <= 23; id++) {
      expect(detailCallsFor(id)).toBe(0)
    }
  })

  it('哨兵持续可见时按批自动填充视口,每批 ≤10、总并发 ≤10', async () => {
    useQueuedDeferredDetails()
    const wrapper = mountPage()
    await flush()
    expect(requestedDetailIds().length).toBe(10)


    reachBottom()


    for (let id = 1; id <= 10; id++) resolveDetail(id, `legacy-${id}`)
    await flush()
    expect(cards(wrapper).length).toBe(20)
    expect(requestedDetailIds().length).toBe(20)
    expect(requestedDetailIds().slice(10)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20])


    for (let id = 11; id <= 20; id++) resolveDetail(id, `legacy-${id}`)
    await flush()
    expect(cards(wrapper).length).toBe(23)
    expect(requestedDetailIds().length).toBe(23)
    expect(requestedDetailIds().slice(20)).toEqual([21, 22, 23])

    for (let id = 21; id <= 23; id++) resolveDetail(id, `legacy-${id}`)
    await flush()

    expect(MockIntersectionObserver.instances[0].observed.size).toBe(0)
    const total = requestedDetailIds().length
    reachBottom()
    await flush()
    expect(requestedDetailIds().length).toBe(total)
  })
})



describe('分窗追加与已解析缓存', () => {
  it('批次完成再触底:20 卡后再追加为 23,增量分别 10/3;来回滚动不重新请求已解析 id', async () => {
    useQueuedDeferredDetails()
    const wrapper = mountPage()
    await flush()


    for (let id = 1; id <= 10; id++) resolveDetail(id, `legacy-${id}`)
    await flush()
    expect(cards(wrapper).length).toBe(10)
    expect(requestedDetailIds().length).toBe(10)


    reachBottom()
    leaveBottom()
    await flush()
    expect(cards(wrapper).length).toBe(20)
    expect(requestedDetailIds().length).toBe(20)
    expect(requestedDetailIds().slice(10)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20])

    for (let id = 11; id <= 20; id++) resolveDetail(id, `legacy-${id}`)
    await flush()
    expect(cards(wrapper).length).toBe(20)
    expect(requestedDetailIds().length).toBe(20)


    reachBottom()
    leaveBottom()
    await flush()
    expect(cards(wrapper).length).toBe(23)
    expect(requestedDetailIds().length).toBe(23)
    expect(requestedDetailIds().slice(20)).toEqual([21, 22, 23])

    for (let id = 21; id <= 23; id++) resolveDetail(id, `legacy-${id}`)
    await flush()


    const before = requestedDetailIds().length
    reachBottom()
    leaveBottom()
    reachBottom()
    await flush()
    expect(requestedDetailIds().length).toBe(before)
    expect(cards(wrapper).length).toBe(23)
  })
})



describe('详情失败隔离', () => {
  it('失败卡隐藏、缓存保留、不无限重试;列表不提供复制入口', async () => {
    detailTokens.set(1, PUBLIC_FORM)
    authService.setAppToken(1, PRIVATE_FORM)
    authService.setAppToken(3, PRIVATE_FORM)
    mocks.getApplication.mockImplementation(async (id: number) => {
      if (id === 3) throw new Error('network down')
      return detailResponse(detailTokens.get(id))
    })

    const wrapper = mountPage()
    await flush()
    await flush()

    const card3 = cardOf(wrapper, 3)!
    expect(card3.find('.app-token').exists()).toBe(false)
    expect(card3.find('.token-copy-btn').exists()).toBe(false)

    expect(storedTokenOf(3)).toBe(PRIVATE_FORM)

    expect(detailCallsFor(3)).toBe(1)
    await flush()
    expect(detailCallsFor(3)).toBe(1)


    const card1 = cardOf(wrapper, 1)!
    expect(card1.find('.token-copy-btn').exists()).toBe(false)
  })
})



describe('重载归属隔离', () => {
  it('迟到的旧列表响应不覆盖新列表,已删除 id 不复活', async () => {
    useQueuedDeferredDetails()
    const firstList = defer<ListResponse>()
    const secondList = defer<ListResponse>()
    const listDeferreds = [firstList, secondList]
    let listCalls = 0
    mocks.getApplications.mockImplementation(() => listDeferreds[listCalls++].promise)

    const wrapper = mountPage()
    await flush()
    expect(cards(wrapper).length).toBe(0)

    await reloadViaCreatedEvent(wrapper)
    expect(mocks.getApplications).toHaveBeenCalledTimes(2)


    secondList.resolve({ data: makeApps(22) })
    await flush()
    firstList.resolve({ data: makeApps(23) })
    await flush()

    expect(cards(wrapper).length).toBe(10)
    expect(wrapper.text()).not.toContain('App 23')

    expect(detailCallsFor(23)).toBe(0)

    expect(requestedDetailIds().every((id) => id >= 1 && id <= 10)).toBe(true)
  })

  it('迟到的旧详情不覆盖新状态、不删除新缓存;新窗口状态来自新请求', async () => {
    detailTokens.set(5, PUBLIC_FORM)
    authService.setAppToken(5, PRIVATE_FORM)
    useQueuedDeferredDetails()
    mocks.getApplications
      .mockResolvedValueOnce({ data: makeApps(23) })
      .mockResolvedValueOnce({ data: makeApps(22) })

    const wrapper = mountPage()
    await flush()
    expect(requestedDetailIds().length).toBe(10)


    await reloadViaCreatedEvent(wrapper)


    authService.setAppToken(5, PRIVATE_FORM_2)


    for (let id = 1; id <= 10; id++) resolveDetail(id, `OLD-${id}`)
    await flush()


    const card2 = cardOf(wrapper, 2)!
    expect(card2.text()).not.toContain('OLD-2')
    expect(storedTokenOf(5)).toBe(PRIVATE_FORM_2)


    expect(detailCallsFor(2)).toBe(2)
    expect(detailCallsFor(5)).toBe(2)


    for (let id = 1; id <= 10; id++) {
      resolveDetail(id, id === 5 ? derivePublicForm(PRIVATE_FORM_2)! : `NEW-${id}`)
    }
    await flush()

    expect(storedTokenOf(5)).toBe(PRIVATE_FORM_2)
  })
})



describe('会话变更撞上在途列表', () => {
  it('迟到的旧会话列表响应不提交也不呈现空态:loading 交接后重新加载并重新解析当前窗口', async () => {
    useQueuedDeferredDetails()
    const firstList = defer<ListResponse>()
    const secondList = defer<ListResponse>()
    const listDeferreds = [firstList, secondList]
    let listCalls = 0
    mocks.getApplications.mockImplementation(() => listDeferreds[listCalls++].promise)

    const wrapper = mountPage()
    await flush()
    expect(wrapper.find('.loading').exists()).toBe(true)
    expect(wrapper.find('.empty-state').exists()).toBe(false)


    authService.setToken('client', 'cross-tab-token')
    await flush()


    firstList.resolve({ data: makeApps(23) })
    await flush()

    expect(wrapper.find('.empty-state').exists()).toBe(false)

    expect(wrapper.find('.loading').exists()).toBe(true)
    expect(mocks.getApplications).toHaveBeenCalledTimes(2)


    secondList.resolve({ data: makeApps(23) })
    await flush()
    expect(wrapper.find('.loading').exists()).toBe(false)
    expect(cards(wrapper).length).toBe(10)
    expect(requestedDetailIds()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

    for (let id = 1; id <= 10; id++) resolveDetail(id, `legacy-${id}`)
    await flush()

    expect(cardOf(wrapper, 1)!.find('.token-copy-btn').exists()).toBe(false)
  })
})



describe('轮换与并发 GET 隔离', () => {
  it('缓存的 B/显示的 B 保留;轮换成功持有新私钥,旧 GET 不覆盖', async () => {
    detailTokens.set(2, PUBLIC_FORM)
    authService.setAppToken(2, PRIVATE_FORM)
    useQueuedDeferredDetails()
    const rotation = defer<{ data: { regenerateToken: { token: string } } }>()
    mocks.regenerateToken.mockImplementation(() => rotation.promise)

    const wrapper = mountPage()
    await flush()


    await cardOf(wrapper, 2)!.find('.regenerate-btn').trigger('click')
    await flush()
    confirmCurrentDialog()
    await flush()
    expect(mocks.regenerateToken).toHaveBeenCalledTimes(1)
    expect(mocks.regenerateToken).toHaveBeenCalledWith(2)


    resolveDetail(1, 'A-app-token')
    rotation.resolve({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
    await flush()
    await flush()


    expect(storedTokenOf(2)).toBe(PRIVATE_FORM_2)
    expect(mocks.showSuccess).toHaveBeenCalled()


    resolveDetail(2, PUBLIC_FORM)
    await flush()
    expect(storedTokenOf(2)).toBe(PRIVATE_FORM_2)
  })

  it('轮换未完成时再次点击:同 app 最多一个轮换', async () => {
    useImmediateDetails()
    const rotation = defer<{ data: { regenerateToken: { token: string } } }>()
    mocks.regenerateToken.mockImplementation(() => rotation.promise)

    const wrapper = mountPage()
    await flush()

    await cardOf(wrapper, 1)!.find('.regenerate-btn').trigger('click')
    await flush()
    confirmCurrentDialog()
    await flush()
    expect(mocks.regenerateToken).toHaveBeenCalledTimes(1)


    await cardOf(wrapper, 1)!.find('.regenerate-btn').trigger('click')
    await flush()
    expect(confirmContext!.state.value.visible).toBe(false)
    expect(mocks.regenerateToken).toHaveBeenCalledTimes(1)

    rotation.resolve({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
    await flush()
    expect(mocks.regenerateToken).toHaveBeenCalledTimes(1)
    expect(storedTokenOf(1)).toBe(PRIVATE_FORM_2)
  })

  it('确认期间换会话:不派发轮换、不写缓存、不弹反馈', async () => {
    authService.setAppToken(1, PRIVATE_FORM)
    detailTokens.set(1, PUBLIC_FORM)
    useImmediateDetails()
    const wrapper = mountPage()
    await flush()

    await cardOf(wrapper, 1)!.find('.regenerate-btn').trigger('click')
    await flush()
    expect(confirmContext!.state.value.visible).toBe(true)


    authService.setToken('client', 'new-client-token')
    confirmCurrentDialog()
    await flush()

    expect(mocks.regenerateToken).not.toHaveBeenCalled()
    expect(storedTokenOf(1)).toBe(PRIVATE_FORM)
    expect(mocks.showSuccess).not.toHaveBeenCalled()
    expect(mocks.showError).not.toHaveBeenCalled()
  })
})



describe('轮换响应与存储异常', () => {
  it.each([true, false])('轮换期间重查迟到，保存失败时不能覆盖新私钥（已有缓存：%s）', async cached => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    if (cached) authService.setAppToken(1, PRIVATE_FORM)
    mocks.getApplications.mockResolvedValue({ data: makeApps(1) })
    useQueuedDeferredDetails()
    const rotation = defer<{ data: { regenerateToken: { token: string } } }>()
    mocks.regenerateToken.mockReturnValue(rotation.promise)
    const wrapper = mountPage()
    await flush()
    resolveDetail(1, PUBLIC_FORM)
    await flush()
    vi.spyOn(authService, 'setAppToken').mockImplementation(() => { throw new Error('quota exceeded') })

    await cardOf(wrapper, 1)!.find('.regenerate-btn').trigger('click')
    confirmCurrentDialog()
    await flush()
    window.dispatchEvent(new StorageEvent('storage', { key: 'woe_auth_app_1_token' }))
    await flush()
    expect(detailCallsFor(1)).toBe(2)
    rotation.resolve({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
    await flush()

    resolveDetail(1, PUBLIC_FORM)
    await flush()
    expect(storedTokenOf(1)).toBe(cached ? PRIVATE_FORM : null)

    expect(detailCallsFor(1)).toBe(2)
  })

  it('响应 token 为空:不给 valid、不覆盖旧缓存、显示协议错误', async () => {
    authService.setAppToken(1, PRIVATE_FORM)
    detailTokens.set(1, PUBLIC_FORM)
    useImmediateDetails()
    mocks.regenerateToken.mockResolvedValue({ data: { regenerateToken: { token: '' } } })

    const wrapper = mountPage()
    await flush()

    await cardOf(wrapper, 1)!.find('.regenerate-btn').trigger('click')
    await flush()
    confirmCurrentDialog()
    await flush()

    expect(storedTokenOf(1)).toBe(PRIVATE_FORM)
    expect(cardOf(wrapper, 1)!.find('.token-copy-btn').exists()).toBe(false)
    expect(mocks.showError).toHaveBeenCalled()
    expect(mocks.showSuccess).not.toHaveBeenCalled()
  })

  it('localStorage 写入失败:提示保存失败而非服务器失败,不诱导重复轮换', async () => {
    detailTokens.set(1, PUBLIC_FORM)
    useImmediateDetails()
    const setSpy = vi.spyOn(authService, 'setAppToken').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    mocks.regenerateToken.mockResolvedValue({
      data: { regenerateToken: { token: PRIVATE_FORM_2 } }
    })

    const wrapper = mountPage()
    await flush()

    await cardOf(wrapper, 1)!.find('.regenerate-btn').trigger('click')
    await flush()
    confirmCurrentDialog()
    await flush()


    const shownContexts = mocks.showError.mock.calls.map((call) => call[1])
    expect(shownContexts).toContain('The new token was generated but could not be saved in this browser. Copy and save it before leaving.')
    expect(shownContexts).not.toContain('Failed to refresh token')
    expect(mocks.showSuccess).not.toHaveBeenCalled()

    setSpy.mockRestore()
  })
})



describe('legacy 不进入列表 DOM', () => {
  it('11 字符 legacy 无令牌展示行也无复制入口;原文绝不进入 DOM', async () => {
    detailTokens.set(1, 'A-app-token')
    useImmediateDetails()
    const wrapper = mountPage()
    await flush()

    const card1 = cardOf(wrapper, 1)!

    expect(card1.find('.app-token').exists()).toBe(false)
    expect(card1.find('.token-copy-btn').exists()).toBe(false)

    expect(card1.text()).not.toContain('A-app-token')
  })
})



describe('unknown/invalid 状态与缓存处置', () => {
  it('gtfy 异常/无本地 → 无复制按钮、不调用 clipboard;unknown 不删除缓存;invalid 条件删除', async () => {
    detailTokens.set(1, 'gtfygarbage')
    detailTokens.set(2, PUBLIC_FORM)
    detailTokens.set(3, PUBLIC_FORM)
    detailTokens.set(4, 'gtfya.abc')
    authService.setAppToken(1, PRIVATE_FORM)
    authService.setAppToken(3, PRIVATE_FORM_2)
    useImmediateDetails()

    const wrapper = mountPage()
    await flush()

    for (const id of [1, 2, 3, 4]) {
      const card = cardOf(wrapper, id)!
      expect(card.find('.token-copy-btn').exists()).toBe(false)
      expect(card.find('.app-token').exists()).toBe(false)

      expect(card.find('.regenerate-btn').exists()).toBe(true)
    }
    expect(writeText).not.toHaveBeenCalled()


    expect(storedTokenOf(1)).toBe(PRIVATE_FORM)
    expect(storedRawOf(2)).toBeNull()

    expect(storedRawOf(3)).toBeNull()
    expect(storedRawOf(4)).toBeNull()
  })
})



describe('观察器重绑、卸载与 storage 事件', () => {
  it('重载时哨兵解绑并重绑(loading 销毁旧节点)', async () => {
    useImmediateDetails()
    const wrapper = mountPage()
    await flush()
    const firstSentinel = wrapper.find('.sentinel-row').element
    expect(MockIntersectionObserver.instances[0].observed.has(firstSentinel)).toBe(true)

    await reloadViaCreatedEvent(wrapper)

    const events = MockIntersectionObserver.events
    expect(events.some((e) => e[0] === 'unobserve' && e[1] === firstSentinel)).toBe(true)
    const observes = events.filter((e) => e[0] === 'observe')
    expect(observes.length).toBeGreaterThanOrEqual(2)
    expect(observes[observes.length - 1][1]).not.toBe(firstSentinel)

    expect(wrapper.find('.sentinel-row').exists()).toBe(true)
    expect(MockIntersectionObserver.instances[0].observed.has(wrapper.find('.sentinel-row').element)).toBe(true)
  })

  it('卸载后迟到的详情/剪贴板/storage 事件:无状态、存储、错误副作用', async () => {
    detailTokens.set(1, PUBLIC_FORM)
    authService.setAppToken(1, PRIVATE_FORM)
    useQueuedDeferredDetails()
    const wrapper = mountPage()
    await flush()

    wrapper.unmount()
    const rawBefore = storedRawOf(1)

    resolveDetail(1, 'LATE-TOKEN')
    await flush()

    expect(storedRawOf(1)).toBe(rawBefore)
    expect(mocks.showError).not.toHaveBeenCalled()
    expect(mocks.showSuccess).not.toHaveBeenCalled()
    expect(writeText).not.toHaveBeenCalled()


    const calls = mocks.getApplication.mock.calls.length
    window.dispatchEvent(new StorageEvent('storage', { key: 'woe_auth_app_1_token' }))
    await flush()
    expect(mocks.getApplication.mock.calls.length).toBe(calls)
  })

  it('跨 tab storage 事件:合并重查后缓存状态恢复;无关键不触发重查', async () => {
    detailTokens.set(1, PUBLIC_FORM)
    authService.setAppToken(1, PRIVATE_FORM)
    useImmediateDetails()
    const wrapper = mountPage()
    await flush()

    expect(cardOf(wrapper, 1)!.find('.token-copy-btn').exists()).toBe(false)


    window.dispatchEvent(new StorageEvent('storage', { key: 'woe_auth_app_1_token' }))
    await flush()
    expect(detailCallsFor(1)).toBe(2)

    expect(storedTokenOf(1)).toBe(PRIVATE_FORM)


    const before = mocks.getApplication.mock.calls.length
    window.dispatchEvent(new StorageEvent('storage', { key: 'locale' }))
    await flush()
    expect(mocks.getApplication.mock.calls.length).toBe(before)
  })
})



describe('无 IntersectionObserver 的手动加载', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', undefined)
  })

  it('显示手动 Load more;忙时点击忽略;增量 10/3;完成后按钮消失', async () => {
    useQueuedDeferredDetails()
    const wrapper = mountPage()
    await flush()
    expect(cards(wrapper).length).toBe(10)


    for (let id = 1; id <= 10; id++) resolveDetail(id, `legacy-${id}`)
    await flush()
    await wrapper.find('.load-more-btn').trigger('click')
    await flush()
    expect(cards(wrapper).length).toBe(20)
    expect(requestedDetailIds().length).toBe(20)


    await wrapper.find('.load-more-btn').trigger('click')
    await flush()
    expect(cards(wrapper).length).toBe(20)
    expect(requestedDetailIds().length).toBe(20)
    expect(requestedDetailIds().every((id) => id <= 20)).toBe(true)

    for (let id = 11; id <= 20; id++) resolveDetail(id, `legacy-${id}`)
    await flush()
    expect(cards(wrapper).length).toBe(20)

    await wrapper.find('.load-more-btn').trigger('click')
    await flush()
    expect(cards(wrapper).length).toBe(23)
    expect(requestedDetailIds().length).toBe(23)
    expect(requestedDetailIds().slice(20)).toEqual([21, 22, 23])

    for (let id = 21; id <= 23; id++) resolveDetail(id, `legacy-${id}`)
    await flush()
    expect(wrapper.find('.load-more-btn').exists()).toBe(false)
  })
})


describe('跨标签页与卸载的敏感操作归属', () => {
  const replaceClientFromOtherTab = (): void => {
    localStorage.setItem('woe_auth_client_token', CryptoJS.AES.encrypt(JSON.stringify({
      token: 'other-tab-client', type: 'client', expires: new Date(Date.now() + 86400000).toISOString()
    }), ENCRYPTION_KEY).toString())
  }

  it('跨 tab 换凭据发生在确认期间:不派发轮换', async () => {
    useImmediateDetails()
    const wrapper = mountPage()
    await flush()
    await cardOf(wrapper, 1)!.find('.regenerate-btn').trigger('click')
    replaceClientFromOtherTab()
    confirmCurrentDialog()
    await flush()
    expect(mocks.regenerateToken).not.toHaveBeenCalled()
  })

  it('跨 tab 换凭据发生在轮换 HTTP 在途:迟到私钥不写缓存/不展示', async () => {
    useImmediateDetails()
    const rotation = defer<{ data: { regenerateToken: { token: string } } }>()
    mocks.regenerateToken.mockReturnValue(rotation.promise)
    const wrapper = mountPage()
    await flush()
    await cardOf(wrapper, 1)!.find('.regenerate-btn').trigger('click')
    confirmCurrentDialog()
    await flush()
    replaceClientFromOtherTab()
    rotation.resolve({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
    await flush()
    expect(storedRawOf(1)).toBeNull()
    expect(cardOf(wrapper, 1)!.find('.token-copy-btn').exists()).toBe(false)
    expect(mocks.showSuccess).not.toHaveBeenCalled()
  })

  it('删除在途卸载后:不清缓存、不 toast、不再加载列表', async () => {
    authService.setAppToken(1, PRIVATE_FORM)
    useImmediateDetails()
    const deletion = defer<void>()
    mocks.deleteApplication.mockReturnValue(deletion.promise)
    const wrapper = mountPage()
    await flush()
    await cardOf(wrapper, 1)!.find('.delete-btn').trigger('click')
    confirmCurrentDialog()
    await flush()
    const before = mocks.getApplications.mock.calls.length
    wrapper.unmount()
    activeWrapper = null
    deletion.resolve()
    await flush()
    expect(storedTokenOf(1)).toBe(PRIVATE_FORM)
    expect(mocks.showSuccess).not.toHaveBeenCalled()
    expect(mocks.getApplications).toHaveBeenCalledTimes(before)
  })
})

describe('轮换响应校验', () => {
  it.each(['gtfygarbage', 'gtfya.short', 'gtfya.a.b.c'])('轮换响应 %s 不成为可复制凭据', async (token) => {
    useImmediateDetails()
    mocks.regenerateToken.mockResolvedValue({ data: { regenerateToken: { token } } })
    const wrapper = mountPage()
    await flush()
    await cardOf(wrapper, 1)!.find('.regenerate-btn').trigger('click')
    confirmCurrentDialog()
    await flush()
    expect(storedRawOf(1)).toBeNull()
    expect(cardOf(wrapper, 1)!.find('.token-copy-btn').exists()).toBe(false)
    expect(mocks.showError).toHaveBeenCalledTimes(1)
  })
})



describe('storage 事件语义化过滤', () => {
  const setupValidList = async (): Promise<VueWrapper> => {
    detailTokens.set(1, PUBLIC_FORM)
    authService.setAppToken(1, PRIVATE_FORM)
    useImmediateDetails()
    const wrapper = mountPage()
    await flush()
    await flush()
    return wrapper
  }

  it('无关键(woe_auth_preferences)不触发重查', async () => {
    const wrapper = await setupValidList()

    const before = mocks.getApplication.mock.calls.length

    window.dispatchEvent(new StorageEvent('storage', { key: 'woe_auth_preferences' }))
    await flush()
    expect(mocks.getApplication.mock.calls.length).toBe(before)
  })

  it('窗口外应用键不触发重查;本应用键与整站清空(null)照旧', async () => {
    const wrapper = await setupValidList()
    expect(detailCallsFor(1)).toBe(1)


    window.dispatchEvent(new StorageEvent('storage', { key: 'woe_auth_app_999_token' }))
    await flush()
    expect(detailCallsFor(1)).toBe(1)


    window.dispatchEvent(new StorageEvent('storage', { key: 'woe_auth_app_1_token' }))
    await flush()
    expect(detailCallsFor(1)).toBe(2)


    window.dispatchEvent(new StorageEvent('storage', { key: null }))
    await flush()
    expect(detailCallsFor(1)).toBe(3)
  })
})

describe('会话变更的账号内容清理与重载', () => {
  it('换凭据:旧账号列表立即清空,列表与窗口详情以新会话重发', async () => {
    useImmediateDetails()
    const firstList = defer<ListResponse>()
    const secondList = defer<ListResponse>()
    const listDeferreds = [firstList, secondList]
    let listCalls = 0
    mocks.getApplications.mockImplementation(() => listDeferreds[listCalls++].promise)

    const wrapper = mountPage()
    await flush()
    firstList.resolve({ data: makeApps(23) })
    await flush()
    await flush()
    expect(cards(wrapper).length).toBe(10)
    expect(wrapper.text()).toContain('App 1')
    expect(detailCallsFor(1)).toBe(1)


    authService.setToken('client', 'new-account-token')
    await flush()
    expect(wrapper.text()).not.toContain('App 1')
    expect(cards(wrapper).length).toBe(0)
    expect(mocks.getApplications).toHaveBeenCalledTimes(2)


    secondList.resolve({ data: makeApps(23) })
    await flush()
    await flush()
    expect(cards(wrapper).length).toBe(10)
    expect(wrapper.text()).toContain('App 1')
    expect(detailCallsFor(1)).toBe(2)
  })

  it('登出:账号内容清空且不发出任何请求', async () => {
    detailTokens.set(1, PUBLIC_FORM)
    authService.setAppToken(1, PRIVATE_FORM)
    useImmediateDetails()
    const wrapper = mountPage()
    await flush()
    await flush()
    expect(cards(wrapper).length).toBe(10)
    const listBefore = mocks.getApplications.mock.calls.length
    const detailBefore = mocks.getApplication.mock.calls.length

    authService.clearAllAuth()
    await flush()

    expect(wrapper.text()).not.toContain('App 1')
    expect(cards(wrapper).length).toBe(0)
    expect(mocks.getApplications).toHaveBeenCalledTimes(listBefore)
    expect(mocks.getApplication).toHaveBeenCalledTimes(detailBefore)
  })
})


describe('真正跨标签页的账号内容清理', () => {
  const replaceClientWithoutNotification = (token: string): void => {
    localStorage.setItem('woe_auth_client_token', CryptoJS.AES.encrypt(JSON.stringify({
      token, type: 'client', expires: new Date(Date.now() + 86400000).toISOString()
    }), ENCRYPTION_KEY).toString())
  }

  it('跨tab换凭据事件清空旧列表，等待新账号列表返回后才渲染', async () => {
    useImmediateDetails()
    const nextList = defer<ListResponse>()
    mocks.getApplications.mockResolvedValueOnce({ data: makeApps(1) }).mockReturnValueOnce(nextList.promise)
    const wrapper = mountPage()
    await flush()
    expect(wrapper.text()).toContain('App 1')
    const revision = authService.getSessionRevision()
    replaceClientWithoutNotification('cross-tab-new-account')
    window.dispatchEvent(new StorageEvent('storage', { key: 'woe_auth_client_token', storageArea: localStorage }))
    await flush()
    expect(authService.getSessionRevision()).toBe(revision)
    expect(cards(wrapper)).toHaveLength(0)
    expect(wrapper.text()).not.toContain('App 1')
    expect(mocks.getApplications).toHaveBeenCalledTimes(2)
    nextList.resolve({ data: [{ ...makeApps(1)[0], id: 99, name: 'New account application' }] })
    await flush()
    expect(wrapper.text()).toContain('New account application')
    expect(wrapper.text()).not.toContain('App 1')
  })

  it.each(['woe_auth_client_token', null])('跨tab登出 key=%s 清空内容且不重查', async key => {
    useImmediateDetails()
    const wrapper = mountPage()
    await flush()
    const before = mocks.getApplication.mock.calls.length
    if (key === null) localStorage.clear()
    else localStorage.removeItem(key)
    window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }))
    await flush()
    expect(cards(wrapper)).toHaveLength(0)
    expect(mocks.getApplications).toHaveBeenCalledTimes(1)
    expect(mocks.getApplication).toHaveBeenCalledTimes(before)
  })

  it.each(['edit', 'create'])('同tab换凭据同时关闭旧账号的%s弹窗', async kind => {
    useImmediateDetails()
    const wrapper = mountPage()
    await flush()
    if (kind === 'edit') await cardOf(wrapper, 1)!.find('.edit-btn').trigger('click')
    else await wrapper.find('.create-btn').trigger('click')
    const modalName = kind === 'edit' ? 'EditApplicationModal' : 'CreateApplicationModal'
    expect(wrapper.findComponent({ name: modalName }).exists()).toBe(true)
    authService.setToken('client', 'new-account-without-old-modal')
    await flush()
    expect(wrapper.findComponent({ name: modalName }).exists()).toBe(false)
  })
})

describe('应用storage事件只使对应行失效', () => {
  it.each([true, false])('他应用缓存变化不能丢失当前行未保存的新私钥(cached=%s)', async cached => {
    if (cached) authService.setAppToken(1, PRIVATE_FORM)
    mocks.getApplications.mockResolvedValue({ data: makeApps(2) })
    detailTokens.set(1, PUBLIC_FORM)
    detailTokens.set(2, 'legacy-app-2')
    useImmediateDetails()
    const wrapper = mountPage()
    await flush()
    vi.spyOn(authService, 'setAppToken').mockImplementation(() => { throw new Error('quota exceeded') })
    mocks.regenerateToken.mockResolvedValue({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
    await cardOf(wrapper, 1)!.find('.regenerate-btn').trigger('click')
    confirmCurrentDialog()
    await flush()
    const before1 = detailCallsFor(1)
    const before2 = detailCallsFor(2)
    detailTokens.set(1, PUBLIC_FORM_2!)
    window.dispatchEvent(new StorageEvent('storage', { key: 'woe_auth_app_2_token', storageArea: localStorage }))
    await flush()
    expect(detailCallsFor(1)).toBe(before1)
    expect(detailCallsFor(2)).toBe(before2 + 1)
  })
})


describe('列表轮换一次性令牌出口', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}))
  const failTokenStorage = (): void => {
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === 'woe_auth_app_1_token') throw new DOMException('quota exceeded', 'QuotaExceededError')
      originalSetItem.call(this, key, value)
    })
  }
  const rotate = async (): Promise<VueWrapper> => {
    detailTokens.set(1, PUBLIC_FORM)
    useImmediateDetails()
    mocks.regenerateToken.mockResolvedValue({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
    const wrapper = mountPage()
    await flush()
    await cardOf(wrapper, 1)!.find('.regenerate-btn').trigger('click')
    confirmCurrentDialog()
    await flush()
    return wrapper
  }

  it.each([false, true])('保存失败=%s时均提供实际新私钥的一次性复制', async (quotaFails) => {
    if (quotaFails) failTokenStorage()
    const wrapper = await rotate()
    const reveal = wrapper.find('.regenerated-token-modal')
    expect(reveal.exists()).toBe(true)
    expect(reveal.find('code').text()).toBe(PRIVATE_FORM_2)
    expect(cardOf(wrapper, 1)!.find('.token-copy-btn').exists()).toBe(false)
    const clipboard = defer<void>()
    writeText.mockReturnValue(clipboard.promise)
    await reveal.find('.copy').trigger('click')
    expect(writeText).toHaveBeenLastCalledWith(PRIVATE_FORM_2)
    expect(reveal.find('.copy').html()).toContain('lucide-copy')
    clipboard.resolve()
    await flush()
    expect(reveal.find('.copy').html()).toContain('lucide-check')
    await reveal.find('.done').trigger('click')
    expect(wrapper.find('.regenerated-token-modal').exists()).toBe(false)
    expect(wrapper.text()).not.toContain(PRIVATE_FORM_2)
  })

  it('剪贴板失败不伪报成功，最近一次成功反馈到期复位', async () => {
    const wrapper = await rotate()
    vi.useFakeTimers()
    const copy = wrapper.find('.regenerated-token-modal .copy')
    writeText.mockRejectedValueOnce(new Error('denied'))
    await copy.trigger('click')
    await flush()
    expect(copy.html()).toContain('lucide-copy')
    expect(mocks.showError).toHaveBeenCalledTimes(1)
    writeText.mockResolvedValue(undefined)
    await copy.trigger('click')
    await flush()
    expect(copy.html()).toContain('lucide-check')
    vi.advanceTimersByTime(1500)
    await flush()
    expect(copy.html()).toContain('lucide-copy')
  })

  it.each(['close', 'session', 'storage', 'unmount'])('%s清除明文与在途复制反馈', async (action) => {
    failTokenStorage()
    const wrapper = await rotate()
    vi.useFakeTimers()
    const clipboard = defer<void>()
    writeText.mockReturnValue(clipboard.promise)
    await wrapper.find('.regenerated-token-modal .copy').trigger('click')
    mocks.showError.mockClear()
    if (action === 'close') await wrapper.find('.regenerated-token-modal .close-btn').trigger('click')
    if (action === 'session') authService.clearAllAuth()
    if (action === 'storage') window.dispatchEvent(new StorageEvent('storage', { key: 'woe_auth_client_token' }))
    if (action === 'unmount') { wrapper.unmount(); activeWrapper = null }
    await flush()
    if (action !== 'unmount') {
      expect(wrapper.find('.regenerated-token-modal').exists()).toBe(false)
      expect(wrapper.text()).not.toContain(PRIVATE_FORM_2)
    }
    clipboard.resolve()
    await flush()
    expect(vi.getTimerCount()).toBe(0)
    expect(mocks.showError).not.toHaveBeenCalled()
  })
})


describe('列表一次性令牌窗口互斥', () => {
  it('其他应用轮换和新私钥展示期间，第二行不能派发轮换；关闭后恢复', async () => {
    useImmediateDetails()
    const rotation = defer<{ data: { regenerateToken: { token: string } } }>()
    mocks.regenerateToken.mockReturnValue(rotation.promise)
    const wrapper = mountPage()
    await flush()
    const second = cardOf(wrapper, 2)!.find('.regenerate-btn')
    await cardOf(wrapper, 1)!.find('.regenerate-btn').trigger('click')
    confirmCurrentDialog()
    await flush()
    expect(second.attributes('disabled')).toBeDefined()
    await second.trigger('click')
    await flush()
    expect(mocks.regenerateToken).toHaveBeenCalledTimes(1)
    rotation.resolve({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
    await flush()
    expect(wrapper.find('.regenerated-token-modal code').text()).toBe(PRIVATE_FORM_2)
    expect(second.attributes('disabled')).toBeDefined()
    await second.trigger('click')
    expect(mocks.regenerateToken).toHaveBeenCalledTimes(1)
    await wrapper.find('.regenerated-token-modal .done').trigger('click')
    expect(second.attributes('disabled')).toBeUndefined()
  })

  it('普通重载保留一次性私钥窗口直到主动关闭', async () => {
    useImmediateDetails()
    mocks.regenerateToken.mockResolvedValue({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
    const wrapper = mountPage()
    await flush()
    await cardOf(wrapper, 1)!.find('.regenerate-btn').trigger('click')
    confirmCurrentDialog()
    await flush()
    expect(wrapper.find('.regenerated-token-modal').exists()).toBe(true)
    await reloadViaCreatedEvent(wrapper)
    expect(wrapper.find('.regenerated-token-modal code').text()).toBe(PRIVATE_FORM_2)
    await wrapper.find('.regenerated-token-modal .done').trigger('click')
    expect(wrapper.find('.regenerated-token-modal').exists()).toBe(false)
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
    detailTokens.set(1, PUBLIC_FORM)
    useImmediateDetails()
    const wrapper = mountPage()
    await flush()
    await cardOf(wrapper, 1)!.find('.regenerate-btn').trigger('click')
    confirmCurrentDialog()
    await flush()
    return { wrapper, rotation }
  }

  it('较晚返回的旧轮换不能覆盖另一tab已生效的新私钥', async () => {
    const { wrapper, rotation } = await startRotation()
    authService.setAppToken(1, PRIVATE_FORM_3)
    detailTokens.set(1, PUBLIC_FORM_3); useImmediateDetails()
    window.dispatchEvent(new StorageEvent('storage', { key: 'woe_auth_app_1_token' }))
    await flush()
    rotation.resolve({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
    await flush()
    expect(storedTokenOf(1)).toBe(PRIVATE_FORM_3)
    expect(wrapper.find('.regenerated-token-modal').exists()).toBe(false)
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
    expect(wrapper.find('.regenerated-token-modal code').text()).toBe(PRIVATE_FORM_2)
  })

  it('只有storage事件但缓存原值未变时仍接受合法轮换响应', async () => {
    const { wrapper, rotation } = await startRotation()
    window.dispatchEvent(new StorageEvent('storage', { key: 'woe_auth_app_1_token' }))
    await flush()
    rotation.resolve({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
    await flush()
    expect(storedTokenOf(1)).toBe(PRIVATE_FORM_2)
    expect(wrapper.find('.regenerated-token-modal code').text()).toBe(PRIVATE_FORM_2)
  })

  it('验证GET期间再次写入缓存时不以过期验证覆盖更新的私钥', async () => {
    const { wrapper, rotation } = await startRotation()
    authService.setAppToken(1, PRIVATE_FORM_3)
    const validation = defer<DetailResponse>()
    mocks.getApplication.mockReturnValueOnce(validation.promise)
    rotation.resolve({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
    await flush()
    authService.setAppToken(1, PRIVATE_FORM)
    detailTokens.set(1, PUBLIC_FORM); useImmediateDetails()
    validation.resolve({ data: { token: PUBLIC_FORM_2! } })
    await flush()
    expect(storedTokenOf(1)).toBe(PRIVATE_FORM)
    expect(wrapper.find('.regenerated-token-modal').exists()).toBe(false)
  })

  it('验证GET失败时保留新缓存并隐藏未经验证的返回私钥', async () => {
    const { wrapper, rotation } = await startRotation()
    authService.setAppToken(1, PRIVATE_FORM_3)
    mocks.getApplication.mockRejectedValue(new Error('offline'))
    rotation.resolve({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
    await flush()
    expect(storedTokenOf(1)).toBe(PRIVATE_FORM_3)
    expect(wrapper.find('.regenerated-token-modal').exists()).toBe(false)
  })

  it.each(['session', 'unmount'])('验证GET期间%s失效时迟到验证不得保存或展示私钥', async (invalidation) => {
    const { wrapper, rotation } = await startRotation()
    authService.setAppToken(1, PRIVATE_FORM_3)
    const validation = defer<DetailResponse>()
    mocks.getApplication.mockReturnValueOnce(validation.promise)
    rotation.resolve({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
    await flush()
    expect(storedTokenOf(1)).toBe(PRIVATE_FORM_3)
    const raw = storedRawOf(1)
    if (invalidation === 'session') authService.removeToken('client')
    if (invalidation === 'unmount') { wrapper.unmount(); activeWrapper = null }
    validation.resolve({ data: { token: PUBLIC_FORM_2! } })
    await flush()
    expect(storedRawOf(1)).toBe(raw)
    if (invalidation !== 'unmount') expect(wrapper.find('.regenerated-token-modal').exists()).toBe(false)
  })
})


describe('普通元数据重载不能丢弃同会话轮换结果', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}))

  for (const cached of [false, true]) for (const quota of [false, true]) {
    it.each(['before', 'after', 'empty', 'failed'])('初始缓存='+cached+' 存储失败='+quota+' 列表%s轮换返回仍可复制', async (order) => {
      if (cached) authService.setAppToken(1, PRIVATE_FORM)
      detailTokens.set(1, PUBLIC_FORM)
      useImmediateDetails()
      const icon = defer<unknown>()
      const rotation = defer<{ data: { regenerateToken: { token: string } } }>()
      const list = defer<ListResponse>()
      mocks.uploadApplicationImage.mockReturnValue(icon.promise)
      mocks.regenerateToken.mockReturnValue(rotation.promise)
      const wrapper = mountPage(); await flush()
      wrapper.findAllComponents({ name: 'ApplicationIcon' })[1].vm.$emit('upload', new File(['a'], 'a.png'))
      await cardOf(wrapper, 1)!.find('.regenerate-btn').trigger('click')
      confirmCurrentDialog(); await flush()
      mocks.getApplications.mockReturnValueOnce(list.promise)
      icon.resolve({}); await flush()
      if (quota) vi.spyOn(authService, 'setAppToken').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError') })
      const finishList = async () => {
        if (order === 'failed') list.reject(new Error('offline'))
        else list.resolve({ data: order === 'empty' ? [] : makeApps(23) })
        await flush()
      }
      if (order !== 'after') await finishList()
      detailTokens.set(1, PUBLIC_FORM_2!)
      rotation.resolve({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } }); await flush()
      if (order === 'after') await finishList()
      expect(wrapper.find('.regenerated-token-modal code').text()).toBe(PRIVATE_FORM_2)
      await wrapper.find('.regenerated-token-modal .copy').trigger('click'); await flush()
      expect(writeText).toHaveBeenLastCalledWith(PRIVATE_FORM_2)
      expect(storedTokenOf(1)).toBe(quota ? (cached ? PRIVATE_FORM : null) : PRIVATE_FORM_2)
    })
  }

  it('普通重载派发的旧详情GET不能隐藏未持久化新seed或删除缓存', async () => {
    authService.setAppToken(1, PRIVATE_FORM)
    detailTokens.set(1, PUBLIC_FORM)
    useImmediateDetails()
    const icon = defer<unknown>()
    const rotation = defer<{ data: { regenerateToken: { token: string } } }>()
    mocks.uploadApplicationImage.mockReturnValue(icon.promise)
    mocks.regenerateToken.mockReturnValue(rotation.promise)
    const wrapper = mountPage(); await flush()
    wrapper.findAllComponents({ name: 'ApplicationIcon' })[1].vm.$emit('upload', new File(['a'], 'a.png'))
    await cardOf(wrapper, 1)!.find('.regenerate-btn').trigger('click'); confirmCurrentDialog(); await flush()
    useQueuedDeferredDetails()
    icon.resolve({}); await flush()
    const raw = storedRawOf(1)
    vi.spyOn(authService, 'setAppToken').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError') })
    rotation.resolve({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } }); await flush()
    for (let id = 1; id <= 10; id++) resolveDetail(id, PUBLIC_FORM_2!)
    await flush()
    expect(storedRawOf(1)).toBe(raw)
    expect(wrapper.find('.regenerated-token-modal code').text()).toBe(PRIVATE_FORM_2)
    await wrapper.find('.regenerated-token-modal .copy').trigger('click')
    expect(writeText).toHaveBeenLastCalledWith(PRIVATE_FORM_2)
  })

  it('真正删除轮换目标后迟到seed仍不得写入或显示', async () => {
    useImmediateDetails()
    const rotation = defer<{ data: { regenerateToken: { token: string } } }>()
    mocks.regenerateToken.mockReturnValue(rotation.promise)
    mocks.deleteApplication.mockResolvedValue({})
    const wrapper = mountPage(); await flush()
    await cardOf(wrapper, 1)!.find('.regenerate-btn').trigger('click'); confirmCurrentDialog(); await flush()
    mocks.getApplications.mockResolvedValue({ data: makeApps(23).filter((app) => app.id !== 1) })
    await cardOf(wrapper, 1)!.find('.delete-btn').trigger('click'); confirmCurrentDialog(); await flush()
    rotation.resolve({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } }); await flush()
    expect(storedTokenOf(1)).toBeNull()
    expect(wrapper.find('.regenerated-token-modal').exists()).toBe(false)
  })
})


it('新派发的普通重载详情GET发现第三方轮换时撤销旧seed出口', async () => {
  detailTokens.set(1, PUBLIC_FORM)
  useImmediateDetails()
  mocks.regenerateToken.mockResolvedValue({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
  const wrapper = mountPage(); await flush()
  await cardOf(wrapper, 1)!.find('.regenerate-btn').trigger('click'); confirmCurrentDialog(); await flush()
  detailTokens.set(1, PUBLIC_FORM)
  await reloadViaCreatedEvent(wrapper)
  expect(wrapper.find('.regenerated-token-modal').exists()).toBe(false)
  expect(storedTokenOf(1)).toBeNull()
})


it('删除目标HTTP在途遇普通列表重载，确认删除仍使轮换结果失效', async () => {
  useImmediateDetails()
  const rotation = defer<{ data: { regenerateToken: { token: string } } }>()
  const deletion = defer<unknown>()
  mocks.regenerateToken.mockReturnValue(rotation.promise)
  mocks.deleteApplication.mockReturnValue(deletion.promise)
  const wrapper = mountPage(); await flush()
  await cardOf(wrapper, 1)!.find('.regenerate-btn').trigger('click'); confirmCurrentDialog(); await flush()
  await cardOf(wrapper, 1)!.find('.delete-btn').trigger('click'); confirmCurrentDialog(); await flush()
  await reloadViaCreatedEvent(wrapper)
  deletion.resolve({}); await flush()
  rotation.resolve({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } }); await flush()
  expect(storedTokenOf(1)).toBeNull()
  expect(wrapper.find('.regenerated-token-modal').exists()).toBe(false)
})


it('第二窗seed出口重载到首窗后，仍响应自身storage失效且不为外窗发GET', async () => {
  useImmediateDetails()
  mocks.regenerateToken.mockResolvedValue({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
  const wrapper = mountPage(); await flush()
  reachBottom(); leaveBottom(); await flush()
  expect(cardOf(wrapper, 11)).toBeDefined()
  await cardOf(wrapper, 11)!.find('.regenerate-btn').trigger('click'); confirmCurrentDialog(); await flush()
  await reloadViaCreatedEvent(wrapper)
  expect(cards(wrapper)).toHaveLength(10)
  expect(cardOf(wrapper, 11)).toBeUndefined()
  expect(wrapper.find('.regenerated-token-modal code').text()).toBe(PRIVATE_FORM_2)
  const calls = requestedDetailIds().length
  window.dispatchEvent(new StorageEvent('storage', { key: 'woe_auth_app_22_token', storageArea: localStorage }))
  await flush()
  expect(wrapper.find('.regenerated-token-modal code').text()).toBe(PRIVATE_FORM_2)
  expect(requestedDetailIds()).toHaveLength(calls)
  authService.setAppToken(11, PRIVATE_FORM)
  window.dispatchEvent(new StorageEvent('storage', { key: 'woe_auth_app_11_token', storageArea: localStorage }))
  await flush()
  expect(wrapper.find('.regenerated-token-modal').exists()).toBe(false)
  expect(wrapper.text()).not.toContain(PRIVATE_FORM_2)
  expect(storedTokenOf(11)).toBe(PRIVATE_FORM)
  expect(requestedDetailIds()).toHaveLength(calls)
})


it.each(['matching', 'rotated', '404', 'network', '5xx'])('外窗未持久化seed在无storage事件的普通重载中得到%s验证', async (result) => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  authService.setAppToken(11, PRIVATE_FORM)
  useImmediateDetails()
  mocks.regenerateToken.mockResolvedValue({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
  const wrapper = mountPage(); await flush()
  reachBottom(); leaveBottom(); await flush()
  vi.spyOn(authService, 'setAppToken').mockImplementationOnce(() => { throw new DOMException('quota', 'QuotaExceededError') })
  await cardOf(wrapper, 11)!.find('.regenerate-btn').trigger('click'); confirmCurrentDialog(); await flush()
  const callsBefore = detailCallsFor(11)
  mocks.getApplication.mockImplementation(async (id: number) => {
    if (id !== 11) return detailResponse(undefined)
    if (result === '404') throw Object.assign(new Error('deleted'), { statusCode: 404 })
    if (result === '5xx') throw Object.assign(new Error('server failed'), { statusCode: 503 })
    if (result === 'network') throw new Error('offline')
    return detailResponse(result === 'matching' ? PUBLIC_FORM_2! : PUBLIC_FORM)
  })
  await reloadViaCreatedEvent(wrapper)
  expect(cards(wrapper)).toHaveLength(10)
  expect(detailCallsFor(11)).toBe(callsBefore + 1)
  const preserved = result === 'matching' || result === 'network' || result === '5xx'
  expect(wrapper.find('.regenerated-token-modal').exists()).toBe(preserved)
  if (preserved) {
    await wrapper.find('.regenerated-token-modal .copy').trigger('click'); await flush()
    expect(writeText).toHaveBeenLastCalledWith(PRIVATE_FORM_2)
    expect(storedTokenOf(11)).toBe(PRIVATE_FORM)
  } else {
    expect(wrapper.text()).not.toContain(PRIVATE_FORM_2)

    expect(storedTokenOf(11)).toBe(result === '404' ? null : PRIVATE_FORM)
  }
})

it('外窗popup验证与首窗卡片共享最多10个在途请求的有限队列', async () => {
  useImmediateDetails()
  mocks.regenerateToken.mockResolvedValue({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
  const wrapper = mountPage(); await flush()
  reachBottom(); leaveBottom(); await flush()
  await cardOf(wrapper, 11)!.find('.regenerate-btn').trigger('click'); confirmCurrentDialog(); await flush()
  const before = requestedDetailIds().length
  useQueuedDeferredDetails()
  await reloadViaCreatedEvent(wrapper)
  expect(requestedDetailIds().slice(before)).toEqual([11, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  resolveDetail(11, PUBLIC_FORM_2!)
  for (let id = 1; id <= 9; id++) resolveDetail(id)
  await flush()
  expect(requestedDetailIds().slice(before)).toEqual([11, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  resolveDetail(10); await flush()
  expect(wrapper.find('.regenerated-token-modal code').text()).toBe(PRIVATE_FORM_2)
})

it.each(['before', 'after'])('轮换结果%s返回的同目标404不能保留seed出口或让迟到200复活它', async (order) => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  useImmediateDetails()
  const rotation = defer<{ data: { regenerateToken: { token: string } } }>()
  mocks.regenerateToken.mockReturnValue(rotation.promise)
  const wrapper = mountPage(); await flush()
  await cardOf(wrapper, 1)!.find('.regenerate-btn').trigger('click'); confirmCurrentDialog(); await flush()
  useQueuedDeferredDetails()
  await reloadViaCreatedEvent(wrapper)
  const rejectDeleted = async () => {
    pendingDetails.get(1)![0].reject(Object.assign(new Error('deleted'), { statusCode: 404 }))
    await flush()
  }
  if (order === 'before') await rejectDeleted()
  rotation.resolve({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } }); await flush()
  if (order === 'after') await rejectDeleted()
  expect(wrapper.find('.regenerated-token-modal').exists()).toBe(false)
  if (order === 'before') expect(storedTokenOf(1)).toBeNull()
})


it('popup旧seed被静默替换的有效缓存取代时，普通GET不能误删新缓存', async () => {
  detailTokens.set(1, PUBLIC_FORM)
  useImmediateDetails()
  mocks.regenerateToken.mockResolvedValue({ data: { regenerateToken: { token: PRIVATE_FORM_2 } } })
  const wrapper = mountPage(); await flush()
  await cardOf(wrapper, 1)!.find('.regenerate-btn').trigger('click'); confirmCurrentDialog(); await flush()
  authService.setAppToken(1, PRIVATE_FORM)
  const raw = storedRawOf(1)
  await reloadViaCreatedEvent(wrapper)
  expect(wrapper.find('.regenerated-token-modal').exists()).toBe(false)
  expect(storedRawOf(1)).toBe(raw)
  expect(storedTokenOf(1)).toBe(PRIVATE_FORM)
})
