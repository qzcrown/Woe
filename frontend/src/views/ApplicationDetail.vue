<template>
  <Layout>
    <div class="application-detail">
      <div v-if="loading" class="loading-container">
        <LoadingSpinner text="Loading application details..." />
      </div>

      <div v-else-if="error" class="error-container">
        <div class="error-message">
          <h3>Error loading application</h3>
          <p>{{ error }}</p>
          <button @click="loadApplication" class="retry-btn">Retry</button>
        </div>
      </div>

      <div v-else-if="application" class="application-content">
        <div class="application-header">
          <div class="app-icon-large">
            <ApplicationIcon
              :name="application.name"
              :image="application.image"
              size="large"
              :show-upload-overlay="true"
              :show-delete-button="true"
              @upload="uploadIcon"
              @delete="deleteIcon"
            />
          </div>
          
          <div class="app-info">
            <h1 class="app-name">{{ application.name }}</h1>
            <p class="app-description">{{ application.description || 'No description' }}</p>
            
            <div class="app-meta">
              <div class="meta-item">
                <span class="meta-label">Application ID:</span>
                <span class="meta-value">{{ application.id }}</span>
              </div>
              
              <div class="meta-item">
                <span class="meta-label">Default Priority:</span>
                <span class="meta-value priority-badge priority-{{ application.defaultPriority }}">
                  {{ getPriorityLabel(application.defaultPriority) }}
                </span>
              </div>
              
              <div class="meta-item">
                <span class="meta-label">Last Used:</span>
                <span class="meta-value">{{ formatDate(application.lastUsed || '') }}</span>
              </div>
              
              <div class="meta-item">
                <span class="meta-label">Internal:</span>
                <span class="meta-value">{{ application.internal ? 'Yes' : 'No' }}</span>
              </div>
            </div>
            
            <div class="app-actions">
              <button @click="showEditModal = true" class="edit-btn">Edit Application</button>
              <button @click="copyToken" class="copy-btn">Copy Token</button>
              <button @click="confirmDelete" class="delete-btn">Delete Application</button>
            </div>
          </div>
        </div>

        <div class="application-sections">
          <!-- Token Section -->
          <div class="section">
            <h2 class="section-title">Application Token</h2>
            <div class="token-container">
              <div class="token-display">
                <code :class="{ 'token-hidden': !tokenVisible }">
                  {{ tokenVisible ? application.token : '•••••••••••••••••••••' }}
                </code>
              </div>
              <button @click="toggleTokenVisibility" class="token-toggle-btn">
                <svg v-if="!tokenVisible" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8"></path>
                  <path d="M9.5 9a3 3 0 0 1 0 6"></path>
                </svg>
                <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 0 5.06 5.06M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 0-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                  <line x1="1" y1="1" x2="23" y2="23"></line>
                </svg>
              </button>
            </div>
            <p class="token-description">
              Use this token to send messages to this application via the REST API.
            </p>
          </div>

          <!-- Messages Section -->
          <div class="section">
            <div class="section-header">
              <h2 class="section-title">Recent Messages</h2>
              <router-link :to="`/messages?appId=${application.id}`" class="view-all-btn">
                View All Messages
              </router-link>
            </div>
            
            <div v-if="messagesLoading" class="loading-container">
              <LoadingSpinner text="Loading messages..." />
            </div>
            
            <div v-else-if="messages.length === 0" class="empty-messages">
              <EmptyState
                type="messages"
                title="No messages yet"
                description="Messages sent to this application will appear here."
                size="small"
              />
            </div>
            
            <div v-else class="messages-list">
              <div v-for="message in messages" :key="message.id" class="message-item">
                <div class="message-header">
                  <h4 class="message-title">{{ message.title || 'No Title' }}</h4>
                  <span class="message-time">{{ formatTime(message.date) }}</span>
                </div>
                <p class="message-content">{{ message.message }}</p>
                <div class="message-priority priority-{{ message.priority }}">
                  {{ getPriorityLabel(message.priority) }}
                </div>
              </div>
              
              <div v-if="hasMoreMessages" class="load-more-container">
                <button 
                  @click="loadMoreMessages" 
                  :disabled="loadingMoreMessages" 
                  class="load-more-btn"
                >
                  <LoadingSpinner v-if="loadingMoreMessages" size="small" variant="dots" />
                  <span v-else>Load More</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Edit Modal -->
      <EditApplicationModal
        v-if="showEditModal && application"
        :application="application"
        @close="showEditModal = false"
        @updated="handleApplicationUpdated"
      />
    </div>
  </Layout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Layout from '@/components/Layout.vue'
