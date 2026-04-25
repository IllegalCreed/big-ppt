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
import { getPaths } from './workspace.js'
import { llm } from './routes/llm.js'
import { slides } from './routes/slides.js'
import { templates } from './routes/templates.js'
import { promptsRoute } from './routes/prompts.js'
import { log } from './routes/log.js'
import { tools as toolsRoute } from './routes/tools.js'
import { mcp as mcpRoute } from './routes/mcp.js'
import { auth } from './routes/auth.js'
import { decksRoute } from './routes/decks.js'
import { lockRoute } from './routes/lock.js'
import { authOptional, type AuthVars } from './middleware/auth.js'
import { requestContextMiddleware } from './middleware/request-context.js'

export const app = new Hono<{ Variables: AuthVars }>()

// 先 authOptional 解 session cookie 到 ctx.var，再 requestContextMiddleware 把
// user/session/activeDeck 包进 AsyncLocalStorage 供下游 slides-store 读取。
app.use('*', authOptional)
app.use('*', requestContextMiddleware)

app.get('/', (c) => c.text('Big-PPT Agent'))
app.get('/healthz', (c) => {
  const paths = getPaths()
  return c.json({
    ok: true,
    service: 'big-ppt-agent',
    version: '0.1.0',
    paths: {
      root: paths.root,
      slides: paths.slidesPath,
      templates: paths.templatesDir,
      logs: paths.logsDir,
    },
  })
})

// 业务路由：挂载到 /api 前缀下
app.route('/api/auth', auth)
app.route('/api', decksRoute)
app.route('/api', lockRoute)
app.route('/api/llm', llm)
app.route('/api', slides)
app.route('/api', templates)
app.route('/api', promptsRoute)
app.route('/api', log)
app.route('/api', toolsRoute)
app.route('/api', mcpRoute)
