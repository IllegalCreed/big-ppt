// 最先加载 .env.local / .env，保证后续模块能读到 DATABASE_URL / APIKEY_MASTER_KEY 等
import { config as loadDotenv } from 'dotenv'
loadDotenv({ path: ['.env.local', '.env'] })

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { getPaths } from './workspace.js'
import { llm } from './routes/llm.js'
import { slides } from './routes/slides.js'
import { templates } from './routes/templates.js'
import { log } from './routes/log.js'
import { tools as toolsRoute } from './routes/tools.js'
import { mcp as mcpRoute } from './routes/mcp.js'
import { auth } from './routes/auth.js'
import { decksRoute } from './routes/decks.js'
import { lockRoute } from './routes/lock.js'
import { authOptional, type AuthVars } from './middleware/auth.js'
import { requestContextMiddleware } from './middleware/request-context.js'
import { registerLocalTools } from './tools/local/index.js'
import { getRegistry } from './mcp-registry/index.js'

const app = new Hono<{ Variables: AuthVars }>()

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
app.route('/api', log)
app.route('/api', toolsRoute)
app.route('/api', mcpRoute)

const port = Number(process.env.AGENT_PORT ?? 4000)

// 启动时 eager 解析一次 paths，尽早暴露 "monorepo root 未找到" 类错误
try {
  getPaths()
} catch (err) {
  console.error((err as Error).message)
  process.exit(1)
}

// 注册本地工具到 agent tool-registry
registerLocalTools()

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[agent] listening on http://localhost:${info.port}`)
  void getRegistry()
    .initialize()
    .then(() => console.log('[agent] MCP registry initialized'))
    .catch((err) => console.warn('[agent] MCP init partial failure:', (err as Error).message))
})
