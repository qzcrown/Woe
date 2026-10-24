<template>
  <Layout>
    <div class="application-detail">
      <div v-if="loading" class="loading-container">
        <LoadingSpinner :text="t('applicationDetail.loading')" />
      </div>

      <div v-else-if="error" class="error-container">
        <div class="error-message">
          <h3>{{ t('applicationDetail.errorTitle') }}</h3>
          <p>{{ error }}</p>
          <button @click="loadApplication(appId)" class="retry-btn">{{ t('applicationDetail.retry') }}</button>
        </div>
      </div>

      <div v-else-if="application" class="application-content">
        <div class="application-header">
          <div class="app-icon-large">
            <ApplicationIcon
              :name="application.name"
              :image="application.image"
              size="large"
              :show-upload-overlay="true"
              :show-delete-button="true"
              @upload="uploadIcon"
              @delete="deleteIcon"
            />
          </div>

          <div class="app-info">
            <h1 class="app-name">{{ application.name }}</h1>


            <div class="app-intro">
              <p class="app-description">{{ application.description || t('applicationDetail.noDescription') }}</p>
            </div>

            <div class="app-meta">
              <div class="meta-item">
                <span class="meta-label">{{ t('applicationDetail.appId') }}</span>
                <span class="meta-value">{{ application.id }}</span>
              </div>

              <div class="meta-item">
                <span class="meta-label">{{ t('applicationDetail.defaultPriority') }}</span>
                <span class="meta-value priority-badge" :class="`priority-${getPriorityLevel(application.defaultPriority ?? 0)}`">
                  {{ getPriorityLabel(application.defaultPriority ?? 0) }}
                </span>
              </div>

              <div class="meta-item">
                <span class="meta-label">{{ t('applicationDetail.lastUsed') }}</span>
                <span class="meta-value">{{ formatDate(application.lastUsed || '') || t('common.never') }}</span>
              </div>

              <div class="meta-item">
                <span class="meta-label">{{ t('applicationDetail.internal') }}</span>
                <span class="meta-value">{{ application.internal ? t('common.yes') : t('common.no') }}</span>
              </div>
            </div>

            <div class="app-actions">
              <button @click="showEditModal = true" class="edit-btn">
                <Pencil :size="14" aria-hidden="true" />
                <span>{{ t('applicationDetail.editApplication') }}</span>
              </button>
              <button @click="confirmDelete" class="delete-btn">
                <Trash2 :size="14" aria-hidden="true" />
                <span>{{ t('applicationDetail.deleteApplication') }}</span>
              </button>
              <button
                type="button"
                class="regenerate-btn"
                :disabled="isRegenerating"
                @click="confirmRegenerateToken"
              >
                <RefreshCw :size="14" aria-hidden="true" />
                <span>{{ t('applicationDetail.regenerateToken') }}</span>
              </button>
            </div>
          </div>
        </div>

        <div class="application-sections">


          <div v-if="hasDisplayableToken" class="section">
            <h2 class="section-title">{{ t('applicationDetail.tokenTitle') }}</h2>
            <div class="token-container">
              <div class="token-display">
                <code :class="{ 'token-hidden': !tokenVisible }">{{ displayToken }}</code>
                <button
                  type="button"
                  class="token-toggle-btn"
                  :title="tokenVisible ? t('applicationDetail.hideToken') : t('applicationDetail.showToken')"
                  :aria-label="tokenVisible ? t('applicationDetail.hideToken') : t('applicationDetail.showToken')"
                  @click="toggleTokenVisibility"
                >
                  <EyeOff v-if="tokenVisible" :size="18" aria-hidden="true" />
                  <Eye v-else :size="18" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class="token-copy-btn"
                  :title="t('applications.copyToken')"
                  :aria-label="t('applications.copyToken')"
                  @click="copyToken"
                >
                  <Check v-if="copied" :size="16" aria-hidden="true" />
                  <Copy v-else :size="16" aria-hidden="true" />
                </button>
              </div>
            </div>
            <p class="token-description">
              {{ t('applicationDetail.tokenDescription') }}
            </p>
          </div>


          <div class="section">
            <div class="section-header">
              <h2 class="section-title">{{ t('applicationDetail.recentMessages') }}</h2>
              <router-link :to="`/messages?appId=${application.id}`" class="view-all-btn">
                {{ t('applicationDetail.viewAllMessages') }}
              </router-link>
            </div>

            <div v-if="messagesLoading" class="loading-container">
              <LoadingSpinner :text="t('applicationDetail.loadingMessages')" />
            </div>

            <div v-else-if="messages.length === 0" class="empty-messages">
              <EmptyState
                type="messages"
                :title="t('applicationDetail.noMessagesTitle')"
                :description="t('applicationDetail.noMessagesDescription')"
                size="small"
              />
            </div>

            <div v-else class="messages-list">
              <div v-for="message in messages" :key="message.id" class="message-item">
                <div class="message-header">
                  <h4 class="message-title">{{ message.title || t('applicationDetail.noTitle') }}</h4>
                  <span class="message-time" :title="formatDateTime(message.date)">{{ formatRelativeTime(message.date) }}</span>
                </div>
                <p class="message-content">{{ message.message }}</p>
                <div class="message-priority" :class="`priority-${getPriorityLevel(message.priority ?? 1)}`">
                  {{ getPriorityLabel(message.priority) }}
                </div>
              </div>

              <div v-if="hasMoreMessages" class="load-more-container">
                <button
                  @click="loadMoreMessages"
                  :disabled="loadingMoreMessages"
                  class="load-more-btn"
                >
                  <LoadingSpinner v-if="loadingMoreMessages" size="small" variant="dots" />
                  <span v-else>{{ t('applicationDetail.loadMore') }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>


      <EditApplicationModal
        v-if="showEditModal && application"
        :application="application"
        @close="showEditModal = false"
        @updated="handleApplicationUpdated"
      />
    </div>
  </Layout>
</template>

<script setup lang="ts">
import { getPriorityLevel } from '@/utils/priority'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Check, Copy, Eye, EyeOff, Pencil, RefreshCw, Trash2 } from '@lucide/vue'
import Layout from '@/components/Layout.vue'
import ApplicationIcon from '@/components/ApplicationIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import LoadingSpinner from '@/components/LoadingSpinner.vue'
import EditApplicationModal from '@/components/EditApplicationModal.vue'
import { applicationApi } from '@/services/api'
import { authService, clientTokenStorageKey, parseAppTokenStorageKey } from '@/services/auth'
import { showSuccess, showError } from '@/utils/errorHandler'
import { formatRelativeTime, formatDateTime, formatDate } from '@/utils/datetime'
import { resolveAppTokenState, type AppTokenState } from '@/utils/appToken'
import { isAppTokenRequestCurrent, type AppTokenRequestContext } from '@/utils/appTokenRequestGuard'
import { derivePublicForm } from '@/utils/enhancedToken'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useElevatedAction, isElevationCancelled, ElevationCancelledError } from '@/composables/useElevatedAction'
import type { Application, Message, Paging } from '@/types'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { confirm: confirmDialog } = useConfirmDialog()
const { withElevation } = useElevatedAction()


