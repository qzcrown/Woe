import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'

const mocks = vi.hoisted(() => ({
  token: 'a', clientId: 7, username: 'alice',
  elevateClient: vi.fn(), markElevated: vi.fn()
}))
vi.mock('@/services/api', () => ({ clientApi: { elevateClient: mocks.elevateClient } }))
vi.mock('@/services/auth', () => ({ authService: {
  getSessionRevision: () => 1,
  getClientCredentialForRevocation: () => mocks.token,
  getClientId: () => mocks.clientId
} }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({
  user: { name: mocks.username }, elevatedUntil: null, markElevated: mocks.markElevated
}) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

let ui: ReturnType<typeof import('@/composables/useElevatedAction')['useElevatedAction']>
let Modal: typeof import('@/components/ElevateConfirmModal.vue')['default']
let ForbiddenError: typeof import('@/types')['ForbiddenError']
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
  await nextTick()
}
const mountModal = () => mount(defineComponent({
  setup: () => () => h(Modal, {
    visible: ui.isElevationModalOpen.value,
    flowId: ui.elevationModalFlowId.value,
    mode: ui.elevationModalMode.value,
    loading: ui.elevationModalLoading.value,
    error: ui.elevationModalError.value,
    onConfirm: ui.handleElevationConfirm,
    onCancel: ui.handleElevationCancel
  })
}))
const action = (value: string) => vi.fn()
  .mockRejectedValueOnce(new ForbiddenError('session not elevated'))
  .mockResolvedValue(value)
const settle = (promise: Promise<unknown>) => promise.catch(error => error)

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.token = 'a'; mocks.clientId = 7; mocks.username = 'alice'
  mocks.elevateClient.mockResolvedValue(undefined)
  ForbiddenError = (await import('@/types')).ForbiddenError
  ui = (await import('@/composables/useElevatedAction')).useElevatedAction()
  Modal = (await import('@/components/ElevateConfirmModal.vue')).default
})

describe('真实提权弹窗的密码流程归属', () => {
  it.each(['new session', 'new caller'])('%s 替换密码等待时清空旧输入', async reason => {
    const wrapper = mountModal()
    let current = true
    const oldResult = settle(ui.withElevation(action('old'), () => current))
    await flush()
    await wrapper.find('input').setValue('alice-secret')
    if (reason === 'new session') {
      mocks.token = 'b'; mocks.clientId = 8; mocks.username = 'bob'
    } else {
      current = false
    }
    const newResult = settle(ui.withElevation(action('new')))
    await flush()
    try {
      expect((wrapper.find('input').element as HTMLInputElement).value).toBe('')
      await wrapper.find('input').setValue('current-secret')
      await wrapper.find('.btn-primary').trigger('click')
      expect(await newResult).toBe('new')
      expect(await oldResult).toMatchObject({ name: 'ElevationCancelledError' })
      expect(mocks.elevateClient).toHaveBeenCalledWith(mocks.clientId, 900, {
        username: mocks.username, password: 'current-secret'
      })
    } finally {
      ui.handleElevationCancel()
      await Promise.all([oldResult, newResult])
      wrapper.unmount()
    }
  })

  it('同一流程输错密码后保留输入供修正，成功后只重试一次动作', async () => {
    mocks.elevateClient.mockRejectedValueOnce(new ForbiddenError('wrong password'))
    const wrapper = mountModal()
    const target = action('done')
    const result = settle(ui.withElevation(target))
    await flush()
    await wrapper.find('input').setValue('wrong-secret')
    await wrapper.find('.btn-primary').trigger('click')
    await flush()
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('wrong-secret')
    expect(wrapper.find('[role="alert"]').text()).toBe('elevate.wrongPassword')
    await wrapper.find('input').setValue('correct-secret')
    await wrapper.find('.btn-primary').trigger('click')
    expect(await result).toBe('done')
    expect(target).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })
})
