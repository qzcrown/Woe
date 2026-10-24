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
                    <span class="item-desc">{{ client.lastUsed ? $t('users.lastUsed') + ': ' + formatDate(client.lastUsed) : $t('users.neverUsed') }}</span>
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


              <div v-if="canManageQuotas(authStore.user) && getQuota(user.id)" class="detail-section ai-quota-section">
                <h4>{{ $t('users.aiQuota.title') }}</h4>
                <div class="ai-quota-grid">
                  <div class="ai-quota-item">
                    <span class="ai-quota-label">{{ $t('users.aiQuota.defaultLimit') }}</span>
                    <span class="ai-quota-value">{{ getQuota(user.id)?.defaultLimit }}</span>
                  </div>
                  <div class="ai-quota-item">
                    <span class="ai-quota-label">{{ $t('users.aiQuota.overrideLimit') }}</span>
                    <span class="ai-quota-value">
                      {{ getQuota(user.id)?.overrideLimit === null
                        ? $t('users.aiQuota.inherited')
                        : getQuota(user.id)?.overrideLimit }}
                    </span>
                  </div>
                  <div class="ai-quota-item">
                    <span class="ai-quota-label">{{ $t('users.aiQuota.effectiveLimit') }}</span>
                    <span class="ai-quota-value">
                      {{ isQuotaDisabled(getQuota(user.id)?.effectiveLimit ?? 0)
                        ? $t('users.aiQuota.disabled')
                        : getQuota(user.id)?.effectiveLimit }}
                    </span>
                  </div>
                  <div class="ai-quota-item">
                    <span class="ai-quota-label">{{ $t('users.aiQuota.usageToday') }}</span>
                    <span class="ai-quota-value">{{ getQuota(user.id)?.usageToday }}</span>
                  </div>
                  <div class="ai-quota-item">
                    <span class="ai-quota-label">{{ $t('users.aiQuota.source') }}</span>
                    <span class="ai-quota-value">{{ $t(quotaSourceKey(getQuota(user.id)?.source ?? 'default')) }}</span>
                  </div>
                </div>
                <div class="ai-quota-actions">
                  <input
                    class="ai-quota-input"
                    type="number"
                    min="0"
                    step="1"
                    :value="quotaInputs[user.id] ?? ''"
                    :placeholder="$t('users.aiQuota.limitPlaceholder')"
                    @input="updateQuotaInput(user.id, $event)"
                  />
                  <button
                    type="button"
                    class="ai-quota-save-btn"
                    :disabled="quotaSaving.has(user.id)"
                    @click="saveQuota(user.id)"
                  >
                    {{ quotaSaving.has(user.id) ? $t('common.saving') : $t('users.aiQuota.set') }}
                  </button>
                  <button
                    type="button"
                    class="ai-quota-clear-btn"
                    :disabled="quotaSaving.has(user.id)"
                    @click="clearQuota(user.id)"
                  >
                    {{ $t('users.aiQuota.clear') }}
                  </button>
                </div>
                <p class="ai-quota-hint">{{ $t('users.aiQuota.zeroHint') }}</p>
                <p v-if="quotaErrors[user.id]" class="ai-quota-error">{{ quotaErrors[user.id] }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="quotaLoadError" class="ai-quota-load-error">
        {{ quotaLoadError }}
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
          // 新增实例可能新增/移除「已启用 AI 任务插件」，配额区块要跟着刷新
          await loadAiQuotas()
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
          // 编辑可能启用/停用 AI 任务插件 实例，配额区块要跟着刷新
          await loadAiQuotas()
          showEditPluginModal = false
        }"
      />
    </div>
  </Layout>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from '@lucide/vue'
import Layout from '@/components/Layout.vue'
import CreateUserModal from '@/components/CreateUserModal.vue'
import EditUserModal from '@/components/EditUserModal.vue'
import CreatePluginModal from '@/components/CreatePluginModal.vue'
import EditPluginModal from '@/components/EditPluginModal.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import { userApi, pluginApi, adminQuotaApi } from '@/services/api'
import { withElevationRetry } from '@/services/auth'
import { isElevationCancelled } from '@/composables/useElevatedAction'
import { showSuccess, showError } from '@/utils/errorHandler'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { formatDate } from '@/utils/datetime'
import { canManageQuotas, isQuotaDisabled, parseQuotaLimitInput, quotaInputErrorKey, quotaSourceKey } from '@/utils/quota'
import { useAuthStore } from '@/stores/auth'
import type { User, Application, Client, Plugin, AvailablePlugin, AiQuotaUser, ApiError } from '@/types'

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
    const res = await pluginApi.getAvailablePlugins()
    availablePlugins.value = res.data
  } catch (err) {
    console.error('Failed to load available plugins:', err)
  }
}

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


const aiQuotas = reactive(new Map<number, AiQuotaUser>())
const quotaInputs = reactive<Record<number, string>>({})
const quotaSaving = ref<Set<number>>(new Set())
const quotaErrors = reactive<Record<number, string>>({})
const quotaLoadError = ref<string | null>(null)

const getQuota = (userId: number): AiQuotaUser | undefined => aiQuotas.get(userId)

const loadAiQuotas = async () => {
  if (!canManageQuotas(authStore.user)) return
  try {
    const response = await adminQuotaApi.list()
    aiQuotas.clear()
    for (const quota of response.data?.users ?? []) {
      aiQuotas.set(quota.userId, quota)
      quotaInputs[quota.userId] = quota.overrideLimit === null ? '' : String(quota.overrideLimit)
    }
    quotaLoadError.value = null
  } catch (err) {
    console.error('Failed to load AI quotas:', err)
    quotaLoadError.value = t('users.aiQuota.loadError')
  }
}

