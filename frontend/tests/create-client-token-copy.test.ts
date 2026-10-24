import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import CreateClientModal from '@/components/CreateClientModal.vue'
import { authService, clientTokenStorageKey } from '@/services/auth'
import { base64UrlEncode } from '@/utils/enhancedToken'
import i18n from '@/locales'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(), showError: vi.fn(), showSuccess: vi.fn()
}))
vi.mock('@/services/api', () => ({
  clientApi: { createClient: mocks.createClient, elevateClient: vi.fn() },
  applicationApi: {}, authApi: { login: vi.fn(), logout: vi.fn() }
}))
vi.mock('@/utils/errorHandler', () => ({
  showError: mocks.showError, showSuccess: mocks.showSuccess
}))
vi.mock('@/components/BaseModal.vue', () => ({ default: {
  name: 'BaseModal', emits: ['close'],
  template: '<div><slot name="title"/><slot/><slot name="footer"/></div>'
}}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const PRIVATE_FORM = `gtfyc.${base64UrlEncode(new Uint8Array(32).fill(1))}`
const writeText = vi.fn()
const unsubscribed = vi.fn()
const wrappers = new Set<VueWrapper>()
const realSubscribe = authService.subscribeSessionChanges.bind(authService)
const savedLocale = i18n.global.locale.value
const savedClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
let alternateStoredCredential = ''

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value })
}
function destroy(w: VueWrapper) { w.unmount(); wrappers.delete(w) }
async function startCreate() {
  const request = deferred<{ data: unknown }>()
  mocks.createClient.mockReturnValueOnce(request.promise)
  const w = mount(CreateClientModal, { global: { plugins: [i18n] } })
  wrappers.add(w)
  await w.get('input[type="text"]').setValue('My Client')
  await w.get('form').trigger('submit')
  return { w, request }
}
async function reveal(token: unknown = PRIVATE_FORM) {
  const { w, request } = await startCreate()
  request.resolve({ data: { token } })
  await request.promise
  await nextTick()
  return w
}
const copy = (w: VueWrapper) => w.get('button.copy')
async function beginCopy(w: VueWrapper) {
  const job = deferred<void>()
  writeText.mockReturnValueOnce(job.promise)
  await copy(w).trigger('click')
  return job
}
async function complete(job: ReturnType<typeof deferred<void>>, fail = false) {
  if (fail) job.reject(new Error('clipboard denied'))
  else job.resolve(undefined)
  await job.promise.catch(() => undefined)
  await nextTick()
}
function expectCopy(w: VueWrapper, copied: boolean) {
  const label = i18n.global.t(copied ? 'clients.tokenCopied' : 'clients.copyToken')
  expect(copy(w).find(copied ? '.lucide-check' : '.lucide-copy').exists()).toBe(true)
  expect(copy(w).attributes('title')).toBe(label)
  expect(copy(w).attributes('aria-label')).toBe(label)
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  authService.setToken('client', 'other-session')
  alternateStoredCredential = localStorage.getItem(clientTokenStorageKey())!
  authService.setToken('client', 'current-session')
  i18n.global.locale.value = 'en-US'
  setClipboard({ writeText })
  vi.spyOn(authService, 'subscribeSessionChanges').mockImplementation(listener => {
    const stop = realSubscribe(listener)
    return () => { unsubscribed(); stop() }
  })
})
afterEach(() => {
  for (const w of wrappers) w.unmount()
  wrappers.clear()
  vi.restoreAllMocks()
  vi.useRealTimers()
  if (savedClipboard) Object.defineProperty(navigator, 'clipboard', savedClipboard)
  else Reflect.deleteProperty(navigator, 'clipboard')
  i18n.global.locale.value = savedLocale
})

