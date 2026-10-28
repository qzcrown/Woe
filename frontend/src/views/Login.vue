<template>
  <div class="login-container">
    <div class="login-card">
      <div class="login-header">
        <div class="brand-row">
          <h1>{{ $t('login.title') }}</h1>
          <span class="brand-stamp">{{ $t('login.selfHosted') }}</span>
        </div>
        <p class="brand-eyebrow">{{ $t('login.brandEyebrow') }}</p>
      </div>

  <form @submit.prevent="handleLogin" class="login-form">
        <div class="form-group">
          <label for="username">{{ $t('common.username') }}</label>
          <input
            id="username"
            v-model="username"
            type="text"
            required
            :disabled="loading"
            :placeholder="$t('login.usernamePlaceholder')"
          />
        </div>

        <div class="form-group">
          <label for="password">{{ $t('common.password') }}</label>
          <input
            id="password"
            v-model="password"
            type="password"
            required
            :disabled="loading"
            :placeholder="$t('login.passwordPlaceholder')"
          />
        </div>

        <div v-if="error" class="error-message">
          {{ error }}
        </div>

        <button type="submit" :disabled="loading" class="login-btn">
          {{ loading ? $t('login.loggingIn') : $t('common.login') }}
        </button>
      </form>

      <p class="brand-foot">{{ $t('login.brandFoot') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useI18n } from 'vue-i18n'

const router = useRouter()
const authStore = useAuthStore()
const { t } = useI18n()

const username = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

const handleLogin = async () => {
  loading.value = true
  error.value = ''

  try {
    const success = await authStore.login(username.value, password.value)

    if (success) {
      router.push('/')
    } else {
      error.value = t('login.error.invalidCredentials')
    }
  } catch (err: any) {
    if (err?.responseData?.errorCode === 403) {
      error.value = t('login.error.systemNotInitialized')
    } else {
      error.value = t('login.error.loginFailed')
    }
    console.error('Login error:', err)
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>

.login-container {
  --login-dot: rgba(148, 163, 184, 0.38);
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--color-bg-secondary);
  background-image: radial-gradient(var(--login-dot) 1px, transparent 1px);
  background-size: 18px 18px;
  padding: 1rem;
}

:global([data-theme="dark"] .login-container) {
  --login-dot: rgba(94, 182, 208, 0.09);
}

.login-card {
  position: relative;
  background: var(--color-bg-primary);
  padding: 2rem;
  border-radius: 0.75rem;
  border: 1px solid var(--color-border-primary);
  box-shadow: var(--shadow-lg);
  width: 100%;
  max-width: 400px;
}


.login-card::before {
  content: '';
  position: absolute;
  top: 10px;
  left: 18px;
  right: 18px;
  border-top: 2px dashed var(--color-border-secondary);
}

.login-header {
  margin-bottom: 1.75rem;
}

.brand-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.login-header h1 {
  color: var(--color-text-primary);
  font-size: 1.5rem;
  font-weight: bold;
  letter-spacing: 0.02em;
  margin: 0;
}


.brand-stamp {
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 0.625rem;
  letter-spacing: 0.18em;
  color: var(--color-primary);
  border: 1.5px solid var(--color-primary);
  border-radius: 0.25rem;
  padding: 0.2rem 0.45rem;
  transform: rotate(4deg);
  opacity: 0.9;
  white-space: nowrap;
}

.brand-eyebrow {
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 0.625rem;
  letter-spacing: 0.22em;
  color: var(--color-text-tertiary);
  margin: 0.5rem 0 0;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  color: var(--color-text-secondary);
  font-weight: 500;
  font-size: 0.875rem;
}

.form-group input {
  padding: 0.75rem;
  border: 1px solid var(--color-border-secondary);
  border-radius: 0.375rem;
  font-size: 1rem;
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  transition: border-color 0.2s, box-shadow 0.2s;
}

.form-group input:focus {
  outline: none;
  border-color: var(--color-border-focus);
  box-shadow: 0 0 0 3px var(--color-primary-light);
}

.form-group input:disabled {
  background-color: var(--color-bg-tertiary);
  color: var(--color-text-tertiary);
}

.error-message {
  color: var(--color-error);
  font-size: 0.875rem;
  text-align: center;
  padding: 0.75rem;
  background-color: var(--color-error-bg);
  border: 1px solid var(--color-error);
  border-radius: 0.375rem;
}

.login-btn {
  padding: 0.75rem 1.5rem;
  background-color: var(--color-primary);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.login-btn:hover:not(:disabled) {
  background-color: var(--color-primary-hover);
}

.login-btn:disabled {
  background-color: var(--color-text-muted);
  cursor: not-allowed;
}

.brand-foot {
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 0.625rem;
  letter-spacing: 0.14em;
  color: var(--color-text-tertiary);
  margin: 1.5rem 0 0;
  padding-top: 0.75rem;
  border-top: 1px solid var(--color-border-primary);
}

@media (max-width: 480px) {
  .login-card {
    padding: 1.5rem;
  }

  .login-header h1 {
    font-size: 1.35rem;
  }
}
</style>
