<template>
  <Layout>
    <div class="applications">
      <div class="page-header">
        <h1 class="page-title">{{ $t('common.applications') }}</h1>
        <button type="button" @click="showCreateModal = true" class="create-btn">{{ $t('applications.add') }}</button>
      </div>

      <div v-if="loading" class="loading">{{ $t('applications.loadingApplications') }}</div>

      <div v-else class="applications-grid">
        <div
          v-for="app in visibleApplications"
          :key="app.id"
          class="app-card"
        >
          <div class="app-clickable-area" @click="navigateToDetail(app.id)">
            <div class="app-header">
              <div class="app-icon-container" @click.stop>
                <ApplicationIcon
                  :name="app.name"
                  :image="app.image"
                  :show-upload-overlay="true"
                  :show-delete-button="true"
                  @upload="(file) => uploadIcon(app.id, file)"
                  @delete="() => deleteIcon(app.id)"
                />
              </div>
              <div class="app-title-container">
                <h3>{{ app.name }}</h3>
                <span class="app-priority" :class="`priority-${getPriorityLevel(app.defaultPriority ?? 0)}`">
                  {{ $t('common.priority') }} {{ app.defaultPriority }}
                </span>
              </div>
            </div>



            <div class="app-intro">
              <p class="app-description">{{ app.description || $t('applications.noDescription') }}</p>
            </div>
            <div class="app-info">
              <p class="app-last-ping">{{ $t('applications.lastPing') }}: {{ formatDate(app.lastUsed || '') || $t('common.never') }}</p>
            </div>
          </div>
          <div class="app-actions">
            <button type="button" class="edit-btn" @click="editApplication(app)">
              <Pencil :size="14" aria-hidden="true" />
              <span>{{ $t('common.edit') }}</span>
            </button>
            <button type="button" class="delete-btn" @click="deleteApplication(app.id)">
              <Trash2 :size="14" aria-hidden="true" />
              <span>{{ $t('common.delete') }}</span>
            </button>
            <button
              type="button"
              class="regenerate-btn"
              :disabled="isRegenerating()"
              :title="t('applications.regenerateToken')"
              @click="confirmRegenerateToken(app)"
            >
              <RefreshCw :size="14" aria-hidden="true" />
              <span>{{ $t('applications.regenerateAction') }}</span>
            </button>
          </div>
        </div>


        <div
          v-if="showSentinel"
          ref="sentinelEl"
          class="sentinel-row"
          aria-hidden="true"
        ></div>
        <button
          v-if="showLoadMore"
          type="button"
          class="load-more-btn"
          @click="requestMore"
        >{{ $t('applications.loadMore') }}</button>
      </div>

      <div v-if="!loading && applications.length === 0" class="empty-state">
        {{ $t('applications.noApplications') }}
      </div>

      <RegeneratedTokenModal
        v-if="regeneratedToken"
        :key="regeneratedToken.token"
        :token="regeneratedToken.token"
        @close="regeneratedToken = null"
      />
      <CreateApplicationModal
        v-if="showCreateModal"
        @close="showCreateModal = false"
        @created="reloadApplications"
      />
      <EditApplicationModal
        v-if="showEditModal && editingApplication"
        :application="editingApplication"
        @close="showEditModal = false"
        @updated="reloadApplications"
      />
    </div>
  </Layout>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Pencil, RefreshCw, Trash2 } from '@lucide/vue'
import Layout from '@/components/Layout.vue'
import ApplicationIcon from '@/components/ApplicationIcon.vue'
import CreateApplicationModal from '@/components/CreateApplicationModal.vue'
import RegeneratedTokenModal from '@/components/RegeneratedTokenModal.vue'
import EditApplicationModal from '@/components/EditApplicationModal.vue'
import { applicationApi } from '@/services/api'
import { authService, clientTokenStorageKey, parseAppTokenStorageKey } from '@/services/auth'
import { showError, showSuccess } from '@/utils/errorHandler'
import { resolveAppTokenState, type AppTokenState } from '@/utils/appToken'
import { isAppTokenRequestCurrent, type AppTokenRequestContext } from '@/utils/appTokenRequestGuard'
import { derivePublicForm } from '@/utils/enhancedToken'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { formatDate } from '@/utils/datetime'
import { useElevatedAction, isElevationCancelled, ElevationCancelledError } from '@/composables/useElevatedAction'
import { getPriorityLevel } from '@/utils/priority'
import type { Application } from '@/types'

