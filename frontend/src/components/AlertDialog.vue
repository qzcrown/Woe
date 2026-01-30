<template>
  <Transition name="alert-dialog">
    <div v-if="visible" class="alert-dialog-overlay" @click="handleOverlayClick">
      <div class="alert-dialog-container" :class="[`type-${type}`]" @click.stop>
        <div class="alert-dialog-header">
          <div class="icon-wrapper">
            <!-- 成功图标 -->
            <svg v-if="type === 'success'" class="icon success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="9 12 12 15 16 10"></polyline>
            </svg>
            <!-- 错误图标 -->
            <svg v-else-if="type === 'error'" class="icon error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="15" y1="9" x2="9" y2="15"></line>
              <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>
            <!-- 警告图标 -->
            <svg v-else-if="type === 'warning'" class="icon warning" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"></circle>
            </svg>
            <!-- 信息图标 -->
            <svg v-else class="icon info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
          </div>
          <h3 class="alert-dialog-title">{{ title || defaultTitle }}</h3>
        </div>

        <div class="alert-dialog-body">
          <p class="alert-dialog-message">{{ message }}</p>
        </div>

        <div class="alert-dialog-footer">
          <button
            @click="handleConfirm"
            class="btn btn-primary"
            :class="[`btn-${type}`]"
          >
            {{ confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'

/**
 * Alert 类型定义
 */
type AlertType = 'success' | 'error' | 'warning' | 'info'

/**
 * 组件 Props 接口
 */
interface Props {
  /** 是否可见 */
  visible: boolean
  /** 标题 */
  title?: string
  /** 消息内容 */
  message: string
  /** 确认按钮文本 */
  confirmText?: string
  /** 提示类型 */
  type?: AlertType
  /** 点击遮罩是否关闭 */
  closeOnOverlayClick?: boolean
}

/**
 * 组件事件接口
 */
interface Emits {
  /** 确认事件 */
  (e: 'confirm'): void
}

// 定义 Props 默认值
const props = withDefaults(defineProps<Props>(), {
  title: '',
  confirmText: '',
  type: 'info',
  closeOnOverlayClick: true
})

const emit = defineEmits<Emits>()
const { t } = useI18n()

/**
 * 根据类型获取默认标题
 */
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

/**
 * 处理确认按钮点击
 */
const handleConfirm = () => {
  emit('confirm')
}

/**
 * 处理遮罩层点击
 */
const handleOverlayClick = () => {
  if (props.closeOnOverlayClick) {
    handleConfirm()
  }
}

/**
 * 监听可见性变化，控制 body 滚动
 */
watch(() => props.visible, (newVal) => {
  if (newVal) {
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = ''
  }
})
</script>

<style scoped>
.alert-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  padding: 1rem;
}

.alert-dialog-container {
  width: 100%;
  max-width: 400px;
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

.alert-dialog-header {
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
  color: #10b981;
}

.icon.error {
  color: #ef4444;
}

.icon.warning {
  color: #f59e0b;
}

.icon.info {
  color: #3b82f6;
}

.alert-dialog-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1f2937;
  margin: 0;
  text-align: center;
}

.alert-dialog-body {
  padding: 0 1.5rem 1.5rem;
}

.alert-dialog-message {
  font-size: 0.9375rem;
  color: #4b5563;
  line-height: 1.5;
  text-align: center;
  margin: 0;
}

.alert-dialog-footer {
  display: flex;
  justify-content: center;
  padding: 1rem 1.5rem;
  border-top: 1px solid #e5e7eb;
  background-color: #f9fafb;
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
  color: white;
  background-color: #3b82f6;
}

.btn-primary:hover {
  background-color: #2563eb;
}

.btn-success {
  background-color: #10b981;
}

.btn-success:hover {
  background-color: #059669;
}

.btn-error {
  background-color: #ef4444;
}

.btn-error:hover {
  background-color: #dc2626;
}

.btn-warning {
  background-color: #f59e0b;
}

.btn-warning:hover {
  background-color: #d97706;
}

/* 过渡动画 */
.alert-dialog-enter-active,
.alert-dialog-leave-active {
  transition: opacity 0.2s ease;
}

.alert-dialog-enter-from,
.alert-dialog-leave-to {
  opacity: 0;
}

.alert-dialog-enter-active .alert-dialog-container,
.alert-dialog-leave-active .alert-dialog-container {
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.alert-dialog-enter-from .alert-dialog-container,
.alert-dialog-leave-to .alert-dialog-container {
  transform: scale(0.95);
  opacity: 0;
}

/* 响应式设计 */
@media (max-width: 640px) {
  .alert-dialog-container {
    max-width: 100%;
    margin: 1rem;
  }

  .btn {
    width: 100%;
  }
}
</style>
