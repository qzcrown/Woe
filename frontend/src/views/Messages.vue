<template>
  <Layout>
    <div class="messages">
      <div class="page-header">
        <h1 class="page-title">{{ $t('common.messages') }}</h1>
        <div class="page-actions">
          <button @click="refreshMessages" :disabled="loading" class="refresh-btn">
            {{ loading ? $t('common.loading') : $t('common.refresh') }}
          </button>
          <button 
            v-if="selectedMessages.length > 0" 
            @click="deleteSelectedMessages" 
            :disabled="deleting" 
            class="delete-selected-btn"
          >
            <LoadingSpinner v-if="deleting" size="small" variant="dots" />
            <span v-else>{{ $t('messages.deleteSelected', { count: selectedMessages.length }) }}</span>
          </button>
        </div>
      </div>

      <div v-if="error" class="error-message">
        {{ error }}
      </div>

      <!-- Message Filters -->
      <MessageFilters 
        :applications="applications"
        @change="handleFilterChange"
      />

      <div class="messages-container">
        <div class="messages-list">
          <!-- Select All Checkbox -->
          <div class="select-all-container">
            <label class="checkbox-label">
              <input 
                type="checkbox" 
                :checked="allSelected" 
                @change="toggleSelectAll"
                class="checkbox"
              />
              {{ $t('messages.selectAll') }}
            </label>
          </div>
          
          <div
            v-for="message in filteredMessages"
            :key="message.id"
            class="message-card"
            :class="{ 'message-selected': selectedMessages.includes(message.id) }"
          >
            <div class="message-header">
              <div class="message-checkbox">
                <input 
                  type="checkbox" 
                  :checked="selectedMessages.includes(message.id)" 
                  @change="toggleMessageSelection(message.id)"
                  class="checkbox"
                />
              </div>
              <h3 class="message-title">{{ message.title }}</h3>
              <div class="message-meta">
                <span class="message-priority priority-{{ message.priority }}">
                  {{ getPriorityLabel(message.priority) }}
                </span>
                <button
                  @click="deleteMessage(message.id)"
                  class="delete-btn"
                  :title="$t('messages.deleteMessage')"
                >
                  ×
                </button>
              </div>
            </div>
            <p class="message-content">{{ message.message }}</p>
            <div class="message-footer">
              <span class="message-time">{{ formatTime(message.date) }}</span>
              <span class="message-app-id">App ID: {{ message.appid }}</span>
            </div>
          </div>

          <EmptyState
            v-if="messages.length === 0 && !loading"
            type="messages"
            :title="$t('messages.noMessages')"
            :description="$t('messages.emptyDescription')"
          >
            <template #actions>
              <button @click="refreshMessages" class="refresh-btn">
                {{ $t('common.refresh') }}
              </button>
            </template>
          </EmptyState>

          <div v-if="loading" class="loading-container">
            <LoadingSpinner :text="$t('messages.loadingMessages')" />
          </div>

          <!-- Load More Button -->
          <div v-if="hasMore && !loading" class="load-more-container">
            <button 
              @click="loadMore" 
              :disabled="loadingMore" 
              class="load-more-btn"
            >
              <LoadingSpinner v-if="loadingMore" size="small" variant="dots" />
              <span v-else>{{ $t('messages.loadMore') }}</span>
            </button>
          </div>

          <!-- No More Messages Indicator -->
          <div v-if="!hasMore && messages.length > 0" class="no-more-messages">
            {{ $t('messages.noMoreMessages') }}
          </div>
        </div>
      </div>

      <ConnectionStatus 
        :connected="wsConnected"
        :connecting="wsConnectionState === 'connecting'"
        :last-connected="lastConnected"
        :reconnect="refreshMessages"
      />
    </div>
  </Layout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Layout from '@/components/Layout.vue'
import EmptyState from '@/components/EmptyState.vue'
import LoadingSpinner from '@/components/LoadingSpinner.vue'
import MessageFilters from '@/components/MessageFilters.vue'
import ConnectionStatus from '@/components/ConnectionStatus.vue'
import { useMessagesStore } from '@/stores/messages'
import { applicationApi } from '@/services/api'
import { wsService } from '@/services/websocket'
import { ApiError } from '@/types'
import { showError, showSuccess } from '@/utils/errorHandler'
import type { Application } from '@/types'

