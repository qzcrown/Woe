/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

const devApiTarget = process.env.VITE_DEV_API_TARGET || 'http://localhost:8787'
const devWsTarget = devApiTarget.replace(/^http/, 'ws')

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  build: {
    outDir: '../public',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',


        manualChunks(id) {
          if (id.includes('milkdown') || id.includes('prosemirror') || id.endsWith('utils/wysiwyg.ts')) {
            return 'milkdown'
          }
        },
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    }
  },
  server: {
    proxy: {
      '/api': devApiTarget,
      '/auth': devApiTarget,
      '/current': devApiTarget,
      '/health': devApiTarget,
      '/init': devApiTarget,
      '/version': devApiTarget,
      '/user': devApiTarget,
      '/application': devApiTarget,
      '/client': devApiTarget,
      '/message': devApiTarget,
      '/plugin': devApiTarget,
      '/stream': {
        target: devWsTarget,
        ws: true
      }
    }
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    exclude: configDefaults.exclude
  }
})
