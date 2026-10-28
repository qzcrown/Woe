<template>
  <BaseModal @close="onClose">
    <template #title>
      <h3 class="title">{{ createdToken ? t('clients.createdTitle') : t('clients.createTitle') }}</h3>
    </template>
    <form v-if="!createdToken" @submit.prevent="onSubmit" class="form">
      <label class="field">
        <span>{{ t('clients.name') }}</span>
        <input v-model.trim="name" type="text" required :placeholder="t('clients.placeholder.name')" />
      </label>
      <p v-if="error" class="error">{{ error }}</p>
    </form>
    <div v-else class="token-reveal">
      <p class="token-label">{{ t('clients.tokenLabel') }}</p>
      <div class="token-value">
        <code>{{ createdToken }}</code>
        <button type="button" class="btn copy"
          :title="copied ? t('clients.tokenCopied') : t('clients.copyToken')"
          :aria-label="copied ? t('clients.tokenCopied') : t('clients.copyToken')"
          @click="copyCreatedToken">
          <Check v-if="copied" :size="14" aria-hidden="true" />
          <Copy v-else :size="14" aria-hidden="true" />
        </button>
      </div>
      <p class="token-hint">{{ t('clients.tokenHint') }}</p>
    </div>
    <template #footer>
      <template v-if="!createdToken">
        <button class="btn" @click="onClose" :disabled="submitting">{{ t('common.cancel') }}</button>
        <button class="btn primary" @click="onSubmit" :disabled="submitting || !name">{{ submitting ? t('clients.creating') : t('common.create') }}</button>
      </template>
      <button v-else class="btn primary" @click="onClose">{{ t('clients.done') }}</button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Copy } from '@lucide/vue'
import BaseModal from './BaseModal.vue'
import { clientApi } from '@/services/api'
import { authService, clientTokenStorageKey } from '@/services/auth'
import { showError } from '@/utils/errorHandler'
import { useCopyFeedback } from '@/composables/useCopyFeedback'
import { derivePublicForm, isEnhancedTokenForm } from '@/utils/enhancedToken'

const { t } = useI18n()

const emit = defineEmits<{ (e: 'close'): void; (e: 'created'): void }>()

const name = ref('')
const submitting = ref(false)
const error = ref('')


const createdToken = ref('')


let disposed = false

let closeEmitted = false

const ownerSession = authService.getSessionRevision()
const ownerClientToken = authService.getClientCredentialForRevocation()

const { copied, copyText, clearCopyFeedback } = useCopyFeedback({
  isCurrent: () => ensureOwnerSession(),
  errorTitle: () => t('clients.copyTokenError'),
  clearOnError: true,
  onExpiry: () => ensureOwnerSession()
})

const onClose = (): void => {

  disposed = true
  createdToken.value = ''
  name.value = ''
  error.value = ''
  clearCopyFeedback()
  if (closeEmitted) return
  closeEmitted = true
  emit('close')
}


const ensureOwnerSession = (): boolean => {
  if (disposed) return false
  if (ownerSession !== authService.getSessionRevision() ||
      ownerClientToken !== authService.getClientCredentialForRevocation()) {
    onClose()
    return false
  }
  return true
}


const copyCreatedToken = (): void => {
  if (createdToken.value) void copyText(createdToken.value)
}




const unsubscribeSessionChanges = authService.subscribeSessionChanges(onClose)
const onStorageChange = (event: StorageEvent): void => {

  if (event.key === null || event.key === clientTokenStorageKey()) onClose()
}
onMounted(() => window.addEventListener('storage', onStorageChange))

const onSubmit = async (): Promise<void> => {
  if (!ensureOwnerSession() || submitting.value || createdToken.value) return
  error.value = ''
  if (!name.value) {
    error.value = t('clients.nameRequired')
    return
  }
  submitting.value = true
  try {
    const res = await clientApi.createClient({ name: name.value })
    if (!ensureOwnerSession()) return

    emit('created')
    if (!ensureOwnerSession()) return


    const token: unknown = res.data?.token
    if (typeof token !== 'string' || token.trim().length === 0 ||
        (isEnhancedTokenForm(token) && derivePublicForm(token) === null)) {
      showError(new Error('invalid create token response'), t('clients.invalidTokenResponse'))
      onClose()
      return
    }

    createdToken.value = token
  } catch (e: any) {
    if (!ensureOwnerSession()) return
    error.value = e?.errorDescription || t('clients.createError')
  } finally {
    submitting.value = false
  }
}

onBeforeUnmount(() => {
  disposed = true
  createdToken.value = ''
  name.value = ''
  error.value = ''
  clearCopyFeedback()
  unsubscribeSessionChanges()
  window.removeEventListener('storage', onStorageChange)
})
</script>

<style scoped>
.title { margin: 0; font-size: 1.125rem; font-weight: 600; }
.form { display: flex; flex-direction: column; gap: 0.75rem; }
.field { display: flex; flex-direction: column; gap: 0.375rem; }
.field span { color: var(--color-text-primary); font-size: 0.875rem; }
input { border: 1px solid var(--color-border-secondary); border-radius: 0.375rem; padding: 0.5rem; font-size: 0.875rem; }
.error { color: var(--color-error-text); font-size: 0.875rem; }
.btn { padding: 0.5rem 1rem; border: none; border-radius: 0.375rem; cursor: pointer; background: var(--color-bg-active); }
.btn.primary { background: var(--color-success); color: var(--color-text-inverse); }
.btn.primary:hover:not(:disabled) { background: var(--color-success-hover); }
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
