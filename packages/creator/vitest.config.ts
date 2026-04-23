import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      exclude: [...configDefaults.exclude, 'e2e/**'],
      root: fileURLToPath(new URL('./', import.meta.url)),
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'lcov', 'json-summary'],
        include: ['src/**/*.{ts,vue}'],
        exclude: [
          'src/**/*.d.ts',
          'src/main.ts', // 入口启动；测试不走
          'src/router/**', // 路由配置 + guard；靠 E2E 覆盖
          'src/styles/**',
          'src/prompts/**',
          'src/components/App.vue', // 容器壳，路由挂载
          // 下列组件由 Phase 3~4 留，当前未做组件测；留给后续专项
          'src/components/ChatPanel.vue',
          'src/components/SettingsModal.vue',
          'src/components/SlidePreview.vue',
          'src/components/MCPCatalogItem.vue',
          'src/components/MCPCustomServer.vue',
          'src/composables/useAIChat.ts', // 业务最重，留给 E2E + 专项
          'src/composables/useMCP.ts',
          'src/composables/useSlideStore.ts',
          'src/composables/logger.ts',
          'src/composables/useSlashCommands.ts', // 已由 useSlashCommands.test.ts 覆盖，分支见后期
          'src/pages/**', // 页面级（LoginPage / RegisterPage / DeckListPage /
          // DeckEditorPage）以 E2E 场景覆盖，组件层只测原子组件
          'dist/**',
          'test/**',
        ],
        // Phase 5 起点阈值（前端组件交互分支多、E2E 更擅长；这里保底线，后续迭代收紧）
        thresholds: {
          lines: 75,
          branches: 65,
          functions: 70,
          statements: 75,
        },
      },
    },
  }),
)
