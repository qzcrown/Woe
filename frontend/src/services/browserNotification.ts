import type { Message } from '@/types'

export interface NotificationOptions {
  title: string
  body?: string
  icon?: string
  badge?: string
  image?: string
  tag?: string
  data?: any
  requireInteraction?: boolean
  silent?: boolean
  forceShow?: boolean
  onClick?: (event: Event) => void
  onClose?: (event: Event) => void
  onError?: (event: Event) => void
  onShow?: (event: Event) => void
}

export interface NotificationSettings {
  enabled: boolean
  sound: boolean
  requireInteraction: boolean
  showOnlyWhenPageHidden: boolean
  priority: 'all' | 'high' | 'emergency'
}

export class BrowserNotificationService {
  private static instance: BrowserNotificationService
  private isSupported: boolean = false
  private permission: NotificationPermission = 'default'
  private settings: NotificationSettings = {
    enabled: true,
    sound: true,
    requireInteraction: false,
    showOnlyWhenPageHidden: false,
    priority: 'all'
  }
  private activeNotifications: Map<string, Notification> = new Map()
  private pageVisibilityHandler: () => void

  private constructor() {
    this.isSupported = 'Notification' in window
    this.permission = this.isSupported ? Notification.permission : 'denied'
    this.pageVisibilityHandler = this.handleVisibilityChange.bind(this)
    
    // 监听页面可见性变化
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.pageVisibilityHandler)
    }
    
    // 从本地存储加载设置
    this.loadSettings()
  }

  static getInstance(): BrowserNotificationService {
    if (!BrowserNotificationService.instance) {
      BrowserNotificationService.instance = new BrowserNotificationService()
    }
    return BrowserNotificationService.instance
  }

  /**
   * 检查浏览器是否支持通知
   */
  isNotificationSupported(): boolean {
    return this.isSupported
  }

  /**
   * 获取当前权限状态
   */
  getPermission(): NotificationPermission {
    return this.permission
  }

  /**
   * 请求通知权限
   */
  async requestPermission(): Promise<NotificationPermission> {
    if (!this.isSupported) {
      return 'denied'
    }

    if (this.permission !== 'default') {
      return this.permission
    }

    try {
      this.permission = await Notification.requestPermission()
      return this.permission
    } catch (error) {
      console.error('Failed to request notification permission:', error)
      return 'denied'
    }
  }

  /**
   * 显示通知
   */
  showNotification(options: NotificationOptions): boolean {
    if (!this.isSupported || this.permission !== 'granted') {
      return false
    }

    // 检查是否启用通知
    if (!this.settings.enabled) {
      return false
    }

    // 检查是否只在页面隐藏时显示（除非强制显示）
    if (this.settings.showOnlyWhenPageHidden && !document.hidden && !options.forceShow) {
      return false
    }

    try {
      const notificationOptions: any = {
        body: options.body,
        icon: options.icon || '/favicon.ico',
        badge: options.badge || '/favicon.ico',
        tag: options.tag,
        data: options.data,
        requireInteraction: options.requireInteraction || this.settings.requireInteraction,
        silent: !this.settings.sound
      }
      
      // Only add image if it's supported and provided
      if (options.image) {
        notificationOptions.image = options.image
      }
      
      const notification = new Notification(options.title, notificationOptions)

      // 设置事件监听器
      if (options.onClick) {
        notification.onclick = options.onClick
      }

      if (options.onClose) {
        notification.onclose = options.onClose
      }

      if (options.onError) {
        notification.onerror = options.onError
      }

      if (options.onShow) {
        notification.onshow = options.onShow
      }

      // 存储活动通知
      const id = options.tag || `notification-${Date.now()}`
      this.activeNotifications.set(id, notification)

      // 自动清理关闭的通知
      notification.onclose = (event) => {
        this.activeNotifications.delete(id)
        if (options.onClose) {
          options.onClose(event)
        }
      }

      return true
    } catch (error) {
      console.error('Failed to show notification:', error)
      return false
    }
  }

  /**
   * 显示消息通知
   */
  showMessageNotification(message: Message): boolean {
    // 检查消息优先级
    const priority = message.priority || 1
    if (this.settings.priority === 'high' && priority < 2) {
      return false
    }
    if (this.settings.priority === 'emergency' && priority < 3) {
      return false
    }

    const title = message.title || 'New Message'
    const body = message.message || ''
    
    return this.showNotification({
      title,
      body,
      tag: `message-${message.id}`,
      data: { messageId: message.id, type: 'message' },
      requireInteraction: priority >= 2, // 高优先级和紧急消息需要用户交互
      onClick: () => {
        // 点击通知时聚焦到窗口
        window.focus()
        // 可以在这里添加导航到消息详情的逻辑
      }
    })
  }

  /**
   * 关闭指定通知
   */
  closeNotification(tag: string): void {
    const notification = this.activeNotifications.get(tag)
    if (notification) {
      notification.close()
      this.activeNotifications.delete(tag)
    }
  }

  /**
   * 关闭所有通知
   */
  closeAllNotifications(): void {
    this.activeNotifications.forEach(notification => {
      notification.close()
    })
    this.activeNotifications.clear()
  }

  /**
   * 获取通知设置
   */
  getSettings(): NotificationSettings {
    return { ...this.settings }
  }

  /**
   * 更新通知设置
   */
  updateSettings(newSettings: Partial<NotificationSettings>): void {
    this.settings = { ...this.settings, ...newSettings }
    this.saveSettings()
  }

  /**
   * 从本地存储加载设置
   */
  private loadSettings(): void {
    try {
      const stored = localStorage.getItem('notification-settings')
      if (stored) {
        this.settings = { ...this.settings, ...JSON.parse(stored) }
      }
    } catch (error) {
      console.error('Failed to load notification settings:', error)
    }
  }

  /**
   * 保存设置到本地存储
   */
  private saveSettings(): void {
    try {
      localStorage.setItem('notification-settings', JSON.stringify(this.settings))
    } catch (error) {
      console.error('Failed to save notification settings:', error)
    }
  }

  /**
   * 处理页面可见性变化
   */
  private handleVisibilityChange(): void {
    // 页面变为可见时关闭所有需要交互的通知
    if (!document.hidden) {
      this.activeNotifications.forEach((notification, tag) => {
        if (notification.requireInteraction) {
          notification.close()
          this.activeNotifications.delete(tag)
        }
      })
    }
  }

  /**
   * 清理资源
   */
  destroy(): void {
    this.closeAllNotifications()
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.pageVisibilityHandler)
    }
  }
}

// 导出单例实例
export const browserNotificationService = BrowserNotificationService.getInstance()