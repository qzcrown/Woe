<template>
  <Layout>
    <div class="messages">
  <div class="page-header">
    <h1 class="page-title">{{ $t('common.messages') }}</h1>
    <div class="page-actions">
      <button
        v-if="canSendNotification"
        @click="openSendModal"
        class="send-btn"
      >
        {{ $t('messages.sendNotification') }}
      </button>
      <button type="button" class="refresh-btn" @click="refreshMessages" :disabled="loading">
        <RefreshCw :size="14" aria-hidden="true" :class="{ spinning: loading }" />
        <span>{{ loading ? $t('common.loading') : $t('common.refresh') }}</span>
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


      <div v-if="shouldShowNotificationPrompt" class="notification-prompt">
        <div class="prompt-content">
          <div class="prompt-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            </svg>
          </div>
          <div class="prompt-text">
            <h3>{{ $t('messages.enableBrowserNotifications') }}</h3>
            <p>{{ $t('messages.enableBrowserNotificationsDescription') }}</p>
          </div>
          <div class="prompt-actions">
            <button @click="requestNotificationPermission" class="btn btn-primary">
              {{ $t('messages.enableNotifications') }}
            </button>
            <button @click="dismissNotificationPrompt" class="btn btn-secondary">
              {{ $t('messages.dismiss') }}
            </button>
          </div>
        </div>
      </div>


      <MessageFilters
        :applications="applications"
        @change="handleFilterChange"
      />

      <div class="messages-container">
        <div class="messages-list">

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
            @click="openMessageDetail(message)"
          >
            <div class="message-header">
              <div class="message-checkbox" @click.stop>
                <input
                  type="checkbox"
                  :checked="selectedMessages.includes(message.id)"
                  @change="toggleMessageSelection(message.id)"
                  class="checkbox"
                />
              </div>
              <h3 class="message-title">{{ message.title }}</h3>
              <div class="message-meta">
                <span class="message-priority" :class="`priority-${getPriorityLevel(message.priority ?? 1)}`">
                  {{ getPriorityLabel(message.priority) }}
                </span>
                <button type="button" class="delete-btn" @click.stop="deleteMessage(message.id)"
                  :title="$t('messages.deleteMessage')" :aria-label="$t('messages.deleteMessage')">
                  <Trash2 :size="14" aria-hidden="true" />
                </button>
              </div>
            </div>
            <p class="message-content">{{ message.message }}</p>
            <div class="message-footer">
              <span class="message-time" :title="formatDateTime(message.date)">{{ formatRelativeTime(message.date) }}</span>
              <span class="message-app-name">{{ getApplicationName(message.appid) }}</span>
            </div>
          </div>

          <EmptyState
            v-if="messages.length === 0 && !loading"
            type="messages"
            :title="$t('messages.noMessages')"
            :description="$t('messages.emptyDescription')"
          >
            <template #actions>
              <button type="button" class="refresh-btn" @click="refreshMessages" :disabled="loading">
                <RefreshCw :size="14" aria-hidden="true" />
                <span>{{ $t('common.refresh') }}</span>
              </button>
            </template>
          </EmptyState>

          <div v-if="loading" class="loading-container">
            <LoadingSpinner :text="$t('messages.loadingMessages')" />
          </div>


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


          <div v-if="!hasMore && messages.length > 0" class="no-more-messages">
            {{ $t('messages.noMoreMessages') }}
          </div>
        </div>
      </div>

      <SendNotificationModal
        v-if="showSendModal"
        @close="closeSendModal"
        @submitted="handleMessageSent"
      />
      <MessageDetailModal
        v-if="showDetailModal && selectedMessage"
        :message="selectedMessage"
        @close="closeMessageDetail"
        @deleted="handleMessageDeleted"
      />
    </div>
  </Layout>
</template>

<script setup lang="ts">
import { getPriorityLevel } from '@/utils/priority'
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { RefreshCw, Trash2 } from '@lucide/vue'
import Layout from '@/components/Layout.vue'
import EmptyState from '@/components/EmptyState.vue'
import LoadingSpinner from '@/components/LoadingSpinner.vue'
import MessageFilters from '@/components/MessageFilters.vue'
import { useMessagesStore } from '@/stores/messages'
import { useAuthStore } from '@/stores/auth'
import SendNotificationModal from '@/components/SendNotificationModal.vue'
import MessageDetailModal from '@/components/MessageDetailModal.vue'
import { applicationApi } from '@/services/api'
import { ApiError } from '@/types'
import { showError, showSuccess } from '@/utils/errorHandler'
import { formatRelativeTime, formatDateTime } from '@/utils/datetime'
import { browserNotificationService } from '@/services/browserNotification'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import type { Application, Message } from '@/types'

const { t } = useI18n()
const { confirm: confirmDialog } = useConfirmDialog()
const route = useRoute()
const router = useRouter()

const messagesStore = useMessagesStore()
const authStore = useAuthStore()