const { t } = useI18n()

const messagesStore = useMessagesStore()

const loading = computed(() => messagesStore.loading)
const loadingMore = computed(() => messagesStore.loadingMore)
const error = computed(() => messagesStore.error)
const messages = computed(() => messagesStore.messages)
const hasMore = computed(() => messagesStore.hasMore)
const wsConnected = computed(() => wsService.isConnected())
const wsConnectionState = computed(() => wsService.getConnectionState())
const lastConnected = computed<string | undefined>(() => wsService.getLastConnected() ?? undefined)

// Applications for filter
const applications = ref<Application[]>([])

// Selection state
const selectedMessages = ref<number[]>([])
const deleting = ref(false)

// Filter state
const filters = ref({
  applicationId: '',
  priority: '',
  search: ''
})

// Computed filtered messages
const filteredMessages = computed(() => {
  let filtered = messages.value
  
  // Filter by application
  if (filters.value.applicationId) {
    filtered = filtered.filter(msg => msg.appid.toString() === filters.value.applicationId)
  }
  
  // Filter by priority
  if (filters.value.priority !== '') {
    filtered = filtered.filter(msg => msg.priority?.toString() === filters.value.priority)
  }
  
  // Filter by search term
  if (filters.value.search) {
    const searchTerm = filters.value.search.toLowerCase()
    filtered = filtered.filter(msg => 
      msg.title?.toLowerCase().includes(searchTerm) || 
      msg.message.toLowerCase().includes(searchTerm)
    )
  }
  
  return filtered
})

// Computed for select all checkbox
const allSelected = computed(() => {
  return filteredMessages.value.length > 0 && 
    selectedMessages.value.length === filteredMessages.value.length
})

const formatTime = (dateString: string) => {
  return new Date(dateString).toLocaleString()
}

const getPriorityLabel = (priority?: number) => {
  if (priority === undefined || priority === null) return t('common.priorityNormal')
  const labels = [
    t('common.priorityLow'),
    t('common.priorityNormal'),
    t('common.priorityHigh'),
    t('common.priorityEmergency')
  ]
  return labels[Math.min(priority, 3)] || t('common.priorityNormal')
}

const refreshMessages = () => {
  messagesStore.fetchMessages({ limit: 100 })
}

const deleteMessage = async (id: number) => {
  if (confirm(t('messages.deleteConfirm'))) {
    try {
      await messagesStore.deleteMessage(id)
      showSuccess(t('messages.deleteSuccess'))
    } catch (error) {
      showError(error as ApiError, t('messages.deleteError'))
    }
  }
}

const loadMore = async () => {
  try {
    await messagesStore.loadMoreMessages()
  } catch (error) {
    showError(error as ApiError, 'Failed to load more messages')
  }
}

// Selection functions
const toggleMessageSelection = (messageId: number) => {
  const index = selectedMessages.value.indexOf(messageId)
  if (index === -1) {
    selectedMessages.value.push(messageId)
  } else {
    selectedMessages.value.splice(index, 1)
  }
}

const toggleSelectAll = () => {
  if (allSelected.value) {
    // Deselect all
    selectedMessages.value = []
  } else {
    // Select all filtered messages
    selectedMessages.value = filteredMessages.value.map(msg => msg.id)
  }
}

const deleteSelectedMessages = async () => {
  if (selectedMessages.value.length === 0) return

  if (confirm(t('messages.deleteMultipleConfirm', { count: selectedMessages.value.length }))) {
    try {
      // Delete each selected message
      for (const id of selectedMessages.value) {
        await messagesStore.deleteMessage(id)
      }

      showSuccess(t('messages.deleteMultipleSuccess', { count: selectedMessages.value.length }))
      selectedMessages.value = []
    } catch (error) {
      showError(error as ApiError, t('messages.deleteMultipleError'))
    }
  }
}

// Filter functions
const handleFilterChange = (newFilters: any) => {
  filters.value = { ...newFilters }
}

// Load applications for filter
const loadApplications = async () => {
  try {
    const response = await applicationApi.getApplications()
    applications.value = response.data || []
  } catch (error) {
    console.error('Failed to load applications:', error)
  }
}