const updateQuotaInput = (userId: number, event: Event) => {
  quotaInputs[userId] = (event.target as HTMLInputElement).value
  delete quotaErrors[userId]
}

const setQuotaSaving = (userId: number, saving: boolean) => {
  const next = new Set(quotaSaving.value)
  if (saving) next.add(userId)
  else next.delete(userId)
  quotaSaving.value = next
}

const quotaErrorText = (err: unknown): string => {
  const status = (err as ApiError | undefined)?.statusCode
  return status === 503 ? t('users.aiQuota.unavailable') : t('users.aiQuota.saveError')
}





const applyQuotaOverride = (userId: number, limit: number | null) => {
  const current = aiQuotas.get(userId)
  if (!current) return
  aiQuotas.set(userId, {
    ...current,
    overrideLimit: limit,
    effectiveLimit: limit === null ? current.defaultLimit : limit,
    source: limit === null ? 'default' : 'override'
  })
}

const saveQuota = async (userId: number) => {
  const parsed = parseQuotaLimitInput(quotaInputs[userId] ?? '')
  if (parsed.status !== 'ok') {

    quotaErrors[userId] = t(quotaInputErrorKey(parsed.status))
    return
  }

  setQuotaSaving(userId, true)
  delete quotaErrors[userId]
  try {
    await adminQuotaApi.setLimit(userId, parsed.limit)
    applyQuotaOverride(userId, parsed.limit)
    quotaInputs[userId] = String(parsed.limit)
    showSuccess(t('users.aiQuota.saveSuccess'))
  } catch (err) {
    console.error('Failed to update AI quota:', err)
    quotaErrors[userId] = quotaErrorText(err)
  } finally {
    setQuotaSaving(userId, false)
  }
}

const clearQuota = async (userId: number) => {
  setQuotaSaving(userId, true)
  delete quotaErrors[userId]
  try {
    await adminQuotaApi.clearLimit(userId)
    applyQuotaOverride(userId, null)
    quotaInputs[userId] = ''
    showSuccess(t('users.aiQuota.saveSuccess'))
  } catch (err) {
    console.error('Failed to clear AI quota:', err)
    quotaErrors[userId] = quotaErrorText(err)
  } finally {
    setQuotaSaving(userId, false)
  }
}

const loadUsers = async () => {
  try {

    const res = await withElevationRetry(() => userApi.getUsers())
    users.value = res.data || []
  } catch (err) {
    if (isElevationCancelled(err)) return
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

    await loadAiQuotas()
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

onMounted(async () => {
  await loadUsers()
  await loadAvailablePlugins()
  await loadAiQuotas()
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
  transition: var(--theme-transition);
}

.create-btn:hover {
  background-color: var(--color-success-hover);
}

.loading, .empty-state {
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
  background-color: #6366f1;
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: var(--theme-transition);
}

.toggle-btn:hover {
  background-color: #4f46e5;
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
  transition: var(--theme-transition);
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
  transition: var(--theme-transition);
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
  background-color: #d1fae5;
  color: #065f46;
}

.item-status.disabled {
  background-color: #fee2e2;
  color: #991b1b;
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
  transition: var(--theme-transition);
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
  transition: var(--theme-transition);
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
  transition: var(--theme-transition);
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
  transition: var(--theme-transition);
}

.edit-plugin-small-btn:hover {
  background-color: var(--color-primary-hover);
}

.delete-plugin-small-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.5rem;
  background-color: #f87171;
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.25rem;
  cursor: pointer;
  font-size: 0.75rem;
  transition: var(--theme-transition);
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
  transition: var(--theme-transition);
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


.ai-quota-section {
  border-top: 1px solid var(--color-border-primary);
  padding-top: 1rem;
}

.ai-quota-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.75rem;
  margin: 0.75rem 0;
}

.ai-quota-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.5rem 0.625rem;
  background: var(--color-bg-hover);
  border-radius: 0.375rem;
}

.ai-quota-label {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
}

.ai-quota-value {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.ai-quota-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.ai-quota-input {
  width: 9rem;
  padding: 0.375rem 0.5rem;
  border: 1px solid var(--color-border-secondary);
  border-radius: 0.375rem;
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  font-size: 0.8125rem;
}

.ai-quota-save-btn,
.ai-quota-clear-btn {
  padding: 0.375rem 0.75rem;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.8125rem;
  font-weight: 500;
  transition: var(--theme-transition);
}

.ai-quota-save-btn {
  background-color: var(--color-primary);
  color: var(--color-text-inverse);
}

.ai-quota-save-btn:hover:not(:disabled) {
  background-color: var(--color-primary-hover);
}

.ai-quota-clear-btn {
  background-color: var(--color-bg-hover);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border-secondary);
}

.ai-quota-save-btn:disabled,
.ai-quota-clear-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.ai-quota-hint {
  margin: 0.5rem 0 0;
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
}

.ai-quota-error,
.ai-quota-load-error {
  margin: 0.5rem 0 0;
  font-size: 0.8125rem;
  color: var(--color-error);
}

.ai-quota-load-error {
  padding: 0.75rem 1rem;
  background: var(--color-bg-hover);
  border-radius: 0.375rem;
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