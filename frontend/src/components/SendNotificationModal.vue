<template>
  <BaseModal @close="emitClose">
    <template #title>
      <h2 class="modal-title">{{ $t('messages.sendNotification') }}</h2>
    </template>

    <div class="form-group">
      <label class="label">{{ $t('messages.targetApplication') }}</label>
      <select v-model="form.appId" class="input">
        <option value="" disabled>{{ $t('messages.selectApplicationPlaceholder') }}</option>
        <option v-for="app in applications" :key="app.id" :value="app.id">
          {{ app.name }}
        </option>
      </select>
      <p v-if="errors.appId" class="error">{{ errors.appId }}</p>
    </div>

    <div class="form-group">
      <label class="label">{{ $t('messages.notificationType') }}</label>
      <select v-model="form.type" class="input" @change="updatePriorityByType">
        <option value="success">{{ $t('common.success') }}</option>
        <option value="error">{{ $t('common.error') }}</option>
        <option value="warning">{{ $t('common.warning') }}</option>
        <option value="info">{{ $t('common.info') }}</option>
      </select>
    </div>

    <div class="form-group">
      <label class="label">{{ $t('messages.priority') }}</label>
      <select v-model="form.priority" class="input" @change="handlePriorityChange">
        <option value="0">{{ $t('messages.priorityLow') }}</option>
        <option value="1">{{ $t('messages.priorityNormal') }}</option>
        <option value="2">{{ $t('messages.priorityHigh') }}</option>
        <option value="3">{{ $t('messages.priorityEmergency') }}</option>
      </select>
    </div>

    <div class="form-group">
      <label class="label">{{ $t('messages.titleLabel') }}</label>
      <input v-model="form.title" class="input" :placeholder="$t('messages.titlePlaceholder') as string" />
      <p v-if="errors.title" class="error">{{ errors.title }}</p>
    </div>

    <div class="form-group">
      <div class="content-header">
        <label class="label">{{ $t('messages.content') }}</label>
        <button
          type="button"
          class="render-toggle"
          :class="{ active: form.markdown }"
          :title="form.markdown ? ($t('messages.backToEdit') as string) : ($t('messages.previewRender') as string)"
          @click="onToggleRender"
        >
          <span class="render-toggle-mark">M↓</span>
          <span>{{ form.markdown ? $t('messages.backToEdit') : $t('messages.previewRender') }}</span>
        </button>
      </div>
      <div class="content-area">
        <textarea
          v-if="!form.markdown"
          v-model="form.content"
          rows="4"
          class="textarea"
          :placeholder="$t('messages.contentPlaceholder') as string"
        ></textarea>
        <div v-else ref="wysiwygHost" class="content-rendered markdown-body"></div>
      </div>
      <p v-if="errors.content" class="error">{{ errors.content }}</p>
    </div>


    <div class="advanced-section">
      <button type="button" class="collapse-toggle" @click="isAdvancedOpen = !isAdvancedOpen">
        <span class="collapse-icon" :class="{ 'is-open': isAdvancedOpen }">▶</span>
        <span>{{ $t('messages.advancedOptions') }}</span>
        <span v-if="form.tags.length > 0" class="tag-count">({{ form.tags.length }})</span>
      </button>

      <div v-show="isAdvancedOpen" class="collapse-content">

        <div class="form-group">
          <label class="label">{{ $t('messages.filterTags') }}</label>


          <div v-if="form.tags.length > 0" class="selected-tags">
            <button v-for="(tag, index) in form.tags" :key="index"
              type="button" class="tag selected" @click="removeTag(index)"
              :title="$t('messages.removeTagNamed', { tag })"
              :aria-label="$t('messages.removeTagNamed', { tag })">
              {{ tag }}
              <span class="tag-remove"><X :size="12" aria-hidden="true" /></span>
            </button>
          </div>


          <div class="tag-input-wrapper">
            <input
              v-model="newTagInput"
              class="input tag-input"
              :placeholder="$t('messages.tagPlaceholder')"
              @keydown.enter.prevent="addNewTag"
              @keydown.comma.prevent="addNewTag"
            />
            <button type="button" class="tag-add-btn" @click="addNewTag">
              {{ $t('common.add') }}
            </button>
          </div>
          <p class="tag-hint">{{ $t('messages.tagHint') }}</p>


          <div v-if="tagHistory.length > 0" class="tag-history">
            <div class="tag-history-label">{{ $t('messages.tagHistory') }}:</div>
            <div class="tag-history-list">
              <span
                v-for="tag in availableHistoryTags"
                :key="tag"
                class="tag history"
                @click="addTagFromHistory(tag)"
                :title="$t('messages.clickToAdd')"
              >
                {{ tag }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <button class="cancel-btn" @click="emitClose">{{ $t('common.cancel') }}</button>
      <button class="submit-btn" :disabled="submitting" @click="submit">
        {{ submitting ? ($t('common.loading') as string) : ($t('messages.send') as string) }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onBeforeUnmount, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { X } from '@lucide/vue'
import BaseModal from '@/components/BaseModal.vue'
import { applicationApi, messageApi } from '@/services/api'
import type { Application, Message } from '@/types'
import { showError } from '@/utils/errorHandler'
import { authService } from '@/services/auth'
import { mountWysiwygEditor } from '@/utils/wysiwyg'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'submitted', msg: Message): void
}>()