const { t } = useI18n()
const router = useRouter()
const { confirm: confirmDialog } = useConfirmDialog()
const { withElevation } = useElevatedAction()


const PAGE_SIZE = 10

const MAX_CONCURRENT_DETAILS = 10



const applications = ref<Application[]>([])
const loading = ref(true)
const showCreateModal = ref(false)

const regeneratedToken = ref<{ appId: number; token: string } | null>(null)
const showEditModal = ref(false)
const editingApplication = ref<Application | null>(null)

const visibleCount = ref(0)

const visibleApplications = computed<Application[]>(() =>
  applications.value.slice(0, visibleCount.value)
)

const hasMoreApps = computed(() => visibleApplications.value.length < applications.value.length)

const hasIntersectionObserver = typeof IntersectionObserver !== 'undefined'
const showSentinel = computed(() => hasIntersectionObserver && hasMoreApps.value)
const showLoadMore = computed(() => !hasIntersectionObserver && hasMoreApps.value)



const sentinelEl = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

let sentinelIntersecting = false




const tokenStates = reactive(new Map<number, AppTokenState>())

const resolvedIds = new Set<number>()

const inFlightIds = new Set<number>()

const regeneratingIds = reactive(new Set<number>())


let disposed = false

let pageGeneration = 0

const targetGenerations = new Map<number, number>()

let requestSequence = 0

const appGenerations = new Map<number, number>()

let listRequestSequence = 0

let batchRunning = false
let batchQueued = false

let recheckScheduled = false



const isRegenerating = (): boolean => regeneratingIds.size > 0 || regeneratedToken.value !== null

const navigateToDetail = (appId: number) => {
  router.push(`/applications/${appId}`)
}



const hasUsableSession = (): boolean => authService.getClientCredentialForRevocation() !== null





let contentSessionCredential: string | null = authService.getClientCredentialForRevocation()





const clearAccountContent = (): void => {

  showCreateModal.value = false
  showEditModal.value = false
  editingApplication.value = null
  applications.value = []
  visibleCount.value = 0
  tokenStates.clear()
  resolvedIds.clear()
  sentinelIntersecting = false
}

const scheduleOwnershipRecheck = (): void => {

  tokenStates.clear()
  if (recheckScheduled) return
  recheckScheduled = true
  void Promise.resolve().then(() => {
    recheckScheduled = false
    if (disposed || loading.value) return
    if (!hasUsableSession()) return
    resolvedIds.clear()
    queueDetailBatch()
  })
}








const onSessionChange = (): void => {
  regeneratedToken.value = null
  const current = authService.getClientCredentialForRevocation()
  if (current === null) {
    contentSessionCredential = null
    clearAccountContent()
    return
  }
  if (current !== contentSessionCredential) {
    contentSessionCredential = current
    clearAccountContent()
    void reloadApplications()
    return
  }
  scheduleOwnershipRecheck()
}

const onStorageChange = (event: StorageEvent): void => {


  const key = event.key
  if (key === null || key === clientTokenStorageKey()) {
    onSessionChange()
    return
  }
  const targetId = parseAppTokenStorageKey(key)
  if (targetId === null) return

  if (regeneratedToken.value?.appId === targetId) regeneratedToken.value = null
  if (!isWindowed(targetId)) return
  appGenerations.set(targetId, (appGenerations.get(targetId) ?? 0) + 1)
  tokenStates.delete(targetId)
  resolvedIds.delete(targetId)
  if (hasUsableSession()) queueDetailBatch()
}

const unsubscribeSessionChanges = authService.subscribeSessionChanges(onSessionChange)



