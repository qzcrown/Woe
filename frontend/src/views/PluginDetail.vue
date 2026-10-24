<template>
  <Layout>
    <div class="plugin-detail">
      <div v-if="loading" class="loading-container">
        <LoadingSpinner :text="$t('pluginDetail.loadingDetails')" />
      </div>

      <div v-else-if="error" class="error-container">
        <div class="error-message">
          <h3>{{ $t('plugins.loadError') }}</h3>
          <p>{{ error }}</p>
          <button @click="loadPlugin" class="retry-btn">{{ $t('pluginDetail.retry') }}</button>
        </div>
      </div>

      <div v-else-if="plugin" class="plugin-content">
        <div class="plugin-header">
          <PluginIcon
            :name="plugin.name"
            :icon="plugin.icon"
            size="large"
            :show-upload-overlay="true"
            :show-delete-button="true"
            :uploading="uploadingIcon"
            @upload="uploadIcon"
            @delete="deleteIcon"
          />

          <div class="plugin-info">
            <div v-if="!editingName" class="plugin-name-display">
              <h1 class="plugin-name">{{ plugin.name }}</h1>
              <button @click="startEditingName" class="edit-name-btn" :title="$t('common.edit')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
              </button>
            </div>
            <div v-else class="plugin-name-edit">
              <input
                v-model="editedName"
                @keyup.enter="saveName"
                @keyup.esc="cancelEditName"
                class="name-input"
                ref="nameInput"
              />
              <button @click="saveName" :disabled="!editedName || savingName" class="save-btn">
                <LoadingSpinner v-if="savingName" size="small" variant="dots" />
                <span v-else>{{ $t('common.save') }}</span>
              </button>
              <button @click="cancelEditName" class="cancel-btn">{{ $t('common.cancel') }}</button>
            </div>
            <div class="plugin-status" :class="{ 'status-enabled': plugin.enabled }">
              <span class="status-indicator"></span>
              {{ plugin.enabled ? $t('common.enabled') : $t('common.disabled') }}
            </div>

            <div class="plugin-meta">
              <div v-if="plugin.author" class="meta-item">
                <span class="meta-label">{{ $t('plugins.author') }}:</span>
                <span class="meta-value">{{ plugin.author }}</span>
              </div>

              <div v-if="plugin.license" class="meta-item">
                <span class="meta-label">{{ $t('plugins.license') }}:</span>
                <span class="meta-value">{{ plugin.license }}</span>
              </div>

              <div v-if="plugin.website" class="meta-item">
                <span class="meta-label">{{ $t('plugins.website') }}:</span>
                <a :href="plugin.website" target="_blank" class="meta-link">
                  {{ plugin.website }}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                    <polyline points="15 3 21 12 9 3 21"></polyline>
                  </svg>
                </a>
              </div>

              <div class="meta-item">
                <span class="meta-label">{{ $t('pluginDetail.modulePath') }}:</span>
                <span class="meta-value">{{ plugin.modulePath }}</span>
              </div>
            </div>

            <div class="plugin-actions">
              <button
                @click="togglePlugin"
                :class="['toggle-btn', plugin.enabled ? 'disable-btn' : 'enable-btn']"
                :disabled="togglingPlugin"
              >
                <LoadingSpinner v-if="togglingPlugin" size="small" variant="dots" />
                <span v-else>{{ plugin.enabled ? $t('common.disable') : $t('common.enable') }}</span>
              </button>
            </div>
          </div>
        </div>

        <div class="plugin-sections">

          <div v-if="plugin.capabilities && plugin.capabilities.length" class="section">
            <h2 class="section-title">{{ $t('plugins.capabilities') }}</h2>
            <div class="capabilities-list">
              <span v-for="capability in plugin.capabilities" :key="capability" class="capability-tag">
                {{ capability }}
              </span>
            </div>
          </div>


          <div class="section">
            <div class="section-header">
              <h2 class="section-title">{{ $t('pluginDetail.configuration') }}</h2>
              <div class="config-actions">
                <button
                  @click="editMode ? cancelEdit() : startEdit()"
                  :class="['config-mode-btn', editMode ? 'cancel-btn' : 'edit-btn']"
                >
                  {{ editMode ? $t('common.cancel') : $t('common.edit') }}
                </button>
                <button
                  v-if="editMode"
                  @click="saveConfig"
                  :disabled="savingConfig"
                  class="save-btn"
                >
                  <LoadingSpinner v-if="savingConfig" size="small" variant="dots" />
                  <span v-else>{{ $t('common.save') }}</span>
                </button>
              </div>
            </div>

            <div v-if="!editMode && config" class="config-display">
              <pre class="config-content">{{ config }}</pre>
            </div>

            <div v-else-if="editMode" class="config-editor">
              <textarea
                v-model="configText"
                class="config-textarea"
                :placeholder="configExample || 'Enter YAML configuration...'"
                spellcheck="false"
              ></textarea>
            </div>

            <div v-if="!editMode && !config" class="no-config">
              <p>{{ $t('pluginDetail.noConfig') }}</p>
            </div>
          </div>


          <div v-if="hasDisplay" class="section">
            <div class="section-header">
              <h2 class="section-title">{{ $t('pluginDetail.pluginDisplay') }}</h2>
              <button
                @click="refreshDisplay"
                :disabled="loadingDisplay"
                class="refresh-btn"
              >
                <LoadingSpinner v-if="loadingDisplay" size="small" variant="dots" />
                <span v-else>{{ $t('common.refresh') }}</span>
              </button>
            </div>

            <div v-if="loadingDisplay" class="loading-container">
              <LoadingSpinner :text="$t('pluginDetail.loadingDisplay')" />
            </div>

            <div v-else-if="displayContent" class="display-content">
              <div v-html="displayContent"></div>
            </div>

            <div v-else class="no-display">
              <p>{{ $t('pluginDetail.noDisplay') }}</p>
            </div>
          </div>
          <div class="section">
            <div class="section-header">
              <h2 class="section-title">{{ $t('pluginDetail.executionLogs') }}</h2>
              <button class="refresh-btn" @click="loadLogs" :disabled="loadingLogs">
                <LoadingSpinner v-if="loadingLogs" size="small" variant="dots" />
                <span v-else>{{ $t('common.refresh') }}</span>
              </button>
            </div>
            <div v-if="loadingLogs" class="loading-container">
              <LoadingSpinner :text="$t('pluginDetail.loadingLogs')" />
            </div>
            <div v-else class="logs-list">
              <div v-if="logs.length === 0" class="no-display">
                <p>{{ $t('pluginDetail.noLogs') }}</p>
              </div>
              <ul v-else>
                <li class="log-header">
                  <span class="log-time">{{ $t('pluginDetail.logTime') }}</span>
                  <span class="log-event">{{ $t('pluginDetail.logEvent') }}</span>
                  <span class="log-status">{{ $t('pluginDetail.logStatus') }}</span>
                  <span class="log-duration">{{ $t('pluginDetail.logDuration') }}</span>
                  <span class="log-error">{{ $t('pluginDetail.logError') }}</span>
                </li>
                <li v-for="item in logs" :key="item.id" class="log-item">
                  <span class="log-time">{{ item.createdAt }}</span>
                  <span class="log-event">{{ item.event }}</span>
                  <span class="log-status" :class="{'ok': item.status == 1 || item.status == 'ok', 'error': item.status == 0 || item.status == 'error'}">
                    {{ item.status == 1 || item.status == 'ok' ? $t('common.success') : $t('pluginDetail.failure') }}
                  </span>
                  <span class="log-duration">{{ item.durationMs }} ms</span>
                  <span v-if="item.error" class="log-error">{{ item.error }}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Layout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Layout from '@/components/Layout.vue'
