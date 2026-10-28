<template>
  <div class="layout">

    <div v-if="isElevated" class="elevation-ring" aria-hidden="true"></div>

    <div class="sr-only" role="status" aria-live="polite">{{ elevationAnnouncement }}</div>
    <nav class="navbar">
      <div class="nav-brand">
        <h1>Woe</h1>
      </div>
      <div
        id="mobile-menu"
        ref="mobileMenuEl"
        class="nav-menu"
        :class="{ open: mobileMenuOpen }"
        @keydown.escape.prevent="closeMobileMenu(true)"
      >
        <router-link to="/" class="nav-item" active-class="active" @click="mobileMenuOpen = false">
          {{ $t('common.dashboard') }}
        </router-link>
        <router-link to="/messages" class="nav-item" active-class="active" @click="mobileMenuOpen = false">
          {{ $t('common.messages') }}
        </router-link>
        <router-link to="/applications" class="nav-item" active-class="active" @click="mobileMenuOpen = false">
          {{ $t('common.applications') }}
        </router-link>
        <router-link to="/clients" class="nav-item" active-class="active" @click="mobileMenuOpen = false">
          {{ $t('common.clients') }}
        </router-link>
        <router-link to="/plugins" class="nav-item" active-class="active" @click="mobileMenuOpen = false">
          {{ $t('common.plugins') }}
        </router-link>
        <router-link to="/users" class="nav-item" active-class="active" v-if="authStore.user?.admin" @click="mobileMenuOpen = false">
          {{ $t('common.users') }}
        </router-link>
        <router-link to="/settings" class="nav-item" active-class="active" @click="mobileMenuOpen = false">
          {{ $t('common.settings') }}
        </router-link>

        <div class="mobile-extra">
          <button
            type="button"
            class="lang-btn"
            :title="$t('common.switchLanguage')"
            @click="toggleLanguage"
          >
            {{ currentLocale === 'zh-CN' ? 'EN' : '中文' }}
          </button>
          <button v-if="authStore.user" type="button" class="mobile-profile" @click="showProfileModal = true">
            <UserAvatar :user="authStore.user" size="small" :clickable="true" />
            <span>{{ authStore.user?.nickname || authStore.user?.name }}</span>
          </button>
          <button type="button" class="logout-btn" @click="logout">
            {{ $t('common.logout') }}
          </button>
        </div>
      </div>
      <div class="nav-user">

        <div class="language-switcher desktop-only">
          <button
            @click="toggleLanguage"
            class="lang-btn"
            :title="$t('common.switchLanguage')"
          >
            {{ currentLocale === 'zh-CN' ? 'EN' : '中文' }}
          </button>
        </div>


        <div class="theme-switcher">
          <button
            @click="toggleTheme"
            class="theme-btn"
            :title="themeModeLabel"
          >
            <svg v-if="themeMode === 'light'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <circle cx="12" cy="12" r="4"/>
              <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32 1.41-1.41"/>
            </svg>
            <svg v-else-if="themeMode === 'dark'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
            <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <rect x="2" y="3" width="20" height="14" rx="2"/>
              <path d="M8 21h8m-4-4v4"/>
            </svg>
          </button>
        </div>

        <div class="user-profile desktop-only" @click="showProfileModal = true" v-if="authStore.user">
          <UserAvatar :user="authStore.user" size="small" :clickable="true" />
          <span class="user-info">{{ authStore.user?.nickname || authStore.user?.name }}</span>
        </div>
        <button @click="logout" class="logout-btn desktop-only">
          {{ $t('common.logout') }}
        </button>

        <button
          ref="hamburgerBtn"
          type="button"
          class="hamburger-btn"
          :aria-expanded="mobileMenuOpen"
          aria-controls="mobile-menu"
          :aria-label="mobileMenuOpen ? $t('common.closeMenu') : $t('common.openMenu')"
          @click="toggleMobileMenu"
          @keydown.escape.prevent="closeMobileMenu(true)"
        >
          <X v-if="mobileMenuOpen" :size="20" aria-hidden="true" />
          <Menu v-else :size="20" aria-hidden="true" />
        </button>
      </div>
    </nav>
    <main class="main-content">
      <slot />
    </main>

    <EditProfileModal
      v-if="showProfileModal && authStore.user"
      :user="authStore.user"
      @close="showProfileModal = false"
      @updated="handleProfileUpdated"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useElevationIndicator } from '@/composables/useElevationIndicator'
import { Menu, X } from '@lucide/vue'
import UserAvatar from './UserAvatar.vue'
import EditProfileModal from './EditProfileModal.vue'

const authStore = useAuthStore()
const themeStore = useThemeStore()
const router = useRouter()
const route = useRoute()
const { locale, t } = useI18n()

const showProfileModal = ref(false)



const mobileMenuOpen = ref(false)
const hamburgerBtn = ref<HTMLButtonElement | null>(null)
const mobileMenuEl = ref<HTMLElement | null>(null)
watch(() => route.fullPath, () => {
  mobileMenuOpen.value = false
})

const openMobileMenu = () => {
  mobileMenuOpen.value = true
  nextTick(() => {
    mobileMenuEl.value?.querySelector<HTMLAnchorElement>('a.nav-item')?.focus()
  })
}

const closeMobileMenu = (returnFocus = false) => {
  mobileMenuOpen.value = false
  if (returnFocus) {
    nextTick(() => hamburgerBtn.value?.focus())
  }
}

const toggleMobileMenu = () => {
  if (mobileMenuOpen.value) {
    closeMobileMenu(true)
  } else {
    openMobileMenu()
  }
}


