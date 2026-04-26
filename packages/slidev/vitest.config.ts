import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

/**
 * Phase 7.5C 起，slidev 包内的公共组件库（components/grid/ + components/decoration/
 * + 内容块组件）需要单测。这是 slidev 包首次接入 vitest——只跑 components/ 下的
 * .test.ts，不动 layouts / templates / slides.md（那些靠 E2E 覆盖）。
 */
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    root: fileURLToPath(new URL('./', import.meta.url)),
    include: ['components/**/*.test.ts', 'test/**/*.test.ts'],
  },
})
