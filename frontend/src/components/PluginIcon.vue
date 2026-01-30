<template>
  <div class="plugin-icon" :class="[`size-${size}`, { 'has-image': hasImage }]">
    <img
      v-if="imageSrc"
      :src="imageSrc"
      :alt="name"
      @error="handleImageError"
      @load="handleImageLoad"
      class="icon-image"
      :class="{ 'image-hidden': !imageLoaded || imageError }"
    />
    <div v-if="!hasImage" class="icon-placeholder">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2L2 7l10 5 10-5-10 5z"></path>
        <path d="M2 17l10 5 10-5M2 12l10 5 10-5"></path>
      </svg>
    </div>

    <div v-if="showUploadOverlay" class="upload-overlay" @click="triggerFileInput">
      <div class="upload-content">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="17 8 12 3 7 8"></polyline>
          <line x1="12" y1="3" x2="12" y2="15"></line>
        </svg>
        <span>{{ uploading ? $t('common.uploading') : $t('common.changeIcon') }}</span>
      </div>
    </div>

    <button
      v-if="showDeleteButton && hasImage"
      @click="deleteImage"
      class="delete-button"
      :title="$t('common.deleteIcon')"
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
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useAlert } from '@/composables/useAlert'

interface Props {
  name: string
  icon?: string
  size?: 'small' | 'medium' | 'large'
  showUploadOverlay?: boolean
  showDeleteButton?: boolean
  uploading?: boolean
}

interface Emits {
  (e: 'upload', file: File): void
  (e: 'delete'): void
}

const { t } = useI18n()
const { confirm: confirmDialog } = useConfirmDialog()
const { warning } = useAlert()

const props = withDefaults(defineProps<Props>(), {
  size: 'medium',
  showUploadOverlay: false,
  showDeleteButton: false,
  uploading: false
})

const emit = defineEmits<Emits>()

const fileInput = ref<HTMLInputElement>()
const imageError = ref(false)
const imageLoaded = ref(false)

// Watch icon prop changes, reset state
watch(() => props.icon, () => {
  imageError.value = false
  imageLoaded.value = false
})

const hasImage = computed(() => {
  return props.icon && !imageError.value && imageLoaded.value
})

const imageSrc = computed(() => {
  if (!props.icon) return ''

  // If icon is a URL or data URL, use as is
  if (props.icon.startsWith('http') || props.icon.startsWith('data:')) {
    return props.icon
  }

  // Otherwise, treat as relative path
  return props.icon
})

const triggerFileInput = () => {
  if (props.uploading) return
  fileInput.value?.click()
}

const handleFileChange = async (event: Event) => {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]

  if (file) {
    // Validate file type
    if (!file.type.startsWith('image/')) {
      await warning(t('plugins.invalidFileType'))
      return
    }

    // Validate file size (max 1MB)
    if (file.size > 1 * 1024 * 1024) {
      await warning(t('plugins.fileTooLarge'))
      return
    }

    emit('upload', file)
  }

  // Reset input value to allow selecting the same file again
  target.value = ''
}

const handleImageError = () => {
  imageError.value = true
}

const handleImageLoad = () => {
  imageLoaded.value = true
}

const deleteImage = async () => {
  const confirmed = await confirmDialog({
    title: t('common.confirmDialog.title'),
    message: t('plugins.deleteIconConfirm'),
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
.plugin-icon {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  overflow: hidden;
  background-color: #f3f4f6;
  transition: all 0.2s;
}

.size-small {
  width: 40px;
  height: 40px;
}

.size-medium {
  width: 64px;
  height: 64px;
}

.size-large {
  width: 96px;
  height: 96px;
}

.icon-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: opacity 0.2s;
}

.icon-image.image-hidden {
  opacity: 0;
  position: absolute;
  pointer-events: none;
}

.icon-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: #9ca3af;
}

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
}

.plugin-icon:hover .upload-overlay {
  opacity: 1;
}

.upload-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  color: white;
  font-size: 0.875rem;
  font-weight: 500;
}

.delete-button {
  position: absolute;
  top: -8px;
  right: -8px;
  width: 24px;
  height: 24px;
  background-color: #ef4444;
  color: white;
  border: 2px solid white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.plugin-icon:hover .delete-button {
  opacity: 1;
}

.delete-button:hover {
  background-color: #dc2626;
}

.file-input {
  display: none;
}

.has-image {
  background-color: transparent;
}
</style>
