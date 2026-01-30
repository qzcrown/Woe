<template>
  <div class="user-avatar" :class="[`size-${size}`, { 'clickable': clickable }]" @click="handleClick">
    <img
      v-if="user.avatar && !imageError"
      :src="avatarSrc"
      :alt="user.nickname || user.name"
      @error="handleImageError"
      class="avatar-image"
    />
    <div v-else class="avatar-initials">
      {{ initials }}
    </div>
    <div v-if="user.description && showTooltip" class="avatar-tooltip">
      {{ user.description }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { User } from '@/types'

interface Props {
  user: User
  size?: 'small' | 'medium' | 'large'
  clickable?: boolean
  showTooltip?: boolean
}

interface Emits {
  (e: 'click'): void
}

const props = withDefaults(defineProps<Props>(), {
  size: 'medium',
  clickable: false,
  showTooltip: true
})

const emit = defineEmits<Emits>()

const imageError = ref(false)

const initials = computed(() => {
  const name = props.user.nickname || props.user.name
  return name.charAt(0).toUpperCase()
})

const avatarSrc = computed(() => {
  if (!props.user.avatar) return ''
  if (props.user.avatar.startsWith('http') || props.user.avatar.startsWith('/')) {
    return props.user.avatar
  }
  return props.user.avatar
})

const handleImageError = () => {
  imageError.value = true
}

const handleClick = () => {
  if (props.clickable) {
    emit('click')
  }
}
</script>

<style scoped>
.user-avatar {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  overflow: hidden;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  font-weight: 600;
  transition: all 0.2s;
}

.size-small {
  width: 32px;
  height: 32px;
  font-size: 14px;
}

.size-medium {
  width: 48px;
  height: 48px;
  font-size: 20px;
}

.size-large {
  width: 80px;
  height: 80px;
  font-size: 32px;
}

.avatar-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-initials {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.clickable {
  cursor: pointer;
}

.clickable:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.avatar-tooltip {
  position: absolute;
  bottom: 120%;
  left: 50%;
  transform: translateX(-50%);
  background-color: #1f2937;
  color: white;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 400;
  white-space: nowrap;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s;
  z-index: 100;
}

.user-avatar:hover .avatar-tooltip {
  opacity: 1;
}

.avatar-tooltip::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 6px solid transparent;
  border-top-color: #1f2937;
}
</style>
