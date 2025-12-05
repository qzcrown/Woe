import CryptoJS from 'crypto-js'
import { useAuthStore } from '@/stores/auth'
import type { Application } from '@/types'

/**
 * 认证策略枚举 - 完全匹配 docs/api_spec.json 规范中的 securityDefinitions
 */
export enum AuthStrategy {
  // 客户端令牌认证方式
  CLIENT_TOKEN_AUTHORIZATION_HEADER = 'clientTokenAuthorizationHeader',  // Authorization: Bearer <clientToken>
  CLIENT_TOKEN_HEADER = 'clientTokenHeader',                             // X-Gotify-Key: <clientToken>
  CLIENT_TOKEN_QUERY = 'clientTokenQuery',                               // ?token=<clientToken>

  // 应用令牌认证方式
  APP_TOKEN_AUTHORIZATION_HEADER = 'appTokenAuthorizationHeader',        // Authorization: Bearer <appToken>
  APP_TOKEN_HEADER = 'appTokenHeader',                                   // X-Gotify-Key: <appToken>
  APP_TOKEN_QUERY = 'appTokenQuery',                                     // ?token=<appToken>

  // 基础认证
  BASIC_AUTH = 'basicAuth'                                               // HTTP Basic Auth
}

/**
 * Token信息接口
 */
export interface TokenInfo {
  token: string
  type: 'client' | 'app'
  expires?: Date
  lastUsed?: Date
}

/**
 * 认证配置接口
 */
export interface AuthConfig {
  strategy: AuthStrategy
  token?: string
  credentials?: { username: string; password: string }
  appId?: number
}

/**
 * 端点映射，用于自动选择认证策略
 */
const ENDPOINT_AUTH_MAP: Record<string, { strategy: AuthStrategy; tokenType?: 'client' | 'app' }> = {
  // 用户相关 - 使用client token
  'GET:/user': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'POST:/user': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'GET:/user/{id}': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'POST:/user/{id}': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'DELETE:/user/{id}': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'GET:/current/user': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'POST:/current/user/password': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },

  // 客户端相关 - 使用client token
  'GET:/client': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'POST:/client': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'GET:/client/{id}': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'PUT:/client/{id}': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'DELETE:/client/{id}': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },

  // 应用相关 - 使用client token进行管理
  'GET:/application': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'POST:/application': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'GET:/application/{id}': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'PUT:/application/{id}': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'DELETE:/application/{id}': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'POST:/application/{id}/image': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'DELETE:/application/{id}/image': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'GET:/application/{id}/message': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'DELETE:/application/{id}/message': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },

  // 消息相关 - 接收使用client token，发送使用app token
  'GET:/message': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'DELETE:/message': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'DELETE:/message/{id}': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'POST:/message': { strategy: AuthStrategy.APP_TOKEN_HEADER, tokenType: 'app' }, // 发送消息使用app token

  // 插件相关 - 使用client token
  'GET:/plugin': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'GET:/plugin/{id}/config': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'GET:/plugin/{id}/logs': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'POST:/plugin/{id}/config': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'POST:/plugin/{id}/enable': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'POST:/plugin/{id}/disable': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'GET:/plugin/{id}/display': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },

  // WebSocket流 - 使用client token
  'GET:/stream': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },

  // 系统信息 - 根据API规范，健康检查和版本信息无需认证
  'GET:/health': { strategy: AuthStrategy.BASIC_AUTH }, // 规范中无需认证，但后端可能要求基本认证
  'GET:/version': { strategy: AuthStrategy.BASIC_AUTH } // 规范中无需认证，但后端可能要求基本认证
}

/**
 * 统一认证服务
 */
export class AuthenticationService {
  private static instance: AuthenticationService
  private readonly STORAGE_PREFIX = 'woe_auth_'
  private readonly ENCRYPTION_KEY = import.meta.env.VITE_AUTH_ENCRYPTION_KEY || 'woe-default-key'
  private applicationsCache: Application[] = []  // 应用列表缓存

  /**
   * 设置应用列表缓存
   */
  setApplicationsCache(applications: Application[]): void {
    this.applicationsCache = applications

    // 自动为每个应用存储其 token
    applications.forEach(app => {
      if (app.token) {
        this.setAppToken(app.id, app.token)
      }
    })
  }

  /**
   * 获取应用列表缓存
   */
  getApplicationsCache(): Application[] {
    return this.applicationsCache
  }

  /**
   * 获取单例实例
   */
  static getInstance(): AuthenticationService {
    if (!AuthenticationService.instance) {
      AuthenticationService.instance = new AuthenticationService()
    }
    return AuthenticationService.instance
  }

