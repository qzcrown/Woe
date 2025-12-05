import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: '../public',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      '/current': 'http://localhost:8787',
      '/health': 'http://localhost:8787',
      '/version': 'http://localhost:8787',
      '/user': 'http://localhost:8787',
      '/application': 'http://localhost:8787',
      '/client': 'http://localhost:8787',
      '/message': 'http://localhost:8787',
      '/plugin': 'http://localhost:8787',
      '/stream': {
        target: 'ws://localhost:8787',
        ws: true,
      },
    },
  },
})
