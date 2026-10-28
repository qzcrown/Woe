<template>
  <Layout>
    <div class="users">
      <div class="page-header">
        <h1 class="page-title">{{ $t('common.users') }}</h1>
        <button @click="showCreateModal = true" class="create-btn">{{ $t('users.add') }}</button>
      </div>

      <div v-if="loading" class="loading-container">
        <LoadingSpinner :text="$t('users.loadingUsers')" />
      </div>

      <div v-else-if="listError" class="error-message">{{ listError }}</div>

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
              <button type="button" class="toggle-btn" @click="toggleUserDetails(user.id)"
                :aria-expanded="expandedUsers.has(user.id)">
                <ChevronUp v-if="expandedUsers.has(user.id)" :size="14" aria-hidden="true" />
                <ChevronDown v-else :size="14" aria-hidden="true" />
                <span>{{ expandedUsers.has(user.id) ? $t('users.hideDetails') : $t('users.showDetails') }}</span>
              </button>
              <button type="button" class="edit-btn" @click="editUser(user)">
                <Pencil :size="14" aria-hidden="true" />
                <span>{{ $t('common.edit') }}</span>
              </button>
              <button @click="toggleUserDisabled(user)" :class="['disable-btn', user.disabled ? 'enabled' : 'disabled']">
                {{ user.disabled ? $t('common.enable') : $t('common.disable') }}
              </button>
              <button type="button" class="delete-btn" @click="deleteUser(user.id)">
                <Trash2 :size="14" aria-hidden="true" />
                <span>{{ $t('common.delete') }}</span>
              </button>
            </div>
          </div>

          <div v-if="expandedUsers.has(user.id)" class="user-details">
            <div v-if="loadingDetails.has(user.id)" class="details-loading">
              {{ $t('common.loading') }}
            </div>
            <div v-else class="details-content">

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


              <div class="detail-section">
                <h4>{{ $t('common.clients') }} ({{ getUserDetails(user.id)?.clients?.length || 0 }})</h4>
                <div v-if="getUserDetails(user.id)?.clients?.length" class="detail-list">
                  <div v-for="client in getUserDetails(user.id)?.clients" :key="client.id" class="detail-item">
                    <span class="item-name">{{ client.name }}</span>
                    <span class="item-desc">{{ client.lastUsed ? $t('users.lastUsedAt', { time: formatDate(client.lastUsed) }) : $t('users.neverUsed') }}</span>
                  </div>
                </div>
                <div v-else class="empty-detail">{{ $t('users.noClients') }}</div>
              </div>


              <div class="detail-section">
                <div class="detail-header">
                  <h4>{{ $t('common.plugins') }} ({{ getUserDetails(user.id)?.plugins?.length || 0 }})</h4>
                  <button
                    type="button"
                    @click="openCreatePluginModal(user.id)"
                    class="add-plugin-small-btn"
                  >
                    <Plus :size="12" aria-hidden="true" />
                    <span>{{ $t('plugins.addPlugin') }}</span>
                  </button>
                </div>
                <div v-if="getUserDetails(user.id)?.plugins?.length" class="detail-list">
                  <div v-for="plugin in getUserDetails(user.id)?.plugins" :key="plugin.id" class="detail-item">
                    <div class="item-info">
                      <span class="item-name">{{ plugin.name }}</span>
                      <span :class="['item-status', plugin.enabled ? 'enabled' : 'disabled']">
                        {{ plugin.enabled ? $t('common.enabled') : $t('common.disabled') }}
                      </span>

                      <span
                        v-if="plugin.availability === 'unavailable'"
                        class="item-status unavailable"
                      >
                        {{ $t('plugins.unavailable') }}
                      </span>
                    </div>
                    <div class="item-actions">
                      <button
                        type="button"
                        @click="openEditPluginModal(plugin)"
                        class="edit-plugin-small-btn"
                      >
                        <Pencil :size="12" aria-hidden="true" />
                        <span>{{ $t('common.edit') }}</span>
                      </button>
                      <button
                        type="button"
                        @click="deleteUserPlugin(user.id, plugin.id, plugin.name)"
                        :class="['delete-plugin-small-btn', { loading: deletingUserPlugin?.userId === user.id && deletingUserPlugin?.pluginId === plugin.id }]"
                        :disabled="deletingUserPlugin?.userId === user.id && deletingUserPlugin?.pluginId === plugin.id"
                      >
                        <Trash2 :size="12" aria-hidden="true" />
                        <span>{{ $t('common.delete') }}</span>
                      </button>
                    </div>
                  </div>
                </div>
                <div v-else class="empty-detail">{{ $t('users.noPlugins') }}</div>
              </div>


              <div class="detail-section plugin-permissions-section">
                <h4>{{ $t('users.pluginPermissions') }}</h4>
                <div class="plugin-permissions-list">
                  <label
                    v-for="plugin in availablePlugins"
                    :key="plugin.modulePath"
                    class="plugin-permission-item"
                  >
                    <input
                      type="checkbox"
                      :checked="userPermissions.get(user.id)?.has(plugin.modulePath)"
                      @change="togglePluginPermission(user.id, plugin.modulePath, $event)"
                    />
                    <span class="plugin-path">{{ plugin.name }}</span>
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


              <template v-if="canManageQuotas(authStore.user) && adminPanels.length > 0">
                <div
                  v-for="panel in adminPanels"
                  :key="`${panel.modulePath}-${pluginInstancesRevision}`"
                  class="detail-section"
                >
                  <component
                    :is="panel.component"
                    :user="user"
                    :namespace="panel.namespace"
                    :host="adminUiHost"
                  />
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>

      <EmptyState
        v-if="!loading && !listError && users.length === 0"
        type="users"
        :title="$t('users.noUsers')"
        :description="$t('users.emptyDescription')"
      />

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
          // 实例增删会改变各管理面板可见的数据（如配额行），bump 触发面板重载
          bumpPluginInstancesRevision()
          showCreatePluginModal = false
        }"
      />
      <EditPluginModal
        v-if="editingPlugin"
        :show="showEditPluginModal && editingPlugin !== null"
        :plugin="editingPlugin"
        @close="showEditPluginModal = false"
        @updated="async () => {
          if (selectedUserId) {
            await loadUserDetails(selectedUserId)
          }
          // 实例启用状态变化会改变各管理面板可见的数据，bump 触发面板重载
          bumpPluginInstancesRevision()
          showEditPluginModal = false
        }"
      />
    </div>
  </Layout>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from '@lucide/vue'