const emitClose = () => emit('close')

const { t } = useI18n()

const applications = ref<Application[]>([])
const submitting = ref(false)


const isPriorityManuallySet = ref(false)


const isAdvancedOpen = ref(false)



const form = ref({
  appId: '' as number | '',
  type: 'info',
  priority: 1,
  title: '',
  content: '',
  tags: [] as string[],
  markdown: false
})



const wysiwygHost = ref<HTMLElement | null>(null)
let milkdownDestroy: (() => void) | null = null
const wysiwygLoading = ref(false)

const destroyWysiwyg = () => {
  milkdownDestroy?.()
  milkdownDestroy = null
  wysiwygLoading.value = false
}


const onToggleRender = () => {
  form.value.markdown = !form.value.markdown
  if (form.value.markdown) {
    void nextTick(() => startWysiwyg())
  } else {
    destroyWysiwyg()
  }
}

const startWysiwyg = async () => {
  if (!wysiwygHost.value || milkdownDestroy || wysiwygLoading.value) return
  wysiwygLoading.value = true
  try {
    if (!wysiwygHost.value) return
    const handle = await mountWysiwygEditor(wysiwygHost.value, form.value.content, (markdown) => {
      form.value.content = markdown
    })
    milkdownDestroy = handle.destroy
  } catch {

    form.value.markdown = false
    showError({ error: t('messages.editorLoadFailed') } as any, t('messages.editorLoadFailed'))
  } finally {
    wysiwygLoading.value = false
  }
}

watch(
  () => form.value.markdown,
  (on) => {
    if (on) {

      void nextTick(() => startWysiwyg())
    } else {
      destroyWysiwyg()
    }
  }
)

onBeforeUnmount(destroyWysiwyg)


const TAG_HISTORY_KEY = 'woe_message_tags_history'
const MAX_TAG_HISTORY = 20
const tagHistory = ref<string[]>([])
const newTagInput = ref('')

const errors = ref<{ appId?: string; title?: string; content?: string }>({})


const availableHistoryTags = computed(() => {
  return tagHistory.value.filter(tag => !form.value.tags.includes(tag))
})


const TAG_REGEX = /^[a-zA-Z0-9_-]+$/


const loadTagHistory = () => {
  try {
    const stored = localStorage.getItem(TAG_HISTORY_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed)) {

        tagHistory.value = parsed.filter(t =>
          typeof t === 'string' && t.length > 0 && TAG_REGEX.test(t)
        )
      }
    }
  } catch {
    tagHistory.value = []
  }
}


