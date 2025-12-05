import { ApiError } from '@/types'

export enum NotificationType {
  SUCCESS = 'success',
  ERROR = 'error',
  WARNING = 'warning',
  INFO = 'info'
}

export interface NotificationItem {
  id: string
  type: NotificationType
  title: string
  message?: string
  duration?: number
  persistent?: boolean
  actions?: Array<{
    label: string
    action: () => void
    primary?: boolean
  }>
}

/**
 * 错误处理器类
 */
export class ErrorHandler {
  private static instance: ErrorHandler
  private notificationCallbacks: Array<(notification: NotificationItem) => void> = []

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler()
    }
    return ErrorHandler.instance
  }

  /**
   * 注册通知回调函数
   */
  registerNotificationCallback(callback: (notification: NotificationItem) => void): void {
    this.notificationCallbacks.push(callback)
  }

  /**
   * 触发通知
   */
  private notify(notification: NotificationItem): void {
    this.notificationCallbacks.forEach(callback => callback(notification))
  }

  /**
   * 处理API错误
   */
  handleApiError(error: ApiError | Error, context?: string): void {
    let title = 'Error'
    let message = 'An unexpected error occurred'
    
    if (error instanceof ApiError) {
      title = error.error
      message = error.errorDescription
      
      // 根据错误类型提供更友好的消息
      switch (error.statusCode) {
        case 400:
          title = 'Validation Error'
          break
        case 401:
          title = 'Authentication Error'
          message = 'Please log in to continue'
          break
        case 403:
          title = 'Permission Denied'
          message = 'You do not have permission to perform this action'
          break
        case 404:
          title = 'Not Found'
          message = 'The requested resource was not found'
          break
        case 500:
          title = 'Server Error'
          message = 'An internal server error occurred'
          break
      }
    } else if (error.message) {
      message = error.message
    }

    // 添加上下文信息
    if (context) {
      message = `${context}: ${message}`
    }

    this.notify({
      id: this.generateId(),
      type: NotificationType.ERROR,
      title,
      message,
      duration: 5000
    })
  }

  /**
   * 处理网络错误
   */
  handleNetworkError(error: Error, context?: string): void {
    const title = 'Network Error'
    let message = 'Please check your internet connection'
    
    if (error.message) {
      message = error.message
    }

    if (context) {
      message = `${context}: ${message}`
    }

    this.notify({
      id: this.generateId(),
      type: NotificationType.ERROR,
      title,
      message,
      duration: 5000
    })
  }

  /**
   * 显示成功消息
   */
  showSuccess(title: string, message?: string): void {
    this.notify({
      id: this.generateId(),
      type: NotificationType.SUCCESS,
      title,
      message,
      duration: 3000
    })
  }

  /**
   * 显示警告消息
   */
  showWarning(title: string, message?: string): void {
    this.notify({
      id: this.generateId(),
      type: NotificationType.WARNING,
      title,
      message,
      duration: 4000
    })
  }

  /**
   * 显示信息消息
   */
  showInfo(title: string, message?: string): void {
    this.notify({
      id: this.generateId(),
      type: NotificationType.INFO,
      title,
      message,
      duration: 4000
    })
  }

  /**
   * 显示确认对话框
   */
  showConfirm(
    title: string,
    message: string,
    onConfirm: () => void,
    onCancel?: () => void
  ): void {
    this.notify({
      id: this.generateId(),
      type: NotificationType.WARNING,
      title,
      message,
      persistent: true,
      actions: [
        {
          label: 'Cancel',
          action: () => {
            if (onCancel) onCancel()
            this.removeNotification(this.generateId())
          }
        },
        {
          label: 'Confirm',
          action: () => {
            onConfirm()
            this.removeNotification(this.generateId())
          },
          primary: true
        }
      ]
    })
  }

  /**
   * 移除通知
   */
  removeNotification(id: string): void {
    void id
    // 这里应该通知通知组件移除指定ID的通知
    // 实际实现可能需要通过状态管理来处理
  }

  /**
   * 生成唯一ID
   */
  private generateId(): string {
    return `notification-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }
}

// 导出单例实例
export const errorHandler = ErrorHandler.getInstance()

// 便捷方法
export const showError = (error: ApiError | Error, context?: string) => {
  errorHandler.handleApiError(error, context)
}

export const showSuccess = (title: string, message?: string) => {
  errorHandler.showSuccess(title, message)
}

export const showWarning = (title: string, message?: string) => {
  errorHandler.showWarning(title, message)
}

export const showInfo = (title: string, message?: string) => {
  errorHandler.showInfo(title, message)
}

export const showConfirm = (
  title: string,
  message: string,
  onConfirm: () => void,
  onCancel?: () => void
) => {
  errorHandler.showConfirm(title, message, onConfirm, onCancel)
}
