<template>
  <div class="application-icon" :class="[`size-${size}`, { 'has-image': hasImage }]">
    <img 
      v-if="hasImage && imageSrc" 
      :src="imageSrc" 
      :alt="name"
      @error="handleImageError"
      @load="handleImageLoad"
      class="icon-image"
    />
    <div v-else class="icon-placeholder">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
        <line x1="8" y1="21" x2="16" y2="21"></line>
        <line x1="12" y1="17" x2="12" y2="21"></line>
      </svg>
    </div>
    
    <div v-if="showUploadOverlay" class="upload-overlay" @click="triggerFileInput">
      <div class="upload-content">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="17 8 12 3 7 8"></polyline>
          <line x1="12" y1="3" x2="12" y2="15"></line>
        </svg>
        <span>Upload</span>
      </div>
    </div>
    
    <button 
      v-if="showDeleteButton && hasImage" 
      @click="deleteImage" 
      class="delete-button"
      title="Delete icon"
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
import { ref, computed } from 'vue'

interface Props {
  name: string
  image?: string
  size?: 'small' | 'medium' | 'large'
  showUploadOverlay?: boolean
  showDeleteButton?: boolean
  appId?: number
}

interface Emits {
  (e: 'upload', file: File): void
  (e: 'delete'): void
}

const props = withDefaults(defineProps<Props>(), {
  size: 'medium',
  showUploadOverlay: false,
  showDeleteButton: false
})

const emit = defineEmits<Emits>()

const fileInput = ref<HTMLInputElement>()
const imageError = ref(false)
const imageLoaded = ref(false)

const hasImage = computed(() => {
  return props.image && !imageError.value && imageLoaded.value
})

const imageSrc = computed(() => {
  if (!props.image) return ''
  
  // If image is a URL or data URL, use as is
  if (props.image.startsWith('http') || props.image.startsWith('data:')) {
    return props.image
  }
  
  // Otherwise, treat as relative path
  return props.image
})

const triggerFileInput = () => {
  fileInput.value?.click()
}

const handleFileChange = (event: Event) => {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  
  if (file) {
    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file')
      return
    }
    
    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      alert('Image size must be less than 2MB')
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

const deleteImage = () => {
  if (confirm('Are you sure you want to delete this icon?')) {
    emit('delete')
  }
}
</script>

<style scoped>
.application-icon {
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

.application-icon:hover .upload-overlay {
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

.application-icon:hover .delete-button {
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