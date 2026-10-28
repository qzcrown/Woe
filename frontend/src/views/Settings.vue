<template>
  <Layout>
    <div class="settings-page">
      <div class="page-header">
        <h1 class="page-title">{{ $t('settings.title') }}</h1>
        <p class="page-description">{{ $t('settings.description') }}</p>
      </div>

      <div class="settings-container">
        <div class="settings-sidebar">
          <nav class="settings-nav">
            <a
              href="#"
              class="nav-item"
              :class="{ active: activeTab === 'notifications' }"
              @click.prevent="setActiveTab('notifications')"
            >
              {{ $t('settings.notifications') }}
            </a>
            <a
              href="#"
              class="nav-item"
              :class="{ active: activeTab === 'display' }"
              @click.prevent="setActiveTab('display')"
            >
              {{ $t('settings.display') }}
            </a>
          </nav>
        </div>

        <div class="settings-content">
          <div v-if="activeTab === 'notifications'" class="tab-content">
            <NotificationSettings />
          </div>
          <div v-if="activeTab === 'display'" class="tab-content">
            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">{{ $t('settings.renderMarkdown') }}</div>
                <p class="setting-desc">{{ $t('settings.renderMarkdownDesc') }}</p>
              </div>
              <label class="switch">
                <input
                  type="checkbox"
                  :checked="prefs.renderMarkdown"
                  :aria-label="$t('settings.renderMarkdown')"
                  @change="prefs.setRenderMarkdown(($event.target as HTMLInputElement).checked)"
                />
                <span class="slider"></span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Layout>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Layout from '@/components/Layout.vue'
import NotificationSettings from '@/components/NotificationSettings.vue'
import { usePreferencesStore } from '@/stores/preferences'

const activeTab = ref('notifications')
const prefs = usePreferencesStore()

const setActiveTab = (tab: string) => {
  activeTab.value = tab
}
</script>

<style scoped>
.settings-page {
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 2rem;
  text-align: center;
}

.page-title {
  font-size: 2rem;
  font-weight: bold;
  color: var(--color-text-primary);
  margin-bottom: 0.5rem;
}

.page-description {
  color: var(--color-text-tertiary);
  font-size: 1rem;
}

.settings-container {
  display: flex;
  gap: 2rem;
  background: var(--color-bg-primary);
  border-radius: 0.75rem;
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.settings-sidebar {
  width: 250px;
  background-color: var(--color-bg-tertiary);
  border-right: 1px solid var(--color-border-primary);
}

.settings-nav {
  padding: 1rem 0;
}

.nav-item {
  display: block;
  padding: 0.75rem 1.5rem;
  color: var(--color-text-tertiary);
  text-decoration: none;
  transition: var(--transition-interactive);
  border-left: 3px solid transparent;
}

.nav-item:hover {
  color: var(--color-text-primary);
  background-color: var(--color-bg-hover);
}

.nav-item.active {
  color: var(--color-text-primary);
  background-color: var(--color-bg-active);
  border-left-color: var(--color-primary);
}

.settings-content {
  flex: 1;
  padding: 0;
}

.tab-content {
  width: 100%;
}

@media (max-width: 768px) {
  .settings-container {
    flex-direction: column;
  }

  .settings-sidebar {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--color-border-primary);
  }

  .settings-nav {
    display: flex;
    padding: 0;
  }

  .nav-item {
    flex: 1;
    text-align: center;
    border-left: none;
    border-bottom: 3px solid transparent;
  }

  .nav-item.active {
    border-left: none;
    border-bottom-color: var(--color-primary);
  }
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  padding: 1rem;
  border: 1px solid var(--color-border-primary);
  border-radius: 0.5rem;
}
.setting-label {
  font-weight: 500;
  color: var(--color-text-primary);
}
.setting-desc {
  margin-top: 0.25rem;
  font-size: 0.875rem;
  color: var(--color-text-tertiary);
}
.switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
  flex-shrink: 0;
}
.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
.switch .slider {
  position: absolute;
  inset: 0;
  background-color: var(--color-bg-active);
  border-radius: 9999px;
  transition: var(--transition-interactive);
}
.switch .slider::before {
  content: '';
  position: absolute;
  width: 18px;
  height: 18px;
  left: 3px;
  top: 3px;
  background-color: var(--color-text-inverse);
  border-radius: 50%;
  transition: transform 0.2s;
}
.switch input:checked + .slider {
  background-color: var(--color-primary);
}
.switch input:checked + .slider::before {
  transform: translateX(20px);
}
.switch input:focus-visible + .slider {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
</style>