import LoadingSpinner from '@/components/LoadingSpinner.vue'
import EmptyState from '@/components/EmptyState.vue'
import Layout from '@/components/Layout.vue'
import CreateUserModal from '@/components/CreateUserModal.vue'
import EditUserModal from '@/components/EditUserModal.vue'
import CreatePluginModal from '@/components/CreatePluginModal.vue'
import EditPluginModal from '@/components/EditPluginModal.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import { userApi, pluginApi } from '@/services/api'
import { withElevationRetry } from '@/services/auth'
import { isElevationCancelled } from '@/composables/useElevatedAction'
import { showSuccess, showError } from '@/utils/errorHandler'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { formatDate } from '@/utils/datetime'
import { canManageQuotas } from '@/utils/quota'
import { getPluginAdminPanels } from '@/plugins/catalog'
import { createPluginUiHost } from '@/plugins/host'
import { useAuthStore } from '@/stores/auth'
import type { User, Application, Client, Plugin, AvailablePlugin } from '@/types'
import type { PluginUiHost } from '@/plugins/types'

const { t } = useI18n()
const { confirm: confirmDialog } = useConfirmDialog()
const authStore = useAuthStore()

interface UserDetails {
  applications: Application[]
  clients: Client[]
  plugins: Plugin[]
}


const availablePlugins = ref<AvailablePlugin[]>([])


const loadAvailablePlugins = async () => {
  try {
    const res = await pluginApi.getAvailablePlugins(adminUiHost.requestOptions)
    if (!adminUiHost.isCurrent()) return
    availablePlugins.value = res.data
  } catch (err) {
    console.error('Failed to load available plugins:', err)
  }
}

const users = ref<User[]>([])
const loading = ref(true)
const listError = ref<string | null>(null)
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


const adminPanels = getPluginAdminPanels()
const adminUiHost: PluginUiHost = createPluginUiHost({ ownerId: authStore.user?.id ?? 0 })
adminUiHost.signal.addEventListener('abort', () => {
  showCreatePluginModal.value = false; showEditPluginModal.value = false; editingPlugin.value = null
  availablePlugins.value = []; userDetailsCache.clear(); userPermissions.clear()
  expandedUsers.value = new Set(); loadingDetails.value = new Set(); savingPermissions.value = new Set()
  deletingUserPlugin.value = null
}, { once: true })

const pluginInstancesRevision = ref(0)
const bumpPluginInstancesRevision = () => {
  pluginInstancesRevision.value += 1
}

