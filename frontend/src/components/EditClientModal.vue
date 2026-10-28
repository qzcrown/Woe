<template>
  <BaseModal @close="onClose">
    <template #title>
      <h3 class="title">{{ t('clients.editTitle') }}</h3>
    </template>
    <form @submit.prevent="onSubmit" class="form">
      <label class="field">
        <span>{{ t('clients.name') }}</span>
        <input v-model.trim="name" type="text" required :placeholder="client.name" />
      </label>

      <p v-if="client.elevatedUntil" class="elevated-row">
        <span>{{ t('clients.elevatedUntil') }}:</span>
        <code>{{ elevatedUntilText }}</code>
      </p>
      <p v-if="error" class="error">{{ error }}</p>
    </form>
    <template #footer>
      <button class="btn" @click="onClose" :disabled="submitting">{{ t('common.cancel') }}</button>
      <button class="btn primary" @click="onSubmit" :disabled="submitting || !name">
        {{ submitting ? t('clients.updating') : t('clients.update') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from './BaseModal.vue'
import { clientApi } from '@/services/api'
import { formatDateTime } from '@/utils/datetime'

const { t } = useI18n()

const props = defineProps<{
  client: any
}>()

const emit = defineEmits<{ (e: 'close'): void; (e: 'updated'): void }>()

const name = ref(props.client.name)
const submitting = ref(false)
const error = ref('')

const elevatedUntilText = computed(() => formatDateTime(props.client.elevatedUntil))

const onClose = () => emit('close')

const onSubmit = async () => {
  error.value = ''
  if (!name.value) {
    error.value = t('clients.nameRequired')
    return
  }
  submitting.value = true
  try {
    await clientApi.updateClient(props.client.id, {
      name: name.value,
    })
    emit('updated')
    emit('close')
  } catch (e: any) {
    error.value = e?.errorDescription || t('clients.updateError')
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
input {
  border: 1px solid var(--color-border-primary);
  border-radius: 0.375rem;
  padding: 0.5rem;
  font-size: 0.875rem;
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  transition: var(--transition-interactive);
}
input:focus {
  outline: none;
  border-color: var(--color-border-focus);
}
.elevated-row {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin: 0;
  padding: 0.5rem 0.625rem;
  background: var(--color-bg-hover);
  border-radius: 0.375rem;
  font-size: 0.875rem;
  color: var(--color-text-secondary);
}
.elevated-row code {
  font-family: 'Courier New', monospace;
  color: var(--color-text-primary);
  word-break: break-all;
}
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
