<template>
  <div v-if="show" class="modal-overlay" @click="close">
    <div class="modal-content" @click.stop>
      <div class="modal-header">
        <h2>{{ $t('plugins.addPlugin') }}</h2>
        <button type="button" @click="close" class="close-btn"
          :title="$t('common.close')" :aria-label="$t('common.close')">
          <X :size="16" aria-hidden="true" />
        </button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label for="plugin-type">{{ $t('plugins.type') }}</label>
          <select id="plugin-type" v-model="selectedType" :disabled="loadingTypes">
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
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { X } from '@lucide/vue'
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


const availableTypes = ref<{ value: string; label: string }[]>([])
const loadingTypes = ref(false)
const selectedType = ref('')
const name = ref('')
const creating = ref(false)


const loadAvailableTypes = async () => {
  loadingTypes.value = true
  try {
    const res = await pluginApi.getAvailablePlugins()
    availableTypes.value = res.data.map(p => ({
      value: p.modulePath,
      label: p.name
    }))

    if (availableTypes.value.length > 0 && !selectedType.value) {
      selectedType.value = availableTypes.value[0].value
    }
  } catch (err) {
    console.error('Failed to load available plugins:', err)
  } finally {
    loadingTypes.value = false
  }
}

onMounted(() => {
  loadAvailableTypes()
})

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
  background: var(--color-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--color-bg-primary);
  border-radius: 0.75rem;
  width: 90%;
  max-width: 500px;
  box-shadow: var(--shadow-lg);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 1px solid var(--color-border-primary);
}

.modal-header h2 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.close-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-tertiary);
  padding: 0;
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: var(--theme-transition);
}

.close-btn:hover {
  color: var(--color-text-primary);
}

.close-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
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
  color: var(--color-text-secondary);
}

.form-group input,
.form-group select {
  padding: 0.625rem;
  border: 1px solid var(--color-border-secondary);
  border-radius: 0.375rem;
  font-size: 0.875rem;
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  transition: var(--theme-transition);
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: var(--color-border-focus);
  box-shadow: 0 0 0 3px var(--color-primary-light);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--color-border-primary);
}

.cancel-btn {
  padding: 0.5rem 1rem;
  background: var(--color-bg-hover);
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-weight: 500;
  color: var(--color-text-secondary);
  transition: var(--theme-transition);
}

.cancel-btn:hover {
  background: var(--color-bg-active);
}

.submit-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: var(--color-primary);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-weight: 500;
  transition: var(--theme-transition);
}

.submit-btn:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.submit-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
</style>