import ApplicationIcon from '@/components/ApplicationIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import LoadingSpinner from '@/components/LoadingSpinner.vue'
import EditApplicationModal from '@/components/EditApplicationModal.vue'
import { applicationApi } from '@/services/api'
import { showSuccess, showError } from '@/utils/errorHandler'
import type { Application, Message, Paging } from '@/types'

const route = useRoute()
const router = useRouter()

const application = ref<Application | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const tokenVisible = ref(false)
const showEditModal = ref(false)

// Messages state
const messages = ref<Message[]>([])
const messagesLoading = ref(false)
const loadingMoreMessages = ref(false)
const hasMoreMessages = ref(false)
const messagePaging = ref<Paging>({
  size: 0,
  since: 0,
  limit: 20
})

const appId = computed(() => {
  return Number(route.params.id)
})

const formatDate = (dateString: string) => {
  if (!dateString) return 'Never'
  return new Date(dateString).toLocaleString()
}

const formatTime = (dateString: string) => {
  return new Date(dateString).toLocaleString()
}

const getPriorityLabel = (priority?: number) => {
  if (priority === undefined || priority === null) return 'Normal'
  const labels = ['Low', 'Normal', 'High', 'Emergency']
  return labels[Math.min(priority, 3)] || 'Normal'
}

const loadApplication = async () => {
  loading.value = true
  error.value = null
  
  try {
    const response = await applicationApi.getApplication(appId.value)
    application.value = response.data
    // Load initial messages after app is loaded
    loadMessages()
  } catch (err: any) {
    error.value = err.errorDescription || 'Failed to load application'
    showError(err, 'Failed to load application')
  } finally {
    loading.value = false
  }
}

const loadMessages = async () => {
  messagesLoading.value = true
  
  try {
    const response = await applicationApi.getApplicationMessages(appId.value, { limit: 20 })
    messages.value = response.data.messages.reverse() // Show newest first
    messagePaging.value = response.data.paging
    hasMoreMessages.value = !!response.data.paging.next
  } catch (err: any) {
    showError(err, 'Failed to load messages')
  } finally {
    messagesLoading.value = false
  }
}

const loadMoreMessages = async () => {
  if (!hasMoreMessages.value || loadingMoreMessages.value) return
  
  loadingMoreMessages.value = true
  
  try {
    const params = {
      limit: messagePaging.value.limit,
      since: messagePaging.value.since
    }
    const response = await applicationApi.getApplicationMessages(appId.value, params)
    
    // Append older messages to the end
    const olderMessages = response.data.messages.reverse()
    messages.value = [...messages.value, ...olderMessages]
    
    messagePaging.value = response.data.paging
    hasMoreMessages.value = !!response.data.paging.next
  } catch (err: any) {
    showError(err, 'Failed to load more messages')
  } finally {
    loadingMoreMessages.value = false
  }
}

const toggleTokenVisibility = () => {
  tokenVisible.value = !tokenVisible.value
}

const copyToken = async () => {
  if (!application.value) return
  
  try {
    await navigator.clipboard.writeText(application.value.token)
    showSuccess('Token copied to clipboard!')
  } catch (err) {
    showError(err as Error, 'Failed to copy token')
  }
}

const uploadIcon = async (file: File) => {
  if (!application.value) return
  
  try {
    await applicationApi.uploadApplicationImage(application.value.id, file)
    showSuccess('Icon uploaded successfully!')
    // Reload application to get updated image
    await loadApplication()
  } catch (err: any) {
    showError(err, 'Failed to upload icon')
  }
}

const deleteIcon = async () => {
  if (!application.value) return
  
  try {
    await applicationApi.deleteApplicationImage(application.value.id)
    showSuccess('Icon deleted successfully!')
    // Reload application to update UI
    await loadApplication()
  } catch (err: any) {
    showError(err, 'Failed to delete icon')
  }
}

const handleApplicationUpdated = () => {
  showEditModal.value = false
  loadApplication()
}

const confirmDelete = () => {
  if (!application.value) return
  
  if (confirm(`Are you sure you want to delete "${application.value.name}"? This action cannot be undone.`)) {
    deleteApplication()
  }
}

const deleteApplication = async () => {
  if (!application.value) return
  
  try {
    await applicationApi.deleteApplication(application.value.id)
    showSuccess('Application deleted successfully!')
    router.push('/applications')
  } catch (err: any) {
    showError(err, 'Failed to delete application')
  }
}

onMounted(() => {
  loadApplication()
})
</script>