import LoadingSpinner from '@/components/LoadingSpinner.vue'
import PluginIcon from '@/components/PluginIcon.vue'
import { pluginApi } from '@/services/api'
import { showSuccess, showError } from '@/utils/errorHandler'
import type { Plugin } from '@/types'

const { t } = useI18n()
const route = useRoute()

const plugin = ref<Plugin | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const togglingPlugin = ref(false)
const config = ref<string>('')
const configText = ref<string>('')
const editMode = ref(false)
const savingConfig = ref(false)
const displayContent = ref<string>('')
const loadingDisplay = ref(false)
const logs = ref<any[]>([])


const editingName = ref(false)
const editedName = ref('')
const savingName = ref(false)
const nameInput = ref<HTMLInputElement>()


const uploadingIcon = ref(false)
const loadingLogs = ref(false)

const pluginId = computed(() => {
  return Number(route.params.id)
})

const hasDisplay = computed(() => {
  return plugin.value?.capabilities.includes('displayer')
})

const configExample = computed(() => {
  return plugin.value?.configExample || ''
})

const loadPlugin = async () => {
  loading.value = true
  error.value = null

  try {
    const response = await pluginApi.getPlugins()
    const plugins = response.data || []
    plugin.value = plugins.find(p => p.id === pluginId.value) || null

    if (plugin.value) {

      try {
        const configResponse = await pluginApi.getConfig(pluginId.value)
        config.value = configResponse.data
        configText.value = configResponse.data
      } catch (err) {

        console.warn('Failed to load plugin configuration:', err)
      }


      if (hasDisplay.value) {
        await loadDisplay()
      }
    } else {
      error.value = t('pluginDetail.notFound')
    }
  } catch (err: any) {
    error.value = err.errorDescription || t('plugins.loadError')
    showError(err, t('plugins.loadError'))
  } finally {
    loading.value = false
  }
}

