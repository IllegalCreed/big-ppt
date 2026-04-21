import pluginVue from 'eslint-plugin-vue'
import vueTsConfig from '@vue/eslint-config-typescript'
import configPrettier from 'eslint-config-prettier'

export default [
  {
    ignores: [
      '**/dist/**',
      '**/.output/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      'logs/**',
      'pnpm-lock.yaml',
    ],
  },
  ...pluginVue.configs['flat/recommended'],
  ...vueTsConfig(),
  {
    rules: {
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/test/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  configPrettier,
]
