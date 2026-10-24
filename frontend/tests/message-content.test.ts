import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import MessageContent from '@/components/MessageContent.vue'
import { usePreferencesStore } from '@/stores/preferences'
import { ensureHljsLoadedForTest, renderMessage } from '@/utils/markdown'
import i18n from '@/locales'

const feedback = vi.hoisted(() => ({ showError: vi.fn(), showSuccess: vi.fn() }))
const modulesGate = vi.hoisted(() => ({ pending: undefined as Promise<boolean> | undefined }))
vi.mock('@/utils/errorHandler', () => feedback)
vi.mock('@/utils/markdown', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/markdown')>()
  return {
    ...actual,
    renderMessage: vi.fn(actual.renderMessage),
    ensureModules: (needed: Parameters<typeof actual.ensureModules>[0]) =>
      modulesGate.pending ?? actual.ensureModules(needed)
  }
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const wrappers = new Set<VueWrapper>()
const hosts = new Set<HTMLElement>()
const writeText = vi.fn()
const savedClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
const savedLocale = i18n.global.locale.value
function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value })
}
const mountIt = (props: { content: string }, pinia = createPinia(), attachTo?: HTMLElement) => {
  const w = mount(MessageContent, {
    props, ...(attachTo ? { attachTo } : {}), global: { plugins: [pinia, i18n] }
  })
  wrappers.add(w)
  return w
}
function destroy(w: VueWrapper) { w.unmount(); wrappers.delete(w) }
async function mountCode(content = '```json\n{"a":1}\n```', pinia = createPinia()) {
  const w = mountIt({ content }, pinia)

  await vi.dynamicImportSettled()
  await flushPromises()
  expect(w.find('button.code-copy').exists()).toBe(true)
  return w
}
const button = (w: VueWrapper, index = 0) => w.findAll('button.code-copy')[index]
async function beginCopy(w: VueWrapper, index = 0) {
  const job = deferred<void>()
  writeText.mockReturnValueOnce(job.promise)
  await button(w, index).trigger('click')
  return job
}
async function complete(job: ReturnType<typeof deferred<void>>, fail = false) {
  if (fail) job.reject(new Error('denied'))
  else job.resolve(undefined)
  await job.promise.catch(() => undefined)
  await nextTick()
}
function expectIcon(w: VueWrapper, checked: boolean, index = 0) {
  const btn = button(w, index)
  expect(btn.find(checked ? '.md-icon-check' : '.md-icon-copy').exists()).toBe(true)
  const label = i18n.global.t(checked ? 'messages.copied' : 'messages.codeCopy')
  expect(btn.attributes('title')).toBe(label)
  expect(btn.attributes('aria-label')).toBe(label)
}
beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  localStorage.removeItem('render_markdown')
  modulesGate.pending = undefined
  i18n.global.locale.value = 'en-US'
  setClipboard({ writeText })
})
afterEach(() => {
  for (const w of wrappers) w.unmount()
  wrappers.clear()
  for (const host of hosts) host.remove()
  hosts.clear()
  modulesGate.pending = undefined
  vi.restoreAllMocks()
  vi.useRealTimers()
  if (savedClipboard) Object.defineProperty(navigator, 'clipboard', savedClipboard)
  else Reflect.deleteProperty(navigator, 'clipboard')
  i18n.global.locale.value = savedLocale
})

describe('MessageContent', () => {
  it('默认渲染 Markdown 富文本', () => {
    const w = mountIt({ content: '**重点** 内容' })
    expect(w.find('.markdown-body').exists()).toBe(true)
    expect(w.html()).toContain('<strong>重点</strong>')
  })

  it('未命中模式保持纯文本并保留换行', () => {
    const w = mountIt({ content: '第一行\n第二行' })
    expect(w.find('.markdown-body').exists()).toBe(false)
    expect(w.find('.message-content-plain').exists()).toBe(true)
  })

  it('开关关闭后全部回退纯文本', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const prefs = usePreferencesStore(pinia)
    prefs.setRenderMarkdown(false)
    const w = mountIt({ content: '**重点**' }, pinia)
    await flushPromises()
    expect(w.find('.markdown-body').exists()).toBe(false)
    expect(w.text()).toContain('**重点**')
  })

  it('复制按钮经事件委托取 code 文本写入剪贴板', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard({ writeText })
    const w = mountIt({ content: '```json\n{"a":1}\n```' })
    await flushPromises()
    await vi.dynamicImportSettled()
    await flushPromises()
    const btn = w.find('button.code-copy')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')
    expect(writeText).toHaveBeenCalledWith('{"a":1}')
  })

  it('公式内容先显示原始 TeX，模块加载后升级为 KaTeX', async () => {
    const w = mountIt({ content: '质量 $$E=mc^2$$ 单位' })
    expect(w.html()).not.toContain('katex')
    await flushPromises()
    await vi.dynamicImportSettled()
    await flushPromises()
    expect(w.html()).toContain('katex')
  })
})

