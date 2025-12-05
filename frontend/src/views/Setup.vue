<template>
  <div class="setup-container">
    <div class="setup-card">
      <h2>{{ $t('setup.title') }}</h2>
      <p class="desc">{{ $t('setup.subtitle') }}</p>

      <form @submit.prevent="submit" class="setup-form">
        <div class="form-group">
          <label for="initUser">{{ $t('setup.initToken') }} {{ $t('common.username') }}</label>
          <input id="initUser" v-model="initUser" type="text" required :disabled="loading" :placeholder="$t('setup.initToken') + ' ' + $t('common.username')" />
        </div>

        <div class="form-group">
          <label for="initPass">{{ $t('setup.initToken') }} {{ $t('common.password') }}</label>
          <input id="initPass" v-model="initPass" type="password" required :disabled="loading" :placeholder="$t('setup.initToken') + ' ' + $t('common.password')" />
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
.setup-container { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f3f4f6; padding: 1rem; }
.setup-card { background: #fff; padding: 2rem; border-radius: 1rem; box-shadow: 0 10px 20px rgba(0,0,0,0.08); width: 100%; max-width: 460px; }
.desc { color: #6b7280; margin-bottom: 1rem; }
.setup-form { display: flex; flex-direction: column; gap: 1rem; }
.form-group { display: flex; flex-direction: column; gap: 0.5rem; }
label { color: #374151; font-weight: 500; }
input { padding: 0.75rem; border: 1px solid #d1d5db; border-radius: 0.375rem; font-size: 1rem; }
.error { color: #b91c1c; background: #fee2e2; border: 1px solid #fecaca; padding: 0.5rem; border-radius: 0.375rem; }
.success { color: #065f46; background: #d1fae5; border: 1px solid #a7f3d0; padding: 0.5rem; border-radius: 0.375rem; }
.setup-btn { padding: 0.75rem 1.5rem; background: #10b981; color: #fff; border: none; border-radius: 0.375rem; font-size: 1rem; cursor: pointer; }
.setup-btn:hover { background: #059669; }
</style>