const loadDisplay = async () => {
  if (!plugin.value) return

  loadingDisplay.value = true

  try {
    const response = await pluginApi.getDisplay(pluginId.value)
    displayContent.value = response.data
  } catch (err: any) {
    console.warn('Failed to load plugin display:', err)
  } finally {
    loadingDisplay.value = false
  }
}

const refreshDisplay = async () => {
  await loadDisplay()
}

const loadLogs = async () => {
  if (!plugin.value) return
  loadingLogs.value = true
  try {
    const res = await pluginApi.getLogs(pluginId.value, 50)
    logs.value = res.data || []
  } catch (err) {
    console.warn('Failed to load logs', err)
  } finally {
    loadingLogs.value = false
  }
}

const togglePlugin = async () => {
  if (!plugin.value) return

  togglingPlugin.value = true

  try {
    if (plugin.value.enabled) {
      await pluginApi.disable(pluginId.value)
      showSuccess(t('plugins.disabledSuccess', { name: plugin.value.name }))
    } else {
      await pluginApi.enable(pluginId.value)
      showSuccess(t('plugins.enabledSuccess', { name: plugin.value.name }))
    }


    await loadPlugin()
  } catch (err: any) {
    showError(err, t('plugins.toggleError', { action: plugin.value.enabled ? t('common.disable') : t('common.enable') }))
  } finally {
    togglingPlugin.value = false
  }
}

const startEdit = () => {
  editMode.value = true
}

const cancelEdit = () => {
  editMode.value = false
}

const saveConfig = async () => {
  if (!plugin.value) return
  savingConfig.value = true
  try {
    await pluginApi.updateConfig(pluginId.value, configText.value)
    config.value = configText.value
    editMode.value = false
    showSuccess(t('pluginDetail.configSaved'))
  } catch (err: unknown) {
    showError(err instanceof Error ? err : new Error(String(err)), t('pluginDetail.configSaveFailed'))
  } finally {
    savingConfig.value = false
  }
}


const startEditingName = () => {
  if (plugin.value) {
    editedName.value = plugin.value.name
    editingName.value = true
    nextTick(() => {
      nameInput.value?.focus()
    })
  }
}

