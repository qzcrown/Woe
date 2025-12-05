<template>
  <Layout>
    <div class="plugin-detail">
      <div v-if="loading" class="loading-container">
        <LoadingSpinner text="Loading plugin details..." />
      </div>

      <div v-else-if="error" class="error-container">
        <div class="error-message">
          <h3>Error loading plugin</h3>
          <p>{{ error }}</p>
          <button @click="loadPlugin" class="retry-btn">Retry</button>
        </div>
      </div>

      <div v-else-if="plugin" class="plugin-content">
        <div class="plugin-header">
          <div class="plugin-icon-large">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M12 2L2 7l10 5 10-5-10 5z"></path>
              <path d="M2 17l10 5 10-5M2 12l10 5 10-5"></path>
            </svg>
          </div>
          
          <div class="plugin-info">
            <h1 class="plugin-name">{{ plugin.name }}</h1>
            <div class="plugin-status" :class="{ 'status-enabled': plugin.enabled }">
              <span class="status-indicator"></span>
              {{ plugin.enabled ? 'Enabled' : 'Disabled' }}
            </div>
            
            <div class="plugin-meta">
              <div v-if="plugin.author" class="meta-item">
                <span class="meta-label">Author:</span>
                <span class="meta-value">{{ plugin.author }}</span>
              </div>
              
              <div v-if="plugin.license" class="meta-item">
                <span class="meta-label">License:</span>
                <span class="meta-value">{{ plugin.license }}</span>
              </div>
              
              <div v-if="plugin.website" class="meta-item">
                <span class="meta-label">Website:</span>
                <a :href="plugin.website" target="_blank" class="meta-link">
                  {{ plugin.website }}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                    <polyline points="15 3 21 12 9 3 21"></polyline>
                  </svg>
                </a>
              </div>
              
              <div class="meta-item">
                <span class="meta-label">Module Path:</span>
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
                <span v-else>{{ plugin.enabled ? 'Disable' : 'Enable' }}</span>
              </button>
            </div>
          </div>
        </div>

        <div class="plugin-sections">
          <!-- Capabilities Section -->
          <div v-if="plugin.capabilities && plugin.capabilities.length" class="section">
            <h2 class="section-title">Capabilities</h2>
            <div class="capabilities-list">
              <span v-for="capability in plugin.capabilities" :key="capability" class="capability-tag">
                {{ capability }}
              </span>
            </div>
          </div>

          <!-- Configuration Section -->
          <div class="section">
            <div class="section-header">
              <h2 class="section-title">Configuration</h2>
              <div class="config-actions">
                <button 
                  @click="editMode = !editMode" 
                  :class="['config-mode-btn', editMode ? 'cancel-btn' : 'edit-btn']"
                >
                  {{ editMode ? 'Cancel' : 'Edit' }}
                </button>
                <button 
                  v-if="editMode" 
                  @click="saveConfig" 
                  :disabled="savingConfig"
                  class="save-btn"
                >
                  <LoadingSpinner v-if="savingConfig" size="small" variant="dots" />
                  <span v-else>Save</span>
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
                placeholder="Enter YAML configuration..."
                spellcheck="false"
              ></textarea>
            </div>
            
            <div v-if="!editMode && !config" class="no-config">
              <p>This plugin does not have any configuration.</p>
            </div>
          </div>

          <!-- Display Section -->
          <div v-if="hasDisplay" class="section">
            <div class="section-header">
              <h2 class="section-title">Plugin Display</h2>
              <button 
                @click="refreshDisplay" 
                :disabled="loadingDisplay"
                class="refresh-btn"
              >
                <LoadingSpinner v-if="loadingDisplay" size="small" variant="dots" />
                <span v-else>Refresh</span>
              </button>
            </div>
            
            <div v-if="loadingDisplay" class="loading-container">
              <LoadingSpinner text="Loading plugin display..." />
            </div>
            
            <div v-else-if="displayContent" class="display-content">
              <div v-html="displayContent"></div>
            </div>
            
            <div v-else class="no-display">
              <p>This plugin does not provide any display content.</p>
            </div>
          </div>
          <div class="section">
            <div class="section-header">
              <h2 class="section-title">Execution Logs</h2>
              <button class="refresh-btn" @click="loadLogs" :disabled="loadingLogs">
                <LoadingSpinner v-if="loadingLogs" size="small" variant="dots" />
                <span v-else>Refresh</span>
              </button>
            </div>
            <div v-if="loadingLogs" class="loading-container">
              <LoadingSpinner text="Loading logs..." />
            </div>
            <div v-else class="logs-list">
              <div v-if="logs.length === 0" class="no-display">
                <p>No logs.</p>
              </div>
              <ul v-else>
                <li v-for="item in logs" :key="item.id" class="log-item">
                  <span class="log-time">{{ item.createdAt }}</span>
                  <span class="log-event">{{ item.event }}</span>
                  <span class="log-status" :class="{'ok': item.status === 'ok', 'error': item.status !== 'ok'}">{{ item.status }}</span>
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
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import Layout from '@/components/Layout.vue'
import LoadingSpinner from '@/components/LoadingSpinner.vue'
import { pluginApi } from '@/services/api'
import { showSuccess, showError } from '@/utils/errorHandler'
import type { Plugin } from '@/types'

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
const loadingLogs = ref(false)

