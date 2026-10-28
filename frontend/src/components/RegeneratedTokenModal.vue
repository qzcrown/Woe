<template>
  <BaseModal class="regenerated-token-modal" @close="close">
    <template #title><h3>{{ t('applications.regenerated') }}</h3></template>
    <div class="token-reveal">
      <p>{{ t('createApplication.tokenLabel') }}</p>
      <div class="token-value">
        <code>{{ token }}</code>
        <button type="button" class="btn copy"
          :title="copied ? t('createApplication.tokenCopied') : t('createApplication.copyToken')"
          :aria-label="copied ? t('createApplication.tokenCopied') : t('createApplication.copyToken')"
          @click="copyToken">
          <Check v-if="copied" :size="14" aria-hidden="true" />
          <Copy v-else :size="14" aria-hidden="true" />
        </button>
      </div>
      <p class="token-hint">{{ t('createApplication.tokenHint') }}</p>
    </div>
    <template #footer><button type="button" class="btn done" @click="close">{{ t('createApplication.done') }}</button></template>
  </BaseModal>
</template>

<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Copy } from '@lucide/vue'
import BaseModal from './BaseModal.vue'
import { authService } from '@/services/auth'
import { useCopyFeedback } from '@/composables/useCopyFeedback'

const props = defineProps<{ token: string }>()
const emit = defineEmits<{ (event: 'close'): void }>()
const { t } = useI18n()
const sessionRevision = authService.getSessionRevision()
const clientToken = authService.getClientCredentialForRevocation()
let disposed = false
const { copied, copyText, clearCopyFeedback } = useCopyFeedback({
  isCurrent: (text) => !disposed && text === props.token &&
    sessionRevision === authService.getSessionRevision() &&
    clientToken === authService.getClientCredentialForRevocation(),
  errorTitle: () => t('applications.copyTokenError'),
  clearOnError: true
})

const copyToken = (): void => {
  void copyText(props.token)
}
const close = (): void => {
  disposed = true
  clearCopyFeedback()
  emit('close')
}
onBeforeUnmount(() => {
  disposed = true
  clearCopyFeedback()
})
</script>

<style scoped>
h3 { margin: 0; font-size: 1.125rem; color: var(--color-text-primary); }
p { margin: 0; color: var(--color-text-secondary); font-size: 0.875rem; }
.token-reveal { display: flex; flex-direction: column; gap: 0.75rem; }
.token-value { display: flex; align-items: center; gap: 0.5rem; }
code { flex: 1; min-width: 0; overflow-wrap: anywhere; padding: 0.5rem; border-radius: 0.375rem; background: var(--color-bg-hover); color: var(--color-text-primary); }
.token-hint { color: var(--color-warning); }
.btn { display: inline-flex; align-items: center; justify-content: center; padding: 0.5rem 1rem; border: none; border-radius: 0.375rem; cursor: pointer; background: var(--color-primary); color: var(--color-text-inverse); }
.copy { padding: 0.5rem; }
.btn:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
</style>
