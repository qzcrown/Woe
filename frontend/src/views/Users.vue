<template>
  <Layout>
    <div class="users">
      <div class="page-header">
        <h1 class="page-title">{{ $t('common.users') }}</h1>
        <button @click="showCreateModal = true" class="create-btn">{{ $t('users.add') }}</button>
      </div>

      <div v-if="loading" class="loading">{{ $t('users.loadingUsers') }}</div>

      <div v-else class="users-list">
        <div v-for="user in users" :key="user.id" class="user-card">
          <div class="user-header">
            <div class="user-info">
              <UserAvatar :user="user" size="medium" :show-tooltip="true" />
              <div class="user-text">
                <h3>{{ user.nickname || user.name }}</h3>
                <p class="user-email">{{ user.email }}</p>
                <p class="user-role">{{ user.admin ? $t('users.administrator') : $t('users.user') }}</p>
                <p v-if="user.description" class="user-description">{{ user.description }}</p>
              </div>
            </div>
            <div class="user-actions">
              <button @click="toggleUserDetails(user.id)" class="toggle-btn">
                {{ expandedUsers.has(user.id) ? $t('users.hideDetails') : $t('users.showDetails') }}
              </button>
              <button @click="editUser(user)" class="edit-btn">{{ $t('common.edit') }}</button>
              <button @click="toggleUserDisabled(user)" :class="['disable-btn', user.disabled ? 'enabled' : 'disabled']">
                {{ user.disabled ? $t('common.enable') : $t('common.disable') }}
              </button>
              <button @click="deleteUser(user.id)" class="delete-btn">{{ $t('common.delete') }}</button>
            </div>
          </div>
          
          <div v-if="expandedUsers.has(user.id)" class="user-details">
            <div v-if="loadingDetails.has(user.id)" class="details-loading">
              {{ $t('common.loading') }}
            </div>
            <div v-else class="details-content">
              <!-- Applications -->
              <div class="detail-section">
                <h4>{{ $t('common.applications') }} ({{ getUserDetails(user.id)?.applications?.length || 0 }})</h4>
                <div v-if="getUserDetails(user.id)?.applications?.length" class="detail-list">
                  <div v-for="app in getUserDetails(user.id)?.applications" :key="app.id" class="detail-item">
                    <span class="item-name">{{ app.name }}</span>
                    <span class="item-desc">{{ app.description || $t('users.noDescription') }}</span>
                  </div>
                </div>
                <div v-else class="empty-detail">{{ $t('users.noApplications') }}</div>
              </div>

              <!-- Clients -->
              <div class="detail-section">
                <h4>{{ $t('common.clients') }} ({{ getUserDetails(user.id)?.clients?.length || 0 }})</h4>
                <div v-if="getUserDetails(user.id)?.clients?.length" class="detail-list">
                  <div v-for="client in getUserDetails(user.id)?.clients" :key="client.id" class="detail-item">
                    <span class="item-name">{{ client.name }}</span>
                    <span class="item-desc">{{ client.lastUsed ? $t('users.lastUsed') + ': ' + formatDate(client.lastUsed) : $t('users.neverUsed') }}</span>
                  </div>
                </div>
                <div v-else class="empty-detail">{{ $t('users.noClients') }}</div>
              </div>

              <!-- Plugins -->
              <div class="detail-section">
                <div class="detail-header">
                  <h4>{{ $t('common.plugins') }} ({{ getUserDetails(user.id)?.plugins?.length || 0 }})</h4>
                  <button
                    @click="openCreatePluginModal(user.id)"
                    class="add-plugin-small-btn"
                  >
                    {{ $t('plugins.addPlugin') }}
                  </button>
                </div>
                <div v-if="getUserDetails(user.id)?.plugins?.length" class="detail-list">
                  <div v-for="plugin in getUserDetails(user.id)?.plugins" :key="plugin.id" class="detail-item">
                    <div class="item-info">
                      <span class="item-name">{{ plugin.name }}</span>
                      <span :class="['item-status', plugin.enabled ? 'enabled' : 'disabled']">
                        {{ plugin.enabled ? $t('common.enabled') : $t('common.disabled') }}
                      </span>
                    </div>
                    <div class="item-actions">
                      <button
                        @click="openEditPluginModal(plugin)"
                        class="edit-plugin-small-btn"
                      >
                        {{ $t('common.edit') }}
                      </button>
                      <button
                        @click="deleteUserPlugin(user.id, plugin.id, plugin.name)"
                        :class="['delete-plugin-small-btn', { loading: deletingUserPlugin?.userId === user.id && deletingUserPlugin?.pluginId === plugin.id }]"
                        :disabled="deletingUserPlugin?.userId === user.id && deletingUserPlugin?.pluginId === plugin.id"
                      >
                        {{ $t('common.delete') }}
                      </button>
                    </div>
                  </div>
                </div>
                <div v-else class="empty-detail">{{ $t('users.noPlugins') }}</div>
              </div>

              <!-- Plugin Permissions -->
              <div class="detail-section plugin-permissions-section">
                <h4>{{ $t('users.pluginPermissions') }}</h4>
                <div class="plugin-permissions-list">
                  <label 
                    v-for="pluginPath in availablePlugins" 
                    :key="pluginPath" 
                    class="plugin-permission-item"
                  >
                    <input 
                      type="checkbox" 
                      :checked="userPermissions.get(user.id)?.has(pluginPath)"
                      @change="togglePluginPermission(user.id, pluginPath, $event)"
                    />
                    <span class="plugin-path">{{ getPluginDisplayName(pluginPath) }}</span>
                  </label>
                </div>
                <button 
                  @click="savePluginPermissions(user.id)" 
                  class="save-permissions-btn"
                  :disabled="savingPermissions.has(user.id)"
                >
                  {{ savingPermissions.has(user.id) ? $t('common.saving') : $t('common.save') }}
                </button>
              </div>
            </div>
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
      <CreatePluginModal
        :show="showCreatePluginModal"
        :targetUserId="selectedUserId"
        @close="showCreatePluginModal = false"
        @created="async () => {
          if (selectedUserId) {
            await loadUserDetails(selectedUserId)
          }
          showCreatePluginModal = false
        }"
      />
      <EditPluginModal
        :show="showEditPluginModal && editingPlugin !== null"
        :plugin="editingPlugin!"
        @close="showEditPluginModal = false"
        @updated="async () => {
          if (selectedUserId) {
            await loadUserDetails(selectedUserId)
          }
          showEditPluginModal = false
        }"
      />
    </div>
  </Layout>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Layout from '@/components/Layout.vue'
