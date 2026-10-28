import { onBeforeUnmount, ref } from 'vue'
import { showError } from '@/utils/errorHandler'


export const COPY_FEEDBACK_MS = 1500

export interface CopyFeedbackOptions {

  isCurrent?: (text: string) => boolean

  errorTitle: () => string

  clearOnError?: boolean

  onExpiry?: () => boolean
}






export function useCopyFeedback(options: CopyFeedbackOptions) {
  const copied = ref(false)
  let sequence = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const clearCopyFeedback = (): void => {

    sequence += 1
    if (timer !== null) clearTimeout(timer)
    timer = null
    copied.value = false
  }

  const copyText = async (text: string | null | undefined): Promise<void> => {
    if (!text) return
    if (options.isCurrent && !options.isCurrent(text)) return
    const seq = ++sequence
    const stale = (): boolean =>
      sequence !== seq || (options.isCurrent ? !options.isCurrent(text) : false)
    try {
      await navigator.clipboard.writeText(text)
    } catch (err) {
      if (stale()) return
      if (options.clearOnError) clearCopyFeedback()
      showError(err as Error, options.errorTitle())
      return
    }
    if (stale()) return
    if (timer !== null) clearTimeout(timer)
    copied.value = true
    timer = setTimeout(() => {
      timer = null
      if (options.onExpiry && !options.onExpiry()) return
      copied.value = false
    }, COPY_FEEDBACK_MS)
  }

  onBeforeUnmount(clearCopyFeedback)

  return { copied, copyText, clearCopyFeedback }
}
