<template>
  <BaseModal @close="onClose">
    <template #title>
      <h3 class="title">Create User</h3>
    </template>
    <form @submit.prevent="onSubmit" class="form">
      <label class="field">
        <span>Username</span>
        <input v-model.trim="name" type="text" required placeholder="e.g. alice" />
      </label>
      <label class="field">
        <span>Password</span>
        <input v-model="pass" type="password" required placeholder="Enter strong password" />
      </label>
      <label class="field" v-if="canSetAdmin">
        <span>Administrator</span>
        <input type="checkbox" v-model="admin" />
      </label>
      <p v-if="error" class="error">{{ error }}</p>
    </form>
    <template #footer>
      <button class="btn" @click="onClose" :disabled="submitting">Cancel</button>
      <button class="btn primary" @click="onSubmit" :disabled="submitting || !name || !pass">{{ submitting ? 'Creating...' : 'Create' }}</button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import BaseModal from './BaseModal.vue'
import { userApi } from '@/services/api'
import { useAuthStore } from '@/stores/auth'

const emit = defineEmits<{ (e: 'close'): void; (e: 'created'): void }>()

const authStore = useAuthStore()
const name = ref('')
const pass = ref('')
const admin = ref(false)
const submitting = ref(false)
const error = ref('')

// 仅管理员可设置 admin；若系统开启公开注册，后端会拒绝 admin=true，前端也禁止
const canSetAdmin = computed(() => !!authStore.user?.admin)

const onClose = () => emit('close')

const onSubmit = async () => {
  error.value = ''
  if (!name.value || !pass.value) {
    error.value = 'Username and password are required'
    return
  }
  if (pass.value.length < 6) {
    error.value = 'Password must be at least 6 characters'
    return
  }
  submitting.value = true
  try {
    await userApi.createUser({ name: name.value, pass: pass.value, admin: canSetAdmin.value ? admin.value : false })
    emit('created')
    emit('close')
  } catch (e: any) {
    error.value = e?.errorDescription || 'Failed to create user'
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.title { margin: 0; font-size: 1.125rem; font-weight: 600; }
.form { display: flex; flex-direction: column; gap: 0.75rem; }
.field { display: flex; flex-direction: column; gap: 0.375rem; }
.field span { color: #374151; font-size: 0.875rem; }
input { border: 1px solid #e5e7eb; border-radius: 0.375rem; padding: 0.5rem; font-size: 0.875rem; }
.error { color: #b91c1c; font-size: 0.875rem; }
.btn { padding: 0.5rem 1rem; border: none; border-radius: 0.375rem; cursor: pointer; background: #e5e7eb; }
.btn.primary { background: #10b981; color: white; }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
