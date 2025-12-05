<template>
  <div class="empty-state" :class="[`empty-state-${size}`, { 'empty-state-compact': compact }]">
    <div class="empty-state-icon">
      <slot name="icon">
        <!-- Default icon based on type -->
        <svg v-if="type === 'messages'" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
        <svg v-else-if="type === 'applications'" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
          <line x1="8" y1="21" x2="16" y2="21"></line>
          <line x1="12" y1="17" x2="12" y2="21"></line>
        </svg>
        <svg v-else-if="type === 'clients'" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
        </svg>
        <svg v-else-if="type === 'users'" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
        <svg v-else-if="type === 'search'" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="11" cy="11" r="8"></circle>
          <path d="m21 21-4.35-4.35"></path>
        </svg>
        <svg v-else-if="type === 'error'" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <svg v-else width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="16"></line>
          <line x1="8" y1="12" x2="16" y2="12"></line>
        </svg>
      </slot>
    </div>
    
    <div class="empty-state-content">
      <h3 class="empty-state-title">
        <slot name="title">{{ title }}</slot>
      </h3>
      
      <p v-if="$slots.description || description" class="empty-state-description">
        <slot name="description">{{ description }}</slot>
      </p>
      
      <div v-if="$slots.actions" class="empty-state-actions">
        <slot name="actions"></slot>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  type?: 'messages' | 'applications' | 'clients' | 'users' | 'search' | 'error' | 'default'
  title?: string
  description?: string
  size?: 'small' | 'medium' | 'large'
  compact?: boolean
}

withDefaults(defineProps<Props>(), {
  type: 'default',
  size: 'medium',
  compact: false
})
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 2rem 1rem;
  color: #6b7280;
}

.empty-state-small {
  padding: 1.5rem 1rem;
}

.empty-state-large {
  padding: 3rem 1rem;
}

.empty-state-compact {
  padding: 1rem;
}

.empty-state-icon {
  margin-bottom: 1rem;
  opacity: 0.6;
}

.empty-state-small .empty-state-icon {
  margin-bottom: 0.75rem;
}

.empty-state-large .empty-state-icon {
  margin-bottom: 1.5rem;
}

.empty-state-icon svg {
  width: 64px;
  height: 64px;
}

.empty-state-small .empty-state-icon svg {
  width: 48px;
  height: 48px;
}

.empty-state-large .empty-state-icon svg {
  width: 80px;
  height: 80px;
}

.empty-state-content {
  max-width: 400px;
}

.empty-state-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: #374151;
  margin-bottom: 0.5rem;
}

.empty-state-small .empty-state-title {
  font-size: 1rem;
}

.empty-state-large .empty-state-title {
  font-size: 1.25rem;
}

.empty-state-description {
  font-size: 0.875rem;
  line-height: 1.5;
  margin-bottom: 1.5rem;
  color: #6b7280;
}

.empty-state-small .empty-state-description {
  font-size: 0.8125rem;
  margin-bottom: 1rem;
}

.empty-state-large .empty-state-description {
  font-size: 0.9375rem;
  margin-bottom: 2rem;
}

.empty-state-actions {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  align-items: center;
}

.empty-state-actions :deep(button) {
  min-width: 120px;
}

.empty-state-actions :deep(a) {
  text-decoration: none;
  color: #3b82f6;
  font-weight: 500;
  transition: color 0.2s;
}

.empty-state-actions :deep(a:hover) {
  color: #2563eb;
}

/* 响应式设计 */
@media (max-width: 640px) {
  .empty-state {
    padding: 1.5rem 0.75rem;
  }
  
  .empty-state-small {
    padding: 1rem 0.75rem;
  }
  
  .empty-state-large {
    padding: 2rem 0.75rem;
  }
  
  .empty-state-actions {
    width: 100%;
  }
  
  .empty-state-actions :deep(button) {
    width: 100%;
  }
}
</style>