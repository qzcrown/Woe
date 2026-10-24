import CryptoJS from 'crypto-js'
import { useAuthStore } from '@/stores/auth'
import type { Application } from '@/types'







export interface AuthRequestSnapshot {

  revision: number

  clientToken: string | null
}

declare module 'axios' {
  export interface AxiosRequestConfig {

    authSnapshot?: AuthRequestSnapshot
  }
}




export enum AuthStrategy {

  CLIENT_TOKEN_AUTHORIZATION_HEADER = 'clientTokenAuthorizationHeader',
  CLIENT_TOKEN_HEADER = 'clientTokenHeader',
  CLIENT_TOKEN_QUERY = 'clientTokenQuery',


  APP_TOKEN_AUTHORIZATION_HEADER = 'appTokenAuthorizationHeader',
  APP_TOKEN_HEADER = 'appTokenHeader',
  APP_TOKEN_QUERY = 'appTokenQuery',


  BASIC_AUTH = 'basicAuth'
}









export interface TokenInfo {
  token: string
  type: 'client' | 'app'
  expires?: string | Date
  lastUsed?: string | Date
}





const AUTH_STORAGE_PREFIX = 'woe_auth_'


export const clientTokenStorageKey = (): string => `${AUTH_STORAGE_PREFIX}client_token`


export const appTokenStorageKey = (appId: number): string => `${AUTH_STORAGE_PREFIX}app_${appId}_token`


const APP_TOKEN_STORAGE_KEY_PATTERN = new RegExp(`^${AUTH_STORAGE_PREFIX}app_(\\d+)_token$`)





export const parseAppTokenStorageKey = (key: string): number | null => {
  const match = APP_TOKEN_STORAGE_KEY_PATTERN.exec(key)
  if (!match) return null
  const id = Number(match[1])
  return Number.isSafeInteger(id) && id > 0 ? id : null
}




export interface AuthConfig {
  strategy: AuthStrategy
  token?: string
  credentials?: { username: string; password: string }
  appId?: number
}




const ENDPOINT_AUTH_MAP: Record<string, { strategy: AuthStrategy; tokenType?: 'client' | 'app' }> = {




  'GET:/user': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'POST:/user': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'GET:/user/{id}': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'POST:/user/{id}': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'DELETE:/user/{id}': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'GET:/user/{id}/applications': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'GET:/user/{id}/clients': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'GET:/user/{id}/plugins': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'GET:/current/user': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'POST:/current/user/password': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },


  'GET:/client': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'POST:/client': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'GET:/client/{id}': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'PUT:/client/{id}': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'DELETE:/client/{id}': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },

  'POST:/client/{id}/elevate': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },


  'GET:/application': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'POST:/application': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'GET:/application/{id}': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'PUT:/application/{id}': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'DELETE:/application/{id}': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'POST:/application/{id}/image': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'DELETE:/application/{id}/image': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'GET:/application/{id}/message': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'DELETE:/application/{id}/message': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },

  'PUT:/application/{id}/security': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },



  'GET:/message': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'DELETE:/message': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'DELETE:/message/{id}': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'POST:/message': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },


  'GET:/plugin': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'GET:/plugin/{id}/config': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'GET:/plugin/{id}/logs': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'POST:/plugin/{id}/config': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'POST:/plugin/{id}/enable': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'POST:/plugin/{id}/disable': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },
  'GET:/plugin/{id}/display': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },


  'GET:/stream': { strategy: AuthStrategy.CLIENT_TOKEN_HEADER, tokenType: 'client' },


  'GET:/health': { strategy: AuthStrategy.BASIC_AUTH },
  'GET:/version': { strategy: AuthStrategy.BASIC_AUTH }
}




export class AuthenticationService {
  private static instance: AuthenticationService
  private readonly STORAGE_PREFIX = AUTH_STORAGE_PREFIX
  private readonly ENCRYPTION_KEY = import.meta.env.VITE_AUTH_ENCRYPTION_KEY || 'woe-default-key'
  private applicationsCache: Application[] = []




  private sessionRevision = 0

  private sessionChangeListeners: Array<() => void> = []








  setApplicationsCache(applications: Application[]): void {
    this.applicationsCache = applications
  }




