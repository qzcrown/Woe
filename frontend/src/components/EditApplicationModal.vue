<template>
  <BaseModal @close="onClose">
    <template #title>
      <h3 class="title">{{ t('editApplication.title') }}</h3>
    </template>
    <form @submit.prevent="onSubmit" class="form">
      <label class="field">
        <span>{{ t('editApplication.name') }}</span>
        <input v-model.trim="name" type="text" required :placeholder="application.name" />
      </label>
      <label class="field">
        <span>{{ t('editApplication.description') }}</span>
        <textarea v-model.trim="description" :placeholder="application.description || t('editApplication.descriptionPlaceholder')" />
      </label>
      <label class="field">
        <span>{{ t('editApplication.defaultPriority') }}</span>
        <input v-model.number="defaultPriority" type="number" min="0" max="3" :placeholder="application.defaultPriority?.toString() || '0'" />
      </label>
      <p v-if="error" class="error">{{ error }}</p>
    </form>
    <template #footer>
      <button class="btn" @click="onClose" :disabled="submitting">{{ t('editApplication.cancel') }}</button>
      <button class="btn primary" @click="onSubmit" :disabled="submitting || !name">
        {{ submitting ? t('editApplication.updating') : t('editApplication.update') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from './BaseModal.vue'
import { applicationApi } from '@/services/api'




const { t } = useI18n()

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
    error.value = t('editApplication.nameRequired')
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
    error.value = e?.errorDescription || t('editApplication.updateError')
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.title { margin: 0; font-size: 1.125rem; font-weight: 600; color: var(--color-text-primary); }
.form { display: flex; flex-direction: column; gap: 0.75rem; }
.field { display: flex; flex-direction: column; gap: 0.375rem; }
.field span { color: var(--color-text-secondary); font-size: 0.875rem; }
input, textarea {
  border: 1px solid var(--color-border-primary);
  border-radius: 0.375rem;
  padding: 0.5rem;
  font-size: 0.875rem;
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  transition: var(--transition-interactive);
}
input:focus, textarea:focus {
  outline: none;
  border-color: var(--color-border-focus);
}
textarea { min-height: 80px; resize: vertical; }
.error { color: var(--color-error); font-size: 0.875rem; }
.btn {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  background: var(--color-bg-active);
  color: var(--color-text-secondary);
  transition: var(--transition-interactive);
}
.btn.primary { background: var(--color-primary); color: var(--color-text-inverse); }
.btn.primary:hover { background: var(--color-primary-hover); }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
