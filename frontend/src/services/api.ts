import axios from 'axios'
import type {
  User,
  Application,
  Client,
  Message,
  Plugin,
  HealthStatus,
  VersionInfo,
  UserPass,
  CreateUserExternal,
  UpdateUserExternal,
  ApplicationParams,
  ClientParams,
  PagedMessages,
  ErrorResponse,
} from '@/types'
import {
  ApiError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  InternalServerError,
} from '@/types'
import { authService } from '@/services/auth'

// 扩展AxiosRequestConfig类型以支持appId属性
declare module 'axios' {
  interface AxiosRequestConfig {
    appId?: number
  }
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/',
  timeout: 10000,
})

// Request interceptor to add authentication
api.interceptors.request.use((config) => {
  return authService.applyAuth(config, config.url)
})

// Response interceptor to handle errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Handle authentication errors using authService
    authService.handleAuthError(error)

    // Handle 401 unauthorized
    if (error.response?.status === 401) {
      // Clear all authentication data
      authService.clearAllAuth()
      window.location.href = '/login'
    }

    // Standardize error format according to API spec and create appropriate error class
    let apiError: ApiError

    if (error.response?.data) {
      const errorData: ErrorResponse = {
        error: error.response.data.error || error.response.statusText || 'Unknown error',
        errorCode: error.response.status || 500,
        errorDescription:
          error.response.data.errorDescription ||
          error.response.data.message ||
          error.response.data.error ||
          'An error occurred while processing your request',
      }

      // Create appropriate error class based on status code
      switch (error.response.status) {
        case 400:
          apiError = new ValidationError(errorData.errorDescription)
          break
        case 401:
          apiError = new UnauthorizedError(errorData.errorDescription)
          break
        case 403:
          apiError = new ForbiddenError(errorData.errorDescription)
          break
        case 404:
          apiError = new NotFoundError(errorData.errorDescription)
          break
        case 500:
          apiError = new InternalServerError(errorData.errorDescription)
          break
        default:
          apiError = new ApiError(
            errorData.error,
            errorData.errorCode,
            errorData.errorDescription,
            error.response.status
          )
      }

      // Attach the original error response data
      apiError.responseData = error.response.data
      error.formattedError = errorData
    } else {
      // Network error or other non-API error
      apiError = new ApiError(
        'Network Error',
        0,
        error.message || 'A network error occurred',
        undefined
      )
    }

    // Attach the original axios error for debugging
    apiError.originalError = error

    return Promise.reject(apiError)
  }
)

