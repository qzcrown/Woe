<template>
  <BaseModal v-if="show && active" max-width="500px" @close="close">
    <template #title>
      <h2 class="title">{{ $t('plugins.editPlugin') }}</h2>
    </template>

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


        <div class="form-group">
          <label for="plugin-name">{{ $t('plugins.name') }}</label>
          <input
            id="plugin-name"
            v-model="editedName"
            type="text"
            class="input"
          />
        </div>


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
    <template #footer>
      <button @click="close" class="cancel-btn">{{ $t('common.cancel') }}</button>
      <button @click="save" :disabled="saving" class="save-btn">
        <LoadingSpinner v-if="saving" size="small" variant="dots" />
        <span v-else>{{ $t('common.save') }}</span>
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import LoadingSpinner from './LoadingSpinner.vue'
import PluginIcon from './PluginIcon.vue'
import BaseModal from './BaseModal.vue'
import { pluginApi } from '@/services/api'
import { createPluginUiHost, type PluginUiHost } from '@/plugins/host'
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


watch(() => props.plugin?.icon, (newIcon) => {
  localIcon.value = newIcon
}, { immediate: true })

const active = ref(false)
let host: PluginUiHost | undefined
const reset = () => { active.value = false; editedName.value = ''; editedConfig.value = ''; saving.value = false; uploadingIcon.value = false }
watch(() => [props.show, props.plugin.id] as const, async ([open, id]) => {
  host?.dispose(); reset()
  if (!open) return
  const current = host = createPluginUiHost({ ownerId: 0 })
  active.value = true
  current.signal.addEventListener('abort', reset, { once: true })
  editedName.value = props.plugin.name
  configExample.value = props.plugin.configExample || ''
  try {
    const res = await pluginApi.getConfig(id, current.requestOptions)
    if (current.isCurrent()) editedConfig.value = res.data || ''
  } catch (err) { current.notify.error(err, t('plugins.loadError')) }
}, { immediate: true, flush: 'sync' })
onUnmounted(() => host?.dispose())
const close = () => { host?.dispose(); reset(); emit('close') }
const handleIconUpload = async (file: File) => {
  const current = host; const id = props.plugin.id
  if (!current?.isCurrent()) return
  uploadingIcon.value = true
  try {
    const res = await pluginApi.uploadImage(id, file, current.requestOptions)
    if (!current.isCurrent()) return
    localIcon.value = res.data.icon; current.notify.success(t('plugins.iconUploaded')); emit('updated')
  } catch (err) { current.notify.error(err, t('plugins.iconUploadError')) }
  finally { if (current.isCurrent()) uploadingIcon.value = false }
}
const handleIconDelete = async () => {
  const current = host; const id = props.plugin.id
  if (!current?.isCurrent()) return
  try {
    await pluginApi.deleteImage(id, current.requestOptions)
    if (!current.isCurrent()) return
    localIcon.value = undefined; current.notify.success(t('plugins.iconDeleted')); emit('updated')
  } catch (err) { current.notify.error(err, t('plugins.iconDeleteError')) }
}
const save = async () => {
  const current = host; const id = props.plugin.id
  if (!current?.isCurrent() || !editedName.value || saving.value) return
  const name = editedName.value; const yaml = editedConfig.value
  saving.value = true
  try {
    if (name !== props.plugin.name) await pluginApi.updateName(id, name, current.requestOptions)
    if (!current.isCurrent()) return
    await pluginApi.updateConfig(id, yaml, current.requestOptions)
    if (!current.isCurrent()) return
    current.notify.success(t('plugins.updateSucceeded')); emit('updated'); close()
  } catch (err) { current.notify.error(err, t('plugins.updateError')) }
  finally { if (current.isCurrent()) saving.value = false }
}
</script>

<style scoped>
.title { margin: 0; font-size: 1.25rem; font-weight: 600; color: var(--color-text-primary); }

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

.form-group .input {
  padding: 0.625rem;
  border: 1px solid var(--color-border-secondary);
  border-radius: 0.375rem;
  font-size: 0.875rem;
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  transition: var(--transition-interactive);
}

.form-group .input:focus {
  outline: none;
  border-color: var(--color-border-focus);
  box-shadow: 0 0 0 3px var(--color-primary-light);
}

.config-textarea {
  width: 100%;
  min-height: 200px;
  padding: 0.75rem;
  border: 1px solid var(--color-border-secondary);
  border-radius: 0.375rem;
  font-family: 'Courier New', monospace;
  font-size: 0.875rem;
  resize: vertical;
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  transition: var(--transition-interactive);
}

.config-textarea:focus {
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
  transition: var(--transition-interactive);
}

.cancel-btn:hover {
  background: var(--color-bg-active);
}

.save-btn {
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
  transition: var(--transition-interactive);
}

.save-btn:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.save-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
</style>
