<template>
  <div class="modal-backdrop" :style="backdropStyle" @click="emitClose">
    <div ref="containerRef" class="modal-container" tabindex="-1" :style="containerStyle" @click.stop>
      <div class="modal-header">
        <slot name="title" />
        <button v-if="!hideClose" type="button" class="close-btn" @click="emitClose"
          :title="$t('common.close')" :aria-label="$t('common.close')">
          <X :size="16" aria-hidden="true" />
        </button>
      </div>

      <div class="modal-body" tabindex="0">
        <slot />
      </div>
      <div class="modal-footer">
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>

<script lang="ts">

let modalInstanceSeq = 0
const openModalStack: number[] = []
</script>

<script setup lang="ts">
import { computed, defineEmits, onBeforeUnmount, onMounted, ref } from 'vue'
import { X } from '@lucide/vue'




const props = defineProps<{ maxWidth?: string; zIndex?: number; hideClose?: boolean }>()

const emit = defineEmits(['close'])
const emitClose = () => emit('close')

const containerStyle = computed(() =>
  props.maxWidth ? { maxWidth: props.maxWidth } : undefined
)

const backdropStyle = computed(() =>
  props.zIndex ? { zIndex: String(props.zIndex) } : undefined
)

const containerRef = ref<HTMLElement | null>(null)

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable]:not([contenteditable="false"])'
].join(', ')

let instanceId = 0
let previouslyFocused: HTMLElement | null = null

const getFocusables = (): HTMLElement[] => {
  if (!containerRef.value) return []
  return Array.from(containerRef.value.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {

    if (element.matches(':disabled, input[type="hidden"]')) return false
    if (element.hasAttribute('tabindex') && element.tabIndex < 0) return false
    if (element.closest('[hidden], [inert]')) return false

    const style = getComputedStyle(element)
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false

    for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
      if (getComputedStyle(ancestor).display === 'none') return false
    }
    return true
  })
}

const onDocumentKeydown = (e: KeyboardEvent) => {

  if (e.key !== 'Tab' || e.defaultPrevented) return
  if (openModalStack[openModalStack.length - 1] !== instanceId) return
  const container = containerRef.value
  if (!container) return
  const focusables = getFocusables()
  if (focusables.length === 0) {
    e.preventDefault()
    container.focus()
    return
  }
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const active = document.activeElement
  let destination: HTMLElement | undefined
  if (!container.contains(active) || active === container) {

    destination = e.shiftKey ? last : first
  } else if (e.shiftKey && active === first) {
    destination = last
  } else if (!e.shiftKey && active === last) {
    destination = first
  }

  if (destination) {
    e.preventDefault()
    destination.focus()
  }
}

onMounted(() => {
  instanceId = ++modalInstanceSeq
  openModalStack.push(instanceId)
  previouslyFocused = document.activeElement as HTMLElement | null
  document.addEventListener('keydown', onDocumentKeydown)

  const focusables = getFocusables()
  ;(focusables[0] ?? containerRef.value)?.focus()
})

onBeforeUnmount(() => {
  const idx = openModalStack.indexOf(instanceId)
  if (idx !== -1) openModalStack.splice(idx, 1)
  document.removeEventListener('keydown', onDocumentKeydown)
  previouslyFocused?.focus?.()
})
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: var(--color-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;

  padding: var(--modal-backdrop-padding, 0);
}

.modal-container {
  width: 100%;
  max-width: 520px;

  max-height: min(90vh, calc(100vh - 2rem));

  max-height: min(90dvh, calc(100dvh - 2rem));
  background: var(--color-bg-primary);
  border-radius: 0.75rem;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}



.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--modal-header-padding, 1rem 1.25rem);
  border-bottom: var(--modal-header-border, 1px dashed var(--color-border-secondary));

  flex-shrink: 0;
}

.modal-body {
  flex: 1;

  min-height: 0;
  overflow-y: auto;
  padding: var(--modal-body-padding, 1rem 1.25rem);
}



.modal-body {
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-secondary) transparent;
}

.modal-body::-webkit-scrollbar {
  width: 6px;
}

.modal-body::-webkit-scrollbar-thumb {
  background: var(--color-border-secondary);
  border-radius: 3px;
}

.modal-body::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-muted);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: var(--modal-footer-padding, 0.75rem 1.25rem);
  border-top: var(--modal-footer-border, 1px solid var(--color-border-primary));
  background: var(--modal-footer-bg, transparent);
  flex-shrink: 0;
}

.close-btn {
  width: 24px;
  height: 24px;
  background: transparent;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-tertiary);
}

.close-btn:hover {
  color: var(--color-text-primary);
}

.close-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
</style>
