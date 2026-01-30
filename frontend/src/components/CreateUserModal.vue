<template>
  <BaseModal @close="onClose">
    <template #title>
      <h3 class="title">{{ t('users.create') }}</h3>
    </template>
    <form @submit.prevent="onSubmit" class="form">
      <label class="field">
        <span>{{ t('common.username') }}</span>
        <input v-model.trim="name" type="text" required :placeholder="t('users.placeholder.name')" />
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
      
      <label class="field">
        <span>{{ t('common.password') }}</span>
        <input 
          v-model="pass" 
          type="password" 
          required 
          :placeholder="t('users.placeholder.password')"
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
      
      <label class="field" v-if="canSetAdmin">
        <span>{{ t('users.administrator_label') }}</span>
        <input type="checkbox" v-model="admin" />
      </label>
      
      <p v-if="error" class="error">{{ error }}</p>
    </form>
    <template #footer>
      <button class="btn" @click="onClose" :disabled="submitting">{{ t('common.cancel') }}</button>
      <button 
        class="btn primary" 
        @click="onSubmit" 
        :disabled="submitting || !name || !nickname || !email || !pass || !isPasswordValid || !!emailError"
      >
        {{ submitting ? t('users.creating') : t('common.add') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseModal from './BaseModal.vue'
import { userApi } from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import { 
  validatePassword, 
  getPasswordStrengthColor, 
  getPasswordStrengthText,
  PasswordPolicies,
  type PasswordValidationResult 
} from '@/utils/passwordValidator'

const emit = defineEmits<{ (e: 'close'): void; (e: 'created'): void }>()

const { t } = useI18n()
const authStore = useAuthStore()
const name = ref('')
const nickname = ref('')
const email = ref('')
const description = ref('')
const pass = ref('')
const admin = ref(false)
const submitting = ref(false)
const error = ref('')
const emailError = ref('')
const passwordValidation = ref<PasswordValidationResult | null>(null)

const canSetAdmin = computed(() => !!authStore.user?.admin)

const isPasswordValid = computed(() => {
  return passwordValidation.value?.isValid ?? false
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

const onClose = () => emit('close')

const onSubmit = async () => {
  error.value = ''
  
  if (!name.value || !nickname.value || !email.value || !pass.value) {
    error.value = t('users.fieldRequired', { field: t('common.username') })
    return
  }
  
  if (!validateEmail()) {
    return
  }
  
  const validation = validatePassword(pass.value, {
    ...PasswordPolicies.standard,
    forbidUsername: name.value
  })
  
  if (!validation.isValid) {
    error.value = validation.errors[0]
    return
  }
  
  submitting.value = true
  try {
    await userApi.createUser({ 
      name: name.value, 
      nickname: nickname.value,
      email: email.value,
      description: description.value || undefined,
      pass: pass.value, 
      admin: canSetAdmin.value ? admin.value : false 
    })
    emit('created')
    emit('close')
  } catch (e: any) {
    error.value = e?.errorDescription || t('users.createError')
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.title { margin: 0; font-size: 1.125rem; font-weight: 600; }
.form { display: flex; flex-direction: column; gap: 0.75rem; }
.field { display: flex; flex-direction: column; gap: 0.375rem; }
.field span { color: #374151; font-size: 0.875rem; }
input, textarea { 
  border: 1px solid #e5e7eb; 
  border-radius: 0.375rem; 
  padding: 0.5rem; 
  font-size: 0.875rem;
  font-family: inherit;
}
textarea {
  resize: vertical;
  min-height: 60px;
}
.field-error {
  color: #ef4444;
  font-size: 0.75rem;
  margin-top: 0.25rem;
}
.error { color: #b91c1c; font-size: 0.875rem; margin: 0; }
.btn { padding: 0.5rem 1rem; border: none; border-radius: 0.375rem; cursor: pointer; background: #e5e7eb; }
.btn.primary { background: #10b981; color: white; }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }

.password-feedback {
  margin-top: 0.5rem;
}

.strength-bar {
  width: 100%;
  height: 4px;
  background-color: #e5e7eb;
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
  color: #ef4444;
}

.error-list li {
  padding: 0.125rem 0;
}

.error-list li::before {
  content: '• ';
  margin-right: 0.25rem;
}
</style>