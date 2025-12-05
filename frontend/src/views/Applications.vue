<template>
  <Layout>
    <div class="applications">
      <div class="page-header">
        <h1 class="page-title">{{ $t('common.applications') }}</h1>
        <button @click="showCreateModal = true" class="create-btn">{{ $t('applications.add') }}</button>
      </div>

      <div v-if="loading" class="loading">{{ $t('applications.loadingApplications') }}</div>

      <div v-else class="applications-grid">
        <router-link 
          v-for="app in applications" 
          :key="app.id" 
          :to="`/applications/${app.id}`" 
          class="app-card"
        >
          <div class="app-header">
            <div class="app-icon-container">
              <ApplicationIcon
                :name="app.name"
                :image="app.image"
                :show-upload-overlay="true"
                :show-delete-button="true"
                @upload="(file) => uploadIcon(app.id, file)"
                @delete="() => deleteIcon(app.id)"
              />
            </div>
            <div class="app-title-container">
              <h3>{{ app.name }}</h3>
              <span class="app-priority priority-{{ app.defaultPriority }}">
                {{ $t('common.priority') }} {{ app.defaultPriority }}
              </span>
            </div>
          </div>
          <p class="app-description">{{ app.description || $t('applications.noDescription') }}</p>
          <div class="app-info">
            <p class="app-token">
              <strong>{{ $t('common.token') }}:</strong>
              <code>{{ app.token.substring(0, 8) }}...{{ app.token.substring(app.token.length - 4) }}</code>
            </p>
            <p class="app-last-ping">{{ $t('applications.lastPing') }}: {{ formatDate(app.lastUsed || '') }}</p>
          </div>
          <div class="app-actions">
            <button @click="copyToken(app.token)" class="copy-btn">{{ $t('applications.copyToken') }}</button>
            <button @click="editApplication(app)" class="edit-btn">{{ $t('common.edit') }}</button>
            <button @click="deleteApplication(app.id)" class="delete-btn">{{ $t('common.delete') }}</button>
          </div>
        </router-link>
      </div>

      <div v-if="!loading && applications.length === 0" class="empty-state">
        {{ $t('applications.noApplications') }}
      </div>

      <CreateApplicationModal
        v-if="showCreateModal"
        @close="showCreateModal = false"
        @created="reloadApplications"
      />
      <EditApplicationModal
        v-if="showEditModal && editingApplication"
        :application="editingApplication"
        @close="showEditModal = false"
        @updated="reloadApplications"
      />
    </div>
  </Layout>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Layout from '@/components/Layout.vue'
import ApplicationIcon from '@/components/ApplicationIcon.vue'
import CreateApplicationModal from '@/components/CreateApplicationModal.vue'
import EditApplicationModal from '@/components/EditApplicationModal.vue'
import { applicationApi } from '@/services/api'
import { showSuccess, showError } from '@/utils/errorHandler'
import type { Application } from '@/types'

const { t } = useI18n()

const applications = ref<Application[]>([])
const loading = ref(true)
const showCreateModal = ref(false)
const showEditModal = ref(false)
const editingApplication = ref<Application | null>(null)

const formatDate = (dateString: string) => {
  if (!dateString) return t('common.never')
  return new Date(dateString).toLocaleString()
}

const loadApplications = async () => {
  try {
    const res = await applicationApi.getApplications()
    applications.value = res.data || []
  } catch (err) {
    console.error('Failed to load applications:', err)
  } finally {
    loading.value = false
  }
}

const reloadApplications = async () => {
  loading.value = true
  await loadApplications()
}

const copyToken = async (token: string) => {
  try {
    await navigator.clipboard.writeText(token)
    showSuccess(t('applications.tokenCopied'))
  } catch (err: any) {
    console.error('Failed to copy token:', err)
    showError(err, t('applications.copyTokenError'))
  }
}

const editApplication = (app: Application) => {
  editingApplication.value = app
  showEditModal.value = true
}

const deleteApplication = async (id: number) => {
  if (confirm(t('applications.deleteConfirm'))) {
    try {
      await applicationApi.deleteApplication(id)
      showSuccess(t('applications.deleteSuccess'))
      await reloadApplications()
    } catch (err: any) {
      showError(err, t('applications.deleteError'))
    }
  }
}

const uploadIcon = async (appId: number, file: File) => {
  try {
    await applicationApi.uploadApplicationImage(appId, file)
    showSuccess(t('applications.iconUploaded'))
    await reloadApplications()
  } catch (err: any) {
    showError(err, t('applications.uploadIconError'))
  }
}

const deleteIcon = async (appId: number) => {
  try {
    await applicationApi.deleteApplicationImage(appId)
    showSuccess(t('applications.iconDeleted'))
    await reloadApplications()
  } catch (err: any) {
    showError(err, t('applications.deleteIconError'))
  }
}

onMounted(() => {
  loadApplications()
})
</script>

<style scoped>
.applications {
  max-width: 1200px;
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

.create-btn {
  padding: 0.5rem 1rem;
  background-color: #10b981;
  color: white;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  transition: background-color 0.2s;
}

.create-btn:hover {
  background-color: #059669;
}

.loading, .empty-state {
  text-align: center;
  color: #6b7280;
  padding: 3rem;
  font-size: 1rem;
}

.applications-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
  gap: 1.5rem;
}

.app-card {
  background: white;
  padding: 1.5rem;
  border-radius: 0.75rem;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  gap: 1rem;
  text-decoration: none;
  color: inherit;
  transition: transform 0.2s, box-shadow 0.2s;
}

.app-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
}

.app-header {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.app-icon-container {
  flex-shrink: 0;
}

.app-title-container {
  flex: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.app-title-container h3 {
  font-size: 1.125rem;
  font-weight: 600;
  color: #1f2937;
  margin: 0;
}

.app-priority {
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
}

.priority-0 { background: #dbeafe; color: #1e40af; }
.priority-1 { background: #f3f4f6; color: #374151; }
.priority-2 { background: #fef3c7; color: #92400e; }
.priority-3 { background: #fecaca; color: #991b1b; }

.app-description {
  color: #4b5563;
  font-size: 0.875rem;
  line-height: 1.5;
  margin: 0;
}

.app-info {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.app-token {
  font-size: 0.875rem;
  color: #6b7280;
  margin: 0;
  word-break: break-all;
}

.app-token code {
  background: #f3f4f6;
  padding: 0.125rem 0.25rem;
  border-radius: 0.25rem;
  font-family: 'Courier New', monospace;
  font-size: 0.8em;
}

.app-last-ping {
  font-size: 0.75rem;
  color: #9ca3af;
  margin: 0;
}

.app-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.copy-btn {
  padding: 0.375rem 0.75rem;
  background-color: #6366f1;
  color: white;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: background-color 0.2s;
}

.copy-btn:hover {
  background-color: #4f46e5;
}

.edit-btn {
  padding: 0.375rem 0.75rem;
  background-color: #3b82f6;
  color: white;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: background-color 0.2s;
}

.edit-btn:hover {
  background-color: #2563eb;
}

.delete-btn {
  padding: 0.375rem 0.75rem;
  background-color: #ef4444;
  color: white;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: background-color 0.2s;
}

.delete-btn:hover {
  background-color: #dc2626;
}

@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
  }

  .applications-grid {
    grid-template-columns: 1fr;
  }

  .app-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .app-actions {
    justify-content: stretch;
  }

  .app-actions button {
    flex: 1;
  }
}
</style>
