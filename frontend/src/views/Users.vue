<template>
  <Layout>
    <div class="users">
      <div class="page-header">
        <h1 class="page-title">{{ $t('common.users') }}</h1>
        <button @click="showCreateModal = true" class="create-btn">{{ $t('users.add') }}</button>
      </div>

      <div v-if="loading" class="loading">{{ $t('users.loadingUsers') }}</div>

      <div v-else class="users-grid">
        <div v-for="user in users" :key="user.id" class="user-card">
          <div class="user-info">
            <h3>{{ user.name }}</h3>
            <p class="user-role">{{ user.admin ? $t('users.administrator') : $t('users.user') }}</p>
          </div>
          <div class="user-actions">
            <button @click="editUser(user)" class="edit-btn">{{ $t('common.edit') }}</button>
            <button @click="deleteUser(user.id)" class="delete-btn">{{ $t('common.delete') }}</button>
          </div>
        </div>
      </div>

      <div v-if="!loading && users.length === 0" class="empty-state">
        {{ $t('users.noUsers') }}
      </div>

      <CreateUserModal
        v-if="showCreateModal"
        @close="showCreateModal = false"
        @created="reloadUsers"
      />
      <EditUserModal
        v-if="showEditModal && editingUser"
        :user="editingUser"
        @close="showEditModal = false"
        @updated="reloadUsers"
      />
    </div>
  </Layout>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Layout from '@/components/Layout.vue'
import CreateUserModal from '@/components/CreateUserModal.vue'
import EditUserModal from '@/components/EditUserModal.vue'
import { userApi } from '@/services/api'
import type { User } from '@/types'

const { t } = useI18n()

const users = ref<User[]>([])
const loading = ref(true)
const showCreateModal = ref(false)
const showEditModal = ref(false)
const editingUser = ref<User | null>(null)

const loadUsers = async () => {
  try {
    const res = await userApi.getUsers()
    users.value = res.data || []
  } catch (err) {
    console.error('Failed to load users:', err)
  } finally {
    loading.value = false
  }
}

const reloadUsers = async () => {
  loading.value = true
  await loadUsers()
}

const editUser = (user: User) => {
  editingUser.value = user
  showEditModal.value = true
}

const deleteUser = async (id: number) => {
  if (confirm(t('users.deleteConfirm'))) {
    try {
      await userApi.deleteUser(id)
      alert(t('users.deleteSuccess'))
      await reloadUsers()
    } catch (err: any) {
      console.error('Failed to delete user:', err)
      alert(t('users.deleteError', { error: err.errorDescription || t('common.unknownError') }))
    }
  }
}

onMounted(() => {
  loadUsers()
})
</script>

<style scoped>
.users {
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

.users-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1.5rem;
}

.user-card {
  background: white;
  padding: 1.5rem;
  border-radius: 0.75rem;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.user-info h3 {
  font-size: 1.125rem;
  font-weight: 600;
  color: #1f2937;
  margin: 0 0 0.5rem 0;
}

.user-role {
  color: #6b7280;
  font-size: 0.875rem;
  margin: 0.25rem 0;
}

.user-date {
  color: #9ca3af;
  font-size: 0.75rem;
  margin: 0.25rem 0;
}

.user-actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
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

  .users-grid {
    grid-template-columns: 1fr;
  }

  .user-card {
    flex-direction: column;
    gap: 1rem;
  }

  .user-actions {
    flex-direction: row;
    justify-content: flex-end;
  }
}
</style>