const COPY_FEEDBACK_MS = 1500

const TOKEN_MASK = '••••••••'

const application = ref<Application | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const showEditModal = ref(false)




const tokenState = ref<AppTokenState>({ kind: 'unknown' })
const tokenVisible = ref(false)


const messages = ref<Message[]>([])
const messagesLoading = ref(false)
const loadingMoreMessages = ref(false)
const hasMoreMessages = ref(false)
const messagePaging = ref<Paging>({
  size: 0,
  since: 0,
  limit: 20
})

const appId = computed(() => {
  return Number(route.params.id)
})

const hasDisplayableToken = computed(() =>
  tokenState.value.kind === 'legacy' || tokenState.value.kind === 'valid'
)

const displayToken = computed(() => {
  const state = tokenState.value
  if ((state.kind !== 'legacy' && state.kind !== 'valid') || !tokenVisible.value) {
    return TOKEN_MASK
  }
  return state.token
})




let disposed = false

let pageGeneration = 0

let loadSequence = 0

let requestSequence = 0

let latestTokenRequestSequence = 0

const appGenerations = new Map<number, number>()

let messagesRequestSequence = 0

let recheckScheduled = false


let silentReloadPending = false

const regeneratingAppId = ref<number | null>(null)


let copySequence = 0
let copyTimer: ReturnType<typeof setTimeout> | null = null
const copied = ref(false)

