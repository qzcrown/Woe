import { readonly, ref } from 'vue'
import { clientApi } from '@/services/api'
import { authService } from '@/services/auth'
import { useAuthStore } from '@/stores/auth'
import { ForbiddenError } from '@/types'


export const ELEVATION_DURATION_SECONDS = 900


export const MAX_ELEVATION_ATTEMPTS = 3





export class ElevationCancelledError extends Error {
  constructor() {
    super('elevation-cancelled')
    this.name = 'ElevationCancelledError'
  }
}




export class ElevationSessionChangedError extends ElevationCancelledError {}


export const isElevationCancelled = (e: unknown): e is ElevationCancelledError =>
  e instanceof ElevationCancelledError


export const isElevationSessionChanged = (e: unknown): e is ElevationSessionChangedError =>
  e instanceof ElevationSessionChangedError


export type ElevationModalError = 'wrongPassword' | 'requestFailed'


export type ElevationModalMode = 'password' | 'message'


export type ElevationMessageKey = 'elevate.relogin' | 'elevate.attemptsExhausted'


const isElevationModalOpen = ref(false)

const elevationModalFlowId = ref(0)
const elevationModalMode = ref<ElevationModalMode>('password')
const elevationModalLoading = ref(false)
const elevationModalError = ref<ElevationModalError | null>(null)

const elevationModalMessageKey = ref<ElevationMessageKey>('elevate.relogin')


interface ElevationFlowCallbacks {

  resolvePassword: (password: string) => void

  cancel: () => void
}
let activeFlow: ElevationFlowCallbacks | null = null


interface ElevationSession {
  revision: number
  clientToken: string | null
  clientId: number | null
}
interface ElevationFlight {
  session: ElevationSession
  username: string
  callers: Set<() => boolean>
  cancelled: boolean
  cancelPassword: (() => void) | null
  promise: Promise<void>
}
let elevationInFlight: ElevationFlight | null = null

let modalFlight: ElevationFlight | null = null

const captureSession = (): ElevationSession => ({
  revision: authService.getSessionRevision(),
  clientToken: authService.getClientCredentialForRevocation(),
  clientId: authService.getClientId()
})
const sameSession = (a: ElevationSession, b: ElevationSession): boolean =>
  a.revision === b.revision && a.clientToken === b.clientToken && a.clientId === b.clientId
const callerIsCurrent = (isCurrent: () => boolean): boolean => {
  try { return isCurrent() } catch { return false }
}
const flightIsCurrent = (flight: ElevationFlight): boolean =>
  !flight.cancelled && sameSession(flight.session, captureSession()) &&
  [...flight.callers].some(callerIsCurrent)

function cancelFlight(flight: ElevationFlight): void {
  flight.cancelled = true
  flight.cancelPassword?.()
  flight.cancelPassword = null
  if (modalFlight === flight) closeElevationModal()
}
function assertFlightCurrent(flight: ElevationFlight): void {
  if (flightIsCurrent(flight)) return
  cancelFlight(flight)

  if (!sameSession(flight.session, captureSession())) throw new ElevationSessionChangedError()
  throw new ElevationCancelledError()
}

function closeElevationModal(): void {
  modalFlight = null
  activeFlow = null
  isElevationModalOpen.value = false
  elevationModalLoading.value = false
  elevationModalError.value = null
}





function promptForPassword(flight: ElevationFlight): Promise<string | null> {
  return new Promise((resolve) => {



    if (!(isElevationModalOpen.value && elevationModalMode.value === 'password')) {
      elevationModalError.value = null
    }
    elevationModalMode.value = 'password'
    elevationModalLoading.value = false
    isElevationModalOpen.value = true
    modalFlight = flight
    const finish = (password: string | null): void => {
      flight.cancelPassword = null
      resolve(password)
    }
    flight.cancelPassword = () => finish(null)
    activeFlow = {
      resolvePassword: (password) => finish(password),
      cancel: () => finish(null)
    }
  })
}


function showElevationMessage(messageKey: ElevationMessageKey): void {
  activeFlow = null
  elevationModalError.value = null
  elevationModalLoading.value = false
  elevationModalMode.value = 'message'
  elevationModalMessageKey.value = messageKey
  isElevationModalOpen.value = true
}


