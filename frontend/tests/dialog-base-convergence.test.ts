import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import i18n from '@/locales'

const mountWithI18n = (component: Parameters<typeof mount>[0], props: Record<string, unknown>) =>
  mount(component, { props, global: { plugins: [i18n] } })

describe('ConfirmDialog 收敛到 BaseModal 基座', () => {
  it('渲染基座容器（继承限高/滚动契约）且不渲染右上角关闭钮', () => {
    const wrapper = mountWithI18n(ConfirmDialog, {
      visible: true, title: '删除确认', message: '确定删除？'
    })
    expect(wrapper.find('.modal-container').exists()).toBe(true)
    expect(wrapper.find('.modal-body').exists()).toBe(true)
    expect(wrapper.find('.close-btn').exists()).toBe(false)
    expect(wrapper.find('.confirm-dialog-title').text()).toBe('删除确认')
  })

  it('遮罩层级 z-index=2000（可叠开在常规弹窗之上）', () => {
    const wrapper = mountWithI18n(ConfirmDialog, { visible: true, message: 'x' })
    const backdrop = wrapper.find('.modal-backdrop').element as HTMLElement
    expect(backdrop.style.zIndex).toBe('2000')
  })

  it('确认/取消按钮发对应事件，遮罩点击按 closeOnOverlayClick 语义取消', async () => {
    const wrapper = mountWithI18n(ConfirmDialog, {
      visible: true, message: 'x', confirmText: '删', cancelText: '留'
    })
    await wrapper.find('.btn-primary').trigger('click')
    expect(wrapper.emitted('confirm')).toHaveLength(1)
    await wrapper.find('.btn-secondary').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    await wrapper.find('.modal-backdrop').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(2)

    const blocked = mountWithI18n(ConfirmDialog, {
      visible: true, message: 'x', closeOnOverlayClick: false
    })
    await blocked.find('.modal-backdrop').trigger('click')
    expect(blocked.emitted('cancel')).toBeUndefined()
    blocked.unmount()
  })
})

describe('Alert 模式收敛到 ConfirmDialog（单按钮，遮罩点击=确认）', () => {
  it('渲染基座容器，缺省标题走类型默认 i18n，确认与遮罩点击都发 confirm', async () => {
    const wrapper = mountWithI18n(ConfirmDialog, { visible: true, mode: 'alert', message: '已保存' })
    expect(wrapper.find('.modal-container').exists()).toBe(true)
    expect(wrapper.find('.close-btn').exists()).toBe(false)
    expect(wrapper.find('.confirm-dialog-title').text()).toBe('Info')

    await wrapper.find('.btn-primary').trigger('click')
    expect(wrapper.emitted('confirm')).toHaveLength(1)
    await wrapper.find('.modal-backdrop').trigger('click')
    expect(wrapper.emitted('confirm')).toHaveLength(2)
  })

  it('不渲染取消按钮', async () => {
    const wrapper = mountWithI18n(ConfirmDialog, { visible: true, mode: 'alert', message: 'x' })
    expect(wrapper.find('.btn-secondary').exists()).toBe(false)
  })
})
