<template>
  <Layout>
    <div class="clients">
      <div class="page-header">
        <h1 class="page-title">{{ $t('common.clients') }}</h1>
        <button @click="showCreateModal = true" class="create-btn">{{ $t('clients.add') }}</button>
      </div>

      <div v-if="loading" class="loading">{{ $t('clients.loadingClients') }}</div>

      <div v-else class="clients-grid">
        <div v-for="client in clients" :key="client.id" class="client-card">
          <div class="client-header">
            <h3>{{ client.name }}</h3>
          </div>
          <div class="client-info">
            <p class="client-token">
              <strong>{{ $t('common.token') }}:</strong>
              <code>{{ client.token.substring(0, 8) }}...{{ client.token.substring(client.token.length - 4) }}</code>
            </p>
            <p class="client-last-ping">{{ $t('clients.lastUsed') }}: {{ formatDate(client.lastUsed || '') }}</p>
          </div>
          <div class="client-actions">
            <button @click="copyToken(client.token)" class="copy-btn">{{ $t('clients.copyToken') }}</button>
            <button @click="editClient(client)" class="edit-btn">{{ $t('common.edit') }}</button>
            <button @click="deleteClient(client.id)" class="delete-btn">{{ $t('common.delete') }}</button>
          </div>
        </div>
      </div>

      <div v-if="!loading && clients.length === 0" class="empty-state">
        {{ $t('clients.noClients') }}
      </div>

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
import Layout from '@/components/Layout.vue'
import { clientApi } from '@/services/api'
import CreateClientModal from '@/components/CreateClientModal.vue'
import EditClientModal from '@/components/EditClientModal.vue'
import { showSuccess, showError } from '@/utils/errorHandler'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import type { Client } from '@/types'

const { t } = useI18n()
const { confirm: confirmDialog } = useConfirmDialog()

const clients = ref<Client[]>([])
const loading = ref(true)
const showCreateModal = ref(false)
const showEditModal = ref(false)
const editingClient = ref<Client | null>(null)

const formatDate = (dateString: string) => {
  if (!dateString) return t('common.never')
  return new Date(dateString).toLocaleString()
}

const loadClients = async () => {
  try {
    const res = await clientApi.getClients()
    clients.value = res.data || []
  } catch (err) {
    console.error('Failed to load clients:', err)
  } finally {
    loading.value = false
  }
}

const reloadClients = async () => {
  loading.value = true
  await loadClients()
}

const copyToken = async (token: string) => {
  try {
    await navigator.clipboard.writeText(token)
    showSuccess(t('clients.tokenCopied'))
  } catch (err) {
    console.error('Failed to copy token:', err)
    showError(err as Error, t('common.unknownError'))
  }
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
      await clientApi.deleteClient(id)
      showSuccess(t('clients.deleteSuccess'))
      await reloadClients()
    } catch (err: any) {
      console.error('Failed to delete client:', err)
      showError(err, t('clients.deleteError'))
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

.clients-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
  gap: 1.5rem;
}

.client-card {
  background: white;
  padding: 1.5rem;
  border-radius: 0.75rem;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
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
  color: #1f2937;
  margin: 0;
}

.client-type {
  padding: 0.25rem 0.5rem;
  background: #f3f4f6;
  color: #6b7280;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
}

.client-info {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.client-token {
  font-size: 0.875rem;
  color: #6b7280;
  margin: 0;
  word-break: break-all;
}

.client-token code {
  background: #f3f4f6;
  padding: 0.125rem 0.25rem;
  border-radius: 0.25rem;
  font-family: 'Courier New', monospace;
  font-size: 0.8em;
}

.client-last-ping {
  font-size: 0.75rem;
  color: #9ca3af;
  margin: 0;
}

.client-actions {
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
</style>