const { isElevated } = useElevationIndicator()
const elevationAnnouncement = ref('')
watch(isElevated, (active) => {
  elevationAnnouncement.value = active ? t('elevate.ringActivated') : t('elevate.ringEnded')
})

const currentLocale = computed(() => locale.value)


const themeMode = computed(() => themeStore.mode)
const themeModeLabel = computed(() => {
  if (themeMode.value === 'light') return t('common.themeLight')
  if (themeMode.value === 'dark') return t('common.themeDark')
  return t('common.themeAuto')
})

const logout = () => {

  void authStore.logout().then((result) => {
    if (result === 'not-confirmed') {


      console.warn('Logout: server revocation not confirmed; the credential may still be valid')
    } else if (result === 'already-unusable') {

      console.info('Logout: credential already rejected by server (revocation outcome unconfirmed)')
    }
  })
  router.push('/login')
}


const toggleLanguage = () => {
  const newLocale = locale.value === 'zh-CN' ? 'en-US' : 'zh-CN'
  locale.value = newLocale
  localStorage.setItem('locale', newLocale)
}


const toggleTheme = () => {
  themeStore.toggleTheme()
}

const handleProfileUpdated = (user: any) => {
  authStore.user = user
}
</script>

<style scoped>
.layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  transition: var(--theme-transition);
}


.elevation-ring {
  position: fixed;
  inset: 0;
  z-index: 999;
  pointer-events: none;
  border: 2px solid var(--color-warning);
  box-shadow:
    inset 0 0 12px var(--color-elevated-glow),
    0 0 12px var(--color-elevated-glow);
  animation: elevation-ring-pulse 2.4s ease-in-out infinite;
}

@keyframes elevation-ring-pulse {
  0%,
  100% {
    opacity: 0.7;
  }

  50% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .elevation-ring {
    animation: none;
  }
}


.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.navbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2rem;
  height: 60px;
  background: var(--color-bg-primary);
  border-bottom: 1px solid var(--color-border-primary);
  box-shadow: var(--shadow-sm);
  transition: var(--theme-transition);
}

.nav-brand h1 {
  color: var(--color-text-primary);
  font-size: 1.5rem;
  font-weight: bold;
}

.nav-menu {
  display: flex;
  gap: 1rem;
}

.nav-item {
  padding: 0.5rem 1rem;
  color: var(--color-text-tertiary);
  text-decoration: none;
  border-radius: 0.375rem;
  transition: var(--transition-interactive);
}

.nav-item:hover {
  color: var(--color-text-primary);
  background-color: var(--color-bg-hover);
}

.nav-item.active {
  color: var(--color-text-primary);
  background-color: var(--color-bg-active);
}

.nav-user {
  display: flex;
  align-items: center;
  gap: 1rem;
}


.hamburger-btn,
.mobile-extra {
  display: none;
}

.user-profile {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  border-radius: 0.375rem;
  transition: background-color 0.2s;
}

.user-profile:hover {
  background-color: var(--color-bg-hover);
}

.user-info {
  color: var(--color-text-tertiary);
  font-size: 0.875rem;
}

.logout-btn {
  padding: 0.5rem 1rem;
  background-color: var(--color-error);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: background-color 0.2s;
}

.logout-btn:hover {
  background-color: var(--color-error-hover);
}


.language-switcher,
.theme-switcher {
  display: flex;
  align-items: center;
}

.lang-btn,
.theme-btn {
  padding: 0.5rem;
  background-color: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-primary);
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: var(--transition-interactive);
  white-space: nowrap;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 40px;
}

.lang-btn:hover,
.theme-btn:hover {
  background-color: var(--color-bg-hover);
  border-color: var(--color-border-secondary);
}


.main-content {
  --desk-dot: rgba(148, 163, 184, 0.22);
  flex: 1;
  padding: 2rem;
  background-color: var(--color-bg-secondary);
  background-image: radial-gradient(var(--desk-dot) 1px, transparent 1px);
  background-size: 18px 18px;
  transition: var(--theme-transition);
}

@media (max-width: 768px) {

  .navbar {
    flex-direction: row;
    flex-wrap: wrap;
    height: auto;
    padding: 0.75rem 1rem;
  }


  .nav-brand {
    order: -2;
  }

  .nav-user {
    order: -1;
  }

  .desktop-only {
    display: none !important;
  }

  .hamburger-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.5rem;
    background-color: var(--color-bg-tertiary);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border-primary);
    border-radius: 0.375rem;
    cursor: pointer;
    transition: var(--transition-interactive);
  }

  .hamburger-btn:hover {
    background-color: var(--color-bg-hover);
    border-color: var(--color-border-secondary);
  }

  .hamburger-btn:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }

  .nav-menu {
    flex-basis: 100%;
    flex-direction: column;
    gap: 0.25rem;
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--color-border-primary);
  }

  .nav-menu:not(.open) {
    display: none;
  }


  .nav-item {
    padding: 0.75rem 1rem;
  }

  .mobile-extra {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-top: 0.5rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--color-border-primary);
  }


  .mobile-profile {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem;
    background: none;
    border: none;
    color: var(--color-text-primary);
    font-size: 0.9375rem;
    cursor: pointer;
    border-radius: 0.375rem;
    transition: var(--transition-interactive);
  }

  .mobile-profile:hover {
    background-color: var(--color-bg-hover);
  }

  .mobile-extra .logout-btn {
    width: 100%;
  }

  .main-content {
    padding: 1rem;
  }
}

:global([data-theme="dark"] .main-content) {
  --desk-dot: rgba(94, 182, 208, 0.055);
}
</style>