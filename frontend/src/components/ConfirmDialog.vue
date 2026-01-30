<template>
  <Transition name="confirm-dialog">
    <div v-if="visible" class="confirm-dialog-overlay" @click="handleOverlayClick">
      <div class="confirm-dialog-container" :class="[`type-${type}`]" @click.stop>
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
        
        <div class="confirm-dialog-body">
          <p class="confirm-dialog-message">{{ message }}</p>
        </div>
        
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
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { watch } from 'vue'
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
.confirm-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  padding: 1rem;
}

.confirm-dialog-container {
  width: 100%;
  max-width: 420px;
  background: white;
  border-radius: 0.75rem;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
  overflow: hidden;
  animation: dialogSlideIn 0.2s ease-out;
}

@keyframes dialogSlideIn {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(-10px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.confirm-dialog-header {
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
  color: #f59e0b;
}

.icon.danger {
  color: #ef4444;
}

.icon.info {
  color: #3b82f6;
}

.confirm-dialog-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1f2937;
  margin: 0;
  text-align: center;
}

.confirm-dialog-body {
  padding: 0 1.5rem 1.5rem;
}

.confirm-dialog-message {
  font-size: 0.9375rem;
  color: #4b5563;
  line-height: 1.5;
  text-align: center;
  margin: 0;
}

.confirm-dialog-footer {
  display: flex;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid #e5e7eb;
  background-color: #f9fafb;
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
  background-color: white;
  color: #374151;
  border: 1px solid #d1d5db;
}

.btn-secondary:hover:not(:disabled) {
  background-color: #f3f4f6;
  border-color: #9ca3af;
}

.btn-primary {
  color: white;
  background-color: #3b82f6;
}

.btn-primary:hover:not(:disabled) {
  background-color: #2563eb;
}

.btn-primary.btn-warning {
  background-color: #f59e0b;
}

.btn-primary.btn-warning:hover:not(:disabled) {
  background-color: #d97706;
}

.btn-primary.btn-danger {
  background-color: #ef4444;
}

.btn-primary.btn-danger:hover:not(:disabled) {
  background-color: #dc2626;
}

.confirm-dialog-enter-active,
.confirm-dialog-leave-active {
  transition: opacity 0.2s ease;
}

.confirm-dialog-enter-from,
.confirm-dialog-leave-to {
  opacity: 0;
}

.confirm-dialog-enter-active .confirm-dialog-container,
.confirm-dialog-leave-active .confirm-dialog-container {
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.confirm-dialog-enter-from .confirm-dialog-container,
.confirm-dialog-leave-to .confirm-dialog-container {
  transform: scale(0.95);
  opacity: 0;
}

@media (max-width: 640px) {
  .confirm-dialog-container {
    max-width: 100%;
    margin: 1rem;
  }
  
  .confirm-dialog-footer {
    flex-direction: column;
  }
  
  .btn {
    width: 100%;
  }
}
</style>