const loading = computed(() => messagesStore.loading)
const loadingMore = computed(() => messagesStore.loadingMore)
const error = computed(() => messagesStore.error)
const messages = computed(() => messagesStore.messages)
const hasMore = computed(() => messagesStore.hasMore)


const applications = ref<Application[]>([])


const selectedMessages = ref<number[]>([])
const deleting = ref(false)


const filters = ref({
  applicationId: '',
  priority: '',
  search: ''
})


const filteredMessages = computed(() => {
  let filtered = messages.value


  if (filters.value.applicationId) {
    filtered = filtered.filter(msg => msg.appid.toString() === String(filters.value.applicationId))
  }


  if (filters.value.priority !== '') {
    filtered = filtered.filter(msg => String(getPriorityLevel(msg.priority ?? 1)) === filters.value.priority)
  }


  if (filters.value.search) {
    const searchTerm = filters.value.search.toLowerCase()
    filtered = filtered.filter(msg =>
      msg.title?.toLowerCase().includes(searchTerm) ||
      msg.message.toLowerCase().includes(searchTerm)
    )
  }

  return filtered
})


const allSelected = computed(() => {
  return filteredMessages.value.length > 0 &&
    selectedMessages.value.length === filteredMessages.value.length
})

const getPriorityLabel = (priority?: number) => {
  if (priority === undefined || priority === null) return t('common.priorityNormal')
  const labels = [
    t('common.priorityLow'),
    t('common.priorityNormal'),
    t('common.priorityHigh'),
    t('common.priorityEmergency')
  ]
  return labels[getPriorityLevel(priority ?? 1)] || t('common.priorityNormal')
}


const getApplicationName = (appid: number) => {
  const app = applications.value.find(a => a.id === appid)
  return app?.name || t('messages.unknownApplication')
}

const refreshMessages = () => {
  return messagesStore.fetchMessages({ limit: 100 })
}






const openMessageFromQuery = () => {
  const raw = route.query.messageId
  const messageId = Number(Array.isArray(raw) ? raw[0] : raw)
  if (!Number.isSafeInteger(messageId) || messageId <= 0) return

  const target = messages.value.find(m => m.id === messageId)
  if (target) {
    openMessageDetail(target)
  }
  const cleared = { ...route.query }
  delete cleared.messageId
  void router.replace({ query: cleared })
}

const deleteMessage = async (id: number) => {
  const confirmed = await confirmDialog({
    title: t('common.confirmDialog.title'),
    message: t('messages.deleteConfirm'),
    confirmText: t('common.confirmDialog.confirmButton'),
    cancelText: t('common.confirmDialog.cancelButton'),
    type: 'danger'
  })

  if (confirmed) {
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
    showError(error as ApiError, t('messages.loadMoreFailed'))
  }
}


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

    selectedMessages.value = []
  } else {

    selectedMessages.value = filteredMessages.value.map(msg => msg.id)
  }
}

const deleteSelectedMessages = async () => {
  if (selectedMessages.value.length === 0) return

  const confirmed = await confirmDialog({
    title: t('common.confirmDialog.title'),
    message: t('messages.deleteMultipleConfirm', { count: selectedMessages.value.length }),
    confirmText: t('common.confirmDialog.confirmButton'),
    cancelText: t('common.confirmDialog.cancelButton'),
    type: 'danger'
  })

  if (confirmed) {
    try {
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


const handleFilterChange = (newFilters: any) => {
  filters.value = { ...newFilters }
}


const loadApplications = async () => {
  try {
    const response = await applicationApi.getApplications()
    applications.value = response.data || []
  } catch (error) {
    console.error('Failed to load applications:', error)
  }
}

onMounted(() => {
  void refreshMessages().then(openMessageFromQuery)
  loadApplications()
  checkNotificationPrompt()
})

const showSendModal = ref(false)
const showDetailModal = ref(false)
const selectedMessage = ref<Message | null>(null)

const openMessageDetail = (message: Message) => {
  selectedMessage.value = message
  showDetailModal.value = true
}

const closeMessageDetail = () => {
  showDetailModal.value = false
  selectedMessage.value = null
}

const handleMessageDeleted = (id: number) => {
  const index = selectedMessages.value.indexOf(id)
  if (index !== -1) {
    selectedMessages.value.splice(index, 1)
  }
  closeMessageDetail()
}
const openSendModal = () => {
  showSendModal.value = true
}
const closeSendModal = () => {
  showSendModal.value = false
}
const handleMessageSent = (msg: Message) => {
  messagesStore.addMessage(msg)
  showSuccess(t('messages.sentSuccessfully'))
  closeSendModal()
}
const canSendNotification = computed(() => {
  return (authStore.user?.admin === true) || applications.value.length > 0
})


const shouldShowNotificationPrompt = ref(true)

const checkNotificationPrompt = () => {
  if (!browserNotificationService.isNotificationSupported() ||
      browserNotificationService.getPermission() !== 'default') {
    shouldShowNotificationPrompt.value = false
    return
  }


  const dismissed = localStorage.getItem('notification-prompt-dismissed')
  if (dismissed) {
    shouldShowNotificationPrompt.value = false
  }
}

const requestNotificationPermission = async () => {
  try {
    await browserNotificationService.requestPermission()
    shouldShowNotificationPrompt.value = false
  } catch (error) {
    console.error('Failed to request notification permission:', error)
  }
}

const dismissNotificationPrompt = () => {
  shouldShowNotificationPrompt.value = false
  localStorage.setItem('notification-prompt-dismissed', 'true')
}
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
  color: var(--color-text-primary);
  margin: 0;
}

.page-actions {
  display: flex;
  gap: 1rem;
}

.send-btn {
  padding: 0.5rem 1rem;
  background-color: var(--color-success);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  transition: background-color 0.2s;
}

.send-btn:hover {
  background-color: #059669;
}

.refresh-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 1rem;
  background-color: var(--color-primary);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  transition: background-color 0.2s;
}

.refresh-btn:hover:not(:disabled) {
  background-color: var(--color-primary-hover);
}

.refresh-btn:disabled {
  background-color: var(--color-text-muted);
  cursor: not-allowed;
}

.refresh-btn .spinning {
  animation: message-refresh-spin 1s linear infinite;
}

@keyframes message-refresh-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .refresh-btn .spinning {
    animation: none;
  }
}

