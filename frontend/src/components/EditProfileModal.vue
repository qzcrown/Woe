<template>
  <div class="modal-overlay" @click="onClose">
    <div class="modal-content" @click.stop>
      <div class="modal-header">
        <h3>{{ t('editProfile.title') }}</h3>
        <button @click="onClose" class="close-btn">&times;</button>
      </div>

      <form @submit.prevent="onSubmit" class="profile-form">
        <!-- Avatar Section -->
        <div class="avatar-section">
          <EditableAvatar
            :user="localUser"
            size="large"
            @upload="handleAvatarUpload"
            @delete="deleteAvatar"
          />
          <div v-if="avatarError" class="error-text">{{ avatarError }}</div>
        </div>

        <!-- Nickname -->
        <div class="form-field">
          <label for="nickname">{{ t('editProfile.nickname') }} *</label>
          <input
            id="nickname"
            v-model="localUser.nickname"
            type="text"
            required
            :placeholder="t('editProfile.nicknamePlaceholder')"
          />
        </div>

        <!-- Email -->
        <div class="form-field">
          <label for="email">{{ t('editProfile.email') }} *</label>
          <input
            id="email"
            v-model="localUser.email"
            type="email"
            required
            :placeholder="t('editProfile.emailPlaceholder')"
            :class="{ 'error': emailError }"
          />
          <div v-if="emailError" class="error-text">{{ emailError }}</div>
        </div>

        <!-- Description -->
        <div class="form-field">
          <label for="description">{{ t('editProfile.description') }}</label>
          <textarea
            id="description"
            v-model="localUser.description"
            rows="3"
            :placeholder="t('editProfile.descriptionPlaceholder')"
          ></textarea>
        </div>

        <!-- Form Actions -->
        <div class="form-actions">
          <button type="button" @click="showChangePassword" class="btn-link">
            {{ t('editProfile.changePassword') }}
          </button>
          <div class="spacer"></div>
          <button type="button" @click="onClose" class="btn-secondary">{{ t('editProfile.cancel') }}</button>
          <button type="submit" class="btn-primary" :disabled="!isFormValid">
            {{ t('editProfile.save') }}
          </button>
        </div>
      </form>
    </div>

    <!-- Change Password Modal -->
    <ChangePasswordModal
      v-if="showPasswordModal"
      @close="showPasswordModal = false"
      @updated="onPasswordUpdated"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { User } from '@/types'
import { userApi } from '@/services/api'
import EditableAvatar from './EditableAvatar.vue'
import ChangePasswordModal from './ChangePasswordModal.vue'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useAlert } from '@/composables/useAlert'

/**
 * 获取 i18n 翻译函数
 */
const { t } = useI18n()

interface Props {
  user: User
}

interface Emits {
  (e: 'close'): void
  (e: 'updated', user: User): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()
const { confirm: confirmDialog } = useConfirmDialog()
const { error: showError } = useAlert()

const localUser = ref<User>({ ...props.user })
const emailError = ref('')
const avatarError = ref('')
const isSubmitting = ref(false)
const showPasswordModal = ref(false)

// Watch for prop changes
watch(() => props.user, (newUser) => {
  localUser.value = { ...newUser }
}, { deep: true })

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const isFormValid = computed(() => {
  return (
    localUser.value.nickname.trim() &&
    emailRegex.test(localUser.value.email.trim()) &&
    !emailError.value &&
    !isSubmitting.value
  )
})

/**
 * 验证邮箱格式
 * @returns 是否验证通过
 */
const validateEmail = () => {
  const email = localUser.value.email.trim()
  if (!email) {
    emailError.value = t('editProfile.emailRequired')
    return false
  }
  if (!emailRegex.test(email)) {
    emailError.value = t('editProfile.emailInvalid')
    return false
  }
  emailError.value = ''
  return true
}

/**
 * 处理头像上传
 * @param file - 上传的文件
 */
const handleAvatarUpload = async (file: File) => {
  // 验证文件类型
  if (!file.type.startsWith('image/')) {
    avatarError.value = t('editProfile.invalidImageType')
    return
  }

  // 验证文件大小 (2MB)
  if (file.size > 2 * 1024 * 1024) {
    avatarError.value = t('editProfile.imageTooLarge')
    return
  }

  avatarError.value = ''
  isSubmitting.value = true

  try {
    const response = await userApi.uploadAvatar(localUser.value.id, file)
    localUser.value = response.data
    emit('updated', response.data)
  } catch (error: any) {
    avatarError.value = error.errorDescription || t('editProfile.avatarUploadFailed')
  } finally {
    isSubmitting.value = false
  }
}

/**
 * 删除头像
 */
const deleteAvatar = async () => {
  const confirmed = await confirmDialog({
    title: t('editProfile.deleteAvatarConfirmTitle'),
    message: t('editProfile.deleteAvatarConfirmMessage'),
    confirmText: t('common.confirm'),
    cancelText: t('common.cancel'),
    type: 'warning'
  })
  
  if (!confirmed) return

  isSubmitting.value = true

  try {
    await userApi.deleteAvatar(localUser.value.id)
    localUser.value.avatar = undefined
    emit('updated', localUser.value)
  } catch (error: any) {
    avatarError.value = error.errorDescription || t('editProfile.avatarDeleteFailed')
  } finally {
    isSubmitting.value = false
  }
}

const onSubmit = async () => {
  if (!validateEmail()) return

  isSubmitting.value = true

  try {
    const response = await userApi.updateProfile(localUser.value.id, {
      nickname: localUser.value.nickname.trim(),
      email: localUser.value.email.trim(),
      description: localUser.value.description || undefined
    })
    emit('updated', response.data)
    emit('close')
  } catch (err: any) {
    if (err.errorDescription?.includes('email')) {
      emailError.value = err.errorDescription
    } else {
      await showError(err.errorDescription || t('editProfile.saveFailed'))
    }
  } finally {
    isSubmitting.value = false
  }
}

const showChangePassword = () => {
  showPasswordModal.value = true
}

const onPasswordUpdated = () => {
  showPasswordModal.value = false
}

const onClose = () => {
  emit('close')
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: white;
  border-radius: 12px;
  padding: 24px;
  width: 90%;
  max-width: 500px;
  max-height: 90vh;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.modal-header h3 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #6b7280;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-btn:hover {
  color: #1f2937;
}

.profile-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.avatar-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 20px;
  background: #f9fafb;
  border-radius: 8px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-field label {
  font-size: 14px;
  font-weight: 500;
  color: #374151;
}

.form-field input,
.form-field textarea {
  padding: 10px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  transition: border-color 0.2s;
}

.form-field input:focus,
.form-field textarea:focus {
  outline: none;
  border-color: #3b82f6;
}

.form-field input.error {
  border-color: #ef4444;
}

.form-field textarea {
  resize: vertical;
  min-height: 80px;
}

.error-text {
  color: #ef4444;
  font-size: 12px;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 8px;
}

.btn-secondary {
  padding: 10px 20px;
  background: white;
  color: #374151;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.btn-secondary:hover {
  background: #f9fafb;
}

.btn-primary {
  padding: 10px 20px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.2s;
}

.btn-primary:hover:not(:disabled) {
  background: #2563eb;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-link {
  background: none;
  border: none;
  color: #3b82f6;
  cursor: pointer;
  padding: 0;
  font-size: 14px;
  text-align: left;
}

.btn-link:hover {
  text-decoration: underline;
}

.spacer {
  flex: 1;
}
</style>
