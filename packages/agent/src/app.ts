/**
 * Phase 7D：Hono app 装配抽出。
 *
 * 拆分目的：让 creator 集成测 / 未来其他工具 in-process 用 `app.fetch(req)` 调用业务路由，
 * 不必通过 HTTP/端口走真实网络。生产入口 `index.ts` import 此 app 并接到原生 http server 之上，
 * 同时附带 Slidev 反向代理 + WebSocket upgrade 等运行时能力。
 *
 * 此文件只做"路由 + 中间件装配"，不做副作用：
 *   - 不调 `registerLocalTools()`（生产/测试各自决定何时调）
 *   - 不调 `verifyTemplatesOrThrow()` / `getPaths()`（启动 fail-fast 留 index.ts）
 *   - 不监听端口（仅 export `app` 实例）
 */
import { Hono } from 'hono'
import { llm } from './routes/llm.js'
import { llmModels } from './routes/llm-models.js'
import { chat } from './routes/chat.js'
import { slides } from './routes/slides.js'
import { templates } from './routes/templates.js'
import { promptsRoute } from './routes/prompts.js'
import { log } from './routes/log.js'
import { tools as toolsRoute } from './routes/tools.js'
import { mcp as mcpRoute } from './routes/mcp.js'
import { auth } from './routes/auth.js'
import { decksRoute } from './routes/decks.js'
import { lockRoute } from './routes/lock.js'
import { healthz } from './routes/healthz.js'
import { imageLlmSettingsRoute } from './routes/image-llm-settings.js'
import { assetsRoute } from './routes/assets.js'
import { uploads } from './routes/uploads.js'
import { imageJobsRoute } from './routes/image-jobs.js'
import { slidevRestartRoute } from './routes/slidev-restart.js'
import { authOptional, type AuthVars } from './middleware/auth.js'
import { requestContextMiddleware } from './middleware/request-context.js'
import { originCheck } from './middleware/origin-check.js'
import { cspReportOnly } from './middleware/csp.js'

export const app = new Hono<{ Variables: AuthVars }>()

// 先 authOptional 解 session cookie 到 ctx.var，再 requestContextMiddleware 把
// user/session/activeDeck 包进 AsyncLocalStorage 供下游 slides-store 读取。
app.use('*', authOptional)
app.use('*', requestContextMiddleware)
// Phase 9-D（A05）：state-changing 请求 Origin/Referer 校验 + 生产 CSP report-only。
// 注意：originCheck 内部对 GET/HEAD/OPTIONS + /api/auth/(login|register|logout) 路径放行。
app.use('*', originCheck)
app.use('*', cspReportOnly)

app.get('/', (c) => c.text('Big-PPT Agent'))

// Healthcheck：根路径与 /api 路径都暴露，让 nginx 既能用 /api/ 反代规则
// 又能让本机 / Phase 11 反代灰度直连根路径。Phase 10 升级后不再泄漏内部 paths。
app.route('/healthz', healthz)
app.route('/api/healthz', healthz)

// 业务路由：挂载到 /api 前缀下
app.route('/api/auth', auth)
app.route('/api', decksRoute)
app.route('/api', lockRoute)
app.route('/api/llm', llm)
// Phase 12.5 Task D：model dropdown 调它拿 pi-ai 内置的 model 列表。
// 显式 mount 在 /api/llm/models 路径，**不**跟 /api/llm 的 sub-router 合并 ——
// llm 内部对 /chat/completions 等做 path-specific middleware 校验，把 models 端点
// 挂同前缀容易触发 CLAUDE.md「Hono sub-router wildcard 泄漏」坑。
app.route('/api/llm/models', llmModels)
// Phase 12.7 Task F：pi-agent-core 驱动的 agent loop 端点（POST /api/chat/turn）。
// 跟 /api/llm/chat/completions 并存:前者全权代理 agent loop（tool 调度内化在
// 后端 / 工具执行不走前端 round-trip）,后者保留给非 agent 路径（如 rewriteForTemplate）。
app.route('/api/chat', chat)
app.route('/api', slides)
app.route('/api', templates)
app.route('/api', promptsRoute)
app.route('/api', log)
app.route('/api', toolsRoute)
app.route('/api', mcpRoute)
app.route('/api', imageLlmSettingsRoute)
app.route('/api', assetsRoute)
app.route('/api/uploads', uploads)
app.route('/api', imageJobsRoute)
app.route('/api', slidevRestartRoute)