import CreateUserModal from '@/components/CreateUserModal.vue'
import EditUserModal from '@/components/EditUserModal.vue'
import CreatePluginModal from '@/components/CreatePluginModal.vue'
import EditPluginModal from '@/components/EditPluginModal.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import { userApi, pluginApi } from '@/services/api'
import { showSuccess, showError } from '@/utils/errorHandler'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import type { User, Application, Client, Plugin } from '@/types'

const { t } = useI18n()
const { confirm: confirmDialog } = useConfirmDialog()

interface UserDetails {
  applications: Application[]
  clients: Client[]
  plugins: Plugin[]
}

// Available builtin plugins
const availablePlugins = ['builtin/webhooker', 'builtin/displayer']

const users = ref<User[]>([])
const loading = ref(true)
const showCreateModal = ref(false)
const showEditModal = ref(false)
const editingUser = ref<User | null>(null)
const expandedUsers = ref<Set<number>>(new Set())
const loadingDetails = ref<Set<number>>(new Set())
const userDetailsCache = reactive<Map<number, UserDetails>>(new Map())
const userPermissions = reactive<Map<number, Set<string>>>(new Map())
const savingPermissions = ref<Set<number>>(new Set())
const showCreatePluginModal = ref(false)
const selectedUserId = ref<number | undefined>(undefined)
const deletingUserPlugin = ref<{ userId: number; pluginId: number } | null>(null)
const showEditPluginModal = ref(false)
const editingPlugin = ref<Plugin | null>(null)

const getPluginDisplayName = (modulePath: string): string => {
  const names: Record<string, string> = {
    'builtin/webhooker': 'Webhooker',
    'builtin/displayer': 'Displayer'
  }
  return names[modulePath] || modulePath
}

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
  userDetailsCache.clear()
  expandedUsers.value.clear()
  await loadUsers()
}

const editUser = (user: User) => {
  editingUser.value = user
  showEditModal.value = true
}

const deleteUser = async (id: number) => {
  const confirmed = await confirmDialog({
    title: t('common.confirmDialog.title'),
    message: t('users.deleteConfirm'),
    confirmText: t('common.confirmDialog.confirmButton'),
    cancelText: t('common.confirmDialog.cancelButton'),
    type: 'danger'
  })
  
  if (confirmed) {
    try {
      await userApi.deleteUser(id)
      showSuccess(t('users.deleteSuccess'))
      await reloadUsers()
    } catch (err: any) {
      console.error('Failed to delete user:', err)
      showError(err, t('users.deleteError'))
    }
  }
}

