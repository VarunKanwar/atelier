import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const atelierSrc = fileURLToPath(new URL('../../packages/atelier/src/index.ts', import.meta.url))
const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url))
const siteRoot = new URL('.', import.meta.url)
export default defineConfig({
  plugins: [react()],
  base: process.env.PUBLIC_BASE_PATH ?? '/',
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', siteRoot)),
        404: fileURLToPath(new URL('404.html', siteRoot)),
      },
    },
  },
  resolve: {
    alias: {
      '@varunkanwar/atelier': atelierSrc,
    },
  },
  optimizeDeps: {
    exclude: ['@varunkanwar/atelier'],
  },
  server: {
    fs: {
      allow: [workspaceRoot],
    },
  },
})