const saveName = async () => {
  if (!editedName.value || !plugin.value) return

  savingName.value = true
  try {
    await pluginApi.updateName(pluginId.value, editedName.value)
    editingName.value = false
    showSuccess(t('plugins.nameUpdated'))

    await loadPlugin()
  } catch (err: any) {
    showError(err, t('plugins.nameUpdateError'))
  } finally {
    savingName.value = false
  }
}

const cancelEditName = () => {
  editingName.value = false
  editedName.value = ''
}


const uploadIcon = async (file: File) => {
  if (!plugin.value) return

  uploadingIcon.value = true
  try {
    await pluginApi.uploadImage(pluginId.value, file)
    showSuccess(t('plugins.iconUploaded'))

    await loadPlugin()
  } catch (err: any) {
    showError(err, t('plugins.iconUploadError'))
  } finally {
    uploadingIcon.value = false
  }
}

const deleteIcon = async () => {
  if (!plugin.value) return

  try {
    await pluginApi.deleteImage(pluginId.value)
    showSuccess(t('plugins.iconDeleted'))

    await loadPlugin()
  } catch (err: any) {
    showError(err, t('plugins.iconDeleteError'))
  }
}


watch(editMode, (newMode) => {
  if (!newMode) {
    configText.value = config.value
  }
})

onMounted(() => {
  loadPlugin()
  loadLogs()
})
</script>

<style scoped>
.plugin-detail {
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
  background-color: var(--color-primary);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  padding: 0.5rem 1rem;
  cursor: pointer;
}

.plugin-content {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.plugin-header {
  display: flex;
  gap: 2rem;
  padding: 1.5rem;
  background: var(--color-bg-primary);
  border-radius: 0.75rem;
  box-shadow: var(--shadow-sm);
}

.plugin-icon-large {
  flex-shrink: 0;
}

.plugin-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.plugin-name-display {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.plugin-name {
  font-size: 1.875rem;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0;
}

.edit-name-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--color-border-secondary);
  border-radius: 0.375rem;
  cursor: pointer;
  color: var(--color-text-tertiary);
  transition: var(--theme-transition);
}

.edit-name-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-primary);
  border-color: var(--color-primary);
}

.plugin-name-edit {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.name-input {
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border-secondary);
  border-radius: 0.375rem;
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--color-text-primary);
  min-width: 200px;
  background-color: var(--color-bg-primary);
}

.name-input:focus {
  outline: none;
  border-color: var(--color-border-focus);
  box-shadow: 0 0 0 3px var(--color-primary-light);
}

.save-btn,
.cancel-btn {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  transition: var(--theme-transition);
}

.save-btn {
  background-color: var(--color-success);
  color: var(--color-text-inverse);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.save-btn:hover:not(:disabled) {
  background-color: var(--color-success-hover);
}

.save-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.cancel-btn {
  background-color: var(--color-bg-hover);
  color: var(--color-text-secondary);
}

.cancel-btn:hover {
  background-color: var(--color-bg-active);
}

.plugin-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1rem;
  font-weight: 500;
  color: var(--color-text-tertiary);
}

.status-enabled {
  color: var(--color-success-hover);
}

.status-indicator {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background-color: var(--color-border-secondary);
}

.status-enabled .status-indicator {
  background-color: var(--color-success);
}

.plugin-meta {
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
  color: var(--color-text-tertiary);
  font-weight: 500;
}

.meta-value {
  font-size: 0.875rem;
  color: var(--color-text-primary);
  font-weight: 600;
}

.meta-link {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--color-primary);
  text-decoration: none;
  font-size: 0.875rem;
}

.meta-link:hover {
  color: var(--color-primary-hover);
}

.plugin-actions {
  display: flex;
  gap: 0.75rem;
}

.toggle-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  transition: var(--theme-transition);
  min-width: 120px;
}

