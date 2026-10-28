<template>
  <div class="setup-container">
    <div class="setup-card">
      <h2>{{ $t('setup.title') }}</h2>
      <p class="desc">{{ $t('setup.subtitle') }}</p>

      <form @submit.prevent="submit" class="setup-form">
        <div class="form-group">
          <label for="initUser">{{ $t('setup.initTokenUsername') }}</label>
          <input id="initUser" v-model="initUser" type="text" required :disabled="loading" :placeholder="$t('setup.initTokenUsername')" />
        </div>

        <div class="form-group">
          <label for="initPass">{{ $t('setup.initTokenPassword') }}</label>
          <input id="initPass" v-model="initPass" type="password" required :disabled="loading" :placeholder="$t('setup.initTokenPassword')" />
        </div>
        <div class="form-group">
          <label for="name">{{ $t('setup.adminUser') }}</label>
          <input id="name" v-model="name" type="text" required :disabled="loading" :placeholder="$t('common.username')" />
        </div>

        <div class="form-group">
          <label for="pass">{{ $t('common.password') }}</label>
          <input id="pass" v-model="pass" type="password" required :disabled="loading" :placeholder="$t('setup.adminPassword')" />
        </div>

        <div class="form-group">
          <label for="confirm">{{ $t('setup.confirmPassword') }}</label>
          <input id="confirm" v-model="confirm" type="password" required :disabled="loading" :placeholder="$t('setup.confirmPassword')" />
        </div>

        <div v-if="error" class="error">{{ error }}</div>
        <div v-if="success" class="success">{{ $t('setup.success') }}</div>

        <button type="submit" :disabled="loading" class="setup-btn">
          {{ loading ? $t('common.loading') : $t('setup.submit') }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import api from '@/services/api'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

const router = useRouter()
const { t } = useI18n()
const name = ref('')
const pass = ref('')
const confirm = ref('')
const loading = ref(false)
const error = ref('')
const success = ref(false)
const initUser = ref('')
const initPass = ref('')

const submit = async () => {
  error.value = ''
  success.value = false
  if (pass.value !== confirm.value) {
    error.value = t('setup.error.passwordMismatch')
    return
  }
  if (pass.value.length < 8) {
    error.value = t('setup.error.passwordTooShort')
    return
  }
  loading.value = true
  try {
    await api.post('/init/admin', { name: name.value, pass: pass.value }, { auth: { username: initUser.value, password: initPass.value } })
    success.value = true
    setTimeout(() => router.push('/login'), 1200)
  } catch (e: any) {
    error.value = e?.message || t('setup.error.initializationFailed')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.setup-container { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--color-bg-secondary); padding: 1rem; transition: var(--theme-transition); }
.setup-card { background: var(--color-bg-primary); padding: 2rem; border-radius: 1rem; box-shadow: var(--shadow-lg); width: 100%; max-width: 460px; transition: var(--theme-transition); }
.desc { color: var(--color-text-tertiary); margin-bottom: 1rem; }
.setup-form { display: flex; flex-direction: column; gap: 1rem; }
.form-group { display: flex; flex-direction: column; gap: 0.5rem; }
label { color: var(--color-text-primary); font-weight: 500; }
input { padding: 0.75rem; border: 1px solid var(--color-border-secondary); border-radius: 0.375rem; font-size: 1rem; background: var(--color-bg-primary); color: var(--color-text-primary); transition: var(--transition-interactive); }
input:focus { outline: none; border-color: var(--color-border-focus); box-shadow: 0 0 0 3px var(--color-primary-light); }
.error { color: var(--color-error); background: var(--color-error-bg); border: 1px solid var(--color-error); padding: 0.5rem; border-radius: 0.375rem; }
.success { color: var(--color-success); background: var(--color-success-bg); border: 1px solid var(--color-success); padding: 0.5rem; border-radius: 0.375rem; }
.setup-btn { padding: 0.75rem 1.5rem; background: var(--color-primary); color: var(--color-text-inverse); border: none; border-radius: 0.375rem; font-size: 1rem; cursor: pointer; transition: var(--transition-interactive); }
.setup-btn:hover:not(:disabled) { background: var(--color-primary-hover); }
.setup-btn:disabled { background: var(--color-text-muted); cursor: not-allowed; }
</style>
