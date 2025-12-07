<template>
  <div class="layout">
    <nav class="navbar">
      <div class="nav-brand">
        <h1>Woe</h1>
      </div>
      <div class="nav-menu">
        <router-link to="/" class="nav-item" active-class="active">
          {{ $t('common.dashboard') }}
        </router-link>
        <router-link to="/messages" class="nav-item" active-class="active">
          {{ $t('common.messages') }}
        </router-link>
        <router-link to="/applications" class="nav-item" active-class="active">
          {{ $t('common.applications') }}
        </router-link>
        <router-link to="/clients" class="nav-item" active-class="active">
          {{ $t('common.clients') }}
        </router-link>
        <router-link to="/users" class="nav-item" active-class="active" v-if="authStore.user?.admin">
          {{ $t('common.users') }}
        </router-link>
        <router-link to="/plugins" class="nav-item" active-class="active">
          {{ $t('common.plugins') }}
        </router-link>
        <router-link to="/settings" class="nav-item" active-class="active">
          {{ $t('common.settings') }}
        </router-link>
      </div>
      <div class="nav-user">
        <!-- 新增：语言切换按钮 -->
        <div class="language-switcher">
          <button
            @click="toggleLanguage"
            class="lang-btn"
            :title="$t('common.switchLanguage')"
          >
            {{ currentLocale === 'zh-CN' ? '🇨🇳 中文' : '🇺🇸 English' }}
          </button>
        </div>

        <span class="user-info">{{ authStore.user?.name }}</span>
        <button @click="logout" class="logout-btn">
          {{ $t('common.logout') }}
        </button>
      </div>
    </nav>
    <main class="main-content">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { computed } from 'vue'

const authStore = useAuthStore()
const router = useRouter()
const { locale } = useI18n()

const currentLocale = computed(() => locale.value)

const logout = () => {
  authStore.logout()
  router.push('/login')
}

// 新增：切换语言
const toggleLanguage = () => {
  const newLocale = locale.value === 'zh-CN' ? 'en-US' : 'zh-CN'
  locale.value = newLocale
  localStorage.setItem('locale', newLocale)
}
</script>

<style scoped>
.layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.navbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2rem;
  height: 60px;
  background: white;
  border-bottom: 1px solid #e5e7eb;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
}

.nav-brand h1 {
  color: #1f2937;
  font-size: 1.5rem;
  font-weight: bold;
}

.nav-menu {
  display: flex;
  gap: 1rem;
}

.nav-item {
  padding: 0.5rem 1rem;
  color: #6b7280;
  text-decoration: none;
  border-radius: 0.375rem;
  transition: all 0.2s;
}

.nav-item:hover {
  color: #1f2937;
  background-color: #f3f4f6;
}

.nav-item.active {
  color: #1f2937;
  background-color: #e5e7eb;
}

.nav-user {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.user-info {
  color: #6b7280;
  font-size: 0.875rem;
}

.logout-btn {
  padding: 0.5rem 1rem;
  background-color: #ef4444;
  color: white;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: background-color 0.2s;
}

.logout-btn:hover {
  background-color: #dc2626;
}

/* 新增：语言切换按钮样式 */
.language-switcher {
  display: flex;
  align-items: center;
}

.lang-btn {
  padding: 0.5rem 1rem;
  background-color: #f3f4f6;
  color: #374151;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: all 0.2s;
  white-space: nowrap;
}

.lang-btn:hover {
  background-color: #e5e7eb;
  border-color: #9ca3af;
}

.main-content {
  flex: 1;
  padding: 2rem;
}

@media (max-width: 768px) {
  .navbar {
    flex-direction: column;
    height: auto;
    padding: 1rem;
    gap: 1rem;
  }

  .nav-menu {
    flex-wrap: wrap;
    justify-content: center;
  }

  .language-switcher {
    order: -1;
    margin-bottom: 0.5rem;
  }

  .main-content {
    padding: 1rem;
  }
}
</style>