const toggleUserDisabled = async (user: User) => {
  const newDisabledStatus = !user.disabled
  const action = newDisabledStatus ? t('users.disable') : t('users.enable')
  const actionPast = newDisabledStatus ? t('users.disabled') : t('users.enabled')

  const confirmed = await confirmDialog({
    title: t('common.confirmDialog.title'),
    message: `${action} ${user.nickname || user.name}?`,
    confirmText: t('common.confirmDialog.confirmButton'),
    cancelText: t('common.confirmDialog.cancelButton'),
    type: 'warning'
  })

  if (!confirmed) {
    return
  }

  try {
    await userApi.setUserDisabled(user.id, newDisabledStatus)
    const index = users.value.findIndex(u => u.id === user.id)
    if (index !== -1) {
      users.value[index] = { ...user, disabled: newDisabledStatus }
    }
    showSuccess(`${user.nickname || user.name} ${actionPast}`)
  } catch (err: any) {
    console.error('Failed to toggle user disabled status:', err)
    showError(err, t('users.toggleDisabledError'))
  }
}

const toggleUserDetails = async (userId: number) => {
  if (expandedUsers.value.has(userId)) {
    expandedUsers.value.delete(userId)
    expandedUsers.value = new Set(expandedUsers.value)
  } else {
    expandedUsers.value.add(userId)
    expandedUsers.value = new Set(expandedUsers.value)
    
    if (!userDetailsCache.has(userId)) {
      await loadUserDetails(userId)
    }
  }
}

const loadUserDetails = async (userId: number) => {
  loadingDetails.value.add(userId)
  loadingDetails.value = new Set(loadingDetails.value)
  
  try {
    const [appsRes, clientsRes, pluginsRes, permissionsRes] = await Promise.all([
      userApi.getUserApplications(userId),
      userApi.getUserClients(userId),
      userApi.getUserPlugins(userId),
      userApi.getPluginPermissions(userId)
    ])
    
    userDetailsCache.set(userId, {
      applications: appsRes.data || [],
      clients: clientsRes.data || [],
      plugins: pluginsRes.data || []
    })
    
    // Store permissions as a Set for easy lookup
    userPermissions.set(userId, new Set(permissionsRes.data || []))
  } catch (err) {
    console.error('Failed to load user details:', err)
    userDetailsCache.set(userId, {
      applications: [],
      clients: [],
      plugins: []
    })
    userPermissions.set(userId, new Set())
  } finally {
    loadingDetails.value.delete(userId)
    loadingDetails.value = new Set(loadingDetails.value)
  }
}

const togglePluginPermission = (userId: number, pluginPath: string, event: Event) => {
  const checkbox = event.target as HTMLInputElement
  const permissions = userPermissions.get(userId) || new Set()
  
  if (checkbox.checked) {
    permissions.add(pluginPath)
  } else {
    permissions.delete(pluginPath)
  }
  
  userPermissions.set(userId, new Set(permissions))
}

const savePluginPermissions = async (userId: number) => {
  savingPermissions.value.add(userId)
  savingPermissions.value = new Set(savingPermissions.value)
  
  try {
    const permissions = userPermissions.get(userId) || new Set()
    await userApi.updatePluginPermissions(userId, Array.from(permissions))
    showSuccess(t('users.permissionsSaved'))
  } catch (err: any) {
    console.error('Failed to save plugin permissions:', err)
    showError(err, t('users.permissionsSaveError'))
  } finally {
    savingPermissions.value.delete(userId)
    savingPermissions.value = new Set(savingPermissions.value)
  }
}

const getUserDetails = (userId: number): UserDetails | undefined => {
  return userDetailsCache.get(userId)
}

const openCreatePluginModal = (userId: number) => {
  selectedUserId.value = userId
  showCreatePluginModal.value = true
}

const deleteUserPlugin = async (userId: number, pluginId: number, pluginName: string) => {
  const confirmed = await confirmDialog({
    title: t('common.confirmDialog.title'),
    message: t('plugins.deleteConfirm', { name: pluginName }),
    confirmText: t('common.confirmDialog.confirmButton'),
    cancelText: t('common.confirmDialog.cancelButton'),
    type: 'danger'
  })

  if (!confirmed) {
    return
  }

  deletingUserPlugin.value = { userId, pluginId }
  try {
    await pluginApi.deletePlugin(pluginId)
    showSuccess(t('plugins.deleteSuccess', { name: pluginName }))
    await loadUserDetails(userId)
  } catch (err: any) {
    showError(err, t('plugins.deleteError'))
  } finally {
    deletingUserPlugin.value = null
  }
}

const openEditPluginModal = (plugin: Plugin) => {
  editingPlugin.value = plugin
  showEditPluginModal.value = true
}