function isSessionNotElevatedError(error: unknown): error is ForbiddenError {
  return error instanceof ForbiddenError && /session not elevated/i.test(error.message)
}






async function performElevation(flight: ElevationFlight): Promise<void> {
  const authStore = useAuthStore()
  const clientId = flight.session.clientId
  assertFlightCurrent(flight)
  if (clientId === null) {
    showElevationMessage('elevate.relogin')
    throw new ElevationCancelledError()
  }

  for (let attempt = 1; attempt <= MAX_ELEVATION_ATTEMPTS; attempt++) {
    assertFlightCurrent(flight)
    const password = await promptForPassword(flight)

    assertFlightCurrent(flight)
    if (password === null) {
      cancelFlight(flight)
      throw new ElevationCancelledError()
    }

    elevationModalLoading.value = true
    try {
      await clientApi.elevateClient(clientId, ELEVATION_DURATION_SECONDS, {
        username: flight.username,
        password
      })
      assertFlightCurrent(flight)
      authStore.markElevated(ELEVATION_DURATION_SECONDS)
      if (modalFlight === flight) closeElevationModal()
      return
    } catch (error) {

      assertFlightCurrent(flight)
      if (isElevationCancelled(error)) throw error
      elevationModalLoading.value = false
      elevationModalError.value = error instanceof ForbiddenError ? 'wrongPassword' : 'requestFailed'
      if (attempt >= MAX_ELEVATION_ATTEMPTS) {
        showElevationMessage('elevate.attemptsExhausted')
        throw new ElevationCancelledError()
      }
    }
  }
  throw new ElevationCancelledError()
}


function ensureElevated(session: ElevationSession, isCurrent: () => boolean): Promise<void> {
  const existing = elevationInFlight
  if (existing && sameSession(existing.session, session) && flightIsCurrent(existing)) {
    existing.callers.add(isCurrent)
    return existing.promise
  }
  if (existing) cancelFlight(existing)

  elevationModalFlowId.value += 1
  const flight: ElevationFlight = {
    session,
    username: useAuthStore().user?.name ?? '',
    callers: new Set([isCurrent]),
    cancelled: false,
    cancelPassword: null,
    promise: Promise.resolve()
  }
  elevationInFlight = flight
  flight.promise = performElevation(flight).finally(() => {

    if (elevationInFlight === flight) elevationInFlight = null
  })
  return flight.promise
}















async function withElevation<T>(
  action: () => Promise<T>,
  isCurrent: () => boolean = () => true
): Promise<T> {
  const session = captureSession()
  const assertCurrent = (): void => {

    if (!sameSession(session, captureSession())) throw new ElevationSessionChangedError()
    if (!callerIsCurrent(isCurrent)) throw new ElevationCancelledError()
  }
  const runAction = async (): Promise<T> => {
    assertCurrent()
    try {
      const result = await action()
      assertCurrent()
      return result
    } catch (error) {
      assertCurrent()
      throw error
    }
  }
  try {
    return await runAction()
  } catch (error) {

    assertCurrent()
    if (!isSessionNotElevatedError(error)) throw error

    const authStore = useAuthStore()
    if (authStore.elevatedUntil && authStore.elevatedUntil.getTime() > Date.now()) {
      throw error
    }
    if (session.clientId === null) {
      showElevationMessage('elevate.relogin')
      throw new ElevationCancelledError()
    }

    await ensureElevated(session, isCurrent)
    assertCurrent()
    return await runAction()
  }
}


function handleElevationConfirm(password: string): void {
  if (!activeFlow || elevationModalLoading.value) return
  const flow = activeFlow
  activeFlow = null
  flow.resolvePassword(password)
}


function handleElevationCancel(): void {
  if (elevationModalLoading.value) return
  if (activeFlow) {
    const flow = activeFlow
    closeElevationModal()
    flow.cancel()
    return
  }

  isElevationModalOpen.value = false
}

export function useElevatedAction() {
  return {
    withElevation,
    isElevationModalOpen: readonly(isElevationModalOpen),
    elevationModalFlowId: readonly(elevationModalFlowId),
    elevationModalMode: readonly(elevationModalMode),
    elevationModalLoading: readonly(elevationModalLoading),
    elevationModalError: readonly(elevationModalError),
    elevationModalMessageKey: readonly(elevationModalMessageKey),
    handleElevationConfirm,
    handleElevationCancel
  }
}
