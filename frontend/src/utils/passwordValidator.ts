


import i18n from '@/locales'


const t = (key: string, params?: Record<string, unknown>): string =>
  i18n.global.t(key, params ?? {})

export interface PasswordValidationResult {
  isValid: boolean
  errors: string[]
  strength: 'weak' | 'medium' | 'strong'
  score: number
}

export interface PasswordRequirements {
  minLength?: number
  maxLength?: number
  requireUppercase?: boolean
  requireLowercase?: boolean
  requireNumbers?: boolean
  requireSpecialChars?: boolean
  forbidCommonPasswords?: boolean
  forbidUsername?: string
}


const COMMON_PASSWORDS = [
  'password', '123456', '12345678', 'qwerty', 'abc123', 'monkey', '1234567',
  'letmein', 'trustno1', 'dragon', 'baseball', 'iloveyou', 'master', 'sunshine',
  'ashley', 'bailey', 'passw0rd', 'shadow', '123123', '654321', 'superman',
  'qazwsx', 'michael', 'football', 'password1', 'password123', 'admin', 'welcome',
  'login', 'princess', 'solo', 'qwertyuiop', 'starwars', 'test', 'demo'
]







export function validatePassword(
  password: string,
  requirements: PasswordRequirements = {}
): PasswordValidationResult {
  const {
    minLength = 8,
    maxLength = 128,
    requireUppercase = false,
    requireLowercase = false,
    requireNumbers = false,
    requireSpecialChars = false,
    forbidCommonPasswords = true,
    forbidUsername = undefined
  } = requirements

  const errors: string[] = []
  let score = 0


  if (!password || password.length === 0) {
    errors.push(t('validation.passwordRequired'))
    return { isValid: false, errors, strength: 'weak', score: 0 }
  }

  if (password.length < minLength) {
    errors.push(t('validation.passwordMinLength', { min: minLength }))
  } else {
    score += 20
  }

  if (password.length > maxLength) {
    errors.push(t('validation.passwordMaxLength', { max: maxLength }))
  }


  const hasUppercase = /[A-Z]/.test(password)
  const hasLowercase = /[a-z]/.test(password)
  const hasNumbers = /[0-9]/.test(password)
  const hasSpecialChars = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)

  if (requireUppercase && !hasUppercase) {
    errors.push(t('validation.passwordUppercase'))
  }
  if (requireLowercase && !hasLowercase) {
    errors.push(t('validation.passwordLowercase'))
  }
  if (requireNumbers && !hasNumbers) {
    errors.push(t('validation.passwordNumber'))
  }
  if (requireSpecialChars && !hasSpecialChars) {
    errors.push(t('validation.passwordSpecial'))
  }


  if (hasUppercase) score += 15
  if (hasLowercase) score += 15
  if (hasNumbers) score += 15
  if (hasSpecialChars) score += 20


  if (password.length >= 12) score += 10
  if (password.length >= 16) score += 5


  if (forbidCommonPasswords) {
    const lowerPassword = password.toLowerCase()
    if (COMMON_PASSWORDS.includes(lowerPassword)) {
      errors.push(t('validation.passwordTooCommon'))
      score = Math.max(0, score - 30)
    }
  }


  if (forbidUsername && password.toLowerCase().includes(forbidUsername.toLowerCase())) {
    errors.push(t('validation.passwordContainsUsername'))
    score = Math.max(0, score - 20)
  }


  if (/(.)\1{2,}/.test(password)) {
    errors.push(t('validation.passwordRepeatedChars'))
    score = Math.max(0, score - 10)
  }


  if (/(?:abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz|012|123|234|345|456|567|678|789)/i.test(password)) {
    errors.push(t('validation.passwordSequentialChars'))
    score = Math.max(0, score - 10)
  }


  let strength: 'weak' | 'medium' | 'strong'
  if (score >= 70) {
    strength = 'strong'
  } else if (score >= 40) {
    strength = 'medium'
  } else {
    strength = 'weak'
  }

  return {
    isValid: errors.length === 0,
    errors,
    strength,
    score: Math.min(100, Math.max(0, score))
  }
}




export function getPasswordStrengthColor(strength: 'weak' | 'medium' | 'strong'): string {
  switch (strength) {
    case 'weak':
      return '#ef4444'
    case 'medium':
      return '#f59e0b'
    case 'strong':
      return '#10b981'
  }
}




export function getPasswordStrengthText(strength: 'weak' | 'medium' | 'strong'): string {
  switch (strength) {
    case 'weak':
      return t('validation.strengthWeak')
    case 'medium':
      return t('validation.strengthMedium')
    case 'strong':
      return t('validation.strengthStrong')
  }
}




export const PasswordPolicies = {

  basic: {
    minLength: 6,
    maxLength: 128,
    forbidCommonPasswords: true
  },


  standard: {
    minLength: 8,
    maxLength: 128,
    requireLowercase: true,
    requireNumbers: true,
    forbidCommonPasswords: true
  },


  strict: {
    minLength: 12,
    maxLength: 128,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: true,
    forbidCommonPasswords: true
  }
}
