<template>
  <div class="message-filters">
    <div class="filter-group">
      <label for="application-filter" class="filter-label">Application:</label>
      <select 
        id="application-filter" 
        v-model="filters.applicationId" 
        class="filter-select"
        @change="emitFilterChange"
      >
        <option value="">All Applications</option>
        <option v-for="app in applications" :key="app.id" :value="app.id">
          {{ app.name }}
        </option>
      </select>
    </div>

    <div class="filter-group">
      <label for="priority-filter" class="filter-label">Priority:</label>
      <select 
        id="priority-filter" 
        v-model="filters.priority" 
        class="filter-select"
        @change="emitFilterChange"
      >
        <option value="">All Priorities</option>
        <option value="0">Low</option>
        <option value="1">Normal</option>
        <option value="2">High</option>
        <option value="3">Emergency</option>
      </select>
    </div>

    <div class="filter-group">
      <label for="search-filter" class="filter-label">Search:</label>
      <div class="search-input-container">
        <input 
          id="search-filter"
          v-model="filters.search"
          type="text"
          placeholder="Search messages..."
          class="search-input"
          @input="debounceSearch"
        />
        <button 
          v-if="filters.search" 
          @click="clearSearch" 
          class="clear-search-btn"
          title="Clear search"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    </div>

    <div class="filter-actions">
      <button @click="resetFilters" class="reset-btn">Reset Filters</button>
    </div>
  </div>
</template>

<script setup lang="ts">
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
  }, 300) // 300ms debounce
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

// Watch for URL query parameters to sync with filters
onMounted(() => {
  const urlParams = new URLSearchParams(window.location.search)
  
  if (urlParams.has('appId')) {
    filters.value.applicationId = urlParams.get('appId') || ''
  }
  
  if (urlParams.has('priority')) {
    filters.value.priority = urlParams.get('priority') || ''
  }
  
  if (urlParams.has('search')) {
    filters.value.search = urlParams.get('search') || ''
  }
  
  // Emit initial filters
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
  background: white;
  border-radius: 0.5rem;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
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
  color: #374151;
}

.filter-select {
  padding: 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  background-color: white;
  font-size: 0.875rem;
  color: #1f2937;
}

.search-input-container {
  position: relative;
}

.search-input {
  width: 100%;
  padding: 0.5rem 2rem 0.5rem 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  color: #1f2937;
}

.clear-search-btn {
  position: absolute;
  right: 0.5rem;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: #6b7280;
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 0.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.clear-search-btn:hover {
  background-color: #f3f4f6;
  color: #1f2937;
}

.filter-actions {
  display: flex;
  align-items: flex-end;
  padding-left: 1rem;
}

.reset-btn {
  padding: 0.5rem 1rem;
  background-color: #f3f4f6;
  color: #374151;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  transition: all 0.2s;
  white-space: nowrap;
}

.reset-btn:hover {
  background-color: #e5e7eb;
}

/* Responsive Design */
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
