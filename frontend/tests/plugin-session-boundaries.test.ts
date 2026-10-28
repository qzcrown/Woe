import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import axios, { type InternalAxiosRequestConfig } from 'axios'
vi.mock('@/services/websocket', () => ({ wsService: { connect: vi.fn(), disconnect: vi.fn() } }))
vi.mock('@/utils/errorHandler', () => ({ showSuccess: vi.fn(), showError: vi.fn() }))
import api, { pluginApi, userApi } from '@/services/api'
import { authService, clientTokenStorageKey } from '@/services/auth'
import { createPluginUiHost } from '@/plugins/host'
import { useAuthStore } from '@/stores/auth'
import EditPluginModal from '@/components/EditPluginModal.vue'
import CreatePluginModal from '@/components/CreatePluginModal.vue'
import Plugins from '@/views/Plugins.vue'
import Users from '@/views/Users.vue'
import { defineComponent, h } from 'vue'
import { useConfirmDialogProvider } from '@/composables/useConfirmDialog'
import i18n from '@/locales'
import PluginDetail from '@/views/PluginDetail.vue'
import { createRouter, createMemoryHistory } from 'vue-router'
import { showSuccess } from '@/utils/errorHandler'
import type { Plugin } from '@/types'

const plugin = { id: 9, name: 'Fixture', modulePath: 'test/plain', token: 'P-test', enabled: true,
  capabilities: [], availability: 'available' } as Plugin
let calls: InternalAxiosRequestConfig[]
let wrappers: VueWrapper[]
const hosts: ReturnType<typeof createPluginUiHost>[] = []
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  authService.setToken('client', 'session-a')
  setActivePinia(createPinia())
  useAuthStore().user = { id: 7, name: 'owner', admin: true } as any
  calls = []; wrappers = []
  api.defaults.adapter = async config => {
    calls.push(config)
    const data = config.url === '/plugin' ? [plugin]
      : config.url === '/plugin/available' ? [{ modulePath: 'test/plain', name: 'Fixture' }]
      : config.url?.endsWith('/config') ? 'authToken: "***"\n' : {}
    return { data, status: 200, statusText: 'OK', headers: {}, config }
  }
})
afterEach(() => {
  wrappers.forEach(wrapper => wrapper.unmount())
  hosts.splice(0).forEach(host => host.dispose())
})
const host = () => { const value = createPluginUiHost({ ownerId: 7 }); hosts.push(value); return value }
const options = { global: { plugins: [i18n], stubs: {
  BaseModal: { template: '<div><slot name="title"/><slot/><slot name="footer"/></div>' },
  Layout: { template: '<div><slot/></div>' }, RouterLink: { template: '<a><slot/></a>' },
  PluginIcon: true, LoadingSpinner: true
} } }

it('rejects a stale guard at the real Axios dispatch boundary before applying new auth', async () => {
  const revision = authService.getSessionRevision()
  const pending = pluginApi.updateConfig(9, 'authToken: old-draft', {
    sessionGuard: () => authService.getSessionRevision() === revision
  } as any)
  const result = pending.catch(error => error)
  authService.setToken('client', 'session-b')
  expect(axios.isCancel(await result)).toBe(true)
  expect(calls).toHaveLength(0)
})

it('rejects a stale message generation before the old trigger reaches Axios', async () => {
  const current = host()
  let generation = 1
  const pending = current.api.triggerJob(3, 9, () => generation === 1).catch(error => error)
  generation = 2
  expect(axios.isCancel(await pending)).toBe(true)
  expect(calls).toHaveLength(0)
})

it('invalidates and aborts a host synchronously on a session notification', async () => {
  const current = host()
  authService.setToken('client', 'session-b')
  expect(current.signal.aborted).toBe(true)
  expect(axios.isCancel(await current.api.triggerJob(1, 9).catch(error => error))).toBe(true)
  expect(calls).toHaveLength(0)
})

it('handles cross-tab storage clear and removes its listener on dispose', () => {
  const current = host()
  const remove = vi.spyOn(window, 'removeEventListener')
  localStorage.removeItem(clientTokenStorageKey())
  window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: localStorage }))
  expect(current.signal.aborted).toBe(true)
  current.dispose(); current.dispose()
  expect(remove.mock.calls.filter(call => call[0] === 'storage')).toHaveLength(1)
  remove.mockRestore()
})

it('unmounts the old edit form and never posts its draft after the session changes', async () => {
  const wrapper = mount(EditPluginModal, { ...options, props: { show: false, plugin } })
  wrappers.push(wrapper)
  await wrapper.setProps({ show: true }); await flushPromises()
  await wrapper.get('textarea').setValue('authToken: old-owner-draft')
  authService.setToken('client', 'session-b'); await flushPromises()
  const save = wrapper.find('.save-btn'); if (save.exists()) await save.trigger('click')
  await flushPromises()
  expect(wrapper.find('textarea').exists()).toBe(false)
  expect(calls.filter(call => call.method === 'post')).toHaveLength(0)
})

