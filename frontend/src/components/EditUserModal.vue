<template>
  <BaseModal @close="onClose">
    <template #title>
      <h3 class="title">Edit User</h3>
    </template>
    <form @submit.prevent="onSubmit" class="form">
      <label class="field">
        <span>Username</span>
        <input v-model.trim="name" type="text" required :placeholder="user.name" />
      </label>
      <label class="field" v-if="canSetAdmin">
        <span>Administrator</span>
        <input type="checkbox" v-model="admin" />
      </label>
      <label class="field">
        <span>New Password (leave blank to keep current)</span>
        <input v-model="pass" type="password" placeholder="Enter new password (optional)" />
      </label>
      <p v-if="error" class="error">{{ error }}</p>
    </form>
    <template #footer>
      <button class="btn" @click="onClose" :disabled="submitting">Cancel</button>
      <button class="btn primary" @click="onSubmit" :disabled="submitting || !name">
        {{ submitting ? 'Updating...' : 'Update' }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import BaseModal from './BaseModal.vue'
import { userApi } from '@/services/api'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{
  user: any
}>()

const emit = defineEmits<{ (e: 'close'): void; (e: 'updated'): void }>()

const authStore = useAuthStore()
const name = ref(props.user.name)
const admin = ref(props.user.admin)
const pass = ref('')
const submitting = ref(false)
const error = ref('')

// 仅管理员可设置 admin；若系统开启公开注册，后端会拒绝 admin=true，前端也禁止
const canSetAdmin = computed(() => !!authStore.user?.admin)

const onClose = () => emit('close')

const onSubmit = async () => {
  error.value = ''
  if (!name.value) {
    error.value = 'Username is required'
    return
  }
  if (pass.value && pass.value.length < 6) {
    error.value = 'Password must be at least 6 characters'
    return
  }
  submitting.value = true
  try {
    const updateData: any = {
      name: name.value,
      admin: canSetAdmin.value ? admin.value : false,
    }
    // 只在新密码非空时包含pass字段
    if (pass.value) {
      updateData.pass = pass.value
    }
    await userApi.updateUser(props.user.id, updateData)
    emit('updated')
    emit('close')
  } catch (e: any) {
    error.value = e?.errorDescription || 'Failed to update user'
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
.btn.primary { background: #3b82f6; color: white; }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
