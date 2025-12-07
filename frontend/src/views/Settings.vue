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
          </nav>
        </div>

        <div class="settings-content">
          <div v-if="activeTab === 'notifications'" class="tab-content">
            <NotificationSettings />
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

const activeTab = ref('notifications')

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
  color: #1f2937;
  margin-bottom: 0.5rem;
}

.page-description {
  color: #6b7280;
  font-size: 1rem;
}

.settings-container {
  display: flex;
  gap: 2rem;
  background: white;
  border-radius: 0.75rem;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.settings-sidebar {
  width: 250px;
  background-color: #f9fafb;
  border-right: 1px solid #e5e7eb;
}

.settings-nav {
  padding: 1rem 0;
}

.nav-item {
  display: block;
  padding: 0.75rem 1.5rem;
  color: #6b7280;
  text-decoration: none;
  transition: all 0.2s;
  border-left: 3px solid transparent;
}

.nav-item:hover {
  color: #1f2937;
  background-color: #f3f4f6;
}

.nav-item.active {
  color: #1f2937;
  background-color: #e5e7eb;
  border-left-color: #3b82f6;
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
    border-bottom: 1px solid #e5e7eb;
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
    border-bottom-color: #3b82f6;
  }
}
</style>