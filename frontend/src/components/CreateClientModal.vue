<template>
  <BaseModal @close="onClose">
    <template #title>
      <h3 class="title">Create Client</h3>
    </template>
    <form @submit.prevent="onSubmit" class="form">
      <label class="field">
        <span>Name</span>
        <input v-model.trim="name" type="text" required placeholder="e.g. Mobile Client" />
      </label>
      <p v-if="error" class="error">{{ error }}</p>
    </form>
    <template #footer>
      <button class="btn" @click="onClose" :disabled="submitting">Cancel</button>
      <button class="btn primary" @click="onSubmit" :disabled="submitting || !name">{{ submitting ? 'Creating...' : 'Create' }}</button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import BaseModal from './BaseModal.vue'
import { clientApi } from '@/services/api'

const emit = defineEmits<{ (e: 'close'): void; (e: 'created'): void }>()

const name = ref('')
const submitting = ref(false)
const error = ref('')

const onClose = () => emit('close')

const onSubmit = async () => {
  error.value = ''
  if (!name.value) {
    error.value = 'Name is required'
    return
  }
  submitting.value = true
  try {
    await clientApi.createClient({ name: name.value })
    emit('created')
    emit('close')
  } catch (e: any) {
    error.value = e?.errorDescription || 'Failed to create client'
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
