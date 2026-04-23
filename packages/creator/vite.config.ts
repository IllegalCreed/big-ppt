import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), vueDevTools()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: Number(process.env.CREATOR_PORT ?? 3030),
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.AGENT_ORIGIN ?? 'http://localhost:4000',
        changeOrigin: true,
        // /api/slidev-preview/* 需要 WebSocket（Vite HMR）转发
        ws: true,
      },
    },
  },
})