it.each([PRIVATE_FORM, 'legacy-client-token'])('copies creation value unchanged: %s', async token => {
  const credential = authService.getClientCredentialForRevocation()
  const storeApp = vi.spyOn(authService, 'setAppToken')
  const w = await reveal(token)
  expect(w.get('.token-value code').text()).toBe(token)
  expect(w.emitted('created')).toHaveLength(1)
  vi.useFakeTimers()
  const job = await beginCopy(w)
  expectCopy(w, false)
  await complete(job)
  expect(writeText).toHaveBeenCalledWith(token)
  expectCopy(w, true)
  await vi.advanceTimersByTimeAsync(1499)
  expectCopy(w, true)
  await vi.advanceTimersByTimeAsync(1)
  expectCopy(w, false)
  expect(mocks.showSuccess).not.toHaveBeenCalled()
  expect(authService.getClientCredentialForRevocation()).toBe(credential)
  expect(storeApp).not.toHaveBeenCalled()
})
it('restarts 1500ms from latest successful copy', async () => {
  const w = await reveal()
  vi.useFakeTimers()
  await complete(await beginCopy(w))
  await vi.advanceTimersByTimeAsync(1000)
  await complete(await beginCopy(w))
  await vi.advanceTimersByTimeAsync(500)
  expectCopy(w, true)
  await vi.advanceTimersByTimeAsync(999)
  expectCopy(w, true)
  await vi.advanceTimersByTimeAsync(1)
  expectCopy(w, false)
})
it.each([false, true])('ignores superseded completion; old failure=%s', async oldFails => {
  const w = await reveal()
  const first = await beginCopy(w)
  const second = await beginCopy(w)
  await complete(second)
  await complete(first, oldFails)
  expectCopy(w, true)
  expect(mocks.showError).not.toHaveBeenCalled()
  const latest = await beginCopy(w)
  await complete(latest, true)
  expectCopy(w, false)
  expect(mocks.showError).toHaveBeenCalledTimes(1)
})
it.each(['missing', 'throw', 'reject'])('reports clipboard %s without success', async mode => {
  const w = await reveal()
  if (mode === 'reject') await complete(await beginCopy(w), true)
  else {
    setClipboard(mode === 'missing' ? undefined : {
      writeText: () => { throw new Error('clipboard denied') }
    })
    await copy(w).trigger('click')
    await nextTick()
  }
  expectCopy(w, false)
  expect(mocks.showError).toHaveBeenCalledTimes(1)
  expect(mocks.showSuccess).not.toHaveBeenCalled()
})

const invalidators = {
  close: (w: VueWrapper) => w.findComponent({ name: 'BaseModal' }).vm.$emit('close'),
  unmount: (w: VueWrapper) => destroy(w),
  session: () => authService.setToken('client', 'next-session'),
  logout: () => authService.removeToken('client'),
  storage: () => window.dispatchEvent(new StorageEvent('storage', { key: clientTokenStorageKey() })),
  clear: () => window.dispatchEvent(new StorageEvent('storage', { key: null }))
}
it.each(Object.keys(invalidators) as Array<keyof typeof invalidators>)(
  '%s clears revealed token and pending copy', async reason => {
    const w = await reveal()
    vi.useFakeTimers()
    await complete(await beginCopy(w))
    const late = await beginCopy(w)
    invalidators[reason](w)
    await nextTick()
    await complete(late, true)
    if (reason !== 'unmount') {
      expect(w.text()).not.toContain(PRIVATE_FORM)
      expect(w.find('.token-value').exists()).toBe(false)
    }
    expect(mocks.showError).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  }
)
it.each([false, true])('discards late creation after session change; reject=%s', async fail => {
  const { w, request } = await startCreate()
  authService.setToken('client', 'next-session')
  if (fail) request.reject(new Error('late create failure'))
  else request.resolve({ data: { token: PRIVATE_FORM } })
  await request.promise.catch(() => undefined)
  await nextTick()
  expect(w.emitted('created')).toBeUndefined()
  expect(w.text()).not.toContain(PRIVATE_FORM)
  expect(mocks.showError).not.toHaveBeenCalled()
})
it('checks credential snapshot before delayed storage event', async () => {
  const { w, request } = await startCreate()
  localStorage.setItem(clientTokenStorageKey(), alternateStoredCredential)
  request.resolve({ data: { token: PRIVATE_FORM } })
  await request.promise
  await nextTick()
  expect(w.emitted('created')).toBeUndefined()
  expect(w.find('.token-value').exists()).toBe(false)
})
it('unrelated storage is harmless; duplicate submit sends once; unsubscribe on unmount', async () => {
  const { w, request } = await startCreate()
  await w.get('form').trigger('submit')
  await w.get('.btn.primary').trigger('click')
  expect(mocks.createClient).toHaveBeenCalledTimes(1)
  request.resolve({ data: { token: PRIVATE_FORM } })
  await request.promise
  await nextTick()
  window.dispatchEvent(new StorageEvent('storage', { key: 'theme' }))
  await nextTick()
  expect(w.get('.token-value code').text()).toBe(PRIVATE_FORM)
  destroy(w)
  expect(unsubscribed).toHaveBeenCalledTimes(1)
})
it.each([
  undefined, null, {}, { token: 123 }, { token: '' }, { token: '   ' },
  { token: 'gtfyc' }, { token: 'gtfyc.%%%%' },
  { token: `gtfyc.${base64UrlEncode(new Uint8Array(31))}` },
  { token: `gtfyc.${base64UrlEncode(new Uint8Array(33))}` },
  { token: `${PRIVATE_FORM}.timestamp.signature` }
])('rejects malformed creation data: %j', async data => {
  const { w, request } = await startCreate()
  request.resolve({ data })
  await request.promise
  await nextTick()
  expect(w.emitted('created')).toHaveLength(1)
  expect(w.emitted('close')).toHaveLength(1)
  expect(w.find('.token-value').exists()).toBe(false)
  expect(writeText).not.toHaveBeenCalled()
  expect(mocks.showError).toHaveBeenCalledWith(
    expect.any(Error), i18n.global.t('clients.invalidTokenResponse')
  )
})

