<template>

  <div v-if="!connected" class="connection-status" :class="connecting ? 'status-connecting' : 'status-disconnected'">
    <div class="status-indicator"></div>
    <div class="status-text">
      <span v-if="connecting">{{ $t('connection.connecting') }}</span>
      <template v-else>
        <span>{{ $t('connection.disconnected') }}</span>
        <button @click="emit('reconnect')" class="reconnect-btn" :title="$t('connection.reconnect')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 4 23 10 17 10"></polyline>
            <polyline points="1 20 1 14 7 14"></polyline>
          </svg>
          {{ $t('connection.reconnect') }}
        </button>
      </template>
    </div>

    <div v-if="!connecting && lastConnected" class="last-connected" :title="formatDateTime(lastConnected)">
      {{ $t('connection.lastConnected', { time: formatRelativeTime(lastConnected) }) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { formatRelativeTime, formatDateTime } from '@/utils/datetime'

interface Props {
  connected: boolean
  connecting?: boolean
  lastConnected?: string
}

defineProps<Props>()

const emit = defineEmits<{ (e: 'reconnect'): void }>()
</script>

<style scoped>
.connection-status {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background-color: var(--color-bg-primary);
  border-radius: 2rem;
  box-shadow: var(--shadow-md);
  position: fixed;
  bottom: 2rem;
  right: 2rem;
  z-index: 1000;
  transition: var(--transition-interactive);
}

.status-indicator {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background-color: var(--color-error);
  transition: background-color 0.3s;
}

.status-connecting .status-indicator {
  background-color: var(--color-warning);
  animation: pulse 1.5s infinite;
}

.status-text {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-secondary);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.reconnect-btn {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  background-color: var(--color-primary);
  color: var(--color-text-inverse);
  border: none;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  cursor: pointer;
  transition: background-color 0.2s;
}

.reconnect-btn:hover {
  background-color: var(--color-primary-hover);
}

.last-connected {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
}

@keyframes pulse {
  0% {
    transform: scale(0.95);
    box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.7);
  }

  70% {
    transform: scale(1);
    box-shadow: 0 0 0 10px rgba(245, 158, 11, 0);
  }

  100% {
    transform: scale(0.95);
    box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);
  }
}


@media (max-width: 768px) {
  .connection-status {
    bottom: 1rem;
    right: 1rem;
    left: 1rem;
    justify-content: center;
  }

  .last-connected {
    width: 100%;
    text-align: center;
  }
}
</style>
