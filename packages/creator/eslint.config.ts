import { globalIgnores } from 'eslint/config'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import pluginVitest from '@vitest/eslint-plugin'
import skipFormatting from 'eslint-config-prettier/flat'

export default defineConfigWithVueTs(
  {
    name: 'creator/files-to-lint',
    files: ['**/*.{vue,ts,mts,tsx}'],
  },

  globalIgnores(['**/dist/**', '**/dist-ssr/**', '**/coverage/**']),

  ...pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,

  {
    ...pluginVitest.configs.recommended,
    files: ['src/**/__tests__/*', 'test/**/*', '**/*.test.ts'],
    rules: {
      ...pluginVitest.configs.recommended.rules,
      'vitest/expect-expect': ['warn', { assertFunctionNames: ['expect', 'expectTypeOf'] }],
    },
  },

  {
    rules: {
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Phase 9-C（A03 防御）：禁用 v-html 永久守卫
      // user / AI 生成的字符串永远不直接 v-html 注入；如必要走 sanitize
      'vue/no-v-html': 'error',
    },
  },

  skipFormatting,
)
