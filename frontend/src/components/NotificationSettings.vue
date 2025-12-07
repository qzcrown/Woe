<template>
  <div class="notification-settings">
    <div class="settings-header">
      <h2 class="settings-title">{{ $t('notificationSettings.title') }}</h2>
      <p class="settings-description">{{ $t('notificationSettings.description') }}</p>
    </div>

    <div v-if="!isSupported" class="not-supported">
      <div class="alert alert-warning">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
          <line x1="12" y1="9" x2="12" y2="13"></line>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
        <span>{{ $t('notificationSettings.notSupported') }}</span>
      </div>
    </div>

    <div v-else class="settings-content">
      <!-- Permission Status -->
      <div class="setting-group">
        <div class="setting-item">
          <div class="setting-info">
            <h3 class="setting-label">{{ $t('notificationSettings.permission') }}</h3>
            <p class="setting-description">{{ getPermissionDescription() }}</p>
          </div>
          <div class="setting-control">
            <div v-if="permission === 'default'" class="permission-status pending">
              {{ $t('notificationSettings.permissionNotRequested') }}
            </div>
            <div v-else-if="permission === 'granted'" class="permission-status granted">
              {{ $t('notificationSettings.permissionGranted') }}
            </div>
            <div v-else class="permission-status denied">
              {{ $t('notificationSettings.permissionDenied') }}
            </div>
          </div>
        </div>

        <div v-if="permission === 'default'" class="setting-item">
          <div class="setting-info">
            <h3 class="setting-label">{{ $t('notificationSettings.requestPermission') }}</h3>
            <p class="setting-description">{{ $t('notificationSettings.requestPermissionDescription') }}</p>
          </div>
          <div class="setting-control">
            <button 
              @click="requestPermission" 
              :disabled="requestingPermission"
              class="btn btn-primary"
            >
              <LoadingSpinner v-if="requestingPermission" size="small" variant="dots" />
              <span v-else>{{ $t('notificationSettings.enableNotifications') }}</span>
            </button>
          </div>
        </div>

        <div v-else-if="permission === 'denied'" class="setting-item">
          <div class="setting-info">
            <h3 class="setting-label">{{ $t('notificationSettings.enableInBrowser') }}</h3>
            <p class="setting-description">{{ $t('notificationSettings.enableInBrowserDescription') }}</p>
          </div>
        </div>
      </div>

      <!-- Notification Settings -->
      <div v-if="permission === 'granted'" class="setting-group">
        <h3 class="group-title">{{ $t('notificationSettings.settings') }}</h3>
        
        <div class="setting-item">
          <div class="setting-info">
            <h3 class="setting-label">{{ $t('notificationSettings.enableNotifications') }}</h3>
            <p class="setting-description">{{ $t('notificationSettings.enableNotificationsDescription') }}</p>
          </div>
          <div class="setting-control">
            <label class="toggle-switch">
              <input 
                type="checkbox" 
                v-model="localSettings.enabled"
                @change="updateSettings"
              />
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>

        <div class="setting-item">
          <div class="setting-info">
            <h3 class="setting-label">{{ $t('notificationSettings.sound') }}</h3>
            <p class="setting-description">{{ $t('notificationSettings.soundDescription') }}</p>
          </div>
          <div class="setting-control">
            <label class="toggle-switch">
              <input 
                type="checkbox" 
                v-model="localSettings.sound"
                @change="updateSettings"
                :disabled="!localSettings.enabled"
              />
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>

        <div class="setting-item">
          <div class="setting-info">
            <h3 class="setting-label">{{ $t('notificationSettings.requireInteraction') }}</h3>
            <p class="setting-description">{{ $t('notificationSettings.requireInteractionDescription') }}</p>
          </div>
          <div class="setting-control">
            <label class="toggle-switch">
              <input 
                type="checkbox" 
                v-model="localSettings.requireInteraction"
                @change="updateSettings"
                :disabled="!localSettings.enabled"
              />
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>

        <div class="setting-item">
          <div class="setting-info">
            <h3 class="setting-label">{{ $t('notificationSettings.showOnlyWhenPageHidden') }}</h3>
            <p class="setting-description">{{ $t('notificationSettings.showOnlyWhenPageHiddenDescription') }}</p>
          </div>
          <div class="setting-control">
            <label class="toggle-switch">
              <input 
                type="checkbox" 
                v-model="localSettings.showOnlyWhenPageHidden"
                @change="updateSettings"
                :disabled="!localSettings.enabled"
              />
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>

        <div class="setting-item">
          <div class="setting-info">
            <h3 class="setting-label">{{ $t('notificationSettings.priority') }}</h3>
            <p class="setting-description">{{ $t('notificationSettings.priorityDescription') }}</p>
          </div>
          <div class="setting-control">
            <select 
              v-model="localSettings.priority"
              @change="updateSettings"
              :disabled="!localSettings.enabled"
              class="select-input"
            >
              <option value="all">{{ $t('notificationSettings.priorityAll') }}</option>
              <option value="high">{{ $t('notificationSettings.priorityHigh') }}</option>
              <option value="emergency">{{ $t('notificationSettings.priorityEmergency') }}</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Test Notification -->
      <div v-if="permission === 'granted' && localSettings.enabled" class="setting-group">
        <h3 class="group-title">{{ $t('notificationSettings.test') }}</h3>
        
        <div class="setting-item">
          <div class="setting-info">
            <h3 class="setting-label">{{ $t('notificationSettings.testNotification') }}</h3>
            <p class="setting-description">{{ $t('notificationSettings.testNotificationDescription') }}</p>
          </div>
          <div class="setting-control">
            <button 
              @click="sendTestNotification"
              :disabled="sendingTest"
              class="btn btn-secondary"
            >
              <LoadingSpinner v-if="sendingTest" size="small" variant="dots" />
              <span v-else>{{ $t('notificationSettings.sendTest') }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import LoadingSpinner from '@/components/LoadingSpinner.vue'
import { browserNotificationService, type NotificationSettings } from '@/services/browserNotification'
import { errorHandler, showError } from '@/utils/errorHandler'

const { t } = useI18n()

const isSupported = computed(() => browserNotificationService.isNotificationSupported())
const permission = computed(() => browserNotificationService.getPermission())
const requestingPermission = ref(false)
const sendingTest = ref(false)

const localSettings = ref<NotificationSettings>({
  enabled: true,
  sound: true,
  requireInteraction: false,
  showOnlyWhenPageHidden: false,
  priority: 'all'
})

const getPermissionDescription = () => {
  switch (permission.value) {
    case 'default':
      return t('notificationSettings.permissionDefault')
    case 'granted':
      return t('notificationSettings.permissionGrantedDescription')
    case 'denied':
      return t('notificationSettings.permissionDeniedDescription')
    default:
      return ''
  }
}

const requestPermission = async () => {
  requestingPermission.value = true
  try {
    await browserNotificationService.requestPermission()
  } catch (error) {
    console.error('Failed to request notification permission:', error)
  } finally {
    requestingPermission.value = false
  }
}

const updateSettings = () => {
  browserNotificationService.updateSettings(localSettings.value)
}

const sendTestNotification = async () => {
  sendingTest.value = true
  try {
    const success = browserNotificationService.showNotification({
      title: t('notificationSettings.testTitle'),
      body: t('notificationSettings.testBody'),
      tag: 'test-notification',
      forceShow: true
    })
    
    if (success) {
      // 显示成功提示
      errorHandler.showSuccess(t('notificationSettings.testSuccess'))
    } else {
      // 显示失败提示
      errorHandler.showWarning(t('notificationSettings.testFailed'))
    }
  } catch (error) {
    console.error('Failed to send test notification:', error)
    showError(error as Error)
  } finally {
    sendingTest.value = false
  }
}

onMounted(() => {
  localSettings.value = browserNotificationService.getSettings()
})
</script>

<style scoped>
.notification-settings {
  max-width: 600px;
  margin: 0 auto;
  padding: 1.5rem;
}

.settings-header {
  margin-bottom: 2rem;
  text-align: center;
}

.settings-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 0.5rem;
}

