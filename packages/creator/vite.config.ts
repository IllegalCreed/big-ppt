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
      // Slidev iframe 内 vite-plugin-vue-server-ref 发的状态同步请求（nav / drawings 等），
      // 该 plugin 客户端代码 fetch 写绝对路径不带 base 前缀，落到 creator dev 端口 404。
      // 上游修法见 docs/plans/99-tech-debt.md P3-11；当前两层 proxy 转给 agent → Slidev。
      '/@server-ref': {
        target: process.env.AGENT_ORIGIN ?? 'http://localhost:4000',
        changeOrigin: true,
      },
      '/@server-reactive': {
        target: process.env.AGENT_ORIGIN ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})
