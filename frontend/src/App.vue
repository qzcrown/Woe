<template>
  <div id="app">
    <router-view />
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
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useMessagesStore } from '@/stores/messages'
import { browserNotificationService } from '@/services/browserNotification'
import Notification from '@/components/Notification.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import AlertDialog from '@/components/AlertDialog.vue'
import { useConfirmDialogProvider } from '@/composables/useConfirmDialog'
import { useAlertProvider } from '@/composables/useAlert'

const authStore = useAuthStore()
const messagesStore = useMessagesStore()

const { state: confirmState, handleConfirm, handleCancel } = useConfirmDialogProvider()
const { state: alertState, handleConfirm: handleAlertConfirm } = useAlertProvider()

onMounted(async () => {
  // Check authentication on app load
  await authStore.checkAuth()

  // Initialize browser notification service
  if (browserNotificationService.isNotificationSupported()) {
    // Try to request permission if not already requested
    if (browserNotificationService.getPermission() === 'default') {
      // Don't request permission immediately, wait for user interaction
      // This will be handled in the UI
    }
  }

  // Connect WebSocket if authenticated
  if (authStore.isAuthenticated && authStore.token) {
    messagesStore.connectWebSocket(authStore.token)
  }
})

onUnmounted(() => {
  // Disconnect WebSocket on app unmount
  messagesStore.disconnectWebSocket()
  
  // Clean up browser notification service
  browserNotificationService.destroy()
})
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  background-color: #f5f5f5;
}

#app {
  min-height: 100vh;
}
</style>