it('prevents old plugin-list toggle actions after a session change', async () => {
  const wrapper = mount(Plugins, options); wrappers.push(wrapper)
  await flushPromises()
  authService.setToken('client', 'session-b'); await flushPromises()
  const toggle = wrapper.find('.toggle-btn'); if (toggle.exists()) await toggle.trigger('click')
  await flushPromises()
  expect(calls.filter(call => call.method === 'post')).toHaveLength(0)
})

it('clears the old create form and does not create an instance in the new session', async () => {
  const wrapper = mount(CreatePluginModal, { ...options, props: { show: true, targetUserId: 7 } })
  wrappers.push(wrapper); await flushPromises()
  await wrapper.get('input').setValue('old session draft')
  authService.setToken('client', 'session-b'); await flushPromises()
  const submit = wrapper.find('.submit-btn'); if (submit.exists()) await submit.trigger('click')
  await flushPromises()
  expect(calls.filter(call => call.method === 'post')).toHaveLength(0)
})

it('makes stale host notifications no-ops and disposes the session subscription', () => {
  const current = host()
  current.dispose()
  current.notify.success('old operation')
  expect(showSuccess).not.toHaveBeenCalled()
})

it.each(['session', 'route'])('never displays a late initial config after a %s switch', async mode => {
  let resolve!: (value: any) => void
  const configResponse = new Promise<any>(done => { resolve = done })
  let started = false
  api.defaults.adapter = async config => {
    if (config.url === '/plugin/9/config') { started = true; return configResponse }
    return { data: config.url === '/plugin' ? [plugin, { ...plugin, id: 10, name: 'Second' }]
      : config.url?.endsWith('/config') ? 'second-owner-config' : [], status: 200, statusText: 'OK', headers: {}, config }
  }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/plugin/:id', component: PluginDetail }] })
  await router.push('/plugin/9'); await router.isReady()
  const wrapper = mount(PluginDetail, { ...options, global: { ...options.global, plugins: [i18n, router] } })
  wrappers.push(wrapper); await flushPromises()
  expect(started).toBe(true)
  if (mode === 'session') authService.setToken('client', 'session-b')
  else await router.push('/plugin/10')
  resolve({ data: 'late-private-config', status: 200, statusText: 'OK', headers: {}, config: {} })
  await flushPromises()
  expect(wrapper.text()).not.toContain('late-private-config')
  if (mode === 'session') expect(wrapper.find('textarea').exists()).toBe(false)
  else expect(wrapper.text()).toContain('Second')
})

const mountUsers = async (lateDetails?: Promise<any>) => {
  api.defaults.adapter = async config => {
    calls.push(config)
    if (config.url === '/user/8/plugins' && lateDetails) return lateDetails
    const data = config.url === '/user' ? [{ id: 8, name: 'target', admin: false }]
      : config.url === '/plugin/available' ? [{ modulePath: 'test/plain', name: 'Fixture' }]
      : config.url === '/user/8/plugin-permissions' ? []
      : config.url === '/user/8/plugins' ? [plugin] : []
    return { data, status: 200, statusText: 'OK', headers: {}, config }
  }
  const provider = defineComponent({ setup() { useConfirmDialogProvider(); return () => h(Users) } })
  const wrapper = mount(provider, options); wrappers.push(wrapper)
  await flushPromises()
  await wrapper.get('.user-header .toggle-btn').trigger('click'); await flushPromises()
  return wrapper
}

it('rejects old plugin permissions before Axios authenticates with the next admin', async () => {
  const current = host()
  const result = userApi.updatePluginPermissions(8, ['test/plain'], current.requestOptions as any).catch(error => error)
  authService.setToken('client', 'session-b')
  expect(axios.isCancel(await result)).toBe(true)
  expect(calls).toHaveLength(0)
})

it('clears the old Users plugin authorization draft and prevents its submit after a session change', async () => {
  const wrapper = await mountUsers()
  await wrapper.get('.plugin-permission-item input').setValue(true)
  authService.setToken('client', 'session-b'); await flushPromises()
  const submit = wrapper.find('.save-permissions-btn'); if (submit.exists()) await submit.trigger('click')
  await flushPromises()
  expect(calls.filter(call => call.method === 'put')).toHaveLength(0)
  expect(wrapper.find('.user-details').exists()).toBe(false)
})

it('never repopulates Users details with an old-session plugin response', async () => {
  let resolve!: (value: any) => void
  const pending = new Promise<any>(done => { resolve = done })
  const wrapper = await mountUsers(pending)
  authService.setToken('client', 'session-b'); await flushPromises()
  resolve({ data: [{ ...plugin, name: 'late-private-instance' }], status: 200, statusText: 'OK', headers: {}, config: {} })
  await flushPromises()
  expect(wrapper.text()).not.toContain('late-private-instance')
  expect(wrapper.find('.user-details').exists()).toBe(false)
})