const loadUsers = async () => {
  listError.value = null
  try {

    const res = await withElevationRetry(() => userApi.getUsers())
    users.value = res.data || []
  } catch (err) {
    if (isElevationCancelled(err)) return
    console.error('Failed to load users:', err)
    listError.value = t('users.loadError')
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

      await withElevationRetry(() => userApi.deleteUser(id))
      showSuccess(t('users.deleteSuccess'))
      await reloadUsers()
    } catch (err: any) {
      if (isElevationCancelled(err)) return
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
  if (!adminUiHost.isCurrent()) return
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
  if (!adminUiHost.isCurrent()) return
  loadingDetails.value.add(userId)
  loadingDetails.value = new Set(loadingDetails.value)

  try {
    const [appsRes, clientsRes, pluginsRes, permissionsRes] = await Promise.all([
      userApi.getUserApplications(userId, adminUiHost.requestOptions),
      userApi.getUserClients(userId, adminUiHost.requestOptions),
      userApi.getUserPlugins(userId, adminUiHost.requestOptions),
      userApi.getPluginPermissions(userId, adminUiHost.requestOptions)
    ])

    if (!adminUiHost.isCurrent()) return
    userDetailsCache.set(userId, {
      applications: appsRes.data || [],
      clients: clientsRes.data || [],
      plugins: pluginsRes.data || []
    })


    userPermissions.set(userId, new Set(permissionsRes.data || []))
  } catch (err) {
    if (!adminUiHost.isCurrent()) return
    console.error('Failed to load user details:', err)
    userDetailsCache.set(userId, {
      applications: [],
      clients: [],
      plugins: []
    })
    userPermissions.set(userId, new Set())
  } finally {
    if (!adminUiHost.isCurrent()) return
    loadingDetails.value.delete(userId)
    loadingDetails.value = new Set(loadingDetails.value)
  }
}

const togglePluginPermission = (userId: number, pluginPath: string, event: Event) => {
  if (!adminUiHost.isCurrent()) return
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
  if (!adminUiHost.isCurrent() || savingPermissions.value.has(userId)) return
  savingPermissions.value.add(userId)
  savingPermissions.value = new Set(savingPermissions.value)

  try {
    const permissions = userPermissions.get(userId) || new Set()
    await userApi.updatePluginPermissions(userId, Array.from(permissions), adminUiHost.requestOptions)
    if (!adminUiHost.isCurrent()) return
    adminUiHost.notify.success(t('users.permissionsSaved'))
  } catch (err: any) {
    adminUiHost.notify.error(err, t('users.permissionsSaveError'))
  } finally {
    if (!adminUiHost.isCurrent()) return
    savingPermissions.value.delete(userId)
    savingPermissions.value = new Set(savingPermissions.value)
  }
}

const getUserDetails = (userId: number): UserDetails | undefined => {
  return userDetailsCache.get(userId)
}

const openCreatePluginModal = (userId: number) => {
  selectedUserId.value = userId
  if (!adminUiHost.isCurrent()) return
  showCreatePluginModal.value = true
}

const deleteUserPlugin = async (userId: number, pluginId: number, pluginName: string) => {
  if (!adminUiHost.isCurrent()) return
  const confirmed = await confirmDialog({
    title: t('common.confirmDialog.title'),
    message: t('plugins.deleteConfirm', { name: pluginName }),
    confirmText: t('common.confirmDialog.confirmButton'),
    cancelText: t('common.confirmDialog.cancelButton'),
    type: 'danger'
  })

  if (!confirmed || !adminUiHost.isCurrent()) return

  deletingUserPlugin.value = { userId, pluginId }
  try {
    if (!adminUiHost.isCurrent()) return
    await pluginApi.deletePlugin(pluginId, adminUiHost.requestOptions)
    if (!adminUiHost.isCurrent()) return
    showSuccess(t('plugins.deleteSuccess', { name: pluginName }))
    await loadUserDetails(userId)
    if (!adminUiHost.isCurrent()) return

    bumpPluginInstancesRevision()
  } catch (err: any) {
    adminUiHost.notify.error(err, t('plugins.deleteError'))
  } finally {
    if (adminUiHost.isCurrent()) deletingUserPlugin.value = null
  }
}

const openEditPluginModal = (plugin: Plugin) => {
  if (!adminUiHost.isCurrent()) return
  editingPlugin.value = plugin
  showEditPluginModal.value = true
}

onMounted(async () => {
  await loadUsers()
  await loadAvailablePlugins()
})

onUnmounted(() => {
  adminUiHost.dispose()
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

.users-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.user-card {
  background: var(--color-bg-primary);
  border-radius: 0.75rem;
  box-shadow: var(--shadow-sm);
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
  color: var(--color-text-primary);
  margin: 0 0 0.25rem 0;
}

.user-email {
  color: var(--color-text-tertiary);
  font-size: 0.875rem;
  margin: 0 0 0.25rem 0;
}

.user-role {
  color: var(--color-text-tertiary);
  font-size: 0.875rem;
  margin: 0 0 0.25rem 0;
}

.user-description {
  color: var(--color-text-secondary);
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
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.75rem;
  background-color: var(--color-primary);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: var(--transition-interactive);
}

.toggle-btn:hover {
  background-color: var(--color-primary-hover);
}

.edit-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.75rem;
  background-color: var(--color-primary);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: var(--transition-interactive);
}

.edit-btn:hover {
  background-color: var(--color-primary-hover);
}

.delete-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.75rem;
  background-color: var(--color-error);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: var(--transition-interactive);
}

.delete-btn:hover {
  background-color: var(--color-error-hover);
}

.user-details {
  border-top: 1px solid var(--color-border-primary);
  padding: 1.5rem;
  background-color: var(--color-bg-tertiary);
}

.details-loading {
  text-align: center;
  color: var(--color-text-tertiary);
  padding: 1rem;
}

.details-content {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1.5rem;
}

.detail-section {
  background: var(--color-bg-primary);
  border-radius: 0.5rem;
  padding: 1rem;
  box-shadow: var(--shadow-sm);
}

.detail-section h4 {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin: 0 0 0.75rem 0;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--color-border-primary);
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
  background-color: var(--color-bg-hover);
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
  color: var(--color-text-primary);
  font-size: 0.875rem;
}