const formatDate = (dateString: string | null) => {
  if (!dateString) return ''
  return new Date(dateString).toLocaleString()
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

.users-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.user-card {
  background: white;
  border-radius: 0.75rem;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.user-header {
  padding: 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.user-text {
  display: flex;
  flex-direction: column;
}

.user-text h3 {
  font-size: 1.125rem;
  font-weight: 600;
  color: #1f2937;
  margin: 0 0 0.25rem 0;
}

.user-email {
  color: #6b7280;
  font-size: 0.875rem;
  margin: 0 0 0.25rem 0;
}

.user-role {
  color: #6b7280;
  font-size: 0.875rem;
  margin: 0 0 0.25rem 0;
}

.user-description {
  color: #4b5563;
  font-size: 0.875rem;
  margin: 0;
  font-style: italic;
}

.user-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.toggle-btn {
  padding: 0.375rem 0.75rem;
  background-color: #6366f1;
  color: white;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: background-color 0.2s;
}

.toggle-btn:hover {
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

.user-details {
  border-top: 1px solid #e5e7eb;
  padding: 1.5rem;
  background-color: #f9fafb;
}

.details-loading {
  text-align: center;
  color: #6b7280;
  padding: 1rem;
}

.details-content {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1.5rem;
}

.detail-section {
  background: white;
  border-radius: 0.5rem;
  padding: 1rem;
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
}

.detail-section h4 {
  font-size: 0.875rem;
  font-weight: 600;
  color: #374151;
  margin: 0 0 0.75rem 0;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #e5e7eb;
}

.detail-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.detail-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem;
  background-color: #f3f4f6;
  border-radius: 0.375rem;
}

.item-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.item-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
}

.item-name {
  font-weight: 500;
  color: #1f2937;
  font-size: 0.875rem;
}

.item-desc {
  color: #6b7280;
  font-size: 0.75rem;
}

.item-status {
  font-size: 0.75rem;
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
}

.item-status.enabled {
  background-color: #d1fae5;
  color: #065f46;
}

.item-status.disabled {
  background-color: #fee2e2;
  color: #991b1b;
}

.empty-detail {
  color: #9ca3af;
  font-size: 0.875rem;
  text-align: center;
  padding: 0.5rem;
}

.plugin-permissions-section {
  grid-column: 1 / -1;
}

.plugin-permissions-list {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 1rem;
}

.plugin-permission-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background-color: #f3f4f6;
  border-radius: 0.375rem;
  cursor: pointer;
  transition: background-color 0.2s;
}

.plugin-permission-item:hover {
  background-color: #e5e7eb;
}

.plugin-permission-item input[type="checkbox"] {
  width: 1rem;
  height: 1rem;
  cursor: pointer;
}

.plugin-path {
  font-size: 0.875rem;
  color: #374151;
}

.save-permissions-btn {
  padding: 0.5rem 1rem;
  background-color: #10b981;
  color: white;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: background-color 0.2s;
}

.save-permissions-btn:hover:not(:disabled) {
  background-color: #059669;
}

.save-permissions-btn:disabled {
  background-color: #9ca3af;
  cursor: not-allowed;
}

/* Plugin management styles in user details */
.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.detail-header h4 {
  margin: 0;
}

.add-plugin-small-btn {
  padding: 0.25rem 0.75rem;
  background-color: #10b981;
  color: white;
  border: none;
  border-radius: 0.25rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: background-color 0.2s;
}

.add-plugin-small-btn:hover {
  background-color: #059669;
}

.edit-plugin-small-btn {
  padding: 0.25rem 0.5rem;
  background-color: #3b82f6;
  color: white;
  border: none;
  border-radius: 0.25rem;
  cursor: pointer;
  font-size: 0.75rem;
  transition: background-color 0.2s;
  /* margin-right: 0.25rem;
  margin-right: auto; */
}

.edit-plugin-small-btn:hover {
  background-color: #2563eb;
}

.delete-plugin-small-btn {
  padding: 0.25rem 0.5rem;
  background-color: #f87171;
  color: white;
  border: none;
  border-radius: 0.25rem;
  cursor: pointer;
  font-size: 0.75rem;
  transition: background-color 0.2s;
}

.delete-plugin-small-btn:hover:not(:disabled) {
  background-color: #ef4444;
}

.delete-plugin-small-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.disable-btn {
  padding: 0.375rem 0.75rem;
  color: white;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: background-color 0.2s;
  &.enabled {
    background-color: #10b981;
    &:hover {
      background-color: #059669;
    }
  }
  &.disabled {
    background-color: #f59e0b;
    &:hover {
      background-color: #d97706;
    }
  }
}

@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
  }

  .user-header {
    flex-direction: column;
    gap: 1rem;
  }

  .user-actions {
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .details-content {
    grid-template-columns: 1fr;
  }
}
</style>