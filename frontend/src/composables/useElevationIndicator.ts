import { computed, onScopeDispose, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'


const TICK_MS = 1000















export function useElevationIndicator() {
  const authStore = useAuthStore()
  const now = ref(Date.now())
  let timer: ReturnType<typeof setInterval> | null = null

  const stopTicker = (): void => {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  const isElevated = computed(() => {
    const until = authStore.elevatedUntil
    return !!until && until.getTime() > now.value
  })

  watch(
    isElevated,
    (active) => {
      if (active && timer === null) {

        now.value = Date.now()
        timer = setInterval(() => {
          now.value = Date.now()
        }, TICK_MS)
      } else if (!active) {
        stopTicker()
      }
    },
    { immediate: true }
  )

  onScopeDispose(stopTicker)

  return { isElevated }
}
