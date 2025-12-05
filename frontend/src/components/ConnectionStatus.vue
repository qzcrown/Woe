<template>
  <div class="connection-status" :class="{ 'status-connected': connected, 'status-connecting': connecting, 'status-disconnected': !connected && !connecting }">
    <div class="status-indicator"></div>
    <div class="status-text">
      <span v-if="connecting">Connecting...</span>
      <span v-else-if="connected">Connected</span>
      <span v-else>Disconnected</span>
      
      <button 
        v-if="!connected && !connecting" 
        @click="reconnect" 
        class="reconnect-btn"
        title="Reconnect"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="23 4 23 10 17 10"></polyline>
          <polyline points="1 20 1 14 7 14"></polyline>
        </svg>
        Reconnect
      </button>
    </div>
    
    <div v-if="lastConnected" class="last-connected">
      Last connected: {{ formatTime(lastConnected) }}
    </div>
  </div>
</template>

<script setup lang="ts">

interface Props {
  connected: boolean
  connecting?: boolean
  lastConnected?: string
  reconnect?: () => void
}

defineProps<Props>()

const formatTime = (dateString: string) => {
  return new Date(dateString).toLocaleString()
}
</script>

<style scoped>
.connection-status {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background-color: white;
  border-radius: 2rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  position: fixed;
  bottom: 2rem;
  right: 2rem;
  z-index: 1000;
  transition: all 0.3s ease;
}

.status-indicator {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background-color: #ef4444;
  transition: background-color 0.3s;
}

.status-connected .status-indicator {
  background-color: #10b981;
  box-shadow: 0 0 6px rgba(16, 185, 129, 0.3);
}

.status-connecting .status-indicator {
  background-color: #f59e0b;
  animation: pulse 1.5s infinite;
}

.status-text {
  font-size: 0.875rem;
  font-weight: 500;
  color: #374151;
}

.reconnect-btn {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-left: 0.5rem;
  padding: 0.25rem 0.5rem;
  background-color: #3b82f6;
  color: white;
  border: none;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  cursor: pointer;
  transition: background-color 0.2s;
}

.reconnect-btn:hover {
  background-color: #2563eb;
}

.last-connected {
  font-size: 0.75rem;
  color: #6b7280;
  margin-top: 0.25rem;
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

/* Responsive Design */
@media (max-width: 768px) {
  .connection-status {
    bottom: 1rem;
    right: 1rem;
    left: 1rem;
    justify-content: center;
  }
  
  .status-text {
    order: 2;
  }
  
  .reconnect-btn {
    order: 1;
    margin-left: 0;
  }
  
  .last-connected {
    order: 3;
    width: 100%;
    text-align: center;
    margin-top: 0.5rem;
  }
}
</style>