const loadApplications = async (): Promise<void> => {
  const seq = ++listRequestSequence
  const capturedGeneration = pageGeneration
  const capturedSession = authService.getSessionRevision()
  const capturedClientToken = authService.getClientCredentialForRevocation()


  let committed = false


  let orphaned = false
  try {
    const res = await applicationApi.getApplications()
    const sessionChanged =
      authService.getSessionRevision() !== capturedSession ||
      authService.getClientCredentialForRevocation() !== capturedClientToken
    if (disposed || seq !== listRequestSequence || capturedGeneration !== pageGeneration || sessionChanged) {


      if (!disposed && seq === listRequestSequence) {
        orphaned = true
      }
      return
    }
    applications.value = res.data || []
    visibleCount.value = Math.min(PAGE_SIZE, applications.value.length)

    contentSessionCredential = capturedClientToken
    committed = true
  } catch (err) {
    console.error('Failed to load applications:', err)
    if (disposed || seq !== listRequestSequence || capturedGeneration !== pageGeneration) return
    const sessionChanged =
      authService.getSessionRevision() !== capturedSession ||
      authService.getClientCredentialForRevocation() !== capturedClientToken
    if (sessionChanged) orphaned = true

    applications.value = []
    tokenStates.clear()
    resolvedIds.clear()
    visibleCount.value = 0
  } finally {
    if (seq === listRequestSequence && !disposed) {
      loading.value = false
      if (orphaned && hasUsableSession()) {


        resolvedIds.clear()
        tokenStates.clear()
        sentinelIntersecting = false
        loading.value = true
        void loadApplications()
      } else if (committed && capturedGeneration === pageGeneration) {
        queueDetailBatch()
      }
    }
  }
}






const reloadApplications = async (): Promise<void> => {
  pageGeneration += 1
  resolvedIds.clear()
  tokenStates.clear()
  sentinelIntersecting = false
  loading.value = true
  await loadApplications()
}



const growWindow = (): void => {
  visibleCount.value = Math.min(visibleCount.value + PAGE_SIZE, applications.value.length)
}

const collectWindowTargets = (): number[] => {
  const targets: number[] = []

  const revealId = regeneratedToken.value?.appId
  if (revealId !== undefined && !resolvedIds.has(revealId) && !inFlightIds.has(revealId)) {
    targets.push(revealId)
  }
  for (const app of visibleApplications.value) {
    if (targets.length >= MAX_CONCURRENT_DETAILS) break
    if (resolvedIds.has(app.id) || inFlightIds.has(app.id) || targets.includes(app.id)) continue
    targets.push(app.id)
  }
  return targets
}

const isWindowed = (appId: number): boolean =>
  visibleApplications.value.some((app) => app.id === appId)

const queueDetailBatch = (): void => {
  batchQueued = true
  void runDetailBatches()
}

const runDetailBatches = async (): Promise<void> => {
  if (batchRunning) return
  batchRunning = true
  try {
    while (!disposed && !loading.value && (batchQueued || collectWindowTargets().length > 0)) {
      batchQueued = false
      const targets = collectWindowTargets()
      if (targets.length === 0) {

        if (sentinelIntersecting && hasMoreApps.value) {
          growWindow()
          batchQueued = true
          continue
        }
        break
      }

      await Promise.allSettled(targets.map((id) => fetchApplicationDetail(id)))
      await nextTick()
      if (!disposed && !loading.value && sentinelIntersecting && hasMoreApps.value) {

        growWindow()
        batchQueued = true
      }
    }
  } finally {
    batchRunning = false
  }
}


const requestMore = async (): Promise<void> => {
  if (disposed || loading.value || batchRunning) return
  if (!hasMoreApps.value) return
  growWindow()
  queueDetailBatch()
}




const currentContextOf = (captured: AppTokenRequestContext): AppTokenRequestContext => ({
  appId: captured.appId,
  pageGeneration,
  appGeneration: appGenerations.get(captured.appId) ?? 0,
  requestSequence: captured.requestSequence,
  sessionRevision: authService.getSessionRevision(),
  clientToken: authService.getClientCredentialForRevocation(),
  storedValue: authService.getAppTokenStorageSnapshot(captured.appId),
  disposed
})

