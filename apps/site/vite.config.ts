import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  base: process.env.PUBLIC_BASE_PATH ?? '/',
  resolve: {
    alias: {
      '@varunkanwar/atelier': fileURLToPath(new URL('../../packages/atelier/src', import.meta.url)),
    },
  },
})