const pluginId = computed(() => {
  return Number(route.params.id)
})

const hasDisplay = computed(() => {
  return plugin.value?.capabilities.includes('displayer')
})

const loadPlugin = async () => {
  loading.value = true
  error.value = null
  
  try {
    const response = await pluginApi.getPlugins()
    const plugins = response.data || []
    plugin.value = plugins.find(p => p.id === pluginId.value) || null
    
    if (plugin.value) {
      // Load configuration
      try {
        const configResponse = await pluginApi.getConfig(pluginId.value)
        config.value = configResponse.data
        configText.value = configResponse.data
      } catch (err) {
        // Plugin might not have configuration
        console.warn('Failed to load plugin configuration:', err)
      }
      
      // Load display content if available
      if (hasDisplay.value) {
        await loadDisplay()
      }
    } else {
      error.value = 'Plugin not found'
    }
  } catch (err: any) {
    error.value = err.errorDescription || 'Failed to load plugin'
    showError(err, 'Failed to load plugin')
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
      showSuccess(`Plugin "${plugin.value.name}" disabled successfully`)
    } else {
      await pluginApi.enable(pluginId.value)
      showSuccess(`Plugin "${plugin.value.name}" enabled successfully`)
    }
    
    // Reload plugin to update status
    await loadPlugin()
  } catch (err: any) {
    showError(err, `Failed to ${plugin.value.enabled ? 'disable' : 'enable'} plugin`)
  } finally {
    togglingPlugin.value = false
  }
}

const saveConfig = async () => {
  if (!plugin.value) return
  
  savingConfig.value = true
  
  try {
    await pluginApi.updateConfig(pluginId.value, configText.value)
    config.value = configText.value
    editMode.value = false
    showSuccess('Configuration saved successfully')
  } catch (err: any) {
    showError(err, 'Failed to save configuration')
  } finally {
    savingConfig.value = false
  }
}

// Watch for edit mode changes to reset config text if cancelled
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
  background-color: #3b82f6;
  color: white;
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
  background: white;
  border-radius: 0.75rem;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
}

.plugin-icon-large {
  width: 96px;
  height: 96px;
  background-color: #f3f4f6;
  border-radius: 0.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6b7280;
  flex-shrink: 0;
}

.plugin-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.plugin-name {
  font-size: 1.875rem;
  font-weight: 700;
  color: #1f2937;
  margin: 0;
}

.plugin-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1rem;
  font-weight: 500;
  color: #6b7280;
}

.status-enabled {
  color: #059669;
}

.status-indicator {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background-color: #d1d5db;
}

.status-enabled .status-indicator {
  background-color: #10b981;
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
  color: #6b7280;
  font-weight: 500;
}

.meta-value {
  font-size: 0.875rem;
  color: #1f2937;
  font-weight: 600;
}

.meta-link {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  color: #3b82f6;
  text-decoration: none;
  font-size: 0.875rem;
}

.meta-link:hover {
  color: #2563eb;
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
  transition: all 0.2s;
  min-width: 120px;
}

.enable-btn {
  background-color: #10b981;
  color: white;
}

.enable-btn:hover:not(:disabled) {
  background-color: #059669;
}

.disable-btn {
  background-color: #ef4444;
  color: white;
}

.disable-btn:hover:not(:disabled) {
  background-color: #dc2626;
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
.log-item {
  display: grid;
  grid-template-columns: 180px 160px 100px 100px 1fr;
  gap: 8px;
  padding: 8px 16px;
  border-top: 1px solid #e5e7eb;
}
.log-status.ok { color: #10b981; }
.log-status.error { color: #ef4444; }

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
  transition: all 0.2s;
}

.edit-btn {
  background-color: #3b82f6;
  color: white;
}

.edit-btn:hover {
  background-color: #2563eb;
}

.cancel-btn {
  background-color: #6b7280;
  color: white;
}

.cancel-btn:hover {
  background-color: #4b5563;
}

.save-btn {
  padding: 0.375rem 0.75rem;
  background-color: #10b981;
  color: white;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  transition: all 0.2s;
}

.save-btn:hover:not(:disabled) {
  background-color: #059669;
}

.save-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.config-display {
  padding: 0 1.5rem 1.5rem;
}

.config-content {
  background-color: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 0.5rem;
  padding: 1rem;
  font-family: 'Courier New', monospace;
  font-size: 0.875rem;
  color: #1e293b;
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
  border: 1px solid #d1d5db;
  border-radius: 0.5rem;
  font-family: 'Courier New', monospace;
  font-size: 0.875rem;
  line-height: 1.5;
  resize: vertical;
}

.no-config, .no-display {
  padding: 1.5rem;
  text-align: center;
  color: #6b7280;
  font-style: italic;
}

.capabilities-list {
  padding: 0 1.5rem 1.5rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.capability-tag {
  background-color: #f3f4f6;
  color: #374151;
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
  background-color: #f3f4f6;
  color: #374151;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: all 0.2s;
}

.refresh-btn:hover:not(:disabled) {
  background-color: #e5e7eb;
}

.refresh-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

/* Responsive Design */
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
