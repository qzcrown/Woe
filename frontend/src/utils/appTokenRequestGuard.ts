









export interface AppTokenRequestContext {

  appId: number

  pageGeneration: number

  appGeneration: number

  requestSequence: number

  sessionRevision: number

  clientToken: string | null

  storedValue: string | null

  disposed: boolean
}





export function isAppTokenRequestCurrent(
  captured: AppTokenRequestContext,
  current: AppTokenRequestContext
): boolean {
  if (captured.disposed || current.disposed) return false
  return (
    captured.appId === current.appId &&
    captured.pageGeneration === current.pageGeneration &&
    captured.appGeneration === current.appGeneration &&
    captured.requestSequence === current.requestSequence &&
    captured.sessionRevision === current.sessionRevision &&
    captured.clientToken === current.clientToken &&
    captured.storedValue === current.storedValue
  )
}
