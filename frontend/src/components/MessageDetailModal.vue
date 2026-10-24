<template>
  <BaseModal max-width="640px" @close="emitClose">
    <template #title>
      <h2 class="modal-title">{{ $t('messages.messageDetail') }}</h2>
    </template>


    <div class="detail-header">
      <h3 class="message-title-display" :class="{ 'no-title': !message.title }">
        {{ message.title || $t('messages.noTitle') }}
      </h3>
      <span class="message-priority" :class="`priority-${getPriorityLevel(message.priority ?? 1)}`">
        {{ getPriorityLabel(message.priority) }}
      </span>
    </div>


    <MessageContent class="message-content-display" :content="message.message" />


    <div class="detail-group">
      <div class="detail-row">
        <span class="detail-label">{{ $t('messages.application') }}</span>
        <span class="detail-value">
          <span v-if="loadingApp">{{ $t('common.loading') }}...</span>
          <span v-else-if="application">{{ application.name }}</span>
          <span v-else class="app-not-found">{{ $t('messages.applicationNotFound') }}</span>
        </span>
      </div>
      <div class="detail-row">
        <span class="detail-label">{{ $t('messages.messageDate') }}</span>
        <span class="detail-value">{{ formatDateTime(message.date) }}</span>
      </div>
    </div>


    <div v-if="tags.length" class="message-tags-section">
      <h4 class="extras-title">{{ $t('messageTags.title') }}</h4>
      <div class="message-tags-list">
        <span v-for="tag in tags" :key="tag" class="message-tag-chip">{{ tag }}</span>
      </div>
    </div>


    <div v-if="hasExtras" class="extras-section">
      <h4 class="extras-title">{{ $t('messages.extrasData') }}</h4>
      <div v-for="(value, key) in message.extras" :key="key" class="extras-item">
        <span class="extras-key">{{ key }}:</span>
        <span class="extras-value">{{ renderExtrasValue(value) }}</span>
      </div>
    </div>

    <template #footer>
      <button class="delete-btn" :disabled="deleting" @click="handleDelete">
        {{ deleting ? $t('common.loading') : $t('common.delete') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { getPriorityLevel } from '@/utils/priority'
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from '@/components/BaseModal.vue'
import MessageContent from '@/components/MessageContent.vue'
import { useMessagesStore } from '@/stores/messages'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { showError, showSuccess } from '@/utils/errorHandler'
import { applicationApi } from '@/services/api'
import { formatDateTime } from '@/utils/datetime'
import { extractMessageTags } from '@/utils/messageTags'
import type { Message, ApiError, Application } from '@/types'

const props = defineProps<{ message: Message }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'deleted', id: number): void
}>()

const { t } = useI18n()
const messagesStore = useMessagesStore()
const { confirm: confirmDialog } = useConfirmDialog()
const deleting = ref(false)
const application = ref<Application | null>(null)
const loadingApp = ref(false)

const tags = computed(() => extractMessageTags(props.message.extras))

const emitClose = () => emit('close')

const hasExtras = computed(() => {
  return props.message.extras && Object.keys(props.message.extras).length > 0
})

const getPriorityLabel = (priority?: number) => {
  if (priority === undefined || priority === null) return t('common.priorityNormal')
  const labels = [
    t('common.priorityLow'),
    t('common.priorityNormal'),
    t('common.priorityHigh'),
    t('common.priorityEmergency')
  ]
  return labels[getPriorityLevel(priority ?? 1)] || t('common.priorityNormal')
}

const renderExtrasValue = (value: any): string => {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return JSON.stringify(value)
}


const loadApplication = async () => {
  if (!props.message.appid) return

  loadingApp.value = true
  try {
    const response = await applicationApi.getApplication(props.message.appid)
    application.value = response.data
  } catch (error) {
    console.error('Failed to load application:', error)

  } finally {
    loadingApp.value = false
  }
}

const handleDelete = async () => {
  const confirmed = await confirmDialog({
    title: t('common.confirmDialog.title'),
    message: t('messages.deleteConfirm'),
    confirmText: t('common.confirmDialog.confirmButton'),
    cancelText: t('common.confirmDialog.cancelButton'),
    type: 'danger'
  })

  if (confirmed) {
    deleting.value = true
    try {
      await messagesStore.deleteMessage(props.message.id)
      showSuccess(t('messages.deleteSuccess'))
      emit('deleted', props.message.id)
      emit('close')
    } catch (error) {
      showError(error as ApiError, t('messages.deleteError'))
    } finally {
      deleting.value = false
    }
  }
}


onMounted(() => {
  loadApplication()
})
</script>

<style scoped>
.modal-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.message-title-display {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0;
  word-break: break-word;
  flex: 1;
}

.message-title-display.no-title {
  color: var(--color-text-tertiary);
  font-style: italic;
}

.message-priority {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
}

.priority-0 { background: var(--color-priority-low-bg); color: var(--color-priority-low-text); }
.priority-1 { background: var(--color-priority-normal-bg); color: var(--color-priority-normal-text); }
.priority-2 { background: var(--color-priority-high-bg); color: var(--color-priority-high-text); }
.priority-3 { background: var(--color-priority-emergency-bg); color: var(--color-priority-emergency-text); }

.message-content-display {
  background-color: var(--color-bg-tertiary);
  padding: 1rem;
  border-radius: 0.5rem;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--color-text-primary);
  line-height: 1.6;
  font-size: 0.9375rem;
  margin-bottom: 1.25rem;
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--color-border-secondary);
}


.message-content-display::-webkit-scrollbar {
  width: 6px;
}

.message-content-display::-webkit-scrollbar-track {
  background: var(--color-bg-tertiary);
  border-radius: 3px;
}

.message-content-display::-webkit-scrollbar-thumb {
  background: var(--color-border-secondary);
  border-radius: 3px;
}

.message-content-display::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-muted);
}

.detail-group {
  margin-bottom: 1rem;
}

.detail-row {
  display: flex;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--color-border-primary);
}

.detail-row:last-child {
  border-bottom: none;
}

.detail-label {
  font-weight: 600;
  color: var(--color-text-secondary);
  min-width: 100px;
  flex-shrink: 0;
  font-size: 0.875rem;
}

.detail-value {
  color: var(--color-text-primary);
  word-break: break-word;
  font-size: 0.875rem;
}


.app-not-found {
  color: var(--color-text-muted);
  font-style: italic;
}

.extras-section {
  margin-top: 0.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--color-border-primary);
}

.message-tags-section {
  margin-bottom: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--color-border-primary);
}

.message-tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.message-tag-chip {
  display: inline-block;
  padding: 0.25rem 0.625rem;
  border-radius: 9999px;
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  font-weight: 500;
}

.extras-title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0 0 0.75rem 0;
}

.extras-item {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  margin-bottom: 0.5rem;
  padding: 0.625rem 0.75rem;
  background-color: var(--color-bg-hover);
  border-radius: 0.375rem;
}

.extras-key {
  font-weight: 600;
  color: var(--color-text-secondary);
  font-size: 0.8125rem;
  white-space: nowrap;
}

.extras-value {
  color: var(--color-text-primary);
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.8125rem;
  white-space: pre-wrap;
  word-break: break-all;
}

.delete-btn {
  padding: 0.5rem 1rem;
  background-color: var(--color-error);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-weight: 500;
  transition: var(--theme-transition);
}

.delete-btn:hover:not(:disabled) {
  background-color: #dc2626;
}

.delete-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
</style>
