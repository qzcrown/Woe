import { ref, inject, provide, readonly, type InjectionKey } from 'vue'

export interface ConfirmOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  type?: 'info' | 'warning' | 'danger'
  closeOnOverlayClick?: boolean
}

interface ConfirmState {
  visible: boolean
  options: ConfirmOptions
  resolve: ((value: boolean) => void) | null
  loading: boolean
}

const CONFIRM_DIALOG_KEY: InjectionKey<ConfirmDialogContext> = Symbol('confirmDialog')

export interface ConfirmDialogContext {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  setLoading: (loading: boolean) => void
}

export function useConfirmDialogProvider() {
  const state = ref<ConfirmState>({
    visible: false,
    options: {
      message: ''
    },
    resolve: null,
    loading: false
  })

  const confirm = (options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      state.value = {
        visible: true,
        options,
        resolve,
        loading: false
      }
    })
  }

  const handleConfirm = () => {
    if (state.value.resolve) {
      state.value.resolve(true)
      state.value.visible = false
    }
  }

  const handleCancel = () => {
    if (state.value.resolve) {
      state.value.resolve(false)
      state.value.visible = false
    }
  }

  const setLoading = (loading: boolean) => {
    state.value.loading = loading
  }

  const context: ConfirmDialogContext = {
    confirm,
    setLoading
  }

  provide(CONFIRM_DIALOG_KEY, context)

  return {
    state: readonly(state),
    handleConfirm,
    handleCancel
  }
}

export function useConfirmDialog() {
  const context = inject<ConfirmDialogContext>(CONFIRM_DIALOG_KEY)

  if (!context) {
    throw new Error('useConfirmDialog must be used within a component that provides ConfirmDialogContext')
  }

  return context
}
