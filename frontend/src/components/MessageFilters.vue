<template>
  <div class="message-filters">
    <div class="filter-group">
      <label for="application-filter" class="filter-label">{{ $t('common.applications') }}:</label>
      <select
        id="application-filter"
        v-model="filters.applicationId"
        class="filter-select"
        @change="emitFilterChange"
      >
        <option value="">{{ $t('common.allApplications') }}</option>
        <option v-for="app in applications" :key="app.id" :value="app.id">
          {{ app.name }}
        </option>
      </select>
    </div>

    <div class="filter-group">
      <label for="priority-filter" class="filter-label">{{ $t('common.priority') }}:</label>
      <select
        id="priority-filter"
        v-model="filters.priority"
        class="filter-select"
        @change="emitFilterChange"
      >
        <option value="">{{ $t('common.allPriorities') }}</option>
        <option value="0">{{ $t('common.priorityLow') }}</option>
        <option value="1">{{ $t('common.priorityNormal') }}</option>
        <option value="2">{{ $t('common.priorityHigh') }}</option>
        <option value="3">{{ $t('common.priorityEmergency') }}</option>
      </select>
    </div>

    <div class="filter-group">
      <label for="search-filter" class="filter-label">{{ $t('common.search') }}:</label>
      <div class="search-input-container">
        <input
          id="search-filter"
          v-model="filters.search"
          type="text"
          :placeholder="$t('messages.searchPlaceholder')"
          class="search-input"
          @input="debounceSearch"
        />
        <button
          v-if="filters.search"
          @click="clearSearch"
          class="clear-search-btn"
          :title="$t('messages.clearSearch')"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    </div>

    <div class="filter-actions">
      <button @click="resetFilters" class="reset-btn">{{ $t('messages.resetFilters') }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { normalizePriorityFilter } from '@/utils/priority'
import { ref, onMounted, onUnmounted } from 'vue'
import type { Application } from '@/types'

interface Filters {
  applicationId: string
  priority: string
  search: string
}

interface Emits {
  (e: 'change', filters: Filters): void
}

defineProps<{
  applications: Application[]
}>()

const emit = defineEmits<Emits>()

const filters = ref<Filters>({
  applicationId: '',
  priority: '',
  search: ''
})

let searchTimeout: ReturnType<typeof setTimeout> | null = null

const emitFilterChange = () => {
  emit('change', { ...filters.value })
}

const debounceSearch = () => {
  if (searchTimeout) {
    clearTimeout(searchTimeout)
  }

  searchTimeout = setTimeout(() => {
    emitFilterChange()
  }, 300)
}

const clearSearch = () => {
  filters.value.search = ''
  emitFilterChange()
}

const resetFilters = () => {
  filters.value = {
    applicationId: '',
    priority: '',
    search: ''
  }
  emitFilterChange()
}


onMounted(() => {
  const urlParams = new URLSearchParams(window.location.search)

  if (urlParams.has('appId')) {
    filters.value.applicationId = urlParams.get('appId') || ''
  }

  if (urlParams.has('priority')) {
    filters.value.priority = normalizePriorityFilter(urlParams.get('priority'))
  }

  if (urlParams.has('search')) {
    filters.value.search = urlParams.get('search') || ''
  }


  emitFilterChange()
})

onUnmounted(() => {
  if (searchTimeout) {
    clearTimeout(searchTimeout)
  }
})
</script>

<style scoped>
.message-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  padding: 1rem;
  background: var(--color-bg-primary);
  border-radius: 0.5rem;
  box-shadow: var(--shadow-sm);
  margin-bottom: 1rem;
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 200px;
  flex: 1;
}

.filter-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.filter-select {
  padding: 0.5rem;
  border: 1px solid var(--color-border-secondary);
  border-radius: 0.375rem;
  background-color: var(--color-bg-primary);
  font-size: 0.875rem;
  color: var(--color-text-primary);
}

.search-input-container {
  position: relative;
}

.search-input {
  width: 100%;
  padding: 0.5rem 2rem 0.5rem 0.5rem;
  border: 1px solid var(--color-border-secondary);
  border-radius: 0.375rem;
  font-size: 0.875rem;
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
}

.clear-search-btn {
  position: absolute;
  right: 0.5rem;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: var(--color-text-tertiary);
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 0.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.clear-search-btn:hover {
  background-color: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.filter-actions {
  display: flex;
  align-items: flex-end;
  padding-left: 1rem;
}

.reset-btn {
  padding: 0.5rem 1rem;
  background-color: var(--color-bg-hover);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border-secondary);
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  transition: var(--transition-interactive);
  white-space: nowrap;
}

.reset-btn:hover {
  background-color: var(--color-bg-active);
}


@media (max-width: 768px) {
  .message-filters {
    flex-direction: column;
    gap: 0.75rem;
  }

  .filter-group {
    min-width: auto;
  }

  .filter-actions {
    padding-left: 0;
    justify-content: center;
  }
}
</style>
