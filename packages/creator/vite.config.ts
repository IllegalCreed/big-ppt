import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import Components from 'unplugin-vue-components/vite'
import AutoImport from 'unplugin-auto-import/vite'

// https://vite.dev/config/
export default defineConfig({
  build: {
    // 给 scripts/check-bundle.mjs 提供结构化 chunk 图，避免靠哈希文件名猜入口依赖。
    manifest: true,
  },
  plugins: [
    vue(),
    vueDevTools(),
    // Phase 10.5 落地：自动发现 @big-ppt/slidev 包内的 layouts + components，
    // 编辑器内 DeckRenderer 走的就是这套自动 import；跟 Slidev 自身的
    // unplugin-vue-components 行为对齐，新增组件无需改 register-slidev-components。
    Components({
      dirs: [
        fileURLToPath(new URL('../slidev/components', import.meta.url)),
        fileURLToPath(new URL('../slidev/layouts', import.meta.url)),
        'src/components',
      ],
      dts: 'components.d.ts',
      directoryAsNamespace: false,
      deep: true,
    }),
    AutoImport({
      imports: ['vue', 'vue-router'],
      dts: 'auto-imports.d.ts',
      dirs: [],
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Phase 10.5 落地：启用 runtime template compiler，让 body markdown
      // 编译出的 template 在浏览器里 Vue.compile() 能跑。+~50KB gzip。
      vue: 'vue/dist/vue.esm-bundler.js',
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
