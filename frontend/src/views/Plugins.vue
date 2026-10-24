<template>
  <Layout>
    <div class="plugins">
      <div class="page-header">
        <h1 class="page-title">{{ $t('common.plugins') }}</h1>
        <div class="page-actions">
          <button type="button" @click="refreshPlugins" :disabled="loading" class="refresh-btn">
            <RefreshCw :size="14" aria-hidden="true" :class="{ spinning: loading }" />
            <span>{{ loading ? $t('common.loading') : $t('common.refresh') }}</span>
          </button>
        </div>
      </div>

      <div v-if="error" class="error-message">
        {{ error }}
      </div>

      <div v-if="loading" class="loading-container">
        <LoadingSpinner :text="$t('plugins.loadingPlugins')" />
      </div>

      <div v-else-if="plugins.length === 0" class="empty-plugins">
        <EmptyState
          type="default"
          :title="$t('plugins.noPlugins')"
          :description="$t('plugins.pluginsDescription')"
        >
          <template #actions>
            <a href="https://gotify.net/docs/plugin" target="_blank" class="learn-more-btn">
              {{ $t('plugins.learnMore') }}
            </a>
          </template>
        </EmptyState>
      </div>

      <div v-else class="plugins-grid">
        <div v-for="plugin in plugins" :key="plugin.id" class="plugin-card">
          <div class="plugin-header">
            <PluginIcon :name="plugin.name" :icon="plugin.icon" size="small" />
            <div class="plugin-title-container">
              <h3 class="plugin-name">{{ plugin.name }}</h3>
              <div class="plugin-status" :class="{ 'status-enabled': plugin.enabled }">
                <span class="status-indicator"></span>
                {{ plugin.enabled ? $t('common.enabled') : $t('common.disabled') }}
              </div>
            </div>
          </div>

          <div class="plugin-info">
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
                    <path d="M18 13v6a2 2 0 0 0 1-2 2H5a2 2 0 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                    <polyline points="15 3 21 12 9 3 21"></polyline>
                  </svg>
                </a>
              </div>
            </div>

            <div v-if="plugin.capabilities && plugin.capabilities.length" class="plugin-capabilities">
              <h4 class="capabilities-title">{{ $t('plugins.capabilities') }}:</h4>
              <div class="capabilities-list">
                <span v-for="capability in plugin.capabilities" :key="capability" class="capability-tag">
                  {{ capability }}
                </span>
              </div>
            </div>
          </div>

          <div class="plugin-actions">
            <router-link :to="`/plugins/${plugin.id}`" class="details-btn">
              {{ $t('plugins.viewDetails') }}
            </router-link>

            <button
              @click="togglePlugin(plugin)"
              :class="['toggle-btn', plugin.enabled ? 'disable-btn' : 'enable-btn']"
              :disabled="togglingPlugin === plugin.id"
            >
              <LoadingSpinner v-if="togglingPlugin === plugin.id" size="small" variant="dots" />
              <span v-else>{{ plugin.enabled ? $t('plugins.disable') : $t('plugins.enable') }}</span>
            </button>
          </div>
        </div>
      </div>

    </div>
  </Layout>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Layout from '@/components/Layout.vue'
import EmptyState from '@/components/EmptyState.vue'
import LoadingSpinner from '@/components/LoadingSpinner.vue'
import PluginIcon from '@/components/PluginIcon.vue'
import { RefreshCw } from '@lucide/vue'
import { pluginApi } from '@/services/api'
import { showSuccess, showError } from '@/utils/errorHandler'
import type { Plugin } from '@/types'

const { t } = useI18n()

