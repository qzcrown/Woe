<template>
  <BaseModal @close="onClose">
    <template #title>
      <h3 class="title">{{ t('users.edit') }}</h3>
    </template>
    <form @submit.prevent="onSubmit" class="form">
      <div class="avatar-section">
        <EditableAvatar
          :user="user"
          size="large"
          @upload="handleAvatarUpload"
          @delete="handleAvatarDelete"
        />
      </div>

      <label class="field">
        <span>{{ t('common.username') }}</span>
        <input v-model.trim="name" type="text" required :placeholder="user.name" />
      </label>

      <label class="field">
        <span>{{ t('users.nickname') }}</span>
        <input v-model.trim="nickname" type="text" required :placeholder="t('users.placeholder.nickname')" />
      </label>

      <label class="field">
        <span>{{ t('users.email') }}</span>
        <input
          v-model.trim="email"
          type="email"
          required
          :placeholder="t('users.placeholder.email')"
          @blur="validateEmail"
        />
        <span v-if="emailError" class="field-error">{{ emailError }}</span>
      </label>

      <label class="field">
        <span>{{ t('users.description') }}</span>
        <textarea
          v-model="description"
          :placeholder="t('users.placeholder.description')"
          rows="3"
        ></textarea>
      </label>

      <label class="field" v-if="canSetAdmin">
        <span>{{ t('users.administrator_label') }}</span>
        <input type="checkbox" v-model="admin" />
      </label>

      <label class="field">
        <span>{{ t('users.newPassword') }} ({{ t('users.placeholder.passwordOptional') }})</span>
        <input
          v-model="pass"
          type="password"
          :placeholder="t('users.placeholder.passwordOptional')"
          @input="onPasswordInput"
        />
        <div v-if="pass && passwordValidation" class="password-feedback">
          <div class="strength-bar">
            <div
              class="strength-fill"
              :style="{
                width: `${passwordValidation.score}%`,
                backgroundColor: strengthColor
              }"
            ></div>
          </div>
          <div class="strength-text" :style="{ color: strengthColor }">
            {{ strengthText }} ({{ passwordValidation.score }}/100)
          </div>
          <ul v-if="passwordValidation.errors.length > 0" class="error-list">
            <li v-for="(err, idx) in passwordValidation.errors" :key="idx">{{ err }}</li>
          </ul>
        </div>
      </label>

      <p v-if="error" class="error">{{ error }}</p>
    </form>
    <template #footer>
      <button class="btn" @click="onClose" :disabled="submitting">{{ t('common.cancel') }}</button>
      <button
        class="btn primary"
        @click="onSubmit"
        :disabled="submitting || !name.trim() || !nickname.trim() || !email.trim() || (!!pass && !isPasswordValid) || !!emailError"
      >
        {{ submitting ? t('users.updating') : t('common.save') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from './BaseModal.vue'
import EditableAvatar from './EditableAvatar.vue'
import { userApi } from '@/services/api'
import { withElevationRetry } from '@/services/auth'
import { isElevationCancelled } from '@/composables/useElevatedAction'
import { useAuthStore } from '@/stores/auth'
import {
  validatePassword,
  getPasswordStrengthColor,
  getPasswordStrengthText,
  PasswordPolicies,
  type PasswordValidationResult
} from '@/utils/passwordValidator'

const props = defineProps<{
  user: any
}>()

const emit = defineEmits<{ (e: 'close'): void; (e: 'updated'): void }>()

const { t } = useI18n()
const authStore = useAuthStore()
const name = ref(props.user.name)
const nickname = ref(props.user.nickname || '')
const email = ref(props.user.email || '')
const description = ref(props.user.description || '')
const admin = ref(props.user.admin)
const pass = ref('')
const submitting = ref(false)
const error = ref('')
const emailError = ref('')
const passwordValidation = ref<PasswordValidationResult | null>(null)

const canSetAdmin = computed(() => !!authStore.user?.admin)

const isPasswordValid = computed(() => {
  return passwordValidation.value?.isValid ?? true
})

const strengthColor = computed(() => {
  if (!passwordValidation.value) return '#9ca3af'
  return getPasswordStrengthColor(passwordValidation.value.strength)
})

const strengthText = computed(() => {
  if (!passwordValidation.value) return ''
  return getPasswordStrengthText(passwordValidation.value.strength)
})

const validateEmail = () => {
  if (!email.value) {
    emailError.value = t('users.fieldRequired', { field: t('users.email') })
    return false
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email.value)) {
    emailError.value = t('users.emailInvalid')
    return false
  }
  emailError.value = ''
  return true
}

const onPasswordInput = () => {
  if (pass.value) {
    passwordValidation.value = validatePassword(pass.value, {
      ...PasswordPolicies.standard,
      forbidUsername: name.value
    })
  } else {
    passwordValidation.value = null
  }
}

const handleAvatarUpload = async (file: File) => {
  try {
    submitting.value = true
    const response = await userApi.uploadAvatar(props.user.id, file)
    props.user.avatar = response.data.avatar
    error.value = ''
  } catch (e: any) {
    error.value = e?.errorDescription || t('users.avatarUploadError')
  } finally {
    submitting.value = false
  }
}

const handleAvatarDelete = async () => {
  try {
    submitting.value = true
    await userApi.deleteAvatar(props.user.id)
    props.user.avatar = undefined
    error.value = ''
  } catch (e: any) {
    error.value = e?.errorDescription || t('users.avatarDeleteError')
  } finally {
    submitting.value = false
  }
}

const onClose = () => emit('close')

const onSubmit = async () => {
  error.value = ''

  if (!name.value || !nickname.value || !email.value) {
    error.value = t('users.fieldRequired', { field: t('common.username') })
    return
  }

  if (!validateEmail()) {
    return
  }

  if (pass.value) {
    const validation = validatePassword(pass.value, {
      ...PasswordPolicies.standard,
      forbidUsername: name.value
    })

    if (!validation.isValid) {
      error.value = validation.errors[0]
      return
    }
  }

  submitting.value = true
  try {

    const profileChanged =
      nickname.value !== props.user.nickname ||
      email.value !== props.user.email ||
      description.value !== (props.user.description || '')

    if (profileChanged) {
      await userApi.updateProfile(props.user.id, {
        nickname: nickname.value,
        email: email.value,
        description: description.value || undefined
      })
    }


    const adminOrPassChanged =
      (canSetAdmin.value && admin.value !== props.user.admin) ||
      pass.value

    if (adminOrPassChanged) {


      await withElevationRetry(() =>
        userApi.updateUser(props.user.id, {
          name: name.value,
          admin: canSetAdmin.value ? admin.value : props.user.admin,
          ...(pass.value && { pass: pass.value })
        })
      )
    }

    emit('updated')
    emit('close')
  } catch (e: any) {
    if (isElevationCancelled(e)) {
      error.value = ''
      return
    }
    error.value = e?.errorDescription || t('users.updateError')
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.title { margin: 0; font-size: 1.125rem; font-weight: 600; color: var(--color-text-primary); }
.form { display: flex; flex-direction: column; gap: 0.75rem; }

.avatar-section {
  display: flex;
  justify-content: center;
  padding: 1rem 0;
  margin-bottom: 0.5rem;
  border-bottom: 1px solid var(--color-border-primary);
}

.field { display: flex; flex-direction: column; gap: 0.375rem; }
.field span { color: var(--color-text-secondary); font-size: 0.875rem; }
input, textarea {
  border: 1px solid var(--color-border-primary);
  border-radius: 0.375rem;
  padding: 0.5rem;
  font-size: 0.875rem;
  font-family: inherit;
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  transition: var(--transition-interactive);
}
input:focus, textarea:focus {
  outline: none;
  border-color: var(--color-border-focus);
}
textarea {
  resize: vertical;
  min-height: 60px;
}
.field-error {
  color: var(--color-error);
  font-size: 0.75rem;
  margin-top: 0.25rem;
}
.error { color: var(--color-error); font-size: 0.875rem; margin: 0; }
.btn {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  background: var(--color-bg-active);
  color: var(--color-text-secondary);
  transition: var(--transition-interactive);
}
.btn.primary { background: var(--color-primary); color: var(--color-text-inverse); }
.btn.primary:hover { background: var(--color-primary-hover); }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }

.password-feedback {
  margin-top: 0.5rem;
}

.strength-bar {
  width: 100%;
  height: 4px;
  background-color: var(--color-bg-active);
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 0.25rem;
}

.strength-fill {
  height: 100%;
  transition: width 0.3s ease, background-color 0.3s ease;
}

.strength-text {
  font-size: 0.75rem;
  font-weight: 500;
  margin-bottom: 0.25rem;
}

.error-list {
  list-style: none;
  padding: 0;
  margin: 0.25rem 0 0 0;
  font-size: 0.75rem;
  color: var(--color-error);
}

.error-list li {
  padding: 0.125rem 0;
}

.error-list li::before {
  content: '• ';
  margin-right: 0.25rem;
}
</style>