it('waits for success and restarts full 1500ms after repeat copy', async () => {
  const w = await mountCode()
  vi.useFakeTimers()
  const first = await beginCopy(w)
  expectIcon(w, false)
  await complete(first)
  expect(writeText).toHaveBeenCalledWith('{"a":1}')
  expectIcon(w, true)
  await vi.advanceTimersByTimeAsync(1000)
  await complete(await beginCopy(w))
  await vi.advanceTimersByTimeAsync(1499)
  expectIcon(w, true)
  await vi.advanceTimersByTimeAsync(1)
  expectIcon(w, false)
  expect(feedback.showSuccess).not.toHaveBeenCalled()
})
it('a pending repeat does not extend the previous successful feedback', async () => {
  const w = await mountCode()
  vi.useFakeTimers()
  await complete(await beginCopy(w))
  await vi.advanceTimersByTimeAsync(1000)
  const pending = await beginCopy(w)
  await vi.advanceTimersByTimeAsync(500)
  expectIcon(w, false)
  await complete(pending)
  expectIcon(w, true)
  await vi.advanceTimersByTimeAsync(1500)
  expectIcon(w, false)
})
it.each(['missing', 'throw', 'reject'])('does not show success for clipboard %s', async mode => {
  const w = await mountCode()
  if (mode === 'reject') await complete(await beginCopy(w), true)
  else {
    setClipboard(mode === 'missing' ? undefined : {
      writeText: () => { throw new Error('denied') }
    })
    await button(w).trigger('click')
    await nextTick()
  }
  expectIcon(w, false)
  expect(feedback.showError).toHaveBeenCalledTimes(1)
  expect(feedback.showSuccess).not.toHaveBeenCalled()
})
it.each([false, true])('ignores superseded completion; reject=%s', async fail => {
  const w = await mountCode()
  const old = await beginCopy(w)
  const latest = await beginCopy(w)
  await complete(latest)
  await complete(old, fail)
  expectIcon(w, true)
  expect(feedback.showError).not.toHaveBeenCalled()
})
it('keeps two code blocks independent', async () => {
  const w = await mountCode('```txt\none\n```\n\n```txt\ntwo\n```')
  vi.useFakeTimers()
  await complete(await beginCopy(w, 0))
  await vi.advanceTimersByTimeAsync(1000)
  await complete(await beginCopy(w, 1))
  await vi.advanceTimersByTimeAsync(500)
  expectIcon(w, false, 0)
  expectIcon(w, true, 1)
  await complete(await beginCopy(w, 0), true)
  expectIcon(w, false, 0)
  expectIcon(w, true, 1)
})
it.each(['content', 'locale', 'preference', 'unmount'])(
  '%s invalidates pending results and timers', async change => {
    const pinia = createPinia()
    const w = await mountCode(undefined, pinia)
    vi.useFakeTimers()
    await complete(await beginCopy(w))
    const old = await beginCopy(w)
    if (change === 'content') await w.setProps({ content: '```json\n{"b":2}\n```' })
    if (change === 'locale') { i18n.global.locale.value = 'zh-CN'; await nextTick() }
    if (change === 'preference') { usePreferencesStore(pinia).setRenderMarkdown(false); await nextTick() }
    if (change === 'unmount') destroy(w)
    await complete(old, true)
    expect(feedback.showError).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    if (change === 'content' || change === 'locale') expectIcon(w, false)
  }
)
it.each([false, true])('module upgrade respects disposed=%s', async disposed => {
  await ensureHljsLoadedForTest()
  const upgrade = deferred<boolean>()
  modulesGate.pending = upgrade.promise
  const w = mountIt({ content: '```json\n{"a":1}\n```' })
  const old = await beginCopy(w)
  const callsBefore = vi.mocked(renderMessage).mock.calls.length
  if (disposed) destroy(w)
  modulesGate.pending = undefined
  upgrade.resolve(true)
  await upgrade.promise
  await nextTick()
  await complete(old)
  if (disposed) expect(vi.mocked(renderMessage).mock.calls).toHaveLength(callsBefore)
  else expectIcon(w, false)
  expect(feedback.showError).not.toHaveBeenCalled()
})
it('svg path copy/format do not bubble to a parent card', async () => {
  await ensureHljsLoadedForTest()
  const host = document.createElement('div')
  document.body.append(host)
  hosts.add(host)
  const parentClick = vi.fn()
  host.addEventListener('click', parentClick)
  const w = mountIt({ content: '```json\n{"a":1}\n```' }, createPinia(), host)
  const job = deferred<void>()
  writeText.mockReturnValueOnce(job.promise)
  await button(w).get('svg path').trigger('click')
  expect(writeText).toHaveBeenCalledTimes(1)
  expect(writeText).toHaveBeenCalledWith('{"a":1}')
  expect(parentClick).not.toHaveBeenCalled()
  await complete(job)
  await w.get('button.code-format').trigger('click')
  expect(parentClick).not.toHaveBeenCalled()
  expect(w.find('button.code-format').exists()).toBe(false)
  expect(w.get('code').text()).toContain('"a": 1')
})
