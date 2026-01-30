<template>
  <div v-if="show" class="modal-overlay" @click="close">
    <div class="modal-content" @click.stop>
      <div class="modal-header">
        <h2>{{ $t('plugins.addPlugin') }}</h2>
        <button @click="close" class="close-btn">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label for="plugin-type">{{ $t('plugins.type') }}</label>
          <select id="plugin-type" v-model="selectedType">
            <option v-for="type in availableTypes" :key="type.value" :value="type.value">
              {{ type.label }}
            </option>
          </select>
        </div>
        <div class="form-group">
          <label for="plugin-name">{{ $t('plugins.name') }}</label>
          <input
            id="plugin-name"
            v-model="name"
            type="text"
            :placeholder="$t('plugins.namePlaceholder')"
            @keyup.enter="submit"
          />
        </div>
      </div>
      <div class="modal-footer">
        <button @click="close" class="cancel-btn">{{ $t('common.cancel') }}</button>
        <button @click="submit" :disabled="!name || creating" class="submit-btn">
          <LoadingSpinner v-if="creating" size="small" variant="dots" />
          <span v-else>{{ $t('common.create') }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import LoadingSpinner from './LoadingSpinner.vue'
import { pluginApi } from '@/services/api'
import { showSuccess, showError } from '@/utils/errorHandler'

const props = defineProps<{
  show: boolean
  targetUserId?: number
}>()

const emit = defineEmits<{
  close: []
  created: []
}>()

const { t } = useI18n()

// Available plugin types (可扩展)
const availableTypes = [
  { value: 'builtin/webhooker', label: 'Webhooker' },
  { value: 'builtin/displayer', label: 'Displayer' }
]

const selectedType = ref('builtin/webhooker')
const name = ref('')
const creating = ref(false)

const close = () => {
  name.value = ''
  emit('close')
}

const submit = async () => {
  if (!name.value) return

  creating.value = true
  try {
    await pluginApi.createPlugin(selectedType.value, name.value, props.targetUserId)
    showSuccess(t('plugins.createSuccess'))
    emit('created')
    close()
  } catch (err: any) {
    showError(err, t('plugins.createError'))
  } finally {
    creating.value = false
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: white;
  border-radius: 0.75rem;
  width: 90%;
  max-width: 500px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 1px solid #e5e7eb;
}

.modal-header h2 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: #6b7280;
  padding: 0;
  width: 2rem;
  height: 2rem;
}

.close-btn:hover {
  color: #1f2937;
}

.modal-body {
  padding: 1.5rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.form-group label {
  font-size: 0.875rem;
  font-weight: 500;
  color: #374151;
}

.form-group input,
.form-group select {
  padding: 0.625rem;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  font-size: 0.875rem;
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid #e5e7eb;
}

.cancel-btn {
  padding: 0.5rem 1rem;
  background: #f3f4f6;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-weight: 500;
}

.cancel-btn:hover {
  background: #e5e7eb;
}

.submit-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-weight: 500;
}

.submit-btn:hover:not(:disabled) {
  background: #2563eb;
}

.submit-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
</style>
