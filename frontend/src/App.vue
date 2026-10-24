<template>
  <div id="app">
    <router-view />

    <ConnectionStatus
      v-if="authStore.isAuthenticated"
      :connected="wsConnected"
      :connecting="wsConnecting"
      :last-connected="wsLastConnected"
      @reconnect="wsService.reconnect()"
    />
    <Notification />
    <ConfirmDialog
      :visible="confirmState.visible"
      :title="confirmState.options.title"
      :message="confirmState.options.message"
      :confirm-text="confirmState.options.confirmText"
      :cancel-text="confirmState.options.cancelText"
      :type="confirmState.options.type"
      :loading="confirmState.loading"
      :close-on-overlay-click="confirmState.options.closeOnOverlayClick"
      @confirm="handleConfirm"
      @cancel="handleCancel"
    />
    <AlertDialog
      :visible="alertState.visible"
      :title="alertState.options.title"
      :message="alertState.options.message"
      :confirm-text="alertState.options.confirmText"
      :type="alertState.options.type"
      :close-on-overlay-click="alertState.options.closeOnOverlayClick"
      @confirm="handleAlertConfirm"
    />
    <ElevateConfirmModal
      :visible="elevationModalOpen"
      :flow-id="elevationModalFlowId"
      :mode="elevationModalMode"
      :loading="elevationModalLoading"
      :error="elevationModalError"
      :message-key="elevationModalMessageKey"
      @confirm="handleElevateConfirm"
      @cancel="handleElevateCancel"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useMessagesStore } from '@/stores/messages'
import { useThemeStore } from '@/stores/theme'
import { browserNotificationService } from '@/services/browserNotification'
import { wsService, type WsConnectionState } from '@/services/websocket'
import Notification from '@/components/Notification.vue'
import ConnectionStatus from '@/components/ConnectionStatus.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import AlertDialog from '@/components/AlertDialog.vue'
import ElevateConfirmModal from '@/components/ElevateConfirmModal.vue'
import { useConfirmDialogProvider } from '@/composables/useConfirmDialog'
import { useAlertProvider } from '@/composables/useAlert'
import { useElevatedAction } from '@/composables/useElevatedAction'

const authStore = useAuthStore()
const messagesStore = useMessagesStore()
const themeStore = useThemeStore()


const wsConnected = ref(false)
const wsConnecting = ref(false)
const wsLastConnected = ref<string | undefined>(undefined)

const handleWsStateChange = (state: WsConnectionState) => {
  wsConnected.value = state === 'connected'
  wsConnecting.value = state === 'connecting'
  wsLastConnected.value = wsService.getLastConnected() ?? undefined
}

const { state: confirmState, handleConfirm, handleCancel } = useConfirmDialogProvider()
const { state: alertState, handleConfirm: handleAlertConfirm } = useAlertProvider()
const {
  isElevationModalOpen: elevationModalOpen,
  elevationModalFlowId,
  elevationModalMode,
  elevationModalLoading,
  elevationModalError,
  elevationModalMessageKey,
  handleElevationConfirm: handleElevateConfirm,
  handleElevationCancel: handleElevateCancel
} = useElevatedAction()

onMounted(async () => {

  themeStore.initTheme()


  wsService.onStateChange(handleWsStateChange)


  await authStore.checkAuth()


  if (browserNotificationService.isNotificationSupported()) {

    if (browserNotificationService.getPermission() === 'default') {


    }
  }


  if (authStore.isAuthenticated && authStore.token) {
    messagesStore.connectWebSocket(authStore.token)
  }
})

onUnmounted(() => {
  wsService.offStateChange(handleWsStateChange)


  messagesStore.disconnectWebSocket()


  browserNotificationService.destroy()
})
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}


