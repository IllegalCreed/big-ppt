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
    ...(process.env.DISABLE_VUE_DEVTOOLS === '1' ? [] : [vueDevTools()]),
    // 自动发现 @big-ppt/slidev 设计系统包内的 layouts + components。
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
      },
    },
  },
})