  /**
   * 加密存储数据
   */
  private encrypt(data: string): string {
    return CryptoJS.AES.encrypt(data, this.ENCRYPTION_KEY).toString()
  }

  /**
   * 解密存储数据
   */
  private decrypt(encryptedData: string): string {
    try {
      const bytes = CryptoJS.AES.decrypt(encryptedData, this.ENCRYPTION_KEY)
      return bytes.toString(CryptoJS.enc.Utf8)
    } catch {
      return ''
    }
  }

  /**
   * 存储token信息
   */
  setToken(type: 'client' | 'app', token: string, expires?: Date): void {
    const tokenInfo: TokenInfo = {
      token,
      type,
      expires: expires || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 默认30天过期
      lastUsed: new Date()
    }

    const encrypted = this.encrypt(JSON.stringify(tokenInfo))
    localStorage.setItem(`${this.STORAGE_PREFIX}${type}_token`, encrypted)
  }

  /**
   * 获取token信息
   */
  getToken(type: 'client' | 'app'): TokenInfo | null {
    const encrypted = localStorage.getItem(`${this.STORAGE_PREFIX}${type}_token`)
    if (!encrypted) return null

    try {
      const decrypted = this.decrypt(encrypted)
      const tokenInfo = JSON.parse(decrypted) as TokenInfo

      // 检查过期时间
      if (tokenInfo.expires && new Date(tokenInfo.expires) < new Date()) {
        this.removeToken(type)
        return null
      }

      return tokenInfo
    } catch {
      this.removeToken(type)
      return null
    }
  }

  /**
   * 删除token信息
   */
  removeToken(type: 'client' | 'app'): void {
    localStorage.removeItem(`${this.STORAGE_PREFIX}${type}_token`)
  }

