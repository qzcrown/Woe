<template>
  <div class="editable-avatar" :class="[`size-${size}`, { 'has-image': hasImage }]">
    <img
      v-if="user.avatar && !imageError"
      :src="avatarSrc"
      :alt="user.nickname || user.name"
      @error="handleImageError"
      @load="handleImageLoad"
      class="avatar-image"
      :class="{ 'image-hidden': !imageLoaded || imageError }"
    />
    <div v-else class="avatar-initials">
      {{ initials }}
    </div>

    <!-- Upload Overlay -->
    <div class="upload-overlay" @click="triggerUpload">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="17 8 12 3 7 8"></polyline>
        <line x1="12" y1="3" x2="12" y2="15"></line>
      </svg>
    </div>

    <!-- Delete Button (only when has avatar) -->
    <button
      v-if="user.avatar && !imageError"
      @click="handleDelete"
      class="delete-button"
      :title="t('common.deleteAvatar')"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>

    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      @change="handleFileChange"
      class="file-input"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { User } from '@/types'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useAlert } from '@/composables/useAlert'

const { t } = useI18n()
const { warning } = useAlert()

interface Props {
  user: User
  size?: 'small' | 'medium' | 'large'
}

interface Emits {
  (e: 'upload', file: File): void
  (e: 'delete'): void
}

const props = withDefaults(defineProps<Props>(), {
  size: 'medium'
})

const emit = defineEmits<Emits>()
const { confirm: confirmDialog } = useConfirmDialog()

const fileInput = ref<HTMLInputElement>()
const imageError = ref(false)
const imageLoaded = ref(false)

// Watch for user prop changes
watch(() => props.user, () => {
  imageError.value = false
  imageLoaded.value = false
})

const initials = computed(() => {
  const name = props.user.nickname || props.user.name
  return name.charAt(0).toUpperCase()
})

const hasImage = computed(() => {
  return props.user.avatar && !imageError.value && imageLoaded.value
})

const avatarSrc = computed(() => {
  if (!props.user.avatar) return ''
  if (props.user.avatar.startsWith('http') || props.user.avatar.startsWith('/')) {
    return props.user.avatar
  }
  return props.user.avatar
})

const triggerUpload = () => {
  fileInput.value?.click()
}

const handleFileChange = async (event: Event) => {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]

  if (file) {
    // Validate file type
    if (!file.type.startsWith('image/')) {
      await warning(t('common.selectImageFile'))
      return
    }

    // Validate file size (1MB)
    if (file.size > 1 * 1024 * 1024) {
      await warning(t('common.imageSizeLimit'))
      return
    }

    emit('upload', file)
  }

  // Reset input value
  target.value = ''
}

const handleImageError = () => {
  imageError.value = true
}

const handleImageLoad = () => {
  imageLoaded.value = true
}

const handleDelete = async () => {
  const confirmed = await confirmDialog({
    title: t('common.confirmDialog.title'),
    message: t('users.avatarDeleteConfirm'),
    confirmText: t('common.confirmDialog.confirmButton'),
    cancelText: t('common.confirmDialog.cancelButton'),
    type: 'warning'
  })
  
  if (confirmed) {
    emit('delete')
  }
}
</script>

<style scoped>
.editable-avatar {
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
  width: 96px;
  height: 96px;
  font-size: 32px;
}

.avatar-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: opacity 0.2s;
}

.avatar-image.image-hidden {
  opacity: 0;
  position: absolute;
  pointer-events: none;
}

.avatar-initials {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.has-image {
  background-color: transparent;
}

/* Upload Overlay */
.upload-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s;
  cursor: pointer;
  color: white;
}

.editable-avatar:hover .upload-overlay {
  opacity: 1;
}

/* Delete Button */
.delete-button {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 24px;
  height: 24px;
  background-color: #ef4444;
  color: white;
  border: none;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  padding: 0;
  z-index: 3;
}

.editable-avatar:hover .delete-button {
  opacity: 1;
}

.delete-button:hover {
  background-color: #dc2626;
}

.file-input {
  display: none;
}
</style>