const isRegenerating = computed(() => regeneratingAppId.value === appId.value)








const getPriorityLabel = (priority?: number) => {
  if (priority === undefined || priority === null) return t('common.priorityNormal')
  const labels = [t('common.priorityLow'), t('common.priorityNormal'), t('common.priorityHigh'), t('common.priorityEmergency')]
  return labels[getPriorityLevel(priority ?? 1)] || t('common.priorityNormal')
}



const clearCopyFeedback = (): void => {


  copySequence += 1
  if (copyTimer) {
    clearTimeout(copyTimer)
    copyTimer = null
  }
  copied.value = false
}






const copyToken = async (): Promise<void> => {
  const state = tokenState.value
  if (state.kind !== 'legacy' && state.kind !== 'valid') return
  const token = state.token
  const seq = ++copySequence
  try {
    await navigator.clipboard.writeText(token)
  } catch (err) {
    if (disposed || copySequence !== seq) return
    showError(err as Error, t('applications.copyTokenError'))
    return
  }
  if (disposed || copySequence !== seq) return
  if (copyTimer) clearTimeout(copyTimer)
  copied.value = true
  copyTimer = setTimeout(() => {
    copyTimer = null
    copied.value = false
  }, COPY_FEEDBACK_MS)
}

const toggleTokenVisibility = () => {
  tokenVisible.value = !tokenVisible.value
}



const hasUsableSession = (): boolean => authService.getClientCredentialForRevocation() !== null





let contentSessionCredential: string | null = authService.getClientCredentialForRevocation()






const clearAccountContent = (): void => {
  latestTokenRequestSequence = ++requestSequence
  loadSequence += 1
  loading.value = false
  application.value = null
  error.value = null
  showEditModal.value = false
  tokenState.value = { kind: 'unknown' }
  tokenVisible.value = false
  clearCopyFeedback()
  messages.value = []
  hasMoreMessages.value = false
  messagesLoading.value = false
  loadingMoreMessages.value = false
}


const currentContextOf = (captured: AppTokenRequestContext): AppTokenRequestContext => ({
  appId: captured.appId,
  pageGeneration,
  appGeneration: appGenerations.get(captured.appId) ?? 0,
  requestSequence: latestTokenRequestSequence,
  sessionRevision: authService.getSessionRevision(),
  clientToken: authService.getClientCredentialForRevocation(),
  storedValue: authService.getAppTokenStorageSnapshot(captured.appId),
  disposed
})





const reverifyToken = async (targetId: number): Promise<void> => {

  const capturedLocalToken = authService.getAppToken(targetId)?.token ?? null
  const captured: AppTokenRequestContext = {
    appId: targetId,
    pageGeneration,
    appGeneration: appGenerations.get(targetId) ?? 0,
    requestSequence: ++requestSequence,
    sessionRevision: authService.getSessionRevision(),
    clientToken: authService.getClientCredentialForRevocation(),
    storedValue: authService.getAppTokenStorageSnapshot(targetId),
    disposed: false
  }
  latestTokenRequestSequence = captured.requestSequence
  let serverToken: unknown
  let failed = false
  try {
    const res = await applicationApi.getApplication(targetId)
    serverToken = res.data?.token
  } catch (err) {
    console.error(`Failed to verify application ${targetId} token:`, err)
    failed = true
  }
  if (disposed || !isAppTokenRequestCurrent(captured, currentContextOf(captured))) return
  if (failed) {

    tokenState.value = { kind: 'unknown' }
    return
  }
  const state = resolveAppTokenState(serverToken, capturedLocalToken)
  if (state.kind === 'invalid') {

    authService.removeAppTokenIfUnchanged(targetId, captured.storedValue)
  }
  tokenState.value = state
}