  getApplicationsCache(): Application[] {
    return this.applicationsCache
  }




  static getInstance(): AuthenticationService {
    if (!AuthenticationService.instance) {
      AuthenticationService.instance = new AuthenticationService()
    }
    return AuthenticationService.instance
  }




  private encrypt(data: string): string {
    return CryptoJS.AES.encrypt(data, this.ENCRYPTION_KEY).toString()
  }




  private decrypt(encryptedData: string): string {
    try {
      const bytes = CryptoJS.AES.decrypt(encryptedData, this.ENCRYPTION_KEY)
      return bytes.toString(CryptoJS.enc.Utf8)
    } catch {
      return ''
    }
  }










  private parseStoredToken(encrypted: string): TokenInfo | null {
    try {
      const decrypted = this.decrypt(encrypted)
      const tokenInfo = JSON.parse(decrypted) as TokenInfo
      if (typeof tokenInfo?.token !== 'string' || tokenInfo.token.length === 0) {
        return null
      }
      return tokenInfo
    } catch {
      return null
    }
  }




  setToken(type: 'client' | 'app', token: string, expires?: Date): void {
    const tokenInfo: TokenInfo = {
      token,
      type,
      expires: expires || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      lastUsed: new Date()
    }

    const encrypted = this.encrypt(JSON.stringify(tokenInfo))
    localStorage.setItem(`${this.STORAGE_PREFIX}${type}_token`, encrypted)


    if (type === 'client') {
      this.bumpSessionRevision()
    }
  }




  getToken(type: 'client' | 'app'): TokenInfo | null {
    const encrypted = localStorage.getItem(`${this.STORAGE_PREFIX}${type}_token`)
    if (!encrypted) return null


    const tokenInfo = this.parseStoredToken(encrypted)
    if (!tokenInfo) {
      this.removeToken(type)
      return null
    }




    if (tokenInfo.expires) {
      let expiresAt: Date
      try {
        expiresAt = new Date(tokenInfo.expires)
      } catch {
        this.removeToken(type)
        return null
      }
      if (Number.isNaN(expiresAt.getTime()) || expiresAt < new Date()) {
        this.removeToken(type)
        return null
      }
    }

    return tokenInfo
  }




  removeToken(type: 'client' | 'app'): void {
    localStorage.removeItem(`${this.STORAGE_PREFIX}${type}_token`)

    if (type === 'client') {
      this.bumpSessionRevision()
    }
  }


  getSessionRevision(): number {
    return this.sessionRevision
  }








  subscribeSessionChanges(listener: () => void): () => void {

    const registration = () => listener()
    this.sessionChangeListeners.push(registration)
    return () => {
      this.sessionChangeListeners = this.sessionChangeListeners.filter(l => l !== registration)
    }
  }

  private bumpSessionRevision(): void {
    this.sessionRevision += 1



    for (const listener of [...this.sessionChangeListeners]) {
      try {
        listener()
      } catch {

      }
    }
  }










  getClientCredentialForRevocation(): string | null {
    try {
      const encrypted = localStorage.getItem(`${this.STORAGE_PREFIX}client_token`)
      if (!encrypted) return null
      return this.parseStoredToken(encrypted)?.token ?? null
    } catch {

      return null
    }
  }


  setClientId(id: number): void {
    localStorage.setItem('woe_client_id', String(id))
  }

  getClientId(): number | null {
    try {
      const raw = localStorage.getItem('woe_client_id')
      const id = raw ? Number(raw) : NaN
      return Number.isSafeInteger(id) && id > 0 ? id : null
    } catch {
      return null
    }
  }

  clearClientId(): void {
    localStorage.removeItem('woe_client_id')
  }




  clearAllAuth(): void {


    this.bumpSessionRevision()


    this.removeToken('client')
    this.removeToken('app')


    this.clearClientId()


    localStorage.removeItem('woe_token')


    Object.keys(localStorage).forEach(key => {
      if (key.startsWith(this.STORAGE_PREFIX)) {
        localStorage.removeItem(key)
      }
    })
  }




