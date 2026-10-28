<template>
  <div class="config-editor">
    <textarea
      v-model="configText"
      class="config-textarea"
      :placeholder="plugin.configExample || 'Enter YAML configuration...'"
      spellcheck="false"
    ></textarea>
    <div class="config-actions">
      <button class="save-btn" :disabled="saving" @click="emit('save', configText)">
        <LoadingSpinner v-if="saving" size="small" variant="dots" />
        <span v-else>{{ t('common.save') }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import LoadingSpinner from '@/components/LoadingSpinner.vue'
import type { ConfigEditorEmits, ConfigEditorProps } from './types'






const props = defineProps<ConfigEditorProps>()
const emit = defineEmits<ConfigEditorEmits>()

const { t } = useI18n()

const configText = ref(props.configYaml)
</script>

<style scoped>
.config-editor {
  padding: 0 1.5rem 1.5rem;
}

.config-textarea {
  width: 100%;
  min-height: 300px;
  padding: 1rem;
  border: 1px solid var(--color-border-secondary);
  border-radius: 0.5rem;
  font-family: 'Courier New', monospace;
  font-size: 0.875rem;
  line-height: 1.5;
  resize: vertical;
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
}

.config-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 0.75rem;
}

.save-btn {
  padding: 0.375rem 0.75rem;
  background-color: var(--color-success);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.save-btn:hover:not(:disabled) {
  background-color: var(--color-success-hover);
}

.save-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
</style>
