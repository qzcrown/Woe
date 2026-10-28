<template>
  <BaseModal v-if="show && active" max-width="500px" @close="close">
    <template #title>
      <h2 class="title">{{ $t('plugins.addPlugin') }}</h2>
    </template>
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
    <template #footer>
      <button @click="close" class="cancel-btn">{{ $t('common.cancel') }}</button>
      <button @click="submit" :disabled="!name || creating" class="submit-btn">
        <LoadingSpinner v-if="creating" size="small" variant="dots" />
        <span v-else>{{ $t('common.create') }}</span>
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import LoadingSpinner from './LoadingSpinner.vue'
import BaseModal from './BaseModal.vue'
import { pluginApi } from '@/services/api'
import { createPluginUiHost, type PluginUiHost } from '@/plugins/host'

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

const active = ref(false)
let host: PluginUiHost | undefined
const reset = () => { active.value = false; name.value = ''; selectedType.value = ''; availableTypes.value = []; creating.value = false; loadingTypes.value = false }
watch(() => [props.show, props.targetUserId] as const, async ([open, owner]) => {
  host?.dispose(); reset()
  if (!open) return
  const current = host = createPluginUiHost({ ownerId: owner ?? 0 })
  active.value = true; loadingTypes.value = true
  current.signal.addEventListener('abort', reset, { once: true })
  try {
    const res = await pluginApi.getAvailablePlugins(current.requestOptions)
    if (!current.isCurrent()) return
    availableTypes.value = res.data.map(p => ({ value: p.modulePath, label: p.name }))
    selectedType.value = availableTypes.value[0]?.value ?? ''
  } catch (err) { current.notify.error(err, t('plugins.loadError')) }
  finally { if (current.isCurrent()) loadingTypes.value = false }
}, { immediate: true, flush: 'sync' })
onUnmounted(() => host?.dispose())
const close = () => { host?.dispose(); reset(); emit('close') }
const submit = async () => {
  const current = host; const owner = props.targetUserId
  if (!current?.isCurrent() || !name.value || creating.value) return
  creating.value = true
  try {
    await pluginApi.createPlugin(selectedType.value, name.value, owner, current.requestOptions)
    if (!current.isCurrent()) return
    current.notify.success(t('plugins.createSuccess')); emit('created'); close()
  } catch (err) { current.notify.error(err, t('plugins.createError')) }
  finally { if (current.isCurrent()) creating.value = false }
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

.form-group input,
.form-group select {
  padding: 0.625rem;
  border: 1px solid var(--color-border-secondary);
  border-radius: 0.375rem;
  font-size: 0.875rem;
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  transition: var(--transition-interactive);
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
  transition: var(--transition-interactive);
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
  transition: var(--transition-interactive);
}

.submit-btn:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.submit-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
</style>
