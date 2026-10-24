<template>
  <BaseModal @close="onClose">
    <template #title>
      <h3 class="title">{{ t('users.changePassword') }}</h3>
    </template>
    <form @submit.prevent="onSubmit" class="form">

      <label class="field">
        <span>{{ t('users.newPassword') }}</span>
        <input
          v-model="newPassword"
          type="password"
          required
          :placeholder="t('users.placeholder.newPassword')"
          @input="onPasswordInput"
        />
        <div v-if="newPassword && passwordValidation" class="password-feedback">

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


      <label class="field">
        <span>{{ t('users.confirmPassword') }}</span>
        <input
          v-model="confirmPassword"
          type="password"
          required
          :placeholder="t('users.placeholder.confirmPassword')"
        />
        <span v-if="confirmPassword && newPassword !== confirmPassword" class="field-error">
          {{ t('users.passwordMismatch') }}
        </span>
      </label>

      <p v-if="error" class="error">{{ error }}</p>
    </form>
    <template #footer>
      <button class="btn" @click="onClose" :disabled="submitting">{{ t('common.cancel') }}</button>
      <button
        class="btn primary"
        @click="onSubmit"
        :disabled="submitting || !newPassword || !confirmPassword || !isFormValid"
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
import { userApi } from '@/services/api'
import { useElevatedAction, isElevationCancelled, isElevationSessionChanged } from '@/composables/useElevatedAction'
import {
  validatePassword,
  getPasswordStrengthColor,
  getPasswordStrengthText,
  PasswordPolicies,
  type PasswordValidationResult
} from '@/utils/passwordValidator'

const emit = defineEmits<{ (e: 'close'): void; (e: 'updated'): void }>()

const { t } = useI18n()
const { withElevation } = useElevatedAction()
const newPassword = ref('')
const confirmPassword = ref('')
const passwordValidation = ref<PasswordValidationResult | null>(null)
const submitting = ref(false)
const error = ref('')

const isPasswordValid = computed(() => {
  return passwordValidation.value?.isValid ?? false
})

const isFormValid = computed(() => {
  return isPasswordValid.value && newPassword.value === confirmPassword.value
})

const strengthColor = computed(() => {
  if (!passwordValidation.value) return '#9ca3af'
  return getPasswordStrengthColor(passwordValidation.value.strength)
})

const strengthText = computed(() => {
  if (!passwordValidation.value) return ''
  return getPasswordStrengthText(passwordValidation.value.strength)
})

const onPasswordInput = () => {
  if (newPassword.value) {
    passwordValidation.value = validatePassword(newPassword.value, PasswordPolicies.standard)
  } else {
    passwordValidation.value = null
  }
}

const onClose = () => emit('close')

const onSubmit = async () => {
  error.value = ''

  if (!newPassword.value || !confirmPassword.value) {
    error.value = t('users.fieldRequired', { field: t('common.password') })
    return
  }

  if (newPassword.value !== confirmPassword.value) {
    error.value = t('users.passwordMismatch')
    return
  }

  const validation = validatePassword(newPassword.value, PasswordPolicies.standard)
  if (!validation.isValid) {
    error.value = validation.errors[0]
    return
  }

  submitting.value = true
  try {

    await withElevation(() =>
      userApi.updateCurrentUserPassword({
        pass: newPassword.value
      })
    )
    emit('updated')
    emit('close')
  } catch (e: any) {
    if (isElevationSessionChanged(e)) {

      error.value = t('elevate.sessionChanged')
    } else if (!isElevationCancelled(e)) {
      error.value = e?.errorDescription || t('users.updatePasswordError')
    }
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.title { margin: 0; font-size: 1.125rem; font-weight: 600; color: var(--color-text-primary); }
.form { display: flex; flex-direction: column; gap: 0.75rem; }
.field { display: flex; flex-direction: column; gap: 0.375rem; }
.field span { color: var(--color-text-secondary); font-size: 0.875rem; }
input {
  border: 1px solid var(--color-border-primary);
  border-radius: 0.375rem;
  padding: 0.5rem;
  font-size: 0.875rem;
  font-family: inherit;
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  transition: var(--theme-transition);
}
input:focus {
  outline: none;
  border-color: var(--color-border-focus);
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
  transition: var(--theme-transition);
}
.btn.primary { background: var(--color-success); color: var(--color-text-inverse); }
.btn.primary:hover { background: var(--color-success-hover); }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }

.password-feedback { margin-top: 0.5rem; }
.strength-bar {
  width: 100%;
  height: 4px;
  background-color: var(--color-bg-active);
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 0.25rem;
}
.strength-fill { height: 100%; transition: width 0.3s ease, background-color 0.3s ease; }
.strength-text { font-size: 0.75rem; font-weight: 500; margin-bottom: 0.25rem; }
.error-list { list-style: none; padding: 0; margin: 0.25rem 0 0 0; font-size: 0.75rem; color: var(--color-error); }
.error-list li { padding: 0.125rem 0; }
.error-list li::before { content: '• '; margin-right: 0.25rem; }
</style>