const scheduleOwnershipRecheck = (): void => {

  latestTokenRequestSequence = ++requestSequence

  tokenState.value = { kind: 'unknown' }
  tokenVisible.value = false
  clearCopyFeedback()
  if (recheckScheduled) return
  recheckScheduled = true
  void Promise.resolve().then(() => {
    recheckScheduled = false
    if (disposed || loading.value) return
    if (!hasUsableSession()) return
    void reverifyToken(appId.value)
  })
}









const onSessionChange = (): void => {
  const current = authService.getClientCredentialForRevocation()
  if (current === null) {
    silentReloadPending = false
    contentSessionCredential = null
    clearAccountContent()
    return
  }
  if (current !== contentSessionCredential) {
    silentReloadPending = false
    contentSessionCredential = current
    clearAccountContent()
    if (Number.isSafeInteger(appId.value) && appId.value > 0) {
      void reloadApplication()
    }
    return
  }

  silentReloadPending = true
  scheduleOwnershipRecheck()
}

const onStorageChange = (event: StorageEvent): void => {


  const key = event.key
  if (key === null || key === clientTokenStorageKey()) {
    onSessionChange()
    return
  }
  const parsedAppId = parseAppTokenStorageKey(key)
  if (parsedAppId !== null && parsedAppId === appId.value) {

    silentReloadPending = true
    scheduleOwnershipRecheck()
  }
}

const unsubscribeSessionChanges = authService.subscribeSessionChanges(onSessionChange)








const loadApplication = async (targetId: number): Promise<void> => {
  const loadSeq = ++loadSequence
  silentReloadPending = false
  const capturedLocalToken = authService.getAppToken(targetId)?.token ?? null
  const captured: AppTokenRequestContext = {
    appId: targetId,
    pageGeneration,
    appGeneration: appGenerations.get(targetId) ?? 0,
    requestSequence: ++requestSequence,
    sessionRevision: authService.getSessionRevision(),
    clientToken: authService.getClientCredentialForRevocation(),
    storedValue: authService.getAppTokenStorageSnapshot(targetId),
    disposed: false
  }
  latestTokenRequestSequence = captured.requestSequence
  loading.value = true
  error.value = null

  tokenState.value = { kind: 'unknown' }
  tokenVisible.value = false
  clearCopyFeedback()
  messages.value = []
  hasMoreMessages.value = false
  messagesLoading.value = false
  loadingMoreMessages.value = false

  let serverToken: unknown
  let appData: Application | null = null
  let failed = false
  let failure: unknown = null
  try {
    const res = await applicationApi.getApplication(targetId)
    appData = res.data
    serverToken = res.data?.token
  } catch (err) {
    failed = true
    failure = err
  }


  if (disposed) return
  if (!isAppTokenRequestCurrent(captured, currentContextOf(captured))) {



    if (loadSeq === loadSequence) {
      loading.value = false
      if (silentReloadPending) {


        void reloadApplication()
      } else {
        error.value = t('applicationDetail.loadError')
        scheduleOwnershipRecheck()
      }
      silentReloadPending = false
    }
    return
  }
  loading.value = false

  contentSessionCredential = captured.clientToken

  if (failed) {

    tokenState.value = { kind: 'unknown' }
    error.value = (failure as { errorDescription?: string })?.errorDescription || t('applicationDetail.loadError')
    showError(failure as Error, t('applicationDetail.loadError'))
    return
  }

  application.value = appData
  const state = resolveAppTokenState(serverToken, capturedLocalToken)
  if (state.kind === 'invalid') {

    authService.removeAppTokenIfUnchanged(targetId, captured.storedValue)
  }
  tokenState.value = state

  loadMessages(targetId)
}





