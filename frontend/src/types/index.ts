
export interface ErrorResponse {
  error: string
  errorCode: number
  errorDescription: string
}




export class ApiError extends Error {

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




export class ValidationError extends ApiError {
  constructor(errorDescription: string) {
    super('Validation Error', 400, errorDescription, 400)
    this.name = 'ValidationError'
  }
}




export class UnauthorizedError extends ApiError {
  constructor(errorDescription: string = 'Unauthorized') {
    super('Unauthorized', 401, errorDescription, 401)
    this.name = 'UnauthorizedError'
  }
}




export class ForbiddenError extends ApiError {
  constructor(errorDescription: string = 'Forbidden') {
    super('Forbidden', 403, errorDescription, 403)
    this.name = 'ForbiddenError'
  }
}




export class NotFoundError extends ApiError {
  constructor(errorDescription: string = 'Resource not found') {
    super('Not Found', 404, errorDescription, 404)
    this.name = 'NotFoundError'
  }
}




export class InternalServerError extends ApiError {
  constructor(errorDescription: string = 'Internal server error') {
    super('Internal Server Error', 500, errorDescription, 500)
    this.name = 'InternalServerError'
  }
}


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


export interface HealthStatus {
  readonly health: string
  readonly database: string
}

export interface VersionInfo {
  readonly version: string
  readonly commit: string
  readonly buildDate: string
}


export interface User {
  readonly id: number
  name: string
  nickname: string
  email: string
  avatar?: string
  description?: string
  admin: boolean
  disabled: boolean
}

export interface UpdateUserProfile {
  nickname?: string
  email?: string
  description?: string
}

export interface CreateUserExternal {
  name: string
  nickname: string
  email: string
  description?: string
  admin: boolean
  pass: string
}

export interface UpdateUserExternal {
  name: string
  nickname?: string
  email?: string
  description?: string
  admin: boolean
  pass?: string
}

export interface UserPass {
  pass: string
}

export interface ChangePasswordRequest {
  pass: string
}


export interface Application {
  readonly id: number





  readonly token?: string
  name: string
  sortKey: string
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
  sortKey?: string
}




export type ClientPlatform = string


export type ClientTokenStatus = 'active' | 'inactive' | 'invalid' | 'expired'

export interface Client {
  readonly id: number
  readonly token: string
  name: string
  platform?: ClientPlatform
  deviceUid?: string | null
  deviceToken?: string | null
  tokenUpdatedAt?: string | null
  tokenStatus?: ClientTokenStatus
  appVersion?: string | null
  deviceModel?: string | null

  elevatedUntil?: string | null
  readonly lastUsed?: string
}

export interface ClientParams {
  name: string
  platform?: ClientPlatform
  deviceUid?: string
  deviceToken?: string
  appVersion?: string
  deviceModel?: string




  expiresAfterInactivitySeconds?: number
}








export interface Extras {
  [key: string]: any
}

export interface Message {
  readonly id: number
  readonly appid: number
  message: string
  readonly date: string
  title?: string
  priority?: number
  extras?: Extras
}


export type PluginConfig = string

export interface Plugin {
  readonly id: number
  readonly name: string
  readonly token: string
  enabled: boolean
  readonly modulePath: string
  readonly icon?: string
  capabilities: string[]
  readonly author?: string
  readonly license?: string
  readonly website?: string
  readonly configExample?: string
}


export interface AvailablePlugin {
  modulePath: string
  name: string
  capabilities: string[]
}









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
      const url = new URL(nextUrl, window.location.origin)
      params = Object.fromEntries(url.searchParams.entries())
    } else {
      nextUrl = undefined
    }
  } while (nextUrl)

  return allItems
}
