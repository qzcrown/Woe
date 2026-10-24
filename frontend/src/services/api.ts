import axios from 'axios'
import type {
  User,
  Application,
  Client,
  Message,
  Plugin,
  HealthStatus,
  VersionInfo,
  CreateUserExternal,
  UpdateUserExternal,
  ApplicationParams,
  ClientParams,
  PagedMessages,
  ErrorResponse,
  UpdateUserProfile,
  ChangePasswordRequest,
  AvailablePlugin,
  MessageJobsResponse,
  TriggerMessageJobResponse,
  AiQuotaListResponse,
} from '@/types'
import { QUOTA_NAMESPACE } from '@/utils/quota'
import {
  ApiError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  InternalServerError,
} from '@/types'
import { authService } from '@/services/auth'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/',
  timeout: 10000,
})







export const logoutHttpClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/',
  timeout: 10000,
})


api.interceptors.request.use((config) => {
  const configured = authService.applyAuth(config, config.url)


  configured.authSnapshot = {
    revision: authService.getSessionRevision(),
    clientToken: authService.getClientCredentialForRevocation(),
  }
  return configured
})


api.interceptors.response.use(
  (response) => response,
  (error) => {


    const isCurrentSessionAuthFailure = authService.handleAuthError(error)

    if (error.response?.status === 401 && isCurrentSessionAuthFailure) {
      window.location.href = '/login'
    }


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


      apiError.responseData = error.response.data
      error.formattedError = errorData
    } else {

      apiError = new ApiError(
        'Network Error',
        0,
        error.message || 'A network error occurred',
        undefined
      )
    }


    apiError.originalError = error

    return Promise.reject(apiError)
  }
)


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

  login: (username: string, password: string) => {
    return api.get('/current/user', {
      auth: { username, password },
    })
  },


  getCurrentUser: () => api.get<User>('/current/user'),






  logout: (capturedToken: string) =>
    logoutHttpClient.post('/auth/logout', undefined, {
      headers: { 'X-Gotify-Key': capturedToken },
    }),
}