const fetchApplicationDetail = async (appId: number): Promise<void> => {
  inFlightIds.add(appId)
  try {

    const capturedReveal = regeneratedToken.value?.appId === appId ? regeneratedToken.value : null
    const capturedStoredToken = authService.getAppToken(appId)?.token ?? null
    const capturedLocalToken = capturedReveal?.token ?? capturedStoredToken
    const captured: AppTokenRequestContext = {
      appId,
      pageGeneration,
      appGeneration: appGenerations.get(appId) ?? 0,
      requestSequence: ++requestSequence,
      sessionRevision: authService.getSessionRevision(),
      clientToken: authService.getClientCredentialForRevocation(),
      storedValue: authService.getAppTokenStorageSnapshot(appId),
      disposed: false
    }
    let serverToken: unknown
    let failed = false
    let failureStatusCode: number | undefined
    try {
      const res = await applicationApi.getApplication(appId)
      serverToken = res.data?.token
    } catch (err) {
      console.error(`Failed to load application ${appId}:`, err)
      failed = true
      failureStatusCode = (err as { statusCode?: number })?.statusCode
    }
    const current = currentContextOf(captured)

    if (failureStatusCode === 404 && !disposed && captured.pageGeneration === current.pageGeneration &&
        captured.sessionRevision === current.sessionRevision && captured.clientToken === current.clientToken) {
      targetGenerations.set(appId, (targetGenerations.get(appId) ?? 0) + 1)
      if (regeneratedToken.value?.appId === appId) regeneratedToken.value = null
      tokenStates.set(appId, { kind: 'unknown' })
      authService.removeAppTokenIfUnchanged(appId, captured.storedValue)
      resolvedIds.add(appId)
      return
    }
    if (!isAppTokenRequestCurrent(captured, current)) {


      if (!disposed && !loading.value && (isWindowed(appId) || regeneratedToken.value?.appId === appId)) {
        queueDetailBatch()
      }
      return
    }
    if (failed) {

      if (capturedReveal && regeneratedToken.value === capturedReveal) {
        resolvedIds.add(appId)
        return
      }


      tokenStates.set(appId, { kind: 'unknown' })
      resolvedIds.add(appId)
      return
    }
    const state = resolveAppTokenState(serverToken, capturedLocalToken)
    if (state.kind === 'invalid' && resolveAppTokenState(serverToken, capturedStoredToken).kind === 'invalid') {

      authService.removeAppTokenIfUnchanged(appId, captured.storedValue)
    }
    if (capturedReveal) {


      if (regeneratedToken.value === capturedReveal && state.kind === 'invalid') regeneratedToken.value = null
    } else {
      tokenStates.set(appId, state)
    }
    resolvedIds.add(appId)
  } finally {
    inFlightIds.delete(appId)
  }
}



const handleIntersect = (entries: IntersectionObserverEntry[]): void => {
  for (const entry of entries) {
    sentinelIntersecting = entry.isIntersecting
    if (entry.isIntersecting) void requestMore()
  }
}

watch(
  sentinelEl,
  (el, prev) => {
    if (prev && observer) observer.unobserve(prev)
    sentinelIntersecting = false
    if (el && hasIntersectionObserver) {
      if (!observer) {
        observer = new IntersectionObserver(handleIntersect)
      }
      observer.observe(el)
    }
  },
  { flush: 'post' }
)




interface RotationOwnership {
  appId: number
  targetGeneration: number
  sessionRevision: number
  clientToken: string | null
}

const isRotationOwnershipCurrent = (ownership: RotationOwnership): boolean =>
  !disposed &&
  ownership.sessionRevision === authService.getSessionRevision() &&
  ownership.clientToken === authService.getClientCredentialForRevocation() &&
  ownership.targetGeneration === (targetGenerations.get(ownership.appId) ?? 0)

