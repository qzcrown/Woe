import { ref, inject, provide, readonly, type InjectionKey } from 'vue'
import { useI18n } from 'vue-i18n'

/**
 * Alert 类型定义
 */
export type AlertType = 'success' | 'error' | 'warning' | 'info'

/**
 * Alert 选项接口
 */
export interface AlertOptions {
  /** 标题 */
  title?: string
  /** 消息内容 */
  message: string
  /** 确认按钮文本 */
  confirmText?: string
  /** 提示类型 */
  type?: AlertType
  /** 点击遮罩是否关闭 */
  closeOnOverlayClick?: boolean
}

/**
 * Alert 状态接口
 */
interface AlertState {
  /** 是否可见 */
  visible: boolean
  /** 选项 */
  options: AlertOptions
  /** 解析函数 */
  resolve: (() => void) | null
}

/**
 * Alert 上下文接口
 */
export interface AlertContext {
  /**
   * 显示 Alert 对话框
   * @param options - Alert 选项或消息字符串
   * @returns Promise，用户点击确认后 resolve
   */
  alert: (options: AlertOptions | string) => Promise<void>
  /**
   * 显示成功提示
   * @param message - 消息内容
   * @param title - 标题（可选）
   */
  success: (message: string, title?: string) => Promise<void>
  /**
   * 显示错误提示
   * @param message - 消息内容
   * @param title - 标题（可选）
   */
  error: (message: string, title?: string) => Promise<void>
  /**
   * 显示警告提示
   * @param message - 消息内容
   * @param title - 标题（可选）
   */
  warning: (message: string, title?: string) => Promise<void>
  /**
   * 显示信息提示
   * @param message - 消息内容
   * @param title - 标题（可选）
   */
  info: (message: string, title?: string) => Promise<void>
}

/** 注入键 */
const ALERT_KEY: InjectionKey<AlertContext> = Symbol('alert')

/**
 * 提供 Alert 上下文
 * 在 App.vue 中调用此函数来提供全局 Alert 功能
 * @returns Alert 状态和事件处理函数
 */
export function useAlertProvider() {
  const { t } = useI18n()

  const state = ref<AlertState>({
    visible: false,
    options: {
      message: ''
    },
    resolve: null
  })

  /**
   * 显示 Alert 对话框
   */
  const alert = (options: AlertOptions | string): Promise<void> => {
    return new Promise((resolve) => {
      const opts: AlertOptions = typeof options === 'string'
        ? { message: options }
        : options

      state.value = {
        visible: true,
        options: {
          confirmText: t('common.alert.confirmButton'),
          closeOnOverlayClick: true,
          ...opts
        },
        resolve
      }
    })
  }

  /**
   * 显示成功提示
   */
  const success = (message: string, title?: string): Promise<void> => {
    return alert({
      type: 'success',
      title,
      message
    })
  }

  /**
   * 显示错误提示
   */
  const error = (message: string, title?: string): Promise<void> => {
    return alert({
      type: 'error',
      title,
      message
    })
  }

  /**
   * 显示警告提示
   */
  const warning = (message: string, title?: string): Promise<void> => {
    return alert({
      type: 'warning',
      title,
      message
    })
  }

  /**
   * 显示信息提示
   */
  const info = (message: string, title?: string): Promise<void> => {
    return alert({
      type: 'info',
      title,
      message
    })
  }

  /**
   * 处理确认事件
   */
  const handleConfirm = () => {
    if (state.value.resolve) {
      state.value.resolve()
      state.value.visible = false
    }
  }

  const context: AlertContext = {
    alert,
    success,
    error,
    warning,
    info
  }

  provide(ALERT_KEY, context)

  return {
    state: readonly(state),
    handleConfirm
  }
}

/**
 * 使用 Alert 功能
 * 在任意子组件中调用此函数来使用 Alert
 * @returns Alert 上下文
 * @throws 如果不在 AlertProvider 内调用会抛出错误
 */
export function useAlert(): AlertContext {
  const context = inject<AlertContext>(ALERT_KEY)

  if (!context) {
    throw new Error('useAlert must be used within a component that provides AlertContext')
  }

  return context
}
