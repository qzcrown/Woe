// ======== 错误响应类型 ========
export interface ErrorResponse {
  error: string
  errorCode: number
  errorDescription: string
}

/**
 * API错误基类
 */
export class ApiError extends Error {
  // Additional properties for error handling
  public responseData?: any
  public originalError?: any

  constructor(
    public error: string,
    public errorCode: number,
    public errorDescription: string,
    public statusCode?: number
  ) {
    super(errorDescription)
    this.name = 'ApiError'
  }
}

/**
 * 验证错误 (400)
 */
export class ValidationError extends ApiError {
  constructor(errorDescription: string) {
    super('Validation Error', 400, errorDescription, 400)
    this.name = 'ValidationError'
  }
}

/**
 * 未认证错误 (401)
 */
export class UnauthorizedError extends ApiError {
  constructor(errorDescription: string = 'Unauthorized') {
    super('Unauthorized', 401, errorDescription, 401)
    this.name = 'UnauthorizedError'
  }
}

/**
 * 禁止访问错误 (403)
 */
export class ForbiddenError extends ApiError {
  constructor(errorDescription: string = 'Forbidden') {
    super('Forbidden', 403, errorDescription, 403)
    this.name = 'ForbiddenError'
  }
}

/**
 * 资源未找到错误 (404)
 */
export class NotFoundError extends ApiError {
  constructor(errorDescription: string = 'Resource not found') {
    super('Not Found', 404, errorDescription, 404)
    this.name = 'NotFoundError'
  }
}

/**
 * 服务器内部错误 (500)
 */
export class InternalServerError extends ApiError {
  constructor(errorDescription: string = 'Internal server error') {
    super('Internal Server Error', 500, errorDescription, 500)
    this.name = 'InternalServerError'
  }
}

// ======== 分页相关 ========
export interface Paging {
  readonly size: number
  readonly since: number
  readonly limit: number
  readonly next?: string
}

export interface PagedMessages {
  readonly messages: Message[]
  readonly paging: Paging
}

// ======== 系统信息 ========
export interface HealthStatus {
  readonly health: string
  readonly database: string
}

export interface VersionInfo {
  readonly version: string
  readonly commit: string
  readonly buildDate: string
}

// ======== 用户相关 ========
export interface User {
  readonly id: number
  name: string
  admin: boolean
}

export interface CreateUserExternal {
  name: string
  admin: boolean
  pass: string
}

export interface UpdateUserExternal {
  name: string
  admin: boolean
  pass?: string
}

export interface UserPass {
  pass: string
}

// ======== 应用相关 ========
export interface Application {
  readonly id: number
  readonly token: string
  name: string
  description: string
  readonly image: string
  readonly internal: boolean
  defaultPriority?: number
  readonly lastUsed?: string
}

export interface ApplicationParams {
  name: string
  description?: string
  defaultPriority?: number
}

// ======== 客户端相关 ========
export interface Client {
  readonly id: number
  readonly token: string
  name: string
  readonly lastUsed?: string
}

export interface ClientParams {
  name: string
}

// ======== 消息相关 ========

/**
 * Extras扩展数据接口
 * 根据API规范，键应使用命名空间格式：<top-namespace>::[<sub-namespace>::]<action>
 * 保留命名空间：gotify、android、ios、web、server、client（不可用于其他用途）
 */
export interface Extras {
  [key: string]: any
}

export interface Message {
  readonly id: number
  readonly appid: number
  message: string
  readonly date: string
  title?: string      // Optional according to API spec
  priority?: number
  extras?: Extras     // Extended data key-value pairs
}

// ======== 插件相关 ========
export type PluginConfig = string  // YAML configuration string

export interface Plugin {
  readonly id: number
  readonly name: string
  readonly token: string
  enabled: boolean
  readonly modulePath: string
  capabilities: string[]
  readonly author?: string
  readonly license?: string
  readonly website?: string
}

// ======== 分页工具函数 ========

/**
 * 分页工具函数 - 支持基于 `next` URL的自动分页
 * @param fetchPage 获取单页数据的函数
 * @param initialParams 初始参数
 * @returns 所有数据项的数组
 */
export async function fetchAllPages<T>(
  fetchPage: (params?: any) => Promise<{ data: T[]; paging: Paging }>,
  initialParams?: any
): Promise<T[]> {
  const allItems: T[] = []
  let nextUrl: string | undefined
  let params = initialParams

  do {
    const response = await fetchPage(params)
    allItems.push(...response.data)

    if (response.paging.next) {
      nextUrl = response.paging.next
      const url = new URL(nextUrl)
      params = Object.fromEntries(url.searchParams.entries())
    } else {
      nextUrl = undefined
    }
  } while (nextUrl)

  return allItems
}