const saveTagHistory = () => {
  try {

    const safeTags = tagHistory.value.filter(t => TAG_REGEX.test(t))
    localStorage.setItem(TAG_HISTORY_KEY, JSON.stringify(safeTags))
  } catch {

  }
}


const addToHistory = (tag: string) => {
  const normalizedTag = tag.trim().toLowerCase()
  if (!normalizedTag) return


  const index = tagHistory.value.indexOf(normalizedTag)
  if (index > -1) {
    tagHistory.value.splice(index, 1)
  }


  tagHistory.value.unshift(normalizedTag)


  if (tagHistory.value.length > MAX_TAG_HISTORY) {
    tagHistory.value = tagHistory.value.slice(0, MAX_TAG_HISTORY)
  }

  saveTagHistory()
}


const addNewTag = () => {
  const tag = newTagInput.value.trim().toLowerCase()

  if (!tag) return


  if (!TAG_REGEX.test(tag)) {
    showError({ error: t('messages.invalidTagFormat') } as any, t('messages.invalidTagFormat'))
    return
  }


  if (form.value.tags.includes(tag)) {
    newTagInput.value = ''
    return
  }


  if (form.value.tags.length >= 10) {
    showError({ error: t('messages.tooManyTags') } as any, t('messages.tooManyTags'))
    return
  }

  form.value.tags.push(tag)
  addToHistory(tag)
  newTagInput.value = ''
}


const addTagFromHistory = (tag: string) => {
  if (form.value.tags.includes(tag)) return
  if (form.value.tags.length >= 10) {
    showError({ error: t('messages.tooManyTags') } as any, t('messages.tooManyTags'))
    return
  }
  form.value.tags.push(tag)
}


const removeTag = (index: number) => {
  form.value.tags.splice(index, 1)
}


const updatePriorityByType = () => {

  if (isPriorityManuallySet.value) return

  const typePriorityMap: Record<string, number> = {
    'error': 3,
    'warning': 2,
    'success': 1,
    'info': 0
  }

  form.value.priority = typePriorityMap[form.value.type] ?? 1
}


const handlePriorityChange = () => {
  isPriorityManuallySet.value = true
}

const validate = () => {
  const e: any = {}
  if (!form.value.appId) e.appId = (t('messages.validation.appRequired') as string)
  if (!form.value.title?.trim()) e.title = (t('messages.validation.titleRequired') as string)
  if (!form.value.content?.trim()) e.content = (t('messages.validation.contentRequired') as string)
  errors.value = e
  return Object.keys(e).length === 0
}

const loadApplications = async () => {
  try {
    const res = await applicationApi.getApplications()
    applications.value = res.data || []
    if (applications.value.length > 0) {
      authService.setApplicationsCache(applications.value)
    }
  } catch (err) {
    showError(err as any, t('messages.loadApplicationsFailed'))
  }
}

const submit = async () => {
  if (!validate()) return
  submitting.value = true
  try {
    const extras: Record<string, any> = { 'web::type': form.value.type }


    if (form.value.markdown) {
      extras['client::display'] = { contentType: 'text/markdown' }
    }


    if (form.value.tags.length > 0) {
      extras['woe::filter::tags'] = form.value.tags
    }

    const payload: Partial<Message> = {
      title: form.value.title,
      message: form.value.content,
      priority: form.value.priority,
      extras
    }
    const res = await messageApi.createMessage(Number(form.value.appId), payload)
    emit('submitted', res.data)
  } catch (err) {
    showError(err as any, (t('messages.sendFailed') as string))
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  loadApplications()
  loadTagHistory()

  updatePriorityByType()
})
</script>

