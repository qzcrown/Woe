import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import SendNotificationModal from '@/components/SendNotificationModal.vue'
import i18n from '@/locales'

const mocks = vi.hoisted(() => ({
  getApplications: vi.fn(), createMessage: vi.fn(), showError: vi.fn()
}))
vi.mock('@/services/api', () => ({
  applicationApi: { getApplications: mocks.getApplications },
  messageApi: { createMessage: mocks.createMessage }
}))
vi.mock('@/services/auth', () => ({ authService: { setApplicationsCache: vi.fn() } }))
vi.mock('@/utils/errorHandler', () => ({ showError: mocks.showError }))
vi.mock('@/utils/wysiwyg', () => ({ mountWysiwygEditor: vi.fn() }))
vi.mock('@/components/BaseModal.vue', () => ({ default: {
  template: '<div><slot name="title"/><slot/><slot name="footer"/></div>'
}}))
let wrapper: VueWrapper | undefined
const savedLocale = i18n.global.locale.value
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.removeItem('woe_message_tags_history')
  mocks.getApplications.mockResolvedValue({ data: [{ id: 1, name: 'App 1' }] })
  mocks.createMessage.mockResolvedValue({ data: { id: 42 } })
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; i18n.global.locale.value = savedLocale })

it.each([
  ['en-US', 'Remove tag alpha-beta'], ['zh-CN', '移除标签 alpha-beta']
] as const)('named removal works in %s without sending', async (locale, label) => {
  i18n.global.locale.value = locale
  wrapper = mount(SendNotificationModal, { global: { plugins: [i18n] } })
  await flushPromises()
  await wrapper.get('select').setValue(1)
  await wrapper.get('input.input').setValue('Valid title')
  await wrapper.get('textarea').setValue('Valid content')
  await wrapper.get('.collapse-toggle').trigger('click')
  for (const tag of ['alpha-beta', 'beta']) {
    await wrapper.get('input.tag-input').setValue(tag)
    await wrapper.get('input.tag-input').trigger('keydown', { key: 'Enter' })
  }
  const tags = wrapper.findAll('.selected-tags .tag.selected')
  expect(tags).toHaveLength(2)
  const remove = tags.find(tag => tag.attributes('aria-label') === label)!
  expect(remove).toBeDefined()
  expect(remove.element.tagName).toBe('BUTTON')
  expect(remove.attributes('type')).toBe('button')
  expect(remove.attributes('title')).toBe(label)
  await remove.get('svg path').trigger('click')
  expect(wrapper.findAll('.selected-tags .tag.selected').map(tag => tag.text())).toEqual(['beta'])
  expect(mocks.createMessage).not.toHaveBeenCalled()
  expect(wrapper.emitted('submitted')).toBeUndefined()

  await wrapper.get('.submit-btn').trigger('click')
  await flushPromises()
  expect(mocks.createMessage).toHaveBeenCalledTimes(1)
  expect(mocks.createMessage).toHaveBeenCalledWith(1, expect.objectContaining({
    title: 'Valid title', message: 'Valid content',
    extras: expect.objectContaining({ 'woe::filter::tags': ['beta'] })
  }))
  expect(wrapper.emitted('submitted')).toHaveLength(1)
  expect(mocks.showError).not.toHaveBeenCalled()
})
