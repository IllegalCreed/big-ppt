import { defineConfig } from '@playwright/test'

const AGENT_PORT = Number(process.env.AGENT_PORT ?? 4100)
const CREATOR_PORT = Number(process.env.CREATOR_PORT ?? 3130)

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // 共享 lumideck_test，必须串行
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${CREATOR_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: [
    {
      // 后端（agent 工作目录，不过 pnpm filter 避免 monorepo overhead）
      command: 'pnpm exec dotenv -e .env.test.local -- tsx src/index.ts',
      cwd: '../agent',
      url: `http://localhost:${AGENT_PORT}/healthz`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        AGENT_PORT: String(AGENT_PORT),
        // Phase 7D：让 rewriteForTemplate 跳 LLM 直接读 starter.md，
        // 使切模板状态机端到端跑通无需调真 LLM
        BIG_PPT_TEST_REWRITE_MODE: 'skeleton',
      },
    },
    {
      // 前端（vite dev）
      command: 'pnpm exec vite',
      cwd: '../creator',
      url: `http://localhost:${CREATOR_PORT}`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        CREATOR_PORT: String(CREATOR_PORT),
        AGENT_ORIGIN: `http://localhost:${AGENT_PORT}`,
      },
    },
  ],
})