it.each(Object.keys(invalidators) as Array<keyof typeof invalidators>)(
  'late creation is inert after %s', async reason => {
    for (const fail of [false, true]) {
      const { w, request } = await startCreate()
      invalidators[reason](w)
      if (fail) request.reject(new Error('late create'))
      else request.resolve({ data: { token: PRIVATE_FORM } })
      await request.promise.catch(() => undefined)
      await nextTick()
      expect(w.emitted('created')).toBeUndefined()
      expect(mocks.showError).not.toHaveBeenCalled()
      if (wrappers.has(w)) destroy(w)
    }
  }
)
it('late successful copy cannot revive a closed modal', async () => {
  const w = await reveal()
  vi.useFakeTimers()
  const job = await beginCopy(w)
  invalidators.close(w)
  await complete(job)
  expect(w.find('.token-value').exists()).toBe(false)
  expect(vi.getTimerCount()).toBe(0)
})
it('pending copy also checks credential snapshot', async () => {
  const w = await reveal()
  const job = await beginCopy(w)
  localStorage.setItem(clientTokenStorageKey(), alternateStoredCredential)
  await complete(job, true)
  expect(mocks.showError).not.toHaveBeenCalled()
  expect(w.find('.token-value').exists()).toBe(false)
  expect(w.emitted('close')).toHaveLength(1)
})

it.each(['replace', 'remove', 'clear'])(
  'refuses to copy a revealed token after storage %s before its event arrives', async change => {
    const w = await reveal()
    if (change === 'replace') localStorage.setItem(clientTokenStorageKey(), alternateStoredCredential)
    if (change === 'remove') localStorage.removeItem(clientTokenStorageKey())
    if (change === 'clear') localStorage.clear()


    await copy(w).trigger('click')
    expect(writeText).not.toHaveBeenCalled()
    expect(w.find('.token-value').exists()).toBe(false)
    expect(w.emitted('close')).toHaveLength(1)
    expect(mocks.showError).not.toHaveBeenCalled()
  }
)

it('does not submit an old form after the stored session changes before its event', async () => {
  const w = mount(CreateClientModal, { global: { plugins: [i18n] } })
  wrappers.add(w)
  await w.get('input[type="text"]').setValue('Old session client')
  localStorage.setItem(clientTokenStorageKey(), alternateStoredCredential)
  await w.get('form').trigger('submit')
  expect(mocks.createClient).not.toHaveBeenCalled()
  expect(w.emitted('close')).toHaveLength(1)
  expect((w.get('input').element as HTMLInputElement).value).toBe('')
})

it('clears revealed token when a feedback timer observes a changed session', async () => {
  const w = await reveal()
  vi.useFakeTimers()
  await complete(await beginCopy(w))
  localStorage.setItem(clientTokenStorageKey(), alternateStoredCredential)
  await vi.advanceTimersByTimeAsync(1500)
  expect(w.find('.token-value').exists()).toBe(false)
  expect(w.emitted('close')).toHaveLength(1)
  expect(vi.getTimerCount()).toBe(0)
})
