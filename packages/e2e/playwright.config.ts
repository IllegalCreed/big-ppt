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
        // 让 e2e 的 mirror 写到 tmp 而非 packages/slidev/slides.md，
        // 避免你 dev 跑着的 :3031 slidev HMR 被 e2e 切模板搞乱（root cause：
        // 大改 frontmatter 触发 slidev cli full reload，dev iframe 闪/状态错乱）。
        // e2e spec 都断 DB + UI selector 不验 iframe 渲染，写哪都不影响通过率。
        BIG_PPT_SLIDES_PATH: '/tmp/lumideck-e2e-slides.md',
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