let metadataSequence = 0
const reloadApplication = async (): Promise<void> => {
  const targetId = appId.value
  if (application.value?.id !== targetId) {
    pageGeneration += 1
    await loadApplication(targetId)
    return
  }
  const seq = ++metadataSequence
  const capturedStoredToken = authService.getAppToken(targetId)?.token ?? null
  const capturedLocalToken = tokenState.value.kind === 'valid' || tokenState.value.kind === 'legacy'
    ? tokenState.value.token
    : capturedStoredToken
  const captured: AppTokenRequestContext = {
    appId: targetId,
    pageGeneration,
    appGeneration: appGenerations.get(targetId) ?? 0,
    requestSequence: ++requestSequence,
    sessionRevision: authService.getSessionRevision(),
    clientToken: authService.getClientCredentialForRevocation(),
    storedValue: authService.getAppTokenStorageSnapshot(targetId),
    disposed: false
  }
  latestTokenRequestSequence = captured.requestSequence
  const isMetadataCurrent = (): boolean => !disposed && seq === metadataSequence &&
    captured.pageGeneration === pageGeneration && targetId === appId.value &&
    captured.sessionRevision === authService.getSessionRevision() &&
    captured.clientToken === authService.getClientCredentialForRevocation()
  try {
    const res = await applicationApi.getApplication(targetId)
    if (!isMetadataCurrent()) return
    application.value = res.data

    const current = currentContextOf(captured)
    if (!isAppTokenRequestCurrent(captured, current)) {

      if (captured.appGeneration === current.appGeneration &&
          captured.requestSequence === current.requestSequence && captured.storedValue !== current.storedValue) {
        scheduleOwnershipRecheck()
      }
      return
    }

    if (regeneratingAppId.value === targetId) return
    let state = resolveAppTokenState(res.data?.token, capturedLocalToken)
    if (state.kind === 'invalid') {

      state = resolveAppTokenState(res.data?.token, capturedStoredToken)
      if (state.kind === 'invalid') authService.removeAppTokenIfUnchanged(targetId, captured.storedValue)
    }
    tokenState.value = state
    if ((state.kind !== 'valid' && state.kind !== 'legacy') || state.token !== capturedLocalToken) {
      tokenVisible.value = false
      clearCopyFeedback()
    }
  } catch (err) {
    if (!isMetadataCurrent()) return
    if ((err as { statusCode?: number })?.statusCode === 404) {

      pageGeneration += 1
      clearAccountContent()
      error.value = t('applicationDetail.loadError')
    }

    showError(err as Error, t('applicationDetail.loadError'))
  }
}



const isMessagesOwnershipCurrent = (seq: number, capturedGeneration: number, capturedSession: number, capturedClientToken: string | null): boolean =>
  !disposed &&
  seq === messagesRequestSequence &&
  capturedGeneration === pageGeneration &&
  capturedSession === authService.getSessionRevision() &&
  capturedClientToken === authService.getClientCredentialForRevocation()




const loadMessages = async (targetId: number): Promise<void> => {
  const seq = ++messagesRequestSequence
  const capturedGeneration = pageGeneration
  const capturedSession = authService.getSessionRevision()
  const capturedClientToken = authService.getClientCredentialForRevocation()
  messagesLoading.value = true

  try {
    const response = await applicationApi.getApplicationMessages(targetId, { limit: 20 })
    if (!isMessagesOwnershipCurrent(seq, capturedGeneration, capturedSession, capturedClientToken)) return


    messages.value = response.data.messages
    messagePaging.value = response.data.paging
    hasMoreMessages.value = !!response.data.paging.next
  } catch (err: any) {
    if (!isMessagesOwnershipCurrent(seq, capturedGeneration, capturedSession, capturedClientToken)) return
    showError(err, t('applicationDetail.loadMessagesError'))
  } finally {

    if (!disposed && seq === messagesRequestSequence && capturedGeneration === pageGeneration) {
      messagesLoading.value = false
    }
  }
}




const loadMoreMessages = async (): Promise<void> => {
  if (!hasMoreMessages.value || loadingMoreMessages.value) return

  const targetId = appId.value
  const seq = ++messagesRequestSequence
  const capturedGeneration = pageGeneration
  const capturedSession = authService.getSessionRevision()
  const capturedClientToken = authService.getClientCredentialForRevocation()
  loadingMoreMessages.value = true

  try {
    const params = {
      limit: messagePaging.value.limit,
      since: messagePaging.value.since
    }
    const response = await applicationApi.getApplicationMessages(targetId, params)
    if (!isMessagesOwnershipCurrent(seq, capturedGeneration, capturedSession, capturedClientToken)) return


    const olderMessages = response.data.messages
    messages.value = [...messages.value, ...olderMessages]

    messagePaging.value = response.data.paging
    hasMoreMessages.value = !!response.data.paging.next
  } catch (err: any) {
    if (!isMessagesOwnershipCurrent(seq, capturedGeneration, capturedSession, capturedClientToken)) return
    showError(err, t('applicationDetail.loadMoreMessagesError'))
  } finally {
    if (!disposed && seq === messagesRequestSequence && capturedGeneration === pageGeneration) {
      loadingMoreMessages.value = false
    }
  }
}




