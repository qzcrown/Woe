<template>
  <Layout>
    <div class="dashboard">
      <h1 class="page-title">{{ $t('common.dashboard') }}</h1>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <rect x="2" y="4" width="20" height="16" rx="2"/>
              <path d="m22 7-10 5L2 7"/>
            </svg>
          </div>
          <div class="stat-content">
            <h3>{{ stats.messages }}</h3>
            <p>{{ $t('common.messages') }}</p>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M3 9h18"/>
              <path d="M9 21V9"/>
            </svg>
          </div>
          <div class="stat-content">
            <h3>{{ stats.applications }}</h3>
            <p>{{ $t('common.applications') }}</p>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <rect x="2" y="6" width="20" height="12" rx="2"/>
              <path d="M6 12h4m-4 4h8"/>
            </svg>
          </div>
          <div class="stat-content">
            <h3>{{ stats.clients }}</h3>
            <p>{{ $t('common.clients') }}</p>
          </div>
        </div>

        <div v-if="authStore.user?.admin" class="stat-card">
          <div class="stat-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </div>
          <div class="stat-content">
            <h3>{{ stats.users }}</h3>
            <p>{{ $t('common.users') }}</p>
          </div>
        </div>
      </div>

      <div class="dashboard-grid">
        <div class="dashboard-section">
          <div class="section-header">
            <h2>{{ $t('dashboard.recentMessages') }}</h2>
            <router-link to="/messages" class="view-all">{{ $t('dashboard.viewAll') }}</router-link>
          </div>
          <div class="messages-list">
            <div v-for="message in recentMessages" :key="message.id" class="message-item">
              <div class="message-header">
                <h4>{{ message.title }}</h4>
                <span class="message-time">{{ formatTime(message.date) }}</span>
              </div>
              <p class="message-content">{{ message.message }}</p>
              <div class="message-priority priority-{{ message.priority }}">
                {{ getPriorityLabel(message.priority) }}
              </div>
            </div>
            <div v-if="messagesStore.loading" class="loading">{{ $t('common.loading') }}</div>
            <div v-if="!messagesStore.loading && recentMessages.length === 0" class="empty-state">
              {{ $t('dashboard.noMessages') }}
            </div>
          </div>
        </div>

        <div class="dashboard-section">
          <div class="section-header">
            <h2>{{ $t('dashboard.stats.serverStatus') }}</h2>
          </div>
          <div class="system-status">
            <div class="status-item">
              <span class="status-label">{{ $t('common.database') }}</span>
              <span class="status-value" :class="systemStatus.database === 'green' ? 'status-ok' : 'status-error'">
                {{ (systemStatus.database || t('common.unknown')).toUpperCase() }}
              </span>
            </div>
            <div class="status-item">
              <span class="status-label">{{ $t('common.version') }}</span>
              <span class="status-value">{{ systemVersion.version || t('common.unknown') }}</span>
            </div>
            <div class="status-item">
              <span class="status-label">{{ $t('common.buildDate') }}</span>
              <span class="status-value">{{ formatDate(systemVersion.buildDate) }}</span>
            </div>
            <div class="status-item">
              <span class="status-label">{{ $t('common.websocket') }}</span>
              <span class="status-value" :class="wsConnected ? 'status-ok' : 'status-error'">
                {{ wsConnected ? t('common.connected').toUpperCase() : t('common.disconnected').toUpperCase() }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Layout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Layout from '@/components/Layout.vue'
import { useMessagesStore } from '@/stores/messages'
import { useAuthStore } from '@/stores/auth'
import { systemApi, applicationApi, clientApi, userApi } from '@/services/api'
import { wsService } from '@/services/websocket'

const { t } = useI18n()

const messagesStore = useMessagesStore()
const authStore = useAuthStore()

const stats = ref({
  messages: 0,
  applications: 0,
  clients: 0,
  users: 0
})

const systemStatus = ref<any>({})
const systemVersion = ref<any>({})
const wsConnected = ref(false)
let statusPollingInterval: number | null = null

const recentMessages = computed(() => {
  return messagesStore.messages.slice(0, 5)
})

const formatTime = (dateString: string) => {
  return new Date(dateString).toLocaleString()
}

const formatDate = (dateString: string) => {
  if (!dateString) return t('common.unknown')
  return new Date(dateString).toLocaleDateString()
}

const getPriorityLabel = (priority?: number) => {
  if (priority === undefined || priority === null) return t('common.priorityNormal')
  const labels = [
    t('common.priorityLow'),
    t('common.priorityNormal'),
    t('common.priorityHigh'),
    t('common.priorityEmergency')
  ]
  return labels[Math.min(priority, 3)] || t('common.priorityNormal')
}

const loadDashboardData = async () => {
  try {
    // 独立获取系统健康状态和版本信息，确保不被其他请求干扰
    await fetchSystemStatus()

    systemApi.getVersion()
      .then(res => {
        systemVersion.value = res.data
      })
      .catch(err => console.error('Error loading version info:', err))

    // 并行获取其他统计数据，但使用 Promise.allSettled 避免单个失败导致整体加载中断
    const results = await Promise.allSettled([
      applicationApi.getApplications(),
      clientApi.getClients(),
      userApi.getUsers()
    ])

    const [appsRes, clientsRes, usersRes] = results

    if (appsRes.status === 'fulfilled') {
      stats.value.applications = appsRes.value.data?.length || 0
    }
    
    if (clientsRes.status === 'fulfilled') {
      stats.value.clients = clientsRes.value.data?.length || 0
    }

    if (usersRes.status === 'fulfilled') {
      stats.value.users = usersRes.value.data?.length || 0
    }

    // 独立加载消息列表
    try {
      await messagesStore.fetchMessages({ limit: 20 })
      stats.value.messages = messagesStore.messages.length
    } catch (error) {
      console.error('Error loading recent messages:', error)
    }

  } catch (error) {
    console.error('Error loading dashboard data:', error)
  }
}

const fetchSystemStatus = async () => {
  try {
    const res = await systemApi.getHealth()
    systemStatus.value = res.data
  } catch (err) {
    console.error('Error loading health status:', err)
  }
}

const handleWsStateChange = (state: 'disconnected' | 'connecting' | 'connected') => {
  wsConnected.value = state === 'connected'
}

onMounted(() => {
  loadDashboardData()
  wsService.onStateChange(handleWsStateChange)
  // 每 30 秒轮询一次系统健康状态
  statusPollingInterval = window.setInterval(fetchSystemStatus, 30000)
})

onUnmounted(() => {
  wsService.offStateChange(handleWsStateChange)
  if (statusPollingInterval) {
    clearInterval(statusPollingInterval)
  }
})
</script>

<style scoped>
.dashboard {
  max-width: 1200px;
  margin: 0 auto;
}

.page-title {
  font-size: 2rem;
  font-weight: bold;
  color: #1f2937;
  margin-bottom: 2rem;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 1.5rem;
  margin-bottom: 2rem;
}

.stat-card {
  background: white;
  padding: 1.5rem;
  border-radius: 0.75rem;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
  display: flex;
  align-items: center;
  gap: 1rem;
}

.stat-icon {
  width: 48px;
  height: 48px;
  background: #f3f4f6;
  border-radius: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6b7280;
}

.stat-content h3 {
  font-size: 2rem;
  font-weight: bold;
  color: #1f2937;
  margin: 0;
}

.stat-content p {
  color: #6b7280;
  font-size: 0.875rem;
  margin: 0;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 2rem;
}

.dashboard-section {
  background: white;
  border-radius: 0.75rem;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 1px solid #e5e7eb;
}

.section-header h2 {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1f2937;
  margin: 0;
}

.view-all {
  color: #3b82f6;
  text-decoration: none;
  font-size: 0.875rem;
  transition: color 0.2s;
}

.view-all:hover {
  color: #2563eb;
}

.messages-list {
  padding: 1rem;
  max-height: 400px;
  overflow-y: auto;
}

.message-item {
  padding: 1rem;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  margin-bottom: 0.75rem;
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.message-header h4 {
  font-size: 1rem;
  font-weight: 600;
  color: #1f2937;
  margin: 0;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message-time {
  color: #6b7280;
  font-size: 0.75rem;
}

.message-content {
  color: #4b5563;
  font-size: 0.875rem;
  margin-bottom: 0.5rem;
  line-height: 1.5;
  max-height: 2.5em;
  overflow: hidden;
  text-overflow: ellipsis;
}

.message-priority {
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
}

.priority-0 { background: #dbeafe; color: #1e40af; }
.priority-1 { background: #f3f4f6; color: #374151; }
.priority-2 { background: #fef3c7; color: #92400e; }
.priority-3 { background: #fecaca; color: #991b1b; }

.system-status {
  padding: 1.5rem;
}

.status-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 0;
  border-bottom: 1px solid #f3f4f6;
}

.status-item:last-child {
  border-bottom: none;
}

.status-label {
  color: #4b5563;
  font-weight: 500;
}

.status-value {
  font-weight: 600;
}

.status-ok {
  color: #059669;
}

.status-error {
  color: #dc2626;
}

.loading, .empty-state {
  text-align: center;
  color: #6b7280;
  padding: 2rem;
}

@media (max-width: 768px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }

  .dashboard-grid {
    grid-template-columns: 1fr;
  }
}
</style>
