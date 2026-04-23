// 环境变量加载策略：
//   - 正常走 pnpm dev/start 时，dotenv-cli 已经把 .env.{env}.local 注入到 process.env；
//     此时 DATABASE_URL 已存在，下面的守卫跳过，避免二次加载覆盖。
//   - 直接跑 `tsx src/index.ts`（非 pnpm 入口）时兜底读本地 .env.development.local / .env.local。
import { config as loadDotenv } from 'dotenv'
if (!process.env.DATABASE_URL) {
  loadDotenv({ path: ['.env.development.local', '.env.local'] })
}

import http from 'node:http'
import httpProxy from 'http-proxy'
import { getRequestListener } from '@hono/node-server'
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
import { authOptional, type AuthVars, validateSessionFromCookie } from './middleware/auth.js'
import { requestContextMiddleware } from './middleware/request-context.js'
import { registerLocalTools } from './tools/local/index.js'
import { getRegistry } from './mcp-registry/index.js'
import { isHeldBy } from './slidev-lock.js'

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

/**
 * 原生 http server 取代 @hono/node-server 的 serve()，目的是能同时处理：
 *   1. Hono 的 HTTP 路由
 *   2. /api/slidev-preview/* 的鉴权反代到 Slidev（:3031），包含 HMR 的 WebSocket upgrade
 *
 * Slidev 在生产应绑定到 127.0.0.1，只有本进程能反代进去。
 */
// localhost（而非 127.0.0.1）因为 Vite 5+ 默认只 bind IPv6 `::1`；生产部署时
// 可用 SLIDEV_ORIGIN 指定绝对内网地址（并把 Slidev 绑到对应网卡上）。
const SLIDEV_ORIGIN = process.env.SLIDEV_ORIGIN ?? 'http://localhost:3031'
const SLIDEV_PROXY_PREFIX = '/api/slidev-preview'

// Slidev 启动时配了 `--base /api/slidev-preview/`，它生成的 HTML / HMR WS
// 路径都带这个前缀；代理这里不要 strip，原样透传给 Slidev 让它自己路由。
const slidevProxy = httpProxy.createProxyServer({
  target: SLIDEV_ORIGIN,
  ws: true,
  changeOrigin: true,
})
slidevProxy.on('error', (err, _req, res) => {
  console.error('[slidev-proxy] upstream error:', err.message)
  if (res && 'writeHead' in res && !res.headersSent) {
    try {
      ;(res as http.ServerResponse).writeHead(502, { 'Content-Type': 'application/json' })
      ;(res as http.ServerResponse).end(JSON.stringify({ error: 'slidev upstream unavailable' }))
    } catch {
      /* ignore */
    }
  }
})

/** 反代前置鉴权：要求有效 session + 必须是当前锁持有者 */
async function authorizeSlidevAccess(
  cookieHeader: string | undefined,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const row = await validateSessionFromCookie(cookieHeader)
  if (!row) return { ok: false, status: 401, message: 'unauthorized' }
  if (!isHeldBy(row.session.id)) {
    return { ok: false, status: 403, message: 'slidev 实例当前未被你占用；请先 activate-deck' }
  }
  return { ok: true }
}

const honoListener = getRequestListener(app.fetch)

const server = http.createServer(async (req, res) => {
  if (req.url?.startsWith(SLIDEV_PROXY_PREFIX)) {
    const auth = await authorizeSlidevAccess(req.headers.cookie)
    if (!auth.ok) {
      res.writeHead(auth.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: auth.message }))
      return
    }
    slidevProxy.web(req, res)
    return
  }
  honoListener(req, res)
})

server.on('upgrade', async (req, socket, head) => {
  if (!req.url?.startsWith(SLIDEV_PROXY_PREFIX)) {
    socket.destroy()
    return
  }
  const auth = await authorizeSlidevAccess(req.headers.cookie)
  if (!auth.ok) {
    socket.write(`HTTP/1.1 ${auth.status} ${auth.message}\r\n\r\n`)
    socket.destroy()
    return
  }
  slidevProxy.ws(req, socket, head)
})

server.listen(port, () => {
  console.log(`[agent] listening on http://localhost:${port}`)
  console.log(`[agent] slidev proxy → ${SLIDEV_ORIGIN} (path: ${SLIDEV_PROXY_PREFIX}/*)`)
  void getRegistry()
    .initialize()
    .then(() => console.log('[agent] MCP registry initialized'))
    .catch((err) => console.warn('[agent] MCP init partial failure:', (err as Error).message))
})
