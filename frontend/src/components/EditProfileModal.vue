<template>
  <BaseModal max-width="500px" @close="onClose">
    <template #title>
      <h3 class="title">{{ t('editProfile.title') }}</h3>
    </template>

    <form id="edit-profile-form" @submit.prevent="onSubmit" class="profile-form">

        <div class="avatar-section">
          <EditableAvatar
            :user="localUser"
            size="large"
            @upload="handleAvatarUpload"
            @delete="deleteAvatar"
          />
          <div v-if="avatarError" class="error-text">{{ avatarError }}</div>
        </div>


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


        <div class="form-field">
          <label for="description">{{ t('editProfile.description') }}</label>
          <textarea
            id="description"
            v-model="localUser.description"
            rows="3"
            :placeholder="t('editProfile.descriptionPlaceholder')"
          ></textarea>
        </div>

    </form>

    <template #footer>
      <button type="button" @click="showChangePassword" class="btn-link">
        {{ t('editProfile.changePassword') }}
      </button>
      <button type="button" @click="onClose" class="btn-secondary">{{ t('editProfile.cancel') }}</button>
      <button type="submit" form="edit-profile-form" class="btn-primary" :disabled="!isFormValid">
        {{ t('editProfile.save') }}
      </button>
    </template>
  </BaseModal>


  <ChangePasswordModal
    v-if="showPasswordModal"
    @close="showPasswordModal = false"
    @updated="onPasswordUpdated"
  />
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { User } from '@/types'
import { userApi } from '@/services/api'
import EditableAvatar from './EditableAvatar.vue'
import BaseModal from './BaseModal.vue'
import ChangePasswordModal from './ChangePasswordModal.vue'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useAlert } from '@/composables/useAlert'




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





const handleAvatarUpload = async (file: File) => {

  if (!file.type.startsWith('image/')) {
    avatarError.value = t('editProfile.invalidImageType')
    return
  }


  if (file.size > 1 * 1024 * 1024) {
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
.title { margin: 0; font-size: 1.25rem; font-weight: 600; color: var(--color-text-primary); }

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
  background: var(--color-bg-tertiary);
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
  color: var(--color-text-secondary);
}

.form-field input,
.form-field textarea {
  padding: 10px 12px;
  border: 1px solid var(--color-border-secondary);
  border-radius: 6px;
  font-size: 14px;
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  transition: border-color 0.2s;
}

.form-field input:focus,
.form-field textarea:focus {
  outline: none;
  border-color: var(--color-border-focus);
}

.form-field input.error {
  border-color: var(--color-error);
}

.form-field textarea {
  resize: vertical;
  min-height: 80px;
}

.error-text {
  color: var(--color-error);
  font-size: 12px;
}

.btn-secondary {
  padding: 10px 20px;
  background: var(--color-bg-primary);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border-secondary);
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: var(--transition-interactive);
}

.btn-secondary:hover {
  background: var(--color-bg-tertiary);
}

.btn-primary {
  padding: 10px 20px;
  background: var(--color-primary);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.2s;
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-link {
  margin-right: auto;

  background: none;
  border: none;
  color: var(--color-primary);
  cursor: pointer;
  padding: 0;
  font-size: 14px;
  text-align: left;
}

.btn-link:hover {
  text-decoration: underline;
}

</style>