<style scoped>
.modal-title { font-size: 1.25rem; font-weight: 600; color: var(--color-text-primary); }
.form-group { margin-bottom: 1rem; }
.label { display: block; margin-bottom: 0.5rem; color: var(--color-text-secondary); font-weight: 500; }
.input, .textarea, select {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border-secondary);
  border-radius: 0.375rem;
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  transition: var(--transition-interactive);
}
.input:focus, .textarea:focus, select:focus {
  outline: none;
  border-color: var(--color-border-focus);
}
.textarea { resize: vertical; }
.error { color: var(--color-error); font-size: 0.875rem; margin-top: 0.25rem; }
.cancel-btn {
  padding: 0.5rem 1rem;
  background-color: var(--color-bg-hover);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border-secondary);
  border-radius: 0.375rem;
  cursor: pointer;
  transition: var(--transition-interactive);
}
.cancel-btn:hover { background-color: var(--color-bg-active); }
.submit-btn {
  padding: 0.5rem 1rem;
  background-color: var(--color-primary);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  transition: var(--transition-interactive);
}
.submit-btn:hover:not(:disabled) { background-color: var(--color-primary-hover); }
.submit-btn:disabled { opacity: 0.7; cursor: not-allowed; }


.advanced-section {
  margin-bottom: 1rem;
  border: 1px solid var(--color-border-primary);
  border-radius: 0.5rem;
  overflow: hidden;
}

.collapse-toggle {
  width: 100%;
  padding: 0.75rem 1rem;
  background-color: var(--color-bg-tertiary);
  border: none;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--color-text-secondary);
  transition: background-color 0.2s;
}

.collapse-toggle:hover {
  background-color: var(--color-bg-hover);
}

.collapse-icon {
  font-size: 0.75rem;
  transition: transform 0.2s;
}

.collapse-icon.is-open {
  transform: rotate(90deg);
}

.tag-count {
  color: var(--color-text-tertiary);
  font-size: 0.75rem;
}

.collapse-content {
  padding: 1rem;
  background-color: var(--color-bg-primary);
}


.selected-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.375rem 0.75rem;
  border-radius: 9999px;
  font-size: 0.875rem;
  cursor: pointer;
  transition: var(--transition-interactive);
}

.tag.selected {
  background-color: var(--color-info-bg);
  color: var(--color-info);
  border: 1px solid var(--color-primary);
}


button.tag.selected {
  font-family: inherit;
  font-size: 0.875rem;
  line-height: inherit;
}

.tag.selected:hover {
  background-color: var(--color-primary-light);
}


.tag.selected:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.tag.history {
  background-color: var(--color-bg-hover);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border-secondary);
}

.tag.history:hover {
  background-color: var(--color-bg-active);
}

.tag-remove {
  display: inline-flex;
  align-items: center;
  margin-left: 0.25rem;
}

.tag-input-wrapper {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.tag-input {
  flex: 1;
}

.tag-add-btn {
  padding: 0.5rem 1rem;
  background-color: var(--color-primary);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: var(--transition-interactive);
}

.tag-add-btn:hover {
  background-color: var(--color-primary-hover);
}

.tag-hint {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
  margin-top: 0.25rem;
  margin-bottom: 0.75rem;
}

.tag-history {
  margin-top: 0.75rem;
}

.tag-history-label {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
  margin-bottom: 0.5rem;
}

.tag-history-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}


.content-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
.content-header .label {
  margin-bottom: 0;
}
.render-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.6rem;
  font-size: 0.75rem;
  border: 1px solid var(--color-border-secondary);
  border-radius: 0.25rem;
  background: var(--color-bg-primary);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: var(--transition-interactive);
}
.render-toggle:hover {
  color: var(--color-text-primary);
  border-color: var(--color-border-focus);
}
.render-toggle.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: var(--color-text-inverse);
}
.render-toggle-mark {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 700;
}
.content-area {
  position: relative;
}
.content-rendered {
  min-height: 7.5rem;
  max-height: 40vh;
  overflow-y: auto;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border-secondary);
  border-radius: 0.375rem;
  background: var(--color-bg-primary);
}

.content-rendered :deep(.ProseMirror) {
  outline: none;
  min-height: 6rem;
}
.content-rendered :deep(.ProseMirror pre.code-block) {
  padding: 0.5rem;
}
</style>