const confirmRegenerateToken = async (app: Application): Promise<void> => {
  const ownership: RotationOwnership = {
    appId: app.id,
    targetGeneration: targetGenerations.get(app.id) ?? 0,
    sessionRevision: authService.getSessionRevision(),
    clientToken: authService.getClientCredentialForRevocation()
  }

  if (isRegenerating()) return
  regeneratingIds.add(ownership.appId)
  try {
    const confirmed = await confirmDialog({
      title: t('common.confirmDialog.title'),
      message: t('applicationDetail.regenerateWarning'),
      confirmText: t('common.confirmDialog.confirmButton'),
      cancelText: t('common.confirmDialog.cancelButton'),
      type: 'warning'
    })
    if (!confirmed) return

    if (!isRotationOwnershipCurrent(ownership)) return


    appGenerations.set(ownership.appId, (appGenerations.get(ownership.appId) ?? 0) + 1)
    tokenStates.set(ownership.appId, { kind: 'unknown' })

    let newToken: unknown

    let dispatchedStoredValue: string | null = null
    try {

      const res = await withElevation(() => {

        if (!isRotationOwnershipCurrent(ownership)) {
          throw new ElevationCancelledError()
        }
        dispatchedStoredValue = authService.getAppTokenStorageSnapshot(ownership.appId)
        return applicationApi.regenerateToken(ownership.appId)
      }, () => isRotationOwnershipCurrent(ownership))
      newToken = res.data?.regenerateToken?.token
    } catch (err) {
      if (isElevationCancelled(err)) return
      if (!isRotationOwnershipCurrent(ownership)) return
      showError(err as Error, t('applications.regenerateFailed'))

      resolvedIds.delete(ownership.appId)
      queueDetailBatch()
      return
    }


    if (!isRotationOwnershipCurrent(ownership)) return


    if (typeof newToken !== 'string' || derivePublicForm(newToken) === null) {
      showError(new Error('invalid regenerate token response'), t('applications.regenerateFailed'))
      return
    }



    const validationStoredValue = authService.getAppTokenStorageSnapshot(ownership.appId)
    if (validationStoredValue !== dispatchedStoredValue) {
      let matchesCurrentToken = false
      try {
        const current = await applicationApi.getApplication(ownership.appId)
        matchesCurrentToken = current.data?.token === derivePublicForm(newToken)
      } catch {

      }
      if (!isRotationOwnershipCurrent(ownership)) return
      if (!matchesCurrentToken || validationStoredValue !== authService.getAppTokenStorageSnapshot(ownership.appId)) {
        tokenStates.delete(ownership.appId)
        resolvedIds.delete(ownership.appId)
        queueDetailBatch()
        return
      }
    }


    appGenerations.set(ownership.appId, (appGenerations.get(ownership.appId) ?? 0) + 1)

    let stored = true
    try {
      authService.setAppToken(ownership.appId, newToken)
    } catch (err) {
      console.error('Failed to persist regenerated app token:', err)
      stored = false
    }

    tokenStates.delete(ownership.appId)
    regeneratedToken.value = { appId: ownership.appId, token: newToken }
    resolvedIds.add(ownership.appId)
    if (stored) {
      showSuccess(t('applications.regenerated'))
    } else {
      showError(new Error('app token storage failed'), t('applications.tokenStorageError'))
    }
  } finally {
    regeneratingIds.delete(ownership.appId)
  }
}



const editApplication = (app: Application) => {
  editingApplication.value = app
  showEditModal.value = true
}

const deleteApplication = async (id: number): Promise<void> => {
  const capturedSession = authService.getSessionRevision()
  const capturedClientToken = authService.getClientCredentialForRevocation()
  const confirmed = await confirmDialog({
    title: t('common.confirmDialog.title'),
    message: t('applications.deleteConfirm'),
    confirmText: t('common.confirmDialog.confirmButton'),
    cancelText: t('common.confirmDialog.cancelButton'),
    type: 'danger'
  })
  if (!confirmed) return
  if (disposed || capturedSession !== authService.getSessionRevision() || capturedClientToken !== authService.getClientCredentialForRevocation()) return
  try {

    await withElevation(() => {
      if (disposed || capturedSession !== authService.getSessionRevision() || capturedClientToken !== authService.getClientCredentialForRevocation()) {
        throw new ElevationCancelledError()
      }
      return applicationApi.deleteApplication(id)
    }, () => !disposed && capturedSession === authService.getSessionRevision() && capturedClientToken === authService.getClientCredentialForRevocation())
    if (disposed || capturedSession !== authService.getSessionRevision() || capturedClientToken !== authService.getClientCredentialForRevocation()) return
    targetGenerations.set(id, (targetGenerations.get(id) ?? 0) + 1)
    if (regeneratedToken.value?.appId === id) regeneratedToken.value = null
    authService.removeAppToken(id)
    showSuccess(t('applications.deleteSuccess'))
    await reloadApplications()
  } catch (err) {
    if (isElevationCancelled(err)) return
    if (disposed || capturedSession !== authService.getSessionRevision() || capturedClientToken !== authService.getClientCredentialForRevocation()) return
    showError(err as Error, t('applications.deleteError'))
  }
}

const uploadIcon = async (appId: number, file: File): Promise<void> => {
  const capturedGeneration = pageGeneration
  const capturedSession = authService.getSessionRevision()
  const capturedClientToken = authService.getClientCredentialForRevocation()
  try {
    await applicationApi.uploadApplicationImage(appId, file)
    if (disposed || capturedGeneration !== pageGeneration || capturedSession !== authService.getSessionRevision() || capturedClientToken !== authService.getClientCredentialForRevocation()) return
    showSuccess(t('applications.iconUploaded'))
    await reloadApplications()
  } catch (err) {
    if (disposed || capturedGeneration !== pageGeneration || capturedSession !== authService.getSessionRevision() || capturedClientToken !== authService.getClientCredentialForRevocation()) return
    showError(err as Error, t('applications.uploadIconError'))
  }
}