<style scoped>
.application-detail {
  max-width: 1000px;
  margin: 0 auto;
}

.loading-container {
  display: flex;
  justify-content: center;
  padding: 3rem;
}

.error-container {
  padding: 2rem;
}

.error-message {
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 0.5rem;
  padding: 1.5rem;
  text-align: center;
  max-width: 500px;
  margin: 0 auto;
}

.error-message h3 {
  color: #b91c1c;
  margin-bottom: 0.5rem;
}

.error-message p {
  color: #991b1b;
  margin-bottom: 1rem;
}

.retry-btn {
  background-color: #3b82f6;
  color: white;
  border: none;
  border-radius: 0.375rem;
  padding: 0.5rem 1rem;
  cursor: pointer;
}

.application-content {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.application-header {
  display: flex;
  gap: 2rem;
  padding: 1.5rem;
  background: white;
  border-radius: 0.75rem;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
}

.app-icon-large {
  flex-shrink: 0;
}

.app-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.app-name {
  font-size: 1.875rem;
  font-weight: 700;
  color: #1f2937;
  margin: 0;
}

.app-description {
  color: #6b7280;
  font-size: 1rem;
  line-height: 1.5;
}

.app-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.meta-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 150px;
}

.meta-label {
  font-size: 0.875rem;
  color: #6b7280;
  font-weight: 500;
}

.meta-value {
  font-size: 0.875rem;
  color: #1f2937;
  font-weight: 600;
}

.priority-badge {
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
}

.priority-0 { background: #dbeafe; color: #1e40af; }
.priority-1 { background: #f3f4f6; color: #374151; }
.priority-2 { background: #fef3c7; color: #92400e; }
.priority-3 { background: #fecaca; color: #991b1b; }

.app-actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.edit-btn, .copy-btn, .delete-btn {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  transition: background-color 0.2s;
}

.edit-btn {
  background-color: #3b82f6;
  color: white;
}

.edit-btn:hover {
  background-color: #2563eb;
}

.copy-btn {
  background-color: #6366f1;
  color: white;
}

.copy-btn:hover {
  background-color: #4f46e5;
}

.delete-btn {
  background-color: #ef4444;
  color: white;
}

.delete-btn:hover {
  background-color: #dc2626;
}

.application-sections {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.section {
  background: white;
  border-radius: 0.75rem;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem 1.5rem 0;
}

.section-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1f2937;
  margin: 0;
  padding: 0 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #e5e7eb;
}

.view-all-btn {
  color: #3b82f6;
  text-decoration: none;
  font-size: 0.875rem;
  font-weight: 500;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  transition: background-color 0.2s;
}

.view-all-btn:hover {
  background-color: #f0f9ff;
}

.token-container {
  padding: 1.5rem;
}

.token-display {
  display: flex;
  align-items: center;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 0.5rem;
  padding: 0.75rem;
  margin-bottom: 1rem;
}

.token-display code {
  font-family: 'Courier New', monospace;
  font-size: 0.875rem;
  color: #1e293b;
  background: transparent;
  flex: 1;
  word-break: break-all;
}

.token-hidden {
  letter-spacing: 2px;
}

.token-toggle-btn {
  background: none;
  border: none;
  color: #64748b;
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 0.25rem;
  margin-left: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.token-toggle-btn:hover {
  background-color: #e2e8f0;
}

.token-description {
  color: #64748b;
  font-size: 0.875rem;
  margin: 0;
}

.messages-list {
  padding: 0 1.5rem 1.5rem;
}

.message-item {
  padding: 1rem;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  margin-bottom: 1rem;
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.message-title {
  font-size: 1rem;
  font-weight: 600;
  color: #1f2937;
  margin: 0;
}

.message-time {
  font-size: 0.75rem;
  color: #6b7280;
}

.message-content {
  color: #4b5563;
  font-size: 0.875rem;
  line-height: 1.5;
  margin-bottom: 0.5rem;
}

.message-priority {
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
}

.empty-messages {
  padding: 2rem 1.5rem;
}

.load-more-container {
  display: flex;
  justify-content: center;
  padding: 1rem 1.5rem;
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

/* Responsive Design */
@media (max-width: 768px) {
  .application-header {
    flex-direction: column;
    gap: 1rem;
  }
  
  .app-meta {
    flex-direction: column;
    gap: 0.75rem;
  }
  
  .meta-item {
    min-width: auto;
  }
  
  .app-actions {
    justify-content: stretch;
  }
  
  .app-actions button {
    flex: 1;
  }
  
  .section-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }
}
</style>
