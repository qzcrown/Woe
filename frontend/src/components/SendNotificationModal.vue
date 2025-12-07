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
      <label class="label">{{ $t('messages.content') }}</label>
      <textarea v-model="form.content" rows="4" class="textarea" :placeholder="$t('messages.contentPlaceholder') as string"></textarea>
      <p v-if="errors.content" class="error">{{ errors.content }}</p>
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
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from '@/components/BaseModal.vue'
import { applicationApi, messageApi } from '@/services/api'
import type { Application, Message } from '@/types'
import { showError } from '@/utils/errorHandler'
import { authService } from '@/services/auth'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'submitted', msg: Message): void
}>()

const emitClose = () => emit('close')

const { t } = useI18n()

const applications = ref<Application[]>([])
const submitting = ref(false)

// 跟踪用户是否手动修改过优先级
const isPriorityManuallySet = ref(false)

const form = ref({
  appId: '' as number | ''
  , type: 'info'
  , priority: 1
  , title: ''
  , content: ''
})

const errors = ref<{ appId?: string; title?: string; content?: string }>({})

// 根据通知类型自动设置优先级
const updatePriorityByType = () => {
  // 如果用户已经手动设置过优先级，则不再自动更新
  if (isPriorityManuallySet.value) return
  
  const typePriorityMap: Record<string, number> = {
    'error': 3,      // 错误类型为最高优先级
    'warning': 2,    // 警告类型为第二高优先级
    'success': 1,    // 成功类型为普通优先级
    'info': 0        // 信息类型为最低优先级
  }
  
  form.value.priority = typePriorityMap[form.value.type] ?? 1
}

// 监听优先级变化，标记为用户手动设置
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
    showError(err as any, 'Failed to load applications')
  }
}

const submit = async () => {
  if (!validate()) return
  submitting.value = true
  try {
    const payload: Partial<Message> = {
      title: form.value.title,
      message: form.value.content,
      priority: form.value.priority,
      extras: { 'web::type': form.value.type }
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
  // 初始化优先级
  updatePriorityByType()
})
</script>

<style scoped>
.modal-title { font-size: 1.25rem; font-weight: 600; }
.form-group { margin-bottom: 1rem; }
.label { display: block; margin-bottom: 0.5rem; color: #374151; }
.input, .textarea, select { width: 100%; padding: 0.5rem 0.75rem; border: 1px solid #d1d5db; border-radius: 0.375rem; }
.textarea { resize: vertical; }
.error { color: #dc2626; font-size: 0.875rem; margin-top: 0.25rem; }
.cancel-btn { padding: 0.5rem 1rem; background-color: #f3f4f6; color: #374151; border: 1px solid #d1d5db; border-radius: 0.375rem; cursor: pointer; }
.submit-btn { padding: 0.5rem 1rem; background-color: #3b82f6; color: white; border: none; border-radius: 0.375rem; cursor: pointer; }
.submit-btn:disabled { opacity: 0.7; cursor: not-allowed; }
</style>
