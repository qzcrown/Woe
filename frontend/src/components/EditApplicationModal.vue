<template>
  <BaseModal @close="onClose">
    <template #title>
      <h3 class="title">Edit Application</h3>
    </template>
    <form @submit.prevent="onSubmit" class="form">
      <label class="field">
        <span>Name</span>
        <input v-model.trim="name" type="text" required :placeholder="application.name" />
      </label>
      <label class="field">
        <span>Description</span>
        <textarea v-model.trim="description" :placeholder="application.description || 'Optional description'" />
      </label>
      <label class="field">
        <span>Default Priority</span>
        <input v-model.number="defaultPriority" type="number" min="0" max="3" :placeholder="application.defaultPriority?.toString() || '0'" />
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
import { ref } from 'vue'
import BaseModal from './BaseModal.vue'
import { applicationApi } from '@/services/api'

const props = defineProps<{
  application: any
}>()

const emit = defineEmits<{ (e: 'close'): void; (e: 'updated'): void }>()

const name = ref(props.application.name)
const description = ref(props.application.description || '')
const defaultPriority = ref<number | undefined>(props.application.defaultPriority)
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
    await applicationApi.updateApplication(props.application.id, {
      name: name.value,
      description: description.value || undefined,
      defaultPriority: defaultPriority.value,
    })
    emit('updated')
    emit('close')
  } catch (e: any) {
    error.value = e?.errorDescription || 'Failed to update application'
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
.btn.primary { background: #3b82f6; color: white; }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
