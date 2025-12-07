import { defineStore } from 'pinia'
import { ref } from 'vue'
import { messageApi } from '@/services/api'
import { wsService } from '@/services/websocket'
import { browserNotificationService } from '@/services/browserNotification'
import type { Message, Paging } from '@/types'

export const useMessagesStore = defineStore('messages', () => {
  const messages = ref<Message[]>([])
  const loading = ref(false)
  const loadingMore = ref(false)
  const error = ref<string | null>(null)
  const paging = ref<Paging>({
    size: 0,
    since: 0,
    limit: 100
  })
  const hasMore = ref(true)

  const fetchMessages = async (params?: { limit?: number; since?: number }) => {
    loading.value = true
    error.value = null

    try {
      const response = await messageApi.getMessages(params)
      messages.value = response.data.messages.reverse() // Show newest first
      paging.value = response.data.paging
      hasMore.value = !!response.data.paging.next
    } catch (err) {
      error.value = 'Failed to fetch messages'
      console.error('Error fetching messages:', err)
    } finally {
      loading.value = false
    }
  }

  const loadMoreMessages = async () => {
    if (!hasMore.value || loadingMore.value) return

    loadingMore.value = true
    error.value = null

    try {
      const params = {
        limit: paging.value.limit,
        since: paging.value.since
      }
      const response = await messageApi.getMessages(params)
      
      // Append older messages to the end
      const olderMessages = response.data.messages.reverse()
      messages.value = [...messages.value, ...olderMessages]
      
      paging.value = response.data.paging
      hasMore.value = !!response.data.paging.next
    } catch (err) {
      error.value = 'Failed to load more messages'
      console.error('Error loading more messages:', err)
    } finally {
      loadingMore.value = false
    }
  }

  const deleteMessage = async (id: number) => {
    try {
      await messageApi.deleteMessage(id)
      messages.value = messages.value.filter(msg => msg.id !== id)
    } catch (err) {
      error.value = 'Failed to delete message'
      console.error('Error deleting message:', err)
    }
  }

  const addMessage = (message: Message) => {
    // Add new message at the beginning
    messages.value.unshift(message)

    // Keep only last 100 messages
    if (messages.value.length > 100) {
      messages.value = messages.value.slice(0, 100)
    }

    // Show browser notification for new message
    browserNotificationService.showMessageNotification(message)
  }

  const connectWebSocket = (token: string) => {
    wsService.onMessage(addMessage)
    wsService.connect(token)
  }

  const disconnectWebSocket = () => {
    wsService.disconnect()
  }

  return {
    messages,
    loading,
    loadingMore,
    error,
    paging,
    hasMore,
    fetchMessages,
    loadMoreMessages,
    deleteMessage,
    addMessage,
    connectWebSocket,
    disconnectWebSocket
  }
})
