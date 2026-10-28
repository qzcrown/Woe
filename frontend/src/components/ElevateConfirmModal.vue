<template>
  <Transition name="elevate-modal">
    <BaseModal
      v-if="visible"
      class="elevate-modal-shell"
      max-width="420px"
      :z-index="2000"
      hide-close
      @close="handleOverlayClick"
    >
      <template #title>
        <div class="elevate-modal-header">
          <div class="icon-wrapper">
            <svg v-if="mode === 'password'" class="icon lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
            <svg v-else class="icon warning" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"></circle>
            </svg>
          </div>
          <h3 v-if="mode === 'password'" class="elevate-modal-title">{{ t('elevate.title') }}</h3>
        </div>
      </template>

      <div class="elevate-modal-body">
        <p v-if="mode === 'password'" class="elevate-modal-message">{{ t('elevate.message') }}</p>
        <p v-else class="elevate-modal-message">{{ t(messageKey) }}</p>

        <template v-if="mode === 'password'">
          <label class="elevate-modal-label" for="elevate-password-input">
            {{ t('elevate.passwordLabel') }}
          </label>
          <input
            id="elevate-password-input"
            ref="passwordInput"
            v-model="password"
            type="password"
            class="elevate-modal-input"
            :class="{ 'has-error': !!error }"
            autocomplete="current-password"
            :disabled="loading"
            @keyup.enter="handleSubmit"
          />
          <p v-if="error" class="elevate-modal-error" role="alert">
            {{ error === 'wrongPassword' ? t('elevate.wrongPassword') : t('elevate.requestFailed') }}
          </p>
        </template>
      </div>

      <template #footer>
        <div class="elevate-modal-footer">
          <button
            type="button"
            class="btn btn-secondary"
            :disabled="loading"
            @click="handleCancel"
          >
            {{ t('elevate.cancel') }}
          </button>
          <button
            v-if="mode === 'password'"
            type="button"
            class="btn btn-primary"
            :disabled="loading || password.length === 0"
            @click="handleSubmit"
          >
            <LoadingSpinner v-if="loading" size="small" variant="dots" />
            <span v-else>{{ t('elevate.confirm') }}</span>
          </button>
        </div>
      </template>
    </BaseModal>
  </Transition>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from './BaseModal.vue'
import LoadingSpinner from './LoadingSpinner.vue'
import type { ElevationMessageKey, ElevationModalError } from '@/composables/useElevatedAction'

interface Props {
  visible: boolean

  flowId?: number

  mode?: 'password' | 'message'
  loading?: boolean
  error?: ElevationModalError | null

  messageKey?: ElevationMessageKey
  closeOnOverlayClick?: boolean
}

interface Emits {
  (e: 'confirm', password: string): void
  (e: 'cancel'): void
}

const props = withDefaults(defineProps<Props>(), {
  flowId: 0,
  mode: 'password',
  loading: false,
  error: null,
  messageKey: 'elevate.relogin',
  closeOnOverlayClick: true
})

const emit = defineEmits<Emits>()

const { t } = useI18n()

const password = ref('')
const passwordInput = ref<HTMLInputElement | null>(null)




watch(
  [() => props.visible && props.mode === 'password', () => props.flowId],
  ([passwordSessionActive]) => {
    if (passwordSessionActive) {
      password.value = ''
      nextTick(() => passwordInput.value?.focus())
    }
  }
)


watch(
  () => props.visible,
  (visible) => {
    document.body.style.overflow = visible ? 'hidden' : ''
  }
)




watch(
  [() => props.error, () => props.loading],
  ([error, loading]) => {
    if (error && !loading && props.visible && props.mode === 'password') {
      nextTick(() => {
        passwordInput.value?.focus()
        passwordInput.value?.select()
      })
    }
  }
)

const handleSubmit = () => {
  if (props.loading || props.mode !== 'password' || password.value.length === 0) return
  emit('confirm', password.value)
}

const handleCancel = () => {
  if (props.loading) return
  emit('cancel')
}


const handleOverlayClick = () => {
  if (props.closeOnOverlayClick && !props.loading) {
    handleCancel()
  }
}
</script>

<style scoped>

.elevate-modal-shell {
  --modal-backdrop-padding: 1rem;
  --modal-header-padding: 0;
  --modal-header-border: none;
  --modal-body-padding: 0;
  --modal-footer-padding: 0;
  --modal-footer-border: none;
  --modal-footer-bg: transparent;
}

.elevate-modal-header {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1.5rem 1.5rem 1rem;
}

.icon-wrapper {
  margin-bottom: 0.75rem;
}

.icon {
  width: 48px;
  height: 48px;
}

.icon.lock {
  color: var(--color-info);
}

.icon.warning {
  color: var(--color-warning);
}

.elevate-modal-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
  text-align: center;
}

.elevate-modal-body {
  padding: 0 1.5rem 1.5rem;
}

.elevate-modal-message {
  font-size: 0.9375rem;
  color: var(--color-text-secondary);
  line-height: 1.5;
  text-align: center;
  margin: 0 0 1rem;
}

.elevate-modal-label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-primary);
  margin-bottom: 0.375rem;
}

.elevate-modal-input {
  width: 100%;
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--color-border-secondary);
  border-radius: 0.375rem;
  font-size: 0.9375rem;
  color: var(--color-text-primary);
  background-color: var(--color-bg-primary);
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.elevate-modal-input:focus {
  outline: none;
  border-color: var(--color-border-focus);
}

.elevate-modal-input.has-error {
  border-color: var(--color-error);
}

.elevate-modal-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.elevate-modal-error {
  margin: 0.5rem 0 0;
  font-size: 0.8125rem;
  color: var(--color-error);
  text-align: center;
}

.elevate-modal-footer {
  flex: 1;
  display: flex;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--color-border-primary);
  background-color: var(--color-bg-tertiary);
}

.btn {
  flex: 1;
  padding: 0.625rem 1rem;
  border: none;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: var(--transition-interactive);
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-secondary {
  background-color: var(--color-bg-primary);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border-secondary);
}

.btn-secondary:hover:not(:disabled) {
  background-color: var(--color-bg-hover);
  border-color: var(--color-border-primary);
}

.btn-primary {
  color: var(--color-text-inverse);
  background-color: var(--color-primary);
}

.btn-primary:hover:not(:disabled) {
  background-color: var(--color-primary-hover);
}


.elevate-modal-enter-active,
.elevate-modal-leave-active {
  transition: opacity 0.2s ease;
}

.elevate-modal-enter-from,
.elevate-modal-leave-to {
  opacity: 0;
}

.elevate-modal-enter-active :deep(.modal-container),
.elevate-modal-leave-active :deep(.modal-container) {
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.elevate-modal-enter-from :deep(.modal-container),
.elevate-modal-leave-to :deep(.modal-container) {
  transform: scale(0.95);
  opacity: 0;
}

@media (max-width: 640px) {
  .elevate-modal-footer {
    flex-direction: column;
  }

  .btn {
    width: 100%;
  }
}
</style>