export const userApi = {
  getUsers: () => api.get<User[]>('/user'),

  createUser: (user: CreateUserExternal) => api.post<User>('/user', user),

  getUser: (id: number) => api.get<User>(`/user/${id}`),

  updateUser: (id: number, user: UpdateUserExternal) => api.post<User>(`/user/${id}`, user),

  deleteUser: (id: number) => api.delete(`/user/${id}`),

  updateCurrentUserPassword: (passwordData: ChangePasswordRequest) =>
    api.post('/current/user/password', passwordData),


  updateProfile: (id: number, data: UpdateUserProfile) =>
    api.put<User>(`/user/${id}/profile`, data),

  uploadAvatar: (id: number, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post<User>(`/user/${id}/avatar`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  deleteAvatar: (id: number) =>
    api.delete(`/user/${id}/avatar`),


  getUserApplications: (id: number) => api.get<Application[]>(`/user/${id}/applications`),

  getUserClients: (id: number) => api.get<Client[]>(`/user/${id}/clients`),

  getUserPlugins: (id: number) => api.get<Plugin[]>(`/user/${id}/plugins`),


  getPluginPermissions: (id: number) => api.get<string[]>(`/user/${id}/plugin-permissions`),

  updatePluginPermissions: (id: number, modulePaths: string[]) =>
    api.put<string[]>(`/user/${id}/plugin-permissions`, { modulePaths }),


  setUserDisabled: (id: number, disabled: boolean) =>
    api.put<User>(`/user/${id}/disabled`, { disabled }),
}

export const applicationApi = {
  getApplications: () => api.get<Application[]>('/application'),

  getApplication: (id: number) => api.get<Application>(`/application/${id}`),

  createApplication: (app: ApplicationParams) => api.post<Application>('/application', app),

  updateApplication: (id: number, app: ApplicationParams) => api.put<Application>(`/application/${id}`, app),

  deleteApplication: (id: number) => api.delete(`/application/${id}`),


  getApplicationDetails: (id: number) => api.get<Application>(`/application/${id}`),


  getApplicationMessages: (id: number, params?: { limit?: number; since?: number }) => {
    try {
      const validatedParams = validatePagingParams(params, 100)
      return api.get<PagedMessages>(`/application/${id}/message`, { params: validatedParams })
    } catch (error) {
      return Promise.reject(error)
    }
  },


  deleteApplicationMessages: (id: number) => api.delete(`/application/${id}/message`),


  uploadApplicationImage: (id: number, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post<Application>(`/application/${id}/image`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },


  deleteApplicationImage: (id: number) => api.delete(`/application/${id}/image`),


  regenerateToken: (id: number) =>
    api.put<{ regenerateToken: { token: string } }>(`/application/${id}/security`, { regenerateToken: true }),
}

export const clientApi = {
  getClients: () => api.get<Client[]>('/client'),

  getClient: (id: number) => api.get<Client>(`/client/${id}`),


  getClientDetails: (id: number) => api.get<Client>(`/client/${id}`),

  createClient: (client: ClientParams, options?: { auth?: { username: string; password: string } }) =>
    api.post<Client>('/client', client, options),

  updateClient: (id: number, client: ClientParams) => api.put<Client>(`/client/${id}`, client),

  deleteClient: (id: number) => api.delete(`/client/${id}`),


  elevateClient: (id: number, durationSeconds: number, credentials: { username: string; password: string }) =>
    api.post<void>(`/client/${id}/elevate`, { durationSeconds }, { auth: credentials }),
}






const validatePagingParams = (params?: { limit?: number; since?: number }, limitDefault: number = 100): { limit?: number; since?: number } => {
  const validatedParams: { limit?: number; since?: number } = {}


  if (params?.limit !== undefined) {
    if (params.limit < 1 || params.limit > 200) {
      throw new ValidationError(`分页参数limit必须在1-200之间，当前值为: ${params.limit}`)
    }
    validatedParams.limit = params.limit
  } else {

    validatedParams.limit = limitDefault
  }


  if (params?.since !== undefined) {
    if (params.since < 0) {
      throw new ValidationError(`分页参数since必须大于等于0，当前值为: ${params.since}`)
    }
    validatedParams.since = params.since
  }

  return validatedParams
}

export const messageApi = {







  getMessages: (params?: { limit?: number; since?: number }) => {
    try {
      const validatedParams = validatePagingParams(params, 100)
      return api.get<PagedMessages>('/message', { params: validatedParams })
    } catch (error) {
      return Promise.reject(error)
    }
  },





  getMessageCount: () => api.get<{ count: number }>('/message/count'),







  createMessage: (appId: number, message: Partial<Message>) =>
    api.post<Message>('/message', { ...message, appid: appId }),

  deleteAllMessages: () => api.delete('/message'),

  deleteMessage: (id: number) => api.delete(`/message/${id}`),
}







export const messageJobsApi = {

  trigger: (messageId: number, pluginId: number) =>
    api.post<TriggerMessageJobResponse>(`/message/${messageId}/jobs`, { pluginId }),


  list: (messageId: number, pluginId?: number) =>
    api.get<MessageJobsResponse>(
      `/message/${messageId}/jobs`,
      pluginId === undefined ? undefined : { params: { pluginId } }
    ),
}


export const adminQuotaApi = {
  list: () => api.get<AiQuotaListResponse>(`/admin/quotas/${QUOTA_NAMESPACE}/users`),


  setLimit: (userId: number, limit: number) =>
    api.put(`/admin/quotas/${QUOTA_NAMESPACE}/${userId}`, { limit }),


  clearLimit: (userId: number) =>
    api.put(`/admin/quotas/${QUOTA_NAMESPACE}/${userId}`, { limit: null }),
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
  getLogs: (id: number, limit?: number) => api.get<any[]>(`/plugin/${id}/logs`, { params: { limit } }),


  updateName: (id: number, name: string) =>
    api.put<{ name: string }>(`/plugin/${id}/name`, { name }),


  uploadImage: (id: number, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post<{ icon: string }>(`/plugin/${id}/image`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },


  deleteImage: (id: number) => api.delete(`/plugin/${id}/image`),


  createPlugin: (modulePath: string, name: string, targetUserId?: number) =>
    api.post<Plugin>('/plugin', { modulePath, name, targetUserId }),


  deletePlugin: (id: number) => api.delete(`/plugin/${id}`),


  getAvailablePlugins: () => api.get<AvailablePlugin[]>('/plugin/available'),
}

export const systemApi = {
  getHealth: () => api.get<HealthStatus>('/health'),
  getVersion: () => api.get<VersionInfo>('/version'),
}

export const initApi = {
  getStatus: () => api.get('/init/status'),
  setupAdmin: (name: string, pass: string) => api.post('/init/admin', { name, pass })
}
