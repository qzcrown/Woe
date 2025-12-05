<template>
  <BaseModal @close="onClose">
    <template #title>
      <h3 class="title">Create Application</h3>
    </template>
    <form @submit.prevent="onSubmit" class="form">
      <label class="field">
        <span>Name</span>
        <input v-model.trim="name" type="text" required placeholder="e.g. Notification App" />
      </label>
      <label class="field">
        <span>Description</span>
        <textarea v-model.trim="description" placeholder="Optional description" />
      </label>
      <label class="field">
        <span>Default Priority</span>
        <input v-model.number="defaultPriority" type="number" min="0" max="3" placeholder="0-3" />
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
import { applicationApi } from '@/services/api'

const emit = defineEmits<{ (e: 'close'): void; (e: 'created'): void }>()

const name = ref('')
const description = ref('')
const defaultPriority = ref<number | undefined>(undefined)
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
    await applicationApi.createApplication({
      name: name.value,
      description: description.value || undefined,
      defaultPriority: defaultPriority.value,
    })
    emit('created')
    emit('close')
  } catch (e: any) {
    error.value = e?.errorDescription || 'Failed to create application'
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
input, textarea { border: 1px solid #e5e7eb; border-radius: 0.375rem; padding: 0.5rem; font-size: 0.875rem; }
textarea { min-height: 80px; resize: vertical; }
.error { color: #b91c1c; font-size: 0.875rem; }
.btn { padding: 0.5rem 1rem; border: none; border-radius: 0.375rem; cursor: pointer; background: #e5e7eb; }
.btn.primary { background: #10b981; color: white; }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
