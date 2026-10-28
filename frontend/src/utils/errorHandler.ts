import { ApiError } from '@/types'
import { browserNotificationService } from '@/services/browserNotification'
import i18n from '@/locales'


const t = (key: string, params?: Record<string, unknown>): string =>
  i18n.global.t(key, params ?? {})

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




export class ErrorHandler {
  private static instance: ErrorHandler
  private notificationCallbacks: Array<(notification: NotificationItem) => void> = []

  private constructor() {}




  static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler()
    }
    return ErrorHandler.instance
  }




  registerNotificationCallback(callback: (notification: NotificationItem) => void): void {
    this.notificationCallbacks.push(callback)
  }




  private notify(notification: NotificationItem): void {
    this.notificationCallbacks.forEach(callback => callback(notification))
  }




  handleApiError(error: ApiError | Error, context?: string): void {
    let title = t('errors.title')
    let message = t('errors.unexpected')

    if (error instanceof ApiError) {
      title = error.error
      message = error.errorDescription


      switch (error.statusCode) {
        case 400:
          title = t('errors.validationTitle')
          break
        case 401:
          title = t('errors.authTitle')
          message = t('errors.authMessage')
          break
        case 403:
          title = t('errors.forbiddenTitle')
          message = t('errors.forbiddenMessage')
          break
        case 404:
          title = t('errors.notFoundTitle')
          message = t('errors.notFoundMessage')
          break
        case 500:
          title = t('errors.serverTitle')
          message = t('errors.serverMessage')
          break
      }
    } else if (error.message) {
      message = error.message
    }


    if (context) {
      message = /[：:]\s*$/.test(context) ? `${context}${message}` : `${context}: ${message}`
    }

    this.notify({
      id: this.generateId(),
      type: NotificationType.ERROR,
      title,
      message,
      duration: 5000
    })


    browserNotificationService.showNotification({
      title,
      body: message,
      tag: `error-${this.generateId()}`,
      requireInteraction: true
    })
  }




  handleNetworkError(error: Error, context?: string): void {
    const title = t('errors.networkTitle')
    let message = t('errors.networkMessage')

    if (error.message) {
      message = error.message
    }

    if (context) {
      message = /[：:]\s*$/.test(context) ? `${context}${message}` : `${context}: ${message}`
    }

    this.notify({
      id: this.generateId(),
      type: NotificationType.ERROR,
      title,
      message,
      duration: 5000
    })


    browserNotificationService.showNotification({
      title,
      body: message,
      tag: `network-error-${this.generateId()}`,
      requireInteraction: true
    })
  }




  showSuccess(title: string, message?: string): void {
    this.notify({
      id: this.generateId(),
      type: NotificationType.SUCCESS,
      title,
      message,
      duration: 3000
    })


    browserNotificationService.showNotification({
      title,
      body: message,
      tag: `success-${this.generateId()}`
    })
  }




  showWarning(title: string, message?: string): void {
    this.notify({
      id: this.generateId(),
      type: NotificationType.WARNING,
      title,
      message,
      duration: 4000
    })


    browserNotificationService.showNotification({
      title,
      body: message,
      tag: `warning-${this.generateId()}`,
      requireInteraction: true
    })
  }




  showInfo(title: string, message?: string): void {
    this.notify({
      id: this.generateId(),
      type: NotificationType.INFO,
      title,
      message,
      duration: 4000
    })


    browserNotificationService.showNotification({
      title,
      body: message,
      tag: `info-${this.generateId()}`
    })
  }




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
          label: t('common.cancel'),
          action: () => {
            if (onCancel) onCancel()
            this.removeNotification(this.generateId())
          }
        },
        {
          label: t('common.confirmDialog.confirmButton'),
          action: () => {
            onConfirm()
            this.removeNotification(this.generateId())
          },
          primary: true
        }
      ]
    })
  }




  showMessageNotification(title: string, message: string, priority?: number): void {
    this.notify({
      id: this.generateId(),
      type: NotificationType.INFO,
      title,
      message,
      duration: priority && priority >= 2 ? 0 : 4000
    })


    browserNotificationService.showNotification({
      title,
      body: message,
      tag: `message-${this.generateId()}`,
      requireInteraction: Boolean(priority && priority >= 2)
    })
  }




  removeNotification(id: string): void {
    void id


  }




  private generateId(): string {
    return `notification-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }
}


export const errorHandler = ErrorHandler.getInstance()


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

export const showMessageNotification = (title: string, message: string, priority?: number) => {
  errorHandler.showMessageNotification(title, message, priority)
}
