import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import CryptoJS from 'crypto-js'
import api from '@/services/api'
import { authService } from '@/services/auth'
import { useAuthStore } from '@/stores/auth'
import { useElevatedAction } from '@/composables/useElevatedAction'
import ChangePasswordModal from '@/components/ChangePasswordModal.vue'
import i18n from '@/locales'


interface Request {
  config: InternalAxiosRequestConfig
  respond: (status: number, data?: unknown) => void
}
let requests: Request[]
let wrapper: VueWrapper | undefined
const originalAdapter = api.defaults.adapter
const takeRequest = async (): Promise<Request> => {
  await flushPromises()
  const request = requests.shift()
  if (!request) throw new Error('expected HTTP request')
  return request
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  authService.setToken('client', 'client-A')
  authService.setClientId(7)
  useAuthStore().user = {
    id: 1, name: 'alice', nickname: 'Alice', email: 'alice@example.test',
    admin: false, disabled: false
  }
  i18n.global.locale.value = 'zh-CN'
  requests = []
  api.defaults.adapter = config => new Promise((resolve, reject) => {
    requests.push({ config, respond(status, data = {}) {
      const response = { config, status, data, statusText: String(status), headers: {} }
      if (status >= 200 && status < 300) resolve(response)
      else reject(new AxiosError('HTTP error', undefined, config, undefined, response))
    } })
  })
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  api.defaults.adapter = originalAdapter
  localStorage.clear()
})

describe('改密码请求在途时跨 tab 切换会话', () => {

  it.each(['initial', 'retry'] as const)('%s请求200后提示重新登录确认结果，不宣称修改成功', async phase => {
    wrapper = mount(ChangePasswordModal, { global: { plugins: [i18n] } })
    const inputs = wrapper.findAll('input')
    await inputs[0].setValue('Violet!7River9Stone')
    await inputs[1].setValue('Violet!7River9Stone')
    await wrapper.find('.btn.primary').trigger('click')
    let mutation = await takeRequest()
    expect(mutation.config.url).toBe('/current/user/password')
    expect(JSON.parse(mutation.config.data)).toEqual({ pass: 'Violet!7River9Stone' })
    if (phase === 'retry') {
      mutation.respond(403, { error: 'Forbidden', errorDescription: 'session not elevated' })
      await flushPromises()
      const ui = useElevatedAction()
      expect(ui.isElevationModalOpen.value).toBe(true)
      ui.handleElevationConfirm('alice-current-password')
      const elevation = await takeRequest()
      expect(elevation.config.url).toBe('/client/7/elevate')
      expect(elevation.config.auth).toEqual({ username: 'alice', password: 'alice-current-password' })
      elevation.respond(200)
      mutation = await takeRequest()
      expect(mutation.config.url).toBe('/current/user/password')
    }


    const revision = authService.getSessionRevision()
    localStorage.setItem('woe_auth_client_token', CryptoJS.AES.encrypt(JSON.stringify({
      token: 'client-B', type: 'client',
      expires: new Date(Date.now() + 86400000).toISOString(),
      lastUsed: new Date().toISOString()
    }), 'woe-default-key').toString())
    expect(authService.getSessionRevision()).toBe(revision)
    mutation.respond(200)
    await flushPromises()

    expect(wrapper.get('.error').text()).toContain('请重新登录后确认结果')
    expect(wrapper.emitted('updated')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.find('.btn.primary').attributes('disabled')).toBeUndefined()
    expect(authService.getClientCredentialForRevocation()).toBe('client-B')
    expect(requests).toHaveLength(0)
  })
})