.error-message {
  background-color: var(--color-error-bg);
  color: var(--color-error);
  padding: 1rem;
  border-radius: 0.375rem;
  margin-bottom: 1rem;
  border: 1px solid var(--color-error);
}

.messages-container {
  background: var(--color-bg-primary);
  border-radius: 0.75rem;
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.messages-list {
  max-height: 70vh;
  overflow-y: auto;
}

.message-card {
  padding: 1.5rem;
  border-bottom: 1px solid var(--color-border-primary);
  transition: background-color 0.2s;
  cursor: pointer;
}

.message-card:hover {
  background-color: var(--color-bg-tertiary);
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
  color: var(--color-text-primary);
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

.priority-0 { background: var(--color-priority-low-bg); color: var(--color-priority-low-text); }
.priority-1 { background: var(--color-priority-normal-bg); color: var(--color-priority-normal-text); }
.priority-2 { background: var(--color-priority-high-bg); color: var(--color-priority-high-text); }
.priority-3 { background: var(--color-priority-emergency-bg); color: var(--color-priority-emergency-text); }

.delete-btn {
  width: 24px;
  height: 24px;
  background: var(--color-error);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.25rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s;
}

.delete-btn:hover {
  background: #dc2626;
}


.refresh-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.delete-btn:focus-visible {
  outline: 2px solid var(--color-error);
  outline-offset: 2px;
}

.message-content {
  color: var(--color-text-secondary);
  font-size: 1rem;
  line-height: 1.6;
  margin-bottom: 1rem;
}

.message-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--color-text-tertiary);
  font-size: 0.875rem;
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
  background-color: var(--color-bg-hover);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border-secondary);
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: all 0.2s;
}

.load-more-btn:hover:not(:disabled) {
  background-color: var(--color-bg-active);
}

.load-more-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.no-more-messages {
  text-align: center;
  color: var(--color-text-muted);
  padding: 1rem;
  font-size: 0.875rem;
  font-style: italic;
}


.select-all-container {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--color-border-primary);
  background-color: var(--color-bg-tertiary);
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.checkbox {
  width: 16px;
  height: 16px;
  accent-color: var(--color-primary);
}

.message-selected {
  background-color: var(--color-info-bg);
  border-left: 3px solid var(--color-primary);
}

.message-checkbox {
  margin-right: 0.75rem;
}

.delete-selected-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background-color: var(--color-error);
  color: var(--color-text-inverse);
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


.notification-prompt {
  background-color: var(--color-info-bg);
  border: 1px solid var(--color-info);
  border-radius: 0.5rem;
  margin-bottom: 1rem;
  padding: 1rem;
}

.prompt-content {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.prompt-icon {
  flex-shrink: 0;
  color: var(--color-info);
}

.prompt-text {
  flex: 1;
}

.prompt-text h3 {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0 0 0.25rem 0;
}

.prompt-text p {
  font-size: 0.875rem;
  color: var(--color-text-tertiary);
  margin: 0;
  line-height: 1.4;
}

.prompt-actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

.btn {
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
}

.btn-primary {
  background-color: var(--color-primary);
  color: var(--color-text-inverse);
}

.btn-primary:hover {
  background-color: var(--color-primary-hover);
}

.btn-secondary {
  background-color: var(--color-bg-hover);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border-secondary);
}

.btn-secondary:hover {
  background-color: var(--color-bg-active);
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

  .prompt-content {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .prompt-actions {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