const handleNewMessage = (message: any) => {
  console.log('New message received:', message)
}

onMounted(() => {
  refreshMessages()
  loadApplications()
  wsService.onMessage(handleNewMessage)
})

onUnmounted(() => {
  wsService.offMessage(handleNewMessage)
})
</script>

<style scoped>
.messages {
  max-width: 800px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
}

.page-title {
  font-size: 2rem;
  font-weight: bold;
  color: #1f2937;
  margin: 0;
}

.page-actions {
  display: flex;
  gap: 1rem;
}

.refresh-btn {
  padding: 0.5rem 1rem;
  background-color: #3b82f6;
  color: white;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  transition: background-color 0.2s;
}

.refresh-btn:hover:not(:disabled) {
  background-color: #2563eb;
}

.refresh-btn:disabled {
  background-color: #9ca3af;
  cursor: not-allowed;
}

.error-message {
  background-color: #fef2f2;
  color: #dc2626;
  padding: 1rem;
  border-radius: 0.375rem;
  margin-bottom: 1rem;
  border: 1px solid #fecaca;
}

.messages-container {
  background: white;
  border-radius: 0.75rem;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.messages-list {
  max-height: 70vh;
  overflow-y: auto;
}

.message-card {
  padding: 1.5rem;
  border-bottom: 1px solid #e5e7eb;
  transition: background-color 0.2s;
}

.message-card:hover {
  background-color: #f9fafb;
}

.message-card:last-child {
  border-bottom: none;
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 0.75rem;
}

.message-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: #1f2937;
  margin: 0;
  flex: 1;
  margin-right: 1rem;
  line-height: 1.4;
}

.message-meta {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-shrink: 0;
}

.message-priority {
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
}

.priority-0 { background: #dbeafe; color: #1e40af; }
.priority-1 { background: #f3f4f6; color: #374151; }
.priority-2 { background: #fef3c7; color: #92400e; }
.priority-3 { background: #fecaca; color: #991b1b; }

.delete-btn {
  width: 24px;
  height: 24px;
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 0.25rem;
  cursor: pointer;
  font-size: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s;
}

.delete-btn:hover {
  background: #dc2626;
}

.message-content {
  color: #4b5563;
  font-size: 1rem;
  line-height: 1.6;
  margin-bottom: 1rem;
}

.message-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #6b7280;
  font-size: 0.875rem;
}

.connection-status {
  position: fixed;
  bottom: 2rem;
  right: 2rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: white;
  border-radius: 2rem;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  font-size: 0.875rem;
  color: #6b7280;
  transition: all 0.2s;
}

.connection-status.connected {
  color: #059669;
}

.status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #dc2626;
  transition: background-color 0.2s;
}

.connection-status.connected .status-indicator {
  background: #059669;
}

.loading-container {
  display: flex;
  justify-content: center;
  padding: 2rem;
}

.load-more-container {
  display: flex;
  justify-content: center;
  padding: 1rem;
}

.load-more-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1.5rem;
  background-color: #f3f4f6;
  color: #374151;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: all 0.2s;
}

.load-more-btn:hover:not(:disabled) {
  background-color: #e5e7eb;
}

.load-more-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.no-more-messages {
  text-align: center;
  color: #9ca3af;
  padding: 1rem;
  font-size: 0.875rem;
  font-style: italic;
}

/* Selection styles */
.select-all-container {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #e5e7eb;
  background-color: #f9fafb;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: #374151;
  cursor: pointer;
}

.checkbox {
  width: 16px;
  height: 16px;
  accent-color: #3b82f6;
}

.message-selected {
  background-color: #eff6ff;
  border-left: 3px solid #3b82f6;
}

.message-checkbox {
  margin-right: 0.75rem;
}

.delete-selected-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background-color: #ef4444;
  color: white;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  transition: all 0.2s;
}

.delete-selected-btn:hover:not(:disabled) {
  background-color: #dc2626;
}

.delete-selected-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
  }

  .message-header {
    flex-direction: column;
    gap: 0.5rem;
  }

  .message-title {
    margin-right: 0;
  }

  .message-footer {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
  }

  .connection-status {
    bottom: 1rem;
    right: 1rem;
    left: 1rem;
  }
}
</style>