interface RotationOwnership {
  appId: number
  pageGeneration: number
  sessionRevision: number
  clientToken: string | null
}

const isRotationOwnershipCurrent = (ownership: RotationOwnership): boolean =>
  !disposed &&
  ownership.pageGeneration === pageGeneration &&
  ownership.sessionRevision === authService.getSessionRevision() &&
  ownership.clientToken === authService.getClientCredentialForRevocation() &&
  ownership.appId === appId.value &&
  application.value?.id === ownership.appId




const confirmRegenerateToken = async (): Promise<void> => {
  if (!application.value) return
  const ownership: RotationOwnership = {
    appId: application.value.id,
    pageGeneration,
    sessionRevision: authService.getSessionRevision(),
    clientToken: authService.getClientCredentialForRevocation()
  }

  if (regeneratingAppId.value !== null) return
  regeneratingAppId.value = ownership.appId
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
    tokenState.value = { kind: 'unknown' }
    tokenVisible.value = false
    clearCopyFeedback()

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
      if (!isRotationOwnershipCurrent(ownership)) return
      if (isElevationCancelled(err)) {

        void reverifyToken(ownership.appId)
        return
      }
      showError(err as Error, t('applicationDetail.regenerateFailed'))

      void reverifyToken(ownership.appId)
      return
    }


    if (!isRotationOwnershipCurrent(ownership)) return


    if (typeof newToken !== 'string' || derivePublicForm(newToken) === null) {
      showError(new Error('invalid regenerate token response'), t('applicationDetail.regenerateFailed'))
      void reverifyToken(ownership.appId)
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
        tokenState.value = { kind: 'unknown' }
        tokenVisible.value = false
        clearCopyFeedback()
        void reverifyToken(ownership.appId)
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
    tokenState.value = { kind: 'valid', token: newToken }

    tokenVisible.value = true
    if (stored) {
      showSuccess(t('applicationDetail.regenerated'))
    } else {
      showError(new Error('app token storage failed'), t('applications.tokenStorageError'))
    }
  } finally {
    if (regeneratingAppId.value === ownership.appId) {
      regeneratingAppId.value = null
    }
  }
}







const uploadIcon = async (file: File): Promise<void> => {
  const target = application.value
  if (!target) return
  const targetId = target.id
  const capturedGeneration = pageGeneration
  const capturedSession = authService.getSessionRevision()
  const capturedClientToken = authService.getClientCredentialForRevocation()

  try {
    await applicationApi.uploadApplicationImage(targetId, file)
    if (disposed || capturedGeneration !== pageGeneration || capturedSession !== authService.getSessionRevision() || capturedClientToken !== authService.getClientCredentialForRevocation()) return
    showSuccess(t('applications.iconUploaded'))

    await reloadApplication()
  } catch (err) {
    if (disposed || capturedGeneration !== pageGeneration || capturedSession !== authService.getSessionRevision() || capturedClientToken !== authService.getClientCredentialForRevocation()) return
    showError(err as Error, t('applications.uploadIconError'))
  }
}




const deleteIcon = async (): Promise<void> => {
  const target = application.value
  if (!target) return
  const targetId = target.id
  const capturedGeneration = pageGeneration
  const capturedSession = authService.getSessionRevision()
  const capturedClientToken = authService.getClientCredentialForRevocation()

  try {
    await applicationApi.deleteApplicationImage(targetId)
    if (disposed || capturedGeneration !== pageGeneration || capturedSession !== authService.getSessionRevision() || capturedClientToken !== authService.getClientCredentialForRevocation()) return
    showSuccess(t('applications.iconDeleted'))

    await reloadApplication()
  } catch (err) {
    if (disposed || capturedGeneration !== pageGeneration || capturedSession !== authService.getSessionRevision() || capturedClientToken !== authService.getClientCredentialForRevocation()) return
    showError(err as Error, t('applications.deleteIconError'))
  }
}