.settings-description {
  color: #6b7280;
  font-size: 0.875rem;
  line-height: 1.5;
}

.not-supported {
  margin-top: 1rem;
}

.alert {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  border-radius: 0.5rem;
  font-size: 0.875rem;
}

.alert-warning {
  background-color: #fef3c7;
  color: #92400e;
  border: 1px solid #fde68a;
}

.settings-content {
  space-y: 1.5rem;
}

.setting-group {
  margin-bottom: 2rem;
}

.group-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #e5e7eb;
}

.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 1rem 0;
  border-bottom: 1px solid #f3f4f6;
}

.setting-item:last-child {
  border-bottom: none;
}

.setting-info {
  flex: 1;
  margin-right: 1rem;
}

.setting-label {
  font-size: 1rem;
  font-weight: 500;
  color: #1f2937;
  margin-bottom: 0.25rem;
}

.setting-description {
  font-size: 0.875rem;
  color: #6b7280;
  line-height: 1.4;
}

.setting-control {
  flex-shrink: 0;
}

.permission-status {
  padding: 0.25rem 0.75rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
  text-transform: uppercase;
}

.permission-status.pending {
  background-color: #fef3c7;
  color: #92400e;
}

.permission-status.granted {
  background-color: #d1fae5;
  color: #065f46;
}

.permission-status.denied {
  background-color: #fee2e2;
  color: #991b1b;
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 48px;
  height: 24px;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #d1d5db;
  transition: 0.3s;
  border-radius: 24px;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: 0.3s;
  border-radius: 50%;
}

input:checked + .toggle-slider {
  background-color: #3b82f6;
}

input:checked + .toggle-slider:before {
  transform: translateX(24px);
}

input:disabled + .toggle-slider {
  background-color: #e5e7eb;
  cursor: not-allowed;
}

.select-input {
  padding: 0.5rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  background-color: white;
  font-size: 0.875rem;
  color: #1f2937;
  min-width: 120px;
}

.select-input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.select-input:disabled {
  background-color: #f9fafb;
  color: #6b7280;
  cursor: not-allowed;
}

.btn {
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.btn-primary {
  background-color: #3b82f6;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background-color: #2563eb;
}

.btn-secondary {
  background-color: #f3f4f6;
  color: #374151;
  border: 1px solid #d1d5db;
}

.btn-secondary:hover:not(:disabled) {
  background-color: #e5e7eb;
}

.btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

@media (max-width: 640px) {
  .notification-settings {
    padding: 1rem;
  }
  
  .setting-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }
  
  .setting-info {
    margin-right: 0;
  }
  
  .setting-control {
    align-self: flex-end;
  }
}
</style>