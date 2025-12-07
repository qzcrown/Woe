<template>
  <div id="app">
    <router-view />
    <Notification />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useMessagesStore } from '@/stores/messages'
import { browserNotificationService } from '@/services/browserNotification'
import Notification from '@/components/Notification.vue'

const authStore = useAuthStore()
const messagesStore = useMessagesStore()

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