// Development logging
if (import.meta.env.DEV) {
  api.interceptors.request.use((config) => {
    console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`)
    return config
  })

  api.interceptors.response.use(
    (response) => {
      console.log(`[API] Response:`, response.status, response.config.url)
      return response
    },
    (error) => {
      console.error(`[API] Error:`, error.response?.status, error.config?.url, error.formattedError)
      return Promise.reject(error)
    }
  )
}

export default api

export const authApi = {
  // Login with basic auth
  login: (username: string, password: string) => {
    return api.get('/current/user', {
      auth: { username, password },
    })
  },

  // Get current user info
  getCurrentUser: () => api.get<User>('/current/user'),
}

export const userApi = {
  getUsers: () => api.get<User[]>('/user'),

  createUser: (user: CreateUserExternal) => api.post<User>('/user', user),

  getUser: (id: number) => api.get<User>(`/user/${id}`),

  updateUser: (id: number, user: UpdateUserExternal) => api.post<User>(`/user/${id}`, user),

  deleteUser: (id: number) => api.delete(`/user/${id}`),

  updateCurrentUserPassword: (passwordData: UserPass) =>
    api.post('/current/user/password', passwordData),
}

export const applicationApi = {
  getApplications: () => api.get<Application[]>('/application'),

  getApplication: (id: number) => api.get<Application>(`/application/${id}`),

  createApplication: (app: ApplicationParams) => api.post<Application>('/application', app),

  updateApplication: (id: number, app: ApplicationParams) => api.put<Application>(`/application/${id}`, app),

  deleteApplication: (id: number) => api.delete(`/application/${id}`),

  // 获取单个应用详情（新增）
  getApplicationDetails: (id: number) => api.get<Application>(`/application/${id}`),

  // 获取特定应用的消息（含分页）
  getApplicationMessages: (id: number, params?: { limit?: number; since?: number }) => {
    try {
      const validatedParams = validatePagingParams(params, 100)
      return api.get<PagedMessages>(`/application/${id}/message`, { params: validatedParams })
    } catch (error) {
      return Promise.reject(error)
    }
  },

  // 删除特定应用的所有消息
  deleteApplicationMessages: (id: number) => api.delete(`/application/${id}/message`),

  // 上传应用图标
  uploadApplicationImage: (id: number, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post<Application>(`/application/${id}/image`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  // 删除应用图标
  deleteApplicationImage: (id: number) => api.delete(`/application/${id}/image`),
}

export const clientApi = {
  getClients: () => api.get<Client[]>('/client'),

  getClient: (id: number) => api.get<Client>(`/client/${id}`),

  // 获取单个客户端详情（新增）
  getClientDetails: (id: number) => api.get<Client>(`/client/${id}`),

  createClient: (client: ClientParams, options?: { auth?: { username: string; password: string } }) =>
    api.post<Client>('/client', client, options),

  updateClient: (id: number, client: ClientParams) => api.put<Client>(`/client/${id}`, client),

  deleteClient: (id: number) => api.delete(`/client/${id}`),
}

/**
 * 分页参数验证函数
 * 根据docs/api_spec.json规范验证limit和since参数
 * 提供更清晰的错误提示
 */
const validatePagingParams = (params?: { limit?: number; since?: number }, limitDefault: number = 100): { limit?: number; since?: number } => {
  const validatedParams: { limit?: number; since?: number } = {}

  // 验证limit参数 (1-200)
  if (params?.limit !== undefined) {
    if (params.limit < 1 || params.limit > 200) {
      throw new ValidationError(`分页参数limit必须在1-200之间，当前值为: ${params.limit}`)
    }
    validatedParams.limit = params.limit
  } else {
    // 未提供时使用默认值
    validatedParams.limit = limitDefault
  }

  // 验证since参数 (>=0)
  if (params?.since !== undefined) {
    if (params.since < 0) {
      throw new ValidationError(`分页参数since必须大于等于0，当前值为: ${params.since}`)
    }
    validatedParams.since = params.since
  }

  return validatedParams
}

export const messageApi = {
  /**
   * 获取所有消息（含分页）
   * @param params 分页参数
   * @param params.limit 最大消息数量 (1-200, 默认100)
   * @param params.since 返回 ID 小于该值的消息 (≥0)
   * @returns Promise<PagedMessages>
   */
  getMessages: (params?: { limit?: number; since?: number }) => {
    try {
      const validatedParams = validatePagingParams(params, 100)
      return api.get<PagedMessages>('/message', { params: validatedParams })
    } catch (error) {
      return Promise.reject(error)
    }
  },

  /**
   * 创建消息（使用应用令牌认证）
   * @param appId 应用ID
   * @param message 消息内容（支持 Partial<Message>）
   * @returns Promise<Message>
   */
  createMessage: (appId: number, message: Partial<Message>) =>
    api.post<Message>('/message', message, { appId }),

  deleteAllMessages: () => api.delete('/message'),

  deleteMessage: (id: number) => api.delete(`/message/${id}`),
}

export const pluginApi = {
  getPlugins: () => api.get<Plugin[]>('/plugin'),

  getConfig: (id: number) => api.get<string>(`/plugin/${id}/config`, {
    responseType: 'text' as any,
    headers: { 'Accept': 'application/x-yaml' }
  }),

  updateConfig: (id: number, yaml: string) =>
    api.post(`/plugin/${id}/config`, yaml, { headers: { 'Content-Type': 'application/x-yaml' } }),

  enable: (id: number) => api.post(`/plugin/${id}/enable`, {}),

  disable: (id: number) => api.post(`/plugin/${id}/disable`, {}),

  getDisplay: (id: number) => api.get<string>(`/plugin/${id}/display`),
  getLogs: (id: number, limit?: number) => api.get<any[]>(`/plugin/${id}/logs`, { params: { limit } })
}

export const systemApi = {
  getHealth: () => api.get<HealthStatus>('/health'),
  getVersion: () => api.get<VersionInfo>('/version'),
}

export const initApi = {
  getStatus: () => api.get('/init/status'),
  setupAdmin: (name: string, pass: string) => api.post('/init/admin', { name, pass })
}
