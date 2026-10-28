import axios from 'axios'
import { adminQuotaApi, messageJobsApi, pluginApi } from '@/services/api'
import { authService, clientIdStorageKey, clientTokenStorageKey } from '@/services/auth'
import { showError, showSuccess } from '@/utils/errorHandler'
import type { PluginUiApi, PluginUiHost } from './types'
export type { PluginUiHost }


export function createPluginUiHost(input: { ownerId: number }): PluginUiHost {
  const controller = new AbortController()
  const sessionRevision = authService.getSessionRevision()
  const credential = authService.getClientCredentialForRevocation()
  const clientId = authService.getClientId()
  let disposed = false
  let unsubscribe = () => {}
  const isCurrent = () => !disposed &&
    authService.getSessionRevision() === sessionRevision &&
    authService.getClientCredentialForRevocation() === credential &&
    authService.getClientId() === clientId
  const dispose = () => {
    if (disposed) return
    disposed = true
    unsubscribe()
    window.removeEventListener('storage', onStorage)
    controller.abort()
  }
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea && event.storageArea !== localStorage) return
    if (event.key !== null && event.key !== clientTokenStorageKey() && event.key !== clientIdStorageKey()) return
    if (!isCurrent()) dispose()
  }
  unsubscribe = authService.subscribeSessionChanges(() => { if (!isCurrent()) dispose() })
  window.addEventListener('storage', onStorage)
  const requestOptions = { signal: controller.signal, sessionGuard: isCurrent }
  const requestOptionsFor = (callGuard?: () => boolean) => callGuard === undefined
    ? requestOptions
    : {
        signal: controller.signal,
        sessionGuard: () => isCurrent() && callGuard()
      }
  const guard = async <T>(request: (options: typeof requestOptions) => Promise<T>, callGuard?: () => boolean): Promise<T> => {
    if (!isCurrent() || (callGuard && !callGuard())) throw new axios.CanceledError('Plugin context expired')
    const result = await request(requestOptionsFor(callGuard))
    if (!isCurrent() || (callGuard && !callGuard())) throw new axios.CanceledError('Plugin context expired')
    return result
  }
  const api: PluginUiApi = {
    listPlugins: () => guard(async options => (await pluginApi.getPlugins(options)).data),
    listJobs: (id, pluginId, callGuard) => guard(async options => (await messageJobsApi.list(id, pluginId, options)).data, callGuard),
    triggerJob: (id, pluginId, callGuard) => guard(async options => (await messageJobsApi.trigger(id, pluginId, options)).data, callGuard),
    listQuotas: namespace => guard(async options => (await adminQuotaApi.list(namespace, options)).data?.users ?? []),
    setQuota: (namespace, userId, limit) => guard(async options => {
      if (limit === null) await adminQuotaApi.clearLimit(namespace, userId, options)
      else await adminQuotaApi.setLimit(namespace, userId, limit, options)
    })
  }
  return {
    ownerId: input.ownerId, sessionRevision, signal: controller.signal, requestOptions, api, isCurrent, dispose,
    notify: {
      success(message) { if (isCurrent()) showSuccess(message) },
      error(error, fallback) {
        if (isCurrent() && !axios.isCancel(error)) showError(error instanceof Error ? error : new Error(String(error)), fallback)
      }
    }
  }
}