.item-desc {
  color: var(--color-text-tertiary);
  font-size: 0.75rem;
}

.item-status {
  font-size: 0.75rem;
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
}

.item-status.enabled {
  background-color: var(--color-success-bg);
  color: var(--color-success-text);
}

.item-status.disabled {
  background-color: var(--color-error-bg);
  color: var(--color-priority-emergency-text);
}


.item-status.unavailable {
  background-color: var(--color-warning-bg, rgba(255, 193, 7, 0.15));
  color: var(--color-warning-text, #b45309);
}

.empty-detail {
  color: var(--color-text-muted);
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
  background-color: var(--color-bg-hover);
  border-radius: 0.375rem;
  cursor: pointer;
  transition: var(--transition-interactive);
}

.plugin-permission-item:hover {
  background-color: var(--color-bg-active);
}

.plugin-permission-item input[type="checkbox"] {
  width: 1rem;
  height: 1rem;
  cursor: pointer;
}

.plugin-path {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
}

.save-permissions-btn {
  padding: 0.5rem 1rem;
  background-color: var(--color-success);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: var(--transition-interactive);
}

.save-permissions-btn:hover:not(:disabled) {
  background-color: var(--color-success-hover);
}

.save-permissions-btn:disabled {
  background-color: var(--color-text-muted);
  cursor: not-allowed;
}


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
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.75rem;
  background-color: var(--color-success);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.25rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: var(--transition-interactive);
}

.add-plugin-small-btn:hover {
  background-color: var(--color-success-hover);
}

.edit-plugin-small-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.5rem;
  background-color: var(--color-primary);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.25rem;
  cursor: pointer;
  font-size: 0.75rem;
  transition: var(--transition-interactive);
}

.edit-plugin-small-btn:hover {
  background-color: var(--color-primary-hover);
}

.delete-plugin-small-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.5rem;
  background-color: var(--color-error);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.25rem;
  cursor: pointer;
  font-size: 0.75rem;
  transition: var(--transition-interactive);
}

.delete-plugin-small-btn:hover:not(:disabled) {
  background-color: var(--color-error);
}

.delete-plugin-small-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.disable-btn {
  padding: 0.375rem 0.75rem;
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: var(--transition-interactive);
}
.disable-btn.enabled {
  background-color: var(--color-success);
}
.disable-btn.enabled:hover {
  background-color: var(--color-success-hover);
}
.disable-btn.disabled {
  background-color: var(--color-warning);
}
.disable-btn.disabled:hover {
  background-color: var(--color-warning-hover);
}


.toggle-btn:focus-visible,
.edit-btn:focus-visible,
.delete-btn:focus-visible,
.add-plugin-small-btn:focus-visible,
.edit-plugin-small-btn:focus-visible,
.delete-plugin-small-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
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

.error-message {
  background-color: var(--color-error-bg);
  color: var(--color-error);
  padding: 1rem;
  border-radius: 0.375rem;
  margin-bottom: 1rem;
  border: 1px solid var(--color-error);
}
</style>