const handleApplicationUpdated = (): void => {
  showEditModal.value = false
  void reloadApplication()
}

const confirmDelete = async (): Promise<void> => {
  const target = application.value
  if (!target) return
  const targetId = target.id
  const capturedGeneration = pageGeneration
  const capturedSession = authService.getSessionRevision()
  const capturedClientToken = authService.getClientCredentialForRevocation()

  const confirmed = await confirmDialog({
    title: t('common.confirmDialog.title'),
    message: t('applications.deleteConfirmWithName', { name: target.name }),
    confirmText: t('common.delete'),
    cancelText: t('common.cancel'),
    type: 'danger'
  })

  if (!confirmed) return
  if (disposed || capturedGeneration !== pageGeneration || capturedSession !== authService.getSessionRevision() || capturedClientToken !== authService.getClientCredentialForRevocation()) return

  try {

    await withElevation(() => {
      if (disposed || capturedGeneration !== pageGeneration || capturedSession !== authService.getSessionRevision() || capturedClientToken !== authService.getClientCredentialForRevocation()) {
        throw new ElevationCancelledError()
      }
      return applicationApi.deleteApplication(targetId)
    }, () => !disposed && capturedGeneration === pageGeneration && capturedSession === authService.getSessionRevision() && capturedClientToken === authService.getClientCredentialForRevocation())
    if (disposed || capturedGeneration !== pageGeneration || capturedSession !== authService.getSessionRevision() || capturedClientToken !== authService.getClientCredentialForRevocation()) return
    pageGeneration += 1
    authService.removeAppToken(targetId)
    showSuccess(t('applications.deleteSuccess'))
    void router.push('/applications')
  } catch (err) {
    if (isElevationCancelled(err)) return
    if (disposed || capturedGeneration !== pageGeneration || capturedSession !== authService.getSessionRevision() || capturedClientToken !== authService.getClientCredentialForRevocation()) return
    showError(err as Error, t('applications.deleteError'))
  }
}



watch(
  appId,
  (targetId) => {

    if (!Number.isSafeInteger(targetId) || targetId <= 0) return

    pageGeneration += 1
    application.value = null
    error.value = null
    showEditModal.value = false
    void loadApplication(targetId)
  },
  { immediate: true }
)

onMounted(() => {
  window.addEventListener('storage', onStorageChange)
})

onBeforeUnmount(() => {
  disposed = true
  unsubscribeSessionChanges()
  window.removeEventListener('storage', onStorageChange)
  clearCopyFeedback()
})
</script>

<style scoped>
.application-detail {
  max-width: 1000px;
  margin: 0 auto;
}

.loading-container {
  display: flex;
  justify-content: center;
  padding: 3rem;
}

.error-container {
  padding: 2rem;
}

.error-message {
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 0.5rem;
  padding: 1.5rem;
  text-align: center;
  max-width: 500px;
  margin: 0 auto;
}

.error-message h3 {
  color: #b91c1c;
  margin-bottom: 0.5rem;
}

.error-message p {
  color: #991b1b;
  margin-bottom: 1rem;
}

.retry-btn {
  background-color: var(--color-primary);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.375rem;
  padding: 0.5rem 1rem;
  cursor: pointer;
}

