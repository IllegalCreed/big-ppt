/**
 * Phase 7D / P3-10：creator 集成测公共基建。
 *
 * 让 composable 测试不走 msw 假数据，而是直接调真实 in-process Hono app + 真 lumideck_test：
 *
 *  - 顶层 loadDotenv 加载 agent 的 .env.test.local（DATABASE_URL / APIKEY_MASTER_KEY 等）
 *  - 顶层替换 globalThis.fetch：相对路径 / `http://test/*` → `app.fetch(req)`，绝对外部 URL 走原生 fetch
 *  - cookie jar：自动把 Set-Cookie 回写下次请求的 Cookie 头（模拟浏览器 credentials: 'include' 行为）
 *  - `setupIntegration()`：在 spec 顶部调一次，挂 useTestDb（beforeEach reset 5 表 + afterAll close pool）
 *
 * 5 个 UI spec（DeckEditorCanvas / UndoToast / VersionTimeline / TemplatePickerModal / OccupiedWaitingPage）
 * 不 import 此文件，仍走 _setup/msw.ts。LLM / MCP 仍 mock（外部 cost）。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadDotenv } from 'dotenv'
import { afterEach, beforeEach } from 'vitest'

// 1. 加载 agent .env.test.local（必须在 import @big-ppt/agent 之前执行）
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const agentEnvPath = path.resolve(__dirname, '../../../agent/.env.test.local')
loadDotenv({ path: agentEnvPath })

// 2. 现在再 import agent 模块，DATABASE_URL 已就绪
const { app } = await import('@big-ppt/agent/src/app.js')
const { useTestDb } = await import('@big-ppt/agent/test/_setup/test-db.js')

// 3. cookie jar（一份 string，跨请求复用）
let cookieJar = ''

export function getCookie(): string {
  return cookieJar
}

export function resetCookieJar(): void {
  cookieJar = ''
}

const realFetch = globalThis.fetch

function shimFetch(): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    // 仅拦截 同源 / 相对路径；外部 http(s) URL 走原生 fetch（防止误拦下游 LLM mock 等）
    const isRelative = url.startsWith('/')
    const isLocalHostTest = url.startsWith('http://test') || url.startsWith('http://localhost')
    if (!isRelative && !isLocalHostTest) {
      return realFetch(input, init)
    }
    const fullUrl = isRelative ? `http://test${url}` : url
    const headers = new Headers(init?.headers)
    if (cookieJar && !headers.has('cookie')) headers.set('cookie', cookieJar)
    const req = new Request(fullUrl, { ...init, headers })
    const res = await app.fetch(req)
    // 收集 Set-Cookie（取第一个 cookie 的 name=value 段）
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) {
      const m = setCookie.match(/^([^=;]+)=([^;]*)/)
      if (m) cookieJar = `${m[1]}=${m[2]}`
    }
    return res
  }) as typeof fetch
}

function restoreFetch(): void {
  globalThis.fetch = realFetch
}

/**
 * 在 spec 顶部调一次：
 *   import { setupIntegration } from './_setup/integration'
 *   setupIntegration()
 *
 * 自动挂：
 *   - useTestDb()      → beforeEach resetDb / afterAll closeDb
 *   - shimFetch()      → beforeEach 替换 fetch；afterEach 复原 + 清 cookie jar
 */
export function setupIntegration(): void {
  useTestDb()
  beforeEach(() => {
    cookieJar = ''
    shimFetch()
  })
  afterEach(() => {
    restoreFetch()
    cookieJar = ''
  })
}

// 把 agent factories 透传出来，spec 直接 import 用
export {
  createTestUser,
  createSessionFor,
  createLoggedInUser,
  createDeckDirect,
} from '@big-ppt/agent/test/_setup/factories.js'

// 给需要直读 DB 的 spec 用（验证 DB 状态）
export { getDb, decks, deckVersions, users } from '@big-ppt/agent/src/db/index.js'

// agent 业务模块（如 useSwitchTemplateJob.spec 注入 fake RewriteFn）
export { __setRewriteFnForTesting } from '@big-ppt/agent/src/routes/decks.js'
export type { RewriteFn } from '@big-ppt/agent/src/template-switch-job.js'
