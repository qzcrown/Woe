<template>
  <teleport to="body">
    <div class="notification-container">
      <transition-group name="notification" tag="div">
        <div
          v-for="notification in notifications"
          :key="notification.id"
          :class="[
            'notification',
            `notification-${notification.type}`,
            { 'notification-persistent': notification.persistent }
          ]"
        >
          <div class="notification-icon">
            <svg v-if="notification.type === 'success'" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
            <svg v-else-if="notification.type === 'error'" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="15" y1="9" x2="9" y2="15"></line>
              <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>
            <svg v-else-if="notification.type === 'warning'" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            <svg v-else width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
          </div>
          
          <div class="notification-content">
            <div class="notification-title">{{ notification.title }}</div>
            <div v-if="notification.message" class="notification-message">{{ notification.message }}</div>
          </div>
          
          <button 
            v-if="!notification.persistent" 
            @click="removeNotification(notification.id)"
            class="notification-close"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
          
          <div v-if="notification.actions && notification.actions.length" class="notification-actions">
            <button
              v-for="action in notification.actions"
              :key="action.label"
              @click="action.action"
              :class="['notification-action', { 'notification-action-primary': action.primary }]"
            >
              {{ action.label }}
            </button>
          </div>
        </div>
      </transition-group>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { NotificationItem, errorHandler } from '@/utils/errorHandler'

const notifications = ref<NotificationItem[]>([])

const removeNotification = (id: string) => {
  const index = notifications.value.findIndex(n => n.id === id)
  if (index !== -1) {
    notifications.value.splice(index, 1)
  }
}

const addNotification = (notification: NotificationItem) => {
  notifications.value.push(notification)
  
  // 如果不是持久通知，设置自动移除
  if (!notification.persistent && notification.duration && notification.duration > 0) {
    setTimeout(() => {
      removeNotification(notification.id)
    }, notification.duration)
  }
}

onMounted(() => {
  // 注册通知回调
  errorHandler.registerNotificationCallback(addNotification)
})

onUnmounted(() => {
  // 清理所有通知
  notifications.value = []
})
</script>

<style scoped>
.notification-container {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 400px;
  pointer-events: none;
}

.notification {
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 16px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  pointer-events: auto;
  overflow: hidden;
  position: relative;
}

.notification::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
}

.notification-success::before {
  background-color: #10b981;
}

.notification-error::before {
  background-color: #ef4444;
}

.notification-warning::before {
  background-color: #f59e0b;
}

.notification-info::before {
  background-color: #3b82f6;
}

.notification-icon {
  flex-shrink: 0;
  margin-top: 2px;
}

.notification-success .notification-icon {
  color: #10b981;
}

.notification-error .notification-icon {
  color: #ef4444;
}

.notification-warning .notification-icon {
  color: #f59e0b;
}

.notification-info .notification-icon {
  color: #3b82f6;
}

.notification-content {
  flex: 1;
  min-width: 0;
}

.notification-title {
  font-weight: 600;
  font-size: 14px;
  line-height: 20px;
  color: #1f2937;
  margin-bottom: 4px;
}

.notification-message {
  font-size: 14px;
  line-height: 20px;
  color: #6b7280;
  word-break: break-word;
}

.notification-close {
  flex-shrink: 0;
  background: none;
  border: none;
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;
  color: #9ca3af;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.notification-close:hover {
  background-color: #f3f4f6;
  color: #6b7280;
}

.notification-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  width: 100%;
}

.notification-action {
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid #d1d5db;
  background-color: white;
  color: #374151;
  transition: all 0.2s;
}

.notification-action:hover {
  background-color: #f9fafb;
}

.notification-action-primary {
  background-color: #3b82f6;
  border-color: #3b82f6;
  color: white;
}

.notification-action-primary:hover {
  background-color: #2563eb;
}

/* 动画效果 */
.notification-enter-active,
.notification-leave-active {
  transition: all 0.3s ease;
}

.notification-enter-from {
  opacity: 0;
  transform: translateX(100%);
}

.notification-leave-to {
  opacity: 0;
  transform: translateX(100%);
}

.notification-move {
  transition: transform 0.3s ease;
}

/* 响应式设计 */
@media (max-width: 640px) {
  .notification-container {
    top: 10px;
    right: 10px;
    left: 10px;
    max-width: none;
  }
  
  .notification {
    padding: 12px;
  }
  
  .notification-actions {
    flex-direction: column;
  }
}
</style>
