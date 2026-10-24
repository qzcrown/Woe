<template>
  <Transition name="confirm-dialog">
    <BaseModal
      v-if="visible"
      class="confirm-dialog-shell"
      max-width="420px"
      :z-index="2000"
      hide-close
      @close="handleOverlayClick"
    >
      <template #title>
        <div class="confirm-dialog-header">
          <div class="icon-wrapper">
            <svg v-if="type === 'warning'" class="icon warning" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"></circle>
            </svg>
            <svg v-else-if="type === 'danger'" class="icon danger" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="15" y1="9" x2="9" y2="15"></line>
              <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>
            <svg v-else class="icon info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
          </div>
          <h3 class="confirm-dialog-title">{{ title }}</h3>
        </div>
      </template>

      <div class="confirm-dialog-body">
        <p class="confirm-dialog-message">{{ message }}</p>
      </div>

      <template #footer>
        <div class="confirm-dialog-footer">
          <button
            @click="handleCancel"
            class="btn btn-secondary"
            :disabled="loading"
          >
            {{ cancelText }}
          </button>
          <button
            @click="handleConfirm"
            class="btn btn-primary"
            :class="[`btn-${type}`]"
            :disabled="loading"
          >
            <LoadingSpinner v-if="loading" size="small" variant="dots" />
            <span v-else>{{ confirmText }}</span>
          </button>
        </div>
      </template>
    </BaseModal>
  </Transition>
</template>

<script setup lang="ts">
import { watch } from 'vue'
import BaseModal from './BaseModal.vue'
import LoadingSpinner from './LoadingSpinner.vue'

interface Props {
  visible: boolean
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  type?: 'info' | 'warning' | 'danger'
  loading?: boolean
  closeOnOverlayClick?: boolean
}

interface Emits {
  (e: 'confirm'): void
  (e: 'cancel'): void
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  confirmText: '确认',
  cancelText: '取消',
  type: 'info',
  loading: false,
  closeOnOverlayClick: true
})

const emit = defineEmits<Emits>()

const handleConfirm = () => {
  emit('confirm')
}

const handleCancel = () => {
  emit('cancel')
}


const handleOverlayClick = () => {
  if (props.closeOnOverlayClick && !props.loading) {
    handleCancel()
  }
}

watch(() => props.visible, (newVal) => {
  if (newVal) {
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = ''
  }
})
</script>

<style scoped>

.confirm-dialog-shell {
  --modal-backdrop-padding: 1rem;
  --modal-header-padding: 0;
  --modal-header-border: none;
  --modal-body-padding: 0;
  --modal-footer-padding: 0;
  --modal-footer-border: none;
  --modal-footer-bg: transparent;
}

.confirm-dialog-header {
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

.icon.warning {
  color: var(--color-warning);
}

.icon.danger {
  color: var(--color-error);
}

.icon.info {
  color: var(--color-info);
}

.confirm-dialog-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
  text-align: center;
}

.confirm-dialog-body {
  padding: 0 1.5rem 1.5rem;
}

.confirm-dialog-message {
  font-size: 0.9375rem;
  color: var(--color-text-secondary);
  line-height: 1.5;
  text-align: center;
  margin: 0;
}

.confirm-dialog-footer {
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
  transition: all 0.2s;
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

.btn-primary.btn-warning {
  background-color: var(--color-warning);
}

.btn-primary.btn-warning:hover:not(:disabled) {
  background-color: var(--color-warning-hover);
}

.btn-primary.btn-danger {
  background-color: var(--color-error);
}

.btn-primary.btn-danger:hover:not(:disabled) {
  background-color: var(--color-error-hover);
}


.confirm-dialog-enter-active,
.confirm-dialog-leave-active {
  transition: opacity 0.2s ease;
}

.confirm-dialog-enter-from,
.confirm-dialog-leave-to {
  opacity: 0;
}

.confirm-dialog-enter-active :deep(.modal-container),
.confirm-dialog-leave-active :deep(.modal-container) {
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.confirm-dialog-enter-from :deep(.modal-container),
.confirm-dialog-leave-to :deep(.modal-container) {
  transform: scale(0.95);
  opacity: 0;
}

@media (max-width: 640px) {
  .confirm-dialog-footer {
    flex-direction: column;
  }

  .btn {
    width: 100%;
  }
}
</style>