.application-content {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.application-header {
  display: flex;
  gap: 2rem;
  padding: 1.5rem;
  background: var(--color-bg-primary);
  border-radius: 0.75rem;
  box-shadow: var(--shadow-sm);
}

.app-icon-large {
  flex-shrink: 0;
}

.app-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.app-name {
  font-size: 1.875rem;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0;
}


.app-intro {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.app-description {
  color: var(--color-text-tertiary);
  font-size: 1rem;
  line-height: 1.5;
  margin: 0;
}

.app-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.meta-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 150px;
}

.meta-label {
  font-size: 0.875rem;
  color: var(--color-text-tertiary);
  font-weight: 500;
}

.meta-value {
  font-size: 0.875rem;
  color: var(--color-text-primary);
  font-weight: 600;
}

.priority-badge {
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
}

.priority-0 { background: var(--color-info-bg); color: var(--color-info); }
.priority-1 { background: var(--color-bg-hover); color: var(--color-text-secondary); }
.priority-2 { background: #fef3c7; color: #92400e; }
.priority-3 { background: #fecaca; color: #991b1b; }

.app-actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.edit-btn, .delete-btn, .regenerate-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  transition: var(--theme-transition);
}

.regenerate-btn {
  align-self: flex-start;
  white-space: nowrap;
  background-color: var(--color-warning);
  color: var(--color-text-inverse);
}

.regenerate-btn:hover:not(:disabled) {
  background-color: var(--color-warning-hover);
}

.regenerate-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.edit-btn {
  background-color: var(--color-primary);
  color: var(--color-text-inverse);
}

.edit-btn:hover {
  background-color: var(--color-primary-hover);
}

.delete-btn {
  background-color: var(--color-error);
  color: var(--color-text-inverse);
}

.delete-btn:hover {
  background-color: var(--color-error-hover);
}

.application-sections {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.section {
  background: var(--color-bg-primary);
  border-radius: 0.75rem;
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem 1.5rem 0;
}

.section-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
  padding: 0 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--color-border-primary);
}


.section > .section-title {
  padding-top: 1.5rem;
}

.view-all-btn {
  color: var(--color-primary);
  text-decoration: none;
  font-size: 0.875rem;
  font-weight: 500;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  transition: var(--theme-transition);
}

.view-all-btn:hover {
  background-color: #f0f9ff;
}

.token-container {
  padding: 1.5rem;
}

.token-display {
  display: flex;
  align-items: center;
  background: var(--color-bg-hover);
  border: 1px solid var(--color-border-secondary);
  border-radius: 0.5rem;
  padding: 0.75rem;
  margin-bottom: 1rem;
}

.token-display code {
  font-family: 'Courier New', monospace;
  font-size: 0.875rem;
  color: var(--color-text-primary);
  background: transparent;
  flex: 1;
  word-break: break-all;
}

.token-hidden {
  letter-spacing: 2px;
}

.token-copy-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: 0.25rem;
  background: transparent;
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border-secondary);
  border-radius: 0.375rem;
  padding: 0.375rem;
  cursor: pointer;
  transition: var(--theme-transition);
}

.token-copy-btn:hover {
  background-color: var(--color-border-secondary);
  color: var(--color-text-primary);
}

.token-toggle-btn {
  background: none;
  border: none;
  color: var(--color-text-tertiary);
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 0.25rem;
  margin-left: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.token-toggle-btn:hover {
  background-color: var(--color-border-secondary);
}

.token-description {
  color: var(--color-text-tertiary);
  font-size: 0.875rem;
  margin: 0;

  padding: 0 1.5rem 1.5rem;
}

.messages-list {
  padding: 0 1.5rem 1.5rem;
}

.message-item {
  padding: 1rem;
  border: 1px solid var(--color-border-primary);
  border-radius: 0.5rem;
  margin-bottom: 1rem;
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.message-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.message-time {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
}

.message-content {
  color: var(--color-text-secondary);
  font-size: 0.875rem;
  line-height: 1.5;
  margin-bottom: 0.5rem;
}

.message-priority {
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
}

.empty-messages {
  padding: 2rem 1.5rem;
}

.load-more-container {
  display: flex;
  justify-content: center;
  padding: 1rem 1.5rem;
}

.load-more-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1.5rem;
  background-color: var(--color-bg-hover);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border-secondary);
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: var(--theme-transition);
}

.load-more-btn:hover:not(:disabled) {
  background-color: var(--color-bg-active);
}

.load-more-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}


.edit-btn:focus-visible,
.delete-btn:focus-visible,
.regenerate-btn:focus-visible,
.token-copy-btn:focus-visible,
.token-toggle-btn:focus-visible,
.retry-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}


@media (max-width: 768px) {
  .application-header {
    flex-direction: column;
    gap: 1rem;
  }

  .app-meta {
    flex-direction: column;
    gap: 0.75rem;
  }

  .meta-item {
    min-width: auto;
  }

  .app-actions {
    justify-content: stretch;
  }

  .app-actions button {
    flex: 1;
  }

  .section-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }
}
</style>