.enable-btn {
  background-color: var(--color-success);
  color: var(--color-text-inverse);
}

.enable-btn:hover:not(:disabled) {
  background-color: var(--color-success-hover);
}

.disable-btn {
  background-color: var(--color-error);
  color: var(--color-text-inverse);
}

.disable-btn:hover:not(:disabled) {
  background-color: var(--color-error-hover);
}

.toggle-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.plugin-sections {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.logs-list ul {
  list-style: none;
  padding: 0;
}

.log-header {
  display: grid;
  grid-template-columns: 180px 160px 100px 100px 1fr;
  gap: 8px;
  padding: 8px 16px;
  background-color: var(--color-bg-tertiary);
  font-weight: 600;
  color: var(--color-text-secondary);
  border-bottom: 2px solid var(--color-border-primary);
  border-top: none;
}

.log-item {
  display: grid;
  grid-template-columns: 180px 160px 100px 100px 1fr;
  gap: 8px;
  padding: 8px 16px;
  border-top: 1px solid var(--color-border-primary);
}

.log-status.ok { color: var(--color-success); }
.log-status.error { color: var(--color-error); }

.section {
  background: var(--color-bg-primary);
  border-radius: 0.75rem;
  box-shadow: var(--shadow-sm);
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
  color: var(--color-text-primary);
  margin: 0;
  padding: 0 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--color-border-primary);
}



.section > .section-title {
  padding-top: 1.5rem;
}

.config-actions {
  display: flex;
  gap: 0.75rem;
}

.config-mode-btn {
  padding: 0.375rem 0.75rem;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  transition: var(--theme-transition);
}

.edit-btn {
  background-color: var(--color-primary);
  color: var(--color-text-inverse);
}

.edit-btn:hover {
  background-color: var(--color-primary-hover);
}

.config-actions .cancel-btn {
  background-color: var(--color-text-tertiary);
  color: var(--color-text-inverse);
}

.config-actions .cancel-btn:hover {
  background-color: var(--color-text-secondary);
}

.config-actions .save-btn {
  padding: 0.375rem 0.75rem;
  background-color: var(--color-success);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  transition: var(--theme-transition);
}

.config-actions .save-btn:hover:not(:disabled) {
  background-color: var(--color-success-hover);
}

.config-actions .save-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.config-display {
  padding: 0 1.5rem 1.5rem;
}

.config-content {
  background-color: var(--color-bg-hover);
  border: 1px solid var(--color-border-secondary);
  border-radius: 0.5rem;
  padding: 1rem;
  font-family: 'Courier New', monospace;
  font-size: 0.875rem;
  color: var(--color-text-primary);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 400px;
  overflow-y: auto;
}

.config-editor {
  padding: 0 1.5rem 1.5rem;
}

.config-textarea {
  width: 100%;
  min-height: 300px;
  padding: 1rem;
  border: 1px solid var(--color-border-secondary);
  border-radius: 0.5rem;
  font-family: 'Courier New', monospace;
  font-size: 0.875rem;
  line-height: 1.5;
  resize: vertical;
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
}

.no-config, .no-display {
  padding: 1.5rem;
  text-align: center;
  color: var(--color-text-tertiary);
  font-style: italic;
}

.capabilities-list {

  padding: 1.25rem 1.5rem 1.5rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.capability-tag {
  background-color: var(--color-bg-hover);
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-weight: 500;
}

.display-content {
  padding: 1.5rem;
}

.refresh-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.75rem;
  background-color: var(--color-bg-hover);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border-secondary);
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: var(--theme-transition);
}

.refresh-btn:hover:not(:disabled) {
  background-color: var(--color-bg-active);
}

.refresh-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}


@media (max-width: 768px) {
  .plugin-header {
    flex-direction: column;
    gap: 1rem;
  }

  .plugin-meta {
    flex-direction: column;
    gap: 0.75rem;
  }

  .meta-item {
    min-width: auto;
  }

  .section-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .config-actions {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