  /**
   * 清理所有认证信息
   */
  clearAllAuth(): void {
    // 清理tokens
    this.removeToken('client')
    this.removeToken('app')

    // 清理旧的token格式（向后兼容）
    localStorage.removeItem('woe_token')

    // 清理其他可能的认证数据
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith(this.STORAGE_PREFIX)) {
        localStorage.removeItem(key)
      }
    })
  }

  /**
   * 验证token有效性
   */
  isTokenValid(type: 'client' | 'app'): boolean {
    const tokenInfo = this.getToken(type)
    if (!tokenInfo) return false

    // 检查过期时间
    if (tokenInfo.expires && new Date(tokenInfo.expires) < new Date()) {
      this.removeToken(type)
      return false
    }

    return true
  }

  /**
   * 获取认证策略
   */
  getAuthStrategy(endpoint: string, method: string, appId?: number): AuthConfig {
    const key = `${method.toUpperCase()}:${endpoint}`

    // 精确匹配
    if (ENDPOINT_AUTH_MAP[key]) {
      const config = ENDPOINT_AUTH_MAP[key]

      // 如果需要app token但传入了appId，使用该应用的token
      if (config.tokenType === 'app' && appId) {
        const appTokenInfo = this.getAppToken(appId)
        if (appTokenInfo) {
          return {
            strategy: config.strategy,
            token: appTokenInfo.token
          }
        }
        return { strategy: config.strategy }
      }

      const tokenInfo = this.getToken(config.tokenType!)
      if (tokenInfo) {
        return {
          strategy: config.strategy,
          token: tokenInfo.token
        }
      }
      return { strategy: config.strategy }
    }

    // 模糊匹配（带参数的端点）
    const matchedKey = Object.keys(ENDPOINT_AUTH_MAP).find(patternKey => {
      const [methodPattern, endpointPattern] = patternKey.split(':')

      if (methodPattern !== method.toUpperCase()) return false

      // 简单的路径参数匹配
      const patternParts = endpointPattern.split('/')
      const endpointParts = endpoint.split('/')

      if (patternParts.length !== endpointParts.length) return false

      return patternParts.every((part, index) =>
        part.startsWith('{') && part.endsWith('}') || part === endpointParts[index]
      )
    })

    if (matchedKey) {
      const config = ENDPOINT_AUTH_MAP[matchedKey]
      const tokenInfo = this.getToken(config.tokenType!)
      if (tokenInfo) {
        return {
          strategy: config.strategy,
          token: tokenInfo.token
        }
      }
      return { strategy: config.strategy }
    }

    // 默认使用client token
    if (method.toUpperCase() === 'POST' && endpoint === '/message') {
      return { strategy: AuthStrategy.APP_TOKEN_HEADER }
    }
    const clientTokenInfo = this.getToken('client')
    if (clientTokenInfo) {
      return {
        strategy: AuthStrategy.CLIENT_TOKEN_HEADER,
        token: clientTokenInfo.token
      }
    }

    return { strategy: AuthStrategy.BASIC_AUTH }
  }

  /**
   * 获取特定应用的token
   * 优先从localStorage获取，如果没有则尝试从应用列表缓存中获取
   */
  private getAppToken(appId: number): TokenInfo | null {
    // 首先尝试从localStorage获取
    const encrypted = localStorage.getItem(`${this.STORAGE_PREFIX}app_${appId}_token`)
    if (encrypted) {
      try {
        const decrypted = this.decrypt(encrypted)
        const tokenInfo = JSON.parse(decrypted) as TokenInfo

        if (tokenInfo.expires && new Date(tokenInfo.expires) < new Date()) {
          localStorage.removeItem(`${this.STORAGE_PREFIX}app_${appId}_token`)
        } else {
          return tokenInfo
        }
      } catch {
        localStorage.removeItem(`${this.STORAGE_PREFIX}app_${appId}_token`)
      }
    }

    // 如果localStorage中没有，尝试从应用列表缓存中获取
    const app = this.applicationsCache.find(a => a.id === appId)
    if (app && app.token) {
      // 将获取到的token存储到localStorage以便下次使用
      const tokenInfo: TokenInfo = {
        token: app.token,
        type: 'app',
        expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 默认30天过期
        lastUsed: new Date()
      }
      this.setAppToken(appId, app.token, tokenInfo.expires)
      return tokenInfo
    }

    return null
  }

  /**
   * 存储应用token
   */
  setAppToken(appId: number, token: string, expires?: Date): void {
    const tokenInfo: TokenInfo = {
      token,
      type: 'app',
      expires: expires || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      lastUsed: new Date()
    }

    const encrypted = this.encrypt(JSON.stringify(tokenInfo))
    localStorage.setItem(`${this.STORAGE_PREFIX}app_${appId}_token`, encrypted)
  }

  /**
   * 为请求添加认证头
   */
  applyAuth(config: any, endpoint?: string): any {
    if (!endpoint) return config

    const url = new URL(config.url || '', window.location.origin)
    const pathname = url.pathname.replace('/api/v1', '')
    const method = config.method?.toUpperCase() || 'GET'

    const authConfig = this.getAuthStrategy(pathname, method, config.appId)

    config.headers = config.headers || {}

    switch (authConfig.strategy) {
      case AuthStrategy.CLIENT_TOKEN_HEADER:
      case AuthStrategy.APP_TOKEN_HEADER:
        if (authConfig.token) {
          config.headers['X-Gotify-Key'] = authConfig.token
        }
        break

      case AuthStrategy.CLIENT_TOKEN_AUTHORIZATION_HEADER:
      case AuthStrategy.APP_TOKEN_AUTHORIZATION_HEADER:
        if (authConfig.token) {
          config.headers['Authorization'] = `Bearer ${authConfig.token}`
        }
        break

      case AuthStrategy.CLIENT_TOKEN_QUERY:
      case AuthStrategy.APP_TOKEN_QUERY:
        if (authConfig.token) {
          config.params = config.params || {}
          config.params.token = authConfig.token
        }
        break

      case AuthStrategy.BASIC_AUTH:
        // Basic Auth已在axios配置中处理
        break
    }

    return config
  }

  /**
   * 验证认证响应
   */
  validateAuthResponse(response: any): boolean {
    // 2xx状态码认为认证成功
    return response.status >= 200 && response.status < 300
  }

  /**
   * 处理认证失败
   */
  handleAuthError(error: any): boolean {
    const status = error.response?.status

    if (status === 401) {
      // 401错误清理所有认证信息
      this.clearAllAuth()
      return true
    }

    return false
  }
}

// 导出单例实例
export const authService = AuthenticationService.getInstance()

/**
 * 检查是否需要管理员权限
 * @throws Error 如果用户不是管理员
 */
export const requireAdmin = (): void => {
  const authStore = useAuthStore()
  if (!authStore.isAuthenticated) {
    throw new Error('请先登录')
  }
  if (!authStore.user?.admin) {
    throw new Error('需要管理员权限')
  }
}

/**
 * 检查是否需要认证
 * @throws Error 如果用户未登录
 */
export const requireAuth = (): void => {
  const authStore = useAuthStore()
  if (!authStore.isAuthenticated) {
    throw new Error('需要登录')
  }
}

/**
 * 检查是否是当前用户或管理员
 * @param userId 要操作的用户ID
 * @throws Error 如果没有权限
 */
export const requireSelfOrAdmin = (userId: number): void => {
  const authStore = useAuthStore()
  if (!authStore.isAuthenticated) {
    throw new Error('请先登录')
  }
  if (!authStore.user?.admin && authStore.user?.id !== userId) {
    throw new Error('只能操作自己的数据或需要管理员权限')
  }
}
