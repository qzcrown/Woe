<template>
  <div
    v-if="isRich"
    ref="contentRoot"
    class="message-content markdown-body"
    v-html="html"
    @click="onContentClick"
  ></div>
  <div v-else class="message-content message-content-plain">{{ content }}</div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  renderMessage,
  neededModules,
  ensureModules,
  setToolbarLabels,
  highlightJsonHtml,
  MD_CHECK_ICON_SVG
} from '@/utils/markdown'
import { usePreferencesStore } from '@/stores/preferences'
import { showError } from '@/utils/errorHandler'


const COPY_FEEDBACK_MS = 1500

const props = defineProps<{
  content: string
}>()

const { t, locale } = useI18n()
const prefs = usePreferencesStore()

const isRich = ref(false)
const html = ref('')

const contentRoot = ref<HTMLElement | null>(null)


interface CopyFeedback {

  sequence: number

  feedbackVersion: number

  originalHtml: string
  originalTitle: string
  originalLabel: string
  timer: ReturnType<typeof setTimeout> | null
}
const copyFeedbacks = new Map<HTMLButtonElement, CopyFeedback>()

let disposed = false

let renderGeneration = 0

const isCurrentButton = (
  btn: HTMLButtonElement, state: CopyFeedback, generation: number
): boolean => !disposed && generation === renderGeneration &&
  contentRoot.value?.contains(btn) === true && copyFeedbacks.get(btn) === state
const isCurrentCopy = (
  btn: HTMLButtonElement, state: CopyFeedback, sequence: number, generation: number
): boolean => isCurrentButton(btn, state, generation) && state.sequence === sequence


const restoreButton = (btn: HTMLButtonElement, state: CopyFeedback): void => {
  btn.innerHTML = state.originalHtml
  btn.title = state.originalTitle
  btn.setAttribute('aria-label', state.originalLabel)
}


const clearButtonFeedback = (btn: HTMLButtonElement, state: CopyFeedback): void => {
  state.feedbackVersion += 1
  if (state.timer) {
    clearTimeout(state.timer)
    state.timer = null
  }
  restoreButton(btn, state)
}


const clearCopyFeedbacks = (): void => {
  for (const [btn, state] of copyFeedbacks) {
    state.feedbackVersion += 1
    if (state.timer) clearTimeout(state.timer)
    state.timer = null
    restoreButton(btn, state)
  }
  copyFeedbacks.clear()
}

const render = () => {
  setToolbarLabels({ copy: t('messages.codeCopy'), format: t('messages.codeFormat') })
  renderGeneration += 1

  clearCopyFeedbacks()
  if (!prefs.renderMarkdown) {
    isRich.value = false
    html.value = ''
    return
  }
  const result = renderMessage(props.content)
  isRich.value = result.mode === 'rich'
  html.value = result.mode === 'rich' ? result.html : ''
  const needed = neededModules(props.content)
  if (result.mode === 'rich' && needed.length > 0) {

    void ensureModules(needed)
      .then((fresh) => {
        if (disposed || !fresh) return
        render()
      })
      .catch(() => {})
  }
}

watch(
  [() => props.content, () => prefs.renderMarkdown, locale],
  render,
  { immediate: true }
)

onBeforeUnmount(() => {
  disposed = true
  clearCopyFeedbacks()
})







const copyCode = async (btn: HTMLButtonElement, text: string): Promise<void> => {
  let state = copyFeedbacks.get(btn)
  if (!state) {
    state = {
      sequence: 0,
      feedbackVersion: 0,
      originalHtml: btn.innerHTML,
      originalTitle: btn.title,
      originalLabel: btn.getAttribute('aria-label') ?? '',
      timer: null
    }
    copyFeedbacks.set(btn, state)
  }
  const generation = renderGeneration
  const sequence = ++state.sequence
  try {
    const clipboard = navigator.clipboard
    if (!clipboard?.writeText) throw new Error('clipboard API unavailable')
    await clipboard.writeText(text)
  } catch (err) {
    if (!isCurrentCopy(btn, state, sequence, generation)) return
    clearButtonFeedback(btn, state)
    showError(err as Error, t('messages.codeCopyError'))
    return
  }
  if (!isCurrentCopy(btn, state, sequence, generation)) return

  if (state.timer) {
    clearTimeout(state.timer)
    state.timer = null
  }
  state.feedbackVersion += 1
  const version = state.feedbackVersion
  btn.innerHTML = MD_CHECK_ICON_SVG
  const label = t('messages.copied')
  btn.title = label
  btn.setAttribute('aria-label', label)
  state.timer = setTimeout(() => {


    state.timer = null
    if (!isCurrentButton(btn, state, generation)) return
    if (state.feedbackVersion !== version) return
    restoreButton(btn, state)
  }, COPY_FEEDBACK_MS)
}


const onContentClick = (e: MouseEvent) => {

  if (!(e.target instanceof Element)) return

  if (e.target.closest('a')) e.stopPropagation()
  const btn = e.target.closest('button')
  if (!btn) return
  const block = btn.closest('.code-block')
  if (!block) return
  const codeEl = block.querySelector('code')
  if (!codeEl) return
  if (btn.classList.contains('code-copy')) {

    e.stopPropagation()

    const text = (codeEl.textContent ?? '').replace(/\n$/, '')
    void copyCode(btn, text)
  } else if (btn.classList.contains('code-format')) {
    e.stopPropagation()
    try {
      const pretty = JSON.stringify(JSON.parse(codeEl.textContent ?? ''), null, 2)
      codeEl.innerHTML = highlightJsonHtml(pretty)
      btn.remove()
    } catch {

    }
  }
}
</script>

<style scoped>
.message-content-plain {
  white-space: pre-wrap;
  word-break: break-word;
}



.markdown-body.markdown-body {
  white-space: normal;
}


.message-content-display.markdown-body.markdown-body {
  background: transparent;
  padding: 0;
  max-height: none;
}
</style>