const plugins = ref<Plugin[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const togglingPlugin = ref<number | null>(null)

const loadPlugins = async () => {
  loading.value = true
  error.value = null

  try {
    const response = await pluginApi.getPlugins()
    plugins.value = response.data || []
  } catch (err: any) {
    error.value = err.errorDescription || t('plugins.loadError')
    showError(err, t('plugins.loadError'))
  } finally {
    loading.value = false
  }
}

const refreshPlugins = () => {
  loadPlugins()
}

const togglePlugin = async (plugin: Plugin) => {
  togglingPlugin.value = plugin.id

  try {
    if (plugin.enabled) {
      await pluginApi.disable(plugin.id)
      showSuccess(t('plugins.disabledSuccess', { name: plugin.name }))
    } else {
      await pluginApi.enable(plugin.id)
      showSuccess(t('plugins.enabledSuccess', { name: plugin.name }))
    }


    await loadPlugins()
  } catch (err: any) {
    showError(err, t('plugins.toggleError', { action: plugin.enabled ? t('plugins.disable') : t('plugins.enable') }))
  } finally {
    togglingPlugin.value = null
  }
}

onMounted(() => {
  loadPlugins()
})
</script>

<style scoped>
.plugins {
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

.page-actions {
  display: flex;
  gap: 1rem;
}

.refresh-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 1rem;
  background-color: var(--color-primary);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  transition: var(--theme-transition);
}

.refresh-btn:hover:not(:disabled) {
  background-color: var(--color-primary-hover);
}

.refresh-btn:disabled {
  background-color: var(--color-text-muted);
  cursor: not-allowed;
}

.refresh-btn .spinning {
  animation: plugin-refresh-spin 1s linear infinite;
}

@keyframes plugin-refresh-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .refresh-btn .spinning {
    animation: none;
  }
}


.refresh-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.error-message {
  background-color: #fef2f2;
  color: var(--color-error-hover);
  padding: 1rem;
  border-radius: 0.375rem;
  margin-bottom: 1rem;
  border: 1px solid #fecaca;
}

.loading-container {
  display: flex;
  justify-content: center;
  padding: 3rem;
}

.empty-plugins {
  padding: 2rem;
}

.learn-more-btn {
  display: inline-block;
  padding: 0.5rem 1rem;
  background-color: var(--color-primary);
  color: var(--color-text-inverse) !important;
  text-decoration: none;
  border-radius: 0.375rem;
  font-weight: 500;
  transition: var(--theme-transition);
}

.learn-more-btn:hover {
  background-color: var(--color-primary-hover);
  color: var(--color-text-inverse) !important;
}

.plugins-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
  gap: 1.5rem;
}

.plugin-card {
  background: var(--color-bg-primary);
  border-radius: 0.75rem;
  box-shadow: var(--shadow-sm);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.plugin-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.5rem 1.5rem 0;
}

.plugin-title-container {
  flex: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.plugin-name {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.plugin-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-tertiary);
}

.status-enabled {
  color: var(--color-success-hover);
}

.status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--color-border-secondary);
}

.status-enabled .status-indicator {
  background-color: var(--color-success);
}

.plugin-info {
  padding: 0 1.5rem;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.plugin-meta {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.meta-label {
  font-size: 0.875rem;
  color: var(--color-text-tertiary);
  font-weight: 500;
  min-width: 60px;
}

.meta-value {
  font-size: 0.875rem;
  color: var(--color-text-primary);
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

.plugin-capabilities {
  margin-top: 0.5rem;
}

.capabilities-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin: 0 0 0.5rem 0;
}

.capabilities-list {
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

.plugin-actions {
  display: flex;
  padding: 1rem 1.5rem;
  gap: 0.75rem;
  border-top: 1px solid var(--color-border-primary);
}

.details-btn {
  flex: 1;
  padding: 0.5rem 1rem;
  background-color: var(--color-bg-hover);
  color: var(--color-text-secondary);
  text-decoration: none;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  text-align: center;
  transition: var(--theme-transition);
}

.details-btn:hover {
  background-color: var(--color-bg-active);
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
  min-width: 100px;
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


@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
  }

  .plugins-grid {
    grid-template-columns: 1fr;
  }

  .plugin-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .plugin-title-container {
    width: 100%;
    justify-content: space-between;
  }

  .plugin-actions {
    flex-direction: column;
  }

  .details-btn, .toggle-btn {
    width: 100%;
  }
}
</style>