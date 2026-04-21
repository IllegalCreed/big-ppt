import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { getPaths } from './workspace.js'
import { llm } from './routes/llm.js'
import { slides } from './routes/slides.js'
import { templates } from './routes/templates.js'
import { log } from './routes/log.js'
import { tools as toolsRoute } from './routes/tools.js'
import { registerLocalTools } from './tools/local/index.js'

const app = new Hono()

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
app.route('/api/llm', llm)
app.route('/api', slides)
app.route('/api', templates)
app.route('/api', log)
app.route('/api', toolsRoute)

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
})