  isTokenValid(type: 'client' | 'app'): boolean {
    const tokenInfo = this.getToken(type)
    if (!tokenInfo) return false


    if (tokenInfo.expires && new Date(tokenInfo.expires) < new Date()) {
      this.removeToken(type)
      return false
    }

    return true
  }




  getAuthStrategy(endpoint: string, method: string, appId?: number): AuthConfig {
    const key = `${method.toUpperCase()}:${endpoint}`


    if (ENDPOINT_AUTH_MAP[key]) {
      const config = ENDPOINT_AUTH_MAP[key]


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


    const matchedKey = Object.keys(ENDPOINT_AUTH_MAP).find(patternKey => {
      const [methodPattern, endpointPattern] = patternKey.split(':')

      if (methodPattern !== method.toUpperCase()) return false


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


    if (method.toUpperCase() === 'POST' && endpoint === '/message') {
      return { strategy: AuthStrategy.CLIENT_TOKEN_HEADER }
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













  getAppToken(appId: number): TokenInfo | null {
    try {
      const encrypted = localStorage.getItem(`${this.STORAGE_PREFIX}app_${appId}_token`)
      if (!encrypted) return null


      const tokenInfo = this.parseStoredToken(encrypted)
      if (!tokenInfo || tokenInfo.type !== 'app') {
        this.removeAppToken(appId)
        return null
      }





      if (tokenInfo.expires !== undefined && tokenInfo.expires !== null) {
        let expiresAt: Date
        try {
          expiresAt = new Date(tokenInfo.expires)
        } catch {
          this.removeAppToken(appId)
          return null
        }
        if (Number.isNaN(expiresAt.getTime()) || expiresAt < new Date()) {
          this.removeAppToken(appId)
          return null
        }
      }

      return tokenInfo
    } catch {

      return null
    }
  }








  getAppTokenStorageSnapshot(appId: number): string | null {
    try {
      return localStorage.getItem(`${this.STORAGE_PREFIX}app_${appId}_token`)
    } catch {
      return null
    }
  }











  removeAppTokenIfUnchanged(appId: number, expectedStoredValue: string | null): boolean {
    if (expectedStoredValue === null) return false
    const key = `${this.STORAGE_PREFIX}app_${appId}_token`
    try {
      const current = localStorage.getItem(key)
      if (current === null || current !== expectedStoredValue) return false
      localStorage.removeItem(key)
      return true
    } catch {

      return false
    }
  }




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




  removeAppToken(appId: number): void {
    localStorage.removeItem(`${this.STORAGE_PREFIX}app_${appId}_token`)
  }




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

        break
    }

    return config
  }




  validateAuthResponse(response: any): boolean {

    return response.status >= 200 && response.status < 300
  }









  handleAuthError(error: any): boolean {
    const status = error.response?.status

    if (status === 401) {
      if (this.isStaleAuthError(error)) {
        return false
      }
      this.clearAllAuth()
      return true
    }

    return false
  }






  isStaleAuthError(error: any): boolean {
    const snapshot: AuthRequestSnapshot | undefined = error?.config?.authSnapshot
    if (!snapshot) return false
    if (snapshot.revision !== this.sessionRevision) return true


    if (snapshot.clientToken !== this.getClientCredentialForRevocation()) return true
    return false
  }
}


export const authService = AuthenticationService.getInstance()










export async function withElevationRetry<T>(action: () => Promise<T>): Promise<T> {
  const { useElevatedAction } = await import('@/composables/useElevatedAction')
  return useElevatedAction().withElevation(action)
}





export const requireAdmin = (): void => {
  const authStore = useAuthStore()
  if (!authStore.isAuthenticated) {
    throw new Error('请先登录')
  }
  if (!authStore.user?.admin) {
    throw new Error('需要管理员权限')
  }
}





export const requireAuth = (): void => {
  const authStore = useAuthStore()
  if (!authStore.isAuthenticated) {
    throw new Error('需要登录')
  }
}






export const requireSelfOrAdmin = (userId: number): void => {
  const authStore = useAuthStore()
  if (!authStore.isAuthenticated) {
    throw new Error('请先登录')
  }
  if (!authStore.user?.admin && authStore.user?.id !== userId) {
    throw new Error('只能操作自己的数据或需要管理员权限')
  }
}
