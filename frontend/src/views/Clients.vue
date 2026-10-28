<template>
  <Layout>
    <div class="clients">
      <div class="page-header">
        <h1 class="page-title">{{ $t('common.clients') }}</h1>
        <button @click="showCreateModal = true" class="create-btn">{{ $t('clients.add') }}</button>
      </div>

      <div v-if="loading" class="loading-container">
        <LoadingSpinner :text="$t('clients.loadingClients')" />
      </div>

      <div v-else-if="listError" class="error-message">{{ listError }}</div>

      <div v-else class="clients-grid">
        <div v-for="client in clients" :key="client.id" class="client-card">
          <div class="client-header">
            <h3>{{ client.name }}</h3>
          </div>
          <div class="client-info">


            <p class="client-detail">
              <strong>{{ $t('clients.platform') }}:</strong>
              <span class="platform-badge">{{ getPlatformText(client.platform) }}</span>
            </p>
            <p v-if="client.deviceModel" class="client-detail">
              <strong>{{ $t('clients.deviceModel') }}:</strong>
              <span>{{ client.deviceModel }}</span>
            </p>
            <p class="client-detail">
              <strong>{{ $t('clients.tokenStatus') }}:</strong>
              <span class="status-tag" :class="`status-${client.tokenStatus || 'active'}`">
                {{ $t(`clients.status.${client.tokenStatus || 'active'}`) }}
              </span>
            </p>
            <p class="client-last-ping">{{ $t('clients.lastUsed') }}: {{ formatDate(client.lastUsed || '') || $t('common.never') }}</p>
          </div>
          <div class="client-actions">
            <button type="button" class="edit-btn" @click="editClient(client)">
              <Pencil :size="14" aria-hidden="true" />
              <span>{{ $t('common.edit') }}</span>
            </button>
            <button type="button" class="delete-btn" @click="deleteClient(client.id)">
              <Trash2 :size="14" aria-hidden="true" />
              <span>{{ $t('common.delete') }}</span>
            </button>
          </div>
        </div>
      </div>

      <EmptyState
        v-if="!loading && !listError && clients.length === 0"
        type="clients"
        :title="$t('clients.noClients')"
        :description="$t('clients.emptyDescription')"
      />

      <CreateClientModal
        v-if="showCreateModal"
        @close="showCreateModal = false"
        @created="reloadClients"
      />
      <EditClientModal
        v-if="showEditModal && editingClient"
        :client="editingClient"
        @close="showEditModal = false"
        @updated="reloadClients"
      />
    </div>
  </Layout>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Pencil, Trash2 } from '@lucide/vue'
import LoadingSpinner from '@/components/LoadingSpinner.vue'
import EmptyState from '@/components/EmptyState.vue'
import Layout from '@/components/Layout.vue'
import { clientApi } from '@/services/api'
import CreateClientModal from '@/components/CreateClientModal.vue'
import EditClientModal from '@/components/EditClientModal.vue'
import { showSuccess, showError } from '@/utils/errorHandler'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { formatDate } from '@/utils/datetime'
import { useElevatedAction, isElevationCancelled } from '@/composables/useElevatedAction'
import { getClientPlatformLabels } from '@/plugins/catalog'
import type { Client } from '@/types'

const { t } = useI18n()
const { confirm: confirmDialog } = useConfirmDialog()
const { withElevation } = useElevatedAction()

const clients = ref<Client[]>([])
const loading = ref(true)
const listError = ref<string | null>(null)
const showCreateModal = ref(false)
const showEditModal = ref(false)
const editingClient = ref<Client | null>(null)






const clientPlatformLabels = getClientPlatformLabels()

const getPlatformText = (platform?: string): string => {
  if (platform === 'web') return 'Web'
  if (!platform || platform === 'unknown') return t('clients.unknown')
  const labelKey = clientPlatformLabels[platform]
  return labelKey === undefined ? t('clients.platformUnavailable') : t(labelKey)
}

const loadClients = async () => {
  listError.value = null
  try {
    const res = await clientApi.getClients()
    clients.value = res.data || []
  } catch (err) {
    console.error('Failed to load clients:', err)
    listError.value = t('clients.loadError')
  } finally {
    loading.value = false
  }
}

const reloadClients = async () => {
  loading.value = true
  await loadClients()
}

const editClient = (client: Client) => {
  editingClient.value = client
  showEditModal.value = true
}

const deleteClient = async (id: number) => {
  const confirmed = await confirmDialog({
    title: t('common.confirmDialog.title'),
    message: t('clients.deleteConfirm'),
    confirmText: t('common.confirmDialog.confirmButton'),
    cancelText: t('common.confirmDialog.cancelButton'),
    type: 'danger'
  })

  if (confirmed) {
    try {

      await withElevation(() => clientApi.deleteClient(id))
      showSuccess(t('clients.deleteSuccess'))
      await reloadClients()
    } catch (err: any) {

      if (!isElevationCancelled(err)) {
        console.error('Failed to delete client:', err)
        showError(err, t('clients.deleteError'))
      }
    }
  }
}

onMounted(() => {
  loadClients()
})
</script>

<style scoped>
.clients {
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
  color: var(--color-text-primary);
  margin: 0;
}

.create-btn {
  padding: 0.5rem 1rem;
  background-color: var(--color-success);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  transition: var(--transition-interactive);
}

.create-btn:hover {
  background-color: var(--color-success-hover);
}

.loading-container {
  text-align: center;
  color: var(--color-text-tertiary);
  padding: 3rem;
  font-size: 1rem;
}

.clients-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
  gap: 1.5rem;
}

.client-card {
  background: var(--color-bg-primary);
  padding: 1.5rem;
  border-radius: 0.75rem;
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.client-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.client-header h3 {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.client-type {
  padding: 0.25rem 0.5rem;
  background: var(--color-bg-hover);
  color: var(--color-text-tertiary);
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
}

.client-info {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.client-detail {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.platform-badge {
  padding: 0.125rem 0.5rem;
  background: var(--color-bg-hover);
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
}

.status-tag {
  padding: 0.125rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
}

.status-active {
  background: var(--color-success-bg);
  color: var(--color-success-text);
}

.status-inactive {
  background: var(--color-warning-bg);
  color: var(--color-warning-hover);
}

.status-invalid {
  background: var(--color-error-bg);
  color: var(--color-error);
}

.status-expired {
  background: var(--color-priority-normal-bg);
  color: var(--color-text-muted);
}

.client-last-ping {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  margin: 0;
}

.client-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.client-actions button {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.75rem;
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: var(--transition-interactive);
}

.edit-btn {
  background-color: var(--color-primary);
}

.edit-btn:hover {
  background-color: var(--color-primary-hover);
}

.delete-btn {
  background-color: var(--color-error);
}

.delete-btn:hover {
  background-color: var(--color-error-hover);
}


.client-actions button:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
  }

  .clients-grid {
    grid-template-columns: 1fr;
  }

  .client-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .client-actions {
    justify-content: stretch;
  }

  .client-actions button {
    flex: 1;
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
</style>
