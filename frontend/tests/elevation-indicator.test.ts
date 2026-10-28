import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'


vi.mock('@/services/websocket', () => ({
  wsService: {
    connect: vi.fn(),
    disconnect: vi.fn(),
  },
}))

import { useAuthStore } from '@/stores/auth'
import { useElevationIndicator } from '@/composables/useElevationIndicator'






const Harness = defineComponent({
  setup() {
    const { isElevated } = useElevationIndicator()
    return () => h('div', { 'data-state': String(isElevated.value) })
  },
})

const mountHarness = () => {
  setActivePinia(createPinia())
  return mount(Harness)
}

const stateOf = (wrapper: { find: (sel: string) => { attributes: (a: string) => string } }) =>
  wrapper.find('div').attributes('data-state')

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
})

afterEach(() => {

  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('提权环形提示的状态判定', () => {
  it('未提权时为 false，推进时间也不复活', async () => {
    const wrapper = mountHarness()
    expect(useAuthStore().elevatedUntil).toBeNull()
    expect(stateOf(wrapper)).toBe('false')
    vi.advanceTimersByTime(5000)
    await nextTick()
    expect(stateOf(wrapper)).toBe('false')
    wrapper.unmount()
  })

  it('markElevated 后立即为 true，窗口到点自动熄灭并停表', async () => {
    const wrapper = mountHarness()
    useAuthStore().markElevated(3)
    await nextTick()
    expect(stateOf(wrapper)).toBe('true')
    vi.advanceTimersByTime(2500)
    await nextTick()
    expect(stateOf(wrapper)).toBe('true')
    vi.advanceTimersByTime(600)
    await nextTick()
    expect(stateOf(wrapper)).toBe('false')
    vi.advanceTimersByTime(10000)
    await nextTick()
    expect(stateOf(wrapper)).toBe('false')
    wrapper.unmount()
  })

  it('挂载前已提权：immediate 判定为 true 并起表', async () => {
    setActivePinia(createPinia())
    useAuthStore().markElevated(900)
    const wrapper = mount(Harness)
    await nextTick()
    expect(stateOf(wrapper)).toBe('true')
    vi.advanceTimersByTime(901000)
    await nextTick()
    expect(stateOf(wrapper)).toBe('false')
    wrapper.unmount()
  })

  it('登出清空软缓存后立即熄灭（无需等心跳）', async () => {
    const wrapper = mountHarness()
    const store = useAuthStore()
    store.markElevated(900)
    await nextTick()
    expect(stateOf(wrapper)).toBe('true')
    store.resetLocalAuth()
    await nextTick()
    expect(stateOf(wrapper)).toBe('false')
    wrapper.unmount()
  })

  it('作用域卸载后停表（clearInterval 收到心跳句柄）', async () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval')
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval')
    const wrapper = mountHarness()
    useAuthStore().markElevated(900)
    await nextTick()
    expect(setIntervalSpy).toHaveBeenCalled()
    const handle = setIntervalSpy.mock.results[0].value
    wrapper.unmount()
    expect(clearIntervalSpy).toHaveBeenCalledWith(handle)
  })
})
