/**
 * 密码强度验证工具
 */

export interface PasswordValidationResult {
  isValid: boolean
  errors: string[]
  strength: 'weak' | 'medium' | 'strong'
  score: number // 0-100
}

export interface PasswordRequirements {
  minLength?: number          // 最小长度，默认 8
  maxLength?: number          // 最大长度，默认 128
  requireUppercase?: boolean  // 需要大写字母，默认 false
  requireLowercase?: boolean  // 需要小写字母，默认 false
  requireNumbers?: boolean    // 需要数字，默认 false
  requireSpecialChars?: boolean // 需要特殊字符，默认 false
  forbidCommonPasswords?: boolean // 禁止常见密码，默认 true
  forbidUsername?: string     // 禁止包含用户名
}

// 常见弱密码列表（前100个）
const COMMON_PASSWORDS = [
  'password', '123456', '12345678', 'qwerty', 'abc123', 'monkey', '1234567',
  'letmein', 'trustno1', 'dragon', 'baseball', 'iloveyou', 'master', 'sunshine',
  'ashley', 'bailey', 'passw0rd', 'shadow', '123123', '654321', 'superman',
  'qazwsx', 'michael', 'football', 'password1', 'password123', 'admin', 'welcome',
  'login', 'princess', 'solo', 'qwertyuiop', 'starwars', 'test', 'demo'
]

/**
 * 验证密码强度
 * @param password 待验证的密码
 * @param requirements 密码要求配置
 * @returns 验证结果
 */
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

  // 1. 长度检查
  if (!password || password.length === 0) {
    errors.push('Password is required')
    return { isValid: false, errors, strength: 'weak', score: 0 }
  }

  if (password.length < minLength) {
    errors.push(`Password must be at least ${minLength} characters long`)
  } else {
    score += 20
  }

  if (password.length > maxLength) {
    errors.push(`Password must not exceed ${maxLength} characters`)
  }

  // 2. 字符类型检查
  const hasUppercase = /[A-Z]/.test(password)
  const hasLowercase = /[a-z]/.test(password)
  const hasNumbers = /[0-9]/.test(password)
  const hasSpecialChars = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)

  if (requireUppercase && !hasUppercase) {
    errors.push('Password must contain at least one uppercase letter')
  }
  if (requireLowercase && !hasLowercase) {
    errors.push('Password must contain at least one lowercase letter')
  }
  if (requireNumbers && !hasNumbers) {
    errors.push('Password must contain at least one number')
  }
  if (requireSpecialChars && !hasSpecialChars) {
    errors.push('Password must contain at least one special character')
  }

  // 3. 计算强度分数
  if (hasUppercase) score += 15
  if (hasLowercase) score += 15
  if (hasNumbers) score += 15
  if (hasSpecialChars) score += 20

  // 长度加分
  if (password.length >= 12) score += 10
  if (password.length >= 16) score += 5

  // 4. 检查常见密码
  if (forbidCommonPasswords) {
    const lowerPassword = password.toLowerCase()
    if (COMMON_PASSWORDS.includes(lowerPassword)) {
      errors.push('This password is too common and easily guessed')
      score = Math.max(0, score - 30)
    }
  }

  // 5. 检查是否包含用户名
  if (forbidUsername && password.toLowerCase().includes(forbidUsername.toLowerCase())) {
    errors.push('Password must not contain your username')
    score = Math.max(0, score - 20)
  }

  // 6. 检查重复字符
  if (/(.)\1{2,}/.test(password)) {
    errors.push('Password contains too many repeated characters')
    score = Math.max(0, score - 10)
  }

  // 7. 检查连续字符
  if (/(?:abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz|012|123|234|345|456|567|678|789)/i.test(password)) {
    errors.push('Password contains sequential characters')
    score = Math.max(0, score - 10)
  }

  // 8. 确定强度等级
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

/**
 * 获取密码强度的颜色类
 */
export function getPasswordStrengthColor(strength: 'weak' | 'medium' | 'strong'): string {
  switch (strength) {
    case 'weak':
      return '#ef4444' // 红色
    case 'medium':
      return '#f59e0b' // 橙色
    case 'strong':
      return '#10b981' // 绿色
  }
}

/**
 * 获取密码强度的文本描述
 */
export function getPasswordStrengthText(strength: 'weak' | 'medium' | 'strong'): string {
  switch (strength) {
    case 'weak':
      return 'Weak'
    case 'medium':
      return 'Medium'
    case 'strong':
      return 'Strong'
  }
}

/**
 * 预设的密码策略配置
 */
export const PasswordPolicies = {
  // 基础策略（当前使用）
  basic: {
    minLength: 6,
    maxLength: 128,
    forbidCommonPasswords: true
  },
  
  // 标准策略（推荐）
  standard: {
    minLength: 8,
    maxLength: 128,
    requireLowercase: true,
    requireNumbers: true,
    forbidCommonPasswords: true
  },
  
  // 严格策略
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
