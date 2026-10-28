/// <reference types="vitest/config" />
import { execFileSync } from 'node:child_process'
import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { preparePluginGeneration } from './tests/pluginGeneration.ts'

const devApiTarget = process.env.VITE_DEV_API_TARGET || 'http://localhost:8787'
const devWsTarget = devApiTarget.replace(/^http/, 'ws')

const projectRoot = resolve(__dirname, '..')

preparePluginGeneration(projectRoot)



const pluginFrontendTestDirs = JSON.parse(
  execFileSync(
    process.execPath,
    [resolve(projectRoot, 'scripts/plugins/discovery.mjs'), '--print-frontend-test-dirs'],
    { encoding: 'utf8' }
  )
) as string[]

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    },


    dedupe: ['vue', 'vue-router', 'pinia', 'vue-i18n']
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


    fs: {
      allow: [projectRoot]
    },
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
    globalSetup: ['tests/pluginGeneration.ts'],



    alias: {
      '@vue/test-utils': resolve(__dirname, 'node_modules/@vue/test-utils'),
      axios: resolve(__dirname, 'node_modules/axios')
    },
    include: [
      'tests/**/*.test.ts',
      ...pluginFrontendTestDirs.map(dir => `../${dir}/**/*.test.ts`)
    ],
    exclude: [
      ...configDefaults.exclude,
      '../src/plugins/builtin/**/frontend/**/*.tmp-*',
      '../src/plugins/builtin/**/frontend/**/*.backup-*',
      '../src/plugins/builtin/**/tests/frontend/**/*.tmp-*',
      '../src/plugins/builtin/**/tests/frontend/**/*.backup-*',
      '../src/plugins/builtin/**/.plugin-tmp/**'
    ]
  }
})
