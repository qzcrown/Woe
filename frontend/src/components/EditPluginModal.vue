<template>
  <div v-if="show" class="modal-overlay" @click.self="close">
    <div class="modal-content" @click.stop>
      <div class="modal-header">
        <h2>{{ $t('plugins.editPlugin') }}</h2>
        <button @click="close" class="close-btn">&times;</button>
      </div>

      <div class="modal-body">
        <!-- Icon Section -->
        <div class="form-group">
          <label>{{ $t('plugins.icon') }}</label>
          <PluginIcon
            :name="plugin.name"
            :icon="localIcon"
            size="large"
            :show-upload-overlay="true"
            :show-delete-button="true"
            :uploading="uploadingIcon"
            @upload="handleIconUpload"
            @delete="handleIconDelete"
          />
        </div>

        <!-- Name Section -->
        <div class="form-group">
          <label for="plugin-name">{{ $t('plugins.name') }}</label>
          <input
            id="plugin-name"
            v-model="editedName"
            type="text"
            class="input"
          />
        </div>

        <!-- Config Section -->
        <div class="form-group">
          <label for="plugin-config">{{ $t('plugins.configuration') }}</label>
          <textarea
            id="plugin-config"
            v-model="editedConfig"
            class="config-textarea"
            :placeholder="configExample || $t('plugins.configPlaceholder')"
            spellcheck="false"
          ></textarea>
        </div>
      </div>

      <div class="modal-footer">
        <button @click="close" class="cancel-btn">{{ $t('common.cancel') }}</button>
        <button @click="save" :disabled="saving" class="save-btn">
          <LoadingSpinner v-if="saving" size="small" variant="dots" />
          <span v-else>{{ $t('common.save') }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import LoadingSpinner from './LoadingSpinner.vue'
import PluginIcon from './PluginIcon.vue'
import { pluginApi } from '@/services/api'
import { showSuccess, showError } from '@/utils/errorHandler'
import type { Plugin } from '@/types'

const props = defineProps<{
  show: boolean
  plugin: Plugin
}>()

const emit = defineEmits<{
  close: []
  updated: []
}>()

const { t } = useI18n()

const editedName = ref('')
const editedConfig = ref('')
const configExample = ref('')
const saving = ref(false)
const uploadingIcon = ref(false)
const localIcon = ref<string | undefined>()

// Sync props.plugin.icon to localIcon (with immediate execution)
watch(() => props.plugin?.icon, (newIcon) => {
  localIcon.value = newIcon
}, { immediate: true })

// Load plugin config when modal opens
watch(() => props.show, async (isOpen) => {
  if (isOpen && props.plugin) {
    editedName.value = props.plugin.name
    configExample.value = props.plugin.configExample || ''
    try {
      const res = await pluginApi.getConfig(props.plugin.id)
      editedConfig.value = res.data || ''
    } catch {
      editedConfig.value = ''
    }
  }
})

const close = () => {
  emit('close')
}

const handleIconUpload = async (file: File) => {
  uploadingIcon.value = true
  try {
    const res = await pluginApi.uploadImage(props.plugin.id, file)
    localIcon.value = res.data.icon
    showSuccess(t('plugins.iconUploaded'))
    emit('updated')
  } catch (err: any) {
    showError(err, t('plugins.iconUploadError'))
  } finally {
    uploadingIcon.value = false
  }
}

const handleIconDelete = async () => {
  try {
    await pluginApi.deleteImage(props.plugin.id)
    localIcon.value = undefined
    showSuccess(t('plugins.iconDeleted'))
    emit('updated')
  } catch (err: any) {
    showError(err, t('plugins.iconDeleteError'))
  }
}

const save = async () => {
  if (!editedName.value) return

  saving.value = true
  try {
    // Update name if changed
    if (editedName.value !== props.plugin.name) {
      await pluginApi.updateName(props.plugin.id, editedName.value)
    }
    // Update config
    await pluginApi.updateConfig(props.plugin.id, editedConfig.value)
    showSuccess(t('plugins.updateSucceeded'))
    emit('updated')
    close()
  } catch (err: any) {
    showError(err, t('plugins.updateError'))
  } finally {
    saving.value = false
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
  max-height: 90vh;
  overflow-y: auto;
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

.form-group .input {
  padding: 0.625rem;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  font-size: 0.875rem;
}

.form-group .input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.config-textarea {
  width: 100%;
  min-height: 200px;
  padding: 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  font-family: 'Courier New', monospace;
  font-size: 0.875rem;
  resize: vertical;
}

.config-textarea:focus {
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

.save-btn {
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

.save-btn:hover:not(:disabled) {
  background: #2563eb;
}

.save-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
</style>