const deleteIcon = async (appId: number): Promise<void> => {
  const capturedGeneration = pageGeneration
  const capturedSession = authService.getSessionRevision()
  const capturedClientToken = authService.getClientCredentialForRevocation()
  try {
    await applicationApi.deleteApplicationImage(appId)
    if (disposed || capturedGeneration !== pageGeneration || capturedSession !== authService.getSessionRevision() || capturedClientToken !== authService.getClientCredentialForRevocation()) return
    showSuccess(t('applications.iconDeleted'))
    await reloadApplications()
  } catch (err) {
    if (disposed || capturedGeneration !== pageGeneration || capturedSession !== authService.getSessionRevision() || capturedClientToken !== authService.getClientCredentialForRevocation()) return
    showError(err as Error, t('applications.deleteIconError'))
  }
}

onMounted(() => {
  window.addEventListener('storage', onStorageChange)
  void loadApplications()
})

onBeforeUnmount(() => {
  disposed = true
  regeneratedToken.value = null
  tokenStates.clear()
  unsubscribeSessionChanges()
  window.removeEventListener('storage', onStorageChange)
  observer?.disconnect()
  observer = null
})
</script>

<style scoped>
.applications {

}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
}

.page-title {
  font-size: 2rem;
  font-weight: bold;
  color: var(--color-text-primary);
  margin: 0;
}

.create-btn {
  padding: 0.5rem 1rem;
  background-color: var(--color-success);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  transition: var(--theme-transition);
}

.create-btn:hover {
  background-color: var(--color-success-hover);
}

.loading, .empty-state {
  text-align: center;
  color: var(--color-text-tertiary);
  padding: 3rem;
  font-size: 1rem;
}

.applications-grid {
  display: grid;


  grid-template-columns: repeat(auto-fit, minmax(360px, 380px));
  justify-content: center;
  gap: 1.5rem;
}


.sentinel-row {
  grid-column: 1 / -1;
  min-height: 1px;
}

.load-more-btn {
  grid-column: 1 / -1;
  justify-self: center;
  padding: 0.5rem 1.25rem;
  background-color: var(--color-bg-hover);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-primary);
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: var(--theme-transition);
}

.load-more-btn:hover {
  background-color: var(--color-primary);
  color: var(--color-text-inverse);
}

.app-card {
  background: var(--color-bg-primary);
  padding: 1.5rem;
  border-radius: 0.75rem;
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  gap: 1rem;
  transition: var(--theme-transition);
}

.app-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.app-clickable-area {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  cursor: pointer;
  flex: 1;
}

.app-header {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.app-icon-container {
  flex-shrink: 0;
}

.app-title-container {
  flex: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.app-title-container h3 {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.app-priority {
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
}

.priority-0 { background: var(--color-info-bg); color: var(--color-info); }
.priority-1 { background: var(--color-bg-hover); color: var(--color-text-secondary); }
.priority-2 { background: #fef3c7; color: #92400e; }
.priority-3 { background: #fecaca; color: #991b1b; }


.app-intro {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.app-description {
  color: var(--color-text-secondary);
  font-size: 0.875rem;
  line-height: 1.5;
  margin: 0;
}

.app-info {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.regenerate-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  align-self: flex-start;
  padding: 0.375rem 0.75rem;
  background-color: var(--color-warning);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: var(--theme-transition);
}

.regenerate-btn:hover:not(:disabled) {
  background-color: var(--color-warning-hover);
}

.regenerate-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.app-last-ping {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  margin: 0;
}

.app-actions {
  display: flex;
  gap: 0.375rem;
  flex-wrap: nowrap;
}


.app-actions button {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  min-width: 0;
  padding: 0.375rem 0.5rem;
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: var(--theme-transition);
}

.app-actions button span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.edit-btn {
  background-color: var(--color-primary);
}

.edit-btn:hover {
  background-color: var(--color-primary-hover);
}

.delete-btn {
  background-color: var(--color-error);
}

.delete-btn:hover {
  background-color: var(--color-error-hover);
}


.regenerate-btn:focus-visible,
.load-more-btn:focus-visible,
.app-actions button:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
  }

  .applications-grid {
    grid-template-columns: 1fr;
  }

  .app-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .app-actions {
    justify-content: stretch;
  }

  .app-actions button {
    flex: 1;
  }
}
</style>