:root {

  --color-bg-primary: #ffffff;
  --color-bg-secondary: #f5f5f5;
  --color-bg-tertiary: #f9fafb;
  --color-bg-hover: #f3f4f6;
  --color-bg-active: #e5e7eb;


  --color-text-primary: #1f2937;
  --color-text-secondary: #4b5563;
  --color-text-tertiary: #6b7280;
  --color-text-muted: #9ca3af;
  --color-text-inverse: #ffffff;


  --color-border-primary: #e5e7eb;
  --color-border-secondary: #d1d5db;
  --color-border-tertiary: #9ca3af;
  --color-border-focus: #3b82f6;


  --color-primary: #3b82f6;
  --color-primary-hover: #2563eb;
  --color-primary-light: rgba(59, 130, 246, 0.1);


  --color-success: #10b981;
  --color-success-hover: #059669;
  --color-success-bg: #d1fae5;
  --color-error: #ef4444;
  --color-error-hover: #dc2626;
  --color-error-bg: #fef2f2;
  --color-warning: #f59e0b;
  --color-warning-hover: #d97706;
  --color-warning-bg: #fef3c7;
  --color-info: #3b82f6;
  --color-info-bg: #dbeafe;


  --color-priority-low-bg: #dbeafe;
  --color-priority-low-text: #1e40af;
  --color-priority-normal-bg: #f3f4f6;
  --color-priority-normal-text: #374151;
  --color-priority-high-bg: #fef3c7;
  --color-priority-high-text: #92400e;
  --color-priority-emergency-bg: #fecaca;
  --color-priority-emergency-text: #991b1b;


  --shadow-sm: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.15);
  --shadow-lg: 0 10px 25px rgba(0, 0, 0, 0.15);


  --color-overlay: rgba(0, 0, 0, 0.5);


  --theme-transition: background-color 0.3s ease, color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
}


:root[data-theme="dark"] {

  --color-bg-primary: #1f2937;
  --color-bg-secondary: #111827;
  --color-bg-tertiary: #374151;
  --color-bg-hover: #374151;
  --color-bg-active: #4b5563;


  --color-text-primary: #f9fafb;
  --color-text-secondary: #e5e7eb;
  --color-text-tertiary: #d1d5db;
  --color-text-muted: #9ca3af;
  --color-text-inverse: #1f2937;


  --color-border-primary: #374151;
  --color-border-secondary: #4b5563;
  --color-border-tertiary: #6b7280;
  --color-border-focus: #60a5fa;


  --color-primary: #60a5fa;
  --color-primary-hover: #3b82f6;
  --color-primary-light: rgba(96, 165, 250, 0.15);


  --color-success: #10b981;
  --color-success-hover: #059669;
  --color-success-bg: rgba(16, 185, 129, 0.2);
  --color-error: #ef4444;
  --color-error-hover: #dc2626;
  --color-error-bg: rgba(239, 68, 68, 0.2);
  --color-warning: #f59e0b;
  --color-warning-hover: #d97706;
  --color-warning-bg: rgba(245, 158, 11, 0.2);
  --color-info: #60a5fa;
  --color-info-bg: rgba(96, 165, 250, 0.2);


  --color-priority-low-bg: rgba(59, 130, 246, 0.3);
  --color-priority-low-text: #93c5fd;
  --color-priority-normal-bg: rgba(107, 114, 128, 0.3);
  --color-priority-normal-text: #d1d5db;
  --color-priority-high-bg: rgba(245, 158, 11, 0.3);
  --color-priority-high-text: #fbbf24;
  --color-priority-emergency-bg: rgba(239, 68, 68, 0.3);
  --color-priority-emergency-text: #fca5a5;


  --shadow-sm: 0 1px 3px 0 rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 10px 25px rgba(0, 0, 0, 0.5);


  --color-overlay: rgba(0, 0, 0, 0.7);
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  background-color: var(--color-bg-secondary);
  color: var(--color-text-primary);
  transition: var(--theme-transition);
}

#app {
  min-height: 100vh;
}
</style>
