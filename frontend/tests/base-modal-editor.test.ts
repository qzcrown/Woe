import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { h } from 'vue'
import { Editor, rootCtx, defaultValueCtx, editorViewCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { TextSelection } from '@milkdown/kit/prose/state'
import BaseModal from '@/components/BaseModal.vue'
import i18n from '@/locales'

let wrapper: VueWrapper | undefined
let editor: Editor | undefined

const rangeGeometry = ['getClientRects', 'getBoundingClientRect'] as const
const originalGeometry = rangeGeometry.map((name) => Object.getOwnPropertyDescriptor(Range.prototype, name))
beforeAll(() => {

  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
})
afterAll(() => {
  rangeGeometry.forEach((name, index) => {
    const descriptor = originalGeometry[index]
    if (descriptor) Object.defineProperty(Range.prototype, name, descriptor)
    else Reflect.deleteProperty(Range.prototype, name)
  })
})

afterEach(async () => {
  await editor?.destroy()
  editor = undefined
  wrapper?.unmount()
  wrapper = undefined
})

describe('BaseModal 内真实 Milkdown commonmark 键盘交互', () => {
  it.each([
    ['Tab 缩进列表项', '- one\n- two', false, 'doc(bullet_list(list_item(paragraph("one"), bullet_list(list_item(paragraph("two"))))))'],
    ['Shift+Tab 取消列表缩进', '- one\n  - two', true, 'doc(bullet_list(list_item(paragraph("one")), list_item(paragraph("two"))))']
  ])('%s 并保留编辑器焦点', async (_name, markdown, shiftKey, expectedDocument) => {
    wrapper = mount(BaseModal, {
      attachTo: document.body,
      global: { plugins: [i18n] },
      slots: {
        default: () => h('div', { class: 'editor-host' }),
        footer: '<button class="send">发送</button>'
      }
    })
    editor = await Editor.make().config((ctx) => {
      ctx.set(rootCtx, wrapper!.find('.editor-host').element as HTMLElement)
      ctx.set(defaultValueCtx, markdown)
    }).use(commonmark).create()
    const view = editor.action((ctx) => ctx.get(editorViewCtx))
    let textPosition = 0
    view.state.doc.descendants((node, position) => {
      if (node.isText && node.text === 'two') textPosition = position
    })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, textPosition + 1)))
    view.focus()

    const event = new KeyboardEvent('keydown', { key: 'Tab', keyCode: 9, which: 9, shiftKey, bubbles: true, cancelable: true })
    view.dom.dispatchEvent(event)

    expect(view.state.doc.toString()).toBe(expectedDocument)
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(view.dom)
  })
})
