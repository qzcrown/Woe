<template>
  <Transition name="alert-dialog">
    <BaseModal
      v-if="visible"
      class="alert-dialog-shell"
      max-width="400px"
      :z-index="2000"
      hide-close
      @close="handleOverlayClick"
    >
      <template #title>
        <div class="alert-dialog-header">
          <div class="icon-wrapper">

            <svg v-if="type === 'success'" class="icon success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="9 12 12 15 16 10"></polyline>
            </svg>

            <svg v-else-if="type === 'error'" class="icon error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="15" y1="9" x2="9" y2="15"></line>
              <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>

            <svg v-else-if="type === 'warning'" class="icon warning" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"></circle>
            </svg>

            <svg v-else class="icon info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
          </div>
          <h3 class="alert-dialog-title">{{ title || defaultTitle }}</h3>
        </div>
      </template>

      <div class="alert-dialog-body">
        <p class="alert-dialog-message">{{ message }}</p>
      </div>

      <template #footer>
        <div class="alert-dialog-footer">
          <button
            @click="handleConfirm"
            class="btn btn-primary"
            :class="[`btn-${type}`]"
          >
            {{ confirmText }}
          </button>
        </div>
      </template>
    </BaseModal>
  </Transition>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from './BaseModal.vue'




type AlertType = 'success' | 'error' | 'warning' | 'info'




interface Props {

  visible: boolean

  title?: string

  message: string

  confirmText?: string

  type?: AlertType

  closeOnOverlayClick?: boolean
}




interface Emits {

  (e: 'confirm'): void
}


const props = withDefaults(defineProps<Props>(), {
  title: '',
  confirmText: '',
  type: 'info',
  closeOnOverlayClick: true
})

const emit = defineEmits<Emits>()
const { t } = useI18n()




const defaultTitle = computed(() => {
  switch (props.type) {
    case 'success':
      return t('common.alert.typeSuccess')
    case 'error':
      return t('common.alert.typeError')
    case 'warning':
      return t('common.alert.typeWarning')
    case 'info':
    default:
      return t('common.alert.typeInfo')
  }
})




const handleConfirm = () => {
  emit('confirm')
}




const handleOverlayClick = () => {
  if (props.closeOnOverlayClick) {
    handleConfirm()
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

.alert-dialog-shell {
  --modal-backdrop-padding: 1rem;
  --modal-header-padding: 0;
  --modal-header-border: none;
  --modal-body-padding: 0;
  --modal-footer-padding: 0;
  --modal-footer-border: none;
  --modal-footer-bg: transparent;
}

.alert-dialog-header {
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

.icon.success {
  color: var(--color-success);
}

.icon.error {
  color: var(--color-error);
}

.icon.warning {
  color: var(--color-warning);
}

.icon.info {
  color: var(--color-info);
}

.alert-dialog-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
  text-align: center;
}

.alert-dialog-body {
  padding: 0 1.5rem 1.5rem;
}

.alert-dialog-message {
  font-size: 0.9375rem;
  color: var(--color-text-secondary);
  line-height: 1.5;
  text-align: center;
  margin: 0;
}

.alert-dialog-footer {
  flex: 1;
  display: flex;
  justify-content: center;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--color-border-primary);
  background-color: var(--color-bg-tertiary);
}

.btn {
  padding: 0.625rem 2rem;
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
  min-width: 100px;
}

.btn-primary {
  color: var(--color-text-inverse);
  background-color: var(--color-primary);
}

.btn-primary:hover {
  background-color: var(--color-primary-hover);
}

.btn-success {
  background-color: var(--color-success);
}

.btn-success:hover {
  background-color: var(--color-success-hover);
}

.btn-error {
  background-color: var(--color-error);
}

.btn-error:hover {
  background-color: var(--color-error-hover);
}

.btn-warning {
  background-color: var(--color-warning);
}

.btn-warning:hover {
  background-color: var(--color-warning-hover);
}


.alert-dialog-enter-active,
.alert-dialog-leave-active {
  transition: opacity 0.2s ease;
}

.alert-dialog-enter-from,
.alert-dialog-leave-to {
  opacity: 0;
}

.alert-dialog-enter-active :deep(.modal-container),
.alert-dialog-leave-active :deep(.modal-container) {
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.alert-dialog-enter-from :deep(.modal-container),
.alert-dialog-leave-to :deep(.modal-container) {
  transform: scale(0.95);
  opacity: 0;
}


@media (max-width: 640px) {
  .btn {
    width: 100%;
  }
}
</style>
