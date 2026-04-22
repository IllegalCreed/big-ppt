import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // threads pool 确保 vi.mock 能可靠拦截 ESM 动态 import()。
    // forks pool 默认开启每个 worker 独立 module cache,在并行跑多文件时
    // @modelcontextprotocol/sdk 的动态 import 会绕过 vi.mock 注册,导致 flaky。
    pool: 'threads',
  },
})
