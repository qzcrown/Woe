<template>
  <BaseModal @close="onClose">
    <template #title>
      <h3 class="title">{{ createdToken ? t('createApplication.createdTitle') : t('createApplication.title') }}</h3>
    </template>
    <form v-if="!createdToken" @submit.prevent="onSubmit" class="form">
      <label class="field">
        <span>{{ t('createApplication.name') }}</span>
        <input v-model.trim="name" type="text" required :placeholder="t('createApplication.namePlaceholder')" />
      </label>
      <label class="field">
        <span>{{ t('createApplication.description') }}</span>
        <textarea v-model.trim="description" :placeholder="t('createApplication.descriptionPlaceholder')" />
      </label>
      <label class="field">
        <span>{{ t('createApplication.defaultPriority') }}</span>
        <input v-model.number="defaultPriority" type="number" min="0" max="3" :placeholder="t('createApplication.priorityPlaceholder')" />
      </label>
      <p v-if="error" class="error">{{ error }}</p>
    </form>
    <div v-else class="token-reveal">
      <p class="token-label">{{ t('createApplication.tokenLabel') }}</p>
      <div class="token-value">
        <code>{{ createdToken }}</code>
        <button
          type="button"
          class="btn copy"
          :title="copied ? t('createApplication.tokenCopied') : t('createApplication.copyToken')"
          :aria-label="copied ? t('createApplication.tokenCopied') : t('createApplication.copyToken')"
          @click="copyCreatedToken"
        >
          <Check v-if="copied" :size="14" aria-hidden="true" />
          <Copy v-else :size="14" aria-hidden="true" />
        </button>
      </div>
      <p class="token-hint">{{ t('createApplication.tokenHint') }}</p>
    </div>
    <template #footer>
      <template v-if="!createdToken">
        <button class="btn" @click="onClose" :disabled="submitting">{{ t('createApplication.cancel') }}</button>
        <button class="btn primary" @click="onSubmit" :disabled="submitting || !name">{{ submitting ? t('createApplication.creating') : t('createApplication.create') }}</button>
      </template>
      <button v-else class="btn primary" @click="onClose">{{ t('createApplication.done') }}</button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Copy } from '@lucide/vue'
import BaseModal from './BaseModal.vue'
import { applicationApi } from '@/services/api'
import { authService, clientTokenStorageKey } from '@/services/auth'
import { showError } from '@/utils/errorHandler'
import { useCopyFeedback } from '@/composables/useCopyFeedback'
import { derivePublicForm, isEnhancedTokenForm } from '@/utils/enhancedToken'

const { t } = useI18n()

const emit = defineEmits<{ (e: 'close'): void; (e: 'created'): void }>()

const name = ref('')
const description = ref('')
const defaultPriority = ref<number | undefined>(undefined)
const submitting = ref(false)
const error = ref('')

const createdToken = ref('')


let disposed = false
const { copied, copyText, clearCopyFeedback } = useCopyFeedback({
  isCurrent: () => !disposed,
  errorTitle: () => t('applications.copyTokenError'),
  clearOnError: true
})

const onClose = () => {

  disposed = true
  clearCopyFeedback()
  emit('close')
}


const copyCreatedToken = (): void => {
  if (createdToken.value) void copyText(createdToken.value)
}


const invalidateSession = (): void => {
  createdToken.value = ''
  clearCopyFeedback()
}
const unsubscribeSessionChanges = authService.subscribeSessionChanges(invalidateSession)
const onStorageChange = (event: StorageEvent): void => {

  if (event.key === null || event.key === clientTokenStorageKey()) invalidateSession()
}
onMounted(() => window.addEventListener('storage', onStorageChange))

const onSubmit = async () => {
  if (disposed || submitting.value || createdToken.value) return
  error.value = ''
  if (!name.value) {
    error.value = t('createApplication.nameRequired')
    return
  }
  submitting.value = true

  const capturedSession = authService.getSessionRevision()
  const capturedClientToken = authService.getClientCredentialForRevocation()
  try {
    const res = await applicationApi.createApplication({
      name: name.value,
      description: description.value || undefined,
      defaultPriority: defaultPriority.value,
    })
    const sessionChanged =
      authService.getSessionRevision() !== capturedSession ||
      authService.getClientCredentialForRevocation() !== capturedClientToken
    if (disposed || sessionChanged) return

    emit('created')

    const token: unknown = res.data?.token
    if (typeof token !== 'string' || token.trim().length === 0 || (isEnhancedTokenForm(token) && derivePublicForm(token) === null)) {
      showError(new Error('invalid create token response'), t('createApplication.invalidTokenResponse'))
      onClose()
      return
    }


    let stored = true
    try {
      authService.setAppToken(res.data.id, token)
    } catch (err) {
      console.error('Failed to persist created app token:', err)
      stored = false
    }
    createdToken.value = token
    if (!stored) {
      showError(new Error('app token storage failed'), t('applications.tokenStorageError'))
    }
  } catch (e: any) {
    if (disposed || capturedSession !== authService.getSessionRevision() || capturedClientToken !== authService.getClientCredentialForRevocation()) return
    error.value = e?.errorDescription || t('createApplication.createError')
  } finally {
    submitting.value = false
  }
}

onBeforeUnmount(() => {
  disposed = true
  unsubscribeSessionChanges()
  window.removeEventListener('storage', onStorageChange)
  clearCopyFeedback()
})
</script>

<style scoped>
.title { margin: 0; font-size: 1.125rem; font-weight: 600; color: var(--color-text-primary); }
.form { display: flex; flex-direction: column; gap: 0.75rem; }
.field { display: flex; flex-direction: column; gap: 0.375rem; }
.field span { color: var(--color-text-secondary); font-size: 0.875rem; }
input, textarea {
  border: 1px solid var(--color-border-primary);
  border-radius: 0.375rem;
  padding: 0.5rem;
  font-size: 0.875rem;
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  transition: var(--transition-interactive);
}
input:focus, textarea:focus {
  outline: none;
  border-color: var(--color-border-focus);
}
textarea { min-height: 80px; resize: vertical; }
.error { color: var(--color-error); font-size: 0.875rem; }
.btn {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  background: var(--color-bg-active);
  color: var(--color-text-secondary);
  transition: var(--transition-interactive);
}
.btn.primary { background: var(--color-success); color: var(--color-text-inverse); }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
.token-reveal { display: flex; flex-direction: column; gap: 0.5rem; }
.token-label { margin: 0; color: var(--color-text-secondary); font-size: 0.875rem; }
.token-value { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.token-value code {
  flex: 1;
  min-width: 12rem;
  word-break: break-all;
  background: var(--color-bg-hover);
  padding: 0.5rem;
  border-radius: 0.375rem;
  font-family: 'Courier New', monospace;
  font-size: 0.875rem;
  color: var(--color-text-primary);
}
.btn.copy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem;
  background: var(--color-primary);
  color: var(--color-text-inverse);
}
.btn.copy:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
.token-hint { margin: 0; color: var(--color-warning); font-size: 0.8rem; }
</style>
