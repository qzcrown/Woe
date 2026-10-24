import { describe, it, expect, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import BaseModal from '@/components/BaseModal.vue'
import i18n from '@/locales'


const mountModal = (slots: Record<string, string> = {}) => mount(BaseModal, {
  attachTo: document.body,
  global: { plugins: [i18n] },
  slots: {
    title: '<h2>标题</h2>',
    default: '<input class="body-input" /><button class="inner-btn">操作</button>',
    footer: '<button class="footer-btn">确定</button>',
    ...slots
  }
})

const pressTab = (target: HTMLElement, shiftKey = false) => {
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

let wrapper: VueWrapper | null = null

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('BaseModal a11y（tabindex + 焦点陷阱）', () => {
  it('modal-body 可聚焦，容器本体不进入 Tab 序列', () => {
    wrapper = mountModal()
    expect(wrapper.find('.modal-body').attributes('tabindex')).toBe('0')
    expect(wrapper.find('.modal-container').attributes('tabindex')).toBe('-1')
  })

  it('挂载后初始焦点落在关闭按钮', () => {
    wrapper = mountModal()
    expect(document.activeElement).toBe(wrapper.find('.close-btn').element)
  })

  it('末尾 Tab 回到首项，首项 Shift+Tab 回到末尾', () => {
    wrapper = mountModal()
    const first = wrapper.find('.close-btn').element as HTMLElement
    const last = wrapper.find('.footer-btn').element as HTMLElement

    last.focus()
    expect(pressTab(last).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(first)

    expect(pressTab(first, true).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(last)
  })

  it.each([false, true])('内部按钮的 Tab（shift=%s）交给浏览器且不移动焦点', (shiftKey) => {
    wrapper = mountModal()
    const button = wrapper.find('.inner-btn').element as HTMLElement
    button.focus()

    expect(pressTab(button, shiftKey).defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(button)
  })

  it('内部控件已处理的 Tab 在首尾也不会被弹窗抢走', () => {
    wrapper = mountModal()
    const last = wrapper.find('.footer-btn').element as HTMLElement
    last.addEventListener('keydown', (event) => event.preventDefault())
    last.focus()

    expect(pressTab(last).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(last)
  })


  it.each([
    ['v-show 隐藏的高级区', '<section style="display: none"><input /></section>'],
    ['直接 display:none 的文件输入', '<input type="file" style="display: none" />'],
    ['hidden 祖先', '<section hidden><button>隐藏操作</button></section>'],
    ['直接 hidden 的按钮', '<button hidden>隐藏操作</button>'],
    ['visibility:hidden 祖先', '<section style="visibility: hidden"><input /></section>'],
    ['直接 visibility:hidden 的按钮', '<button style="visibility: hidden">隐藏操作</button>'],
    ['隐藏类型的输入', '<input type="hidden" />'],
    ['tabindex=-1 的原生控件', '<button tabindex="-1">程序焦点</button>'],
    ['其他负 tabindex', '<input tabindex="-2" />'],
    ['disabled fieldset 内的输入', '<fieldset disabled><input /></fieldset>'],
    ['inert 祖先', '<section inert><button>禁用区域</button></section>']
  ])('边界循环跳过%s', (_name, hiddenContent) => {
    wrapper = mountModal({
      title: `${hiddenContent}<button class="first">首项</button>`,
      footer: `<button class="last">末项</button>${hiddenContent}`
    })
    const first = wrapper.find('.first').element as HTMLElement
    const last = wrapper.find('.last').element as HTMLElement

    last.focus()
    expect(pressTab(last).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(first)
    expect(pressTab(first, true).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(last)
  })

  it('高级区显示与隐藏后，立即按最新可达项确定末尾边界', () => {
    wrapper = mountModal({
      footer: '<button class="footer-btn">发送</button><section class="advanced" style="display: none"><input class="advanced-input" /></section>'
    })
    const first = wrapper.find('.close-btn').element as HTMLElement
    const button = wrapper.find('.footer-btn').element as HTMLElement
    const advanced = wrapper.find('.advanced').element as HTMLElement
    const input = wrapper.find('.advanced-input').element as HTMLElement

    button.focus()
    expect(pressTab(button).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(first)

    advanced.style.display = ''
    button.focus()
    expect(pressTab(button).defaultPrevented).toBe(false)
    input.focus()
    expect(pressTab(input).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(first)

    advanced.style.display = 'none'
    button.focus()
    expect(pressTab(button).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(first)
  })

  it('disabled fieldset 首个 legend 内的按钮仍可作为末项', () => {
    wrapper = mountModal({
      footer: '<fieldset disabled><legend><button class="legend-button">标题操作</button></legend><input /></fieldset>'
    })
    const first = wrapper.find('.close-btn').element as HTMLElement
    const last = wrapper.find('.legend-button').element as HTMLElement
    first.focus()
    pressTab(first, true)
    expect(document.activeElement).toBe(last)
    pressTab(last)
    expect(document.activeElement).toBe(first)
  })

  it.each([false, true])('焦点在弹窗外时按 Tab（shift=%s）落回对应边界', (shiftKey) => {
    wrapper = mountModal()
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    try {
      outside.focus()
      expect(pressTab(outside, shiftKey).defaultPrevented).toBe(true)
      expect(document.activeElement).toBe(wrapper.find(shiftKey ? '.footer-btn' : '.close-btn').element)
    } finally {
      outside.remove()
    }
  })

  it('没有可达项时将焦点留在容器', async () => {
    wrapper = mount(BaseModal, { attachTo: document.body, props: { hideClose: true }, global: { plugins: [i18n] } })
    const body = wrapper.find('.modal-body').element as HTMLElement
    const container = wrapper.find('.modal-container').element as HTMLElement
    body.tabIndex = -1
    body.focus()

    expect(pressTab(body).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(container)
  })

  it('卸载时把焦点还给打开弹窗前的元素', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    try {
      outside.focus()
      wrapper = mountModal()
      wrapper.unmount()
      wrapper = null
      expect(document.activeElement).toBe(outside)
    } finally {
      outside.remove()
    }
  })

  it('叠窗只由栈顶处理边界，卸载后恢复下层焦点与边界循环', () => {
    wrapper = mountModal()
    const outerLast = wrapper.find('.footer-btn').element as HTMLElement
    const outerFirst = wrapper.find('.close-btn').element as HTMLElement
    outerLast.focus()
    const inner = mountModal()
    try {
      const innerLast = inner.find('.footer-btn').element as HTMLElement
      const innerFirst = inner.find('.close-btn').element as HTMLElement
      innerLast.focus()
      pressTab(innerLast)
      expect(document.activeElement).toBe(innerFirst)

      outerLast.focus()
      pressTab(outerLast)
      expect(document.activeElement).toBe(innerFirst)
    } finally {
      inner.unmount()
    }
    expect(document.activeElement).toBe(outerLast)
    pressTab(outerLast)
    expect(document.activeElement).toBe(outerFirst)
  })
})
