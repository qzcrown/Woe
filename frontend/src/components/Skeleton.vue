<template>
  <div class="skeleton" :class="{ [`skeleton-${type}`]: true, [`skeleton-${size}`]: true }">
    <!-- Text Skeleton -->
    <template v-if="type === 'text'">
      <div class="skeleton-line" :style="{ width: width || '100%' }"></div>
    </template>
    
    <!-- Title Skeleton -->
    <template v-else-if="type === 'title'">
      <div class="skeleton-line skeleton-title" :style="{ width: width || '70%' }"></div>
    </template>
    
    <!-- Avatar Skeleton -->
    <template v-else-if="type === 'avatar'">
      <div class="skeleton-avatar" :style="{ width: size, height: size }"></div>
    </template>
    
    <!-- Button Skeleton -->
    <template v-else-if="type === 'button'">
      <div class="skeleton-button" :style="{ width: width || '120px', height: size }"></div>
    </template>
    
    <!-- Card Skeleton -->
    <template v-else-if="type === 'card'">
      <div class="skeleton-card">
        <div class="skeleton-card-header">
          <div class="skeleton-avatar" style="width: 40px; height: 40px;"></div>
          <div class="skeleton-card-title">
            <div class="skeleton-line skeleton-title" style="width: 150px;"></div>
            <div class="skeleton-line" style="width: 100px; margin-top: 4px;"></div>
          </div>
        </div>
        <div class="skeleton-card-content">
          <div class="skeleton-line" style="width: 100%;"></div>
          <div class="skeleton-line" style="width: 90%; margin-top: 6px;"></div>
          <div class="skeleton-line" style="width: 80%; margin-top: 6px;"></div>
        </div>
      </div>
    </template>
    
    <!-- List Skeleton -->
    <template v-else-if="type === 'list'">
      <div class="skeleton-list">
        <div v-for="i in rows" :key="i" class="skeleton-list-item">
          <div class="skeleton-avatar" style="width: 32px; height: 32px;"></div>
          <div class="skeleton-list-content">
            <div class="skeleton-line skeleton-title" style="width: 60%;"></div>
            <div class="skeleton-line" style="width: 40%; margin-top: 4px;"></div>
          </div>
        </div>
      </div>
    </template>
    
    <!-- Table Skeleton -->
    <template v-else-if="type === 'table'">
      <div class="skeleton-table">
        <div class="skeleton-table-header">
          <div v-for="i in columns" :key="i" class="skeleton-line skeleton-title" style="height: 16px;"></div>
        </div>
        <div v-for="row in rows" :key="row" class="skeleton-table-row">
          <div v-for="i in columns" :key="i" class="skeleton-line" style="height: 16px;"></div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
interface Props {
  type: 'text' | 'title' | 'avatar' | 'button' | 'card' | 'list' | 'table'
  size?: string
  width?: string
  rows?: number
  columns?: number
}

withDefaults(defineProps<Props>(), {
  size: '40px',
  rows: 3,
  columns: 4
})
</script>

<style scoped>
.skeleton {
  display: inline-block;
  width: 100%;
}

.skeleton-line,
.skeleton-avatar,
.skeleton-button,
.skeleton-card,
.skeleton-list-item,
.skeleton-table-header,
.skeleton-table-row {
  position: relative;
  overflow: hidden;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: loading 1.5s infinite;
}

@keyframes loading {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

.skeleton-line {
  height: 12px;
  border-radius: 4px;
}

.skeleton-title {
  height: 16px;
}

.skeleton-avatar {
  border-radius: 50%;
  flex-shrink: 0;
}

.skeleton-button {
  border-radius: 6px;
}

.skeleton-card {
  padding: 1rem;
  border-radius: 8px;
  margin-bottom: 1rem;
}

.skeleton-card-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.skeleton-card-title {
  flex: 1;
}

.skeleton-card-content {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.skeleton-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.skeleton-list-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  border-radius: 6px;
}

.skeleton-list-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.skeleton-table {
  width: 100%;
}

.skeleton-table-header {
  display: flex;
  gap: 1rem;
  padding: 0.75rem;
  border-bottom: 1px solid #e5e7eb;
  margin-bottom: 0.5rem;
}

.skeleton-table-header .skeleton-line {
  flex: 1;
}

.skeleton-table-row {
  display: flex;
  gap: 1rem;
  padding: 0.75rem;
  border-radius: 4px;
}

.skeleton-table-row .skeleton-line {
  flex: 1;
}
</style>