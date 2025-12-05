import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authApi, clientApi } from '@/services/api'
import { authService } from '@/services/auth'
import type { User } from '@/types'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const authenticated = ref(false)

  // 统一通过 authService 检查认证状态，而不是直接读取 localStorage
  const isAuthenticated = computed(() => {
    return authenticated.value || authService.isTokenValid('client')
  })

  // 获取当前客户端令牌（如果需要）
  const token = computed(() => {
    const tokenInfo = authService.getToken('client')
    return tokenInfo?.token || null
  })

  const login = async (username: string, password: string) => {
    try {
      // Use Basic auth for login
      const userResponse = await authApi.login(username, password)

      // Create a client token using Basic auth, then store token
      const clientRes = await clientApi.createClient({ name: 'Web Client' }, { auth: { username, password } })

      // Store client token using new auth service
      authService.setToken('client', clientRes.data.token)

      // Update user state
      user.value = userResponse.data
      authenticated.value = true

      return true
    } catch (error) {
      console.error('Login failed:', error)
      return false
    }
  }

  const logout = () => {
    user.value = null
    // 通过 authService 清理所有认证信息
    authService.clearAllAuth()
    authenticated.value = false
  }

  const checkAuth = async () => {
    // 检查 authService 中的 token 是否有效
    if (!authService.isTokenValid('client')) {
      user.value = null
      authenticated.value = false
      return false
    }

    try {
      const response = await authApi.getCurrentUser()
      user.value = response.data
      authenticated.value = true
      return true
    } catch (error) {
      logout()
      return false
    }
  }

  return {
    user,
    token,
    isAuthenticated,
    login,
    logout,
    checkAuth